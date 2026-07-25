$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..")).Path

Describe "MES control center integration" {
    $sourcePath = Join-Path $projectRoot "tools\control-center\MESControlCenter.cs"
    $buildPath = Join-Path $projectRoot "scripts\build_control_center.ps1"
    $source = Get-Content -LiteralPath $sourcePath -Raw
    $build = Get-Content -LiteralPath $buildPath -Raw

    It "combines service control and the existing terminal client in one form" {
        $source | Should Match 'internal sealed class ControlCenterForm : Form'
        $source | Should Match 'private readonly TerminalManagerClient terminalClient'
        $source | Should Match 'RunControl\("Status"\)'
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
}
