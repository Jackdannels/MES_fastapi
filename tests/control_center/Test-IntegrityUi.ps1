param([Parameter(Mandatory=$true)][string]$Executable,[Parameter(Mandatory=$true)][string]$Bundle,[Parameter(Mandatory=$true)][string]$TestDirectory)
$ErrorActionPreference='Stop'
trap{Write-Output $_.ScriptStackTrace;throw $_.Exception}
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$assembly=[Reflection.Assembly]::LoadFrom($Executable);$flags=[Reflection.BindingFlags]'Instance,NonPublic,Public'
$root=[IO.Path]::GetFullPath($TestDirectory)
if(Test-Path -LiteralPath $root){throw 'Use a new isolated UI fixture directory'}
New-Item -ItemType Directory -Path (Join-Path $root '.mes') -Force|Out-Null
Copy-Item -LiteralPath (Join-Path $Bundle '.mes/components') -Destination (Join-Path $root '.mes/components') -Recurse
Copy-Item -LiteralPath (Join-Path $Bundle '.mes/installed-components.json') -Destination (Join-Path $root '.mes/installed-components.json')
$type=$assembly.GetType('MESControlCenter.ComponentIntegrityPage',$true)
$arguments=New-Object object[] 2;$arguments.SetValue($root,0);$arguments.SetValue([Func[bool]]{$false},1)
$page=$type.GetConstructor($flags,$null,[Type[]]@([string],[Func[bool]]),$null).Invoke($arguments)
$window=New-Object Windows.Forms.Form;$window.Size=New-Object Drawing.Size(1100,750);$window.ShowInTaskbar=$false;$window.StartPosition='Manual';$window.Location=New-Object Drawing.Point(-10000,-10000);$window.Controls.Add($page)
function Pump($Task){$clock=[Diagnostics.Stopwatch]::StartNew();while(-not $Task.IsCompleted){[Windows.Forms.Application]::DoEvents();if($clock.Elapsed.TotalSeconds -gt 20){throw 'UI operation did not finish'};Start-Sleep -Milliseconds 10};$null=$Task.GetAwaiter().GetResult()}
function Field([string]$Name){$type.GetField($Name,$flags).GetValue($page)}
function Row([string]$Id){@( (Field 'grid').Rows|Where-Object {$item=$_.Tag;$definition=$item.GetType().GetField('Component',$flags).GetValue($item);$definition.GetType().GetField('id',$flags).GetValue($definition) -eq $Id})[0]}
Add-Type -ReferencedAssemblies System.Windows.Forms -TypeDefinition @'
using System;
using System.Windows.Forms;
public static class IntegrityDialogDriver {
 private static Timer timer;
 public static void Start() {
   timer=new Timer { Interval=30 };
   timer.Tick+=delegate {
     foreach(Form dialog in Application.OpenForms) if(dialog.Text=="确认补全组件") {
       timer.Stop();dialog.DialogResult=DialogResult.OK;dialog.Close();return;
     }
   };
   timer.Start();
 }
 public static void Stop() { if(timer!=null){timer.Stop();timer.Dispose();timer=null;} }
}
'@
try{
    $window.Show();[Windows.Forms.Application]::DoEvents();Pump ($type.GetMethod('CheckAsync',$flags).Invoke($page,@($true)))
    $row=Row 'LAB_SALT';$row.Cells['Selected'].Value=$true
    [IntegrityDialogDriver]::Start();Pump ($type.GetMethod('RepairSelected',$flags).Invoke($page,@()))
    if(-not (Test-Path -LiteralPath (Join-Path $root '工位终端/盐雾试验室/MES盐雾试验室.exe'))){throw 'Selected checkbox did not restore the workstation'}
    if((Row 'LAB_SALT').Cells['Status'].Value -ne '完整'){throw 'UI did not verify the repaired component'}
    if(Test-Path -LiteralPath (Join-Path $root '工位终端/冲击一室')){throw 'UI installed an unselected component'}
    if($type.GetProperty('Busy',$flags).GetValue($page,$null) -or $type.GetProperty('Repairing',$flags).GetValue($page,$null)){throw 'UI remained busy after repair'}
    if(-not (Field 'detail').Text.Contains('补全完成')){throw 'UI omitted the per-component result'}
    Write-Output 'Integrity UI regression passed: select one component, confirmation, asynchronous repair, verification, untouched unselected components and released busy state.'
}finally{[IntegrityDialogDriver]::Stop();$window.Dispose()}
