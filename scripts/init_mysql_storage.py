from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Any

PROJECT_ROOT = Path(__file__).resolve().parents[1]
SQL_DIR = PROJECT_ROOT / "scripts" / "sql"
SCHEMA_TEMPLATE_DATABASE = "mes_single_branch"
REQUIRED_BASE_TABLES = (
    "biz_task",
    "biz_sample",
    "biz_tray",
    "biz_tray_item",
    "md_equipment",
    "sys_role",
)
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from app.core.config import settings
from app.core.demo_data_reset import reset_demo_data
from app.core.mysql_storage_backend import MySQLConnectionSettings, MySQLMesStorageBackend
from app.db.mysql_snapshot import MySQLSnapshotRepository


def _connect_mysql(*, database: str | None = None):
    try:
        import pymysql
    except ImportError as exc:
        raise RuntimeError("pymysql is required to initialize MySQL storage") from exc

    return pymysql.connect(
        host=settings.MYSQL_HOST,
        port=settings.MYSQL_PORT,
        user=settings.MYSQL_USER,
        password=settings.MYSQL_PASSWORD,
        database=database,
        charset="utf8mb4",
        autocommit=False,
    )


def ensure_database_exists() -> None:
    database_name = settings.MYSQL_DATABASE.replace("`", "")
    with _connect_mysql(database=None) as connection:
        with connection.cursor() as cursor:
            cursor.execute(f"CREATE DATABASE IF NOT EXISTS `{database_name}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci")
        connection.commit()


def find_missing_base_tables() -> list[str]:
    with _connect_mysql(database=None) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                SELECT table_name
                FROM information_schema.tables
                WHERE table_schema = %s
                """,
                (settings.MYSQL_DATABASE,),
            )
            existing_tables = {row[0] for row in cursor.fetchall()}
    return [table_name for table_name in REQUIRED_BASE_TABLES if table_name not in existing_tables]


def ensure_required_base_tables_exist() -> None:
    missing_tables = find_missing_base_tables()
    if not missing_tables:
        return
    missing_text = ", ".join(missing_tables)
    raise RuntimeError(
        "MySQL base MES schema is incomplete. Missing required tables: "
        f"{missing_text}. Provision the base MES schema before running scripts/init_mysql_storage.py."
    )


def iter_schema_sql_paths() -> list[Path]:
    return [
        SQL_DIR / "2026-03-17-app-storage-snapshot.sql",
        SQL_DIR / "2026-03-17-mes-single-branch-schema-alignment.sql",
    ]


def _render_sql_template(path: Path) -> str:
    return path.read_text(encoding="utf-8").replace(SCHEMA_TEMPLATE_DATABASE, settings.MYSQL_DATABASE)


def _split_sql_statements(sql_text: str) -> list[str]:
    delimiter = ";"
    buffer: list[str] = []
    statements: list[str] = []

    for line in sql_text.splitlines():
        stripped = line.strip()
        if stripped.upper().startswith("DELIMITER "):
            delimiter = stripped.split(maxsplit=1)[1]
            continue
        buffer.append(line)
        current = "\n".join(buffer).rstrip()
        if current.endswith(delimiter):
            statement = current[: -len(delimiter)].strip()
            if statement:
                statements.append(statement)
            buffer = []

    trailing = "\n".join(buffer).strip()
    if trailing:
        statements.append(trailing)
    return statements


def apply_sql_file(path: Path) -> None:
    statements = _split_sql_statements(_render_sql_template(path))
    if not statements:
        return
    with _connect_mysql(database=None) as connection:
        with connection.cursor() as cursor:
            for statement in statements:
                cursor.execute(statement)
        connection.commit()


def create_mysql_storage_backend() -> MySQLMesStorageBackend:
    connection_settings = MySQLConnectionSettings(
        host=settings.MYSQL_HOST,
        port=settings.MYSQL_PORT,
        user=settings.MYSQL_USER,
        password=settings.MYSQL_PASSWORD,
        database=settings.MYSQL_DATABASE,
    )
    return MySQLMesStorageBackend(
        connection_settings,
        MySQLSnapshotRepository(connection_settings),
    )


def initialize_mysql_storage(seed_demo: bool = False) -> dict[str, Any]:
    ensure_database_exists()
    ensure_required_base_tables_exist()
    for path in iter_schema_sql_paths():
        apply_sql_file(path)

    backend = create_mysql_storage_backend()
    snapshot = reset_demo_data(backend) if seed_demo else backend.read_all()
    return {
        "database": settings.MYSQL_DATABASE,
        "schema_initialized": True,
        "demo_seeded": bool(seed_demo),
        "task_count": len(snapshot.get("mes.tasks", [])),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Explicitly initialize MySQL MES storage.")
    parser.add_argument(
        "--seed-demo",
        action="store_true",
        help="After schema initialization, reseed the database with demo data.",
    )
    args = parser.parse_args(argv)
    summary = initialize_mysql_storage(seed_demo=args.seed_demo)
    print(
        f"MySQL storage initialized: database={summary['database']}, "
        f"schema_initialized={'yes' if summary['schema_initialized'] else 'no'}, "
        f"demo_seeded={'yes' if summary['demo_seeded'] else 'no'}, "
        f"tasks={summary['task_count']}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
