"""Dedicated workstation builds against isolated HTTP pages; no live MES writes."""
from contextlib import ExitStack
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import threading

import pytest

from test_desktop_simulator_clients import invoke, opened, status, wait_ready

ROOT = Path(__file__).resolve().parents[2]
PS = shutil.which("powershell.exe")
STATIONS = json.loads((ROOT / "tools/desktop-client/workstations.json").read_text(encoding="utf-8"))
pytestmark = pytest.mark.skipif(not PS, reason="Windows WebView2 required")


@pytest.fixture(scope="module")
def workstations(tmp_path_factory):
    output = tmp_path_factory.mktemp("workstation-clients") / "clients"
    result = subprocess.run([PS, "-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
        str(ROOT / "scripts/build_workstation_clients.ps1"), "-OutputDirectory", str(output), "-Offline"],
        capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=90)
    assert result.returncode == 0, result.stdout + result.stderr
    return output


@pytest.fixture(scope="module")
def site():
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            body = b'''<html data-theme="light"><head><script>
const c=window.__MES_DESKTOP__||{};
document.title=c.module+':'+c.labCode+':'+c.labName;
localStorage.setItem('own-room',c.labCode||c.module);
</script></head><body>Isolated workstation fixture</body></html>'''
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *_):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{server.server_port}"
    server.shutdown()
    server.server_close()
    thread.join(timeout=3)


def station_client(bundle, station):
    folder = bundle / station["folder"]
    manifest = json.loads((folder / "client-manifest.json").read_text(encoding="utf-8-sig"))
    return folder / manifest["executable"], folder / "mes-client.json"


def test_inventory_has_fifteen_self_contained_clients_and_verified_hashes(workstations):
    manifest = json.loads((workstations / "workstations-manifest.json").read_text(encoding="utf-8"))
    assert manifest["format"] == "mes-workstation-clients"
    assert len(manifest["workstations"]) == 15
    assert len([s for s in manifest["workstations"] if s["module"] == "laboratory"]) == 11
    assert {s["folder"] for s in manifest["workstations"]} == {s["folder"] for s in STATIONS}
    for entry in manifest["files"]:
        assert hashlib.sha256((workstations / entry["path"]).read_bytes()).hexdigest() == entry["sha256"]
    for station in STATIONS:
        exe, config = station_client(workstations, station)
        reply = invoke(exe, config, "--validate-config")
        assert reply.returncode == 0, reply.stderr
        data = json.loads(reply.stdout)
        assert data["module"] == station["module"]
        assert data["labCode"] == station["labCode"] and data["labName"] == station["labName"]
        assert data["startMaximized"] is True
        for name in ["Microsoft.Web.WebView2.Core.dll", "Microsoft.Web.WebView2.WinForms.dll", "WebView2Loader.dll", exe.name + ".config"]:
            assert (exe.parent / name).is_file()


@pytest.mark.parametrize("station", STATIONS, ids=lambda s: s["labCode"] or s["module"])
def test_every_workstation_starts_real_webview_with_its_compiled_room(workstations, site, tmp_path, station):
    exe, _ = station_client(workstations, station)
    config = tmp_path / "client.json"
    config.write_text(json.dumps({"serverUrl": site, "module": station["module"], "autoLogin": False}), encoding="utf-8")
    with opened(exe, config) as process:
        title = f"{station['module']}:{station['labCode']}:{station['labName']}"
        state = wait_ready(exe, config, title=title, process=process)
        assert state["module"] == station["module"]
        assert state["labCode"] == station["labCode"] and state["labName"] == station["labName"]
        assert state["version"] == "1.7.0"
        assert state["fullScreen"] is (station["module"] != "visual")
        assert state["borderless"] is state["fullScreen"]
        if state["fullScreen"]:
            assert state["windowBounds"] == state["screenBounds"]
        else:
            assert state["windowState"] == "Maximized"
        assert not state["tabsVisible"] and state["headerControlCount"] == 0 and not state["headerVisible"]
        assert state["currentPath"] == state["entryPath"].split("?")[0]
        assert state["pageErrors"] == 0
        if station["module"] == "laboratory":
            assert state["entryPath"] == "/laboratory?lab=" + station["labCode"]
        repeated = subprocess.run([str(exe), "--config", str(config), "--test-hidden"], capture_output=True, timeout=15)
        assert repeated.returncode == 0, repeated.stderr
        assert status(exe, config)["pid"] == process.pid


def test_room_builds_do_not_share_instances_even_with_the_same_config_file(workstations, site, tmp_path):
    config = tmp_path / "address-only.json"
    config.write_text(json.dumps({"serverUrl": site, "autoLogin": False}), encoding="utf-8")
    with ExitStack() as stack:
        states = []
        for station in STATIONS[:2]:
            exe, _ = station_client(workstations, station)
            process = stack.enter_context(opened(exe, config))
            states.append(wait_ready(exe, config, process=process))
        assert len({state["pid"] for state in states}) == 2
        assert len({state["browserPid"] for state in states}) == 2
        assert len({state["labCode"] for state in states}) == 2


@pytest.mark.parametrize("override", [{"module": "central"}, {"labCode": "LAB_SALT"}, {"labName": "盐雾试验室"}])
def test_room_exe_rejects_identity_changes(workstations, tmp_path, override):
    exe, _ = station_client(workstations, STATIONS[0])
    config = tmp_path / "wrong.json"
    config.write_text(json.dumps({"serverUrl": "http://127.0.0.1:5173", **override}), encoding="utf-8")
    assert invoke(exe, config, "--validate-config").returncode == 8


def test_existing_output_is_rejected_without_changing_settings(workstations):
    config = workstations / STATIONS[0]["folder"] / "mes-client.json"
    original = config.read_bytes()
    result = subprocess.run([PS, "-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
        str(ROOT / "scripts/build_workstation_clients.ps1"), "-OutputDirectory", str(workstations), "-Offline"],
        capture_output=True, timeout=15)
    assert result.returncode != 0
    assert config.read_bytes() == original


@pytest.mark.parametrize("station", [STATIONS[0], *STATIONS[11:]], ids=lambda s: s["module"])
def test_each_new_role_confirms_window_close_and_preserves_page_on_cancel(workstations, site, tmp_path, station):
    exe, _ = station_client(workstations, station)
    config = tmp_path / "guard.json"
    config.write_text(json.dumps({"serverUrl": site, "autoLogin": False}), encoding="utf-8")
    result = subprocess.run([PS, "-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-File",
        str(ROOT / "tests/desktop-client/Test-WorkstationExit.ps1"), "-Executable", str(exe), "-Config", str(config)],
        capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=35)
    assert result.returncode == 0, result.stdout + result.stderr
    assert "cancel-preserved-page;confirm-exited" in result.stdout
