param([Parameter(Mandatory=$true)][string]$Executable,[Parameter(Mandatory=$true)][string]$Config,[Parameter(Mandatory=$true)][string]$OutputDirectory)
$ErrorActionPreference='Stop'
trap { Write-Output $_.ScriptStackTrace; throw $_.Exception }
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Web.Extensions
$assembly=[Reflection.Assembly]::LoadFrom($Executable)
$flags=[Reflection.BindingFlags]'Instance,NonPublic,Public';$static=[Reflection.BindingFlags]'Static,NonPublic,Public'
$formType=$assembly.GetType('MESDesktopClient.ClientForm',$true)
$configType=$assembly.GetType('MESDesktopClient.ClientConfiguration',$true)
$instanceType=$assembly.GetType('MESDesktopClient.ClientInstance',$true)
$zoomType=$assembly.GetType('MESDesktopClient.ClientPageZoom',$true)
$json=New-Object Web.Script.Serialization.JavaScriptSerializer
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$profile=''
$form=$null;$owner=$null
function Pump($task) {
    $clock=[Diagnostics.Stopwatch]::StartNew()
    while(-not $task.IsCompleted){[Windows.Forms.Application]::DoEvents();if($clock.Elapsed.TotalSeconds -gt 15){throw 'Page zoom operation timed out'};Start-Sleep -Milliseconds 5}
    return $task.GetAwaiter().GetResult()
}
function Eval([string]$script) { return $json.DeserializeObject((Pump ($script:web.CoreWebView2.ExecuteScriptAsync($script)))) }
function WaitZoom([int]$percent) {
    $clock=[Diagnostics.Stopwatch]::StartNew()
    do {
        [Windows.Forms.Application]::DoEvents();Start-Sleep -Milliseconds 5
        $state=Eval 'window.zoomState'
        if($clock.Elapsed.TotalSeconds -gt 10){throw ('Zoom did not reach '+$percent+'; native='+$script:web.ZoomFactor+'; page='+($state|ConvertTo-Json -Compress))}
    } while([Math]::Abs($script:web.ZoomFactor-$percent/100.0) -gt .001 -or -not $state -or $state['percent'] -ne $percent)
}
function OpenClient {
    $arguments=New-Object object[] 2;$arguments[0]=[string[]]@('--config',$Config,'--test-hidden');$arguments[1]=$false
    $script:configuration=$configType.GetMethod('Load',$static).Invoke($null,$arguments)
    $script:profile=[string]$configType.GetField('DataDirectory',$flags).GetValue($script:configuration)
    $script:owner=$instanceType.GetConstructor($flags,$null,[Type[]]@($configType,[bool]),$null).Invoke([object[]]@($script:configuration,$false))
    $script:form=$formType.GetConstructor($flags,$null,[Type[]]@($configType,$instanceType),$null).Invoke([object[]]@($script:configuration,$script:owner))
    $script:form.ShowInTaskbar=$false;$script:form.StartPosition='Manual';$script:form.Location=New-Object Drawing.Point(-10000,-10000)
    $script:form.Show()
    $clock=[Diagnostics.Stopwatch]::StartNew()
    do {
        [Windows.Forms.Application]::DoEvents();Start-Sleep -Milliseconds 10
        $state=$formType.GetMethod('PageStatus',$flags).Invoke($script:form,@())
        if($clock.Elapsed.TotalSeconds -gt 20){
            $state['webCreated']=$null -ne $formType.GetField('web',$flags).GetValue($script:form)
            $state['environmentCreated']=$null -ne $formType.GetField('environment',$flags).GetValue($script:form)
            throw ('Zoom fixture did not become ready: '+($state|ConvertTo-Json -Compress))
        }
    } while($state['state'] -ne 'ready' -or $state['documentTitle'] -ne 'test-bridge-ready')
    $script:web=$formType.GetField('web',$flags).GetValue($script:form)
}
function CloseClient {
    if($script:form -and -not $script:form.IsDisposed) {
        $formType.GetField('closeRequested',$flags).SetValue($script:form,$true)
        $script:form.Close()
        $clock=[Diagnostics.Stopwatch]::StartNew()
        while(-not $script:form.IsDisposed){[Windows.Forms.Application]::DoEvents();Start-Sleep -Milliseconds 10;if($clock.Elapsed.TotalSeconds -gt 6){throw 'Test host did not close'}}
    }
    if($script:owner){$script:owner.Dispose();$script:owner=$null}
}
function Command([string]$action) { $null=Eval ('window.requestFixtureZoom('+($json.Serialize($action))+')') }
function Wheel([int]$delta,[int]$modifiers) {
    $parameters=$json.Serialize(@{type='mouseWheel';x=300;y=200;deltaX=0;deltaY=$delta;modifiers=$modifiers})
    $null=Pump ($script:web.CoreWebView2.CallDevToolsProtocolMethodAsync('Input.dispatchMouseEvent',$parameters))
}
function Key([string]$key,[string]$code,[int]$virtualKey) {
    foreach($kind in @('keyDown','keyUp')) {
        $parameters=$json.Serialize(@{type=$kind;key=$key;code=$code;windowsVirtualKeyCode=$virtualKey;nativeVirtualKeyCode=$virtualKey;modifiers=2})
        $null=Pump ($script:web.CoreWebView2.CallDevToolsProtocolMethodAsync('Input.dispatchKeyEvent',$parameters))
    }
}
try {
    OpenClient;WaitZoom 100
    $results=@{}
    Wheel 120 0
    $clock=[Diagnostics.Stopwatch]::StartNew()
    do{[Windows.Forms.Application]::DoEvents();$scroll=Eval 'window.scrollY';if($clock.Elapsed.TotalSeconds -gt 5){throw 'Ordinary wheel did not scroll the document'}}while($scroll -le 0)
    WaitZoom 100;$results.ordinaryScroll=$scroll
    $null=Eval 'document.querySelector("#zoom-focus").focus()'
    Wheel -120 2;WaitZoom 110;$results.singleWheel=110
    Wheel 120 2;WaitZoom 100
    Key '=' 'Equal' 187;WaitZoom 110
    Key '-' 'Minus' 189;WaitZoom 100
    Command 'in';WaitZoom 110;Command 'in';WaitZoom 125
    Key '0' 'Digit0' 48;WaitZoom 100
    $null=Eval 'window.chrome.webview.postMessage("mes-client-zoom:set:999")';WaitZoom 100
    for($i=0;$i -lt 20;$i++){Command 'out'};WaitZoom 50
    for($i=0;$i -lt 20;$i++){Command 'in'};WaitZoom 200
    $results.bounds=@(50,200)
    Command 'reset';WaitZoom 100;Command 'in';Command 'in';WaitZoom 125
    $browser=$formType.GetMethod('PageStatus',$flags).Invoke($form,@())['browserPid']
    $web.CoreWebView2.Reload()
    WaitZoom 125
    $pages=$assembly.GetType('MESDesktopClient.ClientTestNavigation').GetMethod('Pages',$static).Invoke($null,@())
    foreach($page in $pages) {
        $key=$page.GetType().GetField('Key',$flags).GetValue($page)
        if(-not $formType.GetMethod('SelectTab',$flags).Invoke($form,@($key))){throw ('Could not select '+$key)}
        $clock=[Diagnostics.Stopwatch]::StartNew()
        do {
            [Windows.Forms.Application]::DoEvents();Start-Sleep -Milliseconds 5
            if($clock.Elapsed.TotalSeconds -gt 10){throw ('Page switching did not finish: '+$key)}
        } while($formType.GetField('activeTestPage',$flags).GetValue($form) -ne $key -or $formType.GetField('testRequestId',$flags).GetValue($form) -ne '')
        WaitZoom 125
    }
    $results.pages=$pages.Count
    $controller=$web.GetType().GetField('_coreWebView2Controller',$flags).GetValue($web)
    $controller.ShouldDetectMonitorScaleChanges=$false
    foreach($scale in @(1.0,1.25,1.5)) {
        $controller.RasterizationScale=$scale
        $null=Eval 'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))'
        WaitZoom 125
        $metrics=Eval '({cssZoom:getComputedStyle(document.documentElement).zoom,transform:getComputedStyle(document.body).transform})'
        if([double]$metrics['cssZoom'] -ne 1 -or $metrics['transform'] -ne 'none'){throw 'Page zoom was also applied through CSS'}
    }
    $controller.ShouldDetectMonitorScaleChanges=$true
    $results.dpiScales=@(1,1.25,1.5)
    if($formType.GetMethod('PageStatus',$flags).Invoke($form,@())['browserPid'] -ne $browser){throw 'Zooming recreated the browser'}
    CloseClient;OpenClient;WaitZoom 125;$results.restart=125
    CloseClient
    foreach($invalid in @('broken json','null','{"percent":300}','{"percent":"125"}')) {
        [IO.File]::WriteAllText((Join-Path $profile 'page-zoom.json'),$invalid)
        $zoom=$zoomType.GetConstructor($flags,$null,[Type[]]@($configType),$null).Invoke(@($configuration))
        if($zoomType.GetProperty('Percent',$flags).GetValue($zoom,$null) -ne 100){throw 'Invalid zoom preference did not fall back to 100%'}
    }
    [IO.File]::WriteAllText((Join-Path $OutputDirectory 'page-zoom-results.json'),($results|ConvertTo-Json -Depth 5),(New-Object Text.UTF8Encoding($false)))
    Write-Output 'Page zoom passed: real wheel and key input, native ratio, bounds, refresh, 16 pages, DPI, restart and corrupt preference recovery.'
} finally { CloseClient }
