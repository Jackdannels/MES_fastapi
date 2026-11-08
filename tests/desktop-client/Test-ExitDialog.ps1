param([Parameter(Mandatory=$true)][string]$Executable, [Parameter(Mandatory=$true)][string]$OutputDirectory)
$ErrorActionPreference='Stop'
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
Add-Type -AssemblyName System.Windows.Forms
[Windows.Forms.Application]::EnableVisualStyles()
$assembly=[Reflection.Assembly]::LoadFrom($Executable)
$type=$assembly.GetType('MESDesktopClient.ExitConfirmationDialog',$true)
$flags=[Reflection.BindingFlags]'Instance,NonPublic'
foreach($light in @($true,$false)) {
    $dialog=$type.GetConstructor($flags,$null,[Type[]]@([bool]),$null).Invoke([object[]]@($light))
    try {
        $dialog.StartPosition=[Windows.Forms.FormStartPosition]::Manual
        $dialog.Location=New-Object Drawing.Point(-10000,-10000)
        $dialog.ShowInTaskbar=$false
        $dialog.Show()
        [Windows.Forms.Application]::DoEvents()
        if($dialog.AcceptButton.Text -ne '取消' -or $dialog.CancelButton -ne $dialog.AcceptButton -or $dialog.ActiveControl -ne $dialog.AcceptButton) { throw 'Cancel must be the keyboard default and initial focus' }
        $expected=if($light){[Drawing.Color]::White}else{[Drawing.Color]::FromArgb(19,26,34)}
        if($dialog.BackColor.ToArgb() -ne $expected.ToArgb()) { throw 'Wrong theme background' }
        foreach($control in $dialog.Controls) {
            if($control.Right -gt $dialog.ClientSize.Width -or $control.Bottom -gt $dialog.ClientSize.Height) { throw 'Exit dialog content exceeds its bounds' }
        }
        $bitmap=New-Object Drawing.Bitmap($dialog.Width,$dialog.Height)
        try {
            $dialog.DrawToBitmap($bitmap,(New-Object Drawing.Rectangle(0,0,$dialog.Width,$dialog.Height)))
            $name=if($light){'exit-light.png'}else{'exit-dark.png'}
            $bitmap.Save((Join-Path $OutputDirectory $name),[Drawing.Imaging.ImageFormat]::Png)
        } finally { $bitmap.Dispose() }
        $dialog.AcceptButton.PerformClick()
        if($dialog.DialogResult -ne [Windows.Forms.DialogResult]::Cancel) { throw 'Default button did not cancel' }
    } finally { $dialog.Dispose() }
}
Write-Output 'Exit dialog checks passed for light/dark themes: bounds, Cancel default/focus and cancel result; component renders saved.'
