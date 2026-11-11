# Installer boundary: select already compiled clients and configure this PC.
[CmdletBinding()]
param(
    [string]$PackageRoot=$PSScriptRoot,
    [Parameter(Mandatory=$true)][string]$InstallDirectory,
    [ValidateSet('server','client')][string]$Role='server',
    [Parameter(Mandatory=$true)][string]$ServerUrl,
    [string]$Workstations='',
    [switch]$CentralClient,
    [ValidateRange(0,20000)][int]$PortOffset=0,
    [string]$DesktopDirectory='',
    [string]$DockerDesktopPath='',
    [switch]$ValidateOnly,
    [switch]$Resume,
    [switch]$SkipRuntimeInstallation
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$package=[IO.Path]::GetFullPath($PackageRoot).TrimEnd('\')
$target=[IO.Path]::GetFullPath($InstallDirectory).TrimEnd('\')
$encoding=New-Object Text.UTF8Encoding($false)
$stage='参数检查'
$transcriptStarted=$false
$installLog=''
$errorFile=Join-Path $package '.local/logs/last-install-error.txt'

function Read-Json([string]$Path){Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json}
function Write-Json([string]$Path,$Value){[IO.File]::WriteAllText($Path,($Value|ConvertTo-Json -Depth 15),$encoding)}
function Resolve-Child([string]$Base,[string]$Relative){
    if(-not $Relative -or [IO.Path]::IsPathRooted($Relative) -or $Relative -match '(^|[\\/])\.\.?([\\/]|$)|:'){throw '安装清单包含无效路径。'}
    $path=[IO.Path]::GetFullPath((Join-Path $Base $Relative))
    if(-not $path.StartsWith($Base.TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase)){throw '安装路径超出目标目录。'}
    $current=$path
    while($current -and $current -ne $Base){
        if(Test-Path -LiteralPath $current){if((Get-Item -LiteralPath $current -Force).Attributes -band [IO.FileAttributes]::ReparsePoint){throw '安装目录不能包含链接或重解析点。'}}
        $current=Split-Path -Parent $current
    }
    return $path
}
function Get-Digest([string]$Path){
    $stream=[IO.File]::OpenRead($Path);$algorithm=[Security.Cryptography.SHA256]::Create()
    try{return -join ($algorithm.ComputeHash($stream)|ForEach-Object {$_.ToString('x2')})}finally{$stream.Dispose();$algorithm.Dispose()}
}
function New-Shortcut([string]$Name,[string]$Executable){
    $desktop=$DesktopDirectory
    if(-not $desktop){$desktop=[Environment]::GetFolderPath('Desktop')}
    [IO.Directory]::CreateDirectory($desktop)|Out-Null
    $shell=New-Object -ComObject WScript.Shell
    $shortcut=$shell.CreateShortcut((Join-Path $desktop ($Name+'.lnk')))
    $shortcut.TargetPath=$Executable;$shortcut.WorkingDirectory=Split-Path -Parent $Executable
    $shortcut.IconLocation=$Executable+',0';$shortcut.Save()
}
function Update-Client([string]$Directory,[string]$Url){
    $path=Join-Path $Directory 'mes-client.json'
    $config=Read-Json $path;$config.serverUrl=$Url
    Write-Json $path $config
    $manifestPath=Join-Path $Directory 'client-manifest.json'
    $manifest=Read-Json $manifestPath
    foreach($file in $manifest.files){$full=Resolve-Child $Directory ([string]$file.path);$file.bytes=(Get-Item -LiteralPath $full).Length;$file.sha256=Get-Digest $full}
    Write-Json $manifestPath $manifest
}
function Install-WebViewRuntime {
    foreach($registry in @('HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients','HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients','HKCU:\SOFTWARE\Microsoft\EdgeUpdate\Clients')){
        if(Test-Path $registry){foreach($key in Get-ChildItem $registry){$item=Get-ItemProperty $key.PSPath;if($item.PSObject.Properties['name'] -and $item.name -match 'WebView2' -and $item.PSObject.Properties['pv'] -and $item.pv -ne '0.0.0.0'){return}}}
    }
    $runtime=Join-Path $package 'prerequisites/MicrosoftEdgeWebView2RuntimeInstallerX64.exe'
    $process=Start-Process -FilePath $runtime -ArgumentList '/silent /install' -PassThru -WindowStyle Hidden
    $handle=$process.Handle;$process.WaitForExit();$process.Refresh()
    if($process.ExitCode -notin @(0,3010)){throw ('WebView2 离线安装失败，退出码：'+$process.ExitCode)}
}

try {
    if(-not $ValidateOnly){
        $logDirectory=Join-Path $package '.local/logs'
        [IO.Directory]::CreateDirectory($logDirectory)|Out-Null
        $installLog=Join-Path $logDirectory ('install-'+(Get-Date -Format 'yyyyMMdd-HHmmss-fff')+'.log')
        Start-Transcript -LiteralPath $installLog -Force|Out-Null
        $transcriptStarted=$true
    }
    $uri=$null
    if(-not [Uri]::TryCreate($ServerUrl,[UriKind]::Absolute,[ref]$uri) -or $uri.Scheme -notin @('http','https') -or $uri.UserInfo -or $uri.Query -or $uri.Fragment -or $uri.AbsolutePath -ne '/') {throw 'MES 地址必须是 HTTP(S) 主机地址与端口，不含账号或页面路径。'}
    $url=$uri.GetLeftPart([UriPartial]::Authority)
    if($target -eq [IO.Path]::GetPathRoot($target).TrimEnd('\')){throw '请选择独立的安装文件夹。'}
    $manifest=Read-Json (Join-Path $package 'delivery-manifest.json')
    if($manifest.format -ne 'mes-portable-click-deployment' -or $manifest.format_version -ne 1){throw '不支持的交付清单。'}
    $stage='安装文件校验'
    if($DockerDesktopPath){if(-not (Test-Path -LiteralPath $DockerDesktopPath -PathType Leaf)){throw '指定的 Docker Desktop.exe 不存在。'};$env:MES_DOCKER_DESKTOP_PATH=$DockerDesktopPath}
    $catalog=Read-Json (Join-Path $package 'workstations.json')
    $requested=@($Workstations.Split(',')|Where-Object {$_})
    $known=@($catalog|ForEach-Object {if($_.labCode){[string]$_.labCode}else{[string]$_.module}})
    if(@($requested|Select-Object -Unique).Count -ne $requested.Count){throw '工位选择重复。'}
    foreach($id in $requested){if($id -cnotin $known){throw ('未知工位：'+$id)}}
    $selected=@($catalog|Where-Object {$id=if($_.labCode){[string]$_.labCode}else{[string]$_.module};$id -cin $requested})
    if($Role -eq 'client' -and -not $CentralClient -and $selected.Count -eq 0){throw '请至少选择一个客户端。'}
    $required=New-Object 'Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    foreach($file in $manifest.files){
        $relative=[string]$file.path
        $needed=$relative -notmatch '/'
        if($Role -eq 'server' -and ($relative.StartsWith($manifest.releaseDirectory+'/') -or $relative.StartsWith($manifest.backupDirectory+'/') -or $relative.StartsWith('desktop-tools/'))){$needed=$true}
        if($CentralClient -and $relative.StartsWith('desktop-tools/central-client/')){$needed=$true}
        if($relative.StartsWith('prerequisites/')){$needed=$true}
        foreach($station in $selected){if($relative.StartsWith('workstation-payload/'+$station.folder+'/')){$needed=$true}}
        if($needed){
            if(-not $required.Add($relative)){throw '清单包含重复文件。'}
            $path=Resolve-Child $package $relative
            if(-not (Test-Path -LiteralPath $path -PathType Leaf) -or (Get-Item -LiteralPath $path).Length -ne $file.bytes -or (Get-Digest $path) -cne $file.sha256){throw ('安装文件校验失败：'+$relative)}
        }
    }
    foreach($station in $selected){
        if(-not $required.Contains('workstation-payload/'+$station.folder+'/client-manifest.json')){throw '交付清单缺少选中工位。'}
        $destination=Resolve-Child $target ('工位客户端/'+$station.folder)
        if((Test-Path -LiteralPath $destination) -and -not $Resume){throw ('工位目录已存在，请选择新的安装目录：'+$station.folder)}
    }
    if($Role -eq 'server'){
        . (Join-Path (Resolve-Child $package ([string]$manifest.releaseDirectory)) 'scripts/deploy/Mes-PortableHost.ps1')
        if($uri.Scheme -ne 'http' -or $uri.Port -lt 1024){throw 'Docker 主机请使用 HTTP 地址和 1024 以上的 Web 端口。'}
        $addresses=@(Get-MesLanInterfaces|ForEach-Object {$_.Address})+@('127.0.0.1','localhost')
        if($uri.Host -notin $addresses){throw '主机安装地址必须是本机当前有线/Wi-Fi IPv4 或 localhost；工位安装请切换为客户端类型。'}
    }
    if($ValidateOnly){Write-Output (@{status='validated';role=$Role;serverUrl=$url;workstations=$requested;files=$required.Count}|ConvertTo-Json -Compress);exit 0}
    $optionsPath=Join-Path $target '安装选项.json'
    if($Resume){
        if(-not (Test-Path -LiteralPath $optionsPath)){throw '未找到原安装选项，请使用完整安装程序选择新的目录。'}
        $previous=Read-Json $optionsPath
        if($previous.version -ne $manifest.version -or $previous.role -ne $Role -or $previous.serverUrl -ne $url -or $previous.workstations -ne $Workstations -or $previous.portOffset -ne $PortOffset -or $previous.centralClient -ne [bool]$CentralClient -or $previous.installDirectory -ne $target){throw '续装参数与原安装选项不一致，已保留原配置。'}
        if(Test-Path -LiteralPath (Join-Path $target '安装记录.json')){Write-Output '安装已完成，请直接打开控制中心或客户端。';exit 0}
    }
    [IO.Directory]::CreateDirectory($target)|Out-Null
    Write-Json $optionsPath @{version=$manifest.version;role=$Role;serverUrl=$url;workstations=$Workstations;portOffset=$PortOffset;centralClient=[bool]$CentralClient;desktopDirectory=$DesktopDirectory;dockerDesktopPath=$DockerDesktopPath;installDirectory=$target}
    $resumeCommand='@echo off'+"`r`n"+'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0package\Resume-Install.ps1" -LaunchControlCenter'+"`r`n"+'set "MES_EXIT_CODE=%ERRORLEVEL%"'+"`r`n"+'pause'+"`r`n"+'exit /b %MES_EXIT_CODE%'+"`r`n"
    [IO.File]::WriteAllText((Join-Path $target '继续完成安装.cmd'),$resumeCommand,[Text.Encoding]::ASCII)
    $stage='WebView2 运行环境检查'
    if(-not $SkipRuntimeInstallation){Install-WebViewRuntime}
    if($Role -eq 'server'){
        $release=Resolve-Child $package ([string]$manifest.releaseDirectory)
        $environment=Join-Path $release '.tmp/portable.env'
        $stage='Docker Linux 引擎检查'
        Wait-MesDockerEngine
        $stage='生成或恢复本机配置'
        if(Test-Path -LiteralPath $environment){
            if(-not $Resume){throw '目标已初始化，请双击“继续完成安装.cmd”。'}
            $existing=[IO.File]::ReadAllText($environment)
            if((Get-MesEnvironmentValue $existing 'MES_PUBLIC_URL') -ne $url -or (Get-MesEnvironmentValue $existing 'MES_RELEASE_VERSION') -ne $manifest.version){throw '已有环境文件与本次安装不一致，已保留原配置。'}
        }else{
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $release 'scripts/deploy/Mes-Portable.ps1') -Action Initialize -EnvFile $environment -ReleaseVersion $manifest.version
        if($LASTEXITCODE -ne 0){throw '生成目标配置失败。'}
        $text=[IO.File]::ReadAllText($environment)
        $text=Set-MesEnvironmentValue $text 'MES_NETWORK_MODE' 'manual'
        $text=Set-MesEnvironmentValue $text 'MES_PUBLIC_URL' $url
        $text=Set-MesEnvironmentValue $text 'MES_WEB_PORT' ([string]$uri.Port)
        foreach($item in @(@('MES_API_PORT',18000),@('MES_MYSQL_PORT',13306),@('MES_RABBITMQ_MANAGEMENT_PORT',15673),@('MES_MQTT_PORT',11883),@('MES_LIMS_PORT',18900),@('MES_UPPER_PORT',18899))){
            $text=Set-MesEnvironmentValue $text ([string]$item[0]) ([string]([int]$item[1]+$PortOffset))
        }
        $text=Set-MesEnvironmentValue $text 'MES_BIND_ADDRESS' '0.0.0.0'
        $text=Set-MesEnvironmentValue $text 'MES_FRONTEND_ORIGINS' ($url+',http://127.0.0.1:'+$uri.Port+',http://localhost:'+$uri.Port)
        $text=Set-MesEnvironmentValue $text 'COMPOSE_PROJECT_NAME' ('mes-5826-'+($manifest.version.ToLowerInvariant() -replace '[^a-z0-9-]','-'))
        [IO.File]::WriteAllText($environment,$text,$encoding)
        }
        if($DockerDesktopPath){
            $text=Set-MesEnvironmentValue ([IO.File]::ReadAllText($environment)) 'MES_DOCKER_DESKTOP_PATH' $DockerDesktopPath
            [IO.File]::WriteAllText($environment,$text,$encoding)
        }
        $management=Join-Path $target '管理端'
        $stage='导入镜像、恢复数据并启动服务'
        $arguments=@('-NoProfile','-ExecutionPolicy','Bypass','-File',(Join-Path $package 'Deploy-MES.ps1'),'-Action','Install','-NoOpen','-SelectedComponentsOnly','-EnvironmentFile',$environment,'-DesktopToolsDirectory',$management)
        if($DesktopDirectory){$arguments+=@('-DesktopDirectory',$DesktopDirectory)}
        & powershell.exe @arguments
        if($LASTEXITCODE -ne 0){
            $deploymentLogs=@(Get-ChildItem -LiteralPath (Join-Path $package '.local/logs') -Filter 'deploy-*.log' -File|Sort-Object LastWriteTime -Descending)
            $reason='MES 服务部署失败。'
            if($deploymentLogs.Count -gt 0){$line=Select-String -LiteralPath $deploymentLogs[0].FullName -Pattern '^DEPLOYMENT FAILED:'|Select-Object -Last 1;if($line){$reason=$line.Line -replace '^DEPLOYMENT FAILED:\s*',''}}
            throw $reason
        }
        Update-Client (Join-Path $management 'central-client') $url
        Set-MesWebFirewall ('mes-5826-'+($manifest.version.ToLowerInvariant() -replace '[^a-z0-9-]','-')) $uri.Port
    } elseif($CentralClient){
        $destination=Resolve-Child $target '管理端/central-client'
        if((Test-Path -LiteralPath $destination) -and -not $Resume){throw '中控目录已存在，请选择新的安装目录。'}
        [IO.Directory]::CreateDirectory((Split-Path -Parent $destination))|Out-Null
        if(-not (Test-Path -LiteralPath $destination)){Copy-Item -LiteralPath (Join-Path $package 'desktop-tools/central-client') -Destination $destination -Recurse}
        Update-Client $destination $url
        # A remote central client opens only MES; simulator management is local.
        $path=Join-Path $destination 'mes-client.json';$config=Read-Json $path
        if($config.PSObject.Properties['simulatorsEnabled']){$config.simulatorsEnabled=$false;Write-Json $path $config;Update-Client $destination $url}
        New-Shortcut 'MES中控管理' (Join-Path $destination 'MES中控管理.exe')
    }
    $installed=@()
    $stage='生成所选工位与快捷方式'
    foreach($station in $selected){
        $source=Resolve-Child $package ('workstation-payload/'+$station.folder)
        $destination=Resolve-Child $target ('工位客户端/'+$station.folder)
        [IO.Directory]::CreateDirectory((Split-Path -Parent $destination))|Out-Null
        if(-not (Test-Path -LiteralPath $destination)){Copy-Item -LiteralPath $source -Destination $destination -Recurse}
        Update-Client $destination $url
        $client=Read-Json (Join-Path $destination 'client-manifest.json')
        New-Shortcut ([string]$station.folder) (Resolve-Child $destination ([string]$client.executable))
        $installed+=@{folder=$station.folder;module=$station.module;labCode=$station.labCode;executable=$client.executable;serverUrl=$url}
    }
    Write-Json (Join-Path $target '安装记录.json') @{displayName=$manifest.displayName;version=$manifest.version;role=$Role;serverUrl=$url;installedAt=(Get-Date).ToString('o');workstations=$installed}
    if(Test-Path -LiteralPath $errorFile){[IO.File]::Delete($errorFile)}
    Write-Output ('安装完成：'+$target)
}catch{
    $message='安装步骤：'+$stage+"`r`n"+'失败原因：'+$_.Exception.Message+"`r`n"+'日志：'+$installLog+"`r`n"+'处理后可双击安装目录中的“继续完成安装.cmd”。'
    try{[IO.Directory]::CreateDirectory((Split-Path -Parent $errorFile))|Out-Null;[IO.File]::WriteAllText($errorFile,$message,(New-Object Text.UTF8Encoding($true)))}catch{}
    Write-Host $message
    exit 1
}finally{if($transcriptStarted){Stop-Transcript|Out-Null}}
