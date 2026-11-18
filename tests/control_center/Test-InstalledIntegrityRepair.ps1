param([Parameter(Mandatory=$true)][string]$Executable,[Parameter(Mandatory=$true)][string]$Root,[string]$Component='LAB_SALT')
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
$assembly=[Reflection.Assembly]::LoadFrom($Executable);$flags=[Reflection.BindingFlags]'Instance,NonPublic,Public'
$type=$assembly.GetType('MESControlCenter.ComponentStore',$true)
$store=$type.GetConstructor($flags,$null,[Type[]]@([string]),$null).Invoke([object[]]@($Root))
$args=New-Object object[] 2;$args.SetValue($Component,0);$args.SetValue([Threading.CancellationToken]::None,1)
$result=$type.GetMethod('Repair',$flags).Invoke($store,$args)
Write-Output $result
