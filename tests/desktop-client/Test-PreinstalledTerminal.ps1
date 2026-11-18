param([Parameter(Mandatory=$true)][string]$Executable,[Parameter(Mandatory=$true)][string]$Origin,[string]$RequestFile='',[string]$ResultFile='',[switch]$Inspect)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=New-Object Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Web.Extensions
$assembly=[Reflection.Assembly]::LoadFrom($Executable)
$static=[Reflection.BindingFlags]'Static,NonPublic,Public'
$flags=[Reflection.BindingFlags]'Instance,NonPublic,Public'
$type=$assembly.GetType('MESDesktopClient.ClientConfiguration',$true)
$arguments=New-Object object[] 2
$arguments.SetValue([string[]]@('--config',(Join-Path (Split-Path -Parent $Executable) 'mes-client.json'),'--server-url',$Origin,'--test-hidden'),0);$arguments.SetValue($false,1)
$config=$type.GetMethod('Load',$static).Invoke($null,$arguments)
if($Inspect){
    $formType=$assembly.GetType('MESDesktopClient.EnrollmentForm',$true)
    $arguments=New-Object object[] 1;$arguments.SetValue($config,0)
    $form=$formType.GetConstructor($flags,$null,[Type[]]@($type),$null).Invoke($arguments)
    try{
        $station=$formType.GetField('station',$flags).GetValue($form)
        if($station.Enabled -or $station.Items.Count -ne 1){throw 'Workstation entry is not locked to its own station'}
        $expected=$type.GetField('LabCode',$flags).GetValue($config)
        if(-not $expected){$expected=$type.GetField('Module',$flags).GetValue($config)}
        $selected=$station.SelectedItem
        if($selected.GetType().GetField('Id',$flags).GetValue($selected) -ne $expected){throw 'Incorrect default workstation'}
        Write-Output ('Default workstation verified: '+$expected)
    }finally{$form.Dispose()}
    exit 0
}
$serializer=New-Object Web.Script.Serialization.JavaScriptSerializer
$request=$serializer.DeserializeObject([IO.File]::ReadAllText($RequestFile,[Text.Encoding]::UTF8))
$body=$serializer.DeserializeObject('{"token":"'+$request['token']+'"}')
$arguments=New-Object object[] 3;$arguments.SetValue([Uri]$Origin,0);$arguments.SetValue(('requests/'+$request['requestId']+'/poll'),1);$arguments.SetValue($body,2)
$response=$assembly.GetType('MESDesktopClient.EnrollmentNetwork',$true).GetMethod('Request',$static).Invoke($null,$arguments)
$arguments=New-Object object[] 4;$arguments.SetValue($config,0);$arguments.SetValue([Uri]$Origin,1);$arguments.SetValue($request,2);$arguments.SetValue($response,3)
$activated=$assembly.GetType('MESDesktopClient.ClientProvisioning',$true).GetMethod('TryActivateLocal',$static).Invoke($null,$arguments)
[IO.File]::WriteAllText($ResultFile,[string]$activated,(New-Object Text.UTF8Encoding($false)))
Write-Output ('Local activation result: '+[string]$activated)
