from __future__ import annotations

from copy import deepcopy
from pathlib import Path

import pytest

from app.db.schema_contract import (
    CONTRACT_PATH,
    SCHEMA_CONTRACT,
    SchemaContractError,
    find_schema_contract_gaps,
    validate_schema_contract,
)
from app.db.schema_version import LEGACY_REQUIRED_INDEXES
from scripts.generate_schema_contract import render_contract
from scripts import init_mysql_storage


def _column(
    column_type: str,
    *,
    nullable: bool = False,
    default=None,
    auto_increment: bool = False,
    text: bool = False,
):
    return {
        "type": column_type,
        "nullable": nullable,
        "default": default,
        "auto_increment": auto_increment,
        "charset": "utf8mb4" if text else None,
        "collation": "utf8mb4_unicode_ci" if text else None,
    }


SMALL_CONTRACT = {
    "tables": {
        "parent": {
            "engine": "InnoDB",
            "charset": "utf8mb4",
            "collation": "utf8mb4_unicode_ci",
            "columns": {
                "id": _column("bigint", auto_increment=True),
                "code": _column("varchar(20)", text=True),
            },
            "indexes": {
                "PRIMARY": {"unique": True, "columns": ["id"]},
                "uk_parent_code": {"unique": True, "columns": ["code"]},
            },
            "foreign_keys": {},
        },
        "child": {
            "engine": "InnoDB",
            "charset": "utf8mb4",
            "collation": "utf8mb4_unicode_ci",
            "columns": {
                "id": _column("bigint", auto_increment=True),
                "parent_id": _column("bigint"),
                "label": _column("varchar(40)", default="new", text=True),
            },
            "indexes": {
                "PRIMARY": {"unique": True, "columns": ["id"]},
                "idx_child_parent": {"unique": False, "columns": ["parent_id"]},
                "idx_child_label": {"unique": False, "columns": ["label"]},
            },
            "foreign_keys": {
                "fk_child_parent": {
                    "columns": ["parent_id"],
                    "referenced_table": "parent",
                    "referenced_columns": ["id"],
                    "update_rule": "RESTRICT",
                    "delete_rule": "RESTRICT",
                }
            },
        },
    }
}


class _ContractCursor:
    def __init__(self) -> None:
        self.mode = ""
        self.tables = [
            ("parent", "InnoDB", "utf8mb4_unicode_ci"),
            ("child", "InnoDB", "utf8mb4_unicode_ci"),
            ("extra_table", "InnoDB", "utf8mb4_unicode_ci"),
        ]
        self.columns = [
            ("parent", "id", "bigint(20)", "NO", None, "auto_increment", None, None),
            ("parent", "code", "varchar(20)", "NO", None, "", "utf8mb4", "utf8mb4_unicode_ci"),
            ("parent", "extra_column", "int", "YES", None, "", None, None),
            ("child", "id", "bigint", "NO", None, "auto_increment", None, None),
            ("child", "parent_id", "bigint", "NO", None, "", None, None),
            ("child", "label", "varchar(40)", "NO", "new", "", "utf8mb4", "utf8mb4_unicode_ci"),
        ]
        self.indexes = [
            ("parent", "PRIMARY", 0, 1, "id", None),
            ("parent", "uk_parent_code", 0, 1, "code", None),
            ("parent", "idx_extra", 1, 1, "extra_column", None),
            ("child", "PRIMARY", 0, 1, "id", None),
            ("child", "idx_child_parent", 1, 1, "parent_id", None),
            ("child", "idx_child_label", 1, 1, "label", None),
        ]
        self.foreign_keys = [
            ("child", "fk_child_parent", "parent_id", 1, "parent", "id", "NO ACTION", "RESTRICT")
        ]

    def execute(self, sql, params=None) -> None:
        normalized = " ".join(str(sql).split())
        if normalized == "SELECT DATABASE()":
            self.mode = "database"
        elif "FROM information_schema.tables" in normalized:
            self.mode = "tables"
        elif "FROM information_schema.columns" in normalized:
            self.mode = "columns"
        elif "FROM information_schema.statistics" in normalized:
            self.mode = "indexes"
        elif "FROM information_schema.key_column_usage" in normalized:
            self.mode = "foreign_keys"
        else:
            raise AssertionError(f"Unexpected SQL: {normalized}")

    def fetchone(self):
        return ("isolated_test_db",) if self.mode == "database" else None

    def fetchall(self):
        return getattr(self, self.mode)


def test_complete_contract_accepts_required_objects_and_ignores_extras() -> None:
    assert find_schema_contract_gaps(_ContractCursor(), contract=SMALL_CONTRACT) == []


@pytest.mark.parametrize(
    ("mutate", "expected_gap"),
    [
        (lambda cursor: cursor.tables.__setitem__(0, ("parent", "MyISAM", "utf8mb4_unicode_ci")), "engine"),
        (
            lambda cursor: cursor.columns.__setitem__(
                1, ("parent", "code", "varchar(30)", "NO", None, "", "utf8mb4", "utf8mb4_unicode_ci")
            ),
            "column:parent.code:type",
        ),
        (
            lambda cursor: cursor.columns.__setitem__(
                5, ("child", "label", "varchar(40)", "YES", "old", "", "utf8mb4", "utf8mb4_general_ci")
            ),
            "column:child.label:nullable",
        ),
        (lambda cursor: cursor.indexes.pop(0), "index:parent.PRIMARY:missing"),
        (lambda cursor: cursor.indexes.pop(1), "index:parent.uk_parent_code:missing"),
        (lambda cursor: cursor.indexes.pop(5), "index:child.idx_child_label:missing"),
        (lambda cursor: cursor.foreign_keys.clear(), "foreign_key:child.fk_child_parent:missing"),
    ],
)
def test_complete_contract_reports_physical_drift(mutate, expected_gap) -> None:
    cursor = _ContractCursor()
    mutate(cursor)

    gaps = find_schema_contract_gaps(cursor, contract=deepcopy(SMALL_CONTRACT))

    assert any(expected_gap in gap for gap in gaps)


def test_contract_validation_raises_actionable_error() -> None:
    cursor = _ContractCursor()
    cursor.tables.pop(0)

    with pytest.raises(SchemaContractError, match="V008 release contract"):
        validate_schema_contract(cursor, database="isolated_test_db")


def test_checked_in_contract_is_fresh_and_covers_all_baseline_objects() -> None:
    assert CONTRACT_PATH.read_text(encoding="utf-8") == render_contract()
    assert SCHEMA_CONTRACT["contract_version"] == "V008"
    assert [source["source"] for source in SCHEMA_CONTRACT["index_sources"]] == [
        "scripts/sql/V006__long_running_query_indexes.sql",
        "scripts/sql/V007__bounded_event_retention_indexes.sql",
        "scripts/sql/V008__fixture_install_schedule_identity.sql",
    ]
    assert len(SCHEMA_CONTRACT["tables"]) == 39
    assert sum(len(table["columns"]) for table in SCHEMA_CONTRACT["tables"].values()) == 511
    assert sum(len(table["indexes"]) for table in SCHEMA_CONTRACT["tables"].values()) == 159
    assert sum(len(table["foreign_keys"]) for table in SCHEMA_CONTRACT["tables"].values()) == 38

    pending_table = SCHEMA_CONTRACT["tables"]["biz_fixture_install_pending"]
    assert pending_table["columns"]["schedule_no"] == {
        "auto_increment": False,
        "charset": "utf8mb4",
        "collation": "utf8mb4_unicode_ci",
        "default": None,
        "nullable": False,
        "type": "varchar(80)",
    }
    assert pending_table["columns"]["sub_experiment_code"]["nullable"] is True
    assert pending_table["indexes"]["idx_biz_fixture_install_pending_task_tray_status"]["columns"] == [
        "task_no",
        "tray_no",
        "status",
    ]


def test_v006_v007_and_v008_extensions_are_part_of_the_runtime_contract() -> None:
    expected_indexes = {
        ("biz_mq_message_log", "idx_biz_mq_latest_command"): [
            "direction", "lab_code", "message_type", "created_at", "message_log_id"
        ],
        ("biz_mq_message_log", "idx_biz_mq_status_created"): [
            "process_status", "created_at", "message_log_id"
        ],
        ("biz_mq_message_log", "idx_biz_mq_task_exp_created"): [
            "task_no", "experiment_no", "created_at", "message_log_id"
        ],
        ("biz_mq_message_log", "idx_biz_mq_retention_created"): [
            "created_at", "message_log_id"
        ],
        ("biz_mq_message_log", "idx_biz_mq_retention_state"): [
            "direction", "lab_code", "task_no", "experiment_no", "sub_experiment_code",
            "message_type", "created_at", "message_log_id"
        ],
        ("biz_experiment_event", "idx_biz_experiment_event_task_exp_time"): [
            "task_no", "experiment_no", "event_time", "experiment_event_id"
        ],
        ("biz_experiment_event", "idx_biz_experiment_event_lab_type_time"): [
            "lab_code", "event_type", "event_time", "experiment_event_id"
        ],
        ("biz_experiment_event", "idx_biz_experiment_event_retention_created"): [
            "created_at", "experiment_event_id"
        ],
        ("biz_experiment_event", "idx_biz_experiment_event_retention_state"): [
            "task_no", "experiment_no", "sub_experiment_code", "lab_code", "event_type",
            "created_at", "experiment_event_id"
        ],
    }

    for (table_name, index_name), columns in expected_indexes.items():
        definition = SCHEMA_CONTRACT["tables"][table_name]["indexes"][index_name]
        assert definition == {
            "unique": False,
            "columns": columns,
            "sub_parts": [None] * len(columns),
        }
        assert (table_name, index_name) in LEGACY_REQUIRED_INDEXES


class _Connection:
    def __init__(self, cursor) -> None:
        self._cursor = cursor

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return False

    def cursor(self):
        return self._cursor


class _ContextCursor:
    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return False


def test_migration_runner_performs_full_contract_validation(monkeypatch) -> None:
    cursor = _ContextCursor()
    checked = []
    monkeypatch.setattr(init_mysql_storage, "find_missing_schema_tables", lambda: [])
    monkeypatch.setattr(init_mysql_storage, "_connect_mysql", lambda **_kwargs: _Connection(cursor))
    monkeypatch.setattr(
        init_mysql_storage,
        "validate_schema_contract",
        lambda actual_cursor, *, database: checked.append((actual_cursor, database)),
    )

    init_mysql_storage.validate_required_schema_tables_exist()

    assert checked == [(cursor, init_mysql_storage.settings.MYSQL_DATABASE)]
