param([Parameter(Mandatory=$true)][string]$Executable,[Parameter(Mandatory=$true)][string]$Config,[Parameter(Mandatory=$true)][string]$OutputFile)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
$assembly=[Reflection.Assembly]::LoadFrom($Executable)
$flags=[Reflection.BindingFlags]'Instance,NonPublic,Public'
$static=[Reflection.BindingFlags]'Static,NonPublic,Public'
$configType=$assembly.GetType('MESDesktopClient.ClientConfiguration',$true)
$formType=$assembly.GetType('MESDesktopClient.ClientForm',$true)
$instanceType=$assembly.GetType('MESDesktopClient.ClientInstance',$true)
$configArguments=New-Object object[] 2;$configArguments.SetValue([string[]]@('--config',$Config,'--test-hidden'),0);$configArguments.SetValue($false,1)
$configuration=$configType.GetMethod('Load',$static).Invoke($null,$configArguments)
$owner=$instanceType.GetConstructor($flags,$null,[Type[]]@($configType,[bool]),$null).Invoke([object[]]@($configuration,$false))
$form=$formType.GetConstructor($flags,$null,[Type[]]@($configType,$instanceType),$null).Invoke([object[]]@($configuration,$owner))
$script:accepted=$false;$asks=0
$confirm=[Func[bool]]{$script:accepted}
$formType.GetField('confirmExit',$flags).SetValue($form,$confirm)
try{
    $form.Show();$clock=[Diagnostics.Stopwatch]::StartNew()
    do{[Windows.Forms.Application]::DoEvents();Start-Sleep -Milliseconds 10;$state=$formType.GetMethod('PageStatus',$flags).Invoke($form,@())}while($state['state'] -ne 'ready' -and $clock.Elapsed.TotalSeconds -lt 20)
    if($state['state'] -ne 'ready'){throw 'Real WebView page did not become ready'}
    $browserPid=$state['browserPid'];$form.Close();[Windows.Forms.Application]::DoEvents()
    if($form.IsDisposed -or -not $form.Visible){throw 'Cancel hid or disposed the client'}
    $state=$formType.GetMethod('PageStatus',$flags).Invoke($form,@())
    if($state['browserPid'] -ne $browserPid -or $state['state'] -ne 'ready'){throw 'Cancel recreated the browser'}
    # A browser-process-exit event that never arrives must not keep the window visible for six seconds.
    $pending=New-Object 'System.Threading.Tasks.TaskCompletionSource[bool]'
    $formType.GetField('browserExited',$flags).SetValue($form,$pending)
    $script:accepted=$true;$clock.Restart();$form.Close()
    if($form.Visible){throw 'Confirmed close did not immediately hide the window'}
    $hideMs=$clock.ElapsedMilliseconds
    while(-not $form.IsDisposed -and $clock.Elapsed.TotalSeconds -lt 5){[Windows.Forms.Application]::DoEvents();Start-Sleep -Milliseconds 10}
    if(-not $form.IsDisposed -or $clock.ElapsedMilliseconds -gt 3000){throw 'Client waited too long for a missing browser-exit event'}
    $result=@{hiddenMilliseconds=$hideMs;exitMilliseconds=$clock.ElapsedMilliseconds;cancelPreservesPage=$true;pendingBrowserExitBounded=$true}|ConvertTo-Json
    [IO.File]::WriteAllText($OutputFile,$result,(New-Object Text.UTF8Encoding($false)))
    Write-Output $result
}finally{$form.Dispose();$owner.Dispose()}
