[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)] [string]$ApiImage,
    [Parameter(Mandatory = $true)] [string]$WebImage,
    [Parameter(Mandatory = $true)] [string]$MySqlClientImage,
    [Parameter(Mandatory = $true)] [string]$RabbitMqImage,
    [Parameter(Mandatory = $true)] [string]$ReportsToolImage,
    [Parameter(Mandatory = $true)] [string]$ReleaseVersion,
    [Parameter(Mandatory = $true)] [string]$OutputDirectory
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Assert-ImmutableImage([string]$Name, [string]$Reference) {
    if ($Reference -notmatch '^[^@\s]+:[^@/:\s]+@sha256:[0-9a-f]{64}$') {
        throw "$Name must use repository:tag@sha256 with an immutable lowercase digest."
    }
}

function Get-ArchiveReference([string]$Reference) {
    return $Reference.Substring(0, $Reference.LastIndexOf("@"))
}

function Get-ArchiveTag([string]$Reference) {
    $slash = $Reference.LastIndexOf("/")
    $colon = $Reference.LastIndexOf(":")
    if ($colon -le $slash -or $colon -eq $Reference.Length - 1) {
        throw "Release image reference must contain an explicit tag: $Reference"
    }
    return $Reference.Substring($colon + 1)
}

function Get-CanonicalArchiveName([string]$Reference) {
    if (-not $Reference.Contains("/")) { return "docker.io/library/$Reference" }
    $first = $Reference.Split('/')[0]
    if ($first.Contains(".") -or $first.Contains(":") -or $first -ceq "localhost") { return $Reference }
    return "docker.io/$Reference"
}

function Get-ArchiveAnnotation([object]$Entry, [string]$Name) {
    $annotationsProperty = $Entry.PSObject.Properties["annotations"]
    if ($null -eq $annotationsProperty -or $null -eq $annotationsProperty.Value) { return "" }
    $valueProperty = $annotationsProperty.Value.PSObject.Properties[$Name]
    if ($null -eq $valueProperty) { return "" }
    return [string]$valueProperty.Value
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

function Get-ImageMetadata([string]$Role, [string]$Reference) {
    $json = & docker image inspect $Reference
    if ($LASTEXITCODE -ne 0) {
        throw "Release image is not available locally: $Reference"
    }
    $items = @(($json -join "`n") | ConvertFrom-Json)
    if ($items.Count -ne 1) {
        throw "Docker returned an unexpected image inspection result: $Reference"
    }
    $item = $items[0]
    if ([string]$item.Id -notmatch '^sha256:[0-9a-f]{64}$') {
        throw "Docker image ID is not a SHA-256 digest: $Reference"
    }
    if (-not ([string]$item.Os).Trim() -or -not ([string]$item.Architecture).Trim()) {
        throw "Docker image platform metadata is incomplete: $Reference"
    }
    return [ordered]@{
        role = $Role
        reference = $Reference
        image_id = [string]$item.Id
        os = [string]$item.Os
        architecture = [string]$item.Architecture
    }
}

function Assert-ArchiveImageContract([string]$ArchivePath, [object[]]$Images) {
    $indexJson = & tar -xOf $ArchivePath index.json
    if ($LASTEXITCODE -ne 0) {
        throw "Could not read index.json from Docker image archive."
    }
    try {
        $index = ($indexJson -join "`n") | ConvertFrom-Json
    } catch {
        throw "Docker image archive index.json is invalid JSON."
    }
    if ($index.schemaVersion -ne 2 -or -not $index.manifests) {
        throw "Docker image archive is not a supported OCI index."
    }
    $expectedByDigest = @{}
    foreach ($image in $Images) {
        $reference = [string]$image.reference
        $digest = $reference.Substring($reference.LastIndexOf("@") + 1)
        if ($expectedByDigest.ContainsKey($digest)) {
            throw "Multiple release roles unexpectedly reference the same image digest: $digest"
        }
        $archiveReference = Get-ArchiveReference $reference
        $expectedByDigest[$digest] = [ordered]@{
            name = Get-CanonicalArchiveName $archiveReference
            tag = Get-ArchiveTag $archiveReference
        }
    }
    $actual = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::Ordinal)
    foreach ($entry in @($index.manifests)) {
        $digest = [string]$entry.digest
        if ($digest -notmatch '^sha256:[0-9a-f]{64}$' -or -not $actual.Add($digest)) {
            throw "Docker image archive contains an invalid or duplicate top-level digest."
        }
        if (-not $expectedByDigest.ContainsKey($digest)) {
            throw "Docker image archive digest set does not match the release image roles."
        }
        $expected = $expectedByDigest[$digest]
        $actualName = Get-ArchiveAnnotation $entry "io.containerd.image.name"
        $actualTag = Get-ArchiveAnnotation $entry "org.opencontainers.image.ref.name"
        if ($actualName -cne [string]$expected.name -or $actualTag -cne [string]$expected.tag) {
            throw "Docker image archive does not preserve the expected image reference name for digest: $digest"
        }
    }
    if ($actual.Count -ne $expectedByDigest.Count) {
        throw "Docker image archive digest set does not match the release image roles."
    }
}

if ($ReleaseVersion -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]*$') {
    throw "ReleaseVersion contains unsupported characters."
}

$imageInputs = @(
    [ordered]@{ role = "api"; name = "ApiImage"; reference = $ApiImage },
    [ordered]@{ role = "web"; name = "WebImage"; reference = $WebImage },
    [ordered]@{ role = "mysql-client"; name = "MySqlClientImage"; reference = $MySqlClientImage },
    [ordered]@{ role = "rabbitmq"; name = "RabbitMqImage"; reference = $RabbitMqImage },
    [ordered]@{ role = "reports-tool"; name = "ReportsToolImage"; reference = $ReportsToolImage }
)
$images = @()
foreach ($imageInput in $imageInputs) {
    Assert-ImmutableImage ([string]$imageInput.name) ([string]$imageInput.reference)
    $images += Get-ImageMetadata ([string]$imageInput.role) ([string]$imageInput.reference)
}

$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$requiredFiles = @(
    "compose.production.yml",
    "compose.packaging.yml",
    "compose.stage4.yml",
    "deploy/.env.production.example",
    "deploy/.env.stage4.example",
    "deploy/mysql/init-users.sh",
    "deploy/nginx/production-https.conf",
    "scripts/deploy/Import-MesRelease.ps1",
    "scripts/deploy/Test-ProductionDeployment.ps1",
    "scripts/deploy/Backup-MesDatabase.ps1",
    "scripts/deploy/Restore-MesRehearsal.ps1",
    "scripts/deploy/mysql-backup-restore.sh",
    "scripts/deploy/Backup-MesReports.ps1",
    "scripts/deploy/Restore-MesReportsRehearsal.ps1",
    "scripts/deploy/reports-backup-restore.py",
    "scripts/deploy/New-MesDeploymentOperation.ps1",
    "scripts/deploy/Invoke-Stage4Acceptance.ps1",
    "scripts/stage3a_load_probe.py",
    "scripts/stage4_soak_probe.py",
    "scripts/generate_p0_capacity_fixture.py",
    "docs/production-deployment.md",
    "docs/stage4-new-host-codex-handoff.md",
    "docs/stage4-long-running-acceptance.md"
)
foreach ($relative in $requiredFiles) {
    $source = Join-Path $root ($relative.Replace("/", [System.IO.Path]::DirectorySeparatorChar))
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
        throw "Required release file is missing: $relative"
    }
    if ((Get-Item -Force -LiteralPath $source).Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
        throw "Required release file must not be a reparse point: $relative"
    }
}

$releaseFinal = [System.IO.Path]::GetFullPath($OutputDirectory)
if (Test-Path -LiteralPath $releaseFinal) {
    throw "Output directory already exists: $releaseFinal"
}
$releaseParent = Split-Path -Parent $releaseFinal
if (-not (Test-Path -LiteralPath $releaseParent -PathType Container)) {
    New-Item -ItemType Directory -Path $releaseParent -Force | Out-Null
}
$release = $releaseFinal + ".incomplete-" + [Guid]::NewGuid().ToString("N")
New-Item -ItemType Directory -Path $release | Out-Null

foreach ($relative in $requiredFiles) {
    $nativeRelative = $relative.Replace("/", [System.IO.Path]::DirectorySeparatorChar)
    $source = Join-Path $root $nativeRelative
    $destination = Join-Path $release $nativeRelative
    $parent = Split-Path -Parent $destination
    if (-not (Test-Path -LiteralPath $parent)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }
    Copy-Item -LiteralPath $source -Destination $destination
}

$archive = Join-Path $release "mes-images.tar"
$archiveReferences = @($images | ForEach-Object { Get-ArchiveReference ([string]$_.reference) })
& docker save --output $archive @archiveReferences
if ($LASTEXITCODE -ne 0) {
    throw "docker save failed. The incomplete release directory was retained for inspection."
}
if (-not (Test-Path -LiteralPath $archive -PathType Leaf) -or (Get-Item -LiteralPath $archive).Length -eq 0) {
    throw "docker save did not create a non-empty mes-images.tar."
}
Assert-ArchiveImageContract $archive $images

$releasePrefix = $release.TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
$filesByPath = @{}
$relativePaths = New-Object 'System.Collections.Generic.List[string]'
foreach ($file in @(Get-ChildItem -LiteralPath $release -File -Recurse -Force)) {
    if ($file.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
        throw "Release file must not be a reparse point: $($file.FullName)"
    }
    if (-not $file.FullName.StartsWith($releasePrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Release file escaped the output directory: $($file.FullName)"
    }
    $relative = $file.FullName.Substring($releasePrefix.Length).Replace("\", "/")
    if ($filesByPath.ContainsKey($relative)) { throw "Release files contain a case-colliding path: $relative" }
    $filesByPath[$relative] = $file
    $relativePaths.Add($relative)
}
$relativePaths.Sort([System.StringComparer]::Ordinal)
$checksums = foreach ($relative in $relativePaths) {
    $file = $filesByPath[$relative]
    [ordered]@{
        path = $relative
        bytes = [long]$file.Length
        sha256 = Get-Sha256 $file.FullName
    }
}
$archiveEntry = @($checksums | Where-Object { $_.path -ceq "mes-images.tar" })
if ($archiveEntry.Count -ne 1) {
    throw "Release file inventory must contain exactly one mes-images.tar."
}
$manifest = [ordered]@{
    format = "mes-offline-release"
    format_version = 3
    release_version = $ReleaseVersion
    created_at_utc = [DateTime]::UtcNow.ToString("o")
    archive = [ordered]@{
        path = "mes-images.tar"
        bytes = [long]$archiveEntry[0].bytes
        sha256 = [string]$archiveEntry[0].sha256
    }
    images = @($images)
    files = @($checksums)
}
$manifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $release "release-manifest.json") -Encoding utf8
Move-Item -LiteralPath $release -Destination $releaseFinal

Write-Host "Offline release v3 exported to $releaseFinal"
