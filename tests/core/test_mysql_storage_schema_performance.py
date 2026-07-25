from __future__ import annotations

from types import SimpleNamespace

from app.core import mysql_storage_schema


EXPECTED_PERFORMANCE_INDEXES = {
    "idx_biz_task_storage_read": "(source_system, created_at, task_no)",
    "idx_biz_sample_storage_read": "(remark(32))",
    "idx_biz_tray_storage_read": "(remark(32), tray_no, task_id)",
    "idx_biz_schedule_storage_read": "(schedule_type, schedule_start_time, schedule_no)",
    "idx_biz_data_stream_storage_read": "(remark(32), last_packet_time, stream_no)",
}


class _IndexCursor:
    def __init__(self, existing: set[str] | None = None) -> None:
        self.existing = existing or set()
        self.statements: list[str] = []
        self._result = None

    def execute(self, sql, _params=None) -> None:
        statement = " ".join(str(sql).split())
        self.statements.append(statement)
        if statement.startswith("SHOW INDEX"):
            self._result = next(
                ({"Key_name": name} for name in self.existing if f"Key_name = '{name}'" in statement),
                None,
            )
        else:
            self._result = None

    def fetchone(self):
        return self._result


def test_ensure_performance_indexes_adds_each_missing_high_frequency_index() -> None:
    cursor = _IndexCursor()

    mysql_storage_schema.ensure_performance_indexes(cursor)

    alter_statements = [statement for statement in cursor.statements if statement.startswith("ALTER TABLE")]
    assert len(alter_statements) == len(EXPECTED_PERFORMANCE_INDEXES)
    for index_name, columns in EXPECTED_PERFORMANCE_INDEXES.items():
        assert any(f"ADD INDEX {index_name} {columns}" in statement for statement in alter_statements)


def test_ensure_performance_indexes_does_not_recreate_existing_indexes() -> None:
    cursor = _IndexCursor(existing=set(EXPECTED_PERFORMANCE_INDEXES))

    mysql_storage_schema.ensure_performance_indexes(cursor)

    assert not any(statement.startswith("ALTER TABLE") for statement in cursor.statements)


def test_schema_bootstrap_invokes_performance_index_check(monkeypatch) -> None:
    class Cursor:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, traceback):
            return False

        def execute(self, _sql, _params=None) -> None:
            return None

        def fetchone(self):
            return {"Field": "existing", "Type": "varchar(200)", "Key_name": "existing"}

    class Connection:
        def __init__(self) -> None:
            self.cursor_instance = Cursor()

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, traceback):
            return False

        def cursor(self):
            return self.cursor_instance

        def commit(self) -> None:
            return None

    connection = Connection()
    backend = SimpleNamespace(_schema_initialized=False, _connect=lambda: connection)
    checked_cursors = []
    monkeypatch.setattr(
        mysql_storage_schema,
        "ensure_performance_indexes",
        lambda cursor: checked_cursors.append(cursor),
    )

    mysql_storage_schema.ensure_schema_extensions(backend)

    assert checked_cursors == [connection.cursor_instance]
    assert backend._schema_initialized is True
