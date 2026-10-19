param(
    [Parameter(Mandatory = $true)][string]$Executable,
    [Parameter(Mandatory = $true)][string]$TestDirectory
)

$ErrorActionPreference = "Stop"
$fixture = Join-Path $TestDirectory "fake-controller.ps1"
@'
param([string]$Action, [string]$ResultFile)
switch ($Action) {
    "Status" {
        [Console]::Error.WriteLine("non-fatal diagnostic")
        '{"status":"stopped","message":"status-ok"}' | Set-Content -LiteralPath $ResultFile -Encoding UTF8
    }
    "Start" {
        [Console]::Error.WriteLine("native-failure-marker:" + ("x" * 65536))
        exit 1
    }
    "Stop" { exit 1 }
    "Restart" {
        '{"status":"error","message":"structured-error"}' | Set-Content -LiteralPath $ResultFile -Encoding UTF8
        exit 1
    }
}
'@ | Set-Content -LiteralPath $fixture -Encoding UTF8

Add-Type -AssemblyName System.Windows.Forms
$assembly = [Reflection.Assembly]::LoadFrom($Executable)
$type = $assembly.GetType("MESControlCenter.ControlCenterForm", $true)
$flags = [Reflection.BindingFlags]"Instance,NonPublic"
$constructor = $type.GetConstructor($flags, $null, [Type[]]@([string], [bool]), $null)
$form = $constructor.Invoke([object[]]@([string]$fixture, $false))
$runControl = $type.GetMethod("RunControl", $flags)
try {
    $result = $runControl.Invoke($form, @("Status")) | ConvertFrom-Json
    if ($result.status -ne "stopped" -or $result.message -ne "status-ok") { throw "Structured success was not preserved." }
    $result = $runControl.Invoke($form, @("Restart")) | ConvertFrom-Json
    if ($result.status -ne "error" -or $result.message -ne "structured-error") { throw "Structured failure was not preserved." }
    foreach ($action in @("Start", "Stop")) {
        $failure = $null
        try { $null = $runControl.Invoke($form, @([string]$action)) }
        catch { $failure = $_.Exception.GetBaseException() }
        if ($null -eq $failure -or $failure -isnot [InvalidOperationException]) { throw "Missing expected script failure for $action." }
        if ($action -eq "Start" -and -not $failure.Message.Contains("native-failure-marker:")) { throw "Native stderr was lost." }
        if ($action -eq "Stop" -and -not $failure.Message.Contains("1")) { throw "Fallback lost the exit code." }
    }
    Write-Output "Control-center runtime checks passed (structured success/error, long stderr, silent exit)."
} finally {
    $form.Dispose()
}
