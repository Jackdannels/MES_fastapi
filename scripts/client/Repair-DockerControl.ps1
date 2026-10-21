[CmdletBinding()]
param([string]$DeploymentDirectory='')
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
function Get-Digest([string]$Path){
    $stream=[IO.File]::OpenRead($Path);$algorithm=[Security.Cryptography.SHA256]::Create()
    try{return -join ($algorithm.ComputeHash($stream)|ForEach-Object {$_.ToString('x2')})}finally{$stream.Dispose();$algorithm.Dispose()}
}
function Is-Delivery([string]$Path){
    return (Test-Path -LiteralPath (Join-Path $Path 'delivery-manifest.json') -PathType Leaf) -and
        (Test-Path -LiteralPath (Join-Path $Path 'Deploy-MES.ps1') -PathType Leaf)
}
if(-not $DeploymentDirectory){
    foreach($candidate in @($PSScriptRoot,(Split-Path -Parent $PSScriptRoot),(Join-Path ([Environment]::GetFolderPath('Desktop')) 'MES_Docker离线交付_20261021-r1'))){
        if(Is-Delivery $candidate){$DeploymentDirectory=$candidate;break}
    }
}
if(-not $DeploymentDirectory){
    Add-Type -AssemblyName System.Windows.Forms
    $dialog=New-Object Windows.Forms.FolderBrowserDialog
    $dialog.Description='请选择新 PC 上的 MES_Docker离线交付_20261021-r1 文件夹（包含 01-Deploy.cmd）'
    try{if($dialog.ShowDialog() -ne 'OK'){throw '已取消修复'};$DeploymentDirectory=$dialog.SelectedPath}finally{$dialog.Dispose()}
}
$root=(Resolve-Path -LiteralPath $DeploymentDirectory).Path
if(-not (Is-Delivery $root)){throw '请选择包含 delivery-manifest.json 和 Deploy-MES.ps1 的交付根目录'}
$payload=Join-Path $PSScriptRoot 'docker-service-control.ps1'
$fix=Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $PSScriptRoot 'repair-manifest.json')|ConvertFrom-Json
if((Get-Digest $payload) -cne $fix.controllerSha256){throw '修复脚本校验不符，请重新复制整个修复包'}
$deployerPayload=Join-Path $PSScriptRoot 'Deploy-MES.ps1'
$updateDeployer=[bool]$fix.PSObject.Properties['deployerSha256']
if($updateDeployer -and (Get-Digest $deployerPayload) -cne $fix.deployerSha256){throw '部署入口校验不符，请重新复制整个修复包'}
$revision=if($fix.PSObject.Properties['revision']){[string]$fix.revision}else{'2026.10.21-stderr-fix1'}
$manifestPath=Join-Path $root 'delivery-manifest.json'
$manifest=Get-Content -Raw -Encoding UTF8 -LiteralPath $manifestPath|ConvertFrom-Json
if($manifest.format -ne 'mes-portable-click-deployment' -or $manifest.version -ne '2026.10.21-r1'){throw '该修复包用于 2026.10.21-r1 Docker 交付包'}
$relative=[string]$manifest.desktopDirectory
if([IO.Path]::IsPathRooted($relative) -or $relative -match '(^|[\\/])\.\.([\\/]|$)|:'){throw '交付包桌面目录无效'}
$desktop=Join-Path $root $relative
$runtime=Join-Path $root '.local/desktop-tools'
$stamp=Get-Date -Format 'yyyyMMdd-HHmmss-fff'
$backup=Join-Path $root ('.local/control-repair-'+$stamp)
New-Item -ItemType Directory -Path $backup -Force|Out-Null
Copy-Item -LiteralPath $manifestPath -Destination (Join-Path $backup 'delivery-manifest.json')
$targets=@((Join-Path $desktop 'scripts/docker-service-control.ps1'))
if(Test-Path -LiteralPath $runtime -PathType Container){$targets+=(Join-Path $runtime 'scripts/docker-service-control.ps1')}
$index=0
foreach($target in $targets){
    $resolved=[IO.Path]::GetFullPath($target)
    if(-not $resolved.StartsWith([IO.Path]::GetFullPath($root).TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase)){throw '修复目标目录无效'}
    if(Test-Path -LiteralPath $target){Copy-Item -LiteralPath $target -Destination (Join-Path $backup ("controller-"+$index+'.ps1'))}
    New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force|Out-Null
    Copy-Item -LiteralPath $payload -Destination $target -Force
    $index++
}
if($updateDeployer){
    Copy-Item -LiteralPath (Join-Path $root 'Deploy-MES.ps1') -Destination (Join-Path $backup 'Deploy-MES.ps1')
    Copy-Item -LiteralPath $deployerPayload -Destination (Join-Path $root 'Deploy-MES.ps1') -Force
}
$desktopManifest=Join-Path $desktop 'desktop-tools-manifest.json'
if(Test-Path -LiteralPath $desktopManifest){
    $tools=Get-Content -Raw -Encoding UTF8 -LiteralPath $desktopManifest|ConvertFrom-Json
    foreach($entry in $tools.files){if($entry.path -eq 'scripts/docker-service-control.ps1'){$entry.bytes=(Get-Item -LiteralPath (Join-Path $desktop $entry.path)).Length;$entry.sha256=Get-Digest (Join-Path $desktop $entry.path)}}
    $tools|Add-Member -NotePropertyName controllerScriptRevision -NotePropertyValue $revision -Force
    [IO.File]::WriteAllText($desktopManifest,($tools|ConvertTo-Json -Depth 10),(New-Object Text.UTF8Encoding($false)))
}
$changed=@(($relative.Replace('\','/')+'/scripts/docker-service-control.ps1'),($relative.Replace('\','/')+'/desktop-tools-manifest.json'))
if($updateDeployer){$changed+='Deploy-MES.ps1'}
foreach($entry in $manifest.files){
    if($entry.path -in $changed){$path=Join-Path $root $entry.path;$entry.bytes=(Get-Item -LiteralPath $path).Length;$entry.sha256=Get-Digest $path}
}
$manifest|Add-Member -NotePropertyName controllerScriptRevision -NotePropertyValue $revision -Force
[IO.File]::WriteAllText($manifestPath,($manifest|ConvertTo-Json -Depth 15),(New-Object Text.UTF8Encoding($false)))
$sums=@($manifest.files|ForEach-Object {$_.sha256+'  '+$_.path}) -join "`n"
[IO.File]::WriteAllText((Join-Path $root 'SHA256SUMS.txt'),$sums+"`n",(New-Object Text.UTF8Encoding($false)))
Write-Host '修复完成。请关闭再打开 MES 控制中心，然后点击“启动系统”；若服务已经正常运行，可直接使用。' -ForegroundColor Green
Write-Host ('旧控制脚本已备份：'+$backup)
Write-Host '启动或重启成功后会自动打开 MES 与 LIMS 页面。本次修复未启停服务，也未修改数据或账号配置。'
