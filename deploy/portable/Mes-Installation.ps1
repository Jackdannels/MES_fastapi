# Shared only by the v1.4 installer, resumer and uninstaller.
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$script:MesUtf8=New-Object Text.UTF8Encoding($false)
function Read-MesJson([string]$Path){Get-Content -Encoding UTF8 -Raw -LiteralPath $Path|ConvertFrom-Json}
function Write-MesJson([string]$Path,$Value){
    [IO.Directory]::CreateDirectory((Split-Path -Parent $Path))|Out-Null
    $temporary=$Path+'.'+[guid]::NewGuid().ToString('N')+'.new'
    [IO.File]::WriteAllText($temporary,(ConvertTo-Json -InputObject $Value -Depth 30),$script:MesUtf8)
    if(Test-Path -LiteralPath $Path){[IO.File]::Replace($temporary,$Path,[NullString]::Value)}else{[IO.File]::Move($temporary,$Path)}
}
function Get-MesHash([string]$Path){$stream=[IO.File]::OpenRead($Path);$hash=[Security.Cryptography.SHA256]::Create();try{[BitConverter]::ToString($hash.ComputeHash($stream)).Replace('-','').ToLowerInvariant()}finally{$stream.Dispose();$hash.Dispose()}}
function Get-MesPathKey([string]$Path){$hash=[Security.Cryptography.SHA256]::Create();try{[BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes([IO.Path]::GetFullPath($Path).ToUpperInvariant()))).Replace('-','').ToLowerInvariant()}finally{$hash.Dispose()}}
function Resolve-MesChild([string]$Base,[string]$Relative){
    $basePath=[IO.Path]::GetFullPath($Base).TrimEnd('\')
    if(-not $Relative -or [IO.Path]::IsPathRooted($Relative) -or $Relative -match ':|(^|[\\/])\.\.?([\\/]|$)'){throw '安装路径无效或越界。'}
    $path=[IO.Path]::GetFullPath((Join-Path $basePath $Relative))
    if(-not $path.StartsWith($basePath+'\',[StringComparison]::OrdinalIgnoreCase)){throw '安装路径超出根目录。'}
    for($current=$path;$current;$current=Split-Path -Parent $current){
        if(Test-Path -LiteralPath $current){if((Get-Item -LiteralPath $current -Force).Attributes -band [IO.FileAttributes]::ReparsePoint){throw ('安装路径包含链接：'+$current)}}
        if([string]::Equals($current,$basePath,[StringComparison]::OrdinalIgnoreCase)){break}
    }
    return $path
}
function Assert-MesRoot([string]$Root){
    $path=[IO.Path]::GetFullPath($Root).TrimEnd('\')
    if($path -eq [IO.Path]::GetPathRoot($path).TrimEnd('\') -or $path.Length -lt 6){throw '请选择独立的 MES 安装文件夹。'}
    $null=Resolve-MesChild $path '.mes/installation.json';return $path
}
function Invoke-MesProcess([string]$File,[string[]]$Arguments,[int]$TimeoutSeconds=300,[switch]$Capture,[int[]]$SuccessExitCodes=@(0)){
    $info=New-Object Diagnostics.ProcessStartInfo;$info.FileName=$File;$info.UseShellExecute=$false;$info.CreateNoWindow=$true
    $info.Arguments=(@($Arguments|ForEach-Object {'"'+$_.Replace('"','\"')+'"'}) -join ' ')
    $info.RedirectStandardOutput=$true;$info.RedirectStandardError=$true
    $process=New-Object Diagnostics.Process;$process.StartInfo=$info
    if(-not $process.Start()){throw ('无法启动：'+$File)}
    $stdout=$process.StandardOutput.ReadToEndAsync();$stderr=$process.StandardError.ReadToEndAsync()
    try{
        if(-not $process.WaitForExit($TimeoutSeconds*1000)){$process.Kill();throw ('操作超时（'+$TimeoutSeconds+'秒）：'+[IO.Path]::GetFileName($File))}
        $out=if($stdout.Wait(1500)){$stdout.Result}else{''};$err=if($stderr.Wait(1500)){$stderr.Result}else{''}
        if($process.ExitCode -notin $SuccessExitCodes){throw ('操作失败：'+[IO.Path]::GetFileName($File)+'，退出码 '+$process.ExitCode+"`n"+$err+"`n"+$out)}
        if($Capture){return $out};if($out){Write-Host $out.Trim()}
    }finally{$process.Dispose()}
}
function Start-MesProgress([string]$Journal){
    if(-not ('MesInstallationProgress' -as [type])){
        Add-Type -TypeDefinition @'
using System;using System.IO;using System.Text;using System.Threading;using System.Diagnostics;
public static class MesInstallationProgress {
 static readonly object gate=new object();static Timer timer;static int phase;static string title="",journal;static Stopwatch clock=Stopwatch.StartNew();
 public static void Start(string path){journal=path;Directory.CreateDirectory(Path.GetDirectoryName(path));timer=new Timer(delegate{lock(gate){Emit();}},null,1000,1000);}
 public static void Set(int value,string text){lock(gate){phase=value;title=text.Replace("|"," ").Replace("\n"," ");clock.Restart();Emit();}}
 static void Emit(){string line="MES_PROGRESS|"+phase+"|"+title+"|"+(int)clock.Elapsed.TotalSeconds;Console.WriteLine(line);Console.Out.Flush();try{File.AppendAllText(journal,line+Environment.NewLine,new UTF8Encoding(false));}catch(IOException){}}
 public static void Stop(){if(timer!=null){timer.Dispose();timer=null;}}
}
'@
    }
    [MesInstallationProgress]::Start($Journal)
}
function Set-MesProgress([int]$Phase,[string]$Title){[MesInstallationProgress]::Set($Phase,$Title)}
function Register-MesDesktopEntry([string]$Path,[string]$Root,[string]$Id,[string]$Role){
    $key='HKLM:\SOFTWARE\5826MES\DesktopEntries\'+(Get-MesPathKey $Path)
    New-Item -Path $key -Force|Out-Null
    foreach($pair in @(@('root',$Root),@('installationId',$Id),@('role',$Role))){New-ItemProperty -Path $key -Name $pair[0] -Value $pair[1] -PropertyType String -Force|Out-Null}
}
function Test-MesWebViewRuntime {
    foreach($registry in @('HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients','HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients','HKCU:\SOFTWARE\Microsoft\EdgeUpdate\Clients')){
        if(Test-Path $registry){foreach($key in Get-ChildItem $registry){$value=Get-ItemProperty $key.PSPath;if($value.PSObject.Properties['name'] -and $value.name -match 'WebView2' -and $value.PSObject.Properties['pv'] -and $value.pv -ne '0.0.0.0'){return $true}}}
    }
    return $false
}
function Enter-MesInstallationLock([string]$Root){
    $mutex=New-Object Threading.Mutex($false,('Local\MES5826Installation-'+(Get-MesPathKey $Root)))
    try{$acquired=$mutex.WaitOne(0)}catch [Threading.AbandonedMutexException]{$acquired=$true}
    if(-not $acquired){$mutex.Dispose();throw '本目录正在安装或卸载，请等待当前操作完成。'}
    return $mutex
}
