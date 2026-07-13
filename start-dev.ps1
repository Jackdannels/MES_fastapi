param(
    [string]$BackendHost = "0.0.0.0",
    [int]$BackendPort = 8000,
    [string]$FrontendHost = "0.0.0.0",
    [int]$FrontendPort = 5173,
    [string]$CondaEnv = "fastapi",
    [int]$FrontendWaitTimeoutSeconds = 90,
    [int]$BrowserWaitTimeoutSeconds = 120,
    [switch]$DisableAutoOpenBrowser,
    [string]$StateFile = "",
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"

$ProjectRoot = $PSScriptRoot
$FrontendRoot = Join-Path $ProjectRoot "frontend"

function Resolve-CondaBat {
    $candidates = @()

    if ($env:CONDA_BAT) {
        $candidates += $env:CONDA_BAT
    }

    if ($env:CONDA_EXE) {
        $condaExePath = $env:CONDA_EXE
        $condaRoot = Split-Path (Split-Path $condaExePath -Parent) -Parent
        $candidates += Join-Path $condaRoot "condabin\conda.bat"
    }

    $pathCommand = Get-Command "conda.bat" -ErrorAction SilentlyContinue
    if ($pathCommand) {
        $candidates += $pathCommand.Source
    }

    $condaCommand = Get-Command "conda" -ErrorAction SilentlyContinue
    if ($condaCommand -and $condaCommand.Source -like "*.bat") {
        $candidates += $condaCommand.Source
    }

    $candidates += @(
        (Join-Path $env:USERPROFILE "anaconda3\condabin\conda.bat"),
        (Join-Path $env:USERPROFILE "miniconda3\condabin\conda.bat"),
        "C:\ProgramData\anaconda3\condabin\conda.bat",
        "C:\ProgramData\miniconda3\condabin\conda.bat"
    )

    foreach ($candidate in $candidates) {
        if ($candidate -and (Test-Path -LiteralPath $candidate)) {
            return (Resolve-Path -LiteralPath $candidate).Path
        }
    }

    return $null
}

function Resolve-PrimaryLanIpv4 {
    try {
        $defaultRoute = Get-NetRoute -DestinationPrefix "0.0.0.0/0" -ErrorAction Stop |
            Sort-Object RouteMetric, InterfaceMetric |
            Select-Object -First 1
        if ($defaultRoute) {
            $ipConfig = Get-NetIPConfiguration -InterfaceIndex $defaultRoute.InterfaceIndex -ErrorAction Stop
            $address = $ipConfig.IPv4Address |
                Where-Object { $_.IPAddress -and $_.IPAddress -notlike "169.254.*" -and $_.IPAddress -ne "127.0.0.1" } |
                Select-Object -First 1
            if ($address) {
                return $address.IPAddress
            }
        }
    } catch {
        # Fall back to DNS host addresses on systems without NetTCPIP cmdlets.
    }

    try {
        $addresses = [System.Net.Dns]::GetHostEntry([System.Net.Dns]::GetHostName()).AddressList
        $address = $addresses |
            Where-Object {
                $_.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetwork `
                    -and $_.IPAddressToString -ne "127.0.0.1" `
                    -and $_.IPAddressToString -notlike "169.254.*"
            } |
            Select-Object -First 1
        if ($address) {
            return $address.IPAddressToString
        }
    } catch {
        return "127.0.0.1"
    }

    return "127.0.0.1"
}

if (-not (Test-Path -LiteralPath (Join-Path $ProjectRoot "scripts\run_local.py"))) {
    throw "Cannot find scripts\run_local.py. Please run this script from the MES_fastapi project."
}

if (-not (Test-Path -LiteralPath $FrontendRoot)) {
    throw "Cannot find frontend directory: $FrontendRoot"
}

$condaBat = Resolve-CondaBat
$backendReadyUrl = "http://127.0.0.1:$BackendPort/api/storage"
$frontendLocalUrl = "http://127.0.0.1:$FrontendPort/"
$frontendNetworkHost = Resolve-PrimaryLanIpv4
$frontendNetworkUrl = "http://${frontendNetworkHost}:$FrontendPort/"

if ($condaBat) {
    $backendCommand = "call `"$condaBat`" activate $CondaEnv && cd /d `"$ProjectRoot`" && python scripts\run_local.py --reload --host $BackendHost --port $BackendPort"
} else {
    $backendCommand = "echo Unable to find conda.bat. Please install Anaconda/Miniconda or add conda to PATH. && echo Expected environment: $CondaEnv"
}

$frontendWaitScript = @"
`$deadline = (Get-Date).AddSeconds($FrontendWaitTimeoutSeconds)
Write-Host "Waiting for backend: $backendReadyUrl"
do {
    try {
        `$response = Invoke-WebRequest -UseBasicParsing -Uri "$backendReadyUrl" -TimeoutSec 2
        if (`$response.StatusCode -ge 200 -and `$response.StatusCode -lt 500) {
            Write-Host "Backend is ready."
            exit 0
        }
    } catch {
        Start-Sleep -Seconds 1
    }
} while ((Get-Date) -lt `$deadline)
Write-Error "Backend did not become ready within $FrontendWaitTimeoutSeconds seconds: $backendReadyUrl"
exit 1
"@

$encodedFrontendWait = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($frontendWaitScript))
$frontendCommand = "powershell.exe -NoProfile -ExecutionPolicy Bypass -EncodedCommand $encodedFrontendWait && cd /d `"$FrontendRoot`" && npm run dev -- --host $FrontendHost --port $FrontendPort"

$browserOpenScript = @"
`$deadline = (Get-Date).AddSeconds($BrowserWaitTimeoutSeconds)
Write-Host "Waiting for frontend: $frontendLocalUrl"
do {
    try {
        `$response = Invoke-WebRequest -UseBasicParsing -Uri "$frontendLocalUrl" -TimeoutSec 2
        if (`$response.StatusCode -ge 200 -and `$response.StatusCode -lt 500) {
            Write-Host "Opening browser: $frontendNetworkUrl"
            Start-Process "$frontendNetworkUrl"
            exit 0
        }
    } catch {
        Start-Sleep -Seconds 1
    }
} while ((Get-Date) -lt `$deadline)
Write-Error "Frontend did not become ready within $BrowserWaitTimeoutSeconds seconds: $frontendLocalUrl"
exit 1
"@

$encodedBrowserOpen = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($browserOpenScript))

if ($DryRun) {
    Write-Host "Backend command:"
    Write-Host $backendCommand
    Write-Host ""
    Write-Host "Frontend wait:"
    Write-Host $frontendWaitScript.Trim()
    Write-Host ""
    Write-Host "Frontend command:"
    Write-Host $frontendCommand
    Write-Host ""
    Write-Host "Network frontend URL:"
    Write-Host $frontendNetworkUrl
    Write-Host ""
    Write-Host "Open browser:"
    Write-Host ($(if ($DisableAutoOpenBrowser) { "disabled" } else { $browserOpenScript.Trim() }))
    exit 0
}

$backendProcess = Start-Process -FilePath "cmd.exe" -ArgumentList "/k", $backendCommand -WorkingDirectory $ProjectRoot -PassThru
$frontendProcess = Start-Process -FilePath "cmd.exe" -ArgumentList "/k", $frontendCommand -WorkingDirectory $FrontendRoot -PassThru
if ($StateFile) {
    $stateDirectory = Split-Path -Parent $StateFile
    if ($stateDirectory) { New-Item -ItemType Directory -Force -Path $stateDirectory | Out-Null }
    [pscustomobject]@{
        backendCommandPid = $backendProcess.Id
        frontendCommandPid = $frontendProcess.Id
        browserPid = 0
        backendPort = $BackendPort
        frontendPort = $FrontendPort
        frontendUrl = $frontendNetworkUrl
    } | ConvertTo-Json | Set-Content -LiteralPath $StateFile -Encoding UTF8
}
if (-not $DisableAutoOpenBrowser) {
    Start-Process -FilePath "powershell.exe" `
        -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand", $encodedBrowserOpen `
        -WorkingDirectory $ProjectRoot `
        -WindowStyle Hidden
}

Write-Host "Started MES backend and frontend dev windows."
Write-Host "Backend:  http://localhost:$BackendPort"
Write-Host "Frontend: $frontendNetworkUrl"
