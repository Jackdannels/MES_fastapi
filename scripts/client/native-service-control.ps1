[CmdletBinding()]
param([ValidateSet('Status','Start','Stop','Restart')] [string]$Action='Status', [string]$ResultFile='')
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
function Result([string]$Status,[string]$Message) {
    $json=@{status=$Status;message=$Message} | ConvertTo-Json -Compress
    if($ResultFile) { [IO.File]::WriteAllText($ResultFile,$json,(New-Object Text.UTF8Encoding($false))) }
    Write-Output $json
}
try {
    $settings=Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $root 'mes-desktop-tools.json') | ConvertFrom-Json
    if($settings.deploymentMode -ne 'windows-service') { throw 'Desktop configuration is not a native Windows installation' }
    if($Action -eq 'Status') {
        $r=Invoke-RestMethod -Uri ($settings.apiUrl+'/health/ready') -TimeoutSec 5
        if($r.status -ne 'ready') { throw 'MES API is not ready' }
        Result 'running' 'MES 原生服务已就绪'
        exit 0
    }
    $principal=New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    if(-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        $arguments='-NoProfile -ExecutionPolicy Bypass -File "'+$PSCommandPath+'" -Action '+$Action+' -ResultFile "'+$ResultFile+'"'
        $process=Start-Process -FilePath powershell.exe -Verb RunAs -ArgumentList $arguments -PassThru -WindowStyle Hidden
        $handle=$process.Handle
        $process.WaitForExit(); $process.Refresh()
        exit $process.ExitCode
    }
    $program=[IO.Path]::GetFullPath([string]$settings.programRoot)
    $python=Join-Path $program 'runtime/python/python.exe'
    $manager=Join-Path $program 'native/native_manager.py'
    $log=Join-Path $env:TEMP ('mes-native-control-'+[Guid]::NewGuid().ToString('N')+'.log')
    & $python -I -X utf8 $manager $Action.ToLowerInvariant() --config $settings.nativeConfig *> $log
    if($LASTEXITCODE -ne 0) { throw ('原生服务操作失败，诊断日志：'+$log) }
    Result 'success' 'MES 原生服务操作完成'
} catch {
    Result 'error' $_.Exception.Message
    exit 1
}
