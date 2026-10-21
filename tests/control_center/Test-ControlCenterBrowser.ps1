param([Parameter(Mandatory=$true)][string]$Executable, [Parameter(Mandatory=$true)][string]$TestDirectory)
$ErrorActionPreference='Stop'
New-Item -ItemType Directory -Path $TestDirectory -Force | Out-Null
$TestDirectory=[IO.Path]::GetFullPath($TestDirectory)
$source=Join-Path $TestDirectory 'browser.cs'
$browser=Join-Path $TestDirectory 'browser.exe'
@'
using System;
using System.IO;
using System.Diagnostics;
using System.Windows.Forms;
class BrowserFixture {
    [STAThread] static void Main(string[] args) {
        string profile = null;
        int count = 0;
        foreach (string arg in args) if (arg.StartsWith("--user-data-dir=")) profile = arg.Substring(16);
        // Model Chromium handing off to a different process during startup.
        if (profile != null && Array.IndexOf(args, "--actual-root") < 0) {
            Directory.CreateDirectory(profile);
            File.WriteAllText(Path.Combine(profile, "launcher.pid"), Process.GetCurrentProcess().Id.ToString());
            string arguments = "--actual-root";
            foreach (string arg in args) arguments += " \"" + arg + "\"";
            Process.Start(new ProcessStartInfo(Process.GetCurrentProcess().MainModule.FileName, arguments) { UseShellExecute = true });
            return;
        }
        foreach (string arg in args) if (arg.StartsWith("http")) {
            count++;
            Form form = new Form { Text = arg, ShowInTaskbar = false, StartPosition = FormStartPosition.Manual, Left = -10000, Top = -10000 };
            form.FormClosed += delegate { if (--count == 0) Application.ExitThread(); };
            form.Show();
        }
        if (profile != null) { Directory.CreateDirectory(profile); File.WriteAllText(Path.Combine(profile, "ready.txt"), "ready"); }
        Application.Run();
    }
}
'@ | Set-Content -LiteralPath $source -Encoding UTF8
& "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /target:winexe /reference:System.Windows.Forms.dll /reference:System.Drawing.dll "/out:$browser" $source
if ($LASTEXITCODE -ne 0) { throw 'Browser fixture did not compile' }
$controller=Join-Path $TestDirectory 'mes-service-control.ps1'
@'
param([string]$Action,[string]$ResultFile,[switch]$NoOpen)
if ($Action -in @('Start','Restart') -and -not $NoOpen) { throw 'Control center did not suppress default-browser launch' }
if ($Action -eq 'Stop' -and (Test-Path (Join-Path $PSScriptRoot 'fail-stop'))) {
    '{"status":"error","message":"stop-failed"}' | Set-Content -LiteralPath $ResultFile -Encoding UTF8
    exit 1
}
$status = if($Action -eq 'Stop'){'stopped'}elseif($Action -eq 'Restart'){'restarted'}else{'started'}
@{status=$status;message='ok';pageUrls=@('http://127.0.0.1:25173/','http://127.0.0.1:28900/','http://127.0.0.1:28899/')} | ConvertTo-Json -Compress | Set-Content -LiteralPath $ResultFile -Encoding UTF8
'@ | Set-Content -LiteralPath $controller -Encoding UTF8
Add-Type -AssemblyName System.Windows.Forms
$assembly=[Reflection.Assembly]::LoadFrom($Executable)
$flags=[Reflection.BindingFlags]'Instance,NonPublic'
$static=[Reflection.BindingFlags]'Static,NonPublic'
$type=$assembly.GetType('MESControlCenter.ControlCenterForm',$true)
$sessionType=$assembly.GetType('MESControlCenter.MESBrowserSession',$true)
$sessionConstructor=$sessionType.GetConstructor($flags,$null,[Type[]]@([string],[string]),$null)
$form=$type.GetConstructor($flags,$null,[Type[]]@([string],[bool]),$null).Invoke([object[]]@([string]$controller,$false))
$session=$sessionConstructor.Invoke([object[]]@([string]$TestDirectory,[string]$browser))
$type.GetField('browserSession',$flags).SetValue($form,$session)
$statePath=$sessionType.GetProperty('StatePath',$flags).GetValue($session,$null)
$sessionDirectory=Split-Path -Parent $statePath
$run=$type.GetMethod('RunControl',$flags)
$children=New-Object 'System.Collections.Generic.List[int]'
function State { return Get-Content -Raw -LiteralPath $statePath | ConvertFrom-Json }
function Wait-Windows([int]$ProcessId,[int]$Count) {
    $clock=[Diagnostics.Stopwatch]::StartNew()
    do {
        $windows=$sessionType.GetMethod('Windows',$static).Invoke($null,@($ProcessId))
        if($windows.Count -eq $Count){return}
        Start-Sleep -Milliseconds 40
    } while($clock.Elapsed.TotalSeconds -lt 5)
    throw "Expected $Count windows for process $ProcessId; found $($windows.Count)"
}
try {
    # Another window from the same executable must survive every MES operation.
    $other=Start-Process -FilePath $browser -ArgumentList 'http://127.0.0.1:29999/' -PassThru
    $children.Add($other.Id)
    Wait-Windows $other.Id 1
    $result=$run.Invoke($form,@('Start')) | ConvertFrom-Json
    if($result.status -ne 'started' -or $result.message -ne 'ok'){throw ('Start failed to launch the managed browser: '+($result | ConvertTo-Json -Compress))}
    $first=State
    $children.Add([int]$first.pid)
    Wait-Windows $first.pid 3
    if([int][IO.File]::ReadAllText((Join-Path $sessionDirectory 'Profile/launcher.pid')) -eq $first.pid){throw 'Browser handoff did not track the actual window owner'}

    New-Item -ItemType File -Path (Join-Path $TestDirectory 'fail-stop') | Out-Null
    $result=$run.Invoke($form,@('Stop')) | ConvertFrom-Json
    if($result.status -ne 'error'){throw 'Failure fixture did not fail'}
    Wait-Windows $first.pid 3
    Remove-Item -LiteralPath (Join-Path $TestDirectory 'fail-stop')

    $result=$run.Invoke($form,@('Restart')) | ConvertFrom-Json
    if($result.status -ne 'restarted' -or $result.message -ne 'ok'){throw 'Restart failed to replace browser windows'}
    Wait-Windows $first.pid 0
    $second=State
    $children.Add([int]$second.pid)
    Wait-Windows $second.pid 3

    # Reloading the session models closing and reopening the control center.
    $session=$sessionConstructor.Invoke([object[]]@([string]$TestDirectory,[string]$browser))
    $type.GetField('browserSession',$flags).SetValue($form,$session)
    $result=$run.Invoke($form,@('Stop')) | ConvertFrom-Json
    if($result.status -ne 'stopped' -or $result.message -ne 'ok'){throw 'Stop failed to close persisted browser windows'}
    Wait-Windows $second.pid 0
    Wait-Windows $other.Id 1

    # A reused PID with a different start time must never authorize a close.
    @{pid=$other.Id;started='0';executable=$browser} | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding UTF8
    $sessionType.GetMethod('Close',$flags).Invoke($session,@())
    Wait-Windows $other.Id 1
    '{broken' | Set-Content -LiteralPath $statePath
    $sessionType.GetMethod('Close',$flags).Invoke($session,@())
    Wait-Windows $other.Id 1
    Write-Output 'Browser regression passed: Start, failed Stop, Restart, persisted Stop, three MES/LIMS/upper-computer pages, unrelated windows, stale identity and corrupt state.'
} finally {
    foreach($child in $children){Stop-Process -Id $child -Force -ErrorAction SilentlyContinue}
    foreach($process in Get-Process -Name browser -ErrorAction SilentlyContinue) {
        if($process.Path -eq $browser) { $process.Kill(); $process.WaitForExit() }
    }
    $form.Dispose()
    $expectedRoot=[IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'MesFastApiLauncher/Browsers')).TrimEnd('\')+'\'
    $resolved=[IO.Path]::GetFullPath($sessionDirectory)
    if($resolved.StartsWith($expectedRoot,[StringComparison]::OrdinalIgnoreCase) -and (Split-Path -Leaf $resolved) -match '^[A-F0-9]{64}$'){
        Remove-Item -LiteralPath $resolved -Recurse -Force -ErrorAction SilentlyContinue
    }
}
