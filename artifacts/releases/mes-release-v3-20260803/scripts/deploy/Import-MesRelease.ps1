[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)] [string]$ReleaseDirectory,
    [switch]$VerifyOnly
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

function Assert-ExactProperties([object]$Value, [string[]]$Expected, [string]$Context) {
    if ($null -eq $Value -or $null -eq $Value.PSObject) {
        throw "$Context must be a JSON object."
    }
    $actual = @($Value.PSObject.Properties.Name)
    foreach ($name in $Expected) {
        if (-not ($actual -ccontains $name)) { throw "$Context is missing property: $name" }
    }
    foreach ($name in $actual) {
        if (-not ($Expected -ccontains $name)) { throw "$Context contains unknown property: $name" }
    }
}

function Assert-ImmutableImage([string]$Name, [string]$Reference) {
    if ($Reference -notmatch '^[^@\s]+@sha256:[0-9a-f]{64}$') {
        throw "$Name must end with an immutable lowercase @sha256 digest."
    }
}

function Assert-Sha256([string]$Name, [object]$Value) {
    if ([string]$Value -notmatch '^[0-9a-f]{64}$') {
        throw "$Name must be a lowercase SHA-256 digest."
    }
}

function ConvertTo-NonNegativeInt64([string]$Name, [object]$Value) {
    $parsed = [long]0
    if ($null -eq $Value -or -not [long]::TryParse(([string]$Value), [ref]$parsed) -or $parsed -lt 0) {
        throw "$Name must be a non-negative integer."
    }
    return $parsed
}

function Assert-SafePathPart([string]$Part, [string]$RelativePath) {
    if (-not $Part -or $Part -eq "." -or $Part -eq "..") {
        throw "Release path contains an unsafe segment: $RelativePath"
    }
    if ($Part.EndsWith(".") -or $Part.EndsWith(" ")) {
        throw "Release path segment must not end in a dot or space: $RelativePath"
    }
    $baseName = $Part.Split('.')[0].ToUpperInvariant()
    $reserved = @("CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9")
    if ($reserved -ccontains $baseName) {
        throw "Release path uses a reserved Windows name: $RelativePath"
    }
}

function Resolve-SafeReleaseFile([string]$Root, [object]$ManifestPath) {
    $relative = [string]$ManifestPath
    if (-not $relative -or $relative.Contains("\") -or $relative.Contains(":")) {
        throw "Release path must be a non-empty POSIX relative path: $relative"
    }
    foreach ($character in $relative.ToCharArray()) {
        if ([char]::IsControl($character)) { throw "Release path contains a control character." }
    }
    if ($relative.StartsWith("/") -or $relative.StartsWith("//")) {
        throw "Absolute or UNC release paths are not allowed: $relative"
    }
    $parts = $relative.Split([char]'/', [System.StringSplitOptions]::None)
    foreach ($part in $parts) { Assert-SafePathPart $part $relative }

    $native = [string]::Join([System.IO.Path]::DirectorySeparatorChar, $parts)
    $full = [System.IO.Path]::GetFullPath((Join-Path $Root $native))
    $prefix = $Root.TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
    if (-not $full.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Release path escaped the release directory: $relative"
    }

    $current = $Root
    foreach ($part in $parts) {
        $current = Join-Path $current $part
        if (Test-Path -LiteralPath $current) {
            $item = Get-Item -Force -LiteralPath $current
            if ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
                throw "Release paths must not contain reparse points: $relative"
            }
        }
    }
    return [ordered]@{ relative = $relative; full = $full }
}

function Assert-ArchiveImageDigests([string]$ArchivePath, [string[]]$References) {
    $indexJson = & tar -xOf $ArchivePath index.json
    if ($LASTEXITCODE -ne 0) { throw "Could not read index.json from Docker image archive." }
    try {
        $index = ($indexJson -join "`n") | ConvertFrom-Json
    } catch {
        throw "Docker image archive index.json is invalid JSON."
    }
    if ($index.schemaVersion -ne 2 -or -not $index.manifests) {
        throw "Docker image archive is not a supported OCI index."
    }
    $actual = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::Ordinal)
    foreach ($entry in @($index.manifests)) {
        $digest = [string]$entry.digest
        if ($digest -notmatch '^sha256:[0-9a-f]{64}$' -or -not $actual.Add($digest)) {
            throw "Docker image archive contains an invalid or duplicate top-level digest."
        }
    }
    $expected = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::Ordinal)
    foreach ($reference in $References) {
        $digest = $reference.Substring($reference.LastIndexOf("@") + 1)
        if (-not $expected.Add($digest)) { throw "Release image digest is duplicated: $digest" }
    }
    if (-not $expected.SetEquals($actual)) {
        throw "Docker image archive digest set does not match release-manifest.json."
    }
}

function Get-ExistingImage([string]$Reference) {
    $previousPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = "Continue"
        $json = & docker image inspect $Reference 2>$null
        $exitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previousPreference
    }
    if ($exitCode -ne 0) { return $null }
    $items = @(($json -join "`n") | ConvertFrom-Json)
    if ($items.Count -ne 1) { throw "Docker returned an unexpected image inspection result: $Reference" }
    return $items[0]
}

$release = (Resolve-Path -LiteralPath $ReleaseDirectory).Path
$releaseItem = Get-Item -Force -LiteralPath $release
if (-not $releaseItem.PSIsContainer) { throw "ReleaseDirectory must be a directory." }
if ($releaseItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
    throw "ReleaseDirectory must not be a reparse point."
}
$manifestPath = Join-Path $release "release-manifest.json"
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    throw "Release manifest not found: $manifestPath"
}
if ((Get-Item -Force -LiteralPath $manifestPath).Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
    throw "Release manifest must not be a reparse point."
}
try {
    $manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
} catch {
    throw "Release manifest is invalid JSON."
}

$images = @()
$fileEntries = @()

Assert-ExactProperties $manifest @("format", "format_version", "release_version", "created_at_utc", "archive", "images", "files") "release manifest"
if ([string]$manifest.format -cne "mes-offline-release" -or $manifest.format_version -ne 3) {
    throw "Only the current release manifest v3 format is supported."
}
Assert-ExactProperties $manifest.archive @("path", "bytes", "sha256") "release manifest archive"
$archiveDeclaration = [ordered]@{
    path = [string]$manifest.archive.path
    bytes = ConvertTo-NonNegativeInt64 "archive.bytes" $manifest.archive.bytes
    sha256 = [string]$manifest.archive.sha256
}
Assert-Sha256 "archive.sha256" $archiveDeclaration.sha256

$expectedRoles = @("api", "web", "mysql-client", "rabbitmq", "reports-tool")
$rawImages = @($manifest.images)
if ($rawImages.Count -ne $expectedRoles.Count) {
    throw "Release manifest v3 must contain exactly five image roles."
}
for ($index = 0; $index -lt $rawImages.Count; $index++) {
    $entry = $rawImages[$index]
    Assert-ExactProperties $entry @("role", "reference", "image_id", "os", "architecture") "release image entry"
    if ([string]$entry.role -cne $expectedRoles[$index]) { throw "Release image roles are missing, duplicated, or out of order." }
    Assert-ImmutableImage "release image $($entry.role)" ([string]$entry.reference)
    if ([string]$entry.image_id -notmatch '^sha256:[0-9a-f]{64}$') { throw "Release image_id is invalid: $($entry.role)" }
    if (-not ([string]$entry.os).Trim() -or -not ([string]$entry.architecture).Trim()) { throw "Release image platform is incomplete." }
    $images += [ordered]@{
        role = [string]$entry.role
        reference = [string]$entry.reference
        image_id = [string]$entry.image_id
        os = [string]$entry.os
        architecture = [string]$entry.architecture
    }
}

if (-not ([string]$manifest.release_version).Trim()) { throw "release_version is required." }
try { [DateTimeOffset]::Parse([string]$manifest.created_at_utc) | Out-Null } catch { throw "created_at_utc is invalid." }

$seenPaths = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
$previousPath = $null
foreach ($entry in @($manifest.files)) {
    Assert-ExactProperties $entry @("path", "bytes", "sha256") "release file entry"
    $resolved = Resolve-SafeReleaseFile $release $entry.path
    if (-not $seenPaths.Add([string]$resolved.relative)) { throw "Duplicate or case-colliding release path: $($resolved.relative)" }
    if ($null -ne $previousPath -and [System.StringComparer]::Ordinal.Compare($previousPath, [string]$resolved.relative) -gt 0) {
        throw "Release file entries must be sorted by ordinal path."
    }
    $previousPath = [string]$resolved.relative
    Assert-Sha256 "file sha256" $entry.sha256
    $bytes = ConvertTo-NonNegativeInt64 "file bytes" $entry.bytes
    $fileEntries += [ordered]@{
        path = [string]$resolved.relative
        full = [string]$resolved.full
        bytes = $bytes
        sha256 = [string]$entry.sha256
    }
}

$requiredFiles = @(
    "compose.production.yml",
    "compose.packaging.yml",
    "compose.stage4.yml",
    "deploy/.env.production.example",
    "deploy/.env.stage4.example",
    "deploy/mysql/init-users.sh",
    "deploy/nginx/production-https.conf",
    "docs/production-deployment.md",
    "mes-images.tar",
    "scripts/deploy/Backup-MesDatabase.ps1",
    "scripts/deploy/Backup-MesReports.ps1",
    "scripts/deploy/Import-MesRelease.ps1",
    "scripts/deploy/Invoke-Stage4Acceptance.ps1",
    "scripts/deploy/New-MesDeploymentOperation.ps1",
    "scripts/deploy/Restore-MesRehearsal.ps1",
    "scripts/deploy/Restore-MesReportsRehearsal.ps1",
    "scripts/deploy/Test-ProductionDeployment.ps1",
    "scripts/deploy/mysql-backup-restore.sh",
    "scripts/deploy/reports-backup-restore.py",
    "scripts/stage3a_load_probe.py",
    "scripts/stage4_soak_probe.py",
    "scripts/generate_p0_capacity_fixture.py",
    "docs/stage4-long-running-acceptance.md"
)
foreach ($required in $requiredFiles) {
    if (-not $seenPaths.Contains($required)) { throw "Release package is missing required file: $required" }
}
if (-not $seenPaths.Contains("mes-images.tar")) { throw "Release package must list mes-images.tar." }

$actualPaths = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
foreach ($file in @(Get-ChildItem -LiteralPath $release -File -Recurse -Force)) {
    if ($file.Attributes -band [System.IO.FileAttributes]::ReparsePoint) { throw "Release package contains a reparse point: $($file.FullName)" }
    $prefix = $release.TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
    if (-not $file.FullName.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) { throw "Release file escaped the release directory." }
    $relative = $file.FullName.Substring($prefix.Length).Replace("\", "/")
    if (-not $actualPaths.Add($relative)) { throw "Release package contains case-colliding files: $relative" }
}
$expectedPaths = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
$expectedPaths.Add("release-manifest.json") | Out-Null
foreach ($entry in $fileEntries) { $expectedPaths.Add([string]$entry.path) | Out-Null }
if (-not $expectedPaths.SetEquals($actualPaths)) { throw "Release package contains missing or untracked extra files." }

foreach ($entry in $fileEntries) {
    if (-not (Test-Path -LiteralPath $entry.full -PathType Leaf)) { throw "Release file is missing: $($entry.path)" }
    $item = Get-Item -Force -LiteralPath $entry.full
    if ([long]$item.Length -ne [long]$entry.bytes) { throw "File size mismatch: $($entry.path)" }
    if ((Get-Sha256 $entry.full) -cne [string]$entry.sha256) { throw "Checksum mismatch: $($entry.path)" }
}

$archiveEntry = @($fileEntries | Where-Object { $_.path -ceq "mes-images.tar" })
if ($archiveEntry.Count -ne 1) { throw "Release package must contain exactly one mes-images.tar entry." }
if ($archiveDeclaration.path -cne "mes-images.tar" -or
    [long]$archiveDeclaration.bytes -ne [long]$archiveEntry[0].bytes -or
    [string]$archiveDeclaration.sha256 -cne [string]$archiveEntry[0].sha256) {
    throw "Release archive declaration does not match the file inventory."
}
$references = @($images | ForEach-Object { [string]$_.reference })
Assert-ArchiveImageDigests $archiveEntry[0].full $references

if ($VerifyOnly) {
    Write-Host "Release package checksums, paths, file inventory, and image archive digests verified. Nothing was loaded or started."
    return
}

foreach ($image in $images) {
    $existing = Get-ExistingImage ([string]$image.reference)
    if ($null -ne $existing -and [string]$existing.Id -cne [string]$image.image_id) {
        throw "Existing immutable image reference resolves to a conflicting image ID: $($image.reference)"
    }
}

& docker load --input $archiveEntry[0].full
if ($LASTEXITCODE -ne 0) { throw "docker load failed." }

foreach ($image in $images) {
    $loaded = Get-ExistingImage ([string]$image.reference)
    if ($null -eq $loaded) { throw "Loaded image reference is unavailable: $($image.reference)" }
    if ([string]$loaded.Id -cne [string]$image.image_id -or
        [string]$loaded.Os -cne [string]$image.os -or
        [string]$loaded.Architecture -cne [string]$image.architecture) {
        throw "Loaded image metadata does not match release-manifest.json: $($image.role)"
    }
}

Write-Host "Release checksums, file inventory, and exact image metadata verified. Nothing was started."
