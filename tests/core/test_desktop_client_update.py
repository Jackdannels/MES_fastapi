"""In-place client updates preserve local settings and keep rollback files."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import time

import pytest
from test_desktop_client import bundle, site, site_server, ready, command, PS, ROOT

pytestmark = pytest.mark.skipif(not PS, reason="Windows PowerShell required")


def copy_target(bundle, tmp_path):
    target = tmp_path / "existing client"
    shutil.copytree(bundle, target / "central-client")
    exe = target / "central-client/MES中控管理.exe"
    exe.write_bytes(exe.read_bytes() + b"previous-local-build")
    return target


def update(source, target, restart=False):
    args = [PS, "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(ROOT / "scripts/update_desktop_client.ps1"),
        "-SourceDirectory", str(source), "-TargetDirectory", str(target)]
    if restart:
        args.append("-RestartIfRunning")
    return subprocess.run(args, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=45,
        env={**os.environ, "MES_DESKTOP_TEST_HIDDEN": "1"})


def test_in_place_update_preserves_configuration_and_backs_up_original_executable(bundle, tmp_path):
    target = copy_target(bundle, tmp_path)
    config = target / "central-client/mes-client.json"
    original_config = b'{"module":"central","serverUrl":"http://192.0.2.99:25173","fullScreen":false}'
    config.write_bytes(original_config)
    note = target / "my-note.txt"
    note.write_text("keep this", encoding="utf-8")
    exe = target / "central-client/MES中控管理.exe"
    original_executable = exe.read_bytes()
    result = update(bundle, target)
    assert result.returncode == 0, result.stdout + result.stderr
    assert config.read_bytes() == original_config
    assert exe.read_bytes() == (bundle / exe.name).read_bytes()
    backups = list((target / ".client-updates").iterdir())
    assert len(backups) == 1
    assert (backups[0] / "central-client" / exe.name).read_bytes() == original_executable
    record = json.loads((backups[0] / "update.json").read_text(encoding="utf-8"))
    assert record["version"] == "1.7.0" and record["configPreserved"] is True
    manifest = json.loads((target / "central-client/client-manifest.json").read_text(encoding="utf-8"))
    assert all(hashlib.sha256((target / "central-client" / entry["path"]).read_bytes()).hexdigest() == entry["sha256"] for entry in manifest["files"])
    assert note.read_text() == "keep this"


def test_corrupt_source_is_rejected_before_any_target_changes(bundle, tmp_path):
    source = tmp_path / "corrupt build"
    shutil.copytree(bundle, source)
    (source / "MES中控管理.exe").write_bytes(b"corrupt")
    target = copy_target(bundle, tmp_path)
    exe = target / "central-client/MES中控管理.exe"
    before = exe.read_bytes()
    result = update(source, target)
    assert result.returncode != 0
    assert exe.read_bytes() == before
    assert not (target / ".client-updates").exists()


def test_failed_post_update_validation_restores_original_program_and_manifest(bundle, tmp_path):
    target = copy_target(bundle, tmp_path)
    client_directory = target / "central-client"
    exe = client_directory / "MES中控管理.exe"
    before = exe.read_bytes()
    before_manifest = (client_directory / "client-manifest.json").read_bytes()
    (client_directory / "mes-client.json").write_text("invalid JSON", encoding="utf-8")
    result = update(bundle, target)
    assert result.returncode != 0
    assert exe.read_bytes() == before
    assert (client_directory / "client-manifest.json").read_bytes() == before_manifest


def test_control_center_component_requires_a_hash_and_keeps_its_original_backup(bundle, tmp_path):
    source = tmp_path / "source package"
    shutil.copytree(bundle, source / "central-client")
    target = copy_target(bundle, tmp_path)
    controller = "MES控制中心_本机测试.exe"
    old = target / controller
    old.write_bytes(b"old-controller")
    config = target / "mes-desktop-tools.json"
    config.write_bytes(b'{"serverUrl":"http://192.0.2.10:5173"}')
    code = tmp_path / "controller.cs"
    code.write_text('using System.Reflection;[assembly:AssemblyVersion("2.8.0.0")][assembly:AssemblyFileVersion("2.8.0.0")]class P{static void Main(){}}', encoding="utf-8")
    compiler = Path(os.environ["WINDIR"]) / "Microsoft.NET/Framework64/v4.0.30319/csc.exe"
    compiled = subprocess.run([str(compiler), "/nologo", "/target:winexe", f"/out:{source / controller}", str(code)], capture_output=True, timeout=15)
    assert compiled.returncode == 0, compiled.stderr
    inventory = {"version": "1.7.0", "files": [{"path": controller, "sha256": hashlib.sha256((source / controller).read_bytes()).hexdigest()}]}
    (source / "combined-manifest.json").write_text(json.dumps(inventory), encoding="utf-8")
    result = update(source, target)
    assert result.returncode == 0, result.stdout + result.stderr
    assert old.read_bytes() == (source / controller).read_bytes()
    assert config.read_bytes() == b'{"serverUrl":"http://192.0.2.10:5173"}'
    assert next((target / ".client-updates").glob(f"*/{controller}")).read_bytes() == b"old-controller"
    (source / controller).write_bytes(b"corrupt-controller")
    before = old.read_bytes()
    assert update(source, target).returncode != 0
    assert old.read_bytes() == before


def test_update_can_close_and_restart_only_the_selected_running_client(bundle, tmp_path, site):
    target = copy_target(bundle, tmp_path)
    client_directory = target / "central-client"
    config = client_directory / "mes-client.json"
    config.write_text(json.dumps({"module": "central", "serverUrl": site, "startMaximized": False}), encoding="utf-8")
    process = subprocess.Popen([str(client_directory / "MES中控管理.exe"), "--test-hidden"], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
        before = ready(client_directory, process, config)
        result = update(bundle, target, restart=True)
        assert result.returncode == 0, result.stdout + result.stderr
        process.wait(timeout=15)
        deadline = time.monotonic() + 20
        after = {}
        while time.monotonic() < deadline:
            reply = command(client_directory, config, "--status")
            if reply.returncode == 0:
                after = json.loads(reply.stdout)
                if after.get("state") == "ready":
                    break
            time.sleep(0.1)
        assert after.get("state") == "ready", after
        assert before["pid"] != after["pid"]
        assert after["version"] == "1.7.0"
    finally:
        command(client_directory, config, "--close")
        process.wait(timeout=15)
