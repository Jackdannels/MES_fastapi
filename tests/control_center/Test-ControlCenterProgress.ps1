param([Parameter(Mandatory=$true)][string]$Executable, [Parameter(Mandatory=$true)][string]$TestDirectory)
$ErrorActionPreference='Stop'
New-Item -ItemType Directory -Path $TestDirectory -Force | Out-Null
$fixture=Join-Path $TestDirectory 'progress-controller.ps1'
@'
param([string]$Action,[string]$ResultFile)
Start-Sleep -Milliseconds 500
switch($Action) {
    'Start' {
        $child=Start-Process powershell.exe -ArgumentList '-NoProfile -Command "Start-Sleep -Seconds 20"' -NoNewWindow -PassThru
        [IO.File]::WriteAllText((Join-Path $PSScriptRoot 'progress-child.pid'),[string]$child.Id)
        '{"status":"started","message":"start-ok"}' | Set-Content -LiteralPath $ResultFile -Encoding UTF8
    }
    'Restart' { '{"status":"restarted","message":"restart-ok"}' | Set-Content -LiteralPath $ResultFile -Encoding UTF8 }
    'Stop' { '{"status":"stopped","message":"stop-ok"}' | Set-Content -LiteralPath $ResultFile -Encoding UTF8 }
    'Failure' { '{"status":"error","message":"intentional-failure"}' | Set-Content -LiteralPath $ResultFile -Encoding UTF8; exit 1 }
    'Missing' { [Console]::Error.WriteLine('missing-result-error'); exit 1 }
}
'@ | Set-Content -LiteralPath $fixture -Encoding UTF8
Add-Type -AssemblyName System.Windows.Forms
$assembly=[Reflection.Assembly]::LoadFrom($Executable)
$type=$assembly.GetType('MESControlCenter.ControlCenterForm',$true)
$flags=[Reflection.BindingFlags]'Instance,NonPublic'
$static=[Reflection.BindingFlags]'Static,NonPublic'
$form=$type.GetConstructor($flags,$null,[Type[]]@([string],[bool]),$null).Invoke([object[]]@([string]$fixture,$false))
$form.ShowInTaskbar=$false
$form.StartPosition=[Windows.Forms.FormStartPosition]::Manual
$form.Location=New-Object Drawing.Point(-10000,-10000)
function Field([string]$Name) { return $type.GetField($Name,$flags).GetValue($form) }
try {
    $form.Show()
    [Windows.Forms.Application]::DoEvents()
    foreach($action in @('Start','Restart','Stop','Failure','Missing')) {
        $timer=[Diagnostics.Stopwatch]::StartNew()
        $task=$type.GetMethod('RunServiceOperation',$flags).Invoke($form,@([string]$action))
        if (-not (Field 'serviceBusy') -or -not (Field 'serviceProgressOverlay').Visible) { throw "Operation $action did not start its central progress overlay" }
        $overlay=Field 'serviceProgressOverlay'
        $card=$overlay.Controls[0]
        if([Math]::Abs(($card.Left+$card.Width/2)-$form.ClientSize.Width/2)-gt 1 -or [Math]::Abs(($card.Top+$card.Height/2)-$form.ClientSize.Height/2)-gt 1){throw 'Progress card is not centered in the window'}
        foreach($button in (Field 'serviceButtons')) { if($button.Enabled){throw 'Service button remained enabled while operation was running'} }
        $sawComplete=$false
        while(-not $task.IsCompleted) {
            [Windows.Forms.Application]::DoEvents()
            $value=(Field 'serviceProgressBar').Value
            if($value -eq 100 -and (Field 'serviceProgressOverlay').Visible){$sawComplete=$true}
            if($timer.Elapsed.TotalSeconds -gt 6){throw "Operation $action remained stuck or waited for descendant stderr"}
            Start-Sleep -Milliseconds 10
        }
        $null=$task.GetAwaiter().GetResult()
        [Windows.Forms.Application]::DoEvents()
        if((Field 'serviceBusy') -or (Field 'serviceProgressOverlay').Visible){throw "Operation $action did not clear busy/progress state"}
        $buttons=@(Field 'serviceButtons')
        if(-not $buttons[0].Enabled -or -not $buttons[1].Enabled){throw "Operation $action did not restore Stop and Restart buttons"}
        if($action -in @('Start','Restart','Stop')) {
            if(-not $sawComplete -or (Field 'serviceProgressBar').Value -ne 100){throw "Operation $action did not display 100 percent"}
            if((Field 'modalOverlay').Visible){throw 'Successful progress still required a second OK dialog'}
            $expectedRunning=$action -ne 'Stop'
            if((Field 'systemRunning') -ne $expectedRunning -or (Field 'startServiceButton').Enabled -eq $expectedRunning){throw 'Start button state was not based on service state'}
        } else {
            if($sawComplete -or -not (Field 'modalOverlay').Visible){throw 'Failure was presented as a successful completion'}
            (Field 'modalConfirmButton').PerformClick()
        }
    }
    foreach($action in @('Start','Stop','Restart')) {
        $value=$type.GetMethod('EstimatedProgress',$static).Invoke($null,[object[]]@([string]$action,[double]3600))
        if($value -gt 95){throw 'Simulated progress reached completion without a real result'}
    }
    Write-Output 'Progress runtime checks passed: Start/Restart/Stop, central popup, 100 percent then auto-hide, inherited stderr, repeat actions and both failure paths restore controls.'
} finally {
    $childFile=Join-Path $TestDirectory 'progress-child.pid'
    if(Test-Path -LiteralPath $childFile){Stop-Process -Id ([int][IO.File]::ReadAllText($childFile)) -Force -ErrorAction SilentlyContinue}
    $form.Dispose()
}
