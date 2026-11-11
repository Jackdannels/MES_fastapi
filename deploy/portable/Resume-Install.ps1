param([switch]$LaunchControlCenter,[switch]$ElevatedWorker,[switch]$SkipRuntimeInstallation)
$ErrorActionPreference='Stop'
try {
    $package=[IO.Path]::GetFullPath($PSScriptRoot)
    $target=Split-Path -Parent $package
    $options=Get-Content -LiteralPath (Join-Path $target '安装选项.json') -Raw -Encoding UTF8|ConvertFrom-Json
    if($options.installDirectory -ne $target){throw '安装路径与原安装选项不符，请从原目录继续安装。'}
    $principal=New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    if($options.role -eq 'server' -and -not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){
        $process=Start-Process powershell.exe -Verb RunAs -ArgumentList ('-NoProfile -ExecutionPolicy Bypass -File "'+$PSCommandPath+'" -ElevatedWorker') -WindowStyle Hidden -PassThru
        $handle=$process.Handle;$process.WaitForExit();$process.Refresh();$code=$process.ExitCode
    }else{
        $arguments=@('-NoProfile','-ExecutionPolicy','Bypass','-File',(Join-Path $package 'Install-Delivery.ps1'),'-PackageRoot',$package,'-InstallDirectory',$target,'-Role',[string]$options.role,'-ServerUrl',[string]$options.serverUrl,'-PortOffset',[string]$options.portOffset,'-Resume')
        if($options.workstations){$arguments+=@('-Workstations',[string]$options.workstations)}
        if($options.centralClient){$arguments+='-CentralClient'}
        if($options.desktopDirectory){$arguments+=@('-DesktopDirectory',[string]$options.desktopDirectory)}
        if($options.PSObject.Properties['dockerDesktopPath'] -and $options.dockerDesktopPath){$arguments+=@('-DockerDesktopPath',[string]$options.dockerDesktopPath)}
        if($SkipRuntimeInstallation){$arguments+='-SkipRuntimeInstallation'}
        & powershell.exe @arguments
        $code=$LASTEXITCODE
    }
    if($code -ne 0){throw '安装尚未完成，请查看 package\.local\logs\last-install-error.txt 中的原因。'}
    if($LaunchControlCenter -and -not $ElevatedWorker -and $options.role -eq 'server'){
        Start-Process -FilePath (Join-Path $target '管理端/MES控制中心_Docker版.exe') -WindowStyle Normal|Out-Null
    }
    Write-Output '安装已完成，可直接打开控制中心或所选工位客户端。'
}catch{Write-Host $_.Exception.Message;exit 1}
