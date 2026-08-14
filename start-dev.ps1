param(
    [string]$BackendHost = "0.0.0.0",
    [int]$BackendPort = 8000,
    [string]$FrontendHost = "0.0.0.0",
    [int]$FrontendPort = 5173,
    [string]$FrontendNetworkHost = "192.168.110.15",
    [string]$LimsSimulatorHost = "127.0.0.1",
    [int]$LimsSimulatorPort = 8900,
    [int]$UpperComputerSimulatorPort = 8899,
    [string]$RabbitMqUrl = "amqp://guest:guest@127.0.0.1:5672/",
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
$LimsSimulatorRoot = Join-Path $ProjectRoot "tools\lims_simulator"

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

function Resolve-CondaPython([string]$CondaBatPath, [string]$EnvironmentName) {
    if (-not $CondaBatPath) { return $null }
    $condaRoot = Split-Path (Split-Path $CondaBatPath -Parent) -Parent
    $candidates = @()
    if ($EnvironmentName -and $EnvironmentName -notin @("base", "root")) {
        $candidates += Join-Path $condaRoot "envs\$EnvironmentName\python.exe"
    }
    $candidates += Join-Path $condaRoot "python.exe"
    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate) {
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

if (-not (Test-Path -LiteralPath (Join-Path $LimsSimulatorRoot "app.py"))) {
    throw "Cannot find LIMS simulator: $LimsSimulatorRoot"
}

$condaBat = Resolve-CondaBat
$condaPython = Resolve-CondaPython $condaBat $CondaEnv
$backendReadyUrl = "http://127.0.0.1:$BackendPort/health/ready"
$frontendLocalUrl = "http://127.0.0.1:$FrontendPort/"
$limsSimulatorUrl = "http://127.0.0.1:$LimsSimulatorPort/"
$limsSimulatorReadyUrl = "http://127.0.0.1:$LimsSimulatorPort/api/state"
$upperComputerSimulatorUrl = "http://127.0.0.1:$UpperComputerSimulatorPort/"
$frontendNetworkHost = if ([string]::IsNullOrWhiteSpace($FrontendNetworkHost)) { Resolve-PrimaryLanIpv4 } else { $FrontendNetworkHost.Trim() }
$frontendNetworkUrl = "http://${frontendNetworkHost}:$FrontendPort/"
$launcherSessionId = [Guid]::NewGuid().ToString("N")

if ($condaBat) {
    $backendReloadArgument = if ($Production) { "" } else { " --reload" }
    $backendCommand = "set `"MES_LAUNCHER_SESSION=$launcherSessionId`" && set `"RABBITMQ_ENABLED=true`" && set `"RABBITMQ_REQUIRED=true`" && set `"RABBITMQ_URL=$RabbitMqUrl`" && call `"$condaBat`" activate $CondaEnv && cd /d `"$ProjectRoot`" && python scripts\run_local.py$backendReloadArgument --host $BackendHost --port $BackendPort"
    $limsSimulatorCommand = "set `"MES_LAUNCHER_SESSION=$launcherSessionId`" && set `"RABBITMQ_URL=$RabbitMqUrl`" && call `"$condaBat`" activate $CondaEnv && cd /d `"$LimsSimulatorRoot`" && python -m uvicorn app:app --host $LimsSimulatorHost --port $LimsSimulatorPort"
} else {
    $backendCommand = "echo Unable to find conda.bat. Please install Anaconda/Miniconda or add conda to PATH. && echo Expected environment: $CondaEnv"
    $limsSimulatorCommand = "echo Unable to find conda.bat. LIMS simulator was not started."
}

$frontendWaitScript = @"
`$deadline = (Get-Date).AddSeconds($FrontendWaitTimeoutSeconds)
Write-Host "Waiting for backend: $backendReadyUrl"
do {
    try {
        `$response = Invoke-WebRequest -UseBasicParsing -Uri "$backendReadyUrl" -TimeoutSec 2
        if (`$response.StatusCode -ge 200 -and `$response.StatusCode -lt 300) {
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
$frontendCommand = "set `"MES_LAUNCHER_SESSION=$launcherSessionId`" && set `"FRONTEND_PUBLIC_URL=$frontendNetworkUrl`" && powershell.exe -NoProfile -ExecutionPolicy Bypass -EncodedCommand $encodedFrontendWait && cd /d `"$FrontendRoot`" && $frontendRunCommand"
$terminalCommandSwitch = if ($Production) { "/c" } else { "/k" }
$backendTerminalCommand = if ($Production) { "$backendCommand & exit /b 0" } else { $backendCommand }
$frontendTerminalCommand = if ($Production) { "$frontendCommand & exit /b 0" } else { $frontendCommand }
$limsSimulatorTerminalCommand = if ($Production) { "$limsSimulatorCommand & exit /b 0" } else { $limsSimulatorCommand }

$browserOpenScript = @"
`$deadline = (Get-Date).AddSeconds($BrowserWaitTimeoutSeconds)
Write-Host "Waiting for frontend: $frontendLocalUrl"
do {
    try {
        `$response = Invoke-WebRequest -UseBasicParsing -Uri "$frontendLocalUrl" -TimeoutSec 2
        `$limsResponse = Invoke-WebRequest -UseBasicParsing -Uri "$limsSimulatorReadyUrl" -TimeoutSec 2
        `$limsState = `$limsResponse.Content | ConvertFrom-Json
        if (`$response.StatusCode -ge 200 -and `$response.StatusCode -lt 300 -and `$limsResponse.StatusCode -ge 200 -and `$limsResponse.StatusCode -lt 300 -and `$limsState.connected) {
            Write-Host "Opening browser: $frontendNetworkUrl"
            Start-Process "$frontendNetworkUrl"
            Start-Process "$limsSimulatorUrl"
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
if (-not $windowsTerminal -and -not $Production) {
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
    Write-Host "LIMS simulator command:"
    Write-Host $limsSimulatorCommand
    Write-Host ""
    Write-Host "Network frontend URL:"
    Write-Host $frontendNetworkUrl
    Write-Host ""
    Write-Host "Open browser:"
    Write-Host ($(if ($DisableAutoOpenBrowser) { "disabled" } else { $browserOpenScript.Trim() }))
    exit 0
}

if ($Production) {
    # The desktop launcher must not depend on Windows Terminal's multi-tab
    # argument parser. Show only the MES backend/frontend consoles so operators
    # can inspect their logs; keep the LIMS simulator hidden in the background.
    if (-not $condaPython) { throw "Unable to find python.exe for conda environment: $CondaEnv" }

    $stateDirectory = if ($StateFile) { Split-Path -Parent $StateFile } else { Join-Path $env:LOCALAPPDATA "MesFastApiLauncher" }
    $logDirectory = Join-Path $stateDirectory "logs"
    New-Item -ItemType Directory -Force -Path $logDirectory | Out-Null

    $previousLauncherSession = $env:MES_LAUNCHER_SESSION
    $previousRabbitEnabled = $env:RABBITMQ_ENABLED
    $previousRabbitRequired = $env:RABBITMQ_REQUIRED
    $previousRabbitUrl = $env:RABBITMQ_URL
    try {
        $env:MES_LAUNCHER_SESSION = $launcherSessionId
        $env:RABBITMQ_ENABLED = "true"
        $env:RABBITMQ_REQUIRED = "true"
        $env:RABBITMQ_URL = $RabbitMqUrl
        $backendConsoleCommand = "chcp 65001 >nul && title MES Backend && set `"PYTHONUTF8=1`" && set `"PYTHONIOENCODING=utf-8`" && `"$condaPython`" scripts\run_local.py --host $BackendHost --port $BackendPort"
        $frontendConsoleCommand = "title MES Frontend && $frontendCommand"
        $backendProcess = Start-Process -FilePath $env:ComSpec -ArgumentList "/d", "/k", $backendConsoleCommand `
            -WorkingDirectory $ProjectRoot -PassThru
        $frontendProcess = Start-Process -FilePath $env:ComSpec -ArgumentList "/d", "/k", $frontendConsoleCommand `
            -WorkingDirectory $FrontendRoot -PassThru

        $limsSimulatorProcess = Start-Process -FilePath $condaPython `
            -ArgumentList "-m", "uvicorn", "app:app", "--host", $LimsSimulatorHost, "--port", $LimsSimulatorPort `
            -WorkingDirectory $LimsSimulatorRoot -WindowStyle Hidden -PassThru `
            -RedirectStandardOutput (Join-Path $logDirectory "lims.stdout.log") `
            -RedirectStandardError (Join-Path $logDirectory "lims.stderr.log")
    } finally {
        $env:MES_LAUNCHER_SESSION = $previousLauncherSession
        $env:RABBITMQ_ENABLED = $previousRabbitEnabled
        $env:RABBITMQ_REQUIRED = $previousRabbitRequired
        $env:RABBITMQ_URL = $previousRabbitUrl
    }
} elseif ($windowsTerminal) {
    $terminalProcess = Start-Process -FilePath $windowsTerminal.Source `
        -ArgumentList "-w", "new", "new-tab", "--title", '"MES Backend"', "cmd.exe", $terminalCommandSwitch, $backendTerminalCommand, ";", "new-tab", "--title", '"MES Frontend"', "cmd.exe", $terminalCommandSwitch, $frontendTerminalCommand, ";", "new-tab", "--title", '"MES LIMS Simulator"', "cmd.exe", $terminalCommandSwitch, $limsSimulatorTerminalCommand `
        -WorkingDirectory $ProjectRoot `
        -PassThru
    $backendProcess = $terminalProcess
    $frontendProcess = $terminalProcess
    $limsSimulatorProcess = $terminalProcess
} else {
    $backendProcess = Start-Process -FilePath "cmd.exe" -ArgumentList $terminalCommandSwitch, "title MES Backend && $backendTerminalCommand" -WorkingDirectory $ProjectRoot -PassThru
    $frontendProcess = Start-Process -FilePath "cmd.exe" -ArgumentList $terminalCommandSwitch, "title MES Frontend && $frontendTerminalCommand" -WorkingDirectory $FrontendRoot -PassThru
    $limsSimulatorProcess = Start-Process -FilePath "cmd.exe" -ArgumentList $terminalCommandSwitch, "title MES LIMS Simulator && $limsSimulatorTerminalCommand" -WorkingDirectory $LimsSimulatorRoot -PassThru
}
if ($StateFile) {
    $stateDirectory = Split-Path -Parent $StateFile
    if ($stateDirectory) { New-Item -ItemType Directory -Force -Path $stateDirectory | Out-Null }
    [pscustomobject]@{
        backendCommandPid = $backendProcess.Id
        frontendCommandPid = $frontendProcess.Id
        limsSimulatorCommandPid = $limsSimulatorProcess.Id
        browserPid = 0
        backendPort = $BackendPort
        frontendPort = $FrontendPort
        limsSimulatorPort = $LimsSimulatorPort
        upperComputerSimulatorPort = $UpperComputerSimulatorPort
        frontendLocalUrl = $frontendLocalUrl
        frontendUrl = $frontendNetworkUrl
        limsSimulatorUrl = $limsSimulatorUrl
        upperComputerSimulatorUrl = $upperComputerSimulatorUrl
        logDirectory = $(if ($Production) { $logDirectory } else { "" })
        launcherSessionId = $launcherSessionId
    } | ConvertTo-Json | Set-Content -LiteralPath $StateFile -Encoding UTF8
}
if (-not $DisableAutoOpenBrowser) {
    Start-Process -FilePath "powershell.exe" `
        -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand", $encodedBrowserOpen `
        -WorkingDirectory $ProjectRoot `
        -WindowStyle Hidden
}

Write-Host "Started MES backend, frontend, LIMS simulator, and backend-managed upper-computer service."
Write-Host "Backend:  http://localhost:$BackendPort"
Write-Host "Frontend: $frontendNetworkUrl"
Write-Host "LIMS simulator: $limsSimulatorUrl"
Write-Host "Upper-computer service: $upperComputerSimulatorUrl"
exit 0
