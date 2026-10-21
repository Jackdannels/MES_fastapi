param([Parameter(Mandatory=$true)][string]$Executable)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Web.Extensions
$assembly = [Reflection.Assembly]::LoadFrom($Executable)
if ($assembly.GetName().Version.ToString() -ne '2.7.0.0' -or [Diagnostics.FileVersionInfo]::GetVersionInfo($Executable).FileVersion -ne '2.7.0.0') { throw 'Control center assembly/file version is not 2.7.0.0' }
$static = [Reflection.BindingFlags]'Static,NonPublic'
$fields = [Reflection.BindingFlags]'Instance,NonPublic,Public'
$type = $assembly.GetType('MESControlCenter.MESAccessInfo', $true)
$adapterType = $assembly.GetType('MESControlCenter.LanInterface', $true)
$genericList = [System.Collections.Generic.List``1].MakeGenericType($adapterType)
$adapters = [Activator]::CreateInstance($genericList)
foreach ($address in @('192.168.110.15', '10.20.30.40')) {
    $adapter = [Activator]::CreateInstance($adapterType)
    $adapterType.GetField('Name', $fields).SetValue($adapter, 'Physical Ethernet')
    $adapterType.GetField('Address', $fields).SetValue($adapter, $address)
    $adapterType.GetField('HasGateway', $fields).SetValue($adapter, $true)
    $adapters.Add($adapter)
}
$serializer = New-Object System.Web.Script.Serialization.JavaScriptSerializer
$script:probeCalls = 0
$probe = [Func[string,bool]] { param($url); $script:probeCalls++; return $url -eq 'http://192.168.110.15:32173' }
function Build-Report([string]$Json) {
    $info = $serializer.DeserializeObject($Json)
    return $type.GetMethod('Build', $static).Invoke($null, @('http://127.0.0.1:15173', $true, $info, $adapters, $probe))
}
function Rows($Report) { return $Report.GetType().GetField('Rows', $fields).GetValue($Report) }
function Verified($Row) { return $Row.GetType().GetField('Verified', $fields).GetValue($Row) }
if (-not $type.GetMethod('RunSelfTest', $static).Invoke($null, @())) { throw 'IPv4/virtual adapter filtering self-test failed' }

$report = Build-Report '{"webPort":32173,"engineAvailable":true,"running":true,"bindings":[{"hostIp":"127.0.0.1","port":32173}],"configuredBindings":[{"hostIp":"127.0.0.1","port":32173}]}'
$rows = @(Rows $report)
if ($rows.Count -ne 2 -or (Verified $rows[0]) -or $script:probeCalls -ne 0) { throw 'Loopback listener was advertised as available' }
if ($rows[0].Url -ne 'http://192.168.110.15:32173') { throw 'Published port was not retained' }
if (-not $report.GetType().GetField('Guidance', $fields).GetValue($report).Contains('仅绑定本机')) { throw 'Loopback-only guidance missing' }

$report = Build-Report '{"webPort":32173,"engineAvailable":true,"running":true,"bindings":[{"hostIp":"0.0.0.0","port":32173}],"configuredBindings":[{"hostIp":"0.0.0.0","port":32173}]}'
$rows = @(Rows $report)
if (-not (Verified $rows[0]) -or (Verified $rows[1]) -or $script:probeCalls -ne 2) { throw 'Wildcard binding or per-address verification failed' }
if (-not $rows[0].Status.Contains('待异机验证')) { throw 'Host verification falsely implied remote access verification' }

$script:probeCalls = 0
$report = Build-Report '{"webPort":32173,"engineAvailable":true,"running":true,"bindings":[{"hostIp":"10.20.30.40","port":32173}]}'
$rows = @(Rows $report)
if ((Verified $rows[0]) -or $script:probeCalls -ne 1) { throw 'Specific interface binding exposed another interface' }

$script:probeCalls = 0
$report = Build-Report '{"webPort":32173,"engineAvailable":false,"running":false,"bindings":[],"configuredBindings":[{"hostIp":"0.0.0.0","port":32173}]}'
$rows = @(Rows $report)
if ((Verified $rows[0]) -or $script:probeCalls -ne 0) { throw 'Inactive Docker deployment was advertised as reachable' }

$initial = $type.GetMethod('InitialServerUrl', $static).Invoke($null, @())
if ($initial -ne 'http://127.0.0.1:15173') { throw 'Packaged control center did not use its configured URL' }
$formType = $assembly.GetType('MESControlCenter.ControlCenterForm', $true)
$testController = Join-Path (Split-Path -Parent $Executable) 'scripts/docker-service-control.ps1'
$form = $formType.GetConstructor($fields, $null, [Type[]]@([string],[bool]), $null).Invoke([object[]]@([string]$testController, [bool]$false))
try {
    $null = $formType.GetMethod('ApplyAboutReport', $fields).Invoke($form, @($report))
    $banner = $formType.GetField('lanAddressLink', $fields).GetValue($form)
    if ($banner.Text -ne 'http://192.168.110.15:32173' -or -not $form.Text.Contains('v2.7')) { throw 'Homepage LAN address or v2.7 title missing' }
} finally { $form.Dispose() }
Write-Output 'About runtime checks passed: loopback, wildcard, specific NIC, custom port, offline Docker, candidate status and configured startup URL.'
