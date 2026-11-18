param(
    [string]$ProjectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path,
    [string]$OutputPath = (Join-Path ([Environment]::GetFolderPath("Desktop")) "MES控制中心_v2.10.0.exe"),
    [string]$IconPath = (Join-Path (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path "assets\mes-control-center-blue.ico"),
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

function New-ControlCenterIcon {
    param([string]$Path)
    $source=Join-Path (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path 'assets/mes-control-center-blue.ico'
    if(-not (Test-Path -LiteralPath $source)){throw 'Control-center icon asset is missing.'}
    $destination=[IO.Path]::GetFullPath($Path)
    if(-not [string]::Equals([IO.Path]::GetFullPath($source),$destination,[StringComparison]::OrdinalIgnoreCase)){
        [IO.Directory]::CreateDirectory((Split-Path -Parent $destination))|Out-Null
        Copy-Item -LiteralPath $source -Destination $destination -Force
    }
}

$projectRootPath = (Resolve-Path -LiteralPath $ProjectRoot).Path
$controlCenterSource = Join-Path $projectRootPath "tools\control-center\MESControlCenter.cs"
$themeSource = Join-Path $projectRootPath "tools\control-center\ControlCenterTheme.cs"
$terminalSource = Join-Path $projectRootPath "scripts\client\MESTerminalManager.cs"
$discoverySource = Join-Path $projectRootPath "scripts\client\MESServerDiscovery.cs"
$controlScript = Join-Path $projectRootPath "scripts\mes-service-control.ps1"
foreach ($requiredPath in @($controlCenterSource, $themeSource, $terminalSource, $discoverySource, $controlScript,
    (Join-Path $projectRootPath 'scripts/MesHttpProbes.cs'), (Join-Path $projectRootPath 'scripts/MesTcpListeners.cs'))) {
    if (-not (Test-Path -LiteralPath $requiredPath)) { throw "Cannot find required control-center input: $requiredPath" }
}

New-ControlCenterIcon -Path $IconPath
$outputDirectory = Split-Path -Parent $OutputPath
if ($outputDirectory) { New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null }

$temporaryControlSource = Join-Path ([System.IO.Path]::GetTempPath()) ("MESControlCenter-" + [Guid]::NewGuid().ToString("N") + ".cs")
$temporaryTerminalSource = Join-Path ([System.IO.Path]::GetTempPath()) ("MESTerminalClient-" + [Guid]::NewGuid().ToString("N") + ".cs")
$temporaryManifest = Join-Path ([System.IO.Path]::GetTempPath()) ("MESControlCenter-" + [Guid]::NewGuid().ToString("N") + ".manifest")
$escapedProjectRoot = $projectRootPath.Replace('"', '""')
(Get-Content -Encoding UTF8 -LiteralPath $controlCenterSource -Raw).Replace("__PROJECT_ROOT__", $escapedProjectRoot) |
    Set-Content -LiteralPath $temporaryControlSource -Encoding UTF8

$terminalText = Get-Content -Encoding UTF8 -LiteralPath $terminalSource -Raw
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
        "/nologo", "/target:winexe", "/platform:anycpu", "/optimize+", "/codepage:65001",
        "/reference:System.Windows.Forms.dll", "/reference:System.Drawing.dll",
        "/reference:System.Web.Extensions.dll", "/reference:System.Management.dll", "/win32icon:$IconPath",
        "/reference:System.IO.Compression.dll", "/reference:System.IO.Compression.FileSystem.dll",
        ("/resource:" + [IO.Path]::GetFullPath($IconPath) + ",MESControlCenter.Icon.ico"),
        "/out:$OutputPath"
    )
    if (-not $NoAdminManifest) { $arguments += "/win32manifest:$temporaryManifest" }
    $arguments += @($temporaryControlSource, $themeSource, $temporaryTerminalSource, $discoverySource, (Join-Path $projectRootPath 'tools/control-center/MESAccessInfo.cs'), (Join-Path $projectRootPath 'tools/control-center/ControlCenterPaths.cs'))
    $arguments += @((Join-Path $projectRootPath 'tools/control-center/MESConfiguration.cs'),
        (Join-Path $projectRootPath 'tools/control-center/ComponentIntegrity.cs'),
        (Join-Path $projectRootPath 'tools/control-center/TerminalEnrollmentPanel.cs'),
        ('/resource:' + (Join-Path $projectRootPath 'tools/control-center/MESConfigurationSchema.json') + ',MESConfigurationSchema.json'))
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
