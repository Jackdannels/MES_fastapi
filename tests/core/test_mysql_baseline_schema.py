import re
from pathlib import Path

from scripts import init_mysql_storage


BASELINE_SQL = Path("scripts/sql/0001-complete-baseline-schema.sql")


def _baseline_sql() -> str:
    return BASELINE_SQL.read_text(encoding="utf-8")


def test_complete_baseline_covers_the_required_schema_contract() -> None:
    sql = _baseline_sql()
    created_tables = re.findall(
        r"^CREATE TABLE IF NOT EXISTS `([^`]+)`",
        sql,
        flags=re.MULTILINE,
    )

    assert len(created_tables) == len(set(created_tables)) == 39
    assert set(created_tables) == set(init_mysql_storage.REQUIRED_SCHEMA_TABLES)


def test_complete_baseline_contains_schema_only() -> None:
    sql = _baseline_sql()

    assert re.search(r"\bINSERT\s+INTO\b", sql, flags=re.IGNORECASE) is None
    assert re.search(r"\bUPDATE\s+`?\w+`?\s+SET\b", sql, flags=re.IGNORECASE) is None
    assert re.search(r"\bDELETE\s+FROM\b", sql, flags=re.IGNORECASE) is None
    assert re.search(r"AUTO_INCREMENT\s*=\s*\d+", sql, flags=re.IGNORECASE) is None
    assert "DEFINER=" not in sql.upper()


def test_complete_baseline_is_safe_to_reapply() -> None:
    sql = _baseline_sql()

    assert len(re.findall(r"^CREATE TABLE IF NOT EXISTS ", sql, flags=re.MULTILINE)) == 39
    assert "@sys_dept_manager_fk_exists" in sql
    assert "CONSTRAINT_NAME = 'fk_sys_dept_manager'" in sql
    assert "PREPARE sys_dept_manager_fk_stmt" in sql


def test_complete_baseline_creates_foreign_key_targets_first() -> None:
    created_tables: list[str] = []

    for line in _baseline_sql().splitlines():
        table_match = re.match(r"^CREATE TABLE IF NOT EXISTS `([^`]+)`", line)
        if table_match:
            created_tables.append(table_match.group(1))
        for referenced_table in re.findall(r"REFERENCES `([^`]+)`", line):
            assert referenced_table in created_tables, (
                f"foreign key references {referenced_table} before its table is created: {line.strip()}"
            )
