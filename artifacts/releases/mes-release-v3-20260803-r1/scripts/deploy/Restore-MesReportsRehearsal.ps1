[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)] [string]$BackupDirectory,
    [Parameter(Mandatory = $true)] [string]$TargetVolume,
    [Parameter(Mandatory = $true)] [string]$ToolImage,
    [ValidateRange(0, 2147483647)] [int]$TargetUid = 10001,
    [ValidateRange(0, 2147483647)] [int]$TargetGid = 10001
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if ($TargetVolume -notmatch '^[A-Za-z0-9][A-Za-z0-9_.-]*-restore-test$') {
    throw "TargetVolume must be an isolated name ending in -restore-test."
}
if ($ToolImage -notmatch '@sha256:[0-9a-fA-F]{64}$') {
    throw "ToolImage must use an immutable @sha256 digest."
}

$backup = (Resolve-Path -LiteralPath $BackupDirectory).Path
$helper = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "reports-backup-restore.py")).Path
foreach ($mountPath in @($backup, $helper)) {
    if ($mountPath.Contains(",")) {
        throw "Docker bind-mount paths containing commas are not supported: $mountPath"
    }
}
if (-not (Test-Path -LiteralPath (Join-Path $backup "reports-manifest.json") -PathType Leaf)) {
    throw "Report backup manifest not found."
}

$volumeNames = @(& docker volume ls --quiet --filter "name=$TargetVolume")
if ($LASTEXITCODE -ne 0) {
    throw "Could not query Docker volumes."
}
if ($volumeNames -ccontains $TargetVolume) {
    throw "Target volume already exists; restore rehearsal requires a brand-new volume: $TargetVolume"
}

$rehearsalId = [Guid]::NewGuid().ToString("D")
$createdVolume = & docker volume create `
    --label "io.mes.purpose=reports-restore-rehearsal" `
    --label "io.mes.rehearsal-id=$rehearsalId" `
    --label "io.mes.created-by=Restore-MesReportsRehearsal.ps1" `
    $TargetVolume
if ($LASTEXITCODE -ne 0 -or ([string]$createdVolume).Trim() -cne $TargetVolume) {
    throw "Failed to create the exact isolated target volume: $TargetVolume"
}

$arguments = @(
    "run", "--rm", "--network", "none",
    "--mount", "type=bind,source=$backup,target=/backup,readonly",
    "--mount", "type=volume,source=$TargetVolume,target=/restore,volume-nocopy",
    "--mount", "type=bind,source=$helper,target=/opt/mes/reports-backup-restore.py,readonly",
    "--env", "MES_REPORTS_TARGET_VOLUME=$TargetVolume",
    "--env", "MES_REPORTS_REHEARSAL_ID=$rehearsalId",
    "--env", "MES_REPORTS_TARGET_UID=$TargetUid",
    "--env", "MES_REPORTS_TARGET_GID=$TargetGid",
    $ToolImage,
    "python", "/opt/mes/reports-backup-restore.py", "restore"
)

try {
    & docker @arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Report-volume restore validation failed."
    }
} catch {
    Write-Warning "The labeled rehearsal volume was retained for inspection: $TargetVolume (rehearsal $rehearsalId)"
    throw
}

Write-Host "Report-volume restore rehearsal passed: $TargetVolume"
Write-Host "Rehearsal label: io.mes.rehearsal-id=$rehearsalId"
