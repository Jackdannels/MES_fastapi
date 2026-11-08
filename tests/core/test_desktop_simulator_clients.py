"""Three dedicated executables, real isolated simulator HTTP services, no broker."""
from contextlib import contextmanager
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import threading
import time
from urllib.request import urlopen

import pytest

ROOT = Path(__file__).resolve().parents[2]
PS = shutil.which("powershell.exe")
SDK = json.loads((ROOT / "tools/desktop-client/webview2-sdk.json").read_text(encoding="utf-8"))
PACKAGE = ROOT / f".tmp/desktop-client-sdk/microsoft.web.webview2.{SDK['version']}.nupkg"
ROLES = {
    "central": ("central-client", "MES中控管理.exe"),
    "lims": ("lims-client", "MES_LIMS模拟器.exe"),
    "upper-computer": ("upper-client", "MES上位机模拟器.exe"),
}
pytestmark = pytest.mark.skipif(not PS or not PACKAGE.exists(), reason="Windows and pinned WebView2 SDK cache required")


def invoke(exe, config, action, timeout=25):
    return subprocess.run([str(exe), "--config", str(config), action], capture_output=True,
        text=True, encoding="utf-8", errors="replace", timeout=timeout)


def status(exe, config):
    reply = invoke(exe, config, "--status")
    assert reply.returncode == 0, reply.stderr
    return json.loads(reply.stdout)


def wait_ready(exe, config, title=None, api_calls=0, process=None):
    deadline = time.monotonic() + 35
    value = {}
    while time.monotonic() < deadline:
        if process:
            assert process.poll() is None, process.communicate()
        value = status(exe, config)
        if (value.get("state") == "ready" and (not title or value.get("documentTitle") == title)
                and value.get("apiSuccessCount", 0) >= api_calls):
            return value
        time.sleep(0.1)
    pytest.fail(f"Client did not become ready ({exe.name}): {value}")


@pytest.fixture(scope="module")
def desktop_bundle(tmp_path_factory):
    output = tmp_path_factory.mktemp("three-native-clients") / "desktop tools"
    reply = subprocess.run([PS, "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(ROOT / "scripts/build_desktop_tools.ps1"),
        "-OutputDirectory", str(output), "-IncludeAllClients", "-SdkPackagePath", str(PACKAGE), "-Offline"],
        capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=50)
    assert reply.returncode == 0, reply.stdout + reply.stderr
    return output


@pytest.fixture(scope="module")
def local_services(tmp_path_factory):
    directory = tmp_path_factory.mktemp("isolated-simulator-services")
    import sys
    processes = []
    urls = {}
    try:
        for role, module in [("lims", "tools.lims_simulator.app:app"), ("upper-computer", "tools.upper_computer_simulator.app:app")]:
            with socket.socket() as reservation:
                reservation.bind(("127.0.0.1", 0))
                port = reservation.getsockname()[1]
            env = {**os.environ, "SIMULATOR_AUTO_CONNECT": "false", "LIMS_HTTP_TOKEN": "",
                   "LIMS_SEQUENCE_PATH": str(directory / "sequence.sqlite3"), "LIMS_INBOX_PATH": str(directory / "inbox.sqlite3")}
            log = (directory / f"{role}.log").open("wb")
            process = subprocess.Popen([sys.executable, "-m", "uvicorn", module, "--host", "127.0.0.1", "--port", str(port),
                "--lifespan", "off", "--log-level", "warning"], cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT)
            processes.append((process, log))
            urls[role] = f"http://127.0.0.1:{port}"
            deadline = time.monotonic() + 15
            while time.monotonic() < deadline:
                assert process.poll() is None, (directory / f"{role}.log").read_text(errors="replace")
                try:
                    with urlopen(urls[role] + "/api/state", timeout=1) as response:
                        assert json.load(response)["connected"] is False
                    break
                except OSError:
                    time.sleep(0.1)
            else:
                pytest.fail(f"Isolated {role} service did not start")
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                body = b'<html><head><title>MES local central fixture</title></head><body>Isolated central client lifecycle test</body></html>'
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            def log_message(self, *_):
                pass
        central = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=central.serve_forever, daemon=True)
        thread.start()
        urls["central"] = f"http://127.0.0.1:{central.server_port}"
        try:
            yield urls
        finally:
            central.shutdown()
            central.server_close()
            thread.join(timeout=3)
    finally:
        for process, log in processes:
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
            log.close()


@contextmanager
def opened(exe, config):
    process = subprocess.Popen([str(exe), "--config", str(config), "--test-hidden"], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
        yield process
    finally:
        reply = invoke(exe, config, "--close")
        assert reply.returncode == 0, reply.stderr
        process.wait(timeout=20)
        assert process.returncode == 0, process.communicate()


@pytest.mark.parametrize("role,title,api_calls", [("lims", "MES LIMS 模拟器", 3), ("upper-computer", "MES 上位机模拟器", 3)])
def test_actual_simulator_page_scripts_and_polling_work_in_dedicated_exe(desktop_bundle, local_services, tmp_path, role, title, api_calls):
    folder, name = ROLES[role]
    exe = desktop_bundle / folder / name
    config = tmp_path / "isolated-client.json"
    config.write_text(json.dumps({"module": role, "serverUrl": local_services[role], "downloadDirectory": str(tmp_path / "downloads")}), encoding="utf-8")
    with opened(exe, config) as process:
        first = wait_ready(exe, config, title, api_calls, process)
        assert first["module"] == role
        assert first["borderless"] is False and first["windowState"] == "Maximized"
        assert first["pageErrors"] == 0 and first["apiFailureCount"] == 0
        deadline = time.monotonic() + 8
        while time.monotonic() < deadline:
            after = status(exe, config)
            if after["apiSuccessCount"] > first["apiSuccessCount"]:
                break
            time.sleep(0.1)
        assert after["apiSuccessCount"] > first["apiSuccessCount"]
        repeated = subprocess.run([str(exe), "--config", str(config), "--test-hidden"], capture_output=True, timeout=15)
        assert repeated.returncode == 0, repeated.stderr
        assert status(exe, config)["pid"] == process.pid
        assert invoke(exe, config, "--reload").returncode == 0
        assert wait_ready(exe, config, title, process=process)["pageErrors"] == 0
    with urlopen(local_services[role] + "/api/state", timeout=2) as response:
        assert json.load(response)["connected"] is False, "Closing the window must not connect or stop the simulator service"


@pytest.mark.parametrize("role", ["lims", "upper-computer"])
def test_simulator_executable_rejects_another_role_configuration(desktop_bundle, tmp_path, role):
    folder, name = ROLES[role]
    config = tmp_path / "wrong-role.json"
    config.write_text(json.dumps({"serverUrl": "http://127.0.0.1:5173", "module": "central"}), encoding="utf-8")
    assert invoke(desktop_bundle / folder / name, config, "--validate-config").returncode == 8


def test_three_roles_can_use_the_same_config_path_without_sharing_an_instance(desktop_bundle, local_services, tmp_path):
    config = tmp_path / "address-only.json"
    config.write_text(json.dumps({"serverUrl": local_services["central"]}), encoding="utf-8")
    from contextlib import ExitStack
    with ExitStack() as stack:
        states = []
        for role, (folder, name) in ROLES.items():
            exe = desktop_bundle / folder / name
            process = stack.enter_context(opened(exe, config))
            states.append(wait_ready(exe, config, process=process))
        assert {state["module"] for state in states} == set(ROLES)
        assert len({state["pid"] for state in states}) == 3
        assert len({state["browserPid"] for state in states}) == 3


def test_controller_start_restart_stop_manages_three_real_clients_and_keeps_unrelated_instance(desktop_bundle, local_services, tmp_path):
    settings = json.loads((desktop_bundle / "mes-desktop-tools.json").read_text(encoding="utf-8-sig"))
    settings.update(serverUrl=local_services["central"], limsUrl=local_services["lims"], upperComputerUrl=local_services["upper-computer"])
    (desktop_bundle / "mes-desktop-tools.json").write_text(json.dumps(settings), encoding="utf-8-sig")
    clients = {}
    for role, (folder, name) in ROLES.items():
        config = desktop_bundle / folder / "mes-client.json"
        config.write_text(json.dumps({"module": role, "serverUrl": local_services[role], "downloadDirectory": str(tmp_path / role)}), encoding="utf-8")
        clients[role] = (desktop_bundle / folder / name, config)
    controller = tmp_path / "docker-service-control.ps1"
    controller.write_text('''param([string]$Action,[string]$ResultFile,[switch]$NoOpen)
$ErrorActionPreference='Stop'
if($Action -in @('Start','Restart') -and -not $NoOpen) { throw 'Native launch must suppress default browser open' }
$settings=Get-Content -Raw -Encoding UTF8 -LiteralPath $env:MES_CLIENT_SETTINGS_TEST | ConvertFrom-Json
$state=if($Action -eq 'Stop'){'stopped'}elseif($Action -eq 'Restart'){'restarted'}else{'started'}
if($Action -eq 'Stop' -and (Test-Path -LiteralPath $env:MES_CLIENT_FAIL_STOP_TEST)) { $state='error' }
@{status=$state;message='isolated-fixture';pageUrls=@(($settings.serverUrl+'/'),($settings.limsUrl+'/'),($settings.upperComputerUrl+'/'))} | ConvertTo-Json -Compress | Set-Content -LiteralPath $ResultFile -Encoding UTF8
''', encoding="utf-8-sig")
    runner = tmp_path / "invoke-control.ps1"
    runner.write_text('''param([string]$Executable,[string]$Controller,[string]$Action,[string]$Output)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
$assembly=[Reflection.Assembly]::LoadFrom($Executable)
$type=$assembly.GetType('MESControlCenter.ControlCenterForm',$true)
$flags=[Reflection.BindingFlags]'Instance,NonPublic'
$form=$type.GetConstructor($flags,$null,[Type[]]@([string],[bool]),$null).Invoke([object[]]@($Controller,$false))
try { [IO.File]::WriteAllText($Output,[string]$type.GetMethod('RunControl',$flags).Invoke($form,@($Action))) } finally { $form.Dispose() }
''', encoding="utf-8-sig")
    fail_stop = tmp_path / "fail-stop"
    env = {**os.environ, "MES_DESKTOP_TEST_HIDDEN": "1", "MES_CLIENT_SETTINGS_TEST": str(desktop_bundle / "mes-desktop-tools.json"), "MES_CLIENT_FAIL_STOP_TEST": str(fail_stop)}
    def run(action):
        output = tmp_path / "control-result.json"
        log = tmp_path / "control-runner.log"
        with log.open("wb") as stream:
            result = subprocess.run([PS, "-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-File", str(runner),
                "-Executable", str(desktop_bundle / "MES控制中心_Docker版.exe"), "-Controller", str(controller), "-Action", action, "-Output", str(output)],
                env=env, stdout=stream, stderr=subprocess.STDOUT, timeout=65)
        assert result.returncode == 0, log.read_text(encoding="utf-8-sig", errors="replace")
        payload = json.loads(output.read_text(encoding="utf-8-sig"))
        assert payload["message"] == "isolated-fixture", payload
        return payload
    other_config = tmp_path / "unrelated-central.json"
    other_config.write_text(json.dumps({"module": "central", "serverUrl": local_services["central"]}), encoding="utf-8")
    with opened(clients["central"][0], other_config) as other:
        wait_ready(clients["central"][0], other_config, process=other)
        try:
            assert run("Start")["status"] == "started"
            first = {role: wait_ready(exe, config) for role, (exe, config) in clients.items()}
            assert len({state["pid"] for state in first.values()}) == 3
            assert run("Start")["status"] == "started"
            assert {role: status(exe, config)["pid"] for role, (exe, config) in clients.items()} == {role: value["pid"] for role, value in first.items()}
            fail_stop.touch()
            assert run("Stop")["status"] == "error"
            assert all(status(exe, config)["state"] == "ready" for exe, config in clients.values())
            fail_stop.unlink()
            assert run("Restart")["status"] == "restarted"
            second = {role: wait_ready(exe, config) for role, (exe, config) in clients.items()}
            assert all(first[role]["pid"] != second[role]["pid"] for role in ROLES)
            assert run("Stop")["status"] == "stopped"
            assert all(status(exe, config)["state"] == "stopped" for exe, config in clients.values())
            assert run("Stop")["status"] == "stopped"
            assert status(clients["central"][0], other_config)["pid"] == other.pid
            for role in ["lims", "upper-computer"]:
                with urlopen(local_services[role] + "/api/state", timeout=2) as response:
                    assert json.load(response)["connected"] is False
        finally:
            if fail_stop.exists():
                fail_stop.unlink()
            run("Stop")
            for exe, config in clients.values():
                assert invoke(exe, config, "--close").returncode == 0
