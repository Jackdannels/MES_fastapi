param([Parameter(Mandatory=$true)][string]$Executable, [string]$PreviewDirectory='')
$ErrorActionPreference='Stop'
trap { Write-Output $_.ScriptStackTrace; throw $_.Exception }
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$assembly=[Reflection.Assembly]::LoadFrom($Executable)
$flags=[Reflection.BindingFlags]'Instance,NonPublic,Public'
$static=[Reflection.BindingFlags]'Static,NonPublic,Public'
$type=$assembly.GetType('MESControlCenter.ControlCenterForm',$true)
$theme=$assembly.GetType('MESControlCenter.Theme',$true)
$rowType=$assembly.GetType('MESTerminalManager.TerminalRow',$true)
$preference=$theme.GetProperty('PreferencePath',$static).GetValue($null,$null)
$previous=if(Test-Path -LiteralPath $preference){[IO.File]::ReadAllBytes($preference)}else{$null}
function Get-Field($Window,[string]$Name){$type.GetField($Name,$flags).GetValue($Window)}
function Call($Window,[string]$Name,[object[]]$Values=@()){$type.GetMethod($Name,$flags).Invoke($Window,$Values)}
function Toggle($Window){$null=$theme.GetMethod('Toggle',$static).Invoke($null,@($Window));[Windows.Forms.Application]::DoEvents()}
function All-Controls($Root){foreach($child in $Root.Controls){$child;All-Controls $child}}
function Render($Window,[string]$Name){
    if(-not $PreviewDirectory){return}
    New-Item -ItemType Directory -Path $PreviewDirectory -Force|Out-Null
    [Windows.Forms.Application]::DoEvents()
    $bitmap=New-Object Drawing.Bitmap($Window.Width,$Window.Height)
    try{$Window.DrawToBitmap($bitmap,(New-Object Drawing.Rectangle(0,0,$Window.Width,$Window.Height)));$bitmap.Save((Join-Path $PreviewDirectory $Name),[Drawing.Imaging.ImageFormat]::Png)}finally{$bitmap.Dispose()}
}
function Assert-Buttons($Window){
    foreach($button in @(All-Controls $Window|Where-Object {$_ -is [Windows.Forms.Button] -and $_.Visible})){
        if($button.GetType().Name -ne 'ThemeButton'){throw ('Native button left unthemed: '+$button.Text)}
        if($button.Right -gt $button.Parent.ClientSize.Width+1 -or $button.Bottom -gt $button.Parent.ClientSize.Height+1){throw ('Clipped button: '+$button.Text+' '+$button.Bounds+' parent '+$button.Parent.ClientSize)}
        $text=[Windows.Forms.TextRenderer]::MeasureText($button.Text,$button.Font)
        if($text.Width -gt $button.Width-$button.Padding.Horizontal-2){throw ('Button text does not fit: '+$button.Text)}
    }
}
function Scale-Fonts($Window,[double]$Factor){
    $fonts=@(@($Window)+@(All-Controls $Window)|ForEach-Object {[pscustomobject]@{Control=$_;Family=$_.Font.FontFamily;Size=$_.Font.SizeInPoints;Style=$_.Font.Style}})
    foreach($item in $fonts){$item.Control.Font=New-Object Drawing.Font($item.Family,[single]($item.Size*$Factor),$item.Style)}
}
try{
    foreach($factor in @(1.0,1.25,1.5)){
        $form=$type.GetConstructor($flags,$null,[Type[]]@([string],[bool]),$null).Invoke([object[]]@('visual-fixture.ps1',$false))
        try{
            $form.ShowInTaskbar=$false;$form.StartPosition='Manual';$form.Location=New-Object Drawing.Point(-10000,-10000)
            $form.Show();[Windows.Forms.Application]::DoEvents()
            if(-not $theme.GetProperty('IsDark',$static).GetValue($null,$null)){Toggle $form}
            if($factor -ne 1){$form.Scale((New-Object Drawing.SizeF($factor,$factor)));Scale-Fonts $form $factor}
            $form.ClientSize=New-Object Drawing.Size([int](1366*$factor),[int](768*$factor))
            $form.PerformLayout();[Windows.Forms.Application]::DoEvents()
            $rows=[Activator]::CreateInstance([Collections.Generic.List``1].MakeGenericType($rowType))
            foreach($index in 1..35){
                $row=[Activator]::CreateInstance($rowType,$true)
                $values=@{TerminalId=('terminal-'+$index);TerminalName=('盐雾试验室工位 '+$index.ToString('00'));MachineName=('SALT-PC-'+$index.ToString('00'));IpAddress=('192.0.2.'+$index);CurrentPage='盐雾工位';CurrentPath='/workstations/salt-spray?from=control-center';LastSeenAt=[DateTimeOffset]::UtcNow.AddSeconds(-10).ToString('o');CommandLabel='已完成';PermissionLabel='刷新界面 / 电源操作';Online=($index%3 -ne 0);AllowReload=$true;AllowPower=$true}
                foreach($key in $values.Keys){$rowType.GetProperty($key).SetValue($row,$values[$key],$null)}
                $rows.Add($row)
            }
            $type.GetField('rows',$flags).SetValue($form,$rows);$type.GetField('terminalConnected',$flags).SetValue($form,$true)
            $connectionSummary=Get-Field $form 'connectionSummary';$connectionSummary.Text='已连接 · visual-admin · http://192.0.2.100:5173'
            $null=Call $form 'BindGrid' @((Get-Field $form 'dashboardGrid'))
            $null=Call $form 'ShowTerminalPageForPreview';$null=Call $form 'SetConnectionExpanded' @($true)
            [Windows.Forms.Application]::DoEvents();Assert-Buttons $form
            $null=Call $form 'SetConnectionExpanded' @($false)
            $grid=Get-Field $form 'terminalGrid'
            $null=Call $form 'BindGrid' @($grid)
            if($grid.Columns.Count -ne 6){throw 'Terminal table no longer has six common columns'}
            if(@($grid.Columns|Where-Object Visible|Measure-Object Width -Sum).Sum -gt $grid.ClientSize.Width){throw 'Terminal columns overflow the visible table'}
            $grid.CurrentCell=$grid.Rows[20].Cells[0];$grid.FirstDisplayedScrollingRowIndex=15
            $selected=$grid.CurrentRow.DataBoundItem.TerminalId;$top=$grid.FirstDisplayedScrollingRowIndex
            $null=Call $form 'BindGrid' @($grid)
            if($grid.CurrentRow.DataBoundItem.TerminalId -ne $selected -or $grid.FirstDisplayedScrollingRowIndex -ne $top){throw 'Refresh discarded the terminal selection or scroll position'}
            $menu=Get-Field $form 'terminalMenu'
            if(@($menu.Items|Where-Object {$_ -is [Windows.Forms.ToolStripMenuItem]}).Count -ne 6){throw 'Layout B lost an operation'}
            $grid.CurrentRow.DataBoundItem.AllowPower=$false;$null=Call $form 'UpdateTerminalActionState'
            if((Get-Field $form 'shutdownButton').Enabled -or (Get-Field $form 'restartTerminalButton').Enabled){throw 'More menu ignored the selected terminal power permission'}
            $grid.CurrentRow.DataBoundItem.AllowPower=$true
            $type.GetField('terminalConnected',$flags).SetValue($form,$false);$null=Call $form 'UpdateTerminalActionState'
            if((Get-Field $form 'reloadButton').Enabled -or (Get-Field $form 'shutdownButton').Enabled -or (Get-Field $form 'resetBindingButton').Enabled){throw 'Disconnected session retained remote actions'}
            $type.GetField('terminalConnected',$flags).SetValue($form,$true)
            $search=Get-Field $form 'terminalSearch';$search.Text='does-not-exist'
            if($grid.Rows.Count -ne 0 -or (Get-Field $form 'resetBindingButton').Enabled){throw 'Empty search retained an actionable terminal'}
            $search.Text='SALT-PC';$null=Call $form 'BindGrid' @($grid)
            $grid.CurrentCell=$grid.Rows[0].Cells[0];$selected=$grid.CurrentRow.DataBoundItem.TerminalId
            $savedGrid=$grid;$username=Get-Field $form 'usernameText';$username.Text='visual-admin'
            $null=Call $form 'UpdateTerminalActionState'
            Assert-Buttons $form
            foreach($light in @($false,$true)){
                if($light){Toggle $form}
                $expectedSurface=$theme.GetProperty('Surface',$static).GetValue($null,$null)
                $expectedSelection=$theme.GetProperty('Selection',$static).GetValue($null,$null)
                if($grid.DefaultCellStyle.BackColor.ToArgb() -ne $expectedSurface.ToArgb() -or $grid.DefaultCellStyle.SelectionBackColor.ToArgb() -ne $expectedSelection.ToArgb()){throw 'Terminal table retained colours from the previous theme'}
                if(-not [object]::ReferenceEquals($savedGrid,(Get-Field $form 'terminalGrid')) -or $grid.CurrentRow.DataBoundItem.TerminalId -ne $selected -or $username.Text -ne 'visual-admin' -or $search.Text -ne 'SALT-PC'){throw 'Theme change discarded session, filter or selected terminal'}
                $suffix=if($light){'light'}else{'dark'}
                if($factor -eq 1){
                    Render $form ('terminal-'+$suffix+'.png')
                    $menu.PerformLayout();$menu.Size=$menu.PreferredSize
                    Render $menu ('terminal-more-'+$suffix+'.png')
                }
                $null=Call $form 'ShowPage' @($true)
                $summary=Get-Field $form 'terminalSummaryLabel';$summary.Text='在线 9999 / 共 10000 台'
                [Windows.Forms.Application]::DoEvents()
                $manage=@(All-Controls $form|Where-Object Name -eq 'ManageTerminals')[0]
                if($summary.Bounds.IntersectsWith($manage.Bounds)){throw 'Overview terminal count overlaps the management button'}
                Assert-Buttons $form
                $type.GetField('systemRunning',$flags).SetValue($form,$true);$null=Call $form 'UpdateServiceActionState'
                (Get-Field $form 'serviceStateLabel').Text='运行中';(Get-Field $form 'systemStatusLabel').Text='服务组运行正常'
                foreach($name in @('serviceBackendIndicator','serviceFrontendIndicator','serviceLimsIndicator','serviceUpperComputerIndicator')){
                    $indicator=Get-Field $form $name;$indicator.GetType().GetField('Status',$flags).GetValue($indicator).Text='运行'
                    $indicator.GetType().GetField('Status',$flags).GetValue($indicator).ForeColor=$theme.GetProperty('Accent',$static).GetValue($null,$null)
                    $indicator.GetType().GetField('Dot',$flags).GetValue($indicator).BackColor=$theme.GetProperty('Accent',$static).GetValue($null,$null)
                }
                if((Get-Field $form 'startServiceButton').Enabled){throw 'Running system can be started twice'}
                if($factor -eq 1){Render $form ('dashboard-'+$suffix+'.png')}
                $null=Call $form 'ShowAboutPageForPreview';Assert-Buttons $form
                if($factor -eq 1){Render $form ('about-'+$suffix+'.png')}
                $null=Call $form 'ShowTerminalPageForPreview'
            }
            # Sorting survives a refreshed data source.
            $type.GetField('terminalSortDescending',$flags).SetValue($form,$true);$null=Call $form 'BindGrid' @($grid)
            $firstName=$grid.Rows[0].DataBoundItem.TerminalName;$null=Call $form 'BindGrid' @($grid)
            if($grid.Rows[0].DataBoundItem.TerminalName -ne $firstName -or $grid.Columns['TerminalName'].HeaderCell.SortGlyphDirection -ne 'Descending'){throw 'Refresh discarded table sorting'}
            Write-Output ('Passed theme/layout/state checks at '+([int]($factor*100))+' percent scale.')
        }finally{$form.Dispose()}
    }
}finally{
    if($null -ne $previous){[IO.File]::WriteAllBytes($preference,$previous)}elseif(Test-Path -LiteralPath $preference){Remove-Item -LiteralPath $preference -Force}
}
Write-Output 'Control center visual regression passed: two themes, layout B, permissions, filters, selection, scroll, sorting, counts and scaled pages.'
