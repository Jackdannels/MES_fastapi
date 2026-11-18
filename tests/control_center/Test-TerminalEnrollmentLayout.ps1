param([Parameter(Mandatory=$true)][string]$Executable,[Parameter(Mandatory=$true)][string]$EnrollmentExecutable,[string]$PreviewDirectory='')
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Web.Extensions
$flags=[Reflection.BindingFlags]'Instance,NonPublic,Public'
$static=[Reflection.BindingFlags]'Static,NonPublic,Public'
$assembly=[Reflection.Assembly]::LoadFrom($Executable)
$formType=$assembly.GetType('MESControlCenter.ControlCenterForm',$true)
$form=$formType.GetConstructor($flags,$null,[Type[]]@([string],[bool]),$null).Invoke([object[]]@('layout-fixture.ps1',$false))
function All-Controls($Root){foreach($child in $Root.Controls){$child;All-Controls $child}}
function Render($Window,[string]$Name){
    if(-not $PreviewDirectory){return}
    New-Item -ItemType Directory -Path $PreviewDirectory -Force|Out-Null
    $Window.PerformLayout()
    $bitmap=New-Object Drawing.Bitmap($Window.Width,$Window.Height)
    try{$Window.DrawToBitmap($bitmap,(New-Object Drawing.Rectangle(0,0,$Window.Width,$Window.Height)));$bitmap.Save((Join-Path $PreviewDirectory $Name),[Drawing.Imaging.ImageFormat]::Png)}finally{$bitmap.Dispose()}
}
try{
    $form.ShowInTaskbar=$false;$form.StartPosition='Manual';$form.Location=New-Object Drawing.Point(-10000,-10000)
    $form.Show();[Windows.Forms.Application]::DoEvents()
    $null=$formType.GetMethod('ShowTerminalPageForPreview',$flags).Invoke($form,@())
    $all=@(All-Controls $form)
    if(@($all|Where-Object Text -eq '  连接设置').Count){throw 'Duplicate connection-settings navigation was not removed'}
    $menu=$formType.GetField('terminalMenu',$flags).GetValue($form)
    foreach($label in @('刷新界面','重置绑定','更多操作 ▾')){if(-not @($all|Where-Object Text -eq $label)){throw ('Missing common management action: '+$label)}}
    foreach($label in @('重启终端','关闭终端','删除终端','重启全部','关闭全部','清理历史终端')){if(-not @($menu.Items|Where-Object Text -eq $label)){throw ('Missing more-menu action: '+$label)}}
    $panel=$formType.GetField('enrollmentPanel',$flags).GetValue($form)
    $tab=$all|Where-Object {$_ -is [Windows.Forms.TabControl]}|Select-Object -First 1
    $tab.SelectedIndex=1;[Windows.Forms.Application]::DoEvents()
    $panelType=$panel.GetType();$station=$panelType.GetField('station',$flags).GetValue($panel)
    $choiceType=$panelType.GetNestedType('StationChoice',[Reflection.BindingFlags]'NonPublic')
    foreach($row in @(@('LAB_SALT','盐雾试验室'),@('LAB_IMPACT_1','冲击一室'))){
        $choice=[Activator]::CreateInstance($choiceType,$true)
        $choiceType.GetField('Id',$flags).SetValue($choice,[string]$row[0]);$choiceType.GetField('Label',$flags).SetValue($choice,[string]$row[1]);$null=$station.Items.Add($choice)
    }
    $serializer=New-Object Web.Script.Serialization.JavaScriptSerializer
    $rows=$serializer.Deserialize('[{"requestId":"layout-request","requestCode":"5826-LAYOUT01","machineName":"LAYOUT-PC-01","ipAddress":"192.0.2.10","requestedStation":"LAB_SALT","status":"pending","createdAt":"2026-11-11T01:00:00Z"}]',[Collections.Generic.List[Collections.Generic.Dictionary[string,object]]])
    $panelType.GetField('requests',$flags).SetValue($panel,$rows)
    $null=$panelType.GetMethod('BindRows',$flags,$null,[Type]::EmptyTypes,$null).Invoke($panel,@())
    $requestGrid=$panelType.GetField('grid',$flags).GetValue($panel)
    $requestGrid.CurrentCell=$requestGrid.Rows[0].Cells[0]
    $null=$panelType.GetMethod('Selection',$flags).Invoke($panel,@())
    if(-not $panelType.GetField('approve',$flags).GetValue($panel).Enabled){throw 'Pending request approval is unavailable'}
    $station.SelectedIndex=1
    $null=$panelType.GetMethod('BindRows',$flags,$null,[Type]::EmptyTypes,$null).Invoke($panel,@())
    if($station.SelectedIndex -ne 1){throw 'Refreshing rows discarded the manager-assigned station'}
    $tab.SelectedIndex=1;[Windows.Forms.Application]::DoEvents()
    Render $form 'control-center-enrollment.png'
    $rows[0]['status']='reset'
    $panelType.GetField('history',$flags).GetValue($panel).Checked=$true
    $null=$panelType.GetMethod('BindRows',$flags,$null,[Type]::EmptyTypes,$null).Invoke($panel,@())
    if($panelType.GetField('approve',$flags).GetValue($panel).Enabled){throw 'A reset request can be approved again without a fresh request'}
}finally{$form.Dispose()}
$clientAssembly=[Reflection.Assembly]::LoadFrom($EnrollmentExecutable)
$configType=$clientAssembly.GetType('MESDesktopClient.ClientConfiguration',$true)
$configArguments=New-Object object[] 2
$configArguments.SetValue([string[]]@('--config',(Join-Path (Split-Path -Parent $EnrollmentExecutable) 'mes-client.json')),0);$configArguments.SetValue($false,1)
$config=$configType.GetMethod('Load',$static).Invoke($null,$configArguments)
$type=$clientAssembly.GetType('MESDesktopClient.EnrollmentForm',$true)
$arguments=New-Object object[] 1;$arguments.SetValue($config,0)
$window=$type.GetConstructor($flags,$null,[Type[]]@($configType),$null).Invoke($arguments)
try{
    $type.GetField('busy',$flags).SetValue($window,$true)
    $window.ShowInTaskbar=$false;$window.StartPosition='Manual';$window.Location=New-Object Drawing.Point(-10000,-10000)
    $window.Show();[Windows.Forms.Application]::DoEvents()
    $stationType=$type.GetNestedType('Station',[Reflection.BindingFlags]'NonPublic')
    $choice=[Activator]::CreateInstance($stationType,$true)
    $stationType.GetField('Id',$flags).SetValue($choice,'LAB_SALT');$stationType.GetField('Label',$flags).SetValue($choice,'盐雾试验室')
    $selector=$type.GetField('station',$flags).GetValue($window);$null=$selector.Items.Add($choice);$selector.SelectedIndex=0
    $type.GetField('message',$flags).GetValue($window).Text='等待控制中心审批。请将电脑名称与申请编号告知管理员。'
    $type.GetField('code',$flags).GetValue($window).Text='申请编号：5826-LAYOUT01'
    $type.GetField('submit',$flags).GetValue($window).Enabled=$false
    Render $window 'terminal-enrollment.png'
}finally{$window.Dispose()}
Write-Output 'Enrollment layout passed: single navigation, management actions, pending/reset states, assignment preservation and native request form.'
