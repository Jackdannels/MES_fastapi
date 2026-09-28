import asyncio
from pathlib import Path
import subprocess

import pytest

from app.core.config import Settings
from app.services import test_data_backup_probe as probe
from app.services.test_data_backup_settings import read_backup_path, save_backup_path, settings_file
from app.services.test_data_backup_runtime import TestDataBackupRuntime


def config(tmp_path):
    return Settings(_env_file=None, TEST_DATA_BACKUP_PATH=str(tmp_path / "old"),
                    TEST_DATA_BACKUP_STATE_PATH=str(tmp_path / "state.sqlite3"))


def test_settings_override_env_persists_across_runtime_instances(tmp_path):
    settings = config(tmp_path)
    assert read_backup_path(settings) == str(tmp_path / "old")
    runtime = TestDataBackupRuntime(settings)
    destination = str(tmp_path / "new")
    save_backup_path(settings, destination)
    assert runtime.destination == destination
    assert TestDataBackupRuntime(config(tmp_path)).destination == destination
    assert settings.TEST_DATA_BACKUP_PATH == str(tmp_path / "old")


def test_corrupt_override_does_not_silently_revert_destination(tmp_path):
    settings = config(tmp_path)
    settings_file(settings).write_text("corrupt", encoding="utf-8")
    with pytest.raises(ValueError):
        read_backup_path(settings)
    assert "无法读取" in TestDataBackupRuntime(settings).status()["lastError"]


def test_failed_atomic_save_keeps_old_configuration(tmp_path, monkeypatch):
    from app.services import test_data_backup_settings as module
    settings = config(tmp_path)
    save_backup_path(settings, str(tmp_path / "first"))
    monkeypatch.setattr(module.os, "replace", lambda *args: (_ for _ in ()).throw(PermissionError("denied")))
    with pytest.raises(PermissionError):
        save_backup_path(settings, str(tmp_path / "second"))
    assert read_backup_path(settings) == str(tmp_path / "first")
    assert not list(tmp_path.glob(".backup-settings-*"))


def test_probe_checks_real_publication_and_cleans_only_own_files(tmp_path):
    existing = tmp_path / "existing.pdf"
    existing.write_bytes(b"original")
    result = probe.probe_directory(str(tmp_path), [str(tmp_path.parent / "local")])
    assert result["ok"]
    assert len(result["checks"]) == 7
    assert list(tmp_path.iterdir()) == [existing]
    assert existing.read_bytes() == b"original"


@pytest.mark.parametrize("value", ["", "relative/path"])
def test_bad_paths_fail_before_io(value):
    result = probe.probe_directory(value, [])
    assert not result["ok"]
    assert result["checks"][0]["label"] == "路径格式"


def test_missing_directory_is_not_created(tmp_path):
    target = tmp_path / "missing"
    result = probe.probe_directory(str(target), [])
    assert not result["ok"]
    assert not target.exists()


def test_local_directory_overlap_is_rejected_without_probes(tmp_path):
    result = probe.probe_directory(str(tmp_path), [str(tmp_path / "local")])
    assert not result["ok"]
    assert "互相包含" in result["detail"]
    assert not list(tmp_path.iterdir())


def test_write_permission_denied_is_explicit(tmp_path, monkeypatch):
    monkeypatch.setattr(probe.tempfile, "mkdtemp", lambda **kw: (_ for _ in ()).throw(PermissionError("拒绝访问")))
    result = probe.probe_directory(str(tmp_path), [])
    assert not result["ok"]
    assert "创建目录及写入文件失败" in result["detail"]


def test_cleanup_permission_denied_is_not_reported_as_success(tmp_path, monkeypatch):
    original = Path.unlink
    def deny(path, **kwargs):
        if path.name == "probe.complete":
            raise PermissionError("delete denied")
        return original(path, **kwargs)
    monkeypatch.setattr(Path, "unlink", deny)
    result = probe.probe_directory(str(tmp_path), [])
    assert not result["ok"]
    assert "清理失败" in result["detail"]


def test_bounded_probe_timeout_is_actionable(monkeypatch, tmp_path):
    def timeout(*args, **kwargs):
        assert kwargs["timeout"] == 15
        raise subprocess.TimeoutExpired("probe", 15)
    monkeypatch.setattr(probe.subprocess, "run", timeout)
    assert "超时" in probe.check_backup_directory(str(tmp_path), [])["detail"]


def test_subprocess_probe_handles_chinese_paths(tmp_path):
    destination = tmp_path / "试验数据"
    destination.mkdir()
    result = probe.check_backup_directory(str(destination), [])
    assert result["ok"], result
    assert result["path"] == str(destination)
    assert not list(destination.iterdir())


def test_idle_runtime_observes_ui_enable_without_restart(tmp_path, monkeypatch):
    settings = config(tmp_path)
    settings.TEST_DATA_BACKUP_PATH = ""
    settings.TEST_DATA_BACKUP_INTERVAL_SECONDS = 0.01
    runtime = TestDataBackupRuntime(settings)
    called = []
    async def fake_pass():
        called.append(runtime.destination)
    monkeypatch.setattr(runtime, "_pass", fake_pass)
    async def scenario():
        runtime.start()
        await asyncio.sleep(0)
        assert not called
        save_backup_path(settings, str(tmp_path / "new"))
        async def wait_for_call():
            while not called:
                await asyncio.sleep(0.01)
        await asyncio.wait_for(wait_for_call(), timeout=1)
        await runtime.stop()
    asyncio.run(scenario())
    assert called[0] == str(tmp_path / "new")
