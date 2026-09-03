param(
    [ValidateSet("Status", "Start", "Stop", "Restart")]
    [string]$Action = "Status",
    [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot),
    [string]$StateFile = (Join-Path $env:LOCALAPPDATA "MesFastApiLauncher\mes-service-state.json"),
    [string]$ResultFile = "",
    [switch]$IgnorePortListeners,
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$backendPort = 8000
$frontendPort = 5173
$frontendNetworkHost = "mes-server"
$limsSimulatorPort = 8900
$upperComputerSimulatorPort = 8899

function Write-Result([string]$Status, [string]$Message, $Health = $null) {
    $payload = [ordered]@{ status = $Status; message = $Message }
    if ($null -ne $Health) {
        $payload.backend = [bool]$Health.backend
        $payload.frontend = [bool]$Health.frontend
        $payload.lims = [bool]$Health.lims
        $payload.upperComputer = [bool]$Health.upperComputer
    }
    $json = [pscustomobject]$payload | ConvertTo-Json -Compress
    if ($ResultFile) {
        $resultDirectory = Split-Path -Parent $ResultFile
        if ($resultDirectory) { New-Item -ItemType Directory -Force -Path $resultDirectory | Out-Null }
        Set-Content -LiteralPath $ResultFile -Value $json -Encoding UTF8
    }
    $json
}

function Read-State {
    if (-not (Test-Path -LiteralPath $StateFile)) { return $null }
    try { return Get-Content -LiteralPath $StateFile -Raw | ConvertFrom-Json } catch { return $null }
}

function Get-ListenerPids([int]$Port) {
    @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)
}

function Get-MesListenerPids {
    @(
        @(Get-ListenerPids $backendPort)
        @(Get-ListenerPids $frontendPort)
        @(Get-ListenerPids $limsSimulatorPort)
        @(Get-ListenerPids $upperComputerSimulatorPort)
    ) | Where-Object { $_ } | Select-Object -Unique
}

function Test-ProcessAlive($ProcessId) {
    return [bool]($ProcessId -and (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue))
}

function Test-MesRunning {
    $state = Read-State
    $tracked = @($state.backendCommandPid, $state.frontendCommandPid, $state.limsSimulatorCommandPid) | Where-Object { Test-ProcessAlive $_ }
    if ($IgnorePortListeners) { return [bool]($tracked.Count -gt 0) }
    return [bool]($tracked.Count -gt 0 -or (Get-ListenerPids $backendPort).Count -gt 0 -or (Get-ListenerPids $frontendPort).Count -gt 0 -or (Get-ListenerPids $limsSimulatorPort).Count -gt 0 -or (Get-ListenerPids $upperComputerSimulatorPort).Count -gt 0)
}

function Test-MesHttpReady([string]$Url) {
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 2
        return $response.StatusCode -ge 200 -and $response.StatusCode -lt 300
    } catch {
        return $false
    }
}

function Test-LimsRabbitReady {
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$limsSimulatorPort/api/state" -TimeoutSec 2
        if ($response.StatusCode -lt 200 -or $response.StatusCode -ge 300) { return $false }
        $state = $response.Content | ConvertFrom-Json
        return [bool]$state.connected
    } catch {
        return $false
    }
}

function Test-UpperComputerReady {
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$upperComputerSimulatorPort/api/state" -TimeoutSec 2
        if ($response.StatusCode -lt 200 -or $response.StatusCode -ge 300) { return $false }
        $state = $response.Content | ConvertFrom-Json
        $autoMode = if ($null -ne $state.config.auto_mode) { $state.config.auto_mode } else { $state.config.autoMode }
        return [bool]$state.connected -and [bool]$autoMode
    } catch {
        return $false
    }
}

function Get-MesServiceHealth {
    return [pscustomobject]@{
        backend = Test-MesHttpReady "http://127.0.0.1:$backendPort/health/ready"
        frontend = Test-MesHttpReady "http://127.0.0.1:$frontendPort/"
        lims = Test-LimsRabbitReady
        upperComputer = Test-UpperComputerReady
    }
}

function Open-MesPages($State) {
    $frontendUrl = $State.frontendLocalUrl
    if (-not $frontendUrl) { $frontendUrl = "http://127.0.0.1:$frontendPort/" }
    $limsSimulatorUrl = $State.limsSimulatorUrl
    if (-not $limsSimulatorUrl) { $limsSimulatorUrl = "http://127.0.0.1:$limsSimulatorPort/" }
    Start-Process $frontendUrl
    Start-Process $limsSimulatorUrl
}

function Stop-ProcessTree($ProcessId) {
    if (-not (Test-ProcessAlive $ProcessId)) { return }

    # taskkill /T can terminate the requested service successfully and still
    # report an error for a console-host child that exited concurrently or is
    # managed by Windows. Treat taskkill as best effort, suppress both streams,
    # then force-stop the requested root if it remains. Port release below is
    # the authoritative shutdown result.
    $previousErrorActionPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = "SilentlyContinue"
        & taskkill.exe /PID $ProcessId /T /F 2>&1 | Out-Null
    } catch {
        # Process-tree races are expected during shutdown.
    } finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }

    if (Test-ProcessAlive $ProcessId) {
        Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
    }
}

function Get-ProcessMap {
    $map = @{}
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | ForEach-Object {
        $map[[int]$_.ProcessId] = $_
    }
    return $map
}

function Get-MesCommandPids($ProcessMap, [string]$LauncherSessionId = "") {
    $sessionMarker = if ($LauncherSessionId) { "MES_LAUNCHER_SESSION=$LauncherSessionId" } else { "" }
    @($ProcessMap.Values | Where-Object {
        $commandLine = [string]$_.CommandLine
        if (-not $commandLine -or [string]$_.Name -notmatch "(?i)^cmd\.exe$") { return $false }
        if ($sessionMarker) { return $commandLine -like "*$sessionMarker*" }
        return $commandLine -like "*$ProjectRoot*" -and (
            $commandLine -like "*scripts\run_local.py*" `
                -or $commandLine -like "*npm run dev*" `
                -or $commandLine -like "*npm run serve:public*" `
                -or $commandLine -like "*tools\lims_simulator*"
        )
    } | Select-Object -ExpandProperty ProcessId -Unique)
}

function Get-ParentCommandPids($ProcessMap, $ProcessIds) {
    $commandPids = @()
    foreach ($processId in @($ProcessIds)) {
        $currentId = [int]$processId
        for ($depth = 0; $depth -lt 32 -and $ProcessMap.ContainsKey($currentId); $depth++) {
            $process = $ProcessMap[$currentId]
            if ([string]$process.Name -match "(?i)^cmd\.exe$") {
                $commandPids += $currentId
                break
            }
            $currentId = [int]$process.ParentProcessId
        }
    }
    return @($commandPids | Select-Object -Unique)
}

function Stop-TrackedMesProcess($ProcessId) {
    if (-not $ProcessId) { return }
    $process = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
    if (-not $process) { return }
    # Windows Terminal is shared by tabs and may host unrelated user shells; close only MES command trees.
    if ($process.ProcessName -match "(?i)^(WindowsTerminal|wt|OpenConsole)$") { return }
    Stop-ProcessTree $ProcessId
}

function Wait-ProcessesExited($ProcessIds, [int]$TimeoutSeconds = 5) {
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        $alive = @($ProcessIds | Where-Object { $_ -and (Test-ProcessAlive $_) })
        if ($alive.Count -eq 0) { return $true }
        Start-Sleep -Milliseconds 100
    } while ((Get-Date) -lt $deadline)
    return $false
}

function Wait-MesPortsReleased([int]$TimeoutSeconds = 10) {
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        $listenerPids = @(Get-MesListenerPids)
        if ($listenerPids.Count -eq 0) { return }

        # A service wrapper or stale development reloader can replace the
        # original listener while shutdown is in progress. Re-read and reap
        # listeners until every MES port is actually free.
        $listenerPids | ForEach-Object { Stop-ProcessTree $_ }
        Start-Sleep -Milliseconds 200
    } while ((Get-Date) -lt $deadline)

    $remainingListeners = @(
        foreach ($port in @($backendPort, $frontendPort, $limsSimulatorPort, $upperComputerSimulatorPort)) {
            foreach ($processId in @(Get-ListenerPids $port)) {
                "${port}/PID ${processId}"
            }
        }
    )
    $detail = if ($remainingListeners.Count -gt 0) { $remainingListeners -join ", " } else { "未知监听进程" }
    throw "MES服务端口未能在${TimeoutSeconds}秒内释放: $detail"
}

function Stop-MesSystem {
    if (-not (Test-MesRunning)) { return @{ status = "not_running"; message = "未检测到开启的MES系统，无需关闭" } }
    if ($DryRun) { return @{ status = "stopped"; message = "MES系统已关闭" } }

    $state = Read-State
    $processMap = Get-ProcessMap
    $listenerPids = if ($IgnorePortListeners) { @() } else { @(Get-MesListenerPids) }
    $commandPids = @(
        @($state.backendCommandPid, $state.frontendCommandPid, $state.limsSimulatorCommandPid)
        @(Get-MesCommandPids $processMap $state.launcherSessionId)
        @(Get-ParentCommandPids $processMap $listenerPids)
    ) | Where-Object { $_ } | Select-Object -Unique
    Stop-TrackedMesProcess $state.browserPid
    # Stop the command roots first. Waiting for ports while their parents are
    # still alive lets wrappers/reloaders retain or recreate the listeners.
    $commandPids | ForEach-Object { Stop-TrackedMesProcess $_ }
    if (-not $IgnorePortListeners) {
        Wait-MesPortsReleased
    }
    if (-not (Wait-ProcessesExited $commandPids)) {
        $commandPids | ForEach-Object { Stop-TrackedMesProcess $_ }
    }
    if (Test-Path -LiteralPath $StateFile) { Remove-Item -LiteralPath $StateFile -Force }
    return @{ status = "stopped"; message = "MES系统已关闭" }
}

function Start-MesSystem {
    if (Test-MesRunning) {
        $runningBackendReady = Test-MesHttpReady "http://127.0.0.1:$backendPort/health/ready"
        $runningFrontendReady = Test-MesHttpReady "http://127.0.0.1:$frontendPort/"
        $runningLimsReady = Test-LimsRabbitReady
        $runningUpperComputerReady = Test-UpperComputerReady
        if ($runningBackendReady -and $runningFrontendReady -and $runningLimsReady -and $runningUpperComputerReady) {
            Open-MesPages (Read-State)
            return @{ status = "already_running"; message = "MES系统已经运行，已打开MES与LIMS模拟器页面" }
        }
        # 旧版本服务或异常中断可能只留下部分端口。先统一回收，再按完整服务组重启。
        $null = Stop-MesSystem
    }
    if ($DryRun) { return @{ status = "started"; message = "MES系统已启动" } }

    $startScript = Join-Path $ProjectRoot "start-dev.ps1"
    if (-not (Test-Path -LiteralPath $startScript)) { throw "未找到启动脚本: $startScript" }
    $stateDirectory = Split-Path -Parent $StateFile
    if ($stateDirectory) { New-Item -ItemType Directory -Force -Path $stateDirectory | Out-Null }
    $bootstrapLogDirectory = Join-Path $stateDirectory "logs"
    New-Item -ItemType Directory -Force -Path $bootstrapLogDirectory | Out-Null
    $bootstrapStdout = Join-Path $bootstrapLogDirectory "bootstrap.stdout.log"
    $bootstrapStderr = Join-Path $bootstrapLogDirectory "bootstrap.stderr.log"
    $startArguments = "-NoProfile -ExecutionPolicy Bypass -File `"$startScript`" -Production -DisableAutoOpenBrowser -FrontendNetworkHost `"$frontendNetworkHost`" -StateFile `"$StateFile`""
    $startProcess = Start-Process -FilePath "powershell.exe" -ArgumentList $startArguments `
        -WorkingDirectory $ProjectRoot -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput $bootstrapStdout -RedirectStandardError $bootstrapStderr
    $startProcess.WaitForExit()
    $startExitCode = $startProcess.ExitCode
    $startDetail = ""
    if ($startExitCode -ne 0) {
        $startDetail = @(
            $(if (Test-Path -LiteralPath $bootstrapStdout) { Get-Content -Raw -LiteralPath $bootstrapStdout })
            $(if (Test-Path -LiteralPath $bootstrapStderr) { Get-Content -Raw -LiteralPath $bootstrapStderr })
        ) -join [Environment]::NewLine
        $startDetail = $startDetail.Trim()
        if (-not (Test-Path -LiteralPath $StateFile)) {
            if ($startDetail) { throw "启动脚本执行失败: $startDetail" }
            throw "启动脚本执行失败，退出码: $startExitCode"
        }
    }
    if (-not (Test-Path -LiteralPath $StateFile)) { throw "启动脚本未写入服务状态文件" }

    $backendReadyUrl = "http://127.0.0.1:$backendPort/health/ready"
    $frontendReadyUrl = "http://127.0.0.1:$frontendPort/"
    $limsSimulatorReadyUrl = "http://127.0.0.1:$limsSimulatorPort/api/state"
    $deadline = (Get-Date).AddSeconds(90)
    $backendReady = $false
    $frontendReady = $false
    $limsSimulatorReady = $false
    $upperComputerReady = $false
    do {
        $backendReady = Test-MesHttpReady $backendReadyUrl
        $frontendReady = Test-MesHttpReady $frontendReadyUrl
        $limsSimulatorReady = Test-LimsRabbitReady
        $upperComputerReady = Test-UpperComputerReady
        if ($backendReady -and $frontendReady -and $limsSimulatorReady -and $upperComputerReady) { break }
        Start-Sleep -Milliseconds 500
    } while ((Get-Date) -lt $deadline)
    if (-not ($backendReady -and $frontendReady -and $limsSimulatorReady -and $upperComputerReady)) {
        if ($startDetail) { throw "启动脚本执行异常且服务未准备完成: $startDetail" }
        throw "后端、前端、LIMS模拟器及上位机服务未能在90秒内准备完成"
    }

    Open-MesPages (Read-State)
    return @{ status = "started"; message = "MES系统已启动" }
}

try {
    switch ($Action) {
        "Status" {
            if ($IgnorePortListeners -and -not (Test-MesRunning)) {
                $stoppedHealth = [pscustomobject]@{ backend = $false; frontend = $false; lims = $false; upperComputer = $false }
                Write-Result "stopped" "MES系统未启动" $stoppedHealth
                break
            }
            $health = Get-MesServiceHealth
            $healthyCount = @(@($health.backend, $health.frontend, $health.lims, $health.upperComputer) | Where-Object { $_ }).Count
            if ($healthyCount -eq 4) {
                Write-Result "running" "MES系统四项服务均已就绪" $health
            } elseif ($healthyCount -eq 0 -and -not (Test-MesRunning)) {
                Write-Result "stopped" "MES系统未启动" $health
            } else {
                Write-Result "partial" "MES系统部分服务未就绪" $health
            }
        }
        "Stop" { $result = Stop-MesSystem; Write-Result $result.status $result.message }
        "Start" { $result = Start-MesSystem; Write-Result $result.status $result.message }
        "Restart" { $stop = Stop-MesSystem; $result = Start-MesSystem; Write-Result $result.status $(if ($stop.status -eq "not_running") { "MES系统已启动" } else { "MES系统已重启" }) }
    }
} catch {
    Write-Result "error" $_.Exception.Message
    exit 1
}
