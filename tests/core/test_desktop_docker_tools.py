import json
import os
from pathlib import Path
import shutil
import subprocess
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import threading

import pytest

ROOT = Path(__file__).resolve().parents[2]
PS = shutil.which("powershell.exe") or shutil.which("powershell")
SCRIPT = ROOT / "scripts/client/docker-service-control.ps1"
pytestmark = pytest.mark.skipif(not PS, reason="Windows PowerShell required")


def invoke(*args, env=None):
    config = Path(args[args.index("-ConfigurationFile") + 1])
    controller = config.parent / "tool/scripts/docker-service-control.ps1"
    controller.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(SCRIPT, controller)
    return subprocess.run([PS, "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(controller), *map(str, args)],
                          cwd=ROOT, capture_output=True, text=True, encoding="utf-8", errors="replace", env=env, check=False)


@pytest.fixture
def deployment(tmp_path):
    release = tmp_path / "release with spaces"
    (release / "scripts/deploy").mkdir(parents=True)
    (release / "portable.env").write_text("COMPOSE_PROJECT_NAME=test-only\n", encoding="utf-8")
    (release / "compose.portable.yml").write_text("services: {}\n", encoding="utf-8")
    entry = release / "scripts/deploy/Mes-Portable.ps1"
    entry.write_text(
        'param([string]$Action,[string]$EnvFile,[string]$Mode)\n'
        'if (-not (Test-Path -LiteralPath $EnvFile)) { exit 5 }\n'
        'Add-Content -LiteralPath $env:MES_DESKTOP_TEST_LOG -Value ($Action + ":" + $Mode)\n'
        'if ($env:MES_DESKTOP_TEST_FAIL -eq "true") { exit 4 }\n', encoding="utf-8-sig")
    configuration = tmp_path / "desktop.json"
    configuration.write_text(json.dumps({"deploymentDirectory": str(release), "environmentFile": "portable.env",
                                         "mode": "demo", "serverUrl": "http://127.0.0.1:15173",
                                         "apiUrl": "http://127.0.0.1:18000", "limsUrl": "http://127.0.0.1:18900",
                                         "upperComputerUrl": "http://127.0.0.1:18899"}), encoding="utf-8")
    log = tmp_path / "actions.txt"
    env = {**os.environ, "MES_DESKTOP_TEST_LOG": str(log)}
    return configuration, log, env


@pytest.mark.parametrize("action,expected", [("Start", ["Start:demo"]), ("Stop", ["Stop:demo"]),
                                             ("Restart", ["Stop:demo", "Start:demo"])])
def test_desktop_control_uses_selected_deployment_without_restore(deployment, tmp_path, action, expected):
    configuration, log, env = deployment
    result_file = tmp_path / "result.json"
    result = invoke("-Action", action, "-ConfigurationFile", configuration, "-ResultFile", result_file, env=env)
    assert result.returncode == 0, result.stderr
    assert log.read_text().splitlines() == expected
    assert json.loads(result_file.read_text(encoding="utf-8"))["status"] in {"started", "stopped", "restarted"}


def test_desktop_validation_never_runs_service_actions(deployment, tmp_path):
    configuration, log, env = deployment
    result_file = tmp_path / "result.json"
    result = invoke("-Action", "Restart", "-ValidateOnly", "-ConfigurationFile", configuration,
                    "-ResultFile", result_file, env=env)
    assert result.returncode == 0, result.stderr
    assert not log.exists()
    assert json.loads(result_file.read_text(encoding="utf-8"))["status"] == "validated"


def test_failed_stop_does_not_proceed_to_start(deployment, tmp_path):
    configuration, log, env = deployment
    env["MES_DESKTOP_TEST_FAIL"] = "true"
    result_file = tmp_path / "result.json"
    result = invoke("-Action", "Restart", "-ConfigurationFile", configuration, "-ResultFile", result_file, env=env)
    assert result.returncode != 0
    assert log.read_text().splitlines() == ["Stop:demo"]
    assert json.loads(result_file.read_text(encoding="utf-8"))["status"] == "error"


def test_compiled_workstation_registration_uses_entered_docker_credentials(tmp_path):
    output = tmp_path / "desktop-tools"
    build = subprocess.run([PS, "-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
                            str(ROOT / "scripts/build_desktop_tools.ps1"), "-OutputDirectory", str(output)],
                           capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=30)
    assert build.returncode == 0, build.stdout + build.stderr
    requests = []

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            requests.append((self.path, json.loads(self.rfile.read(int(self.headers["Content-Length"])))))
            payload = json.dumps({"terminalSecret": "test-terminal-secret-only"}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def log_message(self, *_args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    script = tmp_path / "registration.ps1"
    script.write_text('''param([string]$Executable,[string]$Url)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
$assembly=[Reflection.Assembly]::LoadFrom($Executable)
$flags=[Reflection.BindingFlags]'Static,NonPublic'
$fields=[Reflection.BindingFlags]'Instance,NonPublic,Public'
$type=$assembly.GetType('MESWorkstationConfigurator.LauncherRuntime',$true)
$configType=$assembly.GetType('MESWorkstationConfigurator.LauncherConfig',$true)
$config=[Activator]::CreateInstance($configType)
$config.ServerUrl=$Url
$timer=New-Object System.Windows.Forms.Timer
$timer.Interval=100
$timer.Add_Tick({
    foreach($form in [System.Windows.Forms.Application]::OpenForms) {
        if($form.GetType().Name -eq 'RegistrationLoginForm') {
            $timer.Stop()
            $form.GetType().GetField('Username',$fields).GetValue($form).Text='docker-admin'
            $form.GetType().GetField('Password',$fields).GetValue($form).Text='entered-docker-password'
            $form.DialogResult=[System.Windows.Forms.DialogResult]::OK
            break
        }
    }
})
$timer.Start()
try {
    $type.GetMethod('EnsureTerminalRegistration',$flags).Invoke($null,@($config))
    if(-not $config.ProtectedTerminalSecret) { throw 'Registration did not save a terminal secret in memory' }
} finally { $timer.Dispose() }
''', encoding="utf-8-sig")
    try:
        result = subprocess.run([PS, "-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-File", str(script),
                                 "-Executable", str(output / "MES工作台设置_Docker版.exe"),
                                 "-Url", f"http://127.0.0.1:{server.server_port}"],
                                capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=20)
        assert result.returncode == 0, result.stdout + result.stderr
        assert len(requests) == 1
        path, payload = requests[0]
        assert path == "/auth/terminal/register"
        assert payload["username"] == "docker-admin"
        assert payload["password"] == "entered-docker-password"
        assert payload["module"] == "handover"
    finally:
        server.shutdown()
        server.server_close()
