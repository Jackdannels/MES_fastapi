$projectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$controller = Join-Path $projectRoot "scripts\mes-service-control.ps1"

Describe "MES service controller" {
    It "returns structured results for every action through Windows PowerShell 5.1" {
        # Match the desktop executable's -File boundary, not the test runner's
        # UTF-8 decoding (PowerShell 7 can hide missing-BOM regressions).
        foreach ($action in @("Status", "Start", "Stop", "Restart")) {
            $resultFile = Join-Path $TestDrive "windows-powershell-$action.json"
            $stderrFile = Join-Path $TestDrive "windows-powershell-$action.stderr.log"
            $stdoutFile = Join-Path $TestDrive "windows-powershell-$action.stdout.log"
            $stateFile = Join-Path $TestDrive "missing-state.json"
            $arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$controller`" -Action $action -ProjectRoot `"$projectRoot`" -StateFile `"$stateFile`" -ResultFile `"$resultFile`" -IgnorePortListeners -DryRun"
            $process = Start-Process -FilePath "$env:WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" -ArgumentList $arguments -WindowStyle Hidden -Wait -PassThru -RedirectStandardError $stderrFile -RedirectStandardOutput $stdoutFile

            $process.ExitCode | Should Be 0
            (Get-Content -LiteralPath $stderrFile -Raw) | Should BeNullOrEmpty
            $result = Get-Content -LiteralPath $resultFile -Raw -Encoding UTF8 | ConvertFrom-Json
            $expectedStatus = @{ Status = "stopped"; Start = "started"; Stop = "not_running"; Restart = "started" }
            $result.status | Should Be $expectedStatus[$action]
            $expectedMessage = @{ Status = "MES系统未启动"; Start = "MES系统已启动"; Stop = "未检测到开启的MES系统，无需关闭"; Restart = "MES系统已启动" }
            $result.message | Should Be $expectedMessage[$action]
            Test-Path -LiteralPath $stateFile | Should Be $false
        }
    }

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
        $controllerSource | Should Match 'return @\(\$frontendUrl, \$limsSimulatorUrl, \$upperComputerSimulatorUrl\)'
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
        $controllerSource | Should Match 'Get-MesListenerOwners'
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
        $startScript | Should Match 'npm run build:production && \$BackendWaitCommand && npm run serve:public'
        $startScript | Should Not Match 'Unable to identify MES backend/frontend/LIMS terminal command processes'
    }

    It "builds production frontend with bounded publish retries and last-good fallback" {
        $buildSource = Get-Content -Encoding UTF8 -LiteralPath (Join-Path $projectRoot "frontend\scripts\build-production.mjs") -Raw

        $buildSource | Should Match 'MES_FRONTEND_BUILD_TIMEOUT_MS \|\| 30_000'
        $buildSource | Should Match 'const maxAttempts = 2'
        $buildSource | Should Match '\.dist-build-\$\{process\.pid\}'
        $buildSource | Should Match 'await renameDirectory\(buildRoot, distRoot\)'
        $buildSource | Should Match 'const retryDelaysMs = \[100, 200, 400, 800, 1000\]'
        $buildSource | Should Match 'if \(published && backupCreated\) await cleanup\(backupRoot\)'
        $buildSource | Should Match '继续使用上一次成功构建'
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

    It "lets production startup resolve the current LAN IP instead of pinning a hostname" {
        $controllerSource = Get-Content -LiteralPath $controller -Raw

        $controllerSource | Should Not Match '\$frontendNetworkHost = "mes-server"'
        $controllerSource | Should Not Match '-FrontendNetworkHost'
        $startScript = Get-Content -LiteralPath (Join-Path $projectRoot "start-dev.ps1") -Raw
        $startScript | Should Not Match 'TEST_DATA_PUBLIC_BASE_URL='
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

    It "reads native IPv4/IPv6 listener owners and closes only an isolated fixture" {
        $runtime = Join-Path $PSScriptRoot 'Test-FastServiceShutdown.ps1'
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $runtime -ProjectRoot $projectRoot -TestDirectory (Join-Path $TestDrive 'fast-shutdown')
        $LASTEXITCODE | Should Be 0
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

    It "returns all three configured page URLs while allowing the control center to own browser launch" {
        $null = . $controller -Action Status -StateFile (Join-Path $TestDrive 'browser-state.json') -IgnorePortListeners -NoOpen
        Mock Start-Process { throw 'NoOpen must not launch a default browser' }
        $state = [pscustomobject]@{frontendLocalUrl='http://127.0.0.1:25173/';limsSimulatorUrl='http://127.0.0.1:28900/';upperComputerSimulatorUrl='http://127.0.0.1:28899/'}
        $urls = @(Get-MesPageUrls $state)
        $urls.Count | Should Be 3
        $urls[0] | Should Be 'http://127.0.0.1:25173/'
        $urls[1] | Should Be 'http://127.0.0.1:28900/'
        $urls[2] | Should Be 'http://127.0.0.1:28899/'
        Open-MesPages $state
        Assert-MockCalled Start-Process -Times 0 -Exactly
        $state | ConvertTo-Json | Set-Content -LiteralPath $StateFile -Encoding UTF8
        $Action = 'Start'
        $result = Write-Result 'started' 'ready' | ConvertFrom-Json
        $result.pageUrls.Count | Should Be 3
        $result.pageUrls[0] | Should Be $urls[0]
        $result.pageUrls[1] | Should Be $urls[1]
        $result.pageUrls[2] | Should Be $urls[2]
        $defaults = @(Get-MesPageUrls ([pscustomobject]@{}))
        $defaults.Count | Should Be 3
        $defaults[2] | Should Be 'http://127.0.0.1:8899/'
    }

    It "suppresses the separate upper-computer browser only when the launcher owns page opening" {
        $startScript = Get-Content -Encoding UTF8 -LiteralPath (Join-Path $projectRoot 'start-dev.ps1') -Raw
        $startScript | Should Match '\$upperComputerBrowserPrefix = if \(\$DisableAutoOpenBrowser\) \{ ''set "UPPER_COMPUTER_SIMULATOR_OPEN_BROWSER=false" && '' \} else \{ '''' \}'
        $startScript | Should Match '\$backendCommand = \$upperComputerBrowserPrefix \+ \$backendCommand'
        $startScript | Should Match '\$backendConsoleCommand = .*?\$\{upperComputerBrowserPrefix\}'
    }
}
