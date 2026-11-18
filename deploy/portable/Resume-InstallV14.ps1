param([switch]$LaunchControlCenter,[switch]$SkipRuntimeInstallation)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'Mes-Installation.ps1')
$root=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$marker=Read-MesJson (Join-Path $root '.mes/installation.json')
if($marker.root -ne $root){throw '续装目录与安装记录不一致。'}
$arguments=@('-NoProfile','-ExecutionPolicy','Bypass','-File',(Join-Path $PSScriptRoot 'Install-Delivery.ps1'),'-PackageRoot',$PSScriptRoot,'-InstallDirectory',$root,'-Role',$marker.role,'-ServerUrl',$marker.serverUrl,'-Workstations',$marker.workstations,'-PortOffset',[string]$marker.portOffset,'-DesktopDirectory',$marker.desktopDirectory,'-Resume')
if($marker.centralClient){$arguments+='-CentralClient'}
if($marker.dockerDesktopPath){$arguments+=@('-DockerDesktopPath',$marker.dockerDesktopPath)}
if($SkipRuntimeInstallation){$arguments+='-SkipRuntimeInstallation'}
Invoke-MesProcess 'powershell.exe' $arguments 1200
if($LaunchControlCenter -and $marker.role -eq 'server'){Start-Process -FilePath (Join-Path $root 'MES控制中心.exe') -WindowStyle Normal|Out-Null}
