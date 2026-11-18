param([Parameter(Mandatory=$true)][string]$Executable,[Parameter(Mandatory=$true)][string]$Config,[Parameter(Mandatory=$true)][string]$OutputDirectory)
$ErrorActionPreference='Stop'
trap{Write-Output $_.ScriptStackTrace;throw $_.Exception}
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Web.Extensions
$assembly=[Reflection.Assembly]::LoadFrom($Executable);$flags=[Reflection.BindingFlags]'Instance,NonPublic,Public';$static=[Reflection.BindingFlags]'Static,NonPublic,Public'
$type=$assembly.GetType('MESDesktopClient.ClientForm',$true);$configType=$assembly.GetType('MESDesktopClient.ClientConfiguration',$true);$instanceType=$assembly.GetType('MESDesktopClient.ClientInstance',$true)
$arguments=New-Object object[] 2;$arguments.SetValue([string[]]@('--config',$Config,'--test-hidden'),0);$arguments.SetValue($false,1)
$configValue=$configType.GetMethod('Load',$static).Invoke($null,$arguments)
$owner=$instanceType.GetConstructor($flags,$null,[Type[]]@($configType,[bool]),$null).Invoke([object[]]@($configValue,$false))
$form=$type.GetConstructor($flags,$null,[Type[]]@($configType,$instanceType),$null).Invoke([object[]]@($configValue,$owner))
$json=New-Object Web.Script.Serialization.JavaScriptSerializer
function Pump($task){$clock=[Diagnostics.Stopwatch]::StartNew();while(-not $task.IsCompleted){[Windows.Forms.Application]::DoEvents();if($clock.Elapsed.TotalSeconds -gt 15){throw 'Display operation timed out'};Start-Sleep -Milliseconds 10};return $task.GetAwaiter().GetResult()}
try{
    New-Item -ItemType Directory -Path $OutputDirectory -Force|Out-Null
    $form.ShowInTaskbar=$false;$form.StartPosition='Manual';$form.Location=New-Object Drawing.Point(-10000,-10000);$form.Show()
    $clock=[Diagnostics.Stopwatch]::StartNew()
    do{[Windows.Forms.Application]::DoEvents();Start-Sleep -Milliseconds 10;$state=$type.GetMethod('PageStatus',$flags).Invoke($form,@())}while($state['state'] -ne 'ready' -and $clock.Elapsed.TotalSeconds -lt 20)
    if($state['state'] -ne 'ready'){throw 'WebView did not become ready'}
    $web=$type.GetField('web',$flags).GetValue($form)
    $controller=$web.GetType().GetField('_coreWebView2Controller',$flags).GetValue($web)
    if(-not $controller.ShouldDetectMonitorScaleChanges){throw 'WebView monitor-scale tracking was disabled'}
    $read='JSON.stringify({dpr:devicePixelRatio,cssZoom:getComputedStyle(document.documentElement).zoom,transform:getComputedStyle(document.body).transform,viewportScale:visualViewport.scale,width:innerWidth,height:innerHeight,font:getComputedStyle(document.body).fontSize})'
    $browserBefore=$state['browserPid'];$results=@()
    # Exercise the real renderer's raster scale, without changing Windows display settings.
    $controller.ShouldDetectMonitorScaleChanges=$false
    foreach($factor in @(1.0,1.25,1.5)){
        $controller.RasterizationScale=$factor
        $null=Pump ($web.CoreWebView2.ExecuteScriptAsync('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))'))
        $raw=Pump ($web.CoreWebView2.ExecuteScriptAsync($read));$page=$json.DeserializeObject($json.DeserializeObject($raw))
        if([Math]::Abs([double]$page['dpr']-$factor) -gt .01){throw ('Renderer did not use requested pixel density: '+$raw)}
        if($web.ZoomFactor -ne 1 -or [double]$page['cssZoom'] -ne 1 -or $page['transform'] -ne 'none' -or [double]$page['viewportScale'] -ne 1){throw 'Web content was stretched by a second zoom layer'}
        $file=Join-Path $OutputDirectory ('renderer-'+$factor+'.png');$stream=[IO.File]::Create($file)
        try{$null=Pump ($web.CoreWebView2.CapturePreviewAsync([Microsoft.Web.WebView2.Core.CoreWebView2CapturePreviewImageFormat]::Png,$stream))}finally{$stream.Dispose()}
        $image=[Drawing.Image]::FromFile($file)
        try{if([Math]::Abs($image.Width-([double]$page['width']*$factor)) -gt 3){throw 'Raster output width does not match CSS size and pixel density'}}finally{$image.Dispose()}
        $results+=@{rendererScale=$factor;page=$page;zoom=$web.ZoomFactor}
    }
    $controller.ShouldDetectMonitorScaleChanges=$true
    if(-not $controller.ShouldDetectMonitorScaleChanges){throw 'Renderer monitor tracking was not restored'}
    $state=$type.GetMethod('PageStatus',$flags).Invoke($form,@())
    if($state['browserPid'] -ne $browserBefore){throw 'Display scaling recreated the browser and discarded its session'}
    [IO.File]::WriteAllText((Join-Path $OutputDirectory 'renderer-scale-results.json'),(ConvertTo-Json -InputObject $results -Depth 8),(New-Object Text.UTF8Encoding($false)))
    Write-Output 'Display rendering passed: native raster scales 100/125/150 percent, page zoom 100 percent, no CSS stretch, pixel-size captures and browser session retained.'
}finally{$form.Dispose();$owner.Dispose()}
