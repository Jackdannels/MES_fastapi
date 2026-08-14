from __future__ import annotations

from pathlib import Path

import pytest

import app.db.schema_version as schema_version
from app.db.schema_version import (
    LEGACY_REQUIRED_COLUMNS,
    LEGACY_REQUIRED_INDEXES,
    LEGACY_REQUIRED_TABLES,
    REQUIRED_SCHEMA_VERSION,
    require_schema_version,
)
from scripts import init_mysql_storage


REPO_ROOT = Path(__file__).resolve().parents[2]
V004_SQL = REPO_ROOT / "scripts" / "sql" / "V004__runtime_schema_finalization.sql"
V005_SQL = REPO_ROOT / "scripts" / "sql" / "V005__terminal_collation_alignment.sql"
V006_SQL = REPO_ROOT / "scripts" / "sql" / "V006__long_running_query_indexes.sql"
V007_SQL = REPO_ROOT / "scripts" / "sql" / "V007__bounded_event_retention_indexes.sql"
V008_SQL = REPO_ROOT / "scripts" / "sql" / "V008__fixture_install_schedule_identity.sql"


class _VersionCursor:
    def __init__(
        self,
        version_row=None,
        *,
        history_exists: bool = True,
        legacy_complete: bool = True,
        error: Exception | None = None,
    ) -> None:
        self.version_row = version_row
        self.history_exists = history_exists
        self.legacy_complete = legacy_complete
        self.error = error
        self.statements: list[tuple[str, object]] = []
        self.mode = ""

    def execute(self, sql, params=None) -> None:
        statement = " ".join(str(sql).split())
        self.statements.append((statement, params))
        if self.error is not None:
            raise self.error
        if "table_name = 'schema_migrations'" in statement:
            self.mode = "history"
        elif statement.startswith("SELECT version, success"):
            self.mode = "version"
        elif "FROM information_schema.tables" in statement:
            self.mode = "tables"
        elif "FROM information_schema.columns" in statement:
            self.mode = "columns"
        elif "FROM information_schema.statistics" in statement:
            self.mode = "indexes"

    def fetchone(self):
        if self.mode == "history":
            return (1 if self.history_exists else 0,)
        if self.mode == "version":
            return self.version_row
        return None

    def fetchall(self):
        if not self.legacy_complete:
            return []
        if self.mode == "tables":
            return [(table,) for table in LEGACY_REQUIRED_TABLES]
        if self.mode == "columns":
            return list(LEGACY_REQUIRED_COLUMNS)
        if self.mode == "indexes":
            return list(LEGACY_REQUIRED_INDEXES)
        return []


@pytest.mark.parametrize("row", [("V011", 1), {"version": "V011", "success": 1}])
def test_runtime_accepts_successful_required_schema_version(row, monkeypatch) -> None:
    cursor = _VersionCursor(row, history_exists=True)
    contract_checks = []
    monkeypatch.setattr(schema_version, "validate_schema_contract", lambda checked: contract_checks.append(checked))

    require_schema_version(cursor)

    assert cursor.statements[-1] == (
        "SELECT version, success FROM schema_migrations WHERE version = %s",
        ("V011",),
    )
    assert contract_checks == [cursor]


@pytest.mark.parametrize("row", [None, ("V010", 1), ("V011", 0)])
def test_runtime_rejects_missing_old_or_failed_schema_version(row) -> None:
    cursor = _VersionCursor(row, history_exists=True)

    with pytest.raises(RuntimeError, match="V011"):
        require_schema_version(cursor)


def test_runtime_accepts_complete_legacy_schema_without_migration_history(caplog, monkeypatch) -> None:
    cursor = _VersionCursor(history_exists=False, legacy_complete=True)
    monkeypatch.setattr(schema_version, "validate_schema_contract", lambda _cursor: None)

    require_schema_version(cursor, app_env="dev")

    assert "allowing a complete V011 legacy schema" in caplog.text


def test_runtime_rejects_incomplete_legacy_schema_without_migration_history(monkeypatch) -> None:
    cursor = _VersionCursor(history_exists=False, legacy_complete=False)
    monkeypatch.setattr(
        schema_version,
        "validate_schema_contract",
        lambda _cursor: (_ for _ in ()).throw(schema_version.SchemaContractError("column drift")),
    )

    with pytest.raises(RuntimeError, match="legacy schema is incomplete or has drifted"):
        require_schema_version(cursor, app_env="dev")


def test_runtime_rejects_historyless_schema_in_production_before_compatibility_check(monkeypatch) -> None:
    cursor = _VersionCursor(history_exists=False, legacy_complete=True)
    monkeypatch.setattr(
        schema_version,
        "validate_schema_contract",
        lambda _cursor: (_ for _ in ()).throw(AssertionError("must not run legacy fallback")),
    )

    with pytest.raises(RuntimeError, match="history is required in production"):
        require_schema_version(cursor, app_env="prod")


def test_runtime_rejects_schema_drift_even_when_v011_is_recorded(monkeypatch) -> None:
    cursor = _VersionCursor(("V011", 1), history_exists=True)
    monkeypatch.setattr(
        schema_version,
        "validate_schema_contract",
        lambda _cursor: (_ for _ in ()).throw(schema_version.SchemaContractError("index drift")),
    )

    with pytest.raises(RuntimeError, match="physical schema has drifted"):
        require_schema_version(cursor)


def test_runtime_reports_unreadable_schema_metadata() -> None:
    cursor = _VersionCursor(error=RuntimeError("table missing"))

    with pytest.raises(RuntimeError, match="metadata cannot be read"):
        require_schema_version(cursor)


def test_required_runtime_version_matches_latest_migration() -> None:
    assert REQUIRED_SCHEMA_VERSION == init_mysql_storage.SCHEMA_MIGRATIONS[-1].version


def test_application_runtime_contains_no_schema_mutation_sql() -> None:
    forbidden_tokens = (
        "CREATE TABLE",
        "ALTER TABLE",
        "DROP TABLE",
        "CREATE INDEX",
        "SHOW COLUMNS",
        "SHOW INDEX",
    )

    violations = []
    for path in (REPO_ROOT / "app").rglob("*.py"):
        text = path.read_text(encoding="utf-8").upper()
        for token in forbidden_tokens:
            if token in text:
                violations.append(f"{path.relative_to(REPO_ROOT)}: {token}")

    assert violations == []


def test_v004_contains_former_runtime_schema_extensions_only() -> None:
    sql = V004_SQL.read_text(encoding="utf-8")
    required_fragments = (
        "biz_task', 'transfer_status'",
        "biz_tray', 'fixture_ready'",
        "biz_schedule', 'axis_codes_json'",
        "biz_experiment_run', 'axis_batch_no'",
        "sys_attendance_user', 'qr_token_hash'",
        "idx_biz_task_storage_read",
        "idx_sys_attendance_user_qr_token_hash",
    )

    for fragment in required_fragments:
        assert fragment in sql
    assert "INSERT INTO" not in sql.upper()
    assert "DELETE FROM" not in sql.upper()


def test_v005_only_aligns_the_three_historical_terminal_table_collations() -> None:
    sql = V005_SQL.read_text(encoding="utf-8")
    upper = sql.upper()

    assert upper.count("ALTER TABLE") == 3
    for table_name in (
        "sys_fixed_terminal",
        "sys_terminal_runtime",
        "sys_terminal_command",
    ):
        assert f"ALTER TABLE `{table_name}`" in sql
    assert upper.count("CONVERT TO CHARACTER SET UTF8MB4 COLLATE UTF8MB4_UNICODE_CI") == 3
    for forbidden in ("INSERT INTO", "UPDATE ", "DELETE FROM", "DROP TABLE"):
        assert forbidden not in upper


def test_v006_adds_long_running_history_indexes_without_rewriting_the_baseline() -> None:
    sql = V006_SQL.read_text(encoding="utf-8")
    upper = sql.upper()
    baseline = (REPO_ROOT / "scripts" / "sql" / "0001-complete-baseline-schema.sql").read_text(encoding="utf-8")
    expected_indexes = {
        "idx_biz_mq_latest_command": (
            "direction, lab_code, message_type, created_at, message_log_id"
        ),
        "idx_biz_mq_status_created": "process_status, created_at, message_log_id",
        "idx_biz_mq_task_exp_created": (
            "task_no, experiment_no, created_at, message_log_id"
        ),
        "idx_biz_experiment_event_task_exp_time": (
            "task_no, experiment_no, event_time, experiment_event_id"
        ),
        "idx_biz_experiment_event_lab_type_time": (
            "lab_code, event_type, event_time, experiment_event_id"
        ),
    }

    assert "FROM information_schema.STATISTICS" in sql
    assert upper.count("CALL V6_ADD_INDEX_IF_MISSING") == len(expected_indexes)
    for index_name, columns in expected_indexes.items():
        assert f"ADD INDEX {index_name} ({columns})" in sql
        assert index_name not in baseline
    assert "DROP INDEX" not in upper
    for forbidden in ("INSERT INTO", "UPDATE ", "DELETE FROM", "DROP TABLE"):
        assert forbidden not in upper


def test_v007_adds_retention_indexes_without_mutating_business_rows() -> None:
    sql = V007_SQL.read_text(encoding="utf-8")
    upper = sql.upper()
    expected_indexes = {
        "idx_biz_mq_retention_created": "created_at, message_log_id",
        "idx_biz_mq_retention_state": (
            "direction, lab_code, task_no, experiment_no, sub_experiment_code, "
            "message_type, created_at, message_log_id"
        ),
        "idx_biz_experiment_event_retention_created": "created_at, experiment_event_id",
        "idx_biz_experiment_event_retention_state": (
            "task_no, experiment_no, sub_experiment_code, lab_code, event_type, "
            "created_at, experiment_event_id"
        ),
    }

    assert "USE `mes_single_branch`" in sql
    assert "FROM information_schema.statistics" in sql
    assert upper.count("CALL V7_ADD_INDEX_IF_MISSING") == len(expected_indexes)
    for index_name, columns in expected_indexes.items():
        assert f"ADD INDEX {index_name} ({columns})" in sql
    for forbidden in ("INSERT INTO", "UPDATE ", "DELETE FROM", "DROP TABLE"):
        assert forbidden not in upper


def test_v008_adds_fixture_schedule_identity_and_discards_unscoped_pending_rows() -> None:
    sql = V008_SQL.read_text(encoding="utf-8")
    upper = sql.upper()
    baseline = (REPO_ROOT / "scripts" / "sql" / "0001-complete-baseline-schema.sql").read_text(encoding="utf-8")
    pending_baseline = baseline.split("-- biz_fixture_install_pending", 1)[1].split("-- biz_experiment_result", 1)[0]

    assert "USE `mes_single_branch`" in sql
    assert "DELETE FROM biz_fixture_install_pending" in sql
    assert upper.count("CALL V8_ADD_COLUMN_IF_MISSING") == 2
    assert upper.count("CALL V8_ADD_INDEX_IF_MISSING") == 1
    assert "ADD COLUMN schedule_no VARCHAR(80) NOT NULL AFTER experiment_no" in sql
    assert "ADD COLUMN sub_experiment_code VARCHAR(80) NULL AFTER schedule_no" in sql
    assert (
        "ADD INDEX idx_biz_fixture_install_pending_task_tray_status "
        "(task_no, tray_no, status)"
    ) in sql
    assert upper.count("DELETE FROM") == 1
    assert "`schedule_no`" not in pending_baseline
    assert "`sub_experiment_code`" not in pending_baseline
    assert "idx_biz_fixture_install_pending_task_tray_status" not in pending_baseline
    for forbidden in ("INSERT INTO", "UPDATE ", "DROP TABLE"):
        assert forbidden not in upper
