from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import pytest

from app.core import mysql_storage_schema


V004_SQL = Path("scripts/sql/V004__runtime_schema_finalization.sql")
EXPECTED_PERFORMANCE_INDEXES = {
    "idx_biz_task_storage_read": "(source_system, created_at, task_no)",
    "idx_biz_sample_storage_read": "(remark(32))",
    "idx_biz_tray_storage_read": "(remark(32), tray_no, task_id)",
    "idx_biz_schedule_storage_read": "(schedule_type, schedule_start_time, schedule_no)",
    "idx_biz_data_stream_storage_read": "(remark(32), last_packet_time, stream_no)",
}


class _Cursor:
    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return False


class _Connection:
    def __init__(self) -> None:
        self.cursor_instance = _Cursor()

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return False

    def cursor(self):
        return self.cursor_instance


def test_runtime_schema_check_only_validates_migration_version(monkeypatch) -> None:
    connection = _Connection()
    backend = SimpleNamespace(_schema_initialized=False, _connect=lambda: connection)
    checked_cursors = []
    monkeypatch.setattr(
        mysql_storage_schema,
        "require_schema_version",
        lambda cursor: checked_cursors.append(cursor),
    )

    mysql_storage_schema.ensure_schema_extensions(backend)
    mysql_storage_schema.ensure_schema_extensions(backend)

    assert checked_cursors == [connection.cursor_instance]
    assert backend._schema_initialized is True


def test_runtime_schema_check_does_not_mark_failed_validation_ready(monkeypatch) -> None:
    connection = _Connection()
    backend = SimpleNamespace(_schema_initialized=False, _connect=lambda: connection)
    monkeypatch.setattr(
        mysql_storage_schema,
        "require_schema_version",
        lambda _cursor: (_ for _ in ()).throw(RuntimeError("V004 required")),
    )

    with pytest.raises(RuntimeError, match="V004 required"):
        mysql_storage_schema.ensure_schema_extensions(backend)

    assert backend._schema_initialized is False


def test_v004_migration_owns_high_frequency_indexes() -> None:
    sql = V004_SQL.read_text(encoding="utf-8")

    for index_name, columns in EXPECTED_PERFORMANCE_INDEXES.items():
        assert index_name in sql
        assert columns in sql
