[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$DesktopToolsDirectory, [switch]$NoShortcut)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
function Get-Sha256([string]$Path) {
    $stream = [IO.File]::OpenRead($Path)
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try { return -join ($algorithm.ComputeHash($stream) | ForEach-Object { $_.ToString('x2') }) }
    finally { $stream.Dispose(); $algorithm.Dispose() }
}
function Resolve-ToolPath([string]$Base, [string]$Value) {
    if ([IO.Path]::IsPathRooted($Value)) { return [IO.Path]::GetFullPath($Value) }
    return [IO.Path]::GetFullPath((Join-Path $Base $Value))
}
$target = (Resolve-Path -LiteralPath $DesktopToolsDirectory).Path
$configuration = Join-Path $target 'mes-desktop-tools.json'
if (-not (Test-Path -LiteralPath $configuration -PathType Leaf)) { throw '请选择包含 mes-desktop-tools.json 的原桌面工具目录。' }
$settings = Get-Content -Raw -Encoding UTF8 -LiteralPath $configuration | ConvertFrom-Json
$native = $settings.PSObject.Properties['deploymentMode'] -and $settings.deploymentMode -eq 'windows-service'
$variant = if ($native) { '原生版' } else { 'Docker版' }
$name = 'MES控制中心_' + $variant + '.exe'
$executable = Join-Path $target $name
if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) { throw "所选目录缺少 $name" }
foreach ($process in Get-Process -Name ([IO.Path]::GetFileNameWithoutExtension($name)) -ErrorAction SilentlyContinue) {
    if (-not $process.Path -or [IO.Path]::GetFullPath($process.Path) -eq $executable) { throw '请先关闭要升级的控制中心窗口，再重新运行。MES 后台服务可保持运行。' }
}
$mapping = @([pscustomobject]@{Key=($variant+'/'+$name);Target=$executable;Backup=$name})
$release = ''
if (-not $native) {
    $release = Resolve-ToolPath $target ([string]$settings.deploymentDirectory)
    if (-not (Test-Path -LiteralPath (Join-Path $release 'compose.portable.yml') -PathType Leaf)) { throw '连接配置中的 Docker release 目录无效，无法升级启动逻辑。' }
    $mapping += [pscustomobject]@{Key='Docker版/scripts/docker-service-control.ps1';Target=(Join-Path $target 'scripts/docker-service-control.ps1');Backup='scripts/docker-service-control.ps1'}
    foreach ($file in @('Mes-PortableHost.ps1','Mes-Portable.ps1')) {
        $mapping += [pscustomobject]@{Key=('部署更新/scripts/deploy/'+$file);Target=(Join-Path $release ('scripts/deploy/'+$file));Backup=('release/scripts/deploy/'+$file)}
    }
}
$manifest = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $PSScriptRoot 'update-manifest.json') | ConvertFrom-Json
foreach ($file in $mapping) {
    $entry = @($manifest.files | Where-Object { $_.path -ceq $file.Key })
    $source = Join-Path $PSScriptRoot $file.Key
    if ($entry.Count -ne 1 -or -not (Test-Path -LiteralPath $source -PathType Leaf)) { throw ('更新文件缺失：'+$file.Key) }
    if ((Get-Sha256 $source) -cne $entry[0].sha256) { throw ('更新文件校验不符：'+$file.Key) }
}
$backup = Join-Path $target ('control-center-backup-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff'))
New-Item -ItemType Directory -Path $backup | Out-Null
Copy-Item -LiteralPath $configuration -Destination (Join-Path $backup 'mes-desktop-tools.json')
foreach ($file in $mapping) {
    if (Test-Path -LiteralPath $file.Target -PathType Leaf) {
        $saved = Join-Path $backup $file.Backup
        New-Item -ItemType Directory -Path (Split-Path -Parent $saved) -Force | Out-Null
        Copy-Item -LiteralPath $file.Target -Destination $saved
    }
}
$releaseManifestPath = if ($release) { Join-Path $release 'manifest.json' } else { '' }
if ($releaseManifestPath -and (Test-Path -LiteralPath $releaseManifestPath)) { Copy-Item -LiteralPath $releaseManifestPath -Destination (Join-Path $backup 'release-manifest.json') }
try {
    foreach ($file in $mapping) {
        New-Item -ItemType Directory -Path (Split-Path -Parent $file.Target) -Force | Out-Null
        Copy-Item -LiteralPath (Join-Path $PSScriptRoot $file.Key) -Destination $file.Target -Force
    }
    if ($releaseManifestPath -and (Test-Path -LiteralPath $releaseManifestPath)) {
        $releaseManifest = Get-Content -Raw -Encoding UTF8 -LiteralPath $releaseManifestPath | ConvertFrom-Json
        $entries = @($releaseManifest.files | Where-Object { $_.path -notin @('scripts/deploy/Mes-Portable.ps1','scripts/deploy/Mes-PortableHost.ps1') })
        foreach ($file in @('scripts/deploy/Mes-Portable.ps1','scripts/deploy/Mes-PortableHost.ps1')) {
            $path = Join-Path $release $file
            $entries += [pscustomobject]@{path=$file;bytes=(Get-Item -LiteralPath $path).Length;sha256=(Get-Sha256 $path)}
        }
        $releaseManifest.files = $entries
        $releaseManifest | Add-Member -NotePropertyName control_center_update -NotePropertyValue '2.7.2' -Force
        [IO.File]::WriteAllText($releaseManifestPath, ($releaseManifest | ConvertTo-Json -Depth 15), (New-Object Text.UTF8Encoding($false)))
    }
} catch {
    foreach ($file in $mapping) {
        $saved = Join-Path $backup $file.Backup
        if (Test-Path -LiteralPath $saved) { Copy-Item -LiteralPath $saved -Destination $file.Target -Force }
        elseif ([IO.File]::Exists($file.Target)) { [IO.File]::Delete($file.Target) }
    }
    if ($releaseManifestPath -and (Test-Path -LiteralPath (Join-Path $backup 'release-manifest.json'))) { Copy-Item -LiteralPath (Join-Path $backup 'release-manifest.json') -Destination $releaseManifestPath -Force }
    throw
}
if (Test-Path -LiteralPath (Join-Path $target 'desktop-tools-manifest.json')) {
    Move-Item -LiteralPath (Join-Path $target 'desktop-tools-manifest.json') -Destination (Join-Path $backup 'desktop-tools-manifest.json')
}
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'update-manifest.json') -Destination (Join-Path $target 'control-center-update-manifest.json') -Force
if (-not $NoShortcut) {
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Desktop')) ('MES控制中心_v2.7.2_'+$variant+'.lnk')))
    $shortcut.TargetPath = $executable
    $shortcut.WorkingDirectory = $target
    $shortcut.IconLocation = $executable + ',0'
    $shortcut.Save()
}
Write-Output "MES 控制中心已升级为 v2.7.2（$variant），备份：$backup"
if (-not $NoShortcut) { Write-Output '桌面已提供 v2.7.2 快捷方式。' }
Write-Output 'v2.7.2 统一打开和关闭 MES、LIMS、上位机模拟器三个网页。旧版本已打开的普通标签页需手动关闭一次；当前业务服务保持原状态。'
