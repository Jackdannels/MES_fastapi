param(
    [string]$ProjectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path,
    [string]$OutputDirectory = (Join-Path ([Environment]::GetFolderPath("Desktop")) "MES工作台设置_v2.2"),
    [string]$OutputPath = "",
    [string]$DesktopCopyPath = (Join-Path ([Environment]::GetFolderPath("Desktop")) "MES工作台设置_v2.2.exe"),
    [string]$LegacyDesktopCopyPath = (Join-Path ([Environment]::GetFolderPath("Desktop")) "MES工作台设置_v2.1.exe")
)

$ErrorActionPreference = "Stop"

function Resolve-CscPath {
    $candidates = @(
        "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe",
        "C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe"
    )
    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate) { return (Resolve-Path -LiteralPath $candidate).Path }
    }
    $command = Get-Command "csc.exe" -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    throw "Cannot find csc.exe. Install .NET Framework build tools or Visual Studio Build Tools."
}

function New-WorkstationIcon {
    param([string]$Path)

    Add-Type -AssemblyName System.Drawing
    $directory = Split-Path -Parent $Path
    if ($directory) { New-Item -ItemType Directory -Force -Path $directory | Out-Null }
    $size = 256
    $bitmap = New-Object System.Drawing.Bitmap($size, $size)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    $graphics.Clear([System.Drawing.Color]::Transparent)

    $outer = New-Object System.Drawing.RectangleF(12, 12, 232, 232)
    $pathShape = New-Object System.Drawing.Drawing2D.GraphicsPath
    $diameter = 108
    $arc = New-Object System.Drawing.RectangleF($outer.X, $outer.Y, $diameter, $diameter)
    $pathShape.AddArc($arc, 180, 90)
    $arc.X = $outer.Right - $diameter
    $pathShape.AddArc($arc, 270, 90)
    $arc.Y = $outer.Bottom - $diameter
    $pathShape.AddArc($arc, 0, 90)
    $arc.X = $outer.X
    $pathShape.AddArc($arc, 90, 90)
    $pathShape.CloseFigure()

    $gradientRect = New-Object System.Drawing.Rectangle(0, 0, $size, $size)
    $gradient = New-Object System.Drawing.Drawing2D.LinearGradientBrush($gradientRect, [System.Drawing.Color]::FromArgb(18, 60, 72), [System.Drawing.Color]::FromArgb(7, 19, 25), 38)
    $graphics.FillPath($gradient, $pathShape)
    $border = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(99, 230, 190), 8)
    $graphics.DrawPath($border, $pathShape)

    # 方案 B「智造六核」：六边形工业徽章 + M 型协同核心。
    $hexPoints = [System.Drawing.PointF[]]@(
        (New-Object System.Drawing.PointF(128, 42)),
        (New-Object System.Drawing.PointF(198, 82)),
        (New-Object System.Drawing.PointF(198, 174)),
        (New-Object System.Drawing.PointF(128, 214)),
        (New-Object System.Drawing.PointF(58, 174)),
        (New-Object System.Drawing.PointF(58, 82))
    )
    $hexBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(10, 36, 43))
    $hexPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(47, 182, 212), 8)
    $hexPen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
    $graphics.FillPolygon($hexBrush, $hexPoints)
    $graphics.DrawPolygon($hexPen, $hexPoints)

    $markPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(244, 251, 255), 14)
    $markPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $markPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $markPen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
    $graphics.DrawLine($markPen, 82, 158, 82, 92)
    $graphics.DrawLine($markPen, 82, 92, 128, 130)
    $graphics.DrawLine($markPen, 128, 130, 174, 92)
    $graphics.DrawLine($markPen, 174, 92, 174, 158)

    $nodePen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(244, 251, 255), 3)
    $nodeBrushes = @(
        (New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(231, 183, 95))),
        (New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(99, 230, 190))),
        (New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(47, 182, 212)))
    )
    $nodes = @(@(128, 42), @(58, 174), @(198, 174))
    for ($index = 0; $index -lt $nodes.Count; $index++) {
        $node = $nodes[$index]
        $graphics.FillEllipse($nodeBrushes[$index], $node[0] - 10, $node[1] - 10, 20, 20)
        $graphics.DrawEllipse($nodePen, $node[0] - 10, $node[1] - 10, 20, 20)
    }

    $iconHandle = $bitmap.GetHicon()
    $icon = [System.Drawing.Icon]::FromHandle($iconHandle)
    $stream = [System.IO.File]::Create($Path)
    try { $icon.Save($stream) } finally {
        $stream.Dispose(); $icon.Dispose(); $bitmap.Dispose(); $graphics.Dispose()
    }
}

function Update-WindowsShellIconCache {
    if (-not ("MESWorkstationShellRefresh" -as [type])) {
        Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class MESWorkstationShellRefresh
{
    [DllImport("shell32.dll")]
    public static extern void SHChangeNotify(uint eventId, uint flags, IntPtr item1, IntPtr item2);
}
"@
    }
    [MESWorkstationShellRefresh]::SHChangeNotify(0x08000000, 0, [IntPtr]::Zero, [IntPtr]::Zero)
}

$projectRootPath = (Resolve-Path -LiteralPath $ProjectRoot).Path
$sourcePath = Join-Path $projectRootPath "scripts\client\MESWorkstationConfigurator.cs"
$iconPath = Join-Path $OutputDirectory "mes-workbench-v2.2.ico"
if (-not $OutputPath) { $OutputPath = Join-Path $OutputDirectory "MES工作台设置_v2.2.exe" }
if (-not (Test-Path -LiteralPath $sourcePath)) { throw "Cannot find configurator source: $sourcePath" }

New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
New-WorkstationIcon -Path $iconPath

$temporarySource = Join-Path ([System.IO.Path]::GetTempPath()) ("MESWorkstationConfigurator-" + [Guid]::NewGuid().ToString("N") + ".cs")
Copy-Item -LiteralPath $sourcePath -Destination $temporarySource -Force
try {
    $csc = Resolve-CscPath
    & $csc /nologo /target:winexe /platform:anycpu /optimize+ `
        /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Management.dll `
        /reference:System.Web.Extensions.dll /reference:System.Xml.dll /win32icon:"$iconPath" `
        /out:"$OutputPath" "$temporarySource"
    if ($LASTEXITCODE -ne 0) { throw "MES workstation configurator compilation failed with exit code $LASTEXITCODE." }
} finally {
    if (Test-Path -LiteralPath $temporarySource) { Remove-Item -LiteralPath $temporarySource -Force }
}

$releaseInfo = @"
MES 工作台设置 v2.2

默认局域网地址：http://mes-server:5173/
所有试验间、接驳区、暂存间、外观检测间缩放：100%
启动时自动清理专用 Edge 历史页面缩放记录
终端在线/IP/当前页面监听、远程刷新、远程关机与重启权限开关
新增：使用稳定 MES 主机名，主机 IP 变化后终端无需重新设置
新增：历史默认 IP 自动迁移，保留终端 ID、密钥和操作台绑定
实验室网址统一使用 LAB_* 英文编码
图标：方案 B「智造六核」— mes-workbench-v2.2.ico
"@
Set-Content -LiteralPath (Join-Path $OutputDirectory "版本说明.txt") -Value $releaseInfo -Encoding UTF8
$svgPath = Join-Path $projectRootPath "assets\mes-workbench-v1.5.svg"
if (Test-Path -LiteralPath $svgPath) { Copy-Item -LiteralPath $svgPath -Destination (Join-Path $OutputDirectory "mes-workbench-v2.2.svg") -Force }
$iconOptionsPath = Join-Path $projectRootPath "assets\mes-workbench-v1.4-icon-options.svg"
if (Test-Path -LiteralPath $iconOptionsPath) { Copy-Item -LiteralPath $iconOptionsPath -Destination (Join-Path $OutputDirectory "mes-workbench-v1.4-icon-options.svg") -Force }
$distPath = Join-Path $projectRootPath "frontend\dist"
if (Test-Path -LiteralPath $distPath) { Copy-Item -LiteralPath $distPath -Destination (Join-Path $OutputDirectory "frontend-dist") -Recurse -Force }
if ($LegacyDesktopCopyPath -and (Test-Path -LiteralPath $LegacyDesktopCopyPath)) {
    try {
        Remove-Item -LiteralPath $LegacyDesktopCopyPath -Force
    } catch {
        Write-Warning "Legacy workstation configurator is in use and was kept: $LegacyDesktopCopyPath"
    }
}
if ($DesktopCopyPath -and ((Resolve-Path -LiteralPath (Split-Path -Parent $DesktopCopyPath)).Path -ne (Resolve-Path -LiteralPath $OutputDirectory).Path)) {
    if (Test-Path -LiteralPath $DesktopCopyPath) { Remove-Item -LiteralPath $DesktopCopyPath -Force }
    Copy-Item -LiteralPath $OutputPath -Destination $DesktopCopyPath -Force
    Update-WindowsShellIconCache
}

Write-Host "MES workstation configurator built: $OutputPath"
Write-Host "Desktop copy: $DesktopCopyPath"
Write-Host "Icon: $iconPath"
