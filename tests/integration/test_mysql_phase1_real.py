from __future__ import annotations

import os
import re
import uuid

import pytest


TEST_DATABASE = os.getenv("MES_PHASE1_MYSQL_TEST_DATABASE", "").strip()
DROP_CONFIRMATION = os.getenv("MES_PHASE1_MYSQL_ALLOW_DROP", "").strip()
SAFE_DATABASE_RE = re.compile(r"^mes_phase1_[a-z0-9_]+_test$")

pytestmark = pytest.mark.skipif(
    not TEST_DATABASE,
    reason="set MES_PHASE1_MYSQL_TEST_DATABASE to run disposable real-MySQL verification",
)


def _require_safe_target(host: str) -> None:
    if not SAFE_DATABASE_RE.fullmatch(TEST_DATABASE):
        raise RuntimeError(
            "The disposable database must match mes_phase1_<name>_test."
        )
    if DROP_CONFIRMATION != TEST_DATABASE:
        raise RuntimeError(
            "MES_PHASE1_MYSQL_ALLOW_DROP must exactly match the disposable database name."
        )
    if host not in {"127.0.0.1", "localhost", "::1"} and os.getenv(
        "MES_PHASE1_MYSQL_ALLOW_REMOTE"
    ) != "1":
        raise RuntimeError("Remote MySQL integration tests require MES_PHASE1_MYSQL_ALLOW_REMOTE=1.")


def test_phase1_migrations_on_disposable_real_mysql() -> None:
    import pymysql

    from app.core.config import settings
    from app.core.mysql_storage_backend import MySQLConnectionSettings, MySQLMesStorageBackend
    from app.db.mysql_credentials import migration_credentials
    from app.db.mysql_snapshot import MySQLSnapshotRepository
    from app.db.schema_contract import find_schema_contract_gaps, validate_schema_contract
    from scripts import init_mysql_storage

    _require_safe_target(settings.MYSQL_HOST)
    if TEST_DATABASE == settings.MYSQL_DATABASE:
        raise RuntimeError("The disposable database must differ from the configured runtime database.")

    original_database = settings.MYSQL_DATABASE
    original_app_env = settings.APP_ENV
    original_iter = init_mysql_storage.iter_schema_migrations
    credentials = migration_credentials(settings)
    api_user = f"mes_p1_{uuid.uuid4().hex[:10]}"
    api_password = uuid.uuid4().hex

    def connect(*, database: str | None = None, user: str | None = None, password: str | None = None):
        return pymysql.connect(
            host=settings.MYSQL_HOST,
            port=settings.MYSQL_PORT,
            user=user or credentials.user,
            password=credentials.password if password is None else password,
            database=database,
            charset="utf8mb4",
            autocommit=False,
        )

    def reset_database() -> None:
        with connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(f"DROP DATABASE IF EXISTS `{TEST_DATABASE}`")
                cursor.execute(
                    f"CREATE DATABASE `{TEST_DATABASE}` "
                    "CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
                )
            connection.commit()

    try:
        settings.MYSQL_DATABASE = TEST_DATABASE
        settings.APP_ENV = "test"

        # Fresh database and idempotent second run.
        reset_database()
        first = init_mysql_storage.initialize_mysql_storage(seed_demo=False)
        assert first["applied_migrations"] == [
            "V001",
            "V002",
            "V003",
            "V004",
            "V005",
            "V006",
            "V007",
            "V008",
        ]
        second = init_mysql_storage.initialize_mysql_storage(seed_demo=False)
        assert second["applied_migrations"] == []
        with connect(database=TEST_DATABASE) as connection:
            with connection.cursor() as cursor:
                validate_schema_contract(cursor, database=TEST_DATABASE)
                cursor.execute(
                    "SELECT version, success FROM schema_migrations ORDER BY version"
                )
                assert cursor.fetchall() == (
                    ("V001", 1),
                    ("V002", 1),
                    ("V003", 1),
                    ("V004", 1),
                    ("V005", 1),
                    ("V006", 1),
                    ("V007", 1),
                    ("V008", 1),
                )

        # Representative existing V007 database: preserve durable business rows
        # while V008 adds exact fixture-install schedule identity. Pending fixture
        # rows are intentionally reset because they cannot be mapped safely.
        reset_database()
        init_mysql_storage.iter_schema_migrations = lambda: list(
            init_mysql_storage.SCHEMA_MIGRATIONS[:-1]
        )
        assert init_mysql_storage.apply_pending_schema_migrations() == [
            "V001",
            "V002",
            "V003",
            "V004",
            "V005",
            "V006",
        ]
        with connect(database=TEST_DATABASE) as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    "INSERT INTO biz_task (task_no, task_name, task_type) "
                    "VALUES ('PHASE1-TASK', 'phase1 migration verification', 'verification')"
                )
                cursor.execute(
                    "INSERT INTO sys_fixed_terminal "
                    "(terminal_id, terminal_name, secret_hash, bound_module) "
                    "VALUES ('phase1-terminal', 'phase1 terminal', "
                    "'0000000000000000000000000000000000000000000000000000000000000000', "
                    "'phase1')"
                )
                cursor.execute(
                    "INSERT INTO biz_fixture_install_pending "
                    "(fixture_install_id, tray_no, task_no, experiment_no, lab_code, status) "
                    "VALUES ('phase1-fixture', 'phase1-tray', 'PHASE1-TASK', "
                    "'PHASE1-EXPERIMENT', 'PHASE1-LAB', 'PENDING')"
                )
                cursor.execute("SELECT COUNT(*) FROM biz_task")
                task_count_before = cursor.fetchone()[0]
                cursor.execute("SELECT COUNT(*) FROM sys_fixed_terminal")
                terminal_count_before = cursor.fetchone()[0]
            connection.commit()

        init_mysql_storage.iter_schema_migrations = original_iter
        assert init_mysql_storage.apply_pending_schema_migrations() == ["V008"]
        with connect(database=TEST_DATABASE) as connection:
            with connection.cursor() as cursor:
                assert find_schema_contract_gaps(cursor, database=TEST_DATABASE) == []
                cursor.execute(
                    "SELECT column_name, is_nullable "
                    "FROM information_schema.columns "
                    "WHERE table_schema = %s "
                    "AND table_name = 'biz_fixture_install_pending' "
                    "AND column_name IN ('schedule_no', 'sub_experiment_code')",
                    (TEST_DATABASE,),
                )
                assert set(cursor.fetchall()) == {
                    ("schedule_no", "NO"),
                    ("sub_experiment_code", "YES"),
                }
                cursor.execute(
                    "SELECT COUNT(*) FROM information_schema.statistics "
                    "WHERE table_schema = %s "
                    "AND table_name = 'biz_fixture_install_pending' "
                    "AND index_name = 'idx_biz_fixture_install_pending_task_tray_status'",
                    (TEST_DATABASE,),
                )
                assert cursor.fetchone()[0] == 3
                cursor.execute("SELECT COUNT(*) FROM biz_fixture_install_pending")
                assert cursor.fetchone()[0] == 0
                cursor.execute(
                    """
                    SELECT index_name
                    FROM information_schema.statistics
                    WHERE table_schema = %s
                      AND index_name IN (
                        'idx_biz_mq_retention_created',
                        'idx_biz_mq_retention_state',
                        'idx_biz_experiment_event_retention_created',
                        'idx_biz_experiment_event_retention_state'
                      )
                    """,
                    (TEST_DATABASE,),
                )
                assert {row[0] for row in cursor.fetchall()} == {
                    "idx_biz_mq_retention_created",
                    "idx_biz_mq_retention_state",
                    "idx_biz_experiment_event_retention_created",
                    "idx_biz_experiment_event_retention_state",
                }
                cursor.execute("SELECT COUNT(*) FROM biz_task")
                assert cursor.fetchone()[0] == task_count_before
                cursor.execute("SELECT COUNT(*) FROM sys_fixed_terminal")
                assert cursor.fetchone()[0] == terminal_count_before

        # A runtime DML account can pass the contract check and use business
        # storage, while MySQL itself rejects DDL from that account.
        with connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(f"DROP USER IF EXISTS `{api_user}`@'localhost'")
                cursor.execute(
                    f"CREATE USER `{api_user}`@'localhost' IDENTIFIED BY %s",
                    (api_password,),
                )
                cursor.execute(
                    f"GRANT SELECT, INSERT, UPDATE, DELETE ON `{TEST_DATABASE}`.* "
                    f"TO `{api_user}`@'localhost'"
                )
            connection.commit()

        runtime_settings = MySQLConnectionSettings(
            host=settings.MYSQL_HOST,
            port=settings.MYSQL_PORT,
            user=api_user,
            password=api_password,
            database=TEST_DATABASE,
        )
        runtime_backend = MySQLMesStorageBackend(
            runtime_settings,
            MySQLSnapshotRepository(runtime_settings),
        )
        runtime_backend.read_all()
        with connect(
            database=TEST_DATABASE,
            user=api_user,
            password=api_password,
        ) as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    "INSERT INTO app_storage_snapshot (storage_key, payload_json) "
                    "VALUES ('phase1.permission', '{}') "
                    "ON DUPLICATE KEY UPDATE payload_json = VALUES(payload_json)"
                )
                with pytest.raises(pymysql.MySQLError):
                    cursor.execute("CREATE TABLE phase1_ddl_must_fail (id INT)")
            connection.rollback()
    finally:
        init_mysql_storage.iter_schema_migrations = original_iter
        settings.MYSQL_DATABASE = original_database
        settings.APP_ENV = original_app_env
        try:
            with connect() as connection:
                with connection.cursor() as cursor:
                    cursor.execute(f"DROP DATABASE IF EXISTS `{TEST_DATABASE}`")
                    cursor.execute(f"DROP USER IF EXISTS `{api_user}`@'localhost'")
                connection.commit()
        except Exception:
            # Preserve the primary assertion failure. The guarded database name
            # makes any manual cleanup unambiguous if the server became unavailable.
            pass
