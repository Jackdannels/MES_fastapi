param(
    [string]$ProjectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path,
    [string]$OutputPath = (Join-Path ([Environment]::GetFolderPath("Desktop")) "MES终端管理_v1.1.exe")
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

$projectRootPath = (Resolve-Path -LiteralPath $ProjectRoot).Path
$sourcePath = Join-Path $projectRootPath "scripts\client\MESTerminalManager.cs"
$iconPath = Join-Path $projectRootPath "assets\mes-launcher.ico"
$outputDirectory = Split-Path -Parent $OutputPath
if (-not (Test-Path -LiteralPath $sourcePath)) { throw "Cannot find terminal manager source: $sourcePath" }
if (-not (Test-Path -LiteralPath $iconPath)) { throw "Cannot find terminal manager icon: $iconPath" }
if ($outputDirectory) { New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null }

$csc = Resolve-CscPath
& $csc /nologo /target:winexe /platform:anycpu /optimize+ `
    /reference:System.Windows.Forms.dll /reference:System.Drawing.dll `
    /reference:System.Web.Extensions.dll /win32icon:"$iconPath" `
    /out:"$OutputPath" "$sourcePath"
if ($LASTEXITCODE -ne 0) { throw "MES terminal manager compilation failed with exit code $LASTEXITCODE." }

Write-Host "MES terminal manager built: $OutputPath"
