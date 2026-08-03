[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)] [string]$EnvFile,
    [Parameter(Mandatory = $true)] [string]$ProjectName,
    [Parameter(Mandatory = $true)] [string]$OutputDirectory,
    [double]$DurationSeconds = 60,
    [int]$Users = 2,
    [double]$WindowSeconds = 15,
    [int]$MinRequestsPerEndpoint = 5,
    [string]$ComposeFile = "compose.packaging.yml",
    [string]$Stage4ComposeFile = "compose.stage4.yml",
    [string]$PythonPath = "python",
    [switch]$LoadP0CapacityFixture,
    [switch]$RequireRetentionRun,
    [switch]$SkipProtectedServiceCheck,
    [switch]$KeepResourcesOnFailure
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Assert-ImmutableImage([string]$Name, [string]$Reference) {
    if ($Reference -notmatch '^[^@\s]+@sha256:[0-9a-f]{64}$') {
        throw "$Name must use an immutable lowercase @sha256 digest."
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

function Resolve-PythonCommand([string]$Value) {
    if (Test-Path -LiteralPath $Value -PathType Leaf) {
        return (Resolve-Path -LiteralPath $Value).Path
    }
    $command = Get-Command $Value -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -eq $command) {
        throw "Python 3.12 is required on the Stage4 host; pass its executable with -PythonPath."
    }
    return [string]$command.Source
}

function Protect-SensitiveValues([object]$Value) {
    if ($null -eq $Value -or $Value -is [string] -or $Value -is [ValueType]) { return }
    if ($Value -is [System.Collections.IEnumerable] -and -not ($Value -is [System.Management.Automation.PSCustomObject])) {
        foreach ($item in $Value) { Protect-SensitiveValues $item }
        return
    }
    foreach ($property in @($Value.PSObject.Properties)) {
        if ($property.Name -match '(?i)(password|secret|token|private.?key|rabbitmq_url)') {
            $property.Value = "***REDACTED***"
        } else {
            Protect-SensitiveValues $property.Value
        }
    }
}

function Write-EvidenceManifest([string]$Directory) {
    $manifestPath = Join-Path $Directory "stage4-evidence-manifest.json"
    $prefix = $Directory.TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
    $files = @(
        Get-ChildItem -LiteralPath $Directory -File -Recurse -Force |
            Where-Object { $_.FullName -cne $manifestPath } |
            Sort-Object FullName |
            ForEach-Object {
                [ordered]@{
                    path = $_.FullName.Substring($prefix.Length).Replace("\", "/")
                    bytes = [long]$_.Length
                    sha256 = Get-Sha256 $_.FullName
                }
            }
    )
    [ordered]@{
        format = "mes-stage4-evidence"
        format_version = 1
        created_at_utc = [DateTime]::UtcNow.ToString("o")
        manifest_self_excluded = $true
        external_manifest_sha256_required = $true
        files = $files
    } | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $manifestPath -Encoding utf8
}

function Get-ProjectResourceIds([string]$Kind, [string]$Name) {
    switch ($Kind) {
        "container" { $result = @(& docker ps -a --filter "label=com.docker.compose.project=$Name" --format "{{.ID}}") }
        "volume" { $result = @(& docker volume ls --filter "label=com.docker.compose.project=$Name" --quiet) }
        "network" { $result = @(& docker network ls --filter "label=com.docker.compose.project=$Name" --quiet) }
        default { throw "Unsupported Docker resource kind: $Kind" }
    }
    if ($LASTEXITCODE -ne 0) { throw "Could not query Docker $Kind resources." }
    return @($result | Where-Object { ([string]$_).Trim() })
}

function Assert-ProjectLabels([string]$Name) {
    foreach ($kind in @("container", "volume", "network")) {
        $ids = @(Get-ProjectResourceIds $kind $Name)
        if (-not $ids.Count) { continue }
        foreach ($id in $ids) {
            switch ($kind) {
                "container" { $labelJson = & docker inspect --format "{{json .Config.Labels}}" $id }
                "volume" { $labelJson = & docker volume inspect --format "{{json .Labels}}" $id }
                "network" { $labelJson = & docker network inspect --format "{{json .Labels}}" $id }
            }
            if ($LASTEXITCODE -ne 0) { throw "Could not inspect Docker $kind resource: $id" }
            $labels = ($labelJson -join "`n") | ConvertFrom-Json
            $actual = [string]$labels.'com.docker.compose.project'
            if ($actual -cne $Name) { throw "Docker $kind project label mismatch: $actual" }
        }
    }
}

function Get-ProtectedPortOwners() {
    $owners = [ordered]@{}
    foreach ($port in @(3306, 1883, 5173, 8000)) {
        $connections = @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)
        $owners[[string]$port] = @($connections | Select-Object -ExpandProperty OwningProcess -Unique | Sort-Object)
    }
    return $owners
}

function Assert-ProtectedPortOwners([object]$Before) {
    $after = Get-ProtectedPortOwners
    foreach ($port in @("3306", "1883", "5173", "8000")) {
        if ([string]::Join(",", @($Before[$port])) -cne [string]::Join(",", @($after[$port]))) {
            throw "Protected local port owner changed during Stage4: $port"
        }
    }
}

function Test-Stage4SteadyState([string]$Name) {
    foreach ($service in @("mysql", "rabbitmq", "api", "web")) {
        $ids = @(& docker ps -a `
            --filter "label=com.docker.compose.project=$Name" `
            --filter "label=com.docker.compose.service=$service" `
            --format "{{.ID}}")
        if ($LASTEXITCODE -ne 0 -or $ids.Count -ne 1) { return $false }
        $health = & docker inspect --format "{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}" $ids[0]
        if ($LASTEXITCODE -ne 0 -or ([string]$health).Trim() -cne "healthy") { return $false }
    }
    $migrateIds = @(& docker ps -a `
        --filter "label=com.docker.compose.project=$Name" `
        --filter "label=com.docker.compose.service=migrate" `
        --format "{{.ID}}")
    if ($LASTEXITCODE -ne 0 -or $migrateIds.Count -ne 1) { return $false }
    $migrateState = & docker inspect --format "{{.State.Status}}|{{.State.ExitCode}}" $migrateIds[0]
    return $LASTEXITCODE -eq 0 -and ([string]$migrateState).Trim() -ceq "exited|0"
}

function Test-Stage4BootstrapState([string]$Name) {
    foreach ($service in @("mysql", "rabbitmq")) {
        $ids = @(& docker ps -a `
            --filter "label=com.docker.compose.project=$Name" `
            --filter "label=com.docker.compose.service=$service" `
            --format "{{.ID}}")
        if ($LASTEXITCODE -ne 0 -or $ids.Count -ne 1) { return $false }
        $health = & docker inspect --format "{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}" $ids[0]
        if ($LASTEXITCODE -ne 0 -or ([string]$health).Trim() -cne "healthy") { return $false }
    }
    $migrateIds = @(& docker ps -a `
        --filter "label=com.docker.compose.project=$Name" `
        --filter "label=com.docker.compose.service=migrate" `
        --format "{{.ID}}")
    if ($LASTEXITCODE -ne 0 -or $migrateIds.Count -ne 1) { return $false }
    $migrateState = & docker inspect --format "{{.State.Status}}|{{.State.ExitCode}}" $migrateIds[0]
    return $LASTEXITCODE -eq 0 -and ([string]$migrateState).Trim() -ceq "exited|0"
}

if ($ProjectName -notmatch '^[a-z0-9][a-z0-9-]*-stage4-soak$') {
    throw "ProjectName must be a dedicated lowercase name ending in -stage4-soak."
}
if ($DurationSeconds -le 0 -or $WindowSeconds -le 0 -or $Users -lt 1 -or $MinRequestsPerEndpoint -lt 1) {
    throw "Stage4 duration/window/users/minimum request parameters are invalid."
}
if ($RequireRetentionRun -and -not $LoadP0CapacityFixture) {
    throw "Formal Stage4 retention acceptance requires -LoadP0CapacityFixture on the brand-new isolated database."
}

$envPath = (Resolve-Path -LiteralPath $EnvFile).Path
$composePath = (Resolve-Path -LiteralPath $ComposeFile).Path
$stage4ComposePath = (Resolve-Path -LiteralPath $Stage4ComposeFile).Path
$python = Resolve-PythonCommand $PythonPath
$pythonVersion = (& $python --version 2>&1) -join "`n"
if ($LASTEXITCODE -ne 0 -or $pythonVersion -notmatch '^Python 3\.12\.') {
    throw "Stage4 requires Python 3.12; resolved executable reported: $pythonVersion"
}
$probe = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\stage4_soak_probe.py")).Path
$fixtureScript = if ($LoadP0CapacityFixture) {
    (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\generate_p0_capacity_fixture.py")).Path
} else { $null }
$output = [System.IO.Path]::GetFullPath($OutputDirectory)
if (Test-Path -LiteralPath $output) { throw "OutputDirectory already exists: $output" }

$composeArguments = @(
    "compose", "--project-name", $ProjectName,
    "--env-file", $envPath,
    "-f", $composePath,
    "-f", $stage4ComposePath
)
$configJson = & docker @composeArguments config --format json
if ($LASTEXITCODE -ne 0) { throw "Stage4 Compose configuration is invalid." }
$config = ($configJson -join "`n") | ConvertFrom-Json
if ([string]$config.name -cne $ProjectName) { throw "Compose project name does not match ProjectName." }
if ([string]$config.services.mysql.environment.MYSQL_DATABASE -cnotmatch '^[a-z0-9_]+_stage4_test$') {
    throw "Stage4 MySQL database must end in _stage4_test."
}
$stage4Database = [string]$config.services.mysql.environment.MYSQL_DATABASE
foreach ($service in @("migrate", "api")) {
    if ([string]$config.services.$service.environment.MYSQL_HOST -cne "mysql" -or
        [string]$config.services.$service.environment.MYSQL_PORT -cne "3306" -or
        [string]$config.services.$service.environment.MYSQL_DATABASE -cne $stage4Database) {
        throw "Stage4 $service database target must be exactly mysql:3306/$stage4Database."
    }
}
foreach ($service in @("mysql", "rabbitmq", "migrate", "api", "web")) {
    Assert-ImmutableImage "$service image" ([string]$config.services.$service.image)
    if ([string]$config.services.$service.pull_policy -cne "never") { throw "Stage4 pull policy must be never: $service" }
    if ($service -ne "migrate" -and [string]$config.services.$service.restart -cne "no") {
        throw "Stage4 restart policy must be no: $service"
    }
}

$protectedPorts = @(3306, 1883, 5173, 8000, 8088)
$publishedPorts = New-Object 'System.Collections.Generic.HashSet[int]'
foreach ($serviceProperty in $config.services.PSObject.Properties) {
    $portsProperty = $serviceProperty.Value.PSObject.Properties["ports"]
    if ($null -eq $portsProperty) { continue }
    foreach ($port in @($portsProperty.Value)) {
        $published = [int]$port.published
        if ([string]$port.host_ip -cne "127.0.0.1") { throw "Stage4 ports must bind only to 127.0.0.1." }
        if ($protectedPorts -contains $published) { throw "Stage4 attempted to use a protected local port: $published" }
        if (-not $publishedPorts.Add($published)) { throw "Stage4 published port is duplicated: $published" }
    }
}
foreach ($port in $publishedPorts) {
    if (@(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue).Count) {
        throw "Stage4 published port is already in use: $port"
    }
}
$apiPort = [int]@($config.services.api.ports)[0].published
if ($apiPort -eq 8000) { throw "Stage4 probe must not target the local API port 8000." }
$baseUrl = "http://127.0.0.1:$apiPort"
$webPort = [int]@($config.services.web.ports)[0].published
$webUrl = "http://127.0.0.1:$webPort/"

foreach ($kind in @("container", "volume", "network")) {
    if (@(Get-ProjectResourceIds $kind $ProjectName).Count) {
        throw "Stage4 requires a brand-new Docker project; existing $kind resources were found."
    }
}
$protectedBefore = if ($SkipProtectedServiceCheck) { $null } else { Get-ProtectedPortOwners }
New-Item -ItemType Directory -Path $output | Out-Null
$redactedConfig = (($configJson -join "`n") | ConvertFrom-Json)
Protect-SensitiveValues $redactedConfig
$redactedConfig | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath (Join-Path $output "compose-config.redacted.json") -Encoding utf8
$hostEvidence = [ordered]@{
    captured_at_utc = [DateTime]::UtcNow.ToString("o")
    os_version = [System.Environment]::OSVersion.VersionString
    machine_name = [System.Environment]::MachineName
    processor_count = [System.Environment]::ProcessorCount
    powershell_version = $PSVersionTable.PSVersion.ToString()
    python = $pythonVersion
    docker_version = (& docker version --format "{{json .}}" 2>&1) -join "`n"
    docker_compose_version = (& docker compose version 2>&1) -join "`n"
}
$hostEvidence | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $output "stage4-host.json") -Encoding utf8
$imageEvidence = @()
foreach ($service in @("mysql", "rabbitmq", "migrate", "api", "web")) {
    $reference = [string]$config.services.$service.image
    $imageJson = & docker image inspect $reference
    if ($LASTEXITCODE -ne 0) { throw "Stage4 image is not available locally: $reference" }
    $image = @(($imageJson -join "`n") | ConvertFrom-Json)[0]
    $imageEvidence += [ordered]@{
        service = $service
        reference = $reference
        image_id = [string]$image.Id
        os = [string]$image.Os
        architecture = [string]$image.Architecture
    }
}
$imageEvidence | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $output "stage4-images.json") -Encoding utf8
$started = $false
$probeExitCode = 1
$failure = $null
$fixtureEvidence = $null
$reportPath = Join-Path $output "stage4-soak-report.json"

try {
    $started = $true
    & docker @composeArguments up -d --no-build --pull never mysql rabbitmq migrate
    if ($LASTEXITCODE -ne 0) { throw "Stage4 bootstrap startup failed." }
    Assert-ProjectLabels $ProjectName

    $bootstrapReady = $false
    $bootstrapDeadline = [DateTime]::UtcNow.AddMinutes(4)
    while ([DateTime]::UtcNow -lt $bootstrapDeadline) {
        if (Test-Stage4BootstrapState $ProjectName) {
            $bootstrapReady = $true
            break
        }
        Start-Sleep -Seconds 2
    }
    if (-not $bootstrapReady) { throw "Stage4 MySQL/RabbitMQ/migration bootstrap did not complete within four minutes." }

    if ($LoadP0CapacityFixture) {
        $fixtureSnapshotPath = Join-Path $output "p0-capacity-snapshot.json"
        $fixtureLogPath = Join-Path $output "p0-capacity-fixture.log"
        $fixtureArguments = @(
            "run", "--rm", "--no-deps", "-T", "--pull", "never", "--user", "0:0",
            "--volume", "${fixtureScript}:/app/scripts/generate_p0_capacity_fixture.py:ro",
            "--volume", "${output}:/evidence",
            "migrate", "python", "scripts/generate_p0_capacity_fixture.py",
            "--output", "/evidence/p0-capacity-snapshot.json",
            "--apply",
            "--confirm-replace", "REPLACE_CAPACITY_DATABASE",
            "--expected-host", "mysql",
            "--expected-port", "3306",
            "--expected-database", $stage4Database,
            "--stage4-isolated"
        )
        $fixtureLines = @(& docker @composeArguments @fixtureArguments 2>&1)
        $fixtureLines | Set-Content -LiteralPath $fixtureLogPath -Encoding utf8
        if ($LASTEXITCODE -ne 0) { throw "Stage4 P0 capacity fixture load failed." }
        if (-not (Test-Path -LiteralPath $fixtureSnapshotPath -PathType Leaf)) {
            throw "Stage4 fixture did not create the evidence snapshot."
        }
        $fixtureSummary = $null
        foreach ($line in $fixtureLines) {
            try {
                $candidate = ([string]$line) | ConvertFrom-Json
                if ($candidate.tasks -eq 33 -and $candidate.samples -eq 3200 -and $candidate.experiments -eq 132 -and $candidate.experimentSamples -eq 4800) {
                    $fixtureSummary = $candidate
                }
            } catch { }
        }
        if ($null -eq $fixtureSummary) { throw "Stage4 fixture summary did not match the required business scale." }
        $fixtureEvidence = [ordered]@{
            script_path = "scripts/generate_p0_capacity_fixture.py"
            script_sha256 = Get-Sha256 $fixtureScript
            snapshot_path = "p0-capacity-snapshot.json"
            snapshot_bytes = (Get-Item -LiteralPath $fixtureSnapshotPath).Length
            snapshot_sha256 = Get-Sha256 $fixtureSnapshotPath
            target_host = "mysql"
            target_port = 3306
            target_database = $stage4Database
            summary = $fixtureSummary
        }
        $fixtureEvidence | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $output "p0-capacity-fixture-evidence.json") -Encoding utf8
    }

    & docker @composeArguments up -d --no-build --pull never api web
    if ($LASTEXITCODE -ne 0) { throw "Stage4 API/Web startup failed." }

    $ready = $false
    $deadline = [DateTime]::UtcNow.AddMinutes(4)
    while ([DateTime]::UtcNow -lt $deadline) {
        try {
            $payload = Invoke-RestMethod -Uri "$baseUrl/health/ready" -TimeoutSec 5
            $webResponse = Invoke-WebRequest -Uri $webUrl -UseBasicParsing -TimeoutSec 5
            if ([string]$payload.status -ceq "ready" -and $webResponse.StatusCode -eq 200 -and (Test-Stage4SteadyState $ProjectName)) {
                $ready = $true
                break
            }
        } catch { }
        Start-Sleep -Seconds 2
    }
    if (-not $ready) { throw "Stage4 stack did not reach API/Web/container steady state within four minutes." }

    $probeArguments = @(
        $probe,
        "--base-url", $baseUrl,
        "--duration", [string]$DurationSeconds,
        "--users", [string]$Users,
        "--window-seconds", [string]$WindowSeconds,
        "--min-requests-per-endpoint", [string]$MinRequestsPerEndpoint,
        "--docker-project", $ProjectName,
        "--output", $reportPath
    )
    if ($RequireRetentionRun) { $probeArguments += "--require-retention-run" }
    if ($LoadP0CapacityFixture) {
        $probeArguments += @(
            "--expected-task-count", "33",
            "--expected-sample-count", "3200",
            "--expected-experiment-count", "132",
            "--expected-experiment-sample-count", "4800",
            "--expected-identity-sha256", "d4cf312db0a1a62e663c1d46fe8a3871c6135a69c2e12c41f2b8b0a3f8526415"
        )
    }
    & $python @probeArguments *> (Join-Path $output "stage4-probe-console.log")
    $probeExitCode = $LASTEXITCODE
    if ($probeExitCode -ne 0) { throw "Stage4 probe reported failure. See $reportPath" }
} catch {
    $failure = $_
} finally {
    if ($started) {
        & docker @composeArguments ps --all --format json 2>&1 | Set-Content -LiteralPath (Join-Path $output "compose-ps.jsonl") -Encoding utf8
        & docker @composeArguments logs --no-color --timestamps 2>&1 | Set-Content -LiteralPath (Join-Path $output "compose.log") -Encoding utf8
        & docker system df -v 2>&1 | Set-Content -LiteralPath (Join-Path $output "docker-system-df.txt") -Encoding utf8
    }
    $shouldKeep = $KeepResourcesOnFailure -and $null -ne $failure
    if ($started -and -not $shouldKeep) {
        Assert-ProjectLabels $ProjectName
        & docker @composeArguments down --volumes --remove-orphans
        if ($LASTEXITCODE -ne 0) { throw "Stage4 exact cleanup failed." }
        foreach ($kind in @("container", "volume", "network")) {
            if (@(Get-ProjectResourceIds $kind $ProjectName).Count) {
                throw "Stage4 cleanup left Docker $kind resources behind."
            }
        }
    }
    if ($null -ne $protectedBefore) { Assert-ProtectedPortOwners $protectedBefore }
}

$summary = [ordered]@{
    project = $ProjectName
    base_url = $baseUrl
    duration_seconds = $DurationSeconds
    users = $Users
    probe_exit_code = $probeExitCode
    fixture = $fixtureEvidence
    resources_retained = [bool]($KeepResourcesOnFailure -and $null -ne $failure)
    completed_at_utc = [DateTime]::UtcNow.ToString("o")
}
$summary | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $output "stage4-runner-summary.json") -Encoding utf8
Write-EvidenceManifest $output
if ($null -ne $failure) { throw $failure }
Write-Host "Stage4 isolated acceptance passed; report: $reportPath"
