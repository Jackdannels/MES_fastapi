[CmdletBinding()]
param(
    [string]$OutputDirectory = (Join-Path ([Environment]::GetFolderPath('Desktop')) 'MES工位客户端_本机测试'),
    [string]$ServerUrl = 'http://127.0.0.1:5173',
    [string]$SdkPackagePath = '',
    [string]$RuntimeInstallerPath = '',
    [string]$FixedRuntimeDirectory = '',
    [switch]$Offline
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$project=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$output=[IO.Path]::GetFullPath($OutputDirectory)
if(Test-Path -LiteralPath $output) { throw 'Output directory already exists; choose a new directory to preserve existing client settings.' }
$server=$null
if(-not [Uri]::TryCreate($ServerUrl,[UriKind]::Absolute,[ref]$server) -or $server.Scheme -notin @('http','https') -or $server.UserInfo -or $server.Query -or $server.Fragment -or $server.AbsolutePath -ne '/') { throw 'ServerUrl must be an HTTP(S) origin without credentials or path.' }
$stations=Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $project 'tools/desktop-client/workstations.json') | ConvertFrom-Json
$encoding=New-Object Text.UTF8Encoding($false)
function Get-Sha256([string]$Path) {
    $stream=[IO.File]::OpenRead($Path)
    $hash=[Security.Cryptography.SHA256]::Create()
    try { return -join ($hash.ComputeHash($stream) | ForEach-Object { $_.ToString('x2') }) }
    finally { $stream.Dispose(); $hash.Dispose() }
}
$inventory=New-Object 'Collections.Generic.List[object]'
$rows=New-Object 'Collections.Generic.List[string]'
New-Item -ItemType Directory -Path $output | Out-Null
foreach($station in $stations) {
    if([IO.Path]::GetFileName($station.folder) -ne $station.folder -or $station.folder -in @('.','..')) { throw 'Invalid workstation folder in catalog.' }
    $folder=Join-Path $output $station.folder
    & (Join-Path $project 'scripts/build_desktop_client.ps1') -OutputDirectory $folder -Module $station.module -LaboratoryCode $station.labCode -ServerUrl $ServerUrl `
        -SdkPackagePath $SdkPackagePath -RuntimeInstallerPath $RuntimeInstallerPath -FixedRuntimeDirectory $FixedRuntimeDirectory -Offline:$Offline
    $manifestPath=Join-Path $folder 'client-manifest.json'
    $manifest=Get-Content -Raw -Encoding UTF8 -LiteralPath $manifestPath | ConvertFrom-Json
    $note=@"
# $($station.folder)专用客户端 v$($manifest.version)

本机完成一次工位绑定后，双击 ``$($manifest.executable)`` 即可自动进入$($station.folder)，无需每次输入登录账号。程序固定对应此工位，不提供切换入口。实验间内部员工签到仍按原流程使用。

当前服务器：``$($ServerUrl.TrimEnd('/'))``（本机测试）。可视化使用普通最大化窗口，其余工位启动直接无边框全屏；均不显示顶部单页页签、浏览器地址或收藏。页面与退出提示随深浅主题显示。

页面“关闭”和 Alt+F4 共用一次关闭确认，默认取消；确认后仅关闭当前客户端，MES 后台服务继续运行。可视化窗口右上角关闭也遵循此规则。需要再次进入时重新打开 EXE。

请保留整个文件夹，DLL、EXE.config、mes-client.json 均为运行所需文件。各工位登录数据保存在当前 Windows 用户本地目录，相互独立。下载文件位于用户 Downloads/MES 下对应的工位目录。

工位凭据由当前 Windows 用户在本机加密保存，不包含在此文件夹中。换电脑、换 Windows 用户或变更服务器地址后需重新绑定工位；不会将管理员密码写进客户端配置。本次不设置开机启动或迁移业务数据。
"@
    [IO.File]::WriteAllText((Join-Path $folder '使用说明.md'),$note,$encoding)
    foreach($entry in $manifest.files) {
        $file=Join-Path $folder $entry.path
        $entry.bytes=(Get-Item -LiteralPath $file).Length
        $entry.sha256=Get-Sha256 $file
    }
    [IO.File]::WriteAllText($manifestPath,($manifest | ConvertTo-Json -Depth 6),$encoding)
    $inventory.Add([ordered]@{folder=$station.folder;module=$station.module;labCode=$station.labCode;labName=$station.labName;executable=$manifest.executable;entryPath=$manifest.entryPath;serverUrl=$ServerUrl.TrimEnd('/');version=$manifest.version})
    $rows.Add('| '+$station.folder+' | '+$manifest.executable+' |')
}
$readme=@"
# MES 工位专用客户端 v1.7.0

共 11 个实验间和可视化、接驳区、暂存间、外观检测间 4 个独立页面，共 15 个文件夹。每个文件夹均可独立运行，不依赖总文件夹中的其他工位。

| 工位 | 启动程序 |
|---|---|
$($rows -join "`n")

当前按本机测试连接 ``$($ServerUrl.TrimEnd('/'))``，需先保持现有 MES 服务运行。本机工位绑定完成后，打开对应文件夹并双击 EXE 自动进入；新电脑需由管理员先执行一次绑定，不会使用匿名认证。

中控三合一保留页签与登录，可视化保留普通窗口；其余工位直接无边框全屏。非中控客户端不显示单页页签，页面“退出登录”改为“关闭”，与 Alt+F4 共用一次二次确认。关闭单个工位只关闭该客户端；控制中心 v2.8.2 仍按“关闭系统并退出”执行。

后续复制到其他电脑时，保留整个文件夹，配置正确的 ``serverUrl`` 并由管理员重新绑定。已有工位凭据存储在本机 Windows 用户目录，不随文件夹复制。本次仅配置本机，未迁移其他电脑或操作实验流程。

运行环境：Windows x64、.NET Framework 4.8、Microsoft Edge WebView2 Runtime。当前本机已有运行库。``workstations-manifest.json`` 与各子目录 ``client-manifest.json`` 用于文件和版本校验。
"@
[IO.File]::WriteAllText((Join-Path $output '使用说明.md'),$readme,$encoding)
[IO.File]::WriteAllText((Join-Path $output '工位清单.json'),($inventory.ToArray() | ConvertTo-Json -Depth 6),$encoding)
$files=@(foreach($file in Get-ChildItem -LiteralPath $output -File -Recurse) {
    [ordered]@{path=$file.FullName.Substring($output.Length+1).Replace('\','/');bytes=$file.Length;sha256=(Get-Sha256 $file.FullName)}
})
$manifest=[ordered]@{format='mes-workstation-clients';format_version=1;version='1.7.0';serverUrl=$ServerUrl.TrimEnd('/');workstations=$inventory.ToArray();files=$files}
[IO.File]::WriteAllText((Join-Path $output 'workstations-manifest.json'),($manifest | ConvertTo-Json -Depth 8),$encoding)
Write-Output ('Workstation clients built: '+$output)
