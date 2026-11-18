[CmdletBinding()]
param([string]$Root=(Split-Path -Parent $PSScriptRoot))
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$rootPath=(Resolve-Path -LiteralPath $Root).Path
$cache=Join-Path $rootPath '.mes/components'
foreach($path in @($rootPath,(Join-Path $rootPath '.mes'),$cache,(Join-Path $cache 'catalog.json'),(Join-Path $cache 'controller.zip'))){
    if(((Get-Item -LiteralPath $path -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw '恢复目录或资源不能包含链接。'}
}
$catalog=Get-Content -Encoding UTF8 -Raw -LiteralPath (Join-Path $cache 'catalog.json')|ConvertFrom-Json
if($catalog.format -ne 'mes-component-library' -or $catalog.controlCenterVersion -ne '2.10.0'){throw '控制中心组件库版本不匹配。'}
$component=@($catalog.components|Where-Object id -eq 'controller')
if($component.Count -ne 1 -or $component[0].kind -ne 'controller' -or $component[0].directory -ne '' -or @($component[0].files).Count -ne 1){throw '控制中心组件清单无效。'}
$component=$component[0];$entry=$component.files[0]
if($entry.path -notin @('MES控制中心_v2.10.0.exe','MES控制中心.exe') -or $component.archive -ne 'controller.zip'){throw '控制中心恢复路径无效。'}
function Digest([string]$Path){
    $stream=[IO.File]::OpenRead($Path);$hash=[Security.Cryptography.SHA256]::Create()
    try{[BitConverter]::ToString($hash.ComputeHash($stream)).Replace('-','').ToLowerInvariant()}finally{$stream.Dispose();$hash.Dispose()}
}
$archive=Join-Path $cache 'controller.zip'
if((Digest $archive) -ne $component.sha256){throw '控制中心压缩包校验失败。'}
$target=Join-Path $rootPath $entry.path
foreach($process in @(Get-Process -Name ([IO.Path]::GetFileNameWithoutExtension($entry.path)) -ErrorAction SilentlyContinue)){
    if($process.Path -eq $target){throw '请先关闭控制中心，再运行恢复入口。'}
}
if(((Get-Item -LiteralPath $rootPath).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw '恢复目录不能为链接。'}
$temporary=Join-Path $rootPath ('.mes/controller-'+[guid]::NewGuid().ToString('N')+'.tmp')
try{
    $zip=[IO.Compression.ZipFile]::OpenRead($archive)
    try{
        if($zip.Entries.Count -ne 1 -or $zip.Entries[0].FullName -ne $entry.path -or $zip.Entries[0].Length -ne $entry.bytes){throw '控制中心压缩包内容无效。'}
        [IO.Compression.ZipFileExtensions]::ExtractToFile($zip.Entries[0],$temporary,$false)
    }finally{$zip.Dispose()}
    if((Digest $temporary) -ne $entry.sha256){throw '控制中心文件校验失败。'}
    if(Test-Path -LiteralPath $target){
        if(((Get-Item -LiteralPath $target).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw '目标文件不能为链接。'}
        $check=[IO.File]::Open($target,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None);$check.Dispose()
        $backup=Join-Path $rootPath ('.mes/controller-backup-'+(Get-Date -Format 'yyyyMMdd-HHmmss')+'.exe')
        [IO.File]::Replace($temporary,$target,$backup)
    }else{[IO.File]::Move($temporary,$target)}
    Write-Output '控制中心已恢复，配置、工位绑定及业务数据保留。'
}finally{if(Test-Path -LiteralPath $temporary){Remove-Item -LiteralPath $temporary -Force}}
