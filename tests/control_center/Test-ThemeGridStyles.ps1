param([Parameter(Mandatory = $true)][string]$Executable)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$assembly = [Reflection.Assembly]::LoadFrom((Resolve-Path -LiteralPath $Executable).Path)
$instance = [Reflection.BindingFlags]'Instance,NonPublic,Public'
$static = [Reflection.BindingFlags]'Static,NonPublic,Public'
$formType = $assembly.GetType('MESControlCenter.ControlCenterForm', $true)
$theme = $assembly.GetType('MESControlCenter.Theme', $true)
$rowType = $assembly.GetType('MESTerminalManager.TerminalRow', $true)
$preference = $theme.GetProperty('PreferencePath', $static).GetValue($null, $null)
$previous = if (Test-Path -LiteralPath $preference) { [IO.File]::ReadAllBytes($preference) } else { $null }
function Theme-Color([string]$Name) { $theme.GetProperty($Name, $static).GetValue($null, $null) }
function Assert-Color($Actual, $Expected, [string]$Description) {
    if ($Actual.ToArgb() -ne $Expected.ToArgb()) { throw ($Description + ': expected ' + $Expected + ', got ' + $Actual) }
}
$form = $null
try {
    $form = $formType.GetConstructor($instance, $null, [Type[]]@([string], [bool]), $null).Invoke([object[]]@('visual-fixture.ps1', $false))
    $form.ShowInTaskbar = $false
    $form.StartPosition = 'Manual'
    $form.Location = New-Object Drawing.Point(-10000, -10000)
    $form.Show()
    [Windows.Forms.Application]::DoEvents()
    $rows = [Activator]::CreateInstance([Collections.Generic.List``1].MakeGenericType($rowType))
    foreach ($index in 1..35) {
        $row = [Activator]::CreateInstance($rowType, $true)
        $row.TerminalId = 'theme-grid-' + $index
        $row.TerminalName = '主题验证工位 ' + $index
        $row.MachineName = 'THEME-PC-' + $index
        $row.IpAddress = '192.0.2.' + $index
        $row.Online = $true
        $rows.Add($row)
    }
    $formType.GetField('rows', $instance).SetValue($form, $rows)
    $null = $formType.GetMethod('ShowTerminalPageForPreview', $instance).Invoke($form, @())
    $grid = $formType.GetField('terminalGrid', $instance).GetValue($form)
    $null = $formType.GetMethod('BindGrid', $instance).Invoke($form, @($grid))
    if (-not $theme.GetProperty('IsDark', $static).GetValue($null, $null)) {
        $null = $theme.GetMethod('Toggle', $static).Invoke($null, @($form))
    }
    $grid.CurrentCell = $grid.Rows[4].Cells['TerminalName']
    $selected = $grid.CurrentRow.DataBoundItem.TerminalId
    $padding = $grid.DefaultCellStyle.Padding
    foreach ($mode in @('dark', 'light', 'dark')) {
        if ($theme.GetProperty('IsDark', $static).GetValue($null, $null) -ne ($mode -eq 'dark')) {
            $null = $theme.GetMethod('Toggle', $static).Invoke($null, @($form))
        }
        [Windows.Forms.Application]::DoEvents()
        Assert-Color $grid.DefaultCellStyle.BackColor (Theme-Color 'Surface') ($mode + ' grid background')
        Assert-Color $grid.DefaultCellStyle.ForeColor (Theme-Color 'Text') ($mode + ' grid text')
        Assert-Color $grid.DefaultCellStyle.SelectionBackColor (Theme-Color 'Selection') ($mode + ' selection background')
        Assert-Color $grid.DefaultCellStyle.SelectionForeColor (Theme-Color 'SelectionText') ($mode + ' selection text')
        if (-not $grid.RowsDefaultCellStyle.BackColor.IsEmpty) {
            Assert-Color $grid.RowsDefaultCellStyle.BackColor (Theme-Color 'Surface') ($mode + ' row defaults')
        }
        for ($index = 0; $index -lt $grid.Rows.Count; $index++) {
            $style = $grid.Rows[$index].Cells['TerminalName'].InheritedStyle
            $expected = if ($index % 2 -eq 0) { Theme-Color 'Surface' } else { Theme-Color 'AlternateSurface' }
            Assert-Color $style.BackColor $expected ($mode + ' row ' + $index + ' background')
            Assert-Color $style.ForeColor (Theme-Color 'Text') ($mode + ' row ' + $index + ' text')
            Assert-Color $style.SelectionBackColor (Theme-Color 'Selection') ($mode + ' row ' + $index + ' selected background')
            Assert-Color $style.SelectionForeColor (Theme-Color 'SelectionText') ($mode + ' row ' + $index + ' selected text')
        }
        if ($grid.CurrentRow.DataBoundItem.TerminalId -ne $selected -or $grid.DefaultCellStyle.Padding -ne $padding -or $grid.Columns['TerminalName'].DefaultCellStyle.WrapMode -ne 'True') {
            throw 'Grid theming discarded selection, padding or per-column wrapping.'
        }
    }
    Write-Output 'Bound grid theme regression passed: 35 rows, dark/light/dark, ordinary/alternating/selected colours and formatting.'
}
finally {
    if ($form) { $form.Dispose() }
    if ($null -ne $previous) { [IO.File]::WriteAllBytes($preference, $previous) }
    elseif (Test-Path -LiteralPath $preference) { Remove-Item -LiteralPath $preference -Force }
}
