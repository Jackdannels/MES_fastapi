param([Parameter(Mandatory=$true)][string]$Executable,[Parameter(Mandatory=$true)][string]$PreviewDirectory)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$assembly=[Reflection.Assembly]::LoadFrom($Executable)
$flags=[Reflection.BindingFlags]'Instance,Public,NonPublic';$static=[Reflection.BindingFlags]'Static,Public,NonPublic'
$type=$assembly.GetType('MESControlCenter.ControlCenterForm',$true);$theme=$assembly.GetType('MESControlCenter.Theme',$true)
function All-Controls($root){foreach($child in $root.Controls){$child;All-Controls $child}}
$preference=$theme.GetProperty('PreferencePath',$static).GetValue($null,$null)
$previous=if(Test-Path -LiteralPath $preference){[IO.File]::ReadAllBytes($preference)}else{$null}
try{
    foreach($factor in @(1.0,1.25,1.5)){
        $form=$type.GetConstructor($flags,$null,[Type[]]@([string],[bool]),$null).Invoke([object[]]@('fixture-control.ps1',$false))
        try{
            $form.ShowInTaskbar=$false;$form.StartPosition='Manual';$form.Location=New-Object Drawing.Point(-10000,-10000)
            $form.Show();[Windows.Forms.Application]::DoEvents()
            $null=$type.GetMethod('ShowIntegrityPageForPreview',$flags).Invoke($form,@())
            $page=$type.GetField('integrityPage',$flags).GetValue($form)
            while($page.GetType().GetProperty('Busy',$flags).GetValue($page,$null)){[Windows.Forms.Application]::DoEvents();Start-Sleep -Milliseconds 10}
            $task=$page.GetType().GetMethod('CheckAsync',$flags).Invoke($page,@($true))
            while(-not $task.IsCompleted){[Windows.Forms.Application]::DoEvents();Start-Sleep -Milliseconds 10}
            $null=$task.GetAwaiter().GetResult()
            $grid=$page.GetType().GetField('grid',$flags).GetValue($page)
            if($grid.Rows.Count -ne 18){throw ('Integrity page did not list all 18 components: '+$page.GetType().GetField('summary',$flags).GetValue($page).Text)}
            if($factor -ne 1){
                $fonts=@(@($form)+@(All-Controls $form)|ForEach-Object {[pscustomobject]@{Control=$_;Family=$_.Font.FontFamily;Size=$_.Font.SizeInPoints;Style=$_.Font.Style}})
                $form.Scale((New-Object Drawing.SizeF($factor,$factor)))
                foreach($font in $fonts){$font.Control.Font=New-Object Drawing.Font($font.Family,[single]($font.Size*$factor),$font.Style)}
            }
            $form.ClientSize=New-Object Drawing.Size([int](1366*$factor),[int](768*$factor))
            foreach($mode in @('dark','light')){
                if(($mode -eq 'dark') -ne $theme.GetProperty('IsDark',$static).GetValue($null,$null)){$null=$theme.GetMethod('Toggle',$static).Invoke($null,@($form))}
                [Windows.Forms.Application]::DoEvents();$form.PerformLayout()
                foreach($button in @(All-Controls $page|Where-Object {$_ -is [Windows.Forms.Button] -and $_.Visible})){
                    if($button.Right -gt $button.Parent.ClientSize.Width+1 -or $button.Bottom -gt $button.Parent.ClientSize.Height+1){throw ('Integrity button clipped: '+$button.Text)}
                }
                if((@($grid.Columns|Measure-Object Width -Sum).Sum) -gt $grid.ClientSize.Width){throw 'Integrity table columns overflow'}
                New-Item -ItemType Directory -Path $PreviewDirectory -Force|Out-Null
                $bitmap=New-Object Drawing.Bitmap($form.Width,$form.Height)
                try{$form.DrawToBitmap($bitmap,(New-Object Drawing.Rectangle(0,0,$form.Width,$form.Height)));$bitmap.Save((Join-Path $PreviewDirectory ('integrity-'+$factor+'-'+$mode+'.png')),[Drawing.Imaging.ImageFormat]::Png)}finally{$bitmap.Dispose()}
            }
        }finally{$form.Dispose()}
    }
}finally{if($null -ne $previous){[IO.File]::WriteAllBytes($preference,$previous)}elseif(Test-Path -LiteralPath $preference){Remove-Item -LiteralPath $preference -Force}}
Write-Output 'Integrity layout passed: 18 components, both themes and 100/125/150 percent font/geometry scale.'
