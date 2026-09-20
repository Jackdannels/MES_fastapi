import asyncio
from pathlib import Path
import sqlite3

import pytest

from app.core.config import Settings
from app.services import test_data_backup as backup
from app.services import test_data_backup_runtime as runtime_module


@pytest.fixture
def report(tmp_path):
    source = tmp_path / "local" / "任务" / "试验" / "样品.pdf"
    source.parent.mkdir(parents=True)
    source.write_bytes(b"%PDF original report")
    destination = tmp_path / "server"
    destination.mkdir()
    record = {"exportKey": "run|sample", "status": "success", "filePath": str(source),
              "relativePath": str(source.relative_to(tmp_path / "local"))}
    return source, destination, tmp_path / "state.sqlite3", record


def run(report, records=None, **kwargs):
    source, destination, state, record = report
    return backup.backup_once([record] if records is None else records, destination=destination,
                              state_path=state, retry_seconds=0, **kwargs)


def due(state):
    with sqlite3.connect(state) as connection:
        connection.execute("UPDATE backups SET next_at=0")


def test_existing_report_backfills_and_is_idempotent(report):
    source, destination, state, record = report
    assert run(report) == {"succeeded": 1, "failed": 0}
    remote = destination / record["relativePath"]
    assert remote.read_bytes() == source.read_bytes()
    stamp = remote.stat().st_mtime_ns
    due(state)
    assert run(report)["succeeded"] == 1
    assert remote.stat().st_mtime_ns == stamp
    assert backup.backup_status(state, str(destination))["counts"]["synced"] == 1
    assert not list(destination.rglob("*.tmp"))


def test_network_failure_does_not_touch_local_and_retries_after_restart_without_metadata(report):
    source, destination, state, record = report
    destination.rmdir()
    assert run(report)["failed"] == 1
    assert source.read_bytes() == b"%PDF original report"
    assert backup.backup_status(state, str(destination))["counts"]["failed"] == 1
    destination.mkdir()
    # A fresh invocation has only the durable queue, not the discovery records.
    assert run(report, records=[])["succeeded"] == 1
    assert (destination / record["relativePath"]).is_file()


def test_changed_same_name_preserves_previous_backup(report):
    source, destination, state, record = report
    run(report)
    source.write_bytes(b"%PDF changed report")
    assert run(report)["succeeded"] == 1
    assert (destination / record["relativePath"]).read_bytes() == b"%PDF original report"
    versions = list(destination.rglob("*.pdf"))
    assert len(versions) == 2
    assert any(p.read_bytes() == source.read_bytes() for p in versions)


def test_local_deletion_does_not_delete_confirmed_backup(report):
    source, destination, state, record = report
    run(report)
    source.unlink()
    due(state)
    assert run(report, records=[])["succeeded"] == 1
    assert (destination / record["relativePath"]).is_file()


def test_remote_deletion_is_repaired(report):
    source, destination, state, record = report
    run(report)
    (destination / record["relativePath"]).unlink()
    due(state)
    assert run(report)["succeeded"] == 1
    assert (destination / record["relativePath"]).read_bytes() == source.read_bytes()


@pytest.mark.parametrize("relative", ["../escape.pdf", "C:\\escape.pdf", "\\\\host\\share\\escape.pdf", "x.txt", "x:stream.pdf", ""])
def test_invalid_metadata_cannot_escape_target(report, relative):
    source, destination, state, record = report
    record["relativePath"] = relative
    assert run(report)["failed"] == 1
    assert not list(destination.rglob("*"))


def test_same_or_overlapping_source_destination_rejected(report):
    source, _, state, record = report
    destination = source.parents[2]
    assert backup.backup_once([record], destination=destination, state_path=state)["failed"] == 1
    assert source.read_bytes() == b"%PDF original report"


def test_checksum_failure_never_publishes_incomplete_report(report, monkeypatch):
    real_digest = backup._digest
    monkeypatch.setattr(backup, "_digest", lambda path: "broken" if path.suffix == ".tmp" else real_digest(path))
    assert run(report)["failed"] == 1
    assert not list(report[1].rglob("*.pdf"))
    assert not list(report[1].rglob("*.tmp"))


def test_failed_generation_is_not_enqueued(report):
    report[3]["status"] = "failed"
    assert run(report) == {"succeeded": 0, "failed": 0}


def test_batch_limit_and_destination_change(report, tmp_path):
    source, destination, state, record = report
    second = {**record, "exportKey": "second"}
    assert run(report, [record, second], batch_size=1)["succeeded"] == 1
    assert run(report, [record, second], batch_size=1)["succeeded"] == 1
    other = tmp_path / "other-server"
    other.mkdir()
    assert backup.backup_once([record], destination=other, state_path=state)["succeeded"] == 1
    assert backup.backup_status(state, str(other))["counts"]["synced"] == 1


def test_status_does_not_access_network(report, monkeypatch):
    run(report)
    monkeypatch.setattr(backup, "_digest", lambda _: pytest.fail("must not access network"))
    settings = Settings(_env_file=None, TEST_DATA_BACKUP_PATH=str(report[1]), TEST_DATA_BACKUP_STATE_PATH=str(report[2]))
    assert runtime_module.TestDataBackupRuntime(settings).status()["counts"]["synced"] == 1


def test_documented_unc_survives_dotenv_parsing():
    from dotenv import dotenv_values
    from io import StringIO
    from pathlib import PureWindowsPath
    value = dotenv_values(stream=StringIO(r"TEST_DATA_BACKUP_PATH=\\192.168.110.21\sylu_share\试验数据"))["TEST_DATA_BACKUP_PATH"]
    assert PureWindowsPath(value).is_absolute()
    assert value == r"\\192.168.110.21\sylu_share\试验数据"


def test_invalid_backup_config_is_rejected():
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        Settings(_env_file=None, TEST_DATA_BACKUP_PATH="relative/server")
    with pytest.raises(ValidationError):
        Settings(_env_file=None, TEST_DATA_BACKUP_STATE_PATH=r"\\server\share\state.sqlite3")


def test_discovery_failure_still_retries_durable_jobs(report, monkeypatch):
    from app.core.config import settings
    from app.core import storage_backend
    source, destination, state, record = report
    destination.rmdir()
    run(report)
    destination.mkdir()
    monkeypatch.setattr(settings, "TEST_DATA_BACKUP_PATH", str(destination))
    monkeypatch.setattr(settings, "TEST_DATA_BACKUP_STATE_PATH", str(state))
    monkeypatch.setattr(storage_backend, "get_storage_backend", lambda: (_ for _ in ()).throw(OSError("database offline")))
    with pytest.raises(RuntimeError, match="新报告发现失败"):
        backup.main()
    assert (destination / record["relativePath"]).read_bytes() == source.read_bytes()


class FakeProcess:
    returncode = None
    killed = False

    def poll(self):
        return self.returncode

    def kill(self):
        self.killed = True
        self.returncode = -9


def test_worker_timeout_kills_child_without_blocking_requests(monkeypatch, tmp_path):
    process = FakeProcess()
    monkeypatch.setattr(runtime_module.subprocess, "Popen", lambda *a, **k: process)
    settings = Settings(_env_file=None, TEST_DATA_BACKUP_PATH=str(tmp_path), TEST_DATA_BACKUP_TIMEOUT_SECONDS=1)
    runtime = runtime_module.TestDataBackupRuntime(settings)
    ticks = iter([0, 2])
    # Replace the module binding, not asyncio's own clock.
    from types import SimpleNamespace
    monkeypatch.setattr(runtime_module, "time", SimpleNamespace(monotonic=lambda: next(ticks)))
    with pytest.raises(TimeoutError):
        asyncio.run(runtime._pass())
    assert process.killed
    assert runtime.process is None


def test_runtime_shutdown_kills_active_worker_and_disabled_creates_none(monkeypatch, tmp_path):
    process = FakeProcess()
    monkeypatch.setattr(runtime_module.subprocess, "Popen", lambda *a, **k: process)

    async def scenario():
        disabled = runtime_module.TestDataBackupRuntime(Settings(_env_file=None, TEST_DATA_BACKUP_PATH=""))
        disabled.start()
        assert disabled.task is None
        runtime = runtime_module.TestDataBackupRuntime(Settings(_env_file=None, TEST_DATA_BACKUP_PATH=str(tmp_path)))
        runtime.start()
        original_task = runtime.task
        runtime.start()
        assert runtime.task is original_task
        await asyncio.sleep(0)
        await runtime.stop()
        await runtime.stop()
        assert process.killed
        assert runtime.task is None

    asyncio.run(scenario())
