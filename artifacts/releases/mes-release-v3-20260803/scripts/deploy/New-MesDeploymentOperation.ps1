[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)] [string]$ReleaseDirectory,
    [Parameter(Mandatory = $true)] [string]$DatabaseBackupDirectory,
    [Parameter(Mandatory = $true)] [string]$ReportsBackupDirectory,
    [Parameter(Mandatory = $true)] [string]$PreviousApiImage,
    [Parameter(Mandatory = $true)] [string]$PreviousWebImage,
    [Parameter(Mandatory = $true)] [string]$OutputFile
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

function Assert-ImmutableImage([string]$Name, [string]$Reference) {
    if ($Reference -notmatch '^[^@\s]+@sha256:[0-9a-f]{64}$') {
        throw "$Name must end with an immutable lowercase @sha256 digest."
    }
}

function Assert-Sha256([string]$Name, [object]$Value) {
    if ([string]$Value -notmatch '^[0-9a-f]{64}$') { throw "$Name must be a lowercase SHA-256 digest." }
}

function ConvertTo-NonNegativeInt64([string]$Name, [object]$Value) {
    $parsed = [long]0
    if ($null -eq $Value -or -not [long]::TryParse(([string]$Value), [ref]$parsed) -or $parsed -lt 0) {
        throw "$Name must be a non-negative integer."
    }
    return $parsed
}

function Assert-ExactProperties([object]$Value, [string[]]$Expected, [string]$Context) {
    $actual = @($Value.PSObject.Properties.Name)
    foreach ($name in $Expected) {
        if (-not ($actual -ccontains $name)) { throw "$Context is missing property: $name" }
    }
    foreach ($name in $actual) {
        if (-not ($Expected -ccontains $name)) { throw "$Context contains unknown property: $name" }
    }
}

function Resolve-ArtifactLeaf([string]$Directory, [object]$LeafName, [string]$Context) {
    $name = [string]$LeafName
    if (-not $name -or $name.Contains("/") -or $name.Contains("\") -or $name.Contains(":") -or $name -in @(".", "..")) {
        throw "$Context must be a single safe file name."
    }
    foreach ($character in $name.ToCharArray()) {
        if ([char]::IsControl($character)) { throw "$Context contains a control character." }
    }
    $path = Join-Path $Directory $name
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "$Context file not found: $name" }
    if ((Get-Item -Force -LiteralPath $path).Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
        throw "$Context must not be a reparse point."
    }
    return $path
}

function Get-BundleRelativePath([string]$BundleRoot, [string]$FullPath) {
    $full = [System.IO.Path]::GetFullPath($FullPath)
    $prefix = $BundleRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
    if (-not $full.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Operation artifacts must be stored below the operation-manifest parent directory: $full"
    }
    return $full.Substring($prefix.Length).Replace("\", "/")
}

Assert-ImmutableImage "PreviousApiImage" $PreviousApiImage
Assert-ImmutableImage "PreviousWebImage" $PreviousWebImage

$release = (Resolve-Path -LiteralPath $ReleaseDirectory).Path
$database = (Resolve-Path -LiteralPath $DatabaseBackupDirectory).Path
$reports = (Resolve-Path -LiteralPath $ReportsBackupDirectory).Path
$output = [System.IO.Path]::GetFullPath($OutputFile)
if ([System.IO.Path]::GetFileName($output) -cne "operation-manifest.json") {
    throw "OutputFile must be named operation-manifest.json."
}
if (Test-Path -LiteralPath $output) { throw "Operation manifest already exists: $output" }
$bundleRoot = Split-Path -Parent $output
if (-not (Test-Path -LiteralPath $bundleRoot -PathType Container)) {
    throw "Operation manifest parent directory does not exist: $bundleRoot"
}
foreach ($directory in @($release, $database, $reports)) {
    if ((Get-Item -Force -LiteralPath $directory).Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
        throw "Operation artifact directories must not be reparse points."
    }
}

$importScript = Join-Path $PSScriptRoot "Import-MesRelease.ps1"
if (-not (Test-Path -LiteralPath $importScript -PathType Leaf)) { throw "Trusted release verifier is missing." }
& $importScript -ReleaseDirectory $release -VerifyOnly

$releaseManifestPath = Resolve-ArtifactLeaf $release "release-manifest.json" "release manifest"
$releaseManifest = Get-Content -Raw -LiteralPath $releaseManifestPath | ConvertFrom-Json
if ([string]$releaseManifest.format -cne "mes-offline-release" -or $releaseManifest.format_version -ne 3) {
    throw "Deployment operations require the current release manifest v3 package."
}
$releaseImages = @{}
foreach ($image in @($releaseManifest.images)) { $releaseImages[[string]$image.role] = [string]$image.reference }
$requiredReleaseRoles = @("api", "web", "mysql-client", "rabbitmq", "reports-tool")
foreach ($role in $requiredReleaseRoles) {
    if (-not $releaseImages.ContainsKey($role)) { throw "Release manifest is missing image role: $role" }
}

$databaseManifestPath = Resolve-ArtifactLeaf $database "backup-manifest.json" "database backup manifest"
$databaseManifest = Get-Content -Raw -LiteralPath $databaseManifestPath | ConvertFrom-Json
Assert-ExactProperties $databaseManifest @("format_version", "database", "source_host", "source_port", "created_at_utc", "dump_file", "dump_bytes", "dump_sha256", "client_image") "database backup manifest"
if ($databaseManifest.format_version -ne 1) { throw "Unsupported database backup manifest version." }
Assert-ImmutableImage "database backup client_image" ([string]$databaseManifest.client_image)
if ([string]$databaseManifest.client_image -cne [string]$releaseImages["mysql-client"]) {
    throw "Database backup client image does not match the release mysql-client role."
}
$dumpPath = Resolve-ArtifactLeaf $database $databaseManifest.dump_file "database dump"
$dumpBytes = ConvertTo-NonNegativeInt64 "database dump_bytes" $databaseManifest.dump_bytes
Assert-Sha256 "database dump_sha256" $databaseManifest.dump_sha256
if ((Get-Item -LiteralPath $dumpPath).Length -ne $dumpBytes -or (Get-Sha256 $dumpPath) -cne [string]$databaseManifest.dump_sha256) {
    throw "Database dump size or SHA-256 does not match backup-manifest.json."
}

$reportsManifestPath = Resolve-ArtifactLeaf $reports "reports-manifest.json" "reports backup manifest"
$reportsManifest = Get-Content -Raw -LiteralPath $reportsManifestPath | ConvertFrom-Json
Assert-ExactProperties $reportsManifest @("format", "format_version", "backup_id", "created_at_utc", "source_volume", "consistency_mode", "tool_image", "archive", "content") "reports backup manifest"
if ([string]$reportsManifest.format -cne "mes-reports-backup" -or $reportsManifest.format_version -ne 1) {
    throw "Unsupported reports backup manifest format or version."
}
if ([string]$reportsManifest.consistency_mode -notin @("offline", "quiesced")) {
    throw "Deployment operation refuses live_best_effort reports backups."
}
Assert-ImmutableImage "reports backup tool_image" ([string]$reportsManifest.tool_image)
if ([string]$reportsManifest.tool_image -cne [string]$releaseImages["reports-tool"]) {
    throw "Reports backup tool image does not match the release reports-tool role."
}
Assert-ExactProperties $reportsManifest.archive @("file", "format", "bytes", "sha256") "reports archive declaration"
if ([string]$reportsManifest.archive.format -cne "tar.gz") { throw "Unsupported reports archive format." }
$reportsArchivePath = Resolve-ArtifactLeaf $reports $reportsManifest.archive.file "reports archive"
$reportsArchiveBytes = ConvertTo-NonNegativeInt64 "reports archive bytes" $reportsManifest.archive.bytes
Assert-Sha256 "reports archive sha256" $reportsManifest.archive.sha256
if ((Get-Item -LiteralPath $reportsArchivePath).Length -ne $reportsArchiveBytes -or (Get-Sha256 $reportsArchivePath) -cne [string]$reportsManifest.archive.sha256) {
    throw "Reports archive size or SHA-256 does not match reports-manifest.json."
}

$manifest = [ordered]@{
    format = "mes-deployment-operation"
    format_version = 1
    operation_id = [Guid]::NewGuid().ToString("D")
    created_at_utc = [DateTime]::UtcNow.ToString("o")
    release_version = [string]$releaseManifest.release_version
    previous_images = [ordered]@{
        api = $PreviousApiImage
        web = $PreviousWebImage
    }
    target_images = @($releaseManifest.images)
    artifacts = [ordered]@{
        release = [ordered]@{
            manifest_path = Get-BundleRelativePath $bundleRoot $releaseManifestPath
            manifest_bytes = (Get-Item -LiteralPath $releaseManifestPath).Length
            manifest_sha256 = Get-Sha256 $releaseManifestPath
        }
        database = [ordered]@{
            manifest_path = Get-BundleRelativePath $bundleRoot $databaseManifestPath
            manifest_bytes = (Get-Item -LiteralPath $databaseManifestPath).Length
            manifest_sha256 = Get-Sha256 $databaseManifestPath
            database = [string]$databaseManifest.database
            dump_path = Get-BundleRelativePath $bundleRoot $dumpPath
            dump_bytes = $dumpBytes
            dump_sha256 = [string]$databaseManifest.dump_sha256
            client_image = [string]$databaseManifest.client_image
        }
        reports = [ordered]@{
            manifest_path = Get-BundleRelativePath $bundleRoot $reportsManifestPath
            manifest_bytes = (Get-Item -LiteralPath $reportsManifestPath).Length
            manifest_sha256 = Get-Sha256 $reportsManifestPath
            backup_id = [string]$reportsManifest.backup_id
            consistency_mode = [string]$reportsManifest.consistency_mode
            archive_path = Get-BundleRelativePath $bundleRoot $reportsArchivePath
            archive_bytes = $reportsArchiveBytes
            archive_sha256 = [string]$reportsManifest.archive.sha256
            tool_image = [string]$reportsManifest.tool_image
        }
    }
}
$manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $output -Encoding utf8
Write-Host "Deployment operation manifest created at $output"
