param(
    [string]$ProjectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path,
    [string]$OutputPath = (Join-Path ([Environment]::GetFolderPath("Desktop")) "MES控制中心_v2.0.exe"),
    [string]$IconPath = (Join-Path (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path "assets\mes-control-center.ico"),
    [switch]$NoAdminManifest
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
    throw "Cannot find csc.exe. Install .NET Framework build tools or Visual Studio Build Tools."
}

function New-RoundedRectanglePath {
    param([System.Drawing.RectangleF]$Rectangle, [float]$Radius)
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

function New-ControlCenterIcon {
    param([string]$Path)
    Add-Type -AssemblyName System.Drawing
    $directory = Split-Path -Parent $Path
    if ($directory) { New-Item -ItemType Directory -Force -Path $directory | Out-Null }

    $bitmap = New-Object System.Drawing.Bitmap(256, 256)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.Clear([System.Drawing.Color]::Transparent)
    $outer = New-Object System.Drawing.RectangleF(12, 12, 232, 232)
    $outerPath = New-RoundedRectanglePath -Rectangle $outer -Radius 52
    $outerBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(16, 40, 45))
    $graphics.FillPath($outerBrush, $outerPath)
    $borderPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(72, 128, 129), 5)
    $graphics.DrawPath($borderPen, $outerPath)

    $accent = [System.Drawing.Color]::FromArgb(82, 208, 181)
    $linePen = New-Object System.Drawing.Pen($accent, 15)
    $linePen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $linePen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $graphics.DrawRectangle($linePen, 53, 83, 150, 105)
    $graphics.DrawLine($linePen, 91, 83, 91, 55)
    $graphics.DrawLine($linePen, 91, 55, 165, 55)
    $graphics.DrawLine($linePen, 165, 55, 165, 83)
    $graphics.DrawLine($linePen, 76, 119, 121, 119)
    $graphics.DrawLine($linePen, 76, 153, 142, 153)
    $graphics.DrawLine($linePen, 172, 111, 172, 163)
    $graphics.DrawLine($linePen, 151, 137, 193, 137)

    $graphics.Flush()
    $pngStream = New-Object System.IO.MemoryStream
    $bitmap.Save($pngStream, [System.Drawing.Imaging.ImageFormat]::Png)
    $pngBytes = $pngStream.ToArray()
    $stream = [System.IO.File]::Create($Path)
    $writer = New-Object System.IO.BinaryWriter($stream)
    try {
        $writer.Write([uint16]0)
        $writer.Write([uint16]1)
        $writer.Write([uint16]1)
        $writer.Write([byte]0)
        $writer.Write([byte]0)
        $writer.Write([byte]0)
        $writer.Write([byte]0)
        $writer.Write([uint16]1)
        $writer.Write([uint16]32)
        $writer.Write([uint32]$pngBytes.Length)
        $writer.Write([uint32]22)
        $writer.Write($pngBytes)
    }
    finally {
        $writer.Dispose()
        $pngStream.Dispose()
        $linePen.Dispose()
        $borderPen.Dispose()
        $outerBrush.Dispose()
        $outerPath.Dispose()
        $graphics.Dispose()
        $bitmap.Dispose()
    }
}

$projectRootPath = (Resolve-Path -LiteralPath $ProjectRoot).Path
$controlCenterSource = Join-Path $projectRootPath "tools\control-center\MESControlCenter.cs"
$terminalSource = Join-Path $projectRootPath "scripts\client\MESTerminalManager.cs"
$controlScript = Join-Path $projectRootPath "scripts\mes-service-control.ps1"
foreach ($requiredPath in @($controlCenterSource, $terminalSource, $controlScript)) {
    if (-not (Test-Path -LiteralPath $requiredPath)) { throw "Cannot find required control-center input: $requiredPath" }
}

New-ControlCenterIcon -Path $IconPath
$outputDirectory = Split-Path -Parent $OutputPath
if ($outputDirectory) { New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null }

$temporaryControlSource = Join-Path ([System.IO.Path]::GetTempPath()) ("MESControlCenter-" + [Guid]::NewGuid().ToString("N") + ".cs")
$temporaryTerminalSource = Join-Path ([System.IO.Path]::GetTempPath()) ("MESTerminalClient-" + [Guid]::NewGuid().ToString("N") + ".cs")
$temporaryManifest = Join-Path ([System.IO.Path]::GetTempPath()) ("MESControlCenter-" + [Guid]::NewGuid().ToString("N") + ".manifest")
$escapedProjectRoot = $projectRootPath.Replace('"', '""')
(Get-Content -LiteralPath $controlCenterSource -Raw).Replace("__PROJECT_ROOT__", $escapedProjectRoot) |
    Set-Content -LiteralPath $temporaryControlSource -Encoding UTF8

$terminalText = Get-Content -LiteralPath $terminalSource -Raw
$terminalText = [regex]::Replace($terminalText, '(?m)^\[assembly:.*\]\s*\r?\n?', '')
$programStart = $terminalText.LastIndexOf("    internal static class Program")
if ($programStart -lt 0) { throw "Cannot locate terminal-manager Program class for source composition." }
$terminalText = $terminalText.Substring(0, $programStart) + "}`r`n"
$terminalText | Set-Content -LiteralPath $temporaryTerminalSource -Encoding UTF8

@'
<?xml version="1.0" encoding="utf-8"?>
<assembly manifestVersion="1.0" xmlns="urn:schemas-microsoft-com:asm.v1">
  <trustInfo xmlns="urn:schemas-microsoft-com:asm.v3">
    <security>
      <requestedPrivileges>
        <requestedExecutionLevel level="requireAdministrator" uiAccess="false" />
      </requestedPrivileges>
    </security>
  </trustInfo>
</assembly>
'@ | Set-Content -LiteralPath $temporaryManifest -Encoding UTF8

try {
    $csc = Resolve-CscPath
    $arguments = @(
        "/nologo", "/target:winexe", "/platform:anycpu", "/optimize+",
        "/reference:System.Windows.Forms.dll", "/reference:System.Drawing.dll",
        "/reference:System.Web.Extensions.dll", "/win32icon:$IconPath",
        "/out:$OutputPath"
    )
    if (-not $NoAdminManifest) { $arguments += "/win32manifest:$temporaryManifest" }
    $arguments += @($temporaryControlSource, $temporaryTerminalSource)
    & $csc $arguments
    if ($LASTEXITCODE -ne 0) { throw "MES control center compilation failed with exit code $LASTEXITCODE." }
}
finally {
    foreach ($temporaryPath in @($temporaryControlSource, $temporaryTerminalSource, $temporaryManifest)) {
        if (Test-Path -LiteralPath $temporaryPath) { Remove-Item -LiteralPath $temporaryPath -Force }
    }
}

Write-Host "MES control center built: $OutputPath"
Write-Host "Icon: $IconPath"
