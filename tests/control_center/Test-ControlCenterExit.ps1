param([Parameter(Mandatory=$true)][string]$Executable, [Parameter(Mandatory=$true)][string]$TestDirectory)
$ErrorActionPreference='Stop'
New-Item -ItemType Directory -Path $TestDirectory -Force | Out-Null
# All service actions and clients belong to this temporary directory.
$fixture=Join-Path $TestDirectory 'native-service-control.ps1'
@'
param([string]$Action,[string]$ResultFile)
Add-Content -LiteralPath (Join-Path $PSScriptRoot 'actions.log') -Value $Action
Start-Sleep -Milliseconds 150
$mode=[IO.File]::ReadAllText((Join-Path $PSScriptRoot 'mode.txt')).Trim()
if($mode -eq 'error') {
    '{"status":"error","message":"intentional-stop-failure"}' | Set-Content -LiteralPath $ResultFile -Encoding UTF8
    exit 1
}
if($mode -eq 'wrong-status') {
    '{"status":"started","message":"not-stopped"}' | Set-Content -LiteralPath $ResultFile -Encoding UTF8
    exit 0
}
'{"status":"success","message":"native-stop-ok"}' | Set-Content -LiteralPath $ResultFile -Encoding UTF8
if($mode -eq 'bad-exit') { exit 7 }
'@ | Set-Content -LiteralPath $fixture -Encoding UTF8
$clientDirectory=Join-Path (Split-Path -Parent $Executable) 'central-client'
if(Test-Path -LiteralPath $clientDirectory) { throw 'Exit test requires a dedicated controller-only build directory.' }
New-Item -ItemType Directory -Path $clientDirectory | Out-Null
Add-Type -TypeDefinition @'
using System;
using System.IO;
public static class ExitFixtureClient {
    public static int Main(string[] args) {
        string root=AppDomain.CurrentDomain.BaseDirectory;
        File.AppendAllText(Path.Combine(root,"close.log"),String.Join(" ",args)+Environment.NewLine);
        return File.Exists(Path.Combine(root,"fail.flag")) ? 8 : 0;
    }
}
'@ -OutputAssembly (Join-Path $clientDirectory 'MES中控管理.exe') -OutputType ConsoleApplication
Add-Type -AssemblyName System.Windows.Forms
$assembly=[Reflection.Assembly]::LoadFrom($Executable)
$type=$assembly.GetType('MESControlCenter.ControlCenterForm',$true)
$flags=[Reflection.BindingFlags]'Instance,NonPublic'
$form=$type.GetConstructor($flags,$null,[Type[]]@([string],[bool]),$null).Invoke([object[]]@([string]$fixture,$false))
$sessionType=$assembly.GetType('MESControlCenter.MESBrowserSession',$true)
$session=$sessionType.GetConstructor($flags,$null,[Type[]]@([string],[string]),$null).Invoke([object[]]@([string]$TestDirectory,$null))
$type.GetField('browserSession',$flags).SetValue($form,$session)
$form.ShowInTaskbar=$false
$form.StartPosition=[Windows.Forms.FormStartPosition]::Manual
$form.Location=New-Object Drawing.Point(-10000,-10000)
function Field([string]$Name) { return $type.GetField($Name,$flags).GetValue($form) }
function SetField([string]$Name,$Value) { $type.GetField($Name,$flags).SetValue($form,$Value) }
function ActionCount { if(Test-Path -LiteralPath (Join-Path $TestDirectory 'actions.log')) { return @(Get-Content -LiteralPath (Join-Path $TestDirectory 'actions.log')).Count }; return 0 }
function AskToClose {
    $form.Close()
    [Windows.Forms.Application]::DoEvents()
    if($form.IsDisposed -or -not (Field 'modalOverlay').Visible) { throw 'Window closed without confirmation' }
    if((Field 'modalTitle').Text -ne '关闭系统并退出控制中心') { throw 'Wrong exit confirmation' }
    if($form.AcceptButton -ne (Field 'modalCancelButton') -or $form.CancelButton -ne (Field 'modalCancelButton')) { throw 'Exit confirmation must default to Cancel' }
}
function ConfirmAndWait {
    (Field 'modalConfirmButton').PerformClick()
    if(-not (Field 'exitRequested') -or -not (Field 'serviceBusy')) { throw 'Confirmed exit did not start Stop' }
    # A repeated close must not start another operation or skip the active one.
    $form.Close()
    $clock=[Diagnostics.Stopwatch]::StartNew()
    while(-not $form.IsDisposed -and (Field 'exitRequested')) {
        [Windows.Forms.Application]::DoEvents()
        if($clock.Elapsed.TotalSeconds -gt 12) { throw 'Exit operation timed out' }
        Start-Sleep -Milliseconds 10
    }
}
try {
    $form.Show()
    [Windows.Forms.Application]::DoEvents()
    AskToClose
    (Field 'modalCancelButton').PerformClick()
    if($form.IsDisposed -or (ActionCount) -ne 0 -or (Field 'modalOverlay').Visible) { throw 'Cancel changed services or closed the controller' }
    foreach($busy in @('serviceBusy','openCentralBusy')) {
        SetField $busy $true
        $form.Close()
        if($form.IsDisposed -or (Field 'modalOverlay').Visible -or (ActionCount) -ne 0) { throw 'Busy operation was interrupted by close' }
        SetField $busy $false
    }
    $attempt=0
    foreach($mode in @('error','bad-exit','wrong-status','interface-error','success')) {
        $attempt++
        [IO.File]::WriteAllText((Join-Path $TestDirectory 'mode.txt'),$mode)
        if($mode -eq 'interface-error') { [IO.File]::WriteAllText((Join-Path $clientDirectory 'fail.flag'),'fail') }
        else { [IO.File]::Delete((Join-Path $clientDirectory 'fail.flag')) }
        AskToClose
        if($mode -eq 'error') { SetField 'automaticRefresh' $true }
        ConfirmAndWait
        if((ActionCount) -ne $attempt) { throw 'Stop was not executed exactly once per confirmed attempt' }
        if(@(Get-Content -LiteralPath (Join-Path $TestDirectory 'actions.log') | Where-Object { $_ -ne 'Stop' }).Count) { throw 'Exit ran an unexpected service action' }
        if($mode -eq 'success') {
            if(-not $form.IsDisposed) { throw 'Successful Stop did not exit' }
        } else {
            if($form.IsDisposed -or -not (Field 'modalOverlay').Visible -or (Field 'exitAllowed')) { throw 'Failed Stop or interface close incorrectly exited' }
            if($mode -eq 'error') {
                if(-not (Field 'serviceStatusTimer').Enabled) { throw 'Failed exit did not restore health refresh' }
                SetField 'automaticRefresh' $false
                (Field 'serviceStatusTimer').Stop()
            }
            (Field 'modalConfirmButton').PerformClick()
        }
    }
    $closes=@(Get-Content -LiteralPath (Join-Path $clientDirectory 'close.log'))
    if($closes.Count -ne 2 -or @($closes | Where-Object { $_ -ne '--close' }).Count) { throw 'Managed client close routing failed' }
    Write-Output 'Exit checks passed: Cancel, busy guard, service failure, nonzero exit, wrong status, interface failure, retry, native success and single Stop per confirmation.'
} finally {
    $form.Dispose()
}
