[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)] [string]$BackupDirectory,
    [Parameter(Mandatory = $true)] [string]$TargetHostName,
    [int]$TargetPort = 3306,
    [Parameter(Mandatory = $true)] [string]$TargetDatabase,
    [Parameter(Mandatory = $true)] [string]$TargetUser,
    [Parameter(Mandatory = $true)] [string]$TargetPasswordFile,
    [Parameter(Mandatory = $true)] [string]$ClientImage,
    [Parameter(Mandatory = $true)] [string]$ApiImage
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

if ($TargetDatabase -notmatch '^[A-Za-z0-9_]+_restore_test$') {
    throw "TargetDatabase must be an isolated name ending in _restore_test."
}
if (-not $TargetHostName.Trim()) { throw "TargetHostName is required." }
if (-not $TargetUser.Trim()) { throw "TargetUser is required." }
if ($TargetPort -lt 1 -or $TargetPort -gt 65535) { throw "TargetPort must be between 1 and 65535." }
foreach ($entry in @{ ClientImage = $ClientImage; ApiImage = $ApiImage }.GetEnumerator()) {
    if ($entry.Value -notmatch '@sha256:[0-9a-fA-F]{64}$') { throw "$($entry.Key) must use an immutable @sha256 digest." }
}
if (-not (Test-Path -LiteralPath $TargetPasswordFile -PathType Leaf)) { throw "Target password file not found." }
if (-not (Get-Content -Raw -LiteralPath $TargetPasswordFile).TrimEnd("`r", "`n")) { throw "Target password file is empty." }

$backup = (Resolve-Path -LiteralPath $BackupDirectory).Path
$manifestPath = Join-Path $backup "backup-manifest.json"
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { throw "Backup manifest not found." }
$manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
$dumpPath = Join-Path $backup ([string]$manifest.dump_file)
if (-not (Test-Path -LiteralPath $dumpPath -PathType Leaf)) { throw "Backup dump file not found." }
if ((Get-Sha256 $dumpPath) -ne ([string]$manifest.dump_sha256).ToLowerInvariant()) { throw "Backup checksum mismatch." }

$password = (Resolve-Path -LiteralPath $TargetPasswordFile).Path
$commonArguments = @(
    "run", "--rm",
    "--mount", "type=bind,source=$password,target=/run/secrets/mysql_password,readonly",
    "--env", "MES_DB_HOST=$TargetHostName",
    "--env", "MES_DB_PORT=$TargetPort",
    "--env", "MES_DB_USER=$TargetUser",
    "--env", "MES_DB_NAME=$TargetDatabase"
)

& docker @commonArguments $ClientImage sh -ec 'export MYSQL_PWD="$(cat /run/secrets/mysql_password)"; mysql --host="$MES_DB_HOST" --port="$MES_DB_PORT" --user="$MES_DB_USER" -e "CREATE DATABASE IF NOT EXISTS \`$MES_DB_NAME\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"; count="$(mysql --host="$MES_DB_HOST" --port="$MES_DB_PORT" --user="$MES_DB_USER" --batch --skip-column-names -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = '''$MES_DB_NAME'''")"; test "$count" = "0"'
if ($LASTEXITCODE -ne 0) { throw "Target database is not empty or could not be prepared." }

& docker @commonArguments `
    --mount "type=bind,source=$backup,target=/backup,readonly" `
    $ClientImage `
    sh -ec 'export MYSQL_PWD="$(cat /run/secrets/mysql_password)"; mysql --host="$MES_DB_HOST" --port="$MES_DB_PORT" --user="$MES_DB_USER" "$MES_DB_NAME" < /backup/database.sql'
if ($LASTEXITCODE -ne 0) { throw "Database restore failed." }

& docker run --rm `
    --mount "type=bind,source=$password,target=/run/secrets/MYSQL_PASSWORD,readonly" `
    --env APP_ENV=test `
    --env STORAGE_BACKEND=mysql `
    --env "MYSQL_HOST=$TargetHostName" `
    --env "MYSQL_PORT=$TargetPort" `
    --env "MYSQL_USER=$TargetUser" `
    --env "MYSQL_DATABASE=$TargetDatabase" `
    --env MYSQL_AUTO_INIT_SCHEMA=false `
    --env MYSQL_AUTO_SEED_DEMO=false `
    $ApiImage python scripts/init_mysql_storage.py
if ($LASTEXITCODE -ne 0) { throw "Restored database failed migration history or schema-contract validation." }

Write-Host "Restore rehearsal passed for isolated database $TargetDatabase"
