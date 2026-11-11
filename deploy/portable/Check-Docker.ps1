param([Parameter(Mandatory=$true)][string]$OutputFile,[string]$DesktopExecutable='')
$ErrorActionPreference='Stop'
if($DesktopExecutable){$env:MES_DOCKER_DESKTOP_PATH=$DesktopExecutable}
. (Join-Path $PSScriptRoot 'Mes-PortableHost.ps1')
try {
    Wait-MesDockerEngine
    [IO.File]::WriteAllText($OutputFile,'Docker Linux 引擎已就绪。',(New-Object Text.UTF8Encoding($true)))
    exit 0
}catch{
    [IO.File]::WriteAllText($OutputFile,$_.Exception.Message,(New-Object Text.UTF8Encoding($true)))
    exit 1
}
