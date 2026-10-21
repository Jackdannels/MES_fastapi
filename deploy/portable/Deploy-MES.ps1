[CmdletBinding()]
param(
    [ValidateSet('Install','Desktop','Info','Verify')] [string]$Action='Install',
    [string]$EnvironmentFile='',
    [string]$DesktopDirectory='',
    [switch]$NoOpen
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$root=$PSScriptRoot
$runtime=Join-Path $root '.local'

function Get-Digest([string]$Path) {
    $stream=[IO.File]::OpenRead($Path)
    $algorithm=[Security.Cryptography.SHA256]::Create()
    try { return -join ($algorithm.ComputeHash($stream) | ForEach-Object { $_.ToString('x2') }) }
    finally {$stream.Dispose();$algorithm.Dispose()}
}
function Resolve-Payload([string]$Relative) {
    if (-not $Relative -or [IO.Path]::IsPathRooted($Relative) -or $Relative -match '(^|[\\/])\.\.([\\/]|$)|:') {throw 'Invalid delivery-relative path'}
    $path=[IO.Path]::GetFullPath((Join-Path $root $Relative))
    if (-not $path.StartsWith([IO.Path]::GetFullPath($root).TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Delivery path escaped root'}
    return $path
}
function Verify-Delivery($Manifest) {
    if($Manifest.format -ne 'mes-portable-click-deployment' -or $Manifest.format_version -ne 1){throw 'Unsupported delivery manifest'}
    foreach($file in $Manifest.files) {
        $path=Resolve-Payload ([string]$file.path)
        if(-not (Test-Path -LiteralPath $path -PathType Leaf)){throw ('Missing delivery file: '+$file.path)}
        if((Get-Item -LiteralPath $path).Length -ne $file.bytes -or (Get-Digest $path) -cne $file.sha256){throw ('Delivery checksum mismatch: '+$file.path)}
    }
}
function Read-Json([string]$Path) {return Get-Content -Raw -Encoding UTF8 -LiteralPath $Path | ConvertFrom-Json}
function Write-Json([string]$Path,$Value) {[IO.File]::WriteAllText($Path,($Value|ConvertTo-Json -Depth 10),(New-Object Text.UTF8Encoding($false)))}
function Invoke-Release([string]$Step,[string[]]$Extra=@()) {
    Write-Host ('MES deployment: '+$Step)
    $arguments=@('-NoProfile','-ExecutionPolicy','Bypass','-File',$entry,'-Action',$Step,'-EnvFile',$environment,'-Mode','demo')+$Extra
    $previous=$ErrorActionPreference
    try {$ErrorActionPreference='Continue'; & powershell.exe @arguments; $code=$LASTEXITCODE}finally{$ErrorActionPreference=$previous}
    if($code -ne 0){throw "MES deployment step $Step failed (exit $code). Inspect the deployment log; existing data is retained."}
}
function Get-Compose {
    $raw=& docker @compose config --format json
    if($LASTEXITCODE -ne 0){throw 'Cannot read the selected Compose environment'}
    return ($raw -join "`n"|ConvertFrom-Json)
}
function Protect-File([string]$Path) {
    $current=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    & icacls.exe $Path /inheritance:r /grant:r '*S-1-5-18:F' '*S-1-5-32-544:F' ('*'+$current+':F') /Q | Out-Null
    if($LASTEXITCODE -ne 0){throw 'Could not protect the installation credentials file'}
}
function Assert-NewTarget($Configuration,$State) {
    if($State){return}
    $volumes=@(& docker volume ls --filter ('label=com.docker.compose.project='+$Configuration.name) --format '{{.Name}}')
    if($LASTEXITCODE -ne 0){throw 'Could not inspect existing Docker data volumes'}
    if(@($volumes|Where-Object {$_}).Count){throw 'This Compose project already has data volumes. The one-click installer will not overwrite an existing deployment.'}
    $ports=@(foreach($service in $Configuration.services.PSObject.Properties){
        if($service.Value.PSObject.Properties['ports']){foreach($port in $service.Value.ports){[int]$port.published}}
    })
    $occupied=@([Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners()|Where-Object {$_.Port -in $ports}|Select-Object -ExpandProperty Port -Unique)
    if($occupied.Count){throw ('MES target ports are already occupied: '+($occupied -join ', ')+'. Stop the intended old deployment before installing this new instance.')}
}
function Install-DesktopTools {
    $destination=Join-Path $runtime 'desktop-tools'
    [IO.Directory]::CreateDirectory($destination)|Out-Null
    Copy-Item -Path (Join-Path $desktopPayload '*') -Destination $destination -Recurse -Force
    $configure=Join-Path $destination 'Configure-DesktopTools.ps1'
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $configure -DeploymentDirectory $release -EnvironmentFile $environment
    if($LASTEXITCODE -ne 0){throw 'Desktop connection configuration failed'}
    $config=Read-Json (Join-Path $destination 'mes-desktop-tools.json')
    $config | Add-Member -NotePropertyName deploymentMode -NotePropertyValue 'docker' -Force
    Write-Json (Join-Path $destination 'mes-desktop-tools.json') $config
    $desktop=$DesktopDirectory
    if(-not $desktop){$desktop=[Environment]::GetFolderPath('Desktop')}
    [IO.Directory]::CreateDirectory($desktop)|Out-Null
    $shell=New-Object -ComObject WScript.Shell
    foreach($tool in @(
        @{File='MES控制中心_Docker版.exe';Name='MES控制中心_v2.7_Docker版'},
        @{File='MES工作台设置_Docker版.exe';Name='MES工作台设置_Docker版'},
        @{File='MES终端管理_Docker版.exe';Name='MES终端管理_Docker版'})) {
        $executable=Join-Path $destination $tool.File
        $shortcut=$shell.CreateShortcut((Join-Path $desktop ($tool.Name+'.lnk')))
        $shortcut.TargetPath=$executable;$shortcut.WorkingDirectory=$destination;$shortcut.IconLocation=$executable+',0';$shortcut.Save()
    }
    Write-Host ('Three desktop programs are ready: '+$desktop)
}
function Write-ConnectionInfo {
    $text=[IO.File]::ReadAllText($environment)
    $url=Get-MesEnvironmentValue $text 'MES_PUBLIC_URL' 'http://127.0.0.1:15173'
    $user=Get-MesEnvironmentValue $text 'MES_LOGIN_USER' 'admin'
    $password=Get-MesEnvironmentValue $text 'MES_LOGIN_PASSWORD'
    $path=Join-Path $runtime 'MES-connection.txt'
    # Create/protect the file before writing credentials.
    if(-not (Test-Path -LiteralPath $path)){[IO.File]::WriteAllText($path,'')}
    Protect-File $path
    $content="MES URL: $url`r`nUsername: $user`r`nPassword: $password`r`n`r`nDeployment: $release`r`nEnvironment: $environment`r`n`r`nKeep this file private. Use the credentials above in the desktop tools.`r`n"
    [IO.File]::WriteAllText($path,$content,(New-Object Text.UTF8Encoding($true)))
    Write-Host ('MES URL: '+$url)
    Write-Host ('Private login information: '+$path)
    if(-not $NoOpen){Start-Process notepad.exe -ArgumentList ('"'+$path+'"')|Out-Null}
}

$transcript=$false
try {
    $manifest=Read-Json (Join-Path $root 'delivery-manifest.json')
    $release=Resolve-Payload ([string]$manifest.releaseDirectory)
    $backup=Resolve-Payload ([string]$manifest.backupDirectory)
    $desktopPayload=Resolve-Payload ([string]$manifest.desktopDirectory)
    $entry=Join-Path $release 'scripts/deploy/Mes-Portable.ps1'
    $environment=$EnvironmentFile
    if(-not $environment){$environment=Join-Path $release '.tmp/portable.env'}
    $environment=[IO.Path]::GetFullPath($environment)
    $principal=New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    if($Action -eq 'Install' -and -not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        $arguments='-NoProfile -ExecutionPolicy Bypass -File "'+$PSCommandPath+'" -Action Install -EnvironmentFile "'+$environment+'"'
        if($DesktopDirectory){$arguments+=' -DesktopDirectory "'+$DesktopDirectory+'"'}
        if($NoOpen){$arguments+=' -NoOpen'}
        $process=Start-Process powershell.exe -Verb RunAs -ArgumentList $arguments -WindowStyle Normal -PassThru
        $handle=$process.Handle;$process.WaitForExit();$process.Refresh();exit $process.ExitCode
    }
    [IO.Directory]::CreateDirectory($runtime)|Out-Null
    [IO.Directory]::CreateDirectory((Join-Path $runtime 'logs'))|Out-Null
    $log=Join-Path $runtime ('logs/deploy-'+(Get-Date -Format 'yyyyMMdd-HHmmss-fff')+'.log')
    Start-Transcript -LiteralPath $log -Force | Out-Null
    $transcript=$true
    if($Action -in @('Install','Verify','Desktop')){Write-Host 'Verifying delivery files...';Verify-Delivery $manifest}
    if($Action -eq 'Verify'){Write-Host 'Delivery checksums passed.';exit 0}
    . (Join-Path $release 'scripts/deploy/Mes-PortableHost.ps1')
    if($Action -eq 'Info') {
        if(-not (Test-Path -LiteralPath $environment)){throw 'Run 01-Deploy.cmd first'}
        Write-ConnectionInfo
        exit 0
    }
    if($Action -eq 'Desktop') {
        if(-not (Test-Path -LiteralPath $environment)){throw 'Run 01-Deploy.cmd first'}
        Install-DesktopTools
        exit 0
    }
    if(-not (Get-Command docker.exe -ErrorAction SilentlyContinue)){throw 'Install Docker Desktop with its Linux engine first, then run 01-Deploy.cmd again.'}
    Wait-MesDockerEngine
    if(-not (Test-Path -LiteralPath $environment)){
        Invoke-Release 'Initialize'
        $fresh=[IO.File]::ReadAllText($environment)
        $projectName='mes-portable-'+($manifest.version.ToLowerInvariant() -replace '[^a-z0-9-]','-')
        $fresh=Set-MesEnvironmentValue $fresh 'COMPOSE_PROJECT_NAME' $projectName
        [IO.File]::WriteAllText($environment,$fresh,(New-Object Text.UTF8Encoding($false)))
    }
    Protect-File $environment
    $compose=@('compose','--env-file',$environment,'-f',(Join-Path $release 'compose.portable.yml'),'-f',(Join-Path $release 'compose.portable.simulators.yml'),'--profile','simulators')
    $configuration=Get-Compose
    $statePath=Join-Path $runtime 'installation-state.json'
    $state=if(Test-Path -LiteralPath $statePath){Read-Json $statePath}else{$null}
    $backupDigest=Get-Digest (Join-Path $backup 'data-manifest.json')
    if($state -and ($state.version -ne $manifest.version -or $state.project -ne $configuration.name -or $state.backupDigest -ne $backupDigest -or $state.environment -ne $environment)) {
        throw 'Installation state does not match this release, source backup or environment. Existing data will not be replaced.'
    }
    if($state -and $state.phase -eq 'restoring'){throw 'A previous data restore did not finish. Keep its data/logs and inspect the failure before retrying; restoration over partial data is refused.'}
    Assert-NewTarget $configuration $state
    if(-not $state){$state=[pscustomobject]@{version=$manifest.version;project=$configuration.name;backupDigest=$backupDigest;environment=$environment;phase='prepared'};Write-Json $statePath $state}
    if($state.phase -eq 'prepared') {
        Invoke-Release 'Import' @('-OutputDirectory',$release)
        $state.phase='imported';Write-Json $statePath $state
    }
    if($state.phase -eq 'imported') {
        $state.phase='restoring';Write-Json $statePath $state
        Invoke-Release 'Restore' @('-BackupDirectory',$backup)
        $state.phase='data-ready';Write-Json $statePath $state
    }
    Invoke-Release 'Start'
    Invoke-Release 'Test'
    Install-DesktopTools
    $state.phase='complete';Write-Json $statePath $state
    Write-ConnectionInfo
    if(-not $NoOpen){
        $webConfig=Read-Json (Join-Path $runtime 'desktop-tools/mes-desktop-tools.json')
        $text=[IO.File]::ReadAllText($environment)
        $url=Get-MesEnvironmentValue $text 'MES_PUBLIC_URL' ([string]$webConfig.serverUrl)
        foreach($page in @($url,[string]$webConfig.limsUrl)){
            try{Start-Process -FilePath $page | Out-Null}
            catch{Write-Warning ('服务已就绪，请手动打开页面：'+$page)}
        }
    }
    Write-Host 'MES installation completed. Use the three desktop shortcuts.'
} catch {
    Write-Host ('DEPLOYMENT FAILED: '+$_.Exception.Message) -ForegroundColor Red
    Write-Host 'Existing images and data volumes were retained. Read .local/logs for details.'
    exit 1
} finally {if($transcript){Stop-Transcript | Out-Null}}
