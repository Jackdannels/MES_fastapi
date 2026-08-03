[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)] [string]$SourceVolume,
    [Parameter(Mandatory = $true)] [string]$ToolImage,
    [Parameter(Mandatory = $true)] [string]$OutputDirectory,
    [ValidateSet("offline", "quiesced", "live_best_effort")]
    [string]$ConsistencyMode = "quiesced"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if ($SourceVolume -notmatch '^[A-Za-z0-9][A-Za-z0-9_.-]+$') {
    throw "SourceVolume contains unsupported characters."
}
if ($ToolImage -notmatch '@sha256:[0-9a-fA-F]{64}$') {
    throw "ToolImage must use an immutable @sha256 digest."
}

$volumeNames = @(& docker volume ls --quiet --filter "name=$SourceVolume")
if ($LASTEXITCODE -ne 0) {
    throw "Could not query Docker volumes."
}
if (-not ($volumeNames -ccontains $SourceVolume)) {
    throw "Source Docker volume does not exist; refusing to create it implicitly: $SourceVolume"
}
$volumeJson = & docker volume inspect $SourceVolume
if ($LASTEXITCODE -ne 0) { throw "Could not inspect source Docker volume: $SourceVolume" }
$volume = ($volumeJson -join "`n") | ConvertFrom-Json
if ([string]$volume.Name -cne $SourceVolume) {
    throw "Docker returned a different source volume than requested."
}

$output = [System.IO.Path]::GetFullPath($OutputDirectory)
$helper = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "reports-backup-restore.py")).Path
foreach ($mountPath in @($output, $helper)) {
    if ($mountPath.Contains(",")) {
        throw "Docker bind-mount paths containing commas are not supported: $mountPath"
    }
}
if (Test-Path -LiteralPath $output) {
    throw "Output directory already exists: $output"
}
New-Item -ItemType Directory -Path $output | Out-Null

$backupId = [Guid]::NewGuid().ToString("D")
$arguments = @(
    "run", "--rm", "--network", "none",
    "--mount", "type=volume,source=$SourceVolume,target=/reports,readonly,volume-nocopy",
    "--mount", "type=bind,source=$output,target=/backup",
    "--mount", "type=bind,source=$helper,target=/opt/mes/reports-backup-restore.py,readonly",
    "--env", "MES_REPORTS_SOURCE_VOLUME=$SourceVolume",
    "--env", "MES_REPORTS_TOOL_IMAGE=$ToolImage",
    "--env", "MES_REPORTS_BACKUP_ID=$backupId",
    "--env", "MES_REPORTS_CONSISTENCY_MODE=$ConsistencyMode",
    $ToolImage,
    "python", "/opt/mes/reports-backup-restore.py", "backup"
)

& docker @arguments
if ($LASTEXITCODE -ne 0) {
    throw "Report-volume backup failed. The incomplete output directory was retained for inspection: $output"
}

$manifestPath = Join-Path $output "reports-manifest.json"
$archivePath = Join-Path $output "mes-reports.tar.gz"
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    throw "Report-volume backup did not create reports-manifest.json."
}
if (-not (Test-Path -LiteralPath $archivePath -PathType Leaf) -or (Get-Item -LiteralPath $archivePath).Length -eq 0) {
    throw "Report-volume backup did not create a non-empty mes-reports.tar.gz."
}

Write-Host "Report-volume backup created and fully checksummed at $output"
