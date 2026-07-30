$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..")).Path
$sourcePath = Join-Path $projectRoot "scripts\client\MESWorkstationConfigurator.cs"
$buildScript = Join-Path $projectRoot "scripts\build_workstation_configurator.ps1"

Describe "MES workstation configurator v2.0" {
    It "uses dedicated Edge and browser-page health for automatic recovery" {
        $source = Get-Content -Raw -LiteralPath $sourcePath

        $source | Should Match 'Version = "v2\.0"'
        $source | Should Match 'IsDedicatedEdgeRunning'
        $source | Should Match 'pageActive'
        $source | Should Match 'WorkstationWatchdog'
        $source | Should Match 'AutomaticRestartLimit = 3'
        $source | Should Match 'AutomaticRestartPauseMilliseconds = 5 \* 60 \* 1000'
        $source | Should Match 'RecoverWorkstationIfNeeded'
    }

    It "uses stable English laboratory codes in generated workstation URLs" {
        $source = Get-Content -Raw -LiteralPath $sourcePath

        $source | Should Match 'Laboratory\("冲击二室", "LAB_IMPACT_2"\)'
        $source | Should Match 'Laboratory\("高低温湿热二室", "LAB_HOT_HUMID_2"\)'
        $source | Should Match '"/laboratory\?lab=" \+ labCode'
    }

    It "builds v2.0 and passes the deterministic watchdog self-test" {
        $outputDirectory = Join-Path $TestDrive "workstation-v2.0"
        $outputPath = Join-Path $outputDirectory "MES工作台设置_v2.0.exe"

        & $buildScript -ProjectRoot $projectRoot -OutputDirectory $outputDirectory -OutputPath $outputPath -DesktopCopyPath "" -LegacyDesktopCopyPath ""
        $LASTEXITCODE | Should Be 0
        Test-Path -LiteralPath $outputPath | Should Be $true

        & $outputPath --watchdog-self-test
        $LASTEXITCODE | Should Be 0
        [Diagnostics.FileVersionInfo]::GetVersionInfo($outputPath).FileVersion | Should Be "2.0.0.0"
    }
}
