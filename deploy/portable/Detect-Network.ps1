param([Parameter(Mandatory=$true)][string]$OutputFile)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'Mes-PortableHost.ps1')
$lines=@(Get-MesLanInterfaces|ForEach-Object {$_.Address+'  ('+$_.Name+')'})
if($lines.Count -eq 0){$lines=@('127.0.0.1  (仅本机；未检测到有线或 Wi-Fi IPv4)')}
[IO.File]::WriteAllLines($OutputFile,[string[]]$lines,(New-Object Text.UTF8Encoding($true)))
