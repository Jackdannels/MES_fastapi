$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..")).Path

Describe "MES control center integration" {
    $sourcePath = Join-Path $projectRoot "tools\control-center\MESControlCenter.cs"
    $buildPath = Join-Path $projectRoot "scripts\build_control_center.ps1"
    $source = Get-Content -LiteralPath $sourcePath -Raw
    $build = Get-Content -LiteralPath $buildPath -Raw

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

    It "exposes v2.2 and four independently visible service states" {
        $source | Should Match 'AssemblyVersion\("2\.2\.0\.0"\)'
        $source | Should Match 'MES 控制中心 v2\.2'
        $build | Should Match 'MES控制中心_v2\.2\.exe'
        $source | Should Match 'AddServiceLine\(lines, "后端服务", ":8000"\)'
        $source | Should Match 'AddServiceLine\(lines, "前端服务", ":5173"\)'
        $source | Should Match 'AddServiceLine\(lines, "LIMS 模拟器", ":8900"\)'
        $source | Should Match 'AddServiceLine\(lines, "上位机服务", ":8899"\)'
        $source | Should Match 'indicator\.Status\.Text = ready \? "运行" : "未运行"'
        $source | Should Match 'indicator\.Dot\.BackColor = ready \? Theme\.Accent : Theme\.Danger'
    }

    It "defaults terminal management to the stable MES hostname" {
        $source | Should Match 'http://mes-server:5173'
    }

    It "uses real health contracts and reports partial readiness" {
        $source | Should Match 'http://127\.0\.0\.1:8000/health/ready'
        $source | Should Match 'http://127\.0\.0\.1:5173/'
        $source | Should Match 'http://127\.0\.0\.1:8900/api/state'
        $source | Should Match 'http://127\.0\.0\.1:8899/api/state'
        $source | Should Match '"connected", "true"'
        $source | Should Match 'requireAutoMode'
        $source | Should Match '部分服务异常'
        $source | Should Match '未就绪服务：'
    }

    It "refreshes after service actions and releases the wait cursor" {
        $source | Should Not Match 'if \(serviceBusy\) return;\s*try\s*\{\s*Task<bool> backendTask'
        $source | Should Match 'if \(serviceStatusBusy\) return;'
        $source | Should Match 'serviceBusy = false;\s*UpdateServiceActionState\(\);\s*ResetWaitCursor\(\);'
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
