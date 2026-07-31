[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$EnvFile,
    [string]$ComposeFile = "compose.production.yml"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Assert-ImmutableImage([string]$Name, [string]$Reference) {
    if ($Reference -notmatch '@sha256:[0-9a-fA-F]{64}$') {
        throw "$Name must end with an immutable @sha256 digest."
    }
}

if (-not (Test-Path -LiteralPath $EnvFile -PathType Leaf)) {
    throw "Environment file not found: $EnvFile"
}
if (-not (Test-Path -LiteralPath $ComposeFile -PathType Leaf)) {
    throw "Compose file not found: $ComposeFile"
}

$json = & docker compose --profile migration --env-file $EnvFile -f $ComposeFile config --format json
if ($LASTEXITCODE -ne 0) {
    throw "docker compose config failed."
}
$config = $json | ConvertFrom-Json

if ($config.services.PSObject.Properties.Name -contains "mysql") {
    throw "Production Compose must not define a bundled MySQL service."
}
Assert-ImmutableImage "api image" ([string]$config.services.api.image)
Assert-ImmutableImage "migrate image" ([string]$config.services.migrate.image)
Assert-ImmutableImage "web image" ([string]$config.services.web.image)
if ([string]$config.services.api.image -ne [string]$config.services.migrate.image) {
    throw "API and migration must use the exact same image digest."
}

Write-Host "Production Compose preflight passed (configuration only; no containers started)."
