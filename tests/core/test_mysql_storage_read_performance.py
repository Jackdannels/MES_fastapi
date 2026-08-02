from __future__ import annotations

from app.core.mysql_storage_backend import MySQLMesStorageBackend
from app.db.mysql_snapshot import MySQLConnectionSettings


class _SnapshotRepository:
    def __init__(self) -> None:
        self.requested_keys = []

    def read_many(self, keys):
        requested = list(keys)
        self.requested_keys.append(requested)
        values = {
            "mes.conflicts": '[{"id":"CONFLICT-1"}]',
            "mes.staging_events": (
                '[{"id":"STAGING-1","task_code":"TASK-001"},'
                '{"id":"STAGING-2","task_code":"TASK-002"}]'
            ),
        }
        return {key: values[key] for key in requested if key in values}

    def read_all(self):
        raise AssertionError("key-scoped reads must not load every snapshot payload")


class _Cursor:
    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return False


class _Connection:
    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return False

    def cursor(self):
        return _Cursor()


def _backend(repository) -> MySQLMesStorageBackend:
    backend = MySQLMesStorageBackend(
        MySQLConnectionSettings(host="127.0.0.1", port=3306, user="root", password="", database="mes"),
        repository,
    )
    backend._ensure_schema_extensions = lambda: None
    return backend


def test_read_many_fetches_only_requested_snapshot_payloads() -> None:
    repository = _SnapshotRepository()
    backend = _backend(repository)

    result = backend.read_many(["mes.conflicts"])

    assert result == {"mes.conflicts": [{"id": "CONFLICT-1"}]}
    assert repository.requested_keys == [["mes.conflicts"]]


def test_sample_read_fetches_only_its_staging_snapshot_dependency() -> None:
    repository = _SnapshotRepository()
    backend = _backend(repository)
    backend._connect = lambda: _Connection()
    backend._load_schedules = lambda _cursor: []
    backend._load_experiment_trays = lambda _cursor: []
    received_staging_events = []

    def load_samples(_cursor, staging_event_rows, **_kwargs):
        received_staging_events.extend(staging_event_rows)
        return []

    backend._load_samples = load_samples

    assert backend.read_many(["mes.samples"]) == {"mes.samples": []}
    assert repository.requested_keys == [["mes.staging_events"]]
    assert received_staging_events == [
        {"id": "STAGING-1", "task_code": "TASK-001"},
        {"id": "STAGING-2", "task_code": "TASK-002"},
    ]


def test_read_task_scope_filters_relational_loaders_and_staging_events() -> None:
    repository = _SnapshotRepository()
    backend = _backend(repository)
    backend._connect = lambda: _Connection()
    received = {}

    def load_tasks(_cursor, *, task_codes=None):
        received["task_codes"] = task_codes
        return [{"code": "TASK-001"}]

    backend._load_tasks = load_tasks

    result = backend.read_task_scope(
        {" TASK-001 "},
        ["mes.tasks", "mes.staging_events"],
    )

    assert received["task_codes"] == {"TASK-001"}
    assert result == {
        "mes.tasks": [{"code": "TASK-001"}],
        "mes.staging_events": [{"id": "STAGING-1", "task_code": "TASK-001"}],
    }


def test_read_task_scope_rejects_empty_scope() -> None:
    backend = _backend(_SnapshotRepository())

    try:
        backend.read_task_scope(set(), ["mes.tasks"])
    except ValueError as exc:
        assert str(exc) == "task_codes must not be empty"
    else:
        raise AssertionError("empty task scope must not fall back to an unbounded read")


def test_task_scope_read_passes_scope_to_data_stream_loader() -> None:
    backend = _backend(_SnapshotRepository())
    backend._connect = lambda: _Connection()
    received = []
    backend._load_streams = lambda _cursor, *, task_codes=None: received.append(task_codes) or []

    assert backend.read_task_scope({"TASK-001"}, ["mes.streams"]) == {"mes.streams": []}
    assert received == [{"TASK-001"}]
