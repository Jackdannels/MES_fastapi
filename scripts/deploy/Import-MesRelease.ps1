[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ReleaseDirectory
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

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

$release = (Resolve-Path -LiteralPath $ReleaseDirectory).Path
$manifestPath = Join-Path $release "release-manifest.json"
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    throw "Release manifest not found: $manifestPath"
}
$manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json

foreach ($entry in $manifest.files) {
    $path = Join-Path $release ([string]$entry.path)
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "Release file is missing: $($entry.path)"
    }
    $actual = Get-Sha256 $path
    if ($actual -ne ([string]$entry.sha256).ToLowerInvariant()) {
        throw "Checksum mismatch: $($entry.path)"
    }
}

& docker load --input (Join-Path $release "mes-images.tar")
if ($LASTEXITCODE -ne 0) {
    throw "docker load failed."
}
& docker image inspect ([string]$manifest.api_image) ([string]$manifest.web_image) | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw "Loaded images do not match the release manifest references."
}

Write-Host "Release checksums and image references verified. Nothing was started."
