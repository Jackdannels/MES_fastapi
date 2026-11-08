"""Combined native tabs and standard window controls against isolated services."""
import ctypes
from ctypes import wintypes
import json
import os
from pathlib import Path
import subprocess
import time

import pytest
from test_desktop_simulator_clients import ROOT, PS, PACKAGE, local_services, opened, status, wait_ready

pytestmark = pytest.mark.skipif(not PS or not PACKAGE.exists(), reason="Windows and pinned WebView2 SDK cache required")


@pytest.fixture(scope="module")
def combined_bundle(tmp_path_factory, local_services):
    output = tmp_path_factory.mktemp("combined-desktop") / "tools"
    result = subprocess.run([PS, "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(ROOT / "scripts/build_desktop_tools.ps1"),
        "-OutputDirectory", str(output), "-CombineSimulators", "-ServerUrl", local_services["central"],
        "-LimsUrl", local_services["lims"], "-UpperComputerUrl", local_services["upper-computer"], "-Offline", "-SdkPackagePath", str(PACKAGE)],
        capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=60)
    assert result.returncode == 0, result.stdout + result.stderr
    assert not (output / "lims-client").exists() and not (output / "upper-client").exists()
    return output


@pytest.fixture
def combined(combined_bundle, tmp_path):
    exe = combined_bundle / "central-client/MES中控管理.exe"
    config = tmp_path / "combined.json"
    data = json.loads((exe.parent / "mes-client.json").read_text(encoding="utf-8"))
    data["downloadDirectory"] = str(tmp_path / "downloads")
    config.write_text(json.dumps(data), encoding="utf-8")
    return exe, config


def command(exe, config, *args):
    result = subprocess.run([str(exe), "--config", str(config), *args], capture_output=True,
        text=True, encoding="utf-8", errors="replace", timeout=25)
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)


def wait_tab(exe, config, module, state="ready", api_calls=0):
    deadline = time.monotonic() + 25
    found = {}
    while time.monotonic() < deadline:
        result = status(exe, config)
        found = next(item for item in result["tabs"] if item["module"] == module)
        if found["state"] == state and found["apiSuccessCount"] >= api_calls:
            return found
        time.sleep(0.1)
    pytest.fail(f"Combined tab did not reach {state}: {found}")


def assert_process_exited(pid):
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.OpenProcess.restype = wintypes.HANDLE
    kernel.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    handle = kernel.OpenProcess(0x00100000, False, pid)
    if handle:
        try:
            assert kernel.WaitForSingleObject(handle, 10000) == 0, f"WebView process {pid} did not exit"
        finally:
            kernel.CloseHandle(handle)


def test_one_window_keeps_three_real_pages_alive_across_tab_switches(combined):
    exe, config = combined
    with opened(exe, config) as process:
        root = wait_ready(exe, config, process=process)
        assert root["activeTab"] == "central"
        assert root["tabsVisible"] is True
        assert root["navigationLabels"] == ["MES中控管理", "LIMS模拟器", "上位机模拟器"]
        assert root["headerControlCount"] == 3
        assert len({bounds[1] for bounds in root["navigationBounds"]}) == 1
        assert [item["module"] for item in root["tabs"]] == ["central", "lims", "upper-computer"]
        command(exe, config, "--select-tab", "lims")
        lims = wait_tab(exe, config, "lims", api_calls=3)
        assert lims["documentTitle"] == "MES LIMS 模拟器" and lims["pageErrors"] == 0
        command(exe, config, "--select-tab", "upper-computer")
        upper = wait_tab(exe, config, "upper-computer", api_calls=3)
        assert upper["documentTitle"] == "MES 上位机模拟器" and upper["pageErrors"] == 0
        command(exe, config, "--select-tab", "central")
        assert status(exe, config)["browserPid"] == root["browserPid"]
        command(exe, config, "--select-tab", "lims")
        assert wait_tab(exe, config, "lims")["browserPid"] == lims["browserPid"]
        assert status(exe, config)["pid"] == process.pid
        browser_pids = {item["browserPid"] for item in status(exe, config)["tabs"]}
        assert len(browser_pids) == 3 and 0 not in browser_pids
    for pid in browser_pids:
        assert_process_exited(pid)


def test_native_minimize_restore_maximize_keep_the_webview_instance(combined):
    exe, config = combined
    with opened(exe, config) as process:
        original = wait_ready(exe, config, process=process)
        assert original["fullScreen"] is False and original["borderless"] is False
        assert command(exe, config, "--minimize")["windowState"] == "Minimized"
        restored = command(exe, config, "--restore")
        assert restored["windowState"] == "Normal" and restored["borderless"] is False
        maximized = command(exe, config, "--maximize")
        assert maximized["windowState"] == "Maximized" and maximized["fullScreen"] is False
        assert status(exe, config)["browserPid"] == original["browserPid"]


def test_simulator_tabs_can_be_disabled_without_changing_the_executable(combined):
    exe, config = combined
    data = json.loads(config.read_text())
    data["simulatorsEnabled"] = False
    config.write_text(json.dumps(data), encoding="utf-8")
    with opened(exe, config) as process:
        ready = wait_ready(exe, config, process=process)
        assert len(ready["tabs"]) == 1
        bad = subprocess.run([str(exe), "--config", str(config), "--select-tab", "lims"], capture_output=True, timeout=15)
        assert bad.returncode == 8


def test_close_during_simulator_initialization_exits_the_whole_client(combined):
    exe, config = combined
    with opened(exe, config) as process:
        wait_ready(exe, config, process=process)
        command(exe, config, "--select-tab", "upper-computer")
        command(exe, config, "--close")
        process.wait(timeout=20)
        assert status(exe, config)["state"] == "stopped"


def test_control_center_opens_all_three_services_as_one_window(combined_bundle, tmp_path, local_services):
    exe = combined_bundle / "central-client/MES中控管理.exe"
    config = exe.parent / "mes-client.json"
    runner = tmp_path / "combined-control.ps1"
    runner.write_text('''param([string]$Executable,[string]$Action,[string]$Output)
$ErrorActionPreference='Stop'
$assembly=[Reflection.Assembly]::LoadFrom($Executable)
$type=$assembly.GetType('MESControlCenter.MESBrowserSession',$true)
$flags=[Reflection.BindingFlags]'Instance,NonPublic'
$owner=Split-Path -Parent $Executable
$constructor=$type.GetConstructor($flags,$null,[Type[]]@([string],[string]),$null)
$session=$constructor.Invoke([object[]]@([string]$owner,$null))
$settings=Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $owner 'mes-desktop-tools.json') | ConvertFrom-Json
if($Action -eq 'Stop') { $null=$type.GetMethod('Close',$flags).Invoke($session,@()) }
elseif($Action -eq 'OpenCentral') {
 $formType=$assembly.GetType('MESControlCenter.ControlCenterForm',$true)
 $blocked=Join-Path $owner 'must-not-run-service.ps1'
 [IO.File]::WriteAllText($blocked,"throw 'Opening the interface must not run a service action'")
 $form=$formType.GetConstructor($flags,$null,[Type[]]@([string],[bool]),$null).Invoke([object[]]@([string]$blocked,$false))
 try {
  $button=$formType.GetField('openCentralButton',$flags).GetValue($form)
  if($button.Text -ne '打开中控管理' -or -not $button.Enabled){throw 'Dedicated open button missing'}
  $null=$formType.GetMethod('OpenCentralPage',$flags).Invoke($form,@())
 } finally {$form.Dispose()}
}
else {
 $urls=if($Action -eq 'Lims') { [string[]]@($settings.limsUrl+'/') } else { [string[]]@(($settings.serverUrl+'/'),($settings.limsUrl+'/'),($settings.upperComputerUrl+'/')) }
 $null=$type.GetMethod('Open',$flags).Invoke($session,[object[]]@(,[string[]]$urls))
}
[IO.File]::WriteAllText($Output,'ok')
''', encoding="utf-8-sig")
    def run(action):
        with (tmp_path / "control.log").open("wb") as log:
            reply = subprocess.run([PS, "-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-File", str(runner),
                "-Executable", str(combined_bundle / "MES控制中心_Docker版.exe"), "-Action", action, "-Output", str(tmp_path / "result")],
                env={**os.environ, "MES_DESKTOP_TEST_HIDDEN": "1"}, stdout=log, stderr=subprocess.STDOUT, timeout=30)
        assert reply.returncode == 0, (tmp_path / "control.log").read_text(errors="replace")
    try:
        run("Start")
        before = wait_ready(exe, config)
        assert before["activeTab"] == "central"
        run("Lims")
        assert status(exe, config)["activeTab"] == "lims"
        wait_tab(exe, config, "lims", api_calls=3)
        assert status(exe, config)["pid"] == before["pid"]
        run("OpenCentral")
        assert status(exe, config)["activeTab"] == "central"
        assert status(exe, config)["pid"] == before["pid"]
        run("Stop")
        assert status(exe, config)["state"] == "stopped"
        run("OpenCentral")
        reopened = wait_ready(exe, config)
        assert reopened["pid"] != before["pid"]
    finally:
        run("Stop")
