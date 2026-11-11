param([Parameter(Mandatory=$true)][string]$Executable, [Parameter(Mandatory=$true)][string]$TestDirectory)
$ErrorActionPreference = 'Stop'
trap { Write-Output $_.ScriptStackTrace; throw }
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Web.Extensions
$assembly = [Reflection.Assembly]::LoadFrom($Executable)
$instance = [Reflection.BindingFlags]'Instance,NonPublic,Public'
$static = [Reflection.BindingFlags]'Static,NonPublic,Public'
$type = $assembly.GetType('MESControlCenter.ConfigurationDocument', $true)
$constructor = $type.GetConstructor($instance, $null, [Type[]]@([string],[string]), $null)
function Open-Document([string]$Path, [string]$Mode) { return $constructor.Invoke([object[]]@($Path,$Mode)) }
function Get-Values($Document) { return $type.GetField('Values',$instance).GetValue($Document) }
function Save-Document($Document, $Changes) {
    $values = New-Object 'System.Collections.Generic.Dictionary[string,string]'
    foreach ($key in $Changes.Keys) { $values.Add($key, [string]$Changes[$key]) }
    $arguments = New-Object object[] 1
    $arguments.SetValue($values,0)
    return $type.GetMethod('Save',$instance).Invoke($Document,$arguments)
}
function Expect-Failure([scriptblock]$Action, [string]$Message) {
    $failed = $false
    try { & $Action } catch { $failed = $true }
    if (-not $failed) { throw $Message }
}
New-Item -ItemType Directory -Force -Path $TestDirectory | Out-Null
$encoding = New-Object Text.UTF8Encoding($false)
$envPath = Join-Path $TestDirectory '.env'
$original = "# retained comment`r`nexport MYSQL_HOST = localhost # inline`r`nMYSQL_PASSWORD='old'`r`nMYSQL_HOST=localhost`r`nDEBUG=true`r`nMYSQL_POOL_SIZE=35`r`nDM_HOST=unused`r`nLIMS_HTTP_TOKEN=`r`nMQTT_ENABLED=false`r`nUNKNOWN_MULTILINE='first`r`nMYSQL_PORT=not-an-assignment`r`nlast'`r`n"
[IO.File]::WriteAllText($envPath,$original,$encoding)
$document = Open-Document $envPath 'development'
$value = '空 格# $dollar \\server\share\tail\ a''b="x"\'
$backup = Save-Document $document @{MYSQL_PASSWORD=$value;MYSQL_HOST='db.example';MYSQL_PORT='3307'}
if ([IO.File]::ReadAllText($backup) -cne $original) { throw 'Backup was not byte-equivalent to the original' }
$reloaded = Get-Values (Open-Document $envPath 'development')
if ($reloaded['MYSQL_PASSWORD'] -cne $value -or $reloaded['MYSQL_HOST'] -ne 'db.example' -or $reloaded['MYSQL_PORT'] -ne '3307') { throw 'Environment round trip failed' }
$saved = [IO.File]::ReadAllText($envPath)
if (-not $saved.Contains('# inline') -or -not $saved.Contains("UNKNOWN_MULTILINE='first`r`nMYSQL_PORT=not-an-assignment`r`nlast'")) { throw 'Unedited text or multiline value was modified' }
if ([regex]::Matches($saved,"MYSQL_HOST\s*=\s*'db.example'").Count -ne 2) { throw 'Duplicate assignments were not consistently edited' }
Expect-Failure { Save-Document $document @{MYSQL_HOST='stale.example'} } 'A stale editor overwrote another change'
$document = Open-Document $envPath 'development'
foreach ($invalid in @(@{MYSQL_PORT='70000'}, @{MQTT_QOS='3'}, @{LIMS_HTTP_CALLBACK_URL='file:///tmp/data'}, @{RABBITMQ_URL='http://host'}, @{MYSQL_PASSWORD="line`nsecond"}, @{MYSQL_PASSWORD='${EXPAND_ME}'})) {
    Expect-Failure { Save-Document $document $invalid } 'Invalid configuration was saved'
}
if ([IO.File]::ReadAllText($envPath) -cne $saved) { throw 'Rejected input modified the file' }
[IO.File]::WriteAllText((Join-Path $TestDirectory 'roundtrip.env'),$saved,$encoding)

$nativePath = Join-Path $TestDirectory 'native.json'
[IO.File]::WriteAllText($nativePath,'{"format":"mes-native-installation","ports":{"api":18000},"mysql_root_password":"unchanged","unknown":{"nested":[1,true]},"environment":{"MYSQL_HOST":"old","MYSQL_PASSWORD":"old","CUSTOM_KEY":"keep"}}',$encoding)
$null = Save-Document (Open-Document $nativePath 'native') @{MYSQL_HOST='new.example';MYSQL_PASSWORD=$value;LIMS_HTTP_TOKEN='new-token'}
$native = [IO.File]::ReadAllText($nativePath) | ConvertFrom-Json
if ($native.ports.api -ne 18000 -or $native.mysql_root_password -ne 'unchanged' -or $native.environment.CUSTOM_KEY -ne 'keep' -or $native.environment.MYSQL_PASSWORD -cne $value -or $native.unknown.nested[1] -ne $true) { throw 'Native JSON structure or credentials were corrupted' }

$dockerPath = Join-Path $TestDirectory 'docker.env'
[IO.File]::WriteAllText($dockerPath,"MYSQL_PASSWORD=old`n",$encoding)
$null = Save-Document (Open-Document $dockerPath 'docker') @{MYSQL_PASSWORD=$value;MQTT_PASSWORD='${LITERAL}';RABBITMQ_URL='amqp://user:p%40ss@broker.example:5673/vhost';LIMS_HTTP_CALLBACK_URL='https://lims.example/events?q=1'}
$dockerValues = Get-Values (Open-Document $dockerPath 'docker')
if ($dockerValues['MYSQL_PASSWORD'] -cne $value) { throw 'Docker password round trip failed' }
$oldDeployment = Open-Document $dockerPath 'docker'
$null = $type.GetMethod('UseDockerTemplates',$instance).Invoke($oldDeployment,@('services: {api: {environment: {MQTT_HOST: ${MQTT_HOST:-rabbitmq}}}}'))
Expect-Failure { Save-Document $oldDeployment @{RABBITMQ_URL='amqp://would-not-apply'} } 'An old deployment accepted an unsupported override'

# Resolve real deployment files relative to the desktop configuration, never CWD.
$desktop = Join-Path $TestDirectory 'desktop'
New-Item -ItemType Directory -Path $desktop -Force | Out-Null
$desktopConfig = Join-Path $desktop 'mes-desktop-tools.json'
[IO.File]::WriteAllText($desktopConfig,'{"deploymentDirectory":"..","environmentFile":"docker.env","nativeConfig":"../native.json"}',$encoding)
foreach ($mode in @('docker','native')) {
    $actual = $type.GetMethod('Locate',$static).Invoke($null,[object[]]@([string]$mode,[string]'C:\unrelated',[string]$desktop))
    $expected = if($mode -eq 'docker'){$dockerPath}else{$nativePath}
    if ($actual -ne [IO.Path]::GetFullPath($expected)) { throw 'Deployment path resolved against the wrong directory' }
}

$pageType = $assembly.GetType('MESControlCenter.ConfigurationPage',$true)
$pageConstructor = $pageType.GetConstructor($instance,$null,[Type[]]@([string],[Func[string]],[Func[bool]],[Action]),$null)
$location = [Func[string]] { return $envPath }
$busy = [Func[bool]] { return $false }
$restart = [Action] { throw 'Saving unexpectedly restarted services' }
$page = $pageConstructor.Invoke([object[]]@('development',$location,$busy,$restart))
try {
    $pageType.GetMethod('EnsureLoaded',$instance).Invoke($page,@())
    $grid = $pageType.GetField('grid',$instance).GetValue($page)
    $keys = @($grid.Rows | ForEach-Object { $_.Cells['Key'].Value })
    foreach ($hidden in @('DEBUG','MYSQL_POOL_SIZE','DM_HOST','UNKNOWN_MULTILINE','MYSQL_DATABASE','RABBITMQ_URL')) {
        if ($keys -contains $hidden) { throw 'A hidden or absent setting was mixed into the default file view' }
    }
    $sourceValues = Get-Values (Open-Document $envPath 'development')
    foreach ($row in $grid.Rows) {
        if (-not $sourceValues.ContainsKey([string]$row.Cells['Key'].Value)) { throw 'A default row did not come from the file' }
        if ([string]$row.Cells['Label'].Value -notmatch '[\u4e00-\u9fff]' -or [string]$row.Cells['Description'].Value -notmatch '[\u4e00-\u9fff]') { throw 'Chinese label or explanation is missing' }
    }
    if ($grid.Columns['Key'].Visible -or $grid.Columns['Value'].HeaderText -ne '文件中的值') { throw 'The file-based simplified columns were not applied' }
    $emptyRow = @($grid.Rows | Where-Object { $_.Cells['Key'].Value -eq 'LIMS_HTTP_TOKEN' })[0]
    if ($emptyRow.Cells['Value'].Value -ne '（空值）') { throw 'An explicit empty value was confused with an absent key' }
    $showUnconfigured = $pageType.GetField('showUnconfigured',$instance).GetValue($page)
    $showUnconfigured.Checked = $true
    $databaseRow = @($grid.Rows | Where-Object { $_.Cells['Key'].Value -eq 'MYSQL_DATABASE' })[0]
    if ($databaseRow.Cells['Value'].Value -ne '未配置' -or $databaseRow.Cells['State'].Value -ne '未配置') { throw 'An absent key was filled from the schema default' }
    $grid.CurrentCell = $databaseRow.Cells[0]
    $pageType.GetMethod('SelectField',$instance).Invoke($page,@())
    $editor = $pageType.GetField('editor',$instance).GetValue($page)
    if ($editor.Text.Length -ne 0) { throw 'An unconfigured field was prefilled from code defaults' }
    $editor.Text = 'new-business-db'
    $showUnconfigured.Checked = $false
    if (-not @($grid.Rows | Where-Object { $_.Cells['Key'].Value -eq 'MYSQL_DATABASE' })) { throw 'A new draft disappeared when the unconfigured filter was hidden' }
    $search = $pageType.GetField('search',$instance).GetValue($page)
    $search.Text = '跨域'
    if ($grid.Rows.Count -ne 0) { throw 'Search included an absent row without permission to show it' }
    $showUnconfigured.Checked = $true
    if ($grid.Rows.Count -ne 1 -or $grid.Rows[0].Cells['Key'].Value -ne 'FRONTEND_ORIGINS') { throw 'Searching by Chinese explanation failed' }
    $search.Text = ''; $showUnconfigured.Checked = $false
    $mqttRow = @($grid.Rows | Where-Object { $_.Cells['Key'].Value -eq 'MQTT_ENABLED' })[0]
    if ($mqttRow.Cells['Value'].Value -ne '停用（false）') { throw 'Boolean values were not explained in Chinese' }
    $grid.CurrentCell = $mqttRow.Cells[0]
    $null = $pageType.GetMethod('SelectField',$instance).Invoke($page,@())
    $booleanEditor = $pageType.GetField('booleanEditor',$instance).GetValue($page)
    if ($booleanEditor.SelectedIndex -ne 1) { throw 'The boolean editor ignored its file value' }
    $booleanEditor.SelectedIndex = 0
    $passwordRow = @($grid.Rows | Where-Object { $_.Cells['Key'].Value -eq 'MYSQL_PASSWORD' })[0]
    if ($passwordRow.Cells['Value'].Value -cne '••••••••') { throw 'Password is exposed in grid' }
    $grid.CurrentCell = $passwordRow.Cells[0]
    $pageType.GetMethod('SelectField',$instance).Invoke($page,@())
    $editor = $pageType.GetField('editor',$instance).GetValue($page)
    if (-not $editor.UseSystemPasswordChar) { throw 'Password editor is not masked' }
    $editor.Text = 'changed-through-page'
    if (-not $pageType.GetProperty('Dirty',$instance).GetValue($page,$null)) { throw 'Editing did not mark draft dirty' }
    $pageType.GetMethod('Filter',$instance).Invoke($page,@())
    $pageType.GetMethod('SaveChanges',$instance).Invoke($page,@($false))
    if ((Get-Values (Open-Document $envPath 'development'))['MYSQL_PASSWORD'] -ne 'changed-through-page') { throw 'Page did not persist its draft' }
    $updated = [IO.File]::ReadAllText($envPath)
    if (-not $updated.Contains('DEBUG=true') -or -not $updated.Contains('MYSQL_POOL_SIZE=35') -or -not $updated.Contains('DM_HOST=unused')) { throw 'Hiding settings changed their stored values' }
    if ((Get-Values (Open-Document $envPath 'development'))['MYSQL_DATABASE'] -ne 'new-business-db') { throw 'An explicitly configured field was not saved' }
    if ((Get-Values (Open-Document $envPath 'development'))['MQTT_ENABLED'] -ne 'true') { throw 'A translated boolean was not saved in the original format' }
} finally { $page.Dispose() }

# The same simplified view reads each deployment's real values and aliases.
$aliasPath = Join-Path $TestDirectory 'docker-alias.env'
[IO.File]::WriteAllText($aliasPath,"MYSQL_API_USER=actual-user`nMYSQL_API_PASSWORD=actual-password`nRABBITMQ_USER=actual-broker-user`nRABBITMQ_PASSWORD=actual-broker-password`nMES_LOGIN_USER=actual-login`nMES_LOGIN_PASSWORD=actual-login-password`nMES_FRONTEND_ORIGINS=https://mes.example`nMYSQL_ROOT_PASSWORD=hidden-root-password`n",$encoding)
foreach ($mode in @('docker','native')) {
    $script:pagePath = if($mode -eq 'docker'){$aliasPath}else{$nativePath}
    $location = [Func[string]] { return $script:pagePath }
    $page = $pageConstructor.Invoke([object[]]@([string]$mode,$location,$busy,$restart))
    try {
        $null = $pageType.GetMethod('EnsureLoaded',$instance).Invoke($page,@())
        $grid = $pageType.GetField('grid',$instance).GetValue($page)
        $fileValues = Get-Values (Open-Document $script:pagePath $mode)
        foreach ($row in $grid.Rows) {
            $rowKey = [string]$row.Cells['Key'].Value
            if (-not $fileValues.ContainsKey($rowKey)) { throw 'A deployment row did not come from its own file' }
            if ([string]$row.Cells['Description'].Value -notmatch '[\u4e00-\u9fff]') { throw 'Deployment field explanation missing' }
        }
        if ($mode -eq 'docker') {
            $userRow = @($grid.Rows | Where-Object { $_.Cells['Key'].Value -eq 'MYSQL_API_USER' })[0]
            if ($userRow.Cells['Value'].Value -ne 'actual-user') { throw 'A deployment alias was replaced by a backend default' }
            if (@($grid.Rows | Where-Object { $_.Cells['Key'].Value -in @('MYSQL_USER','MYSQL_ROOT_PASSWORD') })) { throw 'An unused alias or internal secret was exposed' }
        } elseif (@($grid.Rows | Where-Object { $_.Cells['Key'].Value -eq 'CUSTOM_KEY' })) { throw 'An unlabelled native internal setting was exposed' }
    } finally { $page.Dispose() }
}
Write-Output 'Configuration checks passed: file-based important fields, Chinese explanations, absent/empty values, masking, drafts, backups, conflicts and all deployment sources.'
