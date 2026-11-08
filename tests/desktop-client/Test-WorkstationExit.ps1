param([string]$Executable,[string]$Config)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
$assembly=[Reflection.Assembly]::LoadFrom($Executable)
$flags=[Reflection.BindingFlags]'Instance,NonPublic'
$static=[Reflection.BindingFlags]'Static,NonPublic'
$configType=$assembly.GetType('MESDesktopClient.ClientConfiguration',$true)
$instanceType=$assembly.GetType('MESDesktopClient.ClientInstance',$true)
$formType=$assembly.GetType('MESDesktopClient.ClientForm',$true)
$configuration=$configType.GetMethod('Load',$static).Invoke($null,[object[]]@([string[]]@('--config',$Config,'--test-hidden'),$false))
$instance=$instanceType.GetConstructor($flags,$null,[Type[]]@($configType,[bool]),$null).Invoke([object[]]@($configuration,$false))
$form=$formType.GetConstructor($flags,$null,[Type[]]@($configType,$instanceType),$null).Invoke([object[]]@($configuration,$instance))
$script:accepted=$false
$script:asks=0
$confirm=[Func[bool]] { $script:asks++; return $script:accepted }
$formType.GetField('confirmExit',$flags).SetValue($form,$confirm)
try {
    $form.Show()
    $clock=[Diagnostics.Stopwatch]::StartNew()
    do { [Windows.Forms.Application]::DoEvents(); Start-Sleep -Milliseconds 10; $before=$formType.GetMethod('PageStatus',$flags).Invoke($form,@()) } while($before['state'] -ne 'ready' -and $clock.ElapsedMilliseconds -lt 15000)
    if($before['state'] -ne 'ready'){throw 'WebView did not become ready'}
    $web=$formType.GetField('web',$flags).GetValue($form)
    $null=$web.CoreWebView2.ExecuteScriptAsync("window.chrome.webview.postMessage('mes-client-close-request')")
    $clock.Restart()
    while($script:asks -eq 0 -and $clock.ElapsedMilliseconds -lt 5000){[Windows.Forms.Application]::DoEvents();Start-Sleep -Milliseconds 10}
    [Windows.Forms.Application]::DoEvents()
    if($form.IsDisposed -or $script:asks -ne 1){throw 'Cancel did not preserve the workstation'}
    $after=$formType.GetMethod('PageStatus',$flags).Invoke($form,@())
    if($after['browserPid'] -ne $before['browserPid'] -or $after['state'] -ne 'ready'){throw 'Cancel recreated or stopped the page'}
    $script:accepted=$true
    $form.Close()
    $clock.Restart()
    while(-not $form.IsDisposed -and $clock.ElapsedMilliseconds -lt 15000){[Windows.Forms.Application]::DoEvents();Start-Sleep -Milliseconds 10}
    if(-not $form.IsDisposed -or $script:asks -ne 2){throw 'Confirmed workstation window close did not exit'}
    Write-Output 'cancel-preserved-page;confirm-exited'
} finally {
    $form.Dispose();$instance.Dispose()
}
