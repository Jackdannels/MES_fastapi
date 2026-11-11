param([Parameter(Mandatory=$true)][string]$Executable,[Parameter(Mandatory=$true)][string]$TestDirectory)
$ErrorActionPreference='Stop'
New-Item -ItemType Directory -Force -Path $TestDirectory|Out-Null
$fixture=Join-Path $TestDirectory 'InstanceFixture.exe'
Add-Type -ReferencedAssemblies System.Windows.Forms,System.Drawing -OutputAssembly $fixture -OutputType ConsoleApplication -TypeDefinition @'
using System;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Windows.Forms;
public static class InstanceFixture {
    [STAThread] public static int Main(string[] args) {
        var assembly=Assembly.LoadFrom(args[0]);
        var type=assembly.GetType("MESControlCenter.ControlCenterInstance",true);
        var flags=BindingFlags.NonPublic|BindingFlags.Instance|BindingFlags.Public;
        using(var instance=(IDisposable)type.GetConstructor(flags,null,new[]{typeof(string)},null).Invoke(new object[]{args[1]})) {
            bool primary=(bool)type.GetField("IsPrimary",flags).GetValue(instance);
            if(args[2]=="probe") return primary?0:9;
            string root=args[3]; int count=0;
            Func<Form> factory=delegate {
                File.AppendAllText(Path.Combine(root,"created.log"),"created\n");
                var form=new Form { ShowInTaskbar=false,StartPosition=FormStartPosition.Manual,Location=new Point(-10000,-10000) };
                form.Shown+=delegate { form.WindowState=FormWindowState.Minimized; File.WriteAllText(Path.Combine(root,"ready"),"ready"); };
                return form;
            };
            Action<Form> notice=delegate(Form form) {
                if(form.WindowState==FormWindowState.Minimized) throw new Exception("Existing window was not restored");
                string message=(string)type.GetField("AlreadyOpenMessage",BindingFlags.NonPublic|BindingFlags.Static).GetRawConstantValue();
                File.AppendAllText(Path.Combine(root,"notice.log"),message+"\n",System.Text.Encoding.UTF8);
                count++;
                if(count==2) form.BeginInvoke(new Action(form.Close));
            };
            return (int)type.GetMethod("Run",flags).Invoke(instance,new object[]{factory,notice});
        }
    }
}
'@
$exe=[IO.Path]::GetFullPath($Executable)
$owner=Join-Path $TestDirectory 'installation/MES控制中心.exe'
$argsLine='"'+$exe+'" "'+$owner+'" primary "'+$TestDirectory+'"'
$primary=Start-Process -FilePath $fixture -ArgumentList $argsLine -WindowStyle Hidden -PassThru
try {
    $clock=[Diagnostics.Stopwatch]::StartNew()
    while(-not (Test-Path -LiteralPath (Join-Path $TestDirectory 'ready'))) {if($primary.HasExited -or $clock.Elapsed.TotalSeconds -gt 10){throw 'Primary instance did not become ready'};Start-Sleep -Milliseconds 50}
    & $fixture $exe (Join-Path $TestDirectory 'another-install/MES控制中心.exe') probe
    if($LASTEXITCODE -ne 0){throw 'Independent installation was incorrectly blocked'}
    foreach($attempt in 1..2){
        & $fixture $exe $owner secondary $TestDirectory
        if($LASTEXITCODE -ne 0){throw 'Repeated launch failed'}
        $clock.Restart()
        while(-not (Test-Path (Join-Path $TestDirectory 'notice.log')) -or @(Get-Content -Encoding UTF8 -LiteralPath (Join-Path $TestDirectory 'notice.log')).Count -lt $attempt){if($clock.Elapsed.TotalSeconds -gt 8){throw 'Existing instance did not receive activation'};Start-Sleep -Milliseconds 50}
    }
    if(-not $primary.WaitForExit(10000)){throw 'Primary fixture did not exit'}
    if(@(Get-Content -LiteralPath (Join-Path $TestDirectory 'created.log')).Count -ne 1){throw 'Repeated launches created additional GUI forms'}
    if(@(Get-Content -Encoding UTF8 -LiteralPath (Join-Path $TestDirectory 'notice.log')|Where-Object {$_ -ne '控制中心已打开。'}).Count){throw 'Duplicate launch message is incorrect'}
    & $fixture $exe $owner probe
    if($LASTEXITCODE -ne 0){throw 'Exiting did not release GUI ownership'}
    Write-Output 'Single-instance checks passed: two processes signal one GUI, window restore, Chinese notice, installation isolation and reopen after exit.'
}finally{if(-not $primary.HasExited){$primary.Kill()};$primary.Dispose()}
