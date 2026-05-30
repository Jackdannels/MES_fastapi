param(
    [string]$ProjectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path,
    [string]$OutputPath = (Join-Path ([Environment]::GetFolderPath("Desktop")) "MES启动器.exe"),
    [string]$IconPath = (Join-Path (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path "assets\mes-launcher.ico")
)

$ErrorActionPreference = "Stop"

function Resolve-CscPath {
    $candidates = @(
        "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe",
        "C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe"
    )

    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate) {
            return (Resolve-Path -LiteralPath $candidate).Path
        }
    }

    $command = Get-Command "csc.exe" -ErrorAction SilentlyContinue
    if ($command) {
        return $command.Source
    }

    throw "Cannot find csc.exe. Install .NET Framework build tools or Visual Studio Build Tools."
}

function New-RoundedRectanglePath {
    param(
        [System.Drawing.RectangleF]$Rectangle,
        [float]$Radius
    )

    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $diameter = $Radius * 2
    $arc = New-Object System.Drawing.RectangleF($Rectangle.X, $Rectangle.Y, $diameter, $diameter)
    $path.AddArc($arc, 180, 90)
    $arc.X = $Rectangle.Right - $diameter
    $path.AddArc($arc, 270, 90)
    $arc.Y = $Rectangle.Bottom - $diameter
    $path.AddArc($arc, 0, 90)
    $arc.X = $Rectangle.X
    $path.AddArc($arc, 90, 90)
    $path.CloseFigure()
    return $path
}

function New-LauncherIcon {
    param([string]$Path)

    Add-Type -AssemblyName System.Drawing
    Add-Type -AssemblyName System.Windows.Forms

    $directory = Split-Path -Parent $Path
    if ($directory) {
        New-Item -ItemType Directory -Force -Path $directory | Out-Null
    }

    $size = 256
    $bitmap = New-Object System.Drawing.Bitmap($size, $size)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    $graphics.Clear([System.Drawing.Color]::Transparent)

    $outer = New-Object System.Drawing.RectangleF(16, 16, 224, 224)
    $inner = New-Object System.Drawing.RectangleF(34, 34, 188, 188)
    $outerPath = New-RoundedRectanglePath -Rectangle $outer -Radius 46
    $innerPath = New-RoundedRectanglePath -Rectangle $inner -Radius 34

    $gradientRect = New-Object System.Drawing.Rectangle(0, 0, $size, $size)
    $gradient = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        $gradientRect,
        [System.Drawing.Color]::FromArgb(18, 108, 255),
        [System.Drawing.Color]::FromArgb(0, 176, 148),
        38
    )
    $graphics.FillPath($gradient, $outerPath)

    $shine = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        $gradientRect,
        [System.Drawing.Color]::FromArgb(80, 255, 255, 255),
        [System.Drawing.Color]::FromArgb(0, 255, 255, 255),
        90
    )
    $graphics.FillEllipse($shine, 34, 20, 160, 92)

    $innerBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(235, 9, 20, 38))
    $graphics.FillPath($innerBrush, $innerPath)

    $linePen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(220, 108, 240, 210), 10)
    $linePen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $linePen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $graphics.DrawLine($linePen, 70, 80, 186, 80)
    $graphics.DrawLine($linePen, 70, 128, 186, 128)
    $graphics.DrawLine($linePen, 70, 176, 186, 176)

    $font = New-Object System.Drawing.Font("Segoe UI", 48, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $textBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
    $format = New-Object System.Drawing.StringFormat
    $format.Alignment = [System.Drawing.StringAlignment]::Center
    $format.LineAlignment = [System.Drawing.StringAlignment]::Center
    $graphics.DrawString("MES", $font, $textBrush, (New-Object System.Drawing.RectangleF(42, 92, 172, 78)), $format)

    $iconHandle = $bitmap.GetHicon()
    $icon = [System.Drawing.Icon]::FromHandle($iconHandle)
    $stream = [System.IO.File]::Create($Path)
    try {
        $icon.Save($stream)
    } finally {
        $stream.Dispose()
        $icon.Dispose()
        $bitmap.Dispose()
        $graphics.Dispose()
    }
}

$projectRootPath = (Resolve-Path -LiteralPath $ProjectRoot).Path
$launcherSource = Join-Path $projectRootPath "tools\launcher\MesLauncher.cs"
$startScript = Join-Path $projectRootPath "start-dev.ps1"

if (-not (Test-Path -LiteralPath $launcherSource)) {
    throw "Cannot find launcher source: $launcherSource"
}
if (-not (Test-Path -LiteralPath $startScript)) {
    throw "Cannot find startup script: $startScript"
}

New-LauncherIcon -Path $IconPath

$outputDirectory = Split-Path -Parent $OutputPath
if ($outputDirectory) {
    New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
}

$temporarySource = Join-Path ([System.IO.Path]::GetTempPath()) ("MesLauncher-" + [Guid]::NewGuid().ToString("N") + ".cs")
$escapedProjectRoot = $projectRootPath.Replace('"', '""')
(Get-Content -LiteralPath $launcherSource -Raw).Replace("__PROJECT_ROOT__", $escapedProjectRoot) |
    Set-Content -LiteralPath $temporarySource -Encoding UTF8

try {
    $csc = Resolve-CscPath
    & $csc `
        /nologo `
        /target:winexe `
        /platform:anycpu `
        /optimize+ `
        /reference:System.Windows.Forms.dll `
        /win32icon:"$IconPath" `
        /out:"$OutputPath" `
        "$temporarySource"

    if ($LASTEXITCODE -ne 0) {
        throw "Launcher compilation failed with exit code $LASTEXITCODE."
    }
} finally {
    if (Test-Path -LiteralPath $temporarySource) {
        Remove-Item -LiteralPath $temporarySource -Force
    }
}

Write-Host "Launcher built: $OutputPath"
Write-Host "Icon: $IconPath"
