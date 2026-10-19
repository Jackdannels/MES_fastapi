[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('Initialize','Build','Export','Verify','Import','Start','Stop','Status','Restore','Test')]
    [string]$Action,
    [string]$EnvFile,
    [string]$OutputDirectory,
    [string]$BackupDirectory,
    [string]$ReleaseVersion,
    [ValidateSet('demo','mes')] [string]$Mode = 'demo'
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
if (-not $EnvFile) { $EnvFile = Join-Path $root '.tmp/portable.env' }
$EnvFile = [IO.Path]::GetFullPath($EnvFile)

function Invoke-Docker([string[]]$Arguments) {
    & docker @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Docker command failed: $($Arguments[0]) (exit $LASTEXITCODE)" }
}
function Write-Utf8([string]$Path, [string]$Value) {
    [IO.File]::WriteAllText($Path, $Value, (New-Object Text.UTF8Encoding($false)))
}
function Get-Digest([string]$Path) {
    $stream = [IO.File]::OpenRead($Path)
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try { return -join ($algorithm.ComputeHash($stream) | ForEach-Object { $_.ToString('x2') }) }
    finally { $stream.Dispose(); $algorithm.Dispose() }
}
function Get-ComposeArguments {
    $arguments = @('compose','--env-file',$EnvFile,'-f',(Join-Path $root 'compose.portable.yml'))
    if ($Mode -eq 'demo') {
        $arguments += @('-f',(Join-Path $root 'compose.portable.simulators.yml'),'--profile','simulators')
    }
    return $arguments
}
function Read-Compose {
    $json = & docker @(Get-ComposeArguments) config --format json
    if ($LASTEXITCODE -ne 0) { throw 'Compose configuration is invalid' }
    return ($json -join "`n" | ConvertFrom-Json)
}
function Assert-SafeFile([string]$Base, [string]$Relative) {
    if (-not $Relative -or $Relative -match '(^/|\\|:|(^|/)\.\.?(/|$))') { throw "Unsafe manifest path: $Relative" }
    $path = [IO.Path]::GetFullPath((Join-Path $Base $Relative))
    if (-not $path.StartsWith($Base.TrimEnd('\','/') + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Manifest path escaped package'
    }
    $current = Get-Item -LiteralPath $path -Force
    while ($current.FullName -ne $Base) {
        if ($current.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Package contains a reparse point: $Relative" }
        if ($current -is [IO.DirectoryInfo]) { $current = $current.Parent }
        else { $current = $current.Directory }
        if ($null -eq $current) { throw 'Invalid package path' }
    }
    return $path
}
function Read-VerifiedBundle([string]$Directory) {
    $base = (Resolve-Path -LiteralPath $Directory).Path
    $manifest = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $base 'manifest.json') | ConvertFrom-Json
    if ($manifest.format -cne 'mes-portable-release' -or $manifest.format_version -ne 1) { throw 'Unsupported portable release format' }
    if (@($manifest.packages).Count -ne 3) { throw 'Expected three application packages' }
    $expectedPackages = @{'mes-core'=@('api','web','mysql','rabbitmq'); 'lims-simulator'=@('lims-simulator'); 'upper-simulator'=@('upper-simulator')}
    $packageNames = New-Object 'Collections.Generic.HashSet[string]' ([StringComparer]::Ordinal)
    $paths = New-Object 'Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    foreach ($entry in $manifest.files) {
        if (-not $paths.Add([string]$entry.path)) { throw 'Duplicate manifest path' }
        $path = Assert-SafeFile $base ([string]$entry.path)
        if ((Get-Item -LiteralPath $path).Length -ne [long]$entry.bytes -or (Get-Digest $path) -cne $entry.sha256) {
            throw "Checksum mismatch: $($entry.path)"
        }
    }
    foreach ($package in $manifest.packages) {
        if (-not $expectedPackages.ContainsKey([string]$package.name) -or -not $packageNames.Add([string]$package.name)) { throw 'Unexpected or duplicate application package' }
        if ($package.archive -cne ($package.name + '/images.tar')) { throw 'Unexpected application archive path' }
        if (-not $paths.Contains([string]$package.archive)) { throw 'Package archive is missing from inventory' }
        $expectedRoles = @($expectedPackages[[string]$package.name])
        $roles = @($package.images | ForEach-Object { [string]$_.role })
        if (@(Compare-Object ($roles | Sort-Object) ($expectedRoles | Sort-Object)).Count) { throw 'Package image roles do not match the release contract' }
        foreach ($image in $package.images) {
            if ($image.image_id -cnotmatch '^sha256:[0-9a-f]{64}$' -or $image.reference -notmatch '^mes/[a-z-]+:[A-Za-z0-9._-]+$') { throw 'Invalid package image identity' }
            if ($image.os -cne 'linux' -or $image.architecture -cne 'amd64') { throw 'Unsupported package image architecture' }
        }
    }
    foreach ($item in Get-ChildItem -LiteralPath $base -Recurse -Force) {
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Release contains a reparse point' }
        if ($item.PSIsContainer) { continue }
        $relative = $item.FullName.Substring($base.Length + 1).Replace('\','/')
        if ($relative -eq 'manifest.json' -or $relative.StartsWith('.tmp/')) { continue }
        if (-not $paths.Contains($relative)) { throw "Untracked release file: $relative" }
    }
    return $manifest
}

Push-Location $root
try {
    if ($Action -eq 'Initialize') {
        if (Test-Path -LiteralPath $EnvFile) { throw "Environment file already exists: $EnvFile" }
        $template = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $root 'deploy/.env.portable.example')
        if (-not $ReleaseVersion) { $ReleaseVersion = [regex]::Match($template, '(?m)^MES_RELEASE_VERSION=([^\r\n]+)').Groups[1].Value }
        if ($ReleaseVersion -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]*$') { throw 'Invalid release version' }
        $lines = foreach ($line in ($template -split "`r?`n")) {
            if ($line -match '^([^#=]+)=GENERATE$') {
                $bytes = New-Object byte[] 32
                $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
                try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
                $Matches[1] + '=' + (-join ($bytes | ForEach-Object { $_.ToString('x2') }))
            } elseif ($line.StartsWith('MES_RELEASE_VERSION=')) { 'MES_RELEASE_VERSION=' + $ReleaseVersion }
            else { $line }
        }
        New-Item -ItemType Directory -Path (Split-Path -Parent $EnvFile) -Force | Out-Null
        Write-Utf8 $EnvFile ($lines -join "`n")
        Write-Host "Generated configuration with random credentials: $EnvFile"
        return
    }
    if ($Action -in @('Verify','Import')) {
        if (-not $OutputDirectory) { $OutputDirectory = $root }
        $OutputDirectory = (Resolve-Path -LiteralPath $OutputDirectory).Path
        $manifest = Read-VerifiedBundle $OutputDirectory
        if ($Action -eq 'Import') {
            foreach ($package in $manifest.packages) {
                Invoke-Docker @('load','--input',(Join-Path $OutputDirectory $package.archive))
                foreach ($image in $package.images) {
                    $actual = & docker image inspect ([string]$image.reference) --format '{{json .}}'
                    if ($LASTEXITCODE -ne 0) { throw 'Imported image is unavailable' }
                    $metadata = $actual | ConvertFrom-Json
                    if ($metadata.Id -cne $image.image_id -or $metadata.Os -cne $image.os -or $metadata.Architecture -cne $image.architecture) {
                        throw "Imported image metadata mismatch: $($image.reference)"
                    }
                }
            }
        }
        Write-Host 'Portable package checksums verified. No services started.'
        return
    }
    if (-not (Test-Path -LiteralPath $EnvFile)) { throw 'Run Initialize first, or supply -EnvFile' }
    if ($Action -in @('Build','Export')) { $Mode = 'demo' }
    $compose = Get-ComposeArguments
    Invoke-Docker ($compose + @('config','--quiet'))
    switch ($Action) {
        'Build' {
            Invoke-Docker ($compose + @('build','--pull','api','web','lims-simulator','upper-simulator'))
            $config = Read-Compose
            foreach ($service in @('mysql','rabbitmq')) {
                $reference = [string]$config.services.$service.image
                & docker image inspect $reference 2>$null | Out-Null
                if ($LASTEXITCODE -ne 0) { Invoke-Docker @('pull',$reference) }
            }
        }
        'Start' {
            Invoke-Docker ($compose + @('up','-d','--no-build','--pull','never','--wait','--wait-timeout','240'))
        }
        'Stop' { Invoke-Docker ($compose + @('down')) }
        'Status' { Invoke-Docker ($compose + @('ps','-a')) }
        'Export' {
            if (-not $OutputDirectory) { throw 'Export requires -OutputDirectory' }
            $destination = [IO.Path]::GetFullPath($OutputDirectory)
            if (Test-Path -LiteralPath $destination) { throw 'Export directory already exists' }
            $config = Read-Compose
            $version = [string]$config.services.api.image -replace '^mes/api:',''
            $temporary = $destination + '.incomplete-' + [guid]::NewGuid().ToString('N')
            New-Item -ItemType Directory -Path $temporary -Force | Out-Null
            $packages = @()
            $groups = [ordered]@{'mes-core'=@('api','web','mysql','rabbitmq'); 'lims-simulator'=@('lims-simulator'); 'upper-simulator'=@('upper-simulator')}
            foreach ($name in $groups.Keys) {
                $images = @()
                foreach ($service in $groups[$name]) {
                    $reference = [string]$config.services.$service.image
                    $raw = & docker image inspect $reference --format '{{json .}}'
                    if ($LASTEXITCODE -ne 0) { throw "Image not built or pulled: $reference" }
                    $metadata = $raw | ConvertFrom-Json
                    if ($metadata.Os -ne 'linux' -or $metadata.Architecture -ne 'amd64') { throw 'This bundle requires linux/amd64 images' }
                    $upstream = $reference
                    # Docker save/load preserves these explicit tags without requiring
                    # the target to resolve an upstream registry digest while offline.
                    if ($service -in @('mysql','rabbitmq')) {
                        $reference = "mes/${service}:$version"
                        Invoke-Docker @('tag',$upstream,$reference)
                    }
                    $images += [ordered]@{role=$service; reference=$reference; upstream_reference=$upstream; image_id=$metadata.Id; os=$metadata.Os; architecture=$metadata.Architecture; repo_digests=@($metadata.RepoDigests)}
                }
                $folder = Join-Path $temporary $name
                New-Item -ItemType Directory -Path $folder | Out-Null
                $archive = "$name/images.tar"
                $references = @($images | ForEach-Object { $_.reference })
                Invoke-Docker (@('save','--output',(Join-Path $temporary $archive)) + $references)
                $packages += [ordered]@{name=$name; archive=$archive; images=@($images)}
            }
            $deploymentFiles = @('compose.portable.yml','compose.portable.simulators.yml','deploy/.env.portable.example',
                'deploy/mysql/init-users.sh','scripts/deploy/Mes-Portable.ps1','scripts/deploy/portable_data.py','docs/portable-deployment.md')
            foreach ($relative in $deploymentFiles) {
                $target = Join-Path $temporary $relative
                New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
                Copy-Item -LiteralPath (Join-Path $root $relative) -Destination $target
            }
            # Freeze the exported template to the exact image references selected for this build.
            $templatePath = Join-Path $temporary 'deploy/.env.portable.example'
            $template = Get-Content -Raw -Encoding UTF8 -LiteralPath $templatePath
            $template = $template -replace '(?m)^MES_RELEASE_VERSION=.*$', ('MES_RELEASE_VERSION=' + $version)
            foreach ($pair in @(@('MYSQL_IMAGE','mysql'),@('RABBITMQ_IMAGE','rabbitmq'))) {
                $template = $template -replace ('(?m)^' + $pair[0] + '=.*$'), ($pair[0] + '=mes/' + $pair[1] + ':' + $version)
            }
            Write-Utf8 $templatePath $template
            $files = @(foreach ($file in Get-ChildItem -LiteralPath $temporary -File -Recurse) {
                [ordered]@{path=$file.FullName.Substring($temporary.Length + 1).Replace('\','/'); bytes=[long]$file.Length; sha256=Get-Digest $file.FullName}
            })
            $manifest = [ordered]@{format='mes-portable-release'; format_version=1; release_version=$version; created_at_utc=[DateTime]::UtcNow.ToString('o'); packages=@($packages); files=@($files | Sort-Object path)}
            Write-Utf8 (Join-Path $temporary 'manifest.json') ($manifest | ConvertTo-Json -Depth 10)
            # Both absolute paths are verified before moving the new staging directory.
            if ((Split-Path -Parent $temporary) -ne (Split-Path -Parent $destination)) { throw 'Export staging path mismatch' }
            Move-Item -LiteralPath $temporary -Destination $destination
            Read-VerifiedBundle $destination | Out-Null
            Write-Host "Three portable packages exported: $destination"
        }
        'Restore' {
            if (-not $BackupDirectory) { throw 'Restore requires -BackupDirectory' }
            $backup = (Resolve-Path -LiteralPath $BackupDirectory).Path
            $helper = (Resolve-Path -LiteralPath (Join-Path $root 'scripts/deploy/portable_data.py')).Path
            $config = Read-Compose
            $limsVolume = $config.volumes.lims_data.name
            $existingVolumes = @(& docker volume ls --format '{{.Name}}')
            if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect target data volumes' }
            if ($limsVolume -notin $existingVolumes) {
                Invoke-Docker @('volume','create','--label',"com.docker.compose.project=$($config.name)",'--label','com.docker.compose.volume=lims_data',$limsVolume)
            }
            $tool = @('run','--rm','--no-deps','--user','0:0','-v',"${backup}:/backup:ro",'-v',"${helper}:/app/portable_data.py:ro",'-v',"${limsVolume}:/data/lims",'api','python','/app/portable_data.py')
            # Verify every byte before creating or changing target data.
            Invoke-Docker ($compose + $tool + @('verify','--directory','/backup'))
            $running = & docker @compose ps --status running --services
            if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect target services' }
            if (@($running | Where-Object { $_ -in @('api','web','lims-simulator','upper-simulator') }).Count) { throw 'Stop application and simulator services before restoring' }
            Invoke-Docker ($compose + @('up','-d','--no-build','--pull','never','--wait','mysql'))
            Invoke-Docker ($compose + $tool + @('assert-empty','--directory','/backup'))
            Invoke-Docker ($compose + $tool + @('restore-files','--directory','/backup'))
            Invoke-Docker ($compose + @('cp',(Join-Path $backup 'database.sql'),'mysql:/tmp/mes-portable-database.sql'))
            Invoke-Docker ($compose + @('exec','-T','mysql','sh','-c','MYSQL_PWD=$MYSQL_ROOT_PASSWORD mysql -uroot $MYSQL_DATABASE < /tmp/mes-portable-database.sql && rm /tmp/mes-portable-database.sql'))
            Invoke-Docker ($compose + $tool + @('rebase','--directory','/backup'))
            Write-Host 'Data restored and report paths rebased. Run Start next.'
        }
        'Test' {
            $config = Read-Compose
            $apiPort = $config.services.api.ports[0].published
            $webPort = $config.services.web.ports[0].published
            $urls = @("http://127.0.0.1:$apiPort/health/ready","http://127.0.0.1:$webPort/")
            if ($Mode -eq 'demo') {
                foreach ($name in @('lims-simulator','upper-simulator')) {
                    $port = $config.services.$name.ports[0].published
                    $peer = Invoke-RestMethod -Uri "http://127.0.0.1:$port/api/state" -TimeoutSec 10
                    if (-not $peer.connected) { throw "$name is not connected" }
                    Write-Host "$name connected, version $($peer.version)"
                }
            }
            foreach ($url in $urls) {
                $response = Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 15
                if ($response.StatusCode -ne 200) { throw "HTTP verification failed: $url" }
                Write-Host "HTTP 200: $url"
            }
            $login = @{username=$config.services.api.environment.DEMO_USER; password=$config.services.api.environment.DEMO_PASSWORD; module='central'} | ConvertTo-Json
            $session = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$webPort/auth/login" -ContentType 'application/json' -Body $login -TimeoutSec 15
            if ($session.module -ne 'central') { throw 'MES login verification failed' }
            Write-Host 'MES login succeeded'
        }
    }
} finally { Pop-Location }
