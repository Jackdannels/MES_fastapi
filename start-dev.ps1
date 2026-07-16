param(
    [string]$BackendHost = "0.0.0.0",
    [int]$BackendPort = 8000,
    [string]$FrontendHost = "0.0.0.0",
    [int]$FrontendPort = 5173,
    [string]$CondaEnv = "fastapi",
    [int]$FrontendWaitTimeoutSeconds = 90,
    [int]$BrowserWaitTimeoutSeconds = 120,
    [switch]$DisableAutoOpenBrowser,
    [switch]$Production,
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
$launcherSessionId = [Guid]::NewGuid().ToString("N")

if ($condaBat) {
    $backendReloadArgument = if ($Production) { "" } else { " --reload" }
    $backendCommand = "set `"MES_LAUNCHER_SESSION=$launcherSessionId`" && call `"$condaBat`" activate $CondaEnv && cd /d `"$ProjectRoot`" && python scripts\run_local.py$backendReloadArgument --host $BackendHost --port $BackendPort"
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
$frontendRunCommand = if ($Production) {
    "npm run build && npm run serve:public -- --host $FrontendHost --port $FrontendPort"
} else {
    "npm run dev -- --host $FrontendHost --port $FrontendPort"
}
$frontendCommand = "set `"MES_LAUNCHER_SESSION=$launcherSessionId`" && powershell.exe -NoProfile -ExecutionPolicy Bypass -EncodedCommand $encodedFrontendWait && cd /d `"$FrontendRoot`" && $frontendRunCommand"
$terminalCommandSwitch = if ($Production) { "/c" } else { "/k" }
$backendTerminalCommand = if ($Production) { "$backendCommand & exit /b 0" } else { $backendCommand }
$frontendTerminalCommand = if ($Production) { "$frontendCommand & exit /b 0" } else { $frontendCommand }

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
$windowsTerminal = Get-Command "wt.exe" -ErrorAction SilentlyContinue
if (-not $windowsTerminal) {
    $backendCommand += " --no-use-colors"
}

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

if ($windowsTerminal) {
    $terminalProcess = Start-Process -FilePath $windowsTerminal.Source `
        -ArgumentList "-w", "new", "new-tab", "--title", '"MES Backend"', "cmd.exe", $terminalCommandSwitch, $backendTerminalCommand, ";", "new-tab", "--title", '"MES Frontend"', "cmd.exe", $terminalCommandSwitch, $frontendTerminalCommand `
        -WorkingDirectory $ProjectRoot `
        -PassThru
    if ($Production) {
        # Windows Terminal may reuse an existing host process. Track the cmd.exe
        # process inside each tab by session marker so Stop/Restart closes the
        # visible backend and frontend tabs instead of relying on the host PID.
        $commandDeadline = (Get-Date).AddSeconds(10)
        $backendCommandProcess = $null
        $frontendCommandProcess = $null
        do {
            $sessionCommands = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
                $_.Name -match "(?i)^cmd\.exe$" -and [string]$_.CommandLine -like "*MES_LAUNCHER_SESSION=$launcherSessionId*"
            })
            $backendCommandProcess = $sessionCommands | Where-Object { [string]$_.CommandLine -like "*scripts\run_local.py*" } | Select-Object -First 1
            $frontendCommandProcess = $sessionCommands | Where-Object { [string]$_.CommandLine -like "*npm run serve:public*" } | Select-Object -First 1
            if ($backendCommandProcess -and $frontendCommandProcess) { break }
            Start-Sleep -Milliseconds 100
        } while ((Get-Date) -lt $commandDeadline)
        if (-not $backendCommandProcess -or -not $frontendCommandProcess) {
            throw "Unable to identify MES backend/frontend terminal command processes."
        }
        $backendProcess = Get-Process -Id $backendCommandProcess.ProcessId
        $frontendProcess = Get-Process -Id $frontendCommandProcess.ProcessId
    } else {
        $backendProcess = $terminalProcess
        $frontendProcess = $terminalProcess
    }
} else {
    $backendProcess = Start-Process -FilePath "cmd.exe" -ArgumentList $terminalCommandSwitch, "title MES Backend && $backendTerminalCommand" -WorkingDirectory $ProjectRoot -PassThru
    $frontendProcess = Start-Process -FilePath "cmd.exe" -ArgumentList $terminalCommandSwitch, "title MES Frontend && $frontendTerminalCommand" -WorkingDirectory $FrontendRoot -PassThru
}
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
        launcherSessionId = $launcherSessionId
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
