[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$SourceDirectory,
    [Parameter(Mandatory=$true)][string]$TargetDirectory,
    [switch]$RestartIfRunning
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$sourceRoot = (Resolve-Path -LiteralPath $SourceDirectory).Path
$targetRoot = (Resolve-Path -LiteralPath $TargetDirectory).Path
$sourceClient = if (Test-Path -LiteralPath (Join-Path $sourceRoot 'central-client/client-manifest.json')) { Join-Path $sourceRoot 'central-client' } else { $sourceRoot }
$targetClient = if (Test-Path -LiteralPath (Join-Path $targetRoot 'central-client/MES中控管理.exe')) { Join-Path $targetRoot 'central-client' } else { $targetRoot }
function Get-Sha256([string]$Path) {
    $stream = [IO.File]::OpenRead($Path)
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try { return -join ($algorithm.ComputeHash($stream) | ForEach-Object { $_.ToString('x2') }) }
    finally { $algorithm.Dispose(); $stream.Dispose() }
}
function ChildPath([string]$Root,[string]$Relative) {
    if ([IO.Path]::IsPathRooted($Relative)) { throw 'Manifest path must be relative.' }
    $prefix = [IO.Path]::GetFullPath($Root).TrimEnd('\') + '\'
    $path = [IO.Path]::GetFullPath((Join-Path $Root $Relative))
    if (-not $path.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase)) { throw 'Manifest path escapes the selected directory.' }
    return $path
}
function ClientCommand([string]$Action) {
    $info = New-Object Diagnostics.ProcessStartInfo
    $info.FileName = Join-Path $targetClient 'MES中控管理.exe'
    $info.Arguments = $Action
    $info.WorkingDirectory = $targetClient
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $process = [Diagnostics.Process]::Start($info)
    try {
        $out = $process.StandardOutput.ReadToEndAsync()
        $err = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit(25000)) { throw 'Client did not finish the update command.' }
        if ($process.ExitCode -ne 0) { throw ('Client command failed: ' + $err.Result) }
        if ($out.Result.Trim()) { return $out.Result | ConvertFrom-Json }
        return $null
    } finally { $process.Dispose() }
}
$manifest = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $sourceClient 'client-manifest.json') | ConvertFrom-Json
if ($manifest.format -ne 'mes-desktop-client' -or $manifest.module -ne 'central') { throw 'Source is not a central-client build.' }
if (-not (Test-Path -LiteralPath (Join-Path $targetClient 'MES中控管理.exe'))) { throw 'Target directory does not contain the installed client.' }
if ([IO.Path]::GetFullPath($sourceClient) -eq [IO.Path]::GetFullPath($targetClient)) { throw 'Source and target must be different directories.' }
$files = New-Object 'Collections.Generic.List[object]'
foreach ($entry in $manifest.files) {
    $source = ChildPath $sourceClient ([string]$entry.path)
    $target = ChildPath $targetClient ([string]$entry.path)
    if ((Get-Sha256 $source) -ne $entry.sha256) { throw ('Source SHA-256 mismatch: ' + $entry.path) }
    if ($entry.path -eq 'mes-client.json' -and (Test-Path -LiteralPath $target)) { continue }
    if (-not (Test-Path -LiteralPath $target) -or (Get-Sha256 $target) -ne $entry.sha256) {
        $files.Add([pscustomobject]@{source=$source;target=$target;existing=(Test-Path -LiteralPath $target)})
    }
}
foreach ($name in @('使用说明.md','本机验证记录.md','update_desktop_client.ps1','MES控制中心_本机测试.exe')) {
    $source = Join-Path $sourceRoot $name
    if (Test-Path -LiteralPath $source) {
        if ([IO.Path]::GetExtension($name) -eq '.exe') {
            $rootSourceManifest = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $sourceRoot 'combined-manifest.json') | ConvertFrom-Json
            $entry = @($rootSourceManifest.files | Where-Object { $_.path -eq $name })
            if ($entry.Count -ne 1 -or (Get-Sha256 $source) -ne $entry[0].sha256) { throw 'Control-center executable does not match the source manifest.' }
        }
        $target = ChildPath $targetRoot $name
        $files.Add([pscustomobject]@{source=$source;target=$target;existing=(Test-Path -LiteralPath $target)})
    }
}
$encoding = New-Object Text.UTF8Encoding($false)
$configPath = Join-Path $targetClient 'mes-client.json'
$configHash = if (Test-Path -LiteralPath $configPath) { Get-Sha256 $configPath } else { '' }
$wasRunning = (ClientCommand '--status').state -ne 'stopped'
$stamp = (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [Guid]::NewGuid().ToString('N').Substring(0,8)
$backup = Join-Path $targetRoot ('.client-updates/' + $stamp)
New-Item -ItemType Directory -Path $backup | Out-Null
$manifestPath = Join-Path $targetClient 'client-manifest.json'
$savedPaths = New-Object 'Collections.Generic.List[object]'
foreach ($file in $files) {
    $relative = $file.target.Substring($targetRoot.TrimEnd('\').Length + 1)
    $destination = ChildPath $backup $relative
    if ($file.existing) {
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination) | Out-Null
        Copy-Item -LiteralPath $file.target -Destination $destination
    }
    $savedPaths.Add([pscustomobject]@{target=$file.target;backup=$destination;existing=$file.existing})
}
foreach ($path in @($manifestPath,$configPath,(Join-Path $targetRoot 'combined-manifest.json'),(Join-Path $targetRoot 'local-manifest.json'))) {
    if (Test-Path -LiteralPath $path) {
        $copy = ChildPath $backup ($path.Substring($targetRoot.TrimEnd('\').Length + 1))
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $copy) | Out-Null
        Copy-Item -LiteralPath $path -Destination $copy -Force
    }
}
try {
    if ($wasRunning) { $null = ClientCommand '--close' }
    if ((ClientCommand '--status').state -ne 'stopped') { throw 'Client is still running; update aborted.' }
    foreach ($file in $files) {
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $file.target) | Out-Null
        Copy-Item -LiteralPath $file.source -Destination $file.target -Force
        if ((Get-Sha256 $file.source) -ne (Get-Sha256 $file.target)) { throw 'Copied file hash mismatch.' }
    }
    if ($configHash -and (Get-Sha256 $configPath) -ne $configHash) { throw 'Existing client configuration changed during update.' }
    foreach ($entry in $manifest.files) {
        $installed = ChildPath $targetClient ([string]$entry.path)
        $entry.sha256 = Get-Sha256 $installed
        $entry.bytes = (Get-Item -LiteralPath $installed).Length
    }
    [IO.File]::WriteAllText($manifestPath,($manifest | ConvertTo-Json -Depth 8),$encoding)
    foreach ($name in @('combined-manifest.json','local-manifest.json')) {
        $path = Join-Path $targetRoot $name
        if (Test-Path -LiteralPath $path) {
            $rootManifest = Get-Content -Raw -Encoding UTF8 -LiteralPath $path | ConvertFrom-Json
            $rootManifest.version = $manifest.version
            $installedControl = Join-Path $targetRoot 'MES控制中心_本机测试.exe'
            if (Test-Path -LiteralPath $installedControl) {
                $rootManifest | Add-Member -NotePropertyName controlCenterVersion -NotePropertyValue ([Diagnostics.FileVersionInfo]::GetVersionInfo($installedControl).FileVersion) -Force
            }
            foreach ($file in $files) {
                $relative = $file.target.Substring($targetRoot.TrimEnd('\').Length + 1).Replace('\','/')
                if (-not @($rootManifest.files | Where-Object { $_.path -eq $relative }).Count) {
                    $rootManifest.files = @($rootManifest.files) + @([pscustomobject]@{path=$relative;bytes=0;sha256=''})
                }
            }
            foreach ($entry in $rootManifest.files) {
                $installed = ChildPath $targetRoot ([string]$entry.path)
                if (Test-Path -LiteralPath $installed) { $entry.sha256=Get-Sha256 $installed; $entry.bytes=(Get-Item -LiteralPath $installed).Length }
            }
            [IO.File]::WriteAllText($path,($rootManifest | ConvertTo-Json -Depth 8),$encoding)
        }
    }
    $null = ClientCommand '--validate-config'
    $record = [ordered]@{version=$manifest.version;updatedAt=[DateTimeOffset]::Now.ToString('o');configPreserved=$true;previouslyRunning=$wasRunning;filesChanged=$files.Count;backup=$backup}
    $controlCenter = Join-Path $targetRoot 'MES控制中心_本机测试.exe'
    if (Test-Path -LiteralPath $controlCenter) { $record.controlCenterVersion = [Diagnostics.FileVersionInfo]::GetVersionInfo($controlCenter).FileVersion }
    [IO.File]::WriteAllText((Join-Path $backup 'update.json'),($record | ConvertTo-Json),$encoding)
} catch {
    foreach ($saved in $savedPaths) {
        if ($saved.existing) { Copy-Item -LiteralPath $saved.backup -Destination $saved.target -Force }
        elseif (Test-Path -LiteralPath $saved.target) { Remove-Item -LiteralPath (ChildPath $targetRoot ($saved.target.Substring($targetRoot.TrimEnd('\').Length + 1))) -Force }
    }
    foreach ($path in @($manifestPath,(Join-Path $targetRoot 'combined-manifest.json'),(Join-Path $targetRoot 'local-manifest.json'))) {
        $copy = ChildPath $backup ($path.Substring($targetRoot.TrimEnd('\').Length + 1))
        if (Test-Path -LiteralPath $copy) { Copy-Item -LiteralPath $copy -Destination $path -Force }
    }
    throw
}
if ($wasRunning -and $RestartIfRunning) {
    $info = New-Object Diagnostics.ProcessStartInfo
    $info.FileName = Join-Path $targetClient 'MES中控管理.exe'
    $info.WorkingDirectory = $targetClient
    $info.UseShellExecute = $true
    $process = [Diagnostics.Process]::Start($info)
    if ($process) { $process.Dispose() }
}
Write-Output ($record | ConvertTo-Json -Compress)
