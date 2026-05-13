$ErrorActionPreference = "Stop"
$port = 5174
$server = Start-Process -PassThru -WindowStyle Hidden -FilePath rtk -ArgumentList @(
  "npm",
  "--prefix",
  "frontend",
  "run",
  "dev",
  "--",
  "--host",
  "127.0.0.1",
  "--port",
  "$port",
  "--strictPort"
) -WorkingDirectory (Get-Location).Path

try {
  $ready = $false
  for ($i = 0; $i -lt 60; $i++) {
    try {
      $response = Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$port/task-history" -TimeoutSec 2
      if ($response.StatusCode -eq 200) {
        $ready = $true
        break
      }
    } catch {
      Start-Sleep -Milliseconds 500
    }
  }
  if (-not $ready) {
    throw "Vite dev server did not become ready"
  }

  rtk npm exec --yes --package=playwright -- node .codex-preview/verify-task-history-overflow.mjs
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }
} finally {
  if ($server -and -not $server.HasExited) {
    Stop-Process -Id $server.Id -Force
  }
}
