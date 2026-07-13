param(
    [ValidateSet("Status", "Start", "Stop", "Restart")]
    [string]$Action = "Status",
    [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot),
    [string]$StateFile = (Join-Path $env:LOCALAPPDATA "MesFastApiLauncher\mes-service-state.json"),
    [switch]$IgnorePortListeners,
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$backendPort = 8000
$frontendPort = 5173

function Write-Result([string]$Status, [string]$Message) {
    [pscustomobject]@{ status = $Status; message = $Message } | ConvertTo-Json -Compress
}

function Read-State {
    if (-not (Test-Path -LiteralPath $StateFile)) { return $null }
    try { return Get-Content -LiteralPath $StateFile -Raw | ConvertFrom-Json } catch { return $null }
}

function Get-ListenerPids([int]$Port) {
    @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)
}

function Test-ProcessAlive($ProcessId) {
    return [bool]($ProcessId -and (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue))
}

function Test-MesRunning {
    $state = Read-State
    $tracked = @($state.backendCommandPid, $state.frontendCommandPid) | Where-Object { Test-ProcessAlive $_ }
    if ($IgnorePortListeners) { return [bool]($tracked.Count -gt 0) }
    return [bool]($tracked.Count -gt 0 -or (Get-ListenerPids $backendPort).Count -gt 0 -or (Get-ListenerPids $frontendPort).Count -gt 0)
}

function Test-MesHttpReady([string]$Url) {
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 2
        return $response.StatusCode -ge 200 -and $response.StatusCode -lt 500
    } catch {
        return $false
    }
}

function Stop-ProcessTree($ProcessId) {
    if (Test-ProcessAlive $ProcessId) {
        & taskkill.exe /PID $ProcessId /T /F | Out-Null
    }
}

function Stop-MesSystem {
    if (-not (Test-MesRunning)) { return @{ status = "not_running"; message = "未检测到开启的MES系统，无需关闭" } }
    if ($DryRun) { return @{ status = "stopped"; message = "MES系统已关闭" } }

    $state = Read-State
    @($state.browserPid, $state.backendCommandPid, $state.frontendCommandPid) | ForEach-Object { Stop-ProcessTree $_ }
    if (-not $IgnorePortListeners) {
        @(Get-ListenerPids $backendPort) + @(Get-ListenerPids $frontendPort) | Select-Object -Unique | ForEach-Object { Stop-ProcessTree $_ }
    }
    if (Test-Path -LiteralPath $StateFile) { Remove-Item -LiteralPath $StateFile -Force }
    return @{ status = "stopped"; message = "MES系统已关闭" }
}

function Start-MesSystem {
    if (Test-MesRunning) { return @{ status = "already_running"; message = "MES系统已经打开，无需再次开启" } }
    if ($DryRun) { return @{ status = "started"; message = "MES系统已启动" } }

    $startScript = Join-Path $ProjectRoot "start-dev.ps1"
    if (-not (Test-Path -LiteralPath $startScript)) { throw "未找到启动脚本: $startScript" }
    $stateDirectory = Split-Path -Parent $StateFile
    if ($stateDirectory) { New-Item -ItemType Directory -Force -Path $stateDirectory | Out-Null }
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $startScript -DisableAutoOpenBrowser -StateFile $StateFile

    $backendReadyUrl = "http://127.0.0.1:$backendPort/api/storage"
    $frontendReadyUrl = "http://127.0.0.1:$frontendPort/"
    $deadline = (Get-Date).AddSeconds(90)
    $backendReady = $false
    $frontendReady = $false
    do {
        $backendReady = Test-MesHttpReady $backendReadyUrl
        $frontendReady = Test-MesHttpReady $frontendReadyUrl
        if ($backendReady -and $frontendReady) { break }
        Start-Sleep -Milliseconds 500
    } while ((Get-Date) -lt $deadline)
    if (-not ($backendReady -and $frontendReady)) { throw "前后端服务未能在90秒内准备完成" }

    $state = Read-State
    $frontendUrl = $state.frontendUrl
    if (-not $frontendUrl) { $frontendUrl = "http://127.0.0.1:$frontendPort/" }
    Start-Process $frontendUrl
    return @{ status = "started"; message = "MES系统已启动" }
}

switch ($Action) {
    "Status" { if (Test-MesRunning) { Write-Result "running" "MES系统正在运行" } else { Write-Result "stopped" "MES系统未启动" } }
    "Stop" { $result = Stop-MesSystem; Write-Result $result.status $result.message }
    "Start" { $result = Start-MesSystem; Write-Result $result.status $result.message }
    "Restart" { $stop = Stop-MesSystem; $result = Start-MesSystem; Write-Result $result.status $(if ($stop.status -eq "not_running") { "MES系统已启动" } else { "MES系统已重启" }) }
}
