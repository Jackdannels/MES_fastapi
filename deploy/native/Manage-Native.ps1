[CmdletBinding()]
param(
    [ValidateSet('verify','install','start','stop','restart','test','uninstall')] [string]$Action='verify',
    [string]$DataRoot='C:\ProgramData\MESNative',
    [string]$Instance='MESNative',
    [string]$PublicUrl='',
    [string]$BackupDirectory='',
    [int]$PortOffset=0,
    [switch]$NoSimulators
)
$ErrorActionPreference='Stop'
$program=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$arguments=@('-I','-X','utf8',(Join-Path $program 'native/native_manager.py'),$Action)
if($Action -eq 'install') {
    $arguments+=@('--data-root',$DataRoot,'--instance',$Instance,'--port-offset',[string]$PortOffset)
    if($PublicUrl) { $arguments+=@('--public-url',$PublicUrl) }
    if($BackupDirectory) { $arguments+=@('--backup',$BackupDirectory) }
    if($NoSimulators) { $arguments+='--no-simulators' }
} elseif($Action -ne 'verify') {
    $arguments+=@('--config',(Join-Path $DataRoot 'config/native.json'))
}
& (Join-Path $program 'runtime/python/python.exe') @arguments
if($LASTEXITCODE -ne 0) { throw ('Native action failed: '+$Action) }
