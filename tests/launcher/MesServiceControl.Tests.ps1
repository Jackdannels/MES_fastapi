$projectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$controller = Join-Path $projectRoot "scripts\mes-service-control.ps1"

Describe "MES service controller" {
    It "records the real frontend network URL for the browser launch" {
        $startScript = Get-Content -LiteralPath (Join-Path $projectRoot "start-dev.ps1") -Raw

        $startScript | Should Match 'frontendUrl = \$frontendNetworkUrl'
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
