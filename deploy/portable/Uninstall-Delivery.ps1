[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$InstallDirectory,[ValidateSet('KeepData','Clean')][string]$Mode,[switch]$ConfirmRemoval,[switch]$ValidateOnly)
. (Join-Path $PSScriptRoot 'Mes-Installation.ps1')
$root=Assert-MesRoot $InstallDirectory
$markerPath=Resolve-MesChild $root '.mes/installation.json'
if(-not (Test-Path -LiteralPath $markerPath)){throw '所选目录没有本系统安装记录，未删除任何内容。'}
$installation=Read-MesJson $markerPath
if($installation.format -ne 'mes-installation' -or $installation.root -ne $root -or $installation.installationId -notmatch '^[a-f0-9]{32}$' -or $installation.project -ne ('mes-5826-'+$installation.installationId)){throw '安装路径或实例身份不匹配，卸载已停止。'}
$id=[string]$installation.installationId;$project=[string]$installation.project
if($ValidateOnly){Write-Output ('卸载范围已验证：'+$root+' / '+$project);exit 0}
if(-not $Mode -or -not $ConfirmRemoval){
    Add-Type -AssemblyName System.Windows.Forms;Add-Type -AssemblyName System.Drawing
    $form=New-Object Windows.Forms.Form;$form.Text='卸载5826信息化系统';$form.ClientSize=New-Object Drawing.Size(590,330);$form.StartPosition='CenterScreen';$form.FormBorderStyle='FixedDialog';$form.MaximizeBox=$false;$form.Font=New-Object Drawing.Font('Microsoft YaHei UI',10)
    $label=New-Object Windows.Forms.Label;$label.Text="卸载本次安装并释放其服务端口：`r`n$root";$label.SetBounds(24,18,540,62)
    $keep=New-Object Windows.Forms.RadioButton;$keep.Text='卸载程序，保留业务数据（重装时继续使用）';$keep.Checked=$true;$keep.SetBounds(26,94,535,32)
    $clean=New-Object Windows.Forms.RadioButton;$clean.Text='彻底卸载并清空本次安装业务数据，用于全新安装';$clean.SetBounds(26,137,540,32)
    $note=New-Object Windows.Forms.Label;$note.Text='只处理本安装实例。其他Docker项目和共享镜像保留。';$note.SetBounds(26,190,540,38)
    $cancel=New-Object Windows.Forms.Button;$cancel.Text='取消';$cancel.SetBounds(330,260,104,40);$cancel.DialogResult='Cancel'
    $accept=New-Object Windows.Forms.Button;$accept.Text='开始卸载';$accept.SetBounds(446,260,116,40)
    $accept.add_Click({
        if($clean.Checked){$choice=[Windows.Forms.MessageBox]::Show('将永久删除本次安装的业务数据卷。确认已经备份，仍要继续吗？','确认清空业务数据',[Windows.Forms.MessageBoxButtons]::OKCancel,[Windows.Forms.MessageBoxIcon]::Warning,[Windows.Forms.MessageBoxDefaultButton]::Button2);if($choice -ne 'OK'){return}}
        $form.DialogResult='OK';$form.Close()
    })
    $form.Controls.AddRange(@($label,$keep,$clean,$note,$cancel,$accept));$form.AcceptButton=$cancel;$form.CancelButton=$cancel
    try{if($form.ShowDialog() -ne 'OK'){exit 0};$Mode=if($clean.Checked){'Clean'}else{'KeepData'}}finally{$form.Dispose()}
}
$reportDirectory=Join-Path $env:LOCALAPPDATA 'Mes5826Uninstall';[IO.Directory]::CreateDirectory($reportDirectory)|Out-Null
$reportPath=Join-Path $reportDirectory ($id+'-'+(Get-Date -Format 'yyyyMMdd-HHmmss')+'.json')
$installationLock=$null
function Assert-NoLinkedTree([string]$Directory){
    if(-not (Test-Path -LiteralPath $Directory)){return}
    $pending=New-Object 'Collections.Generic.Stack[string]';$pending.Push($Directory)
    while($pending.Count){$current=$pending.Pop();$item=Get-Item -LiteralPath $current -Force;if($item.Attributes -band [IO.FileAttributes]::ReparsePoint){throw ('卸载目录包含链接，已停止：'+$current)};if($item.PSIsContainer){foreach($child in [IO.Directory]::GetFileSystemEntries($current)){$pending.Push($child)}}}
}
try{
    $installationLock=Enter-MesInstallationLock $root
    $current=Read-MesJson $markerPath
    if($current.installationId -ne $id -or $current.root -ne $root -or $current.project -ne $project){throw '安装记录已改变，请重新打开卸载程序。'}
    $controller=Join-Path $root 'MES控制中心.exe'
    $runtimePaths=@($controller)
    $catalogPath=Resolve-MesChild $root '.mes/components/catalog.json'
    if(Test-Path -LiteralPath $catalogPath){try{$catalog=Read-MesJson $catalogPath;foreach($component in $catalog.components){if($component.kind -ne 'controller'){$runtimePaths+=Resolve-MesChild $root ($component.directory+'/'+$component.executable)}}}catch{Write-Output '组件清单损坏，使用安装目录内的运行文件定位关闭范围。'}}
    $centralRuntime=Resolve-MesChild $root '中控管理/MES中控管理.exe';if(Test-Path -LiteralPath $centralRuntime){$runtimePaths+=$centralRuntime}
    $workstationRoot=Resolve-MesChild $root '工位终端'
    if(Test-Path -LiteralPath $workstationRoot){
        foreach($directory in Get-ChildItem -LiteralPath $workstationRoot -Directory){
            $safeDirectory=Resolve-MesChild $root ('工位终端/'+$directory.Name)
            foreach($candidate in Get-ChildItem -LiteralPath $safeDirectory -Filter '*.exe' -File){if($candidate.Name -ne 'MES终端接入.exe'){$runtimePaths+=$candidate.FullName}}
        }
    }
    $runtimePaths=@($runtimePaths|Select-Object -Unique)
    foreach($path in $runtimePaths){
        if(-not (Test-Path -LiteralPath $path)){continue}
        $matching=@(Get-Process -Name ([IO.Path]::GetFileNameWithoutExtension($path)) -ErrorAction SilentlyContinue|Where-Object {$_.Path -eq $path})
        if($matching.Count){$command=if($path -eq $controller){'--close-controller'}else{'--close'};Invoke-MesProcess $path @($command) 20
            foreach($process in $matching){if(-not $process.WaitForExit(10000)){throw ('关联界面尚未退出：'+$path)}}
        }
    }
    if($Mode -eq 'Clean'){
        # Local cookies/DPAPI identities belong to this exact installation/configuration.
        # Downloads and the shared device-id are not installation-specific.
        foreach($path in $runtimePaths){
            if($path -eq $controller){continue}
            $configPath=Join-Path (Split-Path -Parent $path) 'mes-client.json'
            if(-not (Test-Path -LiteralPath $configPath)){continue}
            try{$config=Read-MesJson $configPath;$module=[string]$config.module}catch{Write-Output ('配置损坏，保留无法确认的用户缓存：'+$configPath);continue}
            if($module -notin @('central','laboratory','visual','handover','staging','appearance')){continue}
            $lab=if($config.PSObject.Properties['labCode']){[string]$config.labCode}else{''}
            $identity=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value+'|'+$module+'|'+$configPath.ToUpperInvariant()
            if($lab){$identity+='|'+$lab}
            $hash=[Security.Cryptography.SHA256]::Create();try{$key=[BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($identity))).Replace('-','').Substring(0,32)}finally{$hash.Dispose()}
            $clientData=Resolve-MesChild (Join-Path $env:LOCALAPPDATA 'MESDesktopClient') ('MESDesktopClient-'+$key)
            Assert-NoLinkedTree $clientData;if(Test-Path -LiteralPath $clientData){Remove-Item -LiteralPath $clientData -Recurse -Force}
        }
    }
    $retained=$null;$volumeNames=@()
    if($installation.role -eq 'server'){
        $containers=(Invoke-MesProcess 'docker' @('ps','-a','--filter',('label=com.docker.compose.project='+$project),'--format','{{.ID}}') 20 -Capture) -split '\r?\n'|Where-Object {$_}
        foreach($container in $containers){$metadata=(Invoke-MesProcess 'docker' @('inspect',$container) 15 -Capture)|ConvertFrom-Json;if($metadata[0].Config.Labels.'com.docker.compose.project' -ne $project){throw '容器归属校验失败，已停止。'}}
        $volumeNames=@((Invoke-MesProcess 'docker' @('volume','ls','--filter',('label=com.docker.compose.project='+$project),'--format','{{.Name}}') 20 -Capture) -split '\r?\n'|Where-Object {$_})
        if($Mode -eq 'KeepData'){
            $environment=Resolve-MesChild $root $installation.environment
            if(-not (Test-Path -LiteralPath $environment)){$environment=Resolve-MesChild $root '.mes/retained/portable.env'}
            if(-not (Test-Path -LiteralPath $environment)){throw '本机凭据丢失，无法安全保留可重用的数据，请先恢复配置。'}
            $reusable=$installation.phase -in @('complete','retained')
            $state=Resolve-MesChild $root '.mes/deployment-state.json'
            if(Test-Path -LiteralPath $state){$reusable=$reusable -or (Read-MesJson $state).phase -eq 'data-ready'}
            $retained=@{environmentBytes=[IO.File]::ReadAllBytes($environment);record=@{root=$root;version=$installation.version;installationId=$id;project=$project;reusable=$reusable;volumes=@($volumeNames|ForEach-Object {@{name=$_}})}}
        }
        if(@($containers).Count){Invoke-MesProcess 'docker' (@('stop','--time','30')+@($containers)) 150;Invoke-MesProcess 'docker' (@('rm')+@($containers)) 60}
        if($Mode -eq 'Clean'){foreach($volume in $volumeNames){$metadata=(Invoke-MesProcess 'docker' @('volume','inspect',$volume) 15 -Capture)|ConvertFrom-Json;if($metadata[0].Labels.'com.docker.compose.project' -ne $project){throw '数据卷归属校验失败，已停止。'};Invoke-MesProcess 'docker' @('volume','rm',$volume) 30}}
        $networks=(Invoke-MesProcess 'docker' @('network','ls','--filter',('label=com.docker.compose.project='+$project),'--format','{{.ID}}') 20 -Capture) -split '\r?\n'|Where-Object {$_}
        foreach($network in $networks){$metadata=(Invoke-MesProcess 'docker' @('network','inspect',$network) 15 -Capture)|ConvertFrom-Json;if($metadata[0].Labels.'com.docker.compose.project' -ne $project){throw '网络归属校验失败，已停止。'};Invoke-MesProcess 'docker' @('network','rm',$network) 30}
        $firewallName='MES-Portable-Web-'+$project;$rule=Get-NetFirewallRule -DisplayName $firewallName -ErrorAction SilentlyContinue
        if($rule){$rule|Remove-NetFirewallRule -ErrorAction Stop}
    }
    $remaining=@([Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners()|Where-Object {$_.Port -in $installation.ports}|Select-Object -ExpandProperty Port -Unique)
    foreach($entry in $installation.desktopEntries){
        $path=[IO.Path]::GetFullPath([string]$entry.path);$key='HKLM:\SOFTWARE\5826MES\DesktopEntries\'+(Get-MesPathKey $path)
        if(Test-Path $key){$registration=Get-ItemProperty $key;if($registration.installationId -ne $id -or $registration.root -ne $root){throw '桌面入口已归属其他安装，停止自动删除。'}
            if((Test-Path -LiteralPath $path) -and (Get-MesHash $path) -eq $entry.sha256){Remove-Item -LiteralPath $path -Force}
            Remove-Item -LiteralPath $key -Force
        }
    }
    $report=@{installationId=$id;root=$root;mode=$Mode;project=$project;volumes=@($volumeNames);remainingPorts=$remaining;completedAt=(Get-Date).ToString('o');success=$true}
    Write-MesJson $reportPath $report
    $paths=@('.mes','中控管理','工位终端','MES控制中心.exe','卸载5826信息化系统.exe','安装记录.json','使用说明.md')
    foreach($relative in $paths){$path=Resolve-MesChild $root $relative;Assert-NoLinkedTree $path}
    foreach($relative in $paths){$path=Resolve-MesChild $root $relative;if(Test-Path -LiteralPath $path){Remove-Item -LiteralPath $path -Recurse -Force}}
    if($retained){
        $retainedDirectory=Resolve-MesChild $root '.mes/retained';[IO.Directory]::CreateDirectory($retainedDirectory)|Out-Null
        $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
        & icacls.exe $retainedDirectory /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' ('*'+$sid+':(OI)(CI)F') /Q|Out-Null
        if($LASTEXITCODE -ne 0){throw '保留凭据目录权限设置失败。'}
        [IO.File]::WriteAllBytes((Join-Path $retainedDirectory 'portable.env'),$retained.environmentBytes);Write-MesJson (Join-Path $retainedDirectory 'record.json') $retained.record
        $installation.phase='retained';Write-MesJson (Join-Path $root '.mes/installation.json') $installation
        & icacls.exe (Join-Path $retainedDirectory 'portable.env') /inheritance:r /grant:r '*S-1-5-18:F' '*S-1-5-32-544:F' ('*'+$sid+':F') /Q|Out-Null
    }else{
        $key='HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\MES5826-'+$id;if(Test-Path $key){Remove-Item -LiteralPath $key -Force}
        if((Test-Path -LiteralPath $root) -and @([IO.Directory]::GetFileSystemEntries($root)).Count -eq 0){Remove-Item -LiteralPath $root -Force}
    }
    $uninstallKey='HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\MES5826-'+$id
    if(Test-Path $uninstallKey){Remove-Item -LiteralPath $uninstallKey -Force}
    if($remaining.Count){Write-Output ('本安装已卸载，但端口仍由其他进程占用：'+($remaining -join ', '))}else{Write-Output '卸载完成，本次安装的服务端口已释放。'}
    Write-Output ('卸载记录：'+$reportPath)
    if(-not $ConfirmRemoval){Add-Type -AssemblyName System.Windows.Forms;$null=[Windows.Forms.MessageBox]::Show('卸载完成。'+"`r`n"+'记录：'+$reportPath,'5826 MES 卸载')}
}catch{Write-MesJson $reportPath @{root=$root;installationId=$id;success=$false;error=$_.Exception.Message};Write-Error $_.Exception.Message -ErrorAction Continue;exit 1}
finally{if($null -ne $installationLock){$installationLock.ReleaseMutex();$installationLock.Dispose()}}
