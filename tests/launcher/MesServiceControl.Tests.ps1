$projectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$controller = Join-Path $projectRoot "scripts\mes-service-control.ps1"

Describe "MES service controller" {
    It "detects Windows Terminal before choosing development terminal hosts" {
        $startScript = Get-Content -LiteralPath (Join-Path $projectRoot "start-dev.ps1") -Raw

        $startScript | Should Match '\$windowsTerminal = Get-Command "wt\.exe" -ErrorAction SilentlyContinue'
    }

    It "starts titled backend and frontend tabs through Windows Terminal when available" {
        $startScript = Get-Content -LiteralPath (Join-Path $projectRoot "start-dev.ps1") -Raw

        $startScript | Should Match '(?s)\$terminalProcess = Start-Process -FilePath \$windowsTerminal\.Source.*?"new-tab", "--title", ''"MES Backend"'', "cmd\.exe", \$terminalCommandSwitch, \$backendTerminalCommand.*?"new-tab", "--title", ''"MES Frontend"'', "cmd\.exe", \$terminalCommandSwitch, \$frontendTerminalCommand'
        $startScript | Should Match '\$backendProcess = \$terminalProcess'
        $startScript | Should Match '\$frontendProcess = \$terminalProcess'
    }

    It "keeps multiword Windows Terminal tab titles quoted after ArgumentList is joined" {
        $startScript = Get-Content -LiteralPath (Join-Path $projectRoot "start-dev.ps1") -Raw

        $startScript | Should Match "\x27`"MES Backend`"\x27"
        $startScript | Should Match "\x27`"MES Frontend`"\x27"
    }

    It "tracks the real backend and frontend command processes inside visible production tabs" {
        $startScript = Get-Content -LiteralPath (Join-Path $projectRoot "start-dev.ps1") -Raw

        $startScript | Should Match '(?s)if \(\$Production\) \{.*?MES_LAUNCHER_SESSION=\$launcherSessionId.*?scripts\\run_local\.py.*?npm run serve:public.*?Get-Process -Id \$backendCommandProcess\.ProcessId.*?Get-Process -Id \$frontendCommandProcess\.ProcessId'
    }

    It "lets production terminal commands exit successfully after their service process stops" {
        $startScript = Get-Content -LiteralPath (Join-Path $projectRoot "start-dev.ps1") -Raw

        $startScript | Should Match '\$terminalCommandSwitch = if \(\$Production\) \{ "/c" \} else \{ "/k" \}'
        $startScript | Should Match '\$backendTerminalCommand = if \(\$Production\) \{ "\$backendCommand & exit /b 0" \}'
        $startScript | Should Match '\$frontendTerminalCommand = if \(\$Production\) \{ "\$frontendCommand & exit /b 0" \}'
    }

    It "disables backend colors only on the cmd fallback path" {
        $startScript = Get-Content -LiteralPath (Join-Path $projectRoot "start-dev.ps1") -Raw

        $startScript | Should Match '(?s)if \(-not \$windowsTerminal\) \{\s*\$backendCommand \+= " --no-use-colors"\s*\}'
    }

    It "records the real frontend network URL for the browser launch" {
        $startScript = Get-Content -LiteralPath (Join-Path $projectRoot "start-dev.ps1") -Raw

        $startScript | Should Match 'frontendUrl = \$frontendNetworkUrl'
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
    }

    It "keeps launcher actions asynchronous while a command is running" {
        $launcherSource = Get-Content -LiteralPath (Join-Path $projectRoot "tools\launcher\MesLauncher.cs") -Raw

        $launcherSource | Should Match 'async void ExecuteAction'
        $launcherSource | Should Match 'Task\.Run\(\(\) => RunControl\(action\)\)'
    }

    It "waits for backend and frontend HTTP readiness before opening the browser" {
        $controllerSource = Get-Content -LiteralPath $controller -Raw

        $controllerSource | Should Match 'function Test-MesHttpReady'
        $controllerSource | Should Match 'http://127\.0\.0\.1:\$backendPort/api/storage'
        $controllerSource | Should Match 'http://127\.0\.0\.1:\$frontendPort/'
        $controllerSource | Should Match '前后端服务未能在90秒内准备完成'
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
