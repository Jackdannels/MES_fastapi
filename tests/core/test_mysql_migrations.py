from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from typing import Any
import sys

import pytest

from scripts import init_mysql_storage


def test_migration_connection_uses_dedicated_credentials_in_production(monkeypatch) -> None:
    connect_calls = []
    sentinel = object()
    monkeypatch.setitem(
        sys.modules,
        "pymysql",
        SimpleNamespace(connect=lambda **kwargs: connect_calls.append(kwargs) or sentinel),
    )
    monkeypatch.setattr(init_mysql_storage.settings, "APP_ENV", "prod")
    monkeypatch.setattr(init_mysql_storage.settings, "MYSQL_USER", "mes_api")
    monkeypatch.setattr(init_mysql_storage.settings, "MYSQL_PASSWORD", "api-secret")
    monkeypatch.setattr(init_mysql_storage.settings, "MYSQL_MIGRATION_USER", "mes_migrator")
    monkeypatch.setattr(init_mysql_storage.settings, "MYSQL_MIGRATION_PASSWORD", "migration-secret")

    connection = init_mysql_storage._connect_mysql(database="mes_prod")

    assert connection is sentinel
    assert connect_calls[0]["user"] == "mes_migrator"
    assert connect_calls[0]["password"] == "migration-secret"
    assert connect_calls[0]["database"] == "mes_prod"


class _MigrationCursor:
    def __init__(self, records: dict[str, tuple[Any, ...]], *, lock_result: int = 1) -> None:
        self.records = records
        self.lock_result = lock_result
        self.result: tuple[Any, ...] | None = None
        self.statements: list[str] = []

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return False

    def execute(self, sql: str, params: tuple[Any, ...] | None = None) -> None:
        normalized = " ".join(sql.split())
        self.statements.append(normalized)
        if normalized.startswith("SELECT GET_LOCK"):
            self.result = (self.lock_result,)
            return
        if normalized.startswith("SELECT RELEASE_LOCK"):
            self.result = (1,)
            return
        if normalized.startswith("CREATE TABLE IF NOT EXISTS schema_migrations"):
            self.result = None
            return
        if normalized.startswith("SELECT version, checksum, success, error_message"):
            assert params is not None
            self.result = self.records.get(str(params[0]))
            return
        if normalized.startswith("INSERT INTO schema_migrations"):
            assert params is not None
            version, _description, _script_name, checksum, _execution_ms, success, error_message = params
            self.records[str(version)] = (version, checksum, success, error_message)
            self.result = None
            return
        raise AssertionError(f"Unexpected migration SQL: {normalized}")

    def fetchone(self):
        return self.result


class _MigrationConnection:
    def __init__(self, cursor: _MigrationCursor) -> None:
        self._cursor = cursor
        self.commits = 0
        self.rollbacks = 0

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return False

    def cursor(self):
        return self._cursor

    def commit(self) -> None:
        self.commits += 1

    def rollback(self) -> None:
        self.rollbacks += 1


def _migration(version: str, path: Path) -> init_mysql_storage.SchemaMigration:
    return init_mysql_storage.SchemaMigration(version, f"migration {version}", path)


def test_pending_migrations_run_once_in_version_order(monkeypatch, tmp_path) -> None:
    first_path = tmp_path / "V001.sql"
    second_path = tmp_path / "V002.sql"
    first_path.write_text("SELECT 1;", encoding="utf-8")
    second_path.write_text("SELECT 2;", encoding="utf-8")
    migrations = [_migration("V001", first_path), _migration("V002", second_path)]
    records: dict[str, tuple[Any, ...]] = {}
    cursor = _MigrationCursor(records)
    connection = _MigrationConnection(cursor)
    applied_paths: list[Path] = []
    commits_before_ddl: list[int] = []

    monkeypatch.setattr(init_mysql_storage, "iter_schema_migrations", lambda: migrations)
    monkeypatch.setattr(init_mysql_storage, "_connect_mysql", lambda **_kwargs: connection)
    def _apply_sql_file(path: Path) -> None:
        commits_before_ddl.append(connection.commits)
        applied_paths.append(path)

    monkeypatch.setattr(init_mysql_storage, "apply_sql_file", _apply_sql_file)

    first_run = init_mysql_storage.apply_pending_schema_migrations()
    second_run = init_mysql_storage.apply_pending_schema_migrations()

    assert first_run == ["V001", "V002"]
    assert second_run == []
    assert applied_paths == [first_path, second_path]
    assert commits_before_ddl == [2, 4]
    assert set(records) == {"V001", "V002"}
    assert all(record[2] == 1 for record in records.values())


def test_applied_migration_checksum_mismatch_is_rejected(monkeypatch, tmp_path) -> None:
    path = tmp_path / "V001.sql"
    path.write_text("SELECT 1;", encoding="utf-8")
    migration = _migration("V001", path)
    records = {"V001": ("V001", "changed-checksum", 1, None)}
    connection = _MigrationConnection(_MigrationCursor(records))

    monkeypatch.setattr(init_mysql_storage, "iter_schema_migrations", lambda: [migration])
    monkeypatch.setattr(init_mysql_storage, "_connect_mysql", lambda **_kwargs: connection)

    with pytest.raises(RuntimeError, match="checksum mismatch"):
        init_mysql_storage.apply_pending_schema_migrations()


def test_previously_failed_migration_requires_manual_repair(monkeypatch, tmp_path) -> None:
    path = tmp_path / "V001.sql"
    path.write_text("SELECT 1;", encoding="utf-8")
    migration = _migration("V001", path)
    checksum = init_mysql_storage.calculate_migration_checksum(path)
    records = {"V001": ("V001", checksum, 0, "original failure")}
    connection = _MigrationConnection(_MigrationCursor(records))

    monkeypatch.setattr(init_mysql_storage, "iter_schema_migrations", lambda: [migration])
    monkeypatch.setattr(init_mysql_storage, "_connect_mysql", lambda **_kwargs: connection)

    with pytest.raises(RuntimeError, match="previously failed"):
        init_mysql_storage.apply_pending_schema_migrations()


def test_failed_migration_is_recorded_and_lock_is_released(monkeypatch, tmp_path) -> None:
    path = tmp_path / "V001.sql"
    path.write_text("INVALID;", encoding="utf-8")
    migration = _migration("V001", path)
    records: dict[str, tuple[Any, ...]] = {}
    cursor = _MigrationCursor(records)
    connection = _MigrationConnection(cursor)

    monkeypatch.setattr(init_mysql_storage, "iter_schema_migrations", lambda: [migration])
    monkeypatch.setattr(init_mysql_storage, "_connect_mysql", lambda **_kwargs: connection)
    monkeypatch.setattr(
        init_mysql_storage,
        "apply_sql_file",
        lambda _path: (_ for _ in ()).throw(ValueError("invalid SQL")),
    )

    with pytest.raises(RuntimeError, match="V001 failed"):
        init_mysql_storage.apply_pending_schema_migrations()

    assert records["V001"][2] == 0
    assert records["V001"][3] == "invalid SQL"
    assert connection.rollbacks == 1
    assert any(statement.startswith("SELECT RELEASE_LOCK") for statement in cursor.statements)


def test_final_migration_is_not_recorded_successful_when_contract_validation_fails(
    monkeypatch,
    tmp_path,
) -> None:
    path = tmp_path / "V005.sql"
    path.write_text("SELECT 1;", encoding="utf-8")
    migration = _migration("V005", path)
    records: dict[str, tuple[Any, ...]] = {}
    control_cursor = _MigrationCursor(records)
    validation_cursor = _MigrationCursor({})
    connections = iter(
        [_MigrationConnection(control_cursor), _MigrationConnection(validation_cursor)]
    )

    monkeypatch.setattr(init_mysql_storage, "iter_schema_migrations", lambda: [migration])
    monkeypatch.setattr(init_mysql_storage, "_connect_mysql", lambda **_kwargs: next(connections))
    monkeypatch.setattr(init_mysql_storage, "apply_sql_file", lambda _path: None)
    monkeypatch.setattr(
        init_mysql_storage,
        "validate_schema_contract",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(RuntimeError("schema drift")),
    )

    with pytest.raises(RuntimeError, match="V005 failed.*schema drift"):
        init_mysql_storage.apply_pending_schema_migrations()

    assert records["V005"][2] == 0
    assert records["V005"][3] == "schema drift"


def test_migration_stops_when_database_lock_cannot_be_acquired(monkeypatch) -> None:
    cursor = _MigrationCursor({}, lock_result=0)
    connection = _MigrationConnection(cursor)
    monkeypatch.setattr(init_mysql_storage, "_connect_mysql", lambda **_kwargs: connection)

    with pytest.raises(RuntimeError, match="Could not acquire"):
        init_mysql_storage.apply_pending_schema_migrations()
