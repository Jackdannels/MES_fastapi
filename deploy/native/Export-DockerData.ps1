[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)] [string]$Deployment,
    [string]$EnvironmentFile,
    [string]$Output,
    [switch]$StopDeployment
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if (-not $EnvironmentFile) { $EnvironmentFile = Join-Path $Deployment '.tmp\portable.env' }
if (-not $Output) { $Output = 'C:\MESBackups\docker-final-' + (Get-Date -Format 'yyyyMMdd-HHmmss') }
$python = Join-Path $PSScriptRoot '..\runtime\python\python.exe'
$exporter = Join-Path $PSScriptRoot 'export_docker_data.py'
$logFile = $Output.TrimEnd('\', '/') + '.log'
$exportArguments = @('-I', '-X', 'utf8', $exporter, '--deployment', $Deployment,
    '--environment-file', $EnvironmentFile, '--output', $Output, '--log-file', $logFile)
if ($StopDeployment) { $exportArguments += @('--leave-stopped', '--stop-deployment') }
Write-Host "Export progress and errors: $logFile"
& $python @exportArguments
if ($LASTEXITCODE -ne 0) { throw "Docker export did not complete. Read $logFile before proceeding." }
Write-Host "Verified data backup: $(Join-Path $Output 'data-manifest.json')"
if ($StopDeployment) { Write-Host 'Source Docker services are stopped; containers, images and volumes are retained.' }
else { Write-Host 'Source Docker services have been restored.' }
