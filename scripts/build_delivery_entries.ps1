param([Parameter(Mandatory=$true)][string]$OutputDirectory)
$ErrorActionPreference='Stop'
$root=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
New-Item -ItemType Directory -Path $OutputDirectory -Force|Out-Null
$csc='C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
foreach($role in @('controller','central')){
    $source=Join-Path $OutputDirectory ('EntryRole-'+$role+'.cs')
    [IO.File]::WriteAllText($source,('internal static class EntryRole { internal const string Value="'+$role+'"; }'))
    $name=if($role -eq 'controller'){'MES控制中心.exe'}else{'MES中控管理.exe'}
    & $csc /nologo /target:winexe /platform:x64 /codepage:65001 /reference:System.Windows.Forms.dll /reference:System.Web.Extensions.dll ('/win32icon:'+(Join-Path $root 'assets/mes-control-center-blue.ico')) ('/out:'+(Join-Path $OutputDirectory $name)) (Join-Path $root 'tools/control-center/DesktopEntry.cs') $source
    if($LASTEXITCODE -ne 0){throw '桌面入口编译失败'}
    Remove-Item -LiteralPath $source -Force
    Copy-Item -LiteralPath (Join-Path $root 'tools/desktop-client/app.config') -Destination (Join-Path $OutputDirectory ($name+'.config'))
}
& $csc /nologo /target:winexe /platform:x64 /codepage:65001 /reference:System.Windows.Forms.dll ('/win32icon:'+(Join-Path $root 'assets/mes-control-center-blue.ico')) ('/out:'+(Join-Path $OutputDirectory '卸载5826信息化系统.exe')) (Join-Path $root 'tools/control-center/UninstallEntry.cs')
if($LASTEXITCODE -ne 0){throw '卸载入口编译失败'}
