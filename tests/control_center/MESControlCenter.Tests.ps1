$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..")).Path

Describe "MES control center integration" {
    $sourcePath = Join-Path $projectRoot "tools\control-center\MESControlCenter.cs"
    $buildPath = Join-Path $projectRoot "scripts\build_control_center.ps1"
    $terminalSourcePath = Join-Path $projectRoot "scripts\client\MESTerminalManager.cs"
    $terminalBuildPath = Join-Path $projectRoot "scripts\build_terminal_manager.ps1"
    $source = Get-Content -Encoding UTF8 -LiteralPath $sourcePath -Raw
    $build = Get-Content -Encoding UTF8 -LiteralPath $buildPath -Raw
    $terminalSource = Get-Content -Encoding UTF8 -LiteralPath $terminalSourcePath -Raw
    $terminalBuild = Get-Content -Encoding UTF8 -LiteralPath $terminalBuildPath -Raw

    It "combines service control and the existing terminal client in one form" {
        $source | Should Match 'internal sealed class ControlCenterForm : Form'
        $source | Should Match 'private readonly TerminalManagerClient terminalClient'
        $source | Should Match 'Task\.WhenAll\(backendTask, frontendTask, limsTask, upperComputerTask\)'
        $source | Should Match 'terminalClient\.ListTerminals\(\)'
        $source | Should Match 'terminalClient\.QueueCommand'
        $source | Should Match 'terminalClient\.QueueBatch'
    }

    It "implements the selected overview layout and accessible action sizing" {
        $source | Should Match 'CreateNavigationButton\("控制台总览"'
        $source | Should Match 'CreateNavigationButton\("终端管理"'
        $source | Should Match 'Size = new Size\(192, 44\)'
        $source | Should Match 'ShowModal\("确认关闭 MES 系统"'
        $source | Should Match 'ShowModal\("确认批量"'
    }

    It "builds one administrator executable with the selected control-hub icon" {
        $build | Should Match 'MESTerminalManager\.cs'
        $build | Should Match 'MESControlCenter\.cs'
        $build | Should Match 'requestedExecutionLevel level="requireAdministrator"'
        $build | Should Match 'New-ControlCenterIcon'
        $build | Should Match 'mes-control-center\.ico'
    }

    It "keeps service operations asynchronous and provides a deterministic self-test" {
        $source | Should Match 'await Task\.Run\(delegate \{ return RunControl\(action\); \}\)'
        $source | Should Match 'String\.Equals\(args\[0\], "--self-test"'
        $source | Should Match 'ValidateLayout\(\)'
    }

    It "includes native script errors when no structured result is returned" {
        $source | Should Match 'RedirectStandardError = true'
        $source | Should Match 'DrainDiagnostics\(process.StandardError'
        $source | Should Match 'stderrTask.Wait\(200\)'
        $source | Should Not Match 'stderrTask.GetAwaiter\(\).GetResult\(\)'
        $source | Should Match 'if \(stderr\.Length > 0\) message \+= Environment\.NewLine \+ stderr;'
    }

    It "preserves structured results and diagnoses failures in the compiled Windows client" {
        $executable = Join-Path $TestDrive "MESControlCenter.exe"
        & $buildPath -ProjectRoot $projectRoot -OutputPath $executable -IconPath (Join-Path $TestDrive "control-center.ico") -NoAdminManifest
        $runtimeTest = Join-Path $PSScriptRoot "Test-ControlCenterRuntime.ps1"
        $arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$runtimeTest`" -Executable `"$executable`" -TestDirectory `"$TestDrive`""
        $stderrFile = Join-Path $TestDrive "runtime.stderr.log"
        $process = Start-Process -FilePath "$env:WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" -ArgumentList $arguments -WindowStyle Hidden -PassThru -RedirectStandardError $stderrFile -RedirectStandardOutput (Join-Path $TestDrive "runtime.stdout.log")
        $processHandle = $process.Handle
        # A filled stderr pipe must never hang the control center.
        if (-not $process.WaitForExit(30000)) {
            $process.Kill()
            throw "Control-center runtime regression timed out."
        }
        $process.WaitForExit()
        $process.Refresh()
        (Get-Content -Encoding UTF8 -LiteralPath $stderrFile -Raw) | Should BeNullOrEmpty
        $process.ExitCode | Should Be 0
    }

    It "auto-dismisses central progress and restores actions after success and failure" {
        $executable=Join-Path $TestDrive 'MESControlCenter.exe'
        $script=Join-Path $PSScriptRoot 'Test-ControlCenterProgress.ps1'
        & powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File $script -Executable $executable -TestDirectory (Join-Path $TestDrive 'progress')
        $LASTEXITCODE | Should Be 0
    }

    It "closes persisted MES browser windows on Stop and replaces them on Restart without closing other windows" {
        $script=Join-Path $PSScriptRoot 'Test-ControlCenterBrowser.ps1'
        & powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File $script -Executable (Join-Path $TestDrive 'MESControlCenter.exe') -TestDirectory (Join-Path $TestDrive 'browser')
        $LASTEXITCODE | Should Be 0
    }

    It "exposes v2.7.2 and four independently visible service states" {
        $source | Should Match 'AssemblyVersion\("2\.7\.2\.0"\)'
        $source | Should Match 'AssemblyFileVersion\("2\.7\.2\.0"\)'
        $source | Should Match 'MES 控制中心 v2\.7\.2'
        $source | Should Match 'CONTROL CENTER  v2\.7\.2'
        $build | Should Match 'MES控制中心_v2\.7\.2\.exe'
        $source | Should Match 'AddServiceLine\(lines, "后端服务", MESDesktopSettings.PortLabel\("apiUrl"'
        $source | Should Match 'AddServiceLine\(lines, "前端服务", MESDesktopSettings.PortLabel\("serverUrl"'
        $source | Should Match 'AddServiceLine\(lines, "LIMS 模拟器", MESDesktopSettings.PortLabel\("limsUrl"'
        $source | Should Match 'AddServiceLine\(lines, "上位机服务", MESDesktopSettings.PortLabel\("upperComputerUrl"'
        $source | Should Match 'indicator\.Status\.Text = ready \? "运行" : "未运行"'
        $source | Should Match 'indicator\.Dot\.BackColor = ready \? Theme\.Accent : Theme\.Danger'
    }

    It "auto-discovers the current MES IP in both management clients" {
        $source | Should Match 'MESAccessInfo\.InitialServerUrl\(\)'
        $terminalSource | Should Match 'AssemblyVersion\("1\.3\.0\.0"\)'
        $terminalSource | Should Match 'MES 终端管理 v1\.3'
        $terminalSource | Should Match 'MESServerDiscovery\.Discover\(MESDesktopSettings.ServerUrl\("http://192\.168\.110\.15:5173"\)\)'
        $terminalBuild | Should Match 'MES终端管理_v1\.3\.exe'
    }

    It "uses real health contracts and reports partial readiness" {
        $source | Should Match 'MESDesktopSettings.Get\("apiUrl", "http://127\.0\.0\.1:8000"\) \+ "/health/ready"'
        $source | Should Match 'MESDesktopSettings.ServerUrl\("http://127\.0\.0\.1:5173"\) \+ "/"'
        $source | Should Match 'MESDesktopSettings.Get\("limsUrl", "http://127\.0\.0\.1:8900"\) \+ "/api/state"'
        $source | Should Match 'MESDesktopSettings.Get\("upperComputerUrl", "http://127\.0\.0\.1:8899"\) \+ "/api/state"'
        $source | Should Match '"connected", "true"'
        $source | Should Match 'requireAutoMode'
        $source | Should Match '部分服务异常'
        $source | Should Match '未就绪服务：'
    }

    It "refreshes after service actions and releases the wait cursor" {
        $source | Should Not Match 'if \(serviceBusy\) return;\s*try\s*\{\s*Task<bool> backendTask'
        $source | Should Match 'if \(serviceStatusBusy\) return;'
        $source | Should Match 'serviceBusy = false;'
        $source | Should Match 'HideServiceProgress\(\);\s*UpdateServiceActionState\(\);\s*ResetWaitCursor\(\);'
    }

    It "disables repeat start and keeps the terminal overview cursor responsive" {
        $source | Should Match 'if \(action == "Start" && systemRunning\) return;'
        $source | Should Match 'startServiceButton\.Enabled = CanStartSystem\(systemRunning, serviceBusy\);'
        $source | Should Match 'return !running && !busy;'
        $source | Should Match 'startServiceButton\.Cursor = enabled \? Cursors\.Hand : Cursors\.Default;'
        $source | Should Match 'private void ResetWaitCursor\(\)'
        $source | Should Match 'UseWaitCursor = false;'
        $source | Should Match 'dashboardGrid\.Cursor = Cursors\.Default;'
        $source | Should Not Match 'UseWaitCursor = value \|\| serviceBusy;'
    }
}
