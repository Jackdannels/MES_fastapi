from __future__ import annotations

from app.db.mysql_snapshot import MySQLSnapshotRepository


class _Cursor:
    def __init__(self) -> None:
        self.executions = []

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return False

    def execute(self, sql, params=None) -> None:
        self.executions.append((" ".join(str(sql).split()), params))

    def fetchall(self):
        return [
            ("mes.conflicts", '[{"id":"CONFLICT-1"}]'),
            ("mes.staging_events", '[{"id":"EVENT-1"}]'),
        ]


class _Connection:
    def __init__(self) -> None:
        self.cursor_instance = _Cursor()

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return False

    def cursor(self):
        return self.cursor_instance


def test_snapshot_read_many_uses_one_key_scoped_query() -> None:
    repository = object.__new__(MySQLSnapshotRepository)
    repository._initialized = True
    connection = _Connection()
    repository._connect = lambda: connection

    rows = repository.read_many(["mes.conflicts", "mes.staging_events", "mes.conflicts"])

    assert rows == {
        "mes.conflicts": '[{"id":"CONFLICT-1"}]',
        "mes.staging_events": '[{"id":"EVENT-1"}]',
    }
    assert connection.cursor_instance.executions == [
        (
            "SELECT storage_key, payload_json FROM app_storage_snapshot WHERE storage_key IN (%s, %s)",
            ["mes.conflicts", "mes.staging_events"],
        )
    ]


def test_snapshot_read_many_skips_database_for_empty_keys() -> None:
    repository = object.__new__(MySQLSnapshotRepository)
    repository._initialized = True
    repository._connect = lambda: (_ for _ in ()).throw(AssertionError("database should not be queried"))

    assert repository.read_many([]) == {}
