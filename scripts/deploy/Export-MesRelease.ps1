[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ApiImage,
    [Parameter(Mandatory = $true)]
    [string]$WebImage,
    [Parameter(Mandatory = $true)]
    [string]$ReleaseVersion,
    [Parameter(Mandatory = $true)]
    [string]$OutputDirectory
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Assert-ImmutableImage([string]$Name, [string]$Reference) {
    if ($Reference -notmatch '@sha256:[0-9a-fA-F]{64}$') {
        throw "$Name must end with an immutable @sha256 digest."
    }
}

function Get-Sha256([string]$Path) {
    $stream = [System.IO.File]::OpenRead($Path)
    $algorithm = [System.Security.Cryptography.SHA256]::Create()
    try {
        $bytes = $algorithm.ComputeHash($stream)
        return -join ($bytes | ForEach-Object { $_.ToString("x2") })
    } finally {
        $algorithm.Dispose()
        $stream.Dispose()
    }
}

Assert-ImmutableImage "ApiImage" $ApiImage
Assert-ImmutableImage "WebImage" $WebImage

$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$release = [System.IO.Path]::GetFullPath($OutputDirectory)
if (Test-Path -LiteralPath $release) {
    throw "Output directory already exists: $release"
}

New-Item -ItemType Directory -Path $release | Out-Null
New-Item -ItemType Directory -Path (Join-Path $release "deploy\nginx") | Out-Null
New-Item -ItemType Directory -Path (Join-Path $release "scripts\deploy") | Out-Null
New-Item -ItemType Directory -Path (Join-Path $release "docs") | Out-Null

$archive = Join-Path $release "mes-images.tar"
& docker image inspect $ApiImage $WebImage | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw "One or more release images are not available locally. Load or pull the exact digests first."
}
& docker save --output $archive $ApiImage $WebImage
if ($LASTEXITCODE -ne 0) {
    throw "docker save failed."
}

Copy-Item (Join-Path $root "compose.production.yml") $release
Copy-Item (Join-Path $root "deploy\.env.production.example") (Join-Path $release "deploy")
Copy-Item (Join-Path $root "deploy\nginx\production-https.conf") (Join-Path $release "deploy\nginx")
Copy-Item (Join-Path $root "scripts\deploy\Import-MesRelease.ps1") (Join-Path $release "scripts\deploy")
Copy-Item (Join-Path $root "scripts\deploy\Test-ProductionDeployment.ps1") (Join-Path $release "scripts\deploy")
Copy-Item (Join-Path $root "docs\production-deployment.md") (Join-Path $release "docs")

$trackedFiles = Get-ChildItem -LiteralPath $release -File -Recurse | Where-Object { $_.Name -ne "release-manifest.json" }
$releasePrefix = $release.TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
$checksums = foreach ($file in $trackedFiles) {
    if (-not $file.FullName.StartsWith($releasePrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Release file escaped the output directory: $($file.FullName)"
    }
    $relative = $file.FullName.Substring($releasePrefix.Length).Replace("\", "/")
    [ordered]@{ path = $relative; sha256 = Get-Sha256 $file.FullName }
}
$manifest = [ordered]@{
    release_version = $ReleaseVersion
    created_at_utc = [DateTime]::UtcNow.ToString("o")
    api_image = $ApiImage
    web_image = $WebImage
    files = @($checksums)
}
$manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $release "release-manifest.json") -Encoding utf8

Write-Host "Offline release exported to $release"
