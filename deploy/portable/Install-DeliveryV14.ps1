[CmdletBinding()]
param([string]$PackageRoot=$PSScriptRoot,[Parameter(Mandatory=$true)][string]$InstallDirectory,
 [ValidateSet('server','client')][string]$Role='server',[Parameter(Mandatory=$true)][string]$ServerUrl,
 [string]$Workstations='',[switch]$CentralClient,[ValidateRange(0,20000)][int]$PortOffset=0,
 [string]$DesktopDirectory='',[string]$DockerDesktopPath='',[switch]$Resume,[switch]$ValidateOnly,[switch]$SkipRuntimeInstallation)
. (Join-Path $PSScriptRoot 'Mes-Installation.ps1')
[Console]::OutputEncoding=$script:MesUtf8
$root=Assert-MesRoot $InstallDirectory;$package=[IO.Path]::GetFullPath($PackageRoot)
$internal=Resolve-MesChild $root '.mes';$markerPath=Resolve-MesChild $root '.mes/installation.json'
$journal=Resolve-MesChild $root '.mes/logs/install-progress.log';$begun=$false
$installationLock=$null
function Copy-MesTree([string]$Source,[string]$Target){[IO.Directory]::CreateDirectory($Target)|Out-Null;Copy-Item -Path (Join-Path $Source '*') -Destination $Target -Recurse -Force}
function Set-ClientOrigin([string]$Directory){
    $path=Join-Path $Directory 'mes-client.json';$config=Read-MesJson $path;$config.serverUrl=$url;Write-MesJson $path $config
    $manifestPath=Join-Path $Directory 'client-manifest.json';$manifest=Read-MesJson $manifestPath
    foreach($item in $manifest.files){$file=Resolve-MesChild $Directory $item.path;$item.bytes=(Get-Item -LiteralPath $file).Length;$item.sha256=Get-MesHash $file}
    Write-MesJson $manifestPath $manifest
}
function Refresh-ComponentOrigins {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    Add-Type -AssemblyName System.IO.Compression
    $catalogPath=Join-Path $internal 'components/catalog.json';$library=Read-MesJson $catalogPath
    foreach($component in $library.components){
        if($component.kind -eq 'controller'){continue}
        $archive=Resolve-MesChild (Join-Path $internal 'components') $component.archive
        $zip=[IO.Compression.ZipFile]::Open($archive,[IO.Compression.ZipArchiveMode]::Update)
        try{
            $entry=$zip.GetEntry('mes-client.json');$reader=New-Object IO.StreamReader($entry.Open(),[Text.Encoding]::UTF8)
            try{$config=$reader.ReadToEnd()|ConvertFrom-Json}finally{$reader.Dispose()}
            $config.serverUrl=$url
            if($Role -eq 'server' -and $component.kind -eq 'central'){
                if($config.PSObject.Properties['limsUrl']){$config.limsUrl='http://127.0.0.1:'+(18900+$PortOffset)}
                if($config.PSObject.Properties['upperComputerUrl']){$config.upperComputerUrl='http://127.0.0.1:'+(18899+$PortOffset)}
            }
            $entry.Delete();$new=$zip.CreateEntry('mes-client.json');$stream=$new.Open();try{$data=$script:MesUtf8.GetBytes(($config|ConvertTo-Json -Depth 8));$stream.Write($data,0,$data.Length)}finally{$stream.Dispose()}
            $hash=[Security.Cryptography.SHA256]::Create();try{$digest=[BitConverter]::ToString($hash.ComputeHash($data)).Replace('-','').ToLowerInvariant()}finally{$hash.Dispose()}
            $configFile=@($component.files|Where-Object path -eq 'mes-client.json')[0];$configFile.bytes=$data.Length;$configFile.sha256=$digest
            $manifestEntry=$zip.GetEntry('client-manifest.json');$reader=New-Object IO.StreamReader($manifestEntry.Open(),[Text.Encoding]::UTF8)
            try{$client=$reader.ReadToEnd()|ConvertFrom-Json}finally{$reader.Dispose()}
            $configInventory=@($client.files|Where-Object path -eq 'mes-client.json')[0];$configInventory.bytes=$data.Length;$configInventory.sha256=$digest
            $manifestEntry.Delete();$new=$zip.CreateEntry('client-manifest.json');$stream=$new.Open();try{$data=$script:MesUtf8.GetBytes(($client|ConvertTo-Json -Depth 12));$stream.Write($data,0,$data.Length)}finally{$stream.Dispose()}
            $hash=[Security.Cryptography.SHA256]::Create();try{$digest=[BitConverter]::ToString($hash.ComputeHash($data)).Replace('-','').ToLowerInvariant()}finally{$hash.Dispose()}
            $manifestFile=@($component.files|Where-Object path -eq 'client-manifest.json')[0];$manifestFile.bytes=$data.Length;$manifestFile.sha256=$digest
        }finally{$zip.Dispose()}
        $component.sha256=Get-MesHash $archive
    }
    Write-MesJson $catalogPath $library
}
try{
    $uri=$null;if(-not [Uri]::TryCreate($ServerUrl,[UriKind]::Absolute,[ref]$uri) -or $uri.Scheme -notin @('http','https') -or $uri.UserInfo -or $uri.Query -or $uri.Fragment -or $uri.AbsolutePath -ne '/'){throw 'MES 地址应为 HTTP(S) 主机和端口。'}
    $url=$uri.GetLeftPart([UriPartial]::Authority)
    $manifest=Read-MesJson (Join-Path $package 'delivery-manifest.json')
    if($manifest.version -notmatch 'v1\.4$' -or $manifest.format -ne 'mes-portable-click-deployment'){throw '交付清单不是 v1.4。'}
    $catalog=Read-MesJson (Join-Path $package 'workstations.json');$requested=@($Workstations.Split(',')|Where-Object {$_})
    if(@($requested|Select-Object -Unique).Count -ne $requested.Count){throw '工位选择重复。'}
    $known=@($catalog|ForEach-Object {if($_.labCode){[string]$_.labCode}else{[string]$_.module}})
    foreach($id in $requested){if($id -cnotin $known){throw ('未知工位：'+$id)}}
    $selected=@($catalog|Where-Object {$id=if($_.labCode){[string]$_.labCode}else{[string]$_.module};$id -cin $requested})
    if($Role -eq 'client' -and -not $CentralClient -and $selected.Count -eq 0){throw '请至少选择一个客户端。'}
    $retainedPath=Resolve-MesChild $root '.mes/retained/record.json';$retained=$null
    if(Test-Path -LiteralPath $retainedPath){$retained=Read-MesJson $retainedPath;if($retained.version -ne $manifest.version -or $retained.root -ne $root){throw '保留数据的版本或路径不同，请先按原版本恢复或彻底卸载。'};if(-not $retained.reusable){throw '前次数据恢复未完成，请先检查日志，不能自动复用部分恢复的数据。'}}
    $previous=if(Test-Path -LiteralPath $markerPath){Read-MesJson $markerPath}else{$null}
    if($previous -and $previous.phase -eq 'complete' -and -not $Resume){throw '此目录已经安装。请先卸载，或使用控制中心补全组件。'}
    if($previous -and $previous.phase -eq 'complete' -and $Resume){Write-Output '安装已完成。';exit 0}
    if($previous -and $Resume -and ($previous.root -ne $root -or $previous.version -ne $manifest.version -or $previous.serverUrl -ne $url -or $previous.role -ne $Role -or $previous.workstations -ne $Workstations -or $previous.portOffset -ne $PortOffset -or $previous.centralClient -ne [bool]$CentralClient)){throw '续装选项与原安装不一致。'}
    if($ValidateOnly){Write-Output '安装选项有效。';exit 0}
    $installationLock=Enter-MesInstallationLock $root
    [IO.Directory]::CreateDirectory($internal)|Out-Null;Start-MesProgress $journal;$begun=$true;Set-MesProgress 2 '正在校验所选文件与运行组件'
    $hasRuntime=Test-MesWebViewRuntime
    foreach($item in $manifest.files){
        $relative=[string]$item.path;$needed=$relative -notmatch '/' -or $relative.StartsWith('entries/') -or $relative.StartsWith('component-cache/') -or $relative.StartsWith('prerequisites/')
        if($Role -eq 'server' -and ($relative.StartsWith($manifest.releaseDirectory+'/') -or $relative.StartsWith('desktop-tools/'))){$needed=$true}
        if($CentralClient -and $relative.StartsWith('desktop-tools/central-client/')){$needed=$true}
        foreach($station in $selected){if($relative.StartsWith('workstation-payload/'+$station.folder+'/')){$needed=$true}}
        # Large image archives are verified by Import; data is verified immediately before Restore.
        if($relative.EndsWith('/images.tar')){$needed=$false}
        if($relative.StartsWith('prerequisites/') -and ($hasRuntime -or $SkipRuntimeInstallation)){$needed=$false}
        if($needed){$file=Resolve-MesChild $package $relative;if(-not (Test-Path -LiteralPath $file) -or (Get-Item -LiteralPath $file).Length -ne $item.bytes -or (Get-MesHash $file) -cne $item.sha256){throw ('安装文件校验失败：'+$relative)}}
    }
    $id=if($previous){[string]$previous.installationId}elseif($retained){[string]$retained.installationId}else{[guid]::NewGuid().ToString('N')}
    if($id -notmatch '^[a-f0-9]{32}$'){throw '安装标识无效。'}
    $projectName='mes-5826-'+$id
    $marker=[pscustomobject]@{format='mes-installation';formatVersion=1;installationId=$id;root=$root;version=$manifest.version;role=$Role;serverUrl=$url;project=$projectName;workstations=$Workstations;centralClient=[bool]$CentralClient;desktopDirectory=$DesktopDirectory;portOffset=$PortOffset;dockerDesktopPath=$DockerDesktopPath;phase='installing';environment=('.mes/package/'+$manifest.releaseDirectory+'/.tmp/portable.env');release=('.mes/package/'+$manifest.releaseDirectory);desktopEntries=@();ports=@();volumes=@();ownedFiles=@()}
    Write-MesJson $markerPath $marker
    $resumeCommand='@echo off'+"`r`n"+'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0package\Resume-Install.ps1" -LaunchControlCenter'+"`r`n"+'pause'+"`r`n"
    [IO.File]::WriteAllText((Join-Path $internal '继续完成安装.cmd'),$resumeCommand,[Text.Encoding]::ASCII)
    Copy-Item -LiteralPath (Join-Path $package 'entries/卸载5826信息化系统.exe') -Destination (Join-Path $root '卸载5826信息化系统.exe') -Force
    if(-not $SkipRuntimeInstallation){
        $runtimeFound=$false
        foreach($registry in @('HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients','HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients','HKCU:\SOFTWARE\Microsoft\EdgeUpdate\Clients')){if(Test-Path $registry){foreach($key in Get-ChildItem $registry){$value=Get-ItemProperty $key.PSPath;if($value.PSObject.Properties['name'] -and $value.name -match 'WebView2' -and $value.PSObject.Properties['pv'] -and $value.pv -ne '0.0.0.0'){$runtimeFound=$true}}}}
        if(-not $runtimeFound){Invoke-MesProcess (Join-Path $package 'prerequisites/MicrosoftEdgeWebView2RuntimeInstallerX64.exe') @('/silent','/install') 300 -SuccessExitCodes @(0,3010)}
    }
    Copy-MesTree (Join-Path $package 'component-cache') $internal
    $installedIds=@();$entryRoles=@()
    if($Role -eq 'server'){
        $release=Resolve-MesChild $package $manifest.releaseDirectory;$environment=Resolve-MesChild $root $marker.environment
        . (Join-Path $release 'scripts/deploy/Mes-PortableHost.ps1')
        if($DockerDesktopPath){$env:MES_DOCKER_DESKTOP_PATH=$DockerDesktopPath}
        Wait-MesDockerEngine
        if($uri.Scheme -ne 'http' -or $uri.Port -lt 1024 -or $uri.Host -notin (@(Get-MesLanInterfaces|ForEach-Object Address)+@('127.0.0.1','localhost'))){throw '主机地址须使用本机网卡或 localhost，Web端口至少1024。'}
        if(-not (Test-Path -LiteralPath $environment)){
            if($retained){[IO.Directory]::CreateDirectory((Split-Path -Parent $environment))|Out-Null;Copy-Item -LiteralPath (Join-Path $internal 'retained/portable.env') -Destination $environment}
            else{Invoke-MesProcess 'powershell.exe' @('-NoProfile','-ExecutionPolicy','Bypass','-File',(Join-Path $release 'scripts/deploy/Mes-Portable.ps1'),'-Action','Initialize','-EnvFile',$environment,'-ReleaseVersion',$manifest.version) 30}
        }
        $text=[IO.File]::ReadAllText($environment)
        $text=Set-MesEnvironmentValue $text 'COMPOSE_PROJECT_NAME' $projectName;$text=Set-MesEnvironmentValue $text 'MES_PUBLIC_URL' $url;$text=Set-MesEnvironmentValue $text 'MES_WEB_PORT' ([string]$uri.Port)
        $text=Set-MesEnvironmentValue $text 'MES_NETWORK_MODE' 'manual';$text=Set-MesEnvironmentValue $text 'MES_BIND_ADDRESS' '0.0.0.0';$text=Set-MesEnvironmentValue $text 'MES_FRONTEND_ORIGINS' ($url+',http://127.0.0.1:'+$uri.Port+',http://localhost:'+$uri.Port)
        foreach($pair in @(@('MES_API_PORT',18000),@('MES_MYSQL_PORT',13306),@('MES_MQTT_PORT',11883),@('MES_RABBITMQ_MANAGEMENT_PORT',15673),@('MES_LIMS_PORT',18900),@('MES_UPPER_PORT',18899))){$text=Set-MesEnvironmentValue $text $pair[0] ([string]([int]$pair[1]+$PortOffset))}
        [IO.File]::WriteAllText($environment,$text,$script:MesUtf8)
        if($retained){
            foreach($volume in $retained.volumes){$metadata=(Invoke-MesProcess 'docker' @('volume','inspect',[string]$volume.name) 15 -Capture)|ConvertFrom-Json;if($metadata[0].Labels.'com.docker.compose.project' -ne $projectName){throw '保留数据卷缺失或身份不匹配。'}}
        }
        $compose=@('compose','--env-file',$environment,'-f',(Join-Path $release 'compose.portable.yml'),'-f',(Join-Path $release 'compose.portable.simulators.yml'),'--profile','simulators')
        $configuration=(Invoke-MesProcess 'docker' ($compose+@('config','--format','json')) 20 -Capture)|ConvertFrom-Json
        $marker.ports=@($configuration.services.PSObject.Properties|ForEach-Object {if($_.Value.PSObject.Properties['ports']){$_.Value.ports|ForEach-Object {[int]$_.published}}}|Select-Object -Unique)
        Write-MesJson $markerPath $marker
        Set-MesProgress 3 '导入离线镜像；相同镜像将自动复用'
        Invoke-MesProcess 'powershell.exe' @('-NoProfile','-ExecutionPolicy','Bypass','-File',(Join-Path $release 'scripts/deploy/Mes-Portable.ps1'),'-Action','Import','-OutputDirectory',$release) 900
        Set-MesProgress 4 $(if($retained){'检查并复用保留的业务数据'}else{'正在初始化并恢复业务数据，请等待实际结果'})
        $deploymentStatePath=Join-Path $internal 'deployment-state.json'
        $deploymentState=if(Test-Path -LiteralPath $deploymentStatePath){Read-MesJson $deploymentStatePath}else{[pscustomobject]@{installationId=$id;phase='imported'}}
        if($deploymentState.installationId -ne $id){throw '部署检查点不属于本次安装。'}
        if($deploymentState.phase -eq 'restoring'){throw '前次数据恢复未完成，请保留日志并检查，禁止覆盖部分恢复的数据。'}
        if($deploymentState.phase -eq 'imported'){
            if(-not $retained){
                $occupied=@([Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners()|Where-Object {$_.Port -in $marker.ports}|Select-Object -ExpandProperty Port -Unique)
                if($occupied.Count){throw ('目标端口已占用：'+($occupied -join ', '))}
                $deploymentState.phase='restoring';Write-MesJson $deploymentStatePath $deploymentState
                Invoke-MesProcess 'powershell.exe' @('-NoProfile','-ExecutionPolicy','Bypass','-File',(Join-Path $release 'scripts/deploy/Mes-Portable.ps1'),'-Action','Restore','-EnvFile',$environment,'-BackupDirectory',(Join-Path $package $manifest.backupDirectory)) 900
            }
            $deploymentState.phase='data-ready';Write-MesJson $deploymentStatePath $deploymentState
        }
        Set-MesProgress 5 '检查 Docker 服务健康和现场访问地址'
        Invoke-MesProcess 'powershell.exe' @('-NoProfile','-ExecutionPolicy','Bypass','-File',(Join-Path $release 'scripts/deploy/Mes-Portable.ps1'),'-Action','Start','-EnvFile',$environment) 360
        Invoke-MesProcess 'powershell.exe' @('-NoProfile','-ExecutionPolicy','Bypass','-File',(Join-Path $release 'scripts/deploy/Mes-Portable.ps1'),'-Action','Test','-EnvFile',$environment) 90
        $volumes=(Invoke-MesProcess 'docker' @('volume','ls','--filter',('label=com.docker.compose.project='+$projectName),'--format','{{.Name}}') 20 -Capture) -split '\r?\n'|Where-Object {$_}
        $marker.volumes=@($volumes|ForEach-Object {@{name=$_}})
        $management=Join-Path $package 'desktop-tools'
        Copy-Item -LiteralPath (Join-Path $management 'MES控制中心_Docker版.exe') -Destination (Join-Path $root 'MES控制中心.exe') -Force
        Copy-MesTree (Join-Path $management 'scripts') (Join-Path $internal 'scripts')
        Write-MesJson (Join-Path $internal 'mes-desktop-tools.json') @{deploymentMode='docker';deploymentDirectory=$release;environmentFile=$environment;mode='demo';serverUrl=$url;apiUrl=('http://127.0.0.1:'+(18000+$PortOffset));limsUrl=('http://127.0.0.1:'+(18900+$PortOffset));upperComputerUrl=('http://127.0.0.1:'+(18899+$PortOffset))}
        Copy-MesTree (Join-Path $management 'central-client') (Join-Path $root '中控管理')
        $centralPath=Join-Path $root '中控管理/mes-client.json';$central=Read-MesJson $centralPath
        if($central.PSObject.Properties['limsUrl']){$central.limsUrl='http://127.0.0.1:'+(18900+$PortOffset)}
        if($central.PSObject.Properties['upperComputerUrl']){$central.upperComputerUrl='http://127.0.0.1:'+(18899+$PortOffset)}
        Write-MesJson $centralPath $central
        $private=Join-Path $internal 'connection-info.txt'
        [IO.File]::WriteAllText($private,('MES: '+$url+"`r`n"+'Username: '+(Get-MesEnvironmentValue $text 'MES_LOGIN_USER')+"`r`n"+'Password: '+(Get-MesEnvironmentValue $text 'MES_LOGIN_PASSWORD')+"`r`n"),$script:MesUtf8)
        $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
        & icacls.exe $environment /inheritance:r /grant:r '*S-1-5-18:F' '*S-1-5-32-544:F' ('*'+$sid+':F') /Q|Out-Null
        if($LASTEXITCODE -ne 0){throw '安装凭据权限设置失败。'}
        & icacls.exe $private /inheritance:r /grant:r '*S-1-5-18:F' '*S-1-5-32-544:F' ('*'+$sid+':F') /Q|Out-Null
        if($LASTEXITCODE -ne 0){throw '连接说明权限设置失败。'}
        $installedIds+=@('controller','central');$entryRoles+=@('controller','central')
    }elseif($CentralClient){Copy-MesTree (Join-Path $package 'desktop-tools/central-client') (Join-Path $root '中控管理');$path=Join-Path $root '中控管理/mes-client.json';$config=Read-MesJson $path;if($config.PSObject.Properties['simulatorsEnabled']){$config.simulatorsEnabled=$false;Write-MesJson $path $config};$installedIds+='central';$entryRoles+='central'}
    Set-MesProgress 6 '生成桌面 EXE、工位组件和最终校验'
    if($Role -eq 'server' -or $CentralClient){Set-ClientOrigin (Join-Path $root '中控管理')}
    foreach($station in $selected){$destination=Resolve-MesChild $root ('工位终端/'+$station.folder);Copy-MesTree (Join-Path $package ('workstation-payload/'+$station.folder)) $destination;Set-ClientOrigin $destination;$installedIds+= $(if($station.labCode){[string]$station.labCode}else{[string]$station.module})}
    Refresh-ComponentOrigins
    Write-MesJson (Join-Path $internal 'installed-components.json') @($installedIds)
    if(-not $DesktopDirectory){$DesktopDirectory=[Environment]::GetFolderPath('Desktop')}
    [IO.Directory]::CreateDirectory($DesktopDirectory)|Out-Null
    foreach($entryRole in $entryRoles){$name=if($entryRole -eq 'controller'){'MES控制中心.exe'}else{'MES中控管理.exe'};$path=Join-Path $DesktopDirectory $name
        if(Test-Path -LiteralPath $path){$registration='HKLM:\SOFTWARE\5826MES\DesktopEntries\'+(Get-MesPathKey $path);if(-not (Test-Path $registration) -or (Get-ItemProperty $registration).root -ne $root){throw ('桌面已有其他安装或程序占用入口：'+$name)}}
        Copy-Item -LiteralPath (Join-Path $package ('entries/'+$name)) -Destination $path -Force;Register-MesDesktopEntry $path $root $id $entryRole
        $marker.desktopEntries+=@{path=$path;sha256=(Get-MesHash $path);role=$entryRole}
        Write-MesJson $markerPath $marker
    }
    Copy-Item -LiteralPath (Join-Path $package '先读我.md') -Destination (Join-Path $root '使用说明.md') -Force
    $marker.phase='complete';$marker.desktopDirectory=$DesktopDirectory
    $marker.ownedFiles=@(Get-ChildItem -LiteralPath $root -File -Recurse -Force|ForEach-Object {$_.FullName.Substring($root.Length+1).Replace('\','/')})
    Write-MesJson $markerPath $marker;Write-MesJson (Join-Path $root '安装记录.json') $marker
    $key='HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\MES5826-'+$id
    New-Item -Path $key -Force|Out-Null;New-ItemProperty -Path $key -Name DisplayName -Value '5826信息化交付v1.4' -Force|Out-Null
    New-ItemProperty -Path $key -Name UninstallString -Value ('"'+(Join-Path $root '卸载5826信息化系统.exe')+'"') -Force|Out-Null
    New-ItemProperty -Path $key -Name InstallLocation -Value $root -Force|Out-Null
    $item=Get-Item -LiteralPath $internal -Force;$item.Attributes=$item.Attributes -bor [IO.FileAttributes]::Hidden
    if($retained){$retainedDir=Resolve-MesChild $root '.mes/retained';Remove-Item -LiteralPath $retainedDir -Recurse -Force}
    Set-MesProgress 7 '安装完成，组件与服务已验证'
    Write-Output ('安装完成：'+$root)
}catch{
    $errorText=$_.Exception.Message
    if($begun){Set-MesProgress 0 ('安装失败：'+$errorText);[IO.Directory]::CreateDirectory((Join-Path $internal 'logs'))|Out-Null;[IO.File]::WriteAllText((Join-Path $internal 'logs/last-install-error.txt'),$errorText,$script:MesUtf8)}
    Write-Error $errorText -ErrorAction Continue;exit 1
}finally{if($begun){[MesInstallationProgress]::Stop()};if($null -ne $installationLock){$installationLock.ReleaseMutex();$installationLock.Dispose()}}
