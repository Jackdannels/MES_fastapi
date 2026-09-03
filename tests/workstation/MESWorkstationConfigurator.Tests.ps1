$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..")).Path
$sourcePath = Join-Path $projectRoot "scripts\client\MESWorkstationConfigurator.cs"
$buildScript = Join-Path $projectRoot "scripts\build_workstation_configurator.ps1"

Describe "MES workstation configurator v2.2" {
    It "uses a stable MES hostname and safely migrates only historical defaults" {
        $source = Get-Content -Raw -LiteralPath $sourcePath

        $source | Should Match 'Version = "v2\.2"'
        $source | Should Match 'DefaultServerUrl = "http://mes-server:5173"'
        $source | Should Match 'LegacyDefaultServerUrls'
        $source | Should Match 'MigrateLegacyServerUrl'
        $source | Should Match 'config\.RegisteredServerUrl = DefaultServerUrl'
        $source | Should Match 'terminal-preserved'
        $source | Should Match '192\.168\.110\.77:5173'
    }

    It "uses dedicated Edge and browser-page health for automatic recovery" {
        $source = Get-Content -Raw -LiteralPath $sourcePath

        $source | Should Match 'Version = "v2\.2"'
        $source | Should Match 'IsDedicatedEdgeRunning'
        $source | Should Match 'pageActive'
        $source | Should Match 'WorkstationWatchdog'
        $source | Should Match 'AutomaticRestartLimit = 3'
        $source | Should Match 'AutomaticRestartPauseMilliseconds = 5 \* 60 \* 1000'
        $source | Should Match 'RecoverWorkstationIfNeeded'
    }

    It "stabilizes the Windows desktop and repeatedly activates only the dedicated Edge window" {
        $source = Get-Content -Raw -LiteralPath $sourcePath

        $source | Should Match 'StartupDesktopSettleMilliseconds = 8000'
        $source | Should Match 'FocusRetryDelaysMilliseconds = new int\[\] \{ 500, 1500, 3000 \}'
        $source | Should Match 'FindDedicatedEdgeMainWindow'
        $source | Should Match 'ActivateDedicatedEdgeWindow'
        $source | Should Match 'AttachThreadInput'
        $source | Should Match 'BringWindowToTop'
        $source | Should Match 'SetForegroundWindow'
        $source | Should Not Match 'FindWindow\("Shell_TrayWnd"'
    }

    It "uses stable English laboratory codes in generated workstation URLs" {
        $source = Get-Content -Raw -LiteralPath $sourcePath

        $source | Should Match 'Laboratory\("冲击二室", "LAB_IMPACT_2"\)'
        $source | Should Match 'Laboratory\("高低温湿热二室", "LAB_HOT_HUMID_2"\)'
        $source | Should Match '"/laboratory\?lab=" \+ labCode'
    }

    It "builds v2.2 and passes the deterministic runtime self-tests" {
        $outputDirectory = Join-Path $TestDrive "workstation-v2.2"
        $outputPath = Join-Path $outputDirectory "MES工作台设置_v2.2.exe"

        & $buildScript -ProjectRoot $projectRoot -OutputDirectory $outputDirectory -OutputPath $outputPath -DesktopCopyPath "" -LegacyDesktopCopyPath ""
        $LASTEXITCODE | Should Be 0
        Test-Path -LiteralPath $outputPath | Should Be $true

        & $outputPath --watchdog-self-test
        $LASTEXITCODE | Should Be 0
        & $outputPath --window-focus-self-test
        $LASTEXITCODE | Should Be 0
        & $outputPath --server-address-migration-self-test
        $LASTEXITCODE | Should Be 0
        [Diagnostics.FileVersionInfo]::GetVersionInfo($outputPath).FileVersion | Should Be "2.2.0.0"
    }
}
