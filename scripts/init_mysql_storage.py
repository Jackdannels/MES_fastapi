from __future__ import annotations

import argparse
import hashlib
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from time import perf_counter
from typing import Any

PROJECT_ROOT = Path(__file__).resolve().parents[1]
SQL_DIR = PROJECT_ROOT / "scripts" / "sql"
SCHEMA_TEMPLATE_DATABASE = "mes_single_branch"
MIGRATION_HISTORY_TABLE = "schema_migrations"
MIGRATION_LOCK_PREFIX = "mes_schema_migration"
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from app.core.config import settings
from app.core.demo_data_reset import reset_demo_data
from app.core.mysql_storage_backend import MySQLConnectionSettings, MySQLMesStorageBackend
from app.db.mysql_snapshot import MySQLSnapshotRepository
from app.db.mysql_credentials import migration_credentials
from app.db.mysql_tls import mysql_tls_connect_options
from app.db.schema_contract import (
    REQUIRED_SCHEMA_TABLES as CONTRACT_REQUIRED_SCHEMA_TABLES,
    validate_schema_contract,
)


REQUIRED_SCHEMA_TABLES = tuple(sorted(CONTRACT_REQUIRED_SCHEMA_TABLES))


@dataclass(frozen=True)
class SchemaMigration:
    version: str
    description: str
    path: Path


SCHEMA_MIGRATIONS = (
    SchemaMigration("V001", "complete baseline schema", SQL_DIR / "0001-complete-baseline-schema.sql"),
    SchemaMigration("V002", "app storage snapshot", SQL_DIR / "2026-03-17-app-storage-snapshot.sql"),
    SchemaMigration("V003", "single branch schema alignment", SQL_DIR / "2026-03-17-mes-single-branch-schema-alignment.sql"),
    SchemaMigration("V004", "runtime schema finalization", SQL_DIR / "V004__runtime_schema_finalization.sql"),
    SchemaMigration("V005", "terminal collation alignment", SQL_DIR / "V005__terminal_collation_alignment.sql"),
    SchemaMigration("V006", "long-running query indexes", SQL_DIR / "V006__long_running_query_indexes.sql"),
    SchemaMigration("V007", "bounded event retention indexes", SQL_DIR / "V007__bounded_event_retention_indexes.sql"),
    SchemaMigration("V008", "fixture install schedule identity", SQL_DIR / "V008__fixture_install_schedule_identity.sql"),
    SchemaMigration("V009", "salt spray experiment pause lifecycle", SQL_DIR / "V009__salt_spray_experiment_pause.sql"),
    SchemaMigration("V010", "repair salt spray laboratory identity", SQL_DIR / "V010__repair_salt_spray_lab_identity.sql"),
    SchemaMigration("V011", "canonicalize laboratory master data", SQL_DIR / "V011__canonicalize_laboratory_master_data.sql"),
)


def _connect_mysql(*, database: str | None = None):
    try:
        import pymysql
    except ImportError as exc:
        raise RuntimeError("pymysql is required to initialize MySQL storage") from exc

    credentials = migration_credentials(settings)
    return pymysql.connect(
        host=settings.MYSQL_HOST,
        port=settings.MYSQL_PORT,
        user=credentials.user,
        password=credentials.password,
        database=database,
        charset="utf8mb4",
        autocommit=False,
        **mysql_tls_connect_options(settings),
    )


def ensure_database_exists() -> None:
    database_name = settings.MYSQL_DATABASE.strip()
    if not re.fullmatch(r"[A-Za-z0-9_]+", database_name):
        raise RuntimeError("MYSQL_DATABASE must contain only letters, digits, and underscores.")
    with _connect_mysql(database=None) as connection:
        with connection.cursor() as cursor:
            if settings.APP_ENV == "prod":
                cursor.execute(
                    "SELECT COUNT(*) FROM information_schema.schemata WHERE schema_name = %s",
                    (database_name,),
                )
                if not cursor.fetchone()[0]:
                    raise RuntimeError(
                        "The production MySQL database does not exist. Create it with the DBA account before migration."
                    )
                return
            cursor.execute(f"CREATE DATABASE IF NOT EXISTS `{database_name}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci")
        connection.commit()


def find_missing_schema_tables() -> list[str]:
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
    return [table_name for table_name in REQUIRED_SCHEMA_TABLES if table_name not in existing_tables]


def validate_required_schema_tables_exist() -> None:
    missing_tables = find_missing_schema_tables()
    if missing_tables:
        missing_text = ", ".join(missing_tables)
        raise RuntimeError(
            "MySQL MES schema is incomplete after applying schema SQL. Missing required tables: "
            f"{missing_text}. Check the schema SQL and initialization logs."
        )
    with _connect_mysql(database=settings.MYSQL_DATABASE) as connection:
        with connection.cursor() as cursor:
            validate_schema_contract(cursor, database=settings.MYSQL_DATABASE)


def iter_schema_migrations() -> list[SchemaMigration]:
    return list(SCHEMA_MIGRATIONS)


def iter_schema_sql_paths() -> list[Path]:
    return [migration.path for migration in iter_schema_migrations()]


def calculate_migration_checksum(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


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


def _migration_lock_name() -> str:
    database_digest = hashlib.sha256(settings.MYSQL_DATABASE.encode("utf-8")).hexdigest()[:16]
    return f"{MIGRATION_LOCK_PREFIX}:{database_digest}"


def _ensure_migration_history_table(cursor: Any) -> None:
    cursor.execute(
        f"""
        CREATE TABLE IF NOT EXISTS {MIGRATION_HISTORY_TABLE} (
          version VARCHAR(50) NOT NULL,
          description VARCHAR(200) NOT NULL,
          script_name VARCHAR(255) NOT NULL,
          checksum CHAR(64) NOT NULL,
          installed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          execution_ms INT NOT NULL,
          success TINYINT NOT NULL,
          error_message VARCHAR(1000) NULL,
          PRIMARY KEY (version)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        """
    )


def _read_migration_record(cursor: Any, version: str) -> tuple[Any, ...] | None:
    cursor.execute(
        f"""
        SELECT version, checksum, success, error_message
        FROM {MIGRATION_HISTORY_TABLE}
        WHERE version = %s
        """,
        (version,),
    )
    return cursor.fetchone()


def _validate_applied_migration(migration: SchemaMigration, checksum: str, record: tuple[Any, ...]) -> None:
    _version, recorded_checksum, success, error_message = record
    if not bool(success):
        detail = str(error_message or "unknown migration error")
        raise RuntimeError(
            f"Schema migration {migration.version} previously failed: {detail}. "
            "Repair the schema and migration record before retrying."
        )
    if str(recorded_checksum) != checksum:
        raise RuntimeError(
            f"Schema migration checksum mismatch for {migration.version} ({migration.path.name}). "
            "Applied migration files must not be modified."
        )


def _record_migration(
    cursor: Any,
    migration: SchemaMigration,
    checksum: str,
    *,
    execution_ms: int,
    success: bool,
    error_message: str | None = None,
) -> None:
    cursor.execute(
        f"""
        INSERT INTO {MIGRATION_HISTORY_TABLE} (
          version, description, script_name, checksum, execution_ms, success, error_message
        ) VALUES (%s, %s, %s, %s, %s, %s, %s)
        """,
        (
            migration.version,
            migration.description,
            migration.path.name,
            checksum,
            max(0, execution_ms),
            1 if success else 0,
            error_message[:1000] if error_message else None,
        ),
    )


def apply_pending_schema_migrations() -> list[str]:
    applied_versions: list[str] = []
    lock_name = _migration_lock_name()
    with _connect_mysql(database=settings.MYSQL_DATABASE) as control_connection:
        with control_connection.cursor() as cursor:
            cursor.execute("SELECT GET_LOCK(%s, 60)", (lock_name,))
            lock_result = cursor.fetchone()
            if not lock_result or lock_result[0] != 1:
                raise RuntimeError(f"Could not acquire MySQL schema migration lock: {lock_name}")
            try:
                _ensure_migration_history_table(cursor)
                control_connection.commit()

                for migration in iter_schema_migrations():
                    checksum = calculate_migration_checksum(migration.path)
                    record = _read_migration_record(cursor, migration.version)
                    # Release the read transaction's metadata locks before the migration
                    # runs DDL through its dedicated connection. GET_LOCK is connection-
                    # scoped and remains held across this commit.
                    control_connection.commit()
                    if record is not None:
                        _validate_applied_migration(migration, checksum, record)
                        continue

                    started_at = perf_counter()
                    try:
                        apply_sql_file(migration.path)
                        if migration.version == SCHEMA_MIGRATIONS[-1].version:
                            with _connect_mysql(database=settings.MYSQL_DATABASE) as validation_connection:
                                with validation_connection.cursor() as validation_cursor:
                                    validate_schema_contract(
                                        validation_cursor,
                                        database=settings.MYSQL_DATABASE,
                                    )
                    except Exception as exc:
                        execution_ms = round((perf_counter() - started_at) * 1000)
                        control_connection.rollback()
                        _record_migration(
                            cursor,
                            migration,
                            checksum,
                            execution_ms=execution_ms,
                            success=False,
                            error_message=str(exc),
                        )
                        control_connection.commit()
                        raise RuntimeError(
                            f"Schema migration {migration.version} failed ({migration.path.name}): {exc}"
                        ) from exc

                    execution_ms = round((perf_counter() - started_at) * 1000)
                    _record_migration(
                        cursor,
                        migration,
                        checksum,
                        execution_ms=execution_ms,
                        success=True,
                    )
                    control_connection.commit()
                    applied_versions.append(migration.version)
            finally:
                cursor.execute("SELECT RELEASE_LOCK(%s)", (lock_name,))
    return applied_versions


def create_mysql_storage_backend() -> MySQLMesStorageBackend:
    connection_settings = MySQLConnectionSettings(
        host=settings.MYSQL_HOST,
        port=settings.MYSQL_PORT,
        user=settings.MYSQL_USER,
        password=settings.MYSQL_PASSWORD,
        database=settings.MYSQL_DATABASE,
        ssl_ca=settings.MYSQL_SSL_CA,
        ssl_cert=settings.MYSQL_SSL_CERT,
        ssl_key=settings.MYSQL_SSL_KEY,
        ssl_verify_cert=settings.MYSQL_SSL_VERIFY_CERT,
        ssl_verify_identity=settings.MYSQL_SSL_VERIFY_IDENTITY,
    )
    return MySQLMesStorageBackend(
        connection_settings,
        MySQLSnapshotRepository(connection_settings),
    )


def initialize_mysql_storage(seed_demo: bool = False) -> dict[str, Any]:
    if seed_demo and settings.APP_ENV == "prod":
        raise RuntimeError("--seed-demo is forbidden when APP_ENV=prod.")
    ensure_database_exists()
    applied_migrations = apply_pending_schema_migrations()
    validate_required_schema_tables_exist()

    if seed_demo:
        backend = create_mysql_storage_backend()
        snapshot = reset_demo_data(backend)
        task_count = len(snapshot.get("mes.tasks", []))
    else:
        with _connect_mysql(database=settings.MYSQL_DATABASE) as connection:
            with connection.cursor() as cursor:
                cursor.execute("SELECT COUNT(*) FROM biz_task")
                task_count = int(cursor.fetchone()[0])
    return {
        "database": settings.MYSQL_DATABASE,
        "schema_initialized": True,
        "schema_version": SCHEMA_MIGRATIONS[-1].version,
        "applied_migrations": applied_migrations,
        "demo_seeded": bool(seed_demo),
        "task_count": task_count,
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
