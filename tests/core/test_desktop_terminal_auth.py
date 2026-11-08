"""Native automatic terminal authentication using isolated HTTP credentials."""
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import subprocess
import threading
import time
from urllib.parse import urlsplit, parse_qs

import pytest

from test_desktop_workstation_clients import STATIONS, station_client, workstations
from test_desktop_simulator_clients import invoke, opened, status, wait_ready


@pytest.fixture
def terminal_server():
    class Handler(BaseHTTPRequestHandler):
        def send_json(self, code, value):
            data = json.dumps(value).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_POST(self):
            data = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            self.server.actions.append(self.path)
            if self.path == "/auth/terminal/register":
                if (data.get("username"), data.get("password")) != ("fixture-admin", "fixture-password"):
                    self.send_json(401, {"detail": "invalid"})
                    return
                target = "/laboratory?lab=" + self.server.lab_code if data["module"] == "laboratory" else self.server.entry_path
                self.server.binding = {**data, "secret": "fixture-terminal-secret", "target": target}
                self.send_json(200, dict(terminalId=data["terminal_id"], terminalSecret="fixture-terminal-secret",
                    module=data["module"], labName=data["lab_name"], target=target))
            elif self.path == "/auth/terminal/ticket":
                binding = self.server.binding
                if self.server.rejected or not binding or data != {"terminal_id": binding["terminal_id"], "terminal_secret": binding["secret"]}:
                    self.send_json(401, {"detail": "revoked"})
                else:
                    self.send_json(200, dict(ticket="isolated-ticket", target="/wrong-room" if self.server.wrong_target else binding["target"]))
            else:
                self.send_json(404, {})

        def do_GET(self):
            self.server.actions.append(urlsplit(self.path).path)
            if self.path.startswith("/auth/terminal/consume"):
                assert parse_qs(urlsplit(self.path).query)["ticket"] == ["isolated-ticket"]
                self.send_response(302)
                self.send_header("Location", self.server.binding["target"])
                self.end_headers()
                return
            body = b'<html><head><title>authenticated-workstation</title></head><body>Authenticated fixture</body></html>'
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *_):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    server.binding = None
    server.actions = []
    server.rejected = False
    server.wrong_target = False
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield server
    server.shutdown()
    server.server_close()
    thread.join(timeout=3)


def configure(tmp_path, station, server):
    server.lab_code = station["labCode"]
    routes = {"visual": "/visualization", "handover": "/handover-system", "staging": "/staging-management", "appearance": "/appearance-inspection"}
    server.entry_path = routes.get(station["module"], "/laboratory?lab=" + station["labCode"])
    config = tmp_path / "auth-client.json"
    config.write_text(json.dumps({"serverUrl": f"http://127.0.0.1:{server.server_port}", "autoLogin": True}), encoding="utf-8")
    return config


def enroll(exe, config, password="fixture-password"):
    return subprocess.run([str(exe), "--config", str(config), "--enroll-terminal"],
        input=json.dumps({"username": "fixture-admin", "password": password}), capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=20)


@pytest.mark.parametrize("station", STATIONS, ids=lambda s: s["labCode"] or s["module"])
def test_all_workstations_automatically_consume_bound_terminal_tickets(workstations, tmp_path, terminal_server, station):
    exe, _ = station_client(workstations, station)
    config = configure(tmp_path, station, terminal_server)
    result = enroll(exe, config)
    assert result.returncode == 0, result.stderr
    assert "fixture-password" not in result.stdout + result.stderr
    with opened(exe, config) as process:
        state = wait_ready(exe, config, "authenticated-workstation", process=process)
        assert state["currentPath"] == terminal_server.entry_path.split("?")[0]
        assert state["autoLogin"] is True and not state["headerVisible"]
    assert terminal_server.actions[:3] == ["/auth/terminal/register", "/auth/terminal/ticket", "/auth/terminal/consume"]
    assert "/auth/login" not in terminal_server.actions
    assert "fixture-password" not in config.read_text()
    with opened(exe, config) as process:
        wait_ready(exe, config, "authenticated-workstation", process=process)
    assert terminal_server.actions.count("/auth/terminal/register") == 1
    assert terminal_server.actions.count("/auth/terminal/ticket") == 2


@pytest.mark.parametrize("failure", ["missing", "revoked", "wrong-target"])
def test_failed_binding_never_falls_back_to_admin_or_another_workstation(workstations, tmp_path, terminal_server, failure):
    station = STATIONS[0]
    exe, _ = station_client(workstations, station)
    config = configure(tmp_path, station, terminal_server)
    if failure != "missing":
        assert enroll(exe, config).returncode == 0
    terminal_server.rejected = failure == "revoked"
    terminal_server.wrong_target = failure == "wrong-target"
    with opened(exe, config):
        deadline = time.monotonic() + 12
        while time.monotonic() < deadline:
            state = status(exe, config)
            if state.get("state") == "reconnecting":
                break
            time.sleep(.1)
        assert state["state"] == "reconnecting"
        assert state["documentTitle"] != "authenticated-workstation"
        assert "/auth/login" not in terminal_server.actions and "/auth/terminal/consume" not in terminal_server.actions


def test_bad_admin_credential_cannot_enroll_and_is_not_printed(workstations, tmp_path, terminal_server):
    exe, _ = station_client(workstations, STATIONS[0])
    config = configure(tmp_path, STATIONS[0], terminal_server)
    result = enroll(exe, config, "deliberately-invalid-password")
    assert result.returncode == 8
    assert "deliberately-invalid-password" not in result.stdout + result.stderr


def test_local_terminal_secret_is_encrypted_and_cannot_be_reused_by_another_installation(workstations, tmp_path, terminal_server):
    station = STATIONS[0]
    exe, _ = station_client(workstations, station)
    config = configure(tmp_path, station, terminal_server)
    assert enroll(exe, config).returncode == 0
    script = tmp_path / "identity-directory.ps1"
    script.write_text('''param([string]$Executable,[string]$Config)
$assembly=[Reflection.Assembly]::LoadFrom($Executable)
$type=$assembly.GetType('MESDesktopClient.ClientConfiguration',$true)
$static=[Reflection.BindingFlags]'Static,NonPublic'
$instance=[Reflection.BindingFlags]'Instance,NonPublic'
$settings=$type.GetMethod('Load',$static).Invoke($null,[object[]]@([string[]]@('--config',$Config),$false))
Write-Output $type.GetField('DataDirectory',$instance).GetValue($settings)
''', encoding="utf-8")
    def data_directory(selected):
        result = subprocess.run(["powershell.exe", "-NoProfile", "-File", str(script), "-Executable", str(exe), "-Config", str(selected)], capture_output=True, text=True, timeout=15)
        assert result.returncode == 0, result.stderr
        return Path(result.stdout.strip())
    encrypted = (data_directory(config) / "terminal-identity.bin").read_bytes()
    assert b"fixture-terminal-secret" not in encrypted and b"fixture-password" not in encrypted
    other = tmp_path / "other-install.json"
    other.write_bytes(config.read_bytes())
    other_directory = data_directory(other)
    other_directory.mkdir(parents=True, exist_ok=True)
    (other_directory / "terminal-identity.bin").write_bytes(encrypted)
    with opened(exe, other):
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            state = status(exe, other)
            if state.get("state") == "reconnecting":
                break
            time.sleep(.1)
        assert state["state"] == "reconnecting"
        assert "/auth/terminal/ticket" not in terminal_server.actions
