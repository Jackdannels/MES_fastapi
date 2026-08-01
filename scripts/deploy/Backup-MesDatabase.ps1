[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)] [string]$HostName,
    [int]$Port = 3306,
    [Parameter(Mandatory = $true)] [string]$Database,
    [Parameter(Mandatory = $true)] [string]$User,
    [Parameter(Mandatory = $true)] [string]$PasswordFile,
    [Parameter(Mandatory = $true)] [string]$ClientImage,
    [Parameter(Mandatory = $true)] [string]$OutputDirectory
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

if ($Database -notmatch '^[A-Za-z0-9_]+$') { throw "Database contains unsupported characters." }
if (-not $HostName.Trim()) { throw "HostName is required." }
if (-not $User.Trim()) { throw "User is required." }
if ($Port -lt 1 -or $Port -gt 65535) { throw "Port must be between 1 and 65535." }
if ($ClientImage -notmatch '@sha256:[0-9a-fA-F]{64}$') { throw "ClientImage must use an immutable @sha256 digest." }
if (-not (Test-Path -LiteralPath $PasswordFile -PathType Leaf)) { throw "Password file not found: $PasswordFile" }
if (-not (Get-Content -Raw -LiteralPath $PasswordFile).TrimEnd("`r", "`n")) { throw "Password file is empty." }

$output = [System.IO.Path]::GetFullPath($OutputDirectory)
if (Test-Path -LiteralPath $output) { throw "Output directory already exists: $output" }
New-Item -ItemType Directory -Path $output | Out-Null
$password = (Resolve-Path -LiteralPath $PasswordFile).Path
$dumpPath = Join-Path $output "database.sql"

& docker run --rm `
    --mount "type=bind,source=$output,target=/backup" `
    --mount "type=bind,source=$password,target=/run/secrets/mysql_password,readonly" `
    --env "MES_DB_HOST=$HostName" `
    --env "MES_DB_PORT=$Port" `
    --env "MES_DB_USER=$User" `
    --env "MES_DB_NAME=$Database" `
    $ClientImage `
    sh -ec 'export MYSQL_PWD="$(cat /run/secrets/mysql_password)"; mysqldump --host="$MES_DB_HOST" --port="$MES_DB_PORT" --user="$MES_DB_USER" --single-transaction --quick --routines --triggers --events --hex-blob --set-gtid-purged=OFF --no-tablespaces "$MES_DB_NAME" > /backup/database.sql'
if ($LASTEXITCODE -ne 0) { throw "mysqldump failed with exit code $LASTEXITCODE." }
if (-not (Test-Path -LiteralPath $dumpPath -PathType Leaf) -or (Get-Item -LiteralPath $dumpPath).Length -eq 0) {
    throw "mysqldump did not create a non-empty database.sql file."
}

$manifest = [ordered]@{
    format_version = 1
    database = $Database
    source_host = $HostName
    source_port = $Port
    created_at_utc = [DateTime]::UtcNow.ToString("o")
    dump_file = "database.sql"
    dump_bytes = (Get-Item -LiteralPath $dumpPath).Length
    dump_sha256 = Get-Sha256 $dumpPath
    client_image = $ClientImage
}
$manifest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $output "backup-manifest.json") -Encoding utf8
Write-Host "Database backup created and checksummed at $output"
