param([Parameter(Mandatory=$true)][string]$Executable,[Parameter(Mandatory=$true)][string]$Origin,[Parameter(Mandatory=$true)][string]$RequestFile,[Parameter(Mandatory=$true)][string]$DesktopDirectory,[Parameter(Mandatory=$true)][string]$ResultFile)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=New-Object Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Web.Extensions
$assembly=[Reflection.Assembly]::LoadFrom($Executable)
$flags=[Reflection.BindingFlags]'Static,NonPublic'
$serializer=New-Object Web.Script.Serialization.JavaScriptSerializer
$request=$serializer.DeserializeObject([IO.File]::ReadAllText($RequestFile,[Text.Encoding]::UTF8))
$network=$assembly.GetType('MESDesktopClient.EnrollmentNetwork',$true)
$body=$serializer.DeserializeObject('{"token":"'+$request['token']+'"}')
$arguments=New-Object object[] 3
$arguments.SetValue([Uri]$Origin,0)
$arguments.SetValue(('requests/'+$request['requestId']+'/poll'),1)
$arguments.SetValue($body,2)
$response=$network.GetMethod('Request',$flags).Invoke($null,$arguments)
if($response['status'] -ne 'issued'){throw 'Provisioning requires an approved request'}
$type=$assembly.GetType('MESDesktopClient.ClientProvisioning',$true)
foreach($invalid in @('../escape','C:\escape','/escape','nested/../../escape')) {
    $rejected=$false
    try{$null=$type.GetMethod('SafePath',$flags).Invoke($null,@([string]$DesktopDirectory,[string]$invalid))}catch{$rejected=$true}
    if(-not $rejected){throw 'Unsafe package path was accepted'}
}
$arguments=New-Object object[] 4
$arguments.SetValue([Uri]$Origin,0);$arguments.SetValue($request,1);$arguments.SetValue($response,2);$arguments.SetValue([string]$DesktopDirectory,3)
$result=$type.GetMethod('Install',$flags).Invoke($null,$arguments)
[IO.File]::WriteAllText($ResultFile,[string]$result,(New-Object Text.UTF8Encoding($false)))
Write-Output 'Approved package downloaded, verified and provisioned successfully.'
