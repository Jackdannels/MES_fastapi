"""Compiled WinForms/WebView2 acceptance against isolated localhost fixtures."""
import hashlib
import ctypes
from ctypes import wintypes
import json
import os
from pathlib import Path
import shutil
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

ROOT = Path(__file__).resolve().parents[2]
PS = shutil.which("powershell.exe")
SDK = json.loads((ROOT / "tools/desktop-client/webview2-sdk.json").read_text(encoding="utf-8"))
PACKAGE = ROOT / f".tmp/desktop-client-sdk/microsoft.web.webview2.{SDK['version']}.nupkg"
pytestmark = pytest.mark.skipif(not PS or not PACKAGE.exists(), reason="Windows and the pinned WebView2 SDK cache required; run build_desktop_client.ps1 first")


@pytest.fixture(scope="module")
def bundle(tmp_path_factory):
    output = tmp_path_factory.mktemp("desktop-client") / "client"
    result = subprocess.run([PS, "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(ROOT / "scripts/build_desktop_client.ps1"),
        "-OutputDirectory", str(output), "-SdkPackagePath", str(PACKAGE), "-Offline"], capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=45)
    assert result.returncode == 0, result.stdout + result.stderr
    return output


@pytest.fixture
def site_server():
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path == "/export.csv":
                body = b"row,value\n1,2\n"
                self.send_response(200)
                self.send_header("Content-Type", "text/csv")
                self.send_header("Content-Disposition", 'attachment; filename="export.csv"')
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            body = b"<html><head><script>document.title=(window.__MES_DESKTOP__||{}).module+':desktop-fixture';</script></head><body>MES local fixture</body></html>"
            if self.server.page_kind == "download":
                body = b'<html><head><title>download-fixture</title></head><body><script>let a=document.createElement("a");a.href="/export.csv";a.download="export.csv";document.body.append(a);a.click();</script></body></html>'
            elif self.server.page_kind == "external":
                body = b'<html><head><title>external-fixture</title></head><body><script>setTimeout(()=>{window.open("http://127.0.0.1:9/","_blank");location.href="http://127.0.0.1:9/";},50);</script></body></html>'
            elif self.server.page_kind == "light":
                body = b'<html data-theme="light"><head><title>light-theme-fixture</title></head><body>Light theme</body></html>'
            elif self.server.page_kind == "dark":
                body = b'<html data-theme="dark"><head><title>dark-theme-fixture</title></head><body>Dark theme</body></html>'
            elif self.server.page_kind == "host-info":
                body = b'<html><head><script>window.chrome.webview.addEventListener("message",e=>{if(e.data.type==="mes-client-host-info")document.title=e.data.version+":"+Array.isArray(e.data.localIpAddresses);});window.chrome.webview.postMessage("mes-client-host-info-request");</script></head><body>Host info</body></html>'
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *_):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    server.page_kind = "normal"
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield server
    server.shutdown()
    server.server_close()
    thread.join(timeout=3)


@pytest.fixture
def site(site_server):
    return f"http://127.0.0.1:{site_server.server_port}"


def command(bundle, config, action, timeout=25):
    return subprocess.run([str(bundle / "MES中控管理.exe"), "--config", str(config), action], capture_output=True,
        text=True, encoding="utf-8", errors="replace", timeout=timeout)


@pytest.fixture
def client(bundle, site, tmp_path):
    config = tmp_path / "workstation.json"
    config.write_text(json.dumps({"serverUrl": site, "module": "central", "fullScreen": True, "downloadDirectory": str(tmp_path / "downloads")}), encoding="utf-8")
    process = subprocess.Popen([str(bundle / "MES中控管理.exe"), "--config", str(config), "--test-hidden"],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    yield process, config
    result = command(bundle, config, "--close")
    assert result.returncode == 0, result.stderr
    process.wait(timeout=20)
    assert process.returncode == 0


def ready(bundle, process, config, expected="ready"):
    deadline = time.monotonic() + 30
    last = None
    while time.monotonic() < deadline:
        assert process.poll() is None, process.communicate()
        result = command(bundle, config, "--status")
        if result.returncode == 0:
            last = json.loads(result.stdout)
            if (expected is None and last.get("pid")) or last.get("state") == expected:
                return last
        time.sleep(0.1)
    pytest.fail(f"Client did not reach {expected}: {last}")


def test_bundle_inventory_and_runtime_files(bundle):
    manifest = json.loads((bundle / "client-manifest.json").read_text(encoding="utf-8"))
    assert manifest["sdkVersion"] == SDK["version"]
    assert manifest["module"] == "central"
    for entry in manifest["files"]:
        assert hashlib.sha256((bundle / entry["path"]).read_bytes()).hexdigest() == entry["sha256"]
    assert {"Microsoft.Web.WebView2.Core.dll", "Microsoft.Web.WebView2.WinForms.dll", "WebView2Loader.dll"} <= {entry["path"] for entry in manifest["files"]}


@pytest.mark.parametrize("url", ["file:///C:/Windows", "http://user:password@localhost:5173", "http://localhost:5173/other", "not a url"])
def test_rejects_invalid_server_configuration_without_starting_a_window(bundle, tmp_path, url):
    config = tmp_path / "invalid.json"
    config.write_text(json.dumps({"serverUrl": url}), encoding="utf-8")
    result = command(bundle, config, "--validate-config")
    assert result.returncode == 8


def test_exit_confirmation_uses_both_themes_and_defaults_to_cancel(bundle, tmp_path):
    result = subprocess.run([PS, "-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-File",
        str(ROOT / "tests/desktop-client/Test-ExitDialog.ps1"), "-Executable", str(bundle / "MES中控管理.exe"),
        "-OutputDirectory", str(tmp_path)], capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=15)
    assert result.returncode == 0, result.stdout + result.stderr
    assert (tmp_path / "exit-light.png").is_file()
    assert (tmp_path / "exit-dark.png").is_file()


def test_close_and_status_are_idempotent_without_an_instance_or_valid_settings(bundle, tmp_path):
    config = tmp_path / "broken.json"
    config.write_text("broken JSON", encoding="utf-8")
    for action in ["--close", "--close", "--status"]:
        result = command(bundle, config, action)
        assert result.returncode == 0, result.stderr
        assert json.loads(result.stdout)["state"] == "stopped"


def test_real_webview_starts_maximized_with_native_controls_and_injects_role(bundle, client):
    process, config = client
    state = ready(bundle, process, config)
    assert state["module"] == "central"
    assert state["fullScreen"] is False
    assert state["borderless"] is False
    assert state["windowState"] == "Maximized"
    assert state["documentTitle"] == "central:desktop-fixture"
    assert state["browserPid"] > 0
    assert state["statusVisible"] is False
    assert state["statusText"] == ""


def test_native_navigation_tracks_document_theme_and_has_no_persistent_footer(bundle, client, site_server):
    process, config = client
    ready(bundle, process, config)
    for theme, color in [("light", "White"), ("dark", "#131A22")]:
        site_server.page_kind = theme
        assert command(bundle, config, "--reload").returncode == 0
        deadline = time.monotonic() + 10
        state = {}
        while time.monotonic() < deadline:
            state = json.loads(command(bundle, config, "--status").stdout)
            if state.get("theme") == theme and state.get("state") == "ready":
                break
            time.sleep(0.1)
        assert state["theme"] == theme
        assert state["navigationBackground"] == color
        assert state["statusVisible"] is False
        assert state["statusText"] == ""


def test_native_bridge_supplies_the_current_version_and_ip_list(bundle, client, site_server):
    process, config = client
    ready(bundle, process, config)
    site_server.page_kind = "host-info"
    assert command(bundle, config, "--reload").returncode == 0
    deadline = time.monotonic() + 10
    state = {}
    while time.monotonic() < deadline:
        state = json.loads(command(bundle, config, "--status").stdout)
        if state.get("documentTitle") == "1.7.0:true":
            break
        time.sleep(0.1)
    assert state["documentTitle"] == "1.7.0:true"


def test_cancelled_window_close_keeps_webview_and_confirmed_close_exits(bundle, site, tmp_path):
    config = tmp_path / "guard.json"
    config.write_text(json.dumps({"serverUrl": site, "module": "central"}), encoding="utf-8")
    runner = tmp_path / "close-guard.ps1"
    runner.write_text('''param([string]$Executable,[string]$Config)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
$assembly=[Reflection.Assembly]::LoadFrom($Executable)
$flags=[Reflection.BindingFlags]'Instance,NonPublic'
$static=[Reflection.BindingFlags]'Static,NonPublic'
$configType=$assembly.GetType('MESDesktopClient.ClientConfiguration',$true)
$instanceType=$assembly.GetType('MESDesktopClient.ClientInstance',$true)
$formType=$assembly.GetType('MESDesktopClient.ClientForm',$true)
$configuration=$configType.GetMethod('Load',$static).Invoke($null,[object[]]@([string[]]@('--config',$Config,'--test-hidden'),$false))
$instance=$instanceType.GetConstructor($flags,$null,[Type[]]@($configType,[bool]),$null).Invoke([object[]]@($configuration,$false))
$form=$formType.GetConstructor($flags,$null,[Type[]]@($configType,$instanceType),$null).Invoke([object[]]@($configuration,$instance))
$script:accepted=$false
$script:asks=0
$confirm=[Func[bool]] { $script:asks++; return $script:accepted }
$formType.GetField('confirmExit',$flags).SetValue($form,$confirm)
try {
 $form.Show()
 $clock=[Diagnostics.Stopwatch]::StartNew()
 do { [Windows.Forms.Application]::DoEvents(); Start-Sleep -Milliseconds 10; $before=$formType.GetMethod('PageStatus',$flags).Invoke($form,@()) } while($before['state'] -ne 'ready' -and $clock.ElapsedMilliseconds -lt 15000)
 if($before['state'] -ne 'ready'){throw 'WebView did not become ready'}
 $form.Close()
 [Windows.Forms.Application]::DoEvents()
 if($form.IsDisposed -or $script:asks -ne 1){throw 'Cancel did not preserve the client'}
 $after=$formType.GetMethod('PageStatus',$flags).Invoke($form,@())
 if($after['browserPid'] -ne $before['browserPid'] -or $after['state'] -ne 'ready'){throw 'Cancel recreated or stopped the page'}
 $script:accepted=$true
 $form.Close()
 $clock.Restart()
 while(-not $form.IsDisposed -and $clock.ElapsedMilliseconds -lt 15000){[Windows.Forms.Application]::DoEvents();Start-Sleep -Milliseconds 10}
 if(-not $form.IsDisposed -or $script:asks -ne 2){throw 'Confirmed window close did not exit'}
 Write-Output 'cancel-preserved-page;confirm-exited'
} finally {
 if(-not $form.IsDisposed){$formType.GetField('closeRequested',$flags).SetValue($form,$true);$form.Dispose()}
 $instance.Dispose()
}
''', encoding="utf-8-sig")
    result = subprocess.run([PS, "-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-File", str(runner),
        "-Executable", str(bundle / "MES中控管理.exe"), "-Config", str(config)], capture_output=True,
        text=True, encoding="utf-8", errors="replace", timeout=45)
    assert result.returncode == 0, result.stdout + result.stderr
    assert "cancel-preserved-page;confirm-exited" in result.stdout


def test_repeated_open_activates_the_same_instance(bundle, client):
    process, config = client
    state = ready(bundle, process, config)
    repeated = subprocess.run([str(bundle / "MES中控管理.exe"), "--config", str(config), "--test-hidden"],
        capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=20)
    assert repeated.returncode == 0, repeated.stderr
    after = json.loads(command(bundle, config, "--status").stdout)
    assert after["pid"] == state["pid"] == process.pid
    assert after["browserPid"] == state["browserPid"]


def test_concurrent_close_requests_both_confirm_exit(bundle, client):
    from concurrent.futures import ThreadPoolExecutor
    process, config = client
    ready(bundle, process, config)
    with ThreadPoolExecutor(max_workers=2) as pool:
        replies = list(pool.map(lambda _: command(bundle, config, "--close"), range(2)))
    assert all(reply.returncode == 0 for reply in replies), [reply.stderr for reply in replies]
    process.wait(timeout=20)


def test_closes_even_if_settings_become_corrupt_after_startup(bundle, client):
    process, config = client
    state = ready(bundle, process, config)
    config.write_text("broken JSON", encoding="utf-8")
    result = command(bundle, config, "--close")
    assert result.returncode == 0, result.stderr
    process.wait(timeout=20)
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.OpenProcess.restype = wintypes.HANDLE
    kernel.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    handle = kernel.OpenProcess(0x00100000, False, state["browserPid"])
    if handle:
        try:
            assert kernel.WaitForSingleObject(handle, 10000) == 0, "Owned WebView2 browser process remained alive after close"
        finally:
            kernel.CloseHandle(handle)
    assert json.loads(command(bundle, config, "--status").stdout)["state"] == "stopped"


def test_closes_during_initialization_without_automatic_restart(bundle, client):
    process, config = client
    ready(bundle, process, config, expected=None)
    result = command(bundle, config, "--close")
    assert result.returncode == 0, result.stderr
    process.wait(timeout=20)
    time.sleep(0.15)
    assert json.loads(command(bundle, config, "--status").stdout)["state"] == "stopped"


def test_closed_client_can_immediately_start_again(bundle, client):
    process, config = client
    ready(bundle, process, config)
    assert command(bundle, config, "--close").returncode == 0
    process.wait(timeout=20)
    restarted = subprocess.Popen([str(bundle / "MES中控管理.exe"), "--config", str(config), "--test-hidden"], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
        assert ready(bundle, restarted, config)["pid"] == restarted.pid
    finally:
        assert command(bundle, config, "--close").returncode == 0
        restarted.wait(timeout=20)


def test_control_center_activates_and_closes_its_owned_client_after_recreation(bundle, site, tmp_path):
    tools = tmp_path / "desktop tools"
    built = subprocess.run([PS, "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(ROOT / "scripts/build_desktop_tools.ps1"),
        "-OutputDirectory", str(tools), "-ServerUrl", site, "-IncludeCentralClient", "-SdkPackagePath", str(PACKAGE), "-Offline"],
        capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=45)
    assert built.returncode == 0, built.stdout + built.stderr
    native = tools / "central-client"
    config = native / "mes-client.json"
    settings = json.loads(config.read_text(encoding="utf-8"))
    settings["downloadDirectory"] = str(tmp_path / "downloads")
    config.write_text(json.dumps(settings), encoding="utf-8")
    process = subprocess.Popen([str(native / "MES中控管理.exe"), "--test-hidden"], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    script = tmp_path / "managed-client.ps1"
    script.write_text('''param([string]$Controller,[string]$Owner,[string]$Url)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
$assembly=[Reflection.Assembly]::LoadFrom($Controller)
$type=$assembly.GetType('MESControlCenter.MESBrowserSession',$true)
$flags=[Reflection.BindingFlags]'Instance,NonPublic'
$constructor=$type.GetConstructor($flags,$null,[Type[]]@([string],[string]),$null)
$session=$constructor.Invoke([object[]]@($Owner,$null))
if(-not $type.GetProperty('CentralClientPath',$flags).GetValue($session,$null)) { throw 'Native client was not found; refusing browser fallback in this test' }
$null=$type.GetMethod('Open',$flags).Invoke($session,[object[]]@(,[string[]]@($Url+'/')))
$recreated=$constructor.Invoke([object[]]@($Owner,$null))
$null=$type.GetMethod('Close',$flags).Invoke($recreated,@())
$null=$type.GetMethod('Close',$flags).Invoke($recreated,@())
Write-Output 'owned-client-closed'
''', encoding="utf-8-sig")
    try:
        ready(native, process, config)
        result = subprocess.run([PS, "-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-File", str(script),
            "-Controller", str(tools / "MES控制中心_Docker版.exe"), "-Owner", str(tmp_path), "-Url", site],
            capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=35)
        assert result.returncode == 0, result.stdout + result.stderr
        assert "owned-client-closed" in result.stdout
        process.wait(timeout=20)
        assert process.returncode == 0
    finally:
        command(native, config, "--close")
        process.wait(timeout=20)


def test_blocks_cross_origin_navigation_and_popups(bundle, client, site_server):
    process, config = client
    ready(bundle, process, config)
    site_server.page_kind = "external"
    assert command(bundle, config, "--reload").returncode == 0
    deadline = time.monotonic() + 10
    state = {}
    while time.monotonic() < deadline:
        state = json.loads(command(bundle, config, "--status").stdout)
        if state.get("blockedNavigations", 0) >= 2:
            break
        time.sleep(0.1)
    assert state["blockedNavigations"] >= 2
    assert state["documentTitle"] == "external-fixture"


def test_recovers_after_a_server_outage_and_still_closes_cleanly(bundle, client, site_server):
    import socket
    process, config = client
    ready(bundle, process, config)
    with socket.socket() as reservation:
        reservation.bind(("127.0.0.1", 0))
        port = reservation.getsockname()[1]
    changed = subprocess.run([str(bundle / "MES中控管理.exe"), "--config", str(config), "--test-hidden", "--server-url", f"http://127.0.0.1:{port}"],
        capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=20)
    assert changed.returncode == 0, changed.stderr
    ready(bundle, process, config, expected="reconnecting")
    recovered = ThreadingHTTPServer(("127.0.0.1", port), site_server.RequestHandlerClass)
    recovered.page_kind = "normal"
    thread = threading.Thread(target=recovered.serve_forever, daemon=True)
    thread.start()
    try:
        assert ready(bundle, process, config)["documentTitle"] == "central:desktop-fixture"
    finally:
        recovered.shutdown()
        recovered.server_close()
        thread.join(timeout=3)
