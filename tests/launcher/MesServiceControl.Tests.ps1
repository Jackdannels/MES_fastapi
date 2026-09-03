$projectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$controller = Join-Path $projectRoot "scripts\mes-service-control.ps1"

Describe "MES service controller" {
    It "detects Windows Terminal before choosing development terminal hosts" {
        $startScript = Get-Content -LiteralPath (Join-Path $projectRoot "start-dev.ps1") -Raw

        $startScript | Should Match '\$windowsTerminal = Get-Command "wt\.exe" -ErrorAction SilentlyContinue'
    }

    It "starts titled backend, frontend, and LIMS tabs through Windows Terminal in development" {
        $startScript = Get-Content -LiteralPath (Join-Path $projectRoot "start-dev.ps1") -Raw

        $startScript | Should Match '(?s)elseif \(\$windowsTerminal\).*?\$terminalProcess = Start-Process -FilePath \$windowsTerminal\.Source.*?"new-tab", "--title", ''"MES Backend"'', "cmd\.exe", \$terminalCommandSwitch, \$backendTerminalCommand.*?"new-tab", "--title", ''"MES Frontend"'', "cmd\.exe", \$terminalCommandSwitch, \$frontendTerminalCommand.*?"new-tab", "--title", ''"MES LIMS Simulator"'''
        $startScript | Should Match '\$backendProcess = \$terminalProcess'
        $startScript | Should Match '\$frontendProcess = \$terminalProcess'
    }

    It "starts and tracks the LIMS simulator with the MES service group" {
        $startScript = Get-Content -LiteralPath (Join-Path $projectRoot "start-dev.ps1") -Raw
        $controllerSource = Get-Content -LiteralPath $controller -Raw

        $startScript | Should Match '"MES LIMS Simulator"'
        $startScript | Should Match 'python -m uvicorn app:app --host \$LimsSimulatorHost --port \$LimsSimulatorPort'
        $startScript | Should Match 'limsSimulatorCommandPid = \$limsSimulatorProcess\.Id'
        $controllerSource | Should Match '\$limsSimulatorPort = 8900'
        $controllerSource | Should Match '\$state\.limsSimulatorCommandPid'
        $controllerSource | Should Match 'http://127\.0\.0\.1:\$limsSimulatorPort/api/state'
        $controllerSource | Should Match 'Start-Process \$limsSimulatorUrl'
        $controllerSource | Should Match 'function Open-MesPages'
        $controllerSource | Should Match '\$runningBackendReady -and \$runningFrontendReady -and \$runningLimsReady'
        $controllerSource | Should Match '\$null = Stop-MesSystem'
    }

    It "tracks the backend-managed upper-computer service through health and shutdown" {
        $startScript = Get-Content -LiteralPath (Join-Path $projectRoot "start-dev.ps1") -Raw
        $controllerSource = Get-Content -LiteralPath $controller -Raw

        $controllerSource | Should Match '\$upperComputerSimulatorPort = 8899'
        $controllerSource | Should Match 'function Test-UpperComputerReady'
        $controllerSource | Should Match 'http://127\.0\.0\.1:\$upperComputerSimulatorPort/api/state'
        $controllerSource | Should Match '\[bool\]\$state\.connected -and \[bool\]\$autoMode'
        $controllerSource | Should Match 'Get-ListenerPids \$upperComputerSimulatorPort'
        $controllerSource | Should Match '\$runningUpperComputerReady'
        $controllerSource | Should Match '\$upperComputerReady'
        $controllerSource | Should Match '@\(\$backendPort, \$frontendPort, \$limsSimulatorPort, \$upperComputerSimulatorPort\)'
        $startScript | Should Match 'upperComputerSimulatorPort = \$UpperComputerSimulatorPort'
        $startScript | Should Match 'upperComputerSimulatorUrl = \$upperComputerSimulatorUrl'
    }

    It "reports four-service running, partial, and stopped status data" {
        $controllerSource = Get-Content -LiteralPath $controller -Raw

        $controllerSource | Should Match 'function Get-MesServiceHealth'
        $controllerSource | Should Match 'Write-Result "running" "MES系统四项服务均已就绪" \$health'
        $controllerSource | Should Match 'Write-Result "partial" "MES系统部分服务未就绪" \$health'
        $controllerSource | Should Match '\$payload\.upperComputer = \[bool\]\$Health\.upperComputer'
    }

    It "keeps multiword Windows Terminal tab titles quoted after ArgumentList is joined" {
        $startScript = Get-Content -LiteralPath (Join-Path $projectRoot "start-dev.ps1") -Raw

        $startScript | Should Match "\x27`"MES Backend`"\x27"
        $startScript | Should Match "\x27`"MES Frontend`"\x27"
    }

    It "shows production backend and frontend consoles without exposing the LIMS terminal" {
        $startScript = Get-Content -LiteralPath (Join-Path $projectRoot "start-dev.ps1") -Raw

        $startScript | Should Match '(?s)if \(\$Production\) \{.*?\$backendConsoleCommand = ".*?title MES Backend.*?\$frontendConsoleCommand = "title MES Frontend.*?Start-Process -FilePath \$env:ComSpec -ArgumentList "/d", "/k", \$backendConsoleCommand.*?Start-Process -FilePath \$env:ComSpec -ArgumentList "/d", "/k", \$frontendConsoleCommand.*?Start-Process -FilePath \$condaPython.*?"-m", "uvicorn", "app:app"'
        $startScript | Should Match '(?s)\$limsSimulatorProcess = Start-Process -FilePath \$condaPython.*?-WindowStyle Hidden.*?lims\.stderr\.log'
        $startScript | Should Not Match 'Unable to identify MES backend/frontend/LIMS terminal command processes'
    }

    It "keeps only hidden LIMS output in service logs and resolves the conda interpreter directly" {
        $startScript = Get-Content -LiteralPath (Join-Path $projectRoot "start-dev.ps1") -Raw

        $startScript | Should Match 'function Resolve-CondaPython'
        $startScript | Should Match 'Join-Path \$logDirectory "lims\.stderr\.log"'
        $startScript | Should Not Match 'Join-Path \$logDirectory "backend\.stdout\.log"'
        $startScript | Should Not Match 'Join-Path \$logDirectory "frontend\.stdout\.log"'
        $startScript | Should Match 'logDirectory = \$\(if \(\$Production\)'
    }

    It "lets production terminal commands exit successfully after their service process stops" {
        $startScript = Get-Content -LiteralPath (Join-Path $projectRoot "start-dev.ps1") -Raw

        $startScript | Should Match '\$terminalCommandSwitch = if \(\$Production\) \{ "/c" \} else \{ "/k" \}'
        $startScript | Should Match '\$backendTerminalCommand = if \(\$Production\) \{ "\$backendCommand & exit /b 0" \}'
        $startScript | Should Match '\$frontendTerminalCommand = if \(\$Production\) \{ "\$frontendCommand & exit /b 0" \}'
        $startScript | Should Match 'Write-Host "LIMS simulator: \$limsSimulatorUrl"\s*Write-Host "Upper-computer service: \$upperComputerSimulatorUrl"\s*exit 0'
    }

    It "keeps colors in the visible production backend console" {
        $startScript = Get-Content -LiteralPath (Join-Path $projectRoot "start-dev.ps1") -Raw

        $startScript | Should Match '(?s)if \(-not \$windowsTerminal -and -not \$Production\) \{\s*\$backendCommand \+= " --no-use-colors"\s*\}'
        $startScript | Should Match '\$backendConsoleCommand = "chcp 65001 >nul.*?title MES Backend.*?--port \$BackendPort"'
        $startScript | Should Not Match '\$backendConsoleCommand = ".*?title MES Backend.*?--no-use-colors'
        $startScript | Should Match '\$backendConsoleCommand = "chcp 65001 >nul.*?PYTHONUTF8=1.*?PYTHONIOENCODING=utf-8'
    }

    It "records the real frontend network URL for the browser launch" {
        $startScript = Get-Content -LiteralPath (Join-Path $projectRoot "start-dev.ps1") -Raw
        $publicServerSource = Get-Content -LiteralPath (Join-Path $projectRoot "frontend\scripts\serve-public.mjs") -Raw

        $startScript | Should Match '\[string\]\$FrontendNetworkHost = ""'
        $startScript | Should Match '\$frontendNetworkHost = if \(\[string\]::IsNullOrWhiteSpace\(\$FrontendNetworkHost\)\) \{ Resolve-PrimaryLanIpv4 \}'
        $startScript | Should Match 'frontendUrl = \$frontendNetworkUrl'
        $startScript | Should Match 'FRONTEND_PUBLIC_URL=\$frontendNetworkUrl'
        $publicServerSource | Should Match 'Network: \$\{publicUrl\}'
        $publicServerSource | Should Match 'Binding: http://\$\{host\}:\$\{port\}'
    }

    It "advertises the stable MES hostname when the control center starts production" {
        $controllerSource = Get-Content -LiteralPath $controller -Raw

        $controllerSource | Should Match '\$frontendNetworkHost = "mes-server"'
        $controllerSource | Should Match '-FrontendNetworkHost `"\$frontendNetworkHost`"'
    }

    It "tags both terminal commands with a launcher session for precise process cleanup" {
        $startScript = Get-Content -LiteralPath (Join-Path $projectRoot "start-dev.ps1") -Raw

        $startScript | Should Match '\$launcherSessionId = \[Guid\]::NewGuid\(\)\.ToString\("N"\)'
        $startScript | Should Match 'MES_LAUNCHER_SESSION=\$launcherSessionId'
        $startScript | Should Match 'launcherSessionId = \$launcherSessionId'
    }

    It "closes MES command trees and waits for the service ports to be released" {
        $controllerSource = Get-Content -LiteralPath $controller -Raw

        $controllerSource | Should Match 'function Get-MesCommandPids'
        $controllerSource | Should Match 'function Get-ParentCommandPids'
        $controllerSource | Should Match 'function Wait-ProcessesExited'
        $controllerSource | Should Match 'function Wait-MesPortsReleased'
        $controllerSource | Should Match 'Get-MesCommandPids \$processMap \$state\.launcherSessionId'
        $controllerSource | Should Match 'Get-ParentCommandPids \$processMap \$listenerPids'
        $controllerSource | Should Match 'Wait-ProcessesExited \$commandPids'
        $controllerSource | Should Match 'function Stop-TrackedMesProcess\(\$ProcessId\) \{\s*if \(-not \$ProcessId\) \{ return \}'
        $controllerSource | Should Match '(?s)function Stop-ProcessTree.*?\$ErrorActionPreference = "SilentlyContinue".*?taskkill\.exe.*?2>&1 \| Out-Null.*?Stop-Process -Id \$ProcessId -Force -ErrorAction SilentlyContinue'
    }

    It "stops command roots before repeatedly clearing listeners during restart" {
        $controllerSource = Get-Content -LiteralPath $controller -Raw

        $controllerSource | Should Match 'function Get-MesListenerPids'
        $controllerSource | Should Match '(?s)function Wait-MesPortsReleased.*?do \{.*?\$listenerPids = @\(Get-MesListenerPids\).*?\$listenerPids \| ForEach-Object \{ Stop-ProcessTree \$_ \}.*?while \(\(Get-Date\) -lt \$deadline\)'
        $controllerSource | Should Match '(?s)function Stop-MesSystem.*?\$commandPids \| ForEach-Object \{ Stop-TrackedMesProcess \$_ \}.*?Wait-MesPortsReleased'
        $controllerSource | Should Match 'MES服务端口未能在\$\{TimeoutSeconds\}秒内释放: \$detail'
    }

    It "keeps launcher actions asynchronous while a command is running" {
        $launcherSource = Get-Content -LiteralPath (Join-Path $projectRoot "tools\launcher\MesLauncher.cs") -Raw

        $launcherSource | Should Match 'async void ExecuteAction'
        $launcherSource | Should Match 'Task\.Run\(\(\) => RunControl\(action\)\)'
    }

    It "exposes launcher version 1.2 in metadata and the visible title area" {
        $launcherSource = Get-Content -LiteralPath (Join-Path $projectRoot "tools\launcher\MesLauncher.cs") -Raw

        $launcherSource | Should Match 'AssemblyVersion\("1\.2\.0\.0"\)'
        $launcherSource | Should Match 'LauncherVersion = "1\.2"'
        $launcherSource | Should Match 'var versionBadge = new Label'
        $launcherSource | Should Match 'Text = "v" \+ Program\.LauncherVersion'
    }

    It "builds the desktop launcher with administrator privileges" {
        $buildSource = Get-Content -LiteralPath (Join-Path $projectRoot "scripts\build_launcher.ps1") -Raw

        $buildSource | Should Match '<requestedExecutionLevel level="requireAdministrator" uiAccess="false" />'
        $buildSource | Should Match '/win32manifest:"\$temporaryManifest"'
    }

    It "always returns structured errors through a dedicated launcher result file" {
        $controllerSource = Get-Content -LiteralPath $controller -Raw
        $launcherSource = Get-Content -LiteralPath (Join-Path $projectRoot "tools\launcher\MesLauncher.cs") -Raw

        $controllerSource | Should Match 'catch \{\s*Write-Result "error"'
        $controllerSource | Should Match '\[string\]\$ResultFile = ""'
        $controllerSource | Should Match 'Set-Content -LiteralPath \$ResultFile -Value \$json'
        $launcherSource | Should Match 'mes-launcher-result-'
        $launcherSource | Should Match '-ResultFile'
        $launcherSource | Should Not Match 'ReadToEndAsync'
        $launcherSource | Should Match 'status == "error"'
    }

    It "waits only for the bootstrap process and stores bootstrap output in log files" {
        $controllerSource = Get-Content -LiteralPath $controller -Raw

        $controllerSource | Should Match 'bootstrap\.stdout\.log'
        $controllerSource | Should Match 'Start-Process -FilePath "powershell\.exe"'
        $controllerSource | Should Match '\$startProcess\.WaitForExit\(\)'
        $controllerSource | Should Not Match '\$startOutput = @\(& powershell\.exe'
        $controllerSource | Should Match '(?s)if \(\$startExitCode -ne 0\).*?if \(-not \(Test-Path -LiteralPath \$StateFile\)\)'
        $controllerSource | Should Match '启动脚本执行异常且服务未准备完成'
    }

    It "waits for backend and frontend HTTP readiness before opening the browser" {
        $controllerSource = Get-Content -LiteralPath $controller -Raw

        $controllerSource | Should Match 'function Test-MesHttpReady'
        $controllerSource | Should Match 'http://127\.0\.0\.1:\$backendPort/health/ready'
        $controllerSource | Should Match 'http://127\.0\.0\.1:\$frontendPort/'
        $controllerSource | Should Match '后端、前端、LIMS模拟器及上位机服务未能在90秒内准备完成'
    }

    It "uses a launcher-hosted themed modal for action confirmations and results" {
        $launcherSource = Get-Content -LiteralPath (Join-Path $projectRoot "tools\launcher\MesLauncher.cs") -Raw

        $launcherSource | Should Match 'modalOverlay'
        $launcherSource | Should Match 'ShowThemedModal'
        $launcherSource | Should Not Match 'confirmation != null && MessageBox\.Show'
        $launcherSource | Should Not Match 'status == "already_running"\) MessageBox\.Show'
    }

    It "reports stopped when no managed state exists" {
        $result = & $controller -Action Status -ProjectRoot $projectRoot -StateFile (Join-Path $TestDrive "missing-state.json") -IgnorePortListeners | ConvertFrom-Json

        $result.status | Should Be "stopped"
    }

    It "writes the launcher result file before returning" {
        $resultFile = Join-Path $TestDrive "launcher-result.json"

        $null = & $controller -Action Status -ProjectRoot $projectRoot -StateFile (Join-Path $TestDrive "missing-state.json") -ResultFile $resultFile -IgnorePortListeners
        $result = Get-Content -Raw -LiteralPath $resultFile | ConvertFrom-Json

        $result.status | Should Be "stopped"
        $result.message | Should Be "MES系统未启动"
    }

    It "does not close anything when the MES system is not running" {
        $result = & $controller -Action Stop -ProjectRoot $projectRoot -StateFile (Join-Path $TestDrive "missing-state.json") -IgnorePortListeners | ConvertFrom-Json

        $result.status | Should Be "not_running"
    }

    It "simulates a start without creating terminal processes" {
        $result = & $controller -Action Start -ProjectRoot $projectRoot -StateFile (Join-Path $TestDrive "state.json") -IgnorePortListeners -DryRun | ConvertFrom-Json

        $result.status | Should Be "started"
        Test-Path (Join-Path $TestDrive "state.json") | Should Be $false
    }
}
