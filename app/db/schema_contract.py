from __future__ import annotations

import json
import re
from collections import defaultdict
from pathlib import Path
from typing import Any, Mapping


CONTRACT_PATH = Path(__file__).with_name("schema_contract.json")
SCHEMA_CONTRACT: dict[str, Any] = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))
REQUIRED_SCHEMA_TABLES = frozenset(SCHEMA_CONTRACT["tables"])

_INTEGER_DISPLAY_WIDTH_RE = re.compile(
    r"^(tinyint|smallint|mediumint|int|integer|bigint)\(\d+\)( unsigned)?$",
    re.IGNORECASE,
)


class SchemaContractError(RuntimeError):
    """Raised when an initialized database has drifted from the release contract."""


def _row_mapping(row: Any, field_names: tuple[str, ...]) -> dict[str, Any]:
    if isinstance(row, Mapping):
        lowered = {str(key).lower(): value for key, value in row.items()}
        return {field: lowered.get(field.lower()) for field in field_names}
    if isinstance(row, (tuple, list)):
        return {field: row[index] if index < len(row) else None for index, field in enumerate(field_names)}
    return {field: None for field in field_names}


def _first_value(row: Any, default: Any = None) -> Any:
    if isinstance(row, Mapping):
        return next(iter(row.values()), default)
    if isinstance(row, (tuple, list)) and row:
        return row[0]
    return default


def _normalize_column_type(value: Any) -> str:
    normalized = " ".join(str(value or "").strip().lower().split())
    match = _INTEGER_DISPLAY_WIDTH_RE.match(normalized)
    if match:
        integer_type = "int" if match.group(1).lower() == "integer" else match.group(1).lower()
        return integer_type + (match.group(2) or "")
    return normalized


def _normalize_default(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, bytes):
        value = value.decode("utf-8")
    normalized = str(value).strip()
    while normalized.startswith("(") and normalized.endswith(")"):
        normalized = normalized[1:-1].strip()
    lowered = normalized.lower()
    if lowered in {"current_timestamp", "current_timestamp()"}:
        return "current_timestamp"
    return normalized


def _normalize_rule(value: Any) -> str:
    normalized = " ".join(str(value or "RESTRICT").strip().upper().split())
    return "RESTRICT" if normalized == "NO ACTION" else normalized


def _database_name(cursor: Any, database: str | None) -> str:
    if database:
        return database
    cursor.execute("SELECT DATABASE()")
    resolved = str(_first_value(cursor.fetchone()) or "").strip()
    if not resolved:
        raise SchemaContractError("MySQL schema contract cannot be checked without a selected database.")
    return resolved


def _read_tables(cursor: Any, database: str) -> dict[str, dict[str, Any]]:
    cursor.execute(
        """
        SELECT table_name, engine, table_collation
        FROM information_schema.tables
        WHERE table_schema = %s AND table_type = 'BASE TABLE'
        """,
        (database,),
    )
    fields = ("table_name", "engine", "table_collation")
    rows = (_row_mapping(row, fields) for row in (cursor.fetchall() or ()))
    return {str(row["table_name"]): row for row in rows}


def _read_columns(cursor: Any, database: str) -> dict[tuple[str, str], dict[str, Any]]:
    cursor.execute(
        """
        SELECT table_name, column_name, column_type, is_nullable, column_default,
               extra, character_set_name, collation_name
        FROM information_schema.columns
        WHERE table_schema = %s
        """,
        (database,),
    )
    fields = (
        "table_name",
        "column_name",
        "column_type",
        "is_nullable",
        "column_default",
        "extra",
        "character_set_name",
        "collation_name",
    )
    rows = (_row_mapping(row, fields) for row in (cursor.fetchall() or ()))
    return {(str(row["table_name"]), str(row["column_name"])): row for row in rows}


def _read_indexes(cursor: Any, database: str) -> dict[tuple[str, str], dict[str, Any]]:
    cursor.execute(
        """
        SELECT table_name, index_name, non_unique, seq_in_index, column_name, sub_part
        FROM information_schema.statistics
        WHERE table_schema = %s
        ORDER BY table_name, index_name, seq_in_index
        """,
        (database,),
    )
    fields = ("table_name", "index_name", "non_unique", "seq_in_index", "column_name", "sub_part")
    grouped: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for raw_row in cursor.fetchall() or ():
        row = _row_mapping(raw_row, fields)
        grouped[(str(row["table_name"]), str(row["index_name"]))].append(row)
    indexes: dict[tuple[str, str], dict[str, Any]] = {}
    for key, rows in grouped.items():
        ordered = sorted(rows, key=lambda row: int(row["seq_in_index"] or 0))
        indexes[key] = {
            "unique": not bool(int(ordered[0]["non_unique"] or 0)),
            "columns": [str(row["column_name"] or "") for row in ordered],
            "sub_parts": [row["sub_part"] for row in ordered],
        }
    return indexes


def _read_foreign_keys(cursor: Any, database: str) -> dict[tuple[str, str], dict[str, Any]]:
    cursor.execute(
        """
        SELECT k.table_name, k.constraint_name, k.column_name, k.ordinal_position,
               k.referenced_table_name, k.referenced_column_name,
               r.update_rule, r.delete_rule
        FROM information_schema.key_column_usage AS k
        JOIN information_schema.referential_constraints AS r
          ON r.constraint_schema = k.constraint_schema
         AND r.table_name = k.table_name
         AND r.constraint_name = k.constraint_name
        WHERE k.constraint_schema = %s AND k.referenced_table_name IS NOT NULL
        ORDER BY k.table_name, k.constraint_name, k.ordinal_position
        """,
        (database,),
    )
    fields = (
        "table_name",
        "constraint_name",
        "column_name",
        "ordinal_position",
        "referenced_table_name",
        "referenced_column_name",
        "update_rule",
        "delete_rule",
    )
    grouped: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for raw_row in cursor.fetchall() or ():
        row = _row_mapping(raw_row, fields)
        grouped[(str(row["table_name"]), str(row["constraint_name"]))].append(row)
    foreign_keys: dict[tuple[str, str], dict[str, Any]] = {}
    for key, rows in grouped.items():
        ordered = sorted(rows, key=lambda row: int(row["ordinal_position"] or 0))
        foreign_keys[key] = {
            "columns": [str(row["column_name"] or "") for row in ordered],
            "referenced_table": str(ordered[0]["referenced_table_name"] or ""),
            "referenced_columns": [str(row["referenced_column_name"] or "") for row in ordered],
            "update_rule": _normalize_rule(ordered[0]["update_rule"]),
            "delete_rule": _normalize_rule(ordered[0]["delete_rule"]),
        }
    return foreign_keys


def find_schema_contract_gaps(
    cursor: Any,
    *,
    database: str | None = None,
    contract: Mapping[str, Any] | None = None,
) -> list[str]:
    expected_tables = (contract or SCHEMA_CONTRACT)["tables"]
    database_name = _database_name(cursor, database)
    actual_tables = _read_tables(cursor, database_name)
    actual_columns = _read_columns(cursor, database_name)
    actual_indexes = _read_indexes(cursor, database_name)
    actual_foreign_keys = _read_foreign_keys(cursor, database_name)
    gaps: list[str] = []

    for table_name, expected_table in expected_tables.items():
        actual_table = actual_tables.get(table_name)
        if actual_table is None:
            gaps.append(f"table:{table_name}:missing")
            continue
        actual_engine = str(actual_table["engine"] or "").lower()
        expected_engine = str(expected_table["engine"]).lower()
        if actual_engine != expected_engine:
            gaps.append(f"table:{table_name}:engine={actual_engine or 'missing'} expected={expected_engine}")
        actual_collation = str(actual_table["table_collation"] or "").lower()
        expected_collation = str(expected_table["collation"]).lower()
        if actual_collation != expected_collation:
            gaps.append(
                f"table:{table_name}:collation={actual_collation or 'missing'} expected={expected_collation}"
            )
        actual_charset = actual_collation.split("_", 1)[0]
        expected_charset = str(expected_table["charset"]).lower()
        if actual_charset != expected_charset:
            gaps.append(f"table:{table_name}:charset={actual_charset or 'missing'} expected={expected_charset}")

        for column_name, expected_column in expected_table["columns"].items():
            actual_column = actual_columns.get((table_name, column_name))
            if actual_column is None:
                gaps.append(f"column:{table_name}.{column_name}:missing")
                continue
            comparisons = (
                ("type", _normalize_column_type(actual_column["column_type"]), _normalize_column_type(expected_column["type"])),
                ("nullable", str(actual_column["is_nullable"] or "").upper() == "YES", bool(expected_column["nullable"])),
                ("default", _normalize_default(actual_column["column_default"]), _normalize_default(expected_column["default"])),
                ("auto_increment", "auto_increment" in str(actual_column["extra"] or "").lower(), bool(expected_column["auto_increment"])),
                ("charset", str(actual_column["character_set_name"] or "").lower() or None, expected_column["charset"]),
                ("collation", str(actual_column["collation_name"] or "").lower() or None, expected_column["collation"]),
            )
            for attribute, actual_value, expected_value in comparisons:
                if actual_value != expected_value:
                    gaps.append(
                        f"column:{table_name}.{column_name}:{attribute}={actual_value!r} expected={expected_value!r}"
                    )

        for index_name, expected_index in expected_table["indexes"].items():
            actual_index = actual_indexes.get((table_name, index_name))
            if actual_index is None:
                gaps.append(f"index:{table_name}.{index_name}:missing")
                continue
            if actual_index["columns"] != expected_index["columns"]:
                gaps.append(
                    f"index:{table_name}.{index_name}:columns={actual_index['columns']!r} "
                    f"expected={expected_index['columns']!r}"
                )
            if actual_index["unique"] != expected_index["unique"]:
                gaps.append(
                    f"index:{table_name}.{index_name}:unique={actual_index['unique']!r} "
                    f"expected={expected_index['unique']!r}"
                )
            expected_sub_parts = expected_index.get("sub_parts", [None] * len(expected_index["columns"]))
            actual_sub_parts = [int(part) if part is not None else None for part in actual_index["sub_parts"]]
            if actual_sub_parts != expected_sub_parts:
                gaps.append(
                    f"index:{table_name}.{index_name}:sub_parts={actual_sub_parts!r} "
                    f"expected={expected_sub_parts!r}"
                )

        for foreign_key_name, expected_foreign_key in expected_table["foreign_keys"].items():
            actual_foreign_key = actual_foreign_keys.get((table_name, foreign_key_name))
            if actual_foreign_key is None:
                gaps.append(f"foreign_key:{table_name}.{foreign_key_name}:missing")
                continue
            normalized_expected = {
                **expected_foreign_key,
                "update_rule": _normalize_rule(expected_foreign_key["update_rule"]),
                "delete_rule": _normalize_rule(expected_foreign_key["delete_rule"]),
            }
            if actual_foreign_key != normalized_expected:
                gaps.append(
                    f"foreign_key:{table_name}.{foreign_key_name}:definition={actual_foreign_key!r} "
                    f"expected={normalized_expected!r}"
                )

    return gaps


def validate_schema_contract(cursor: Any, *, database: str | None = None) -> None:
    gaps = find_schema_contract_gaps(cursor, database=database)
    if not gaps:
        return
    preview = "; ".join(gaps[:8])
    remainder = len(gaps) - 8
    suffix = f"; and {remainder} more" if remainder > 0 else ""
    raise SchemaContractError(
        f"MySQL schema does not match the {SCHEMA_CONTRACT['contract_version']} release contract. "
        f"Drift: {preview}{suffix}. Restore the missing objects with a DBA-reviewed repair migration "
        "or from a known-good backup, then rerun scripts/init_mysql_storage.py to validate the schema."
    )
