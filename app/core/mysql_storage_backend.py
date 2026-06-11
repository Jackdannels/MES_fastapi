from __future__ import annotations

import json
from datetime import datetime
from threading import Lock
from typing import Any, Dict, Iterable

from app.core.storage_backend import (
    CANONICAL_COMPLETED_STATUS,
    CURRENT_SCHEMA_VERSION,
    STORAGE_KEYS,
    STORAGE_META_KEY,
    StorageBackend,
    _normalize_value,
    normalize_experiment_detail_text,
    normalize_experiment_status_text,
)
from app.core.mysql_storage_codecs import (
    FIXTURE_READY_COMPAT_MESSAGE_PREFIX,
    RETENTION_KEYWORD,
    SAMPLE_META_PREFIX,
    STORAGE_MARKER,
    TRAY_META_PREFIX,
    current_beijing_datetime,
    format_iso_storage_datetime,
    normalize_storage_payload,
    normalize_text,
    parse_fixture_ready_flag,
    parse_int_value,
    parse_storage_datetime,
    parse_varchar_length,
)
from app.core.mysql_storage_mappers import (
    build_experiment_insert_row,
    build_experiment_run_insert_row,
    build_experiment_run_tray_insert_row,
    build_experiment_run_tray_insert_rows,
    build_experiment_sample_insert_row,
    build_experiment_tray_insert_row,
    build_device_insert_row,
    build_schedule_insert_row,
    build_storage_experiment_item,
    build_storage_experiment_run_item,
    build_storage_experiment_run_tray_item,
    build_storage_experiment_sample_item,
    build_storage_experiment_tray_item,
    build_storage_device_item,
    build_storage_schedule_item,
    build_storage_sample_item,
    build_storage_stream_item,
    build_storage_task_item,
    build_storage_task_tray_codes,
    build_sample_insert_row,
    build_scheduled_dispatch_target_map,
    build_staging_dispatch_target_map,
    build_stream_insert_row,
    build_tray_dispatch_target_map,
    build_task_insert_row,
    extract_dispatch_target_lab,
    normalize_experiment_status,
)
from app.core.mysql_storage_status import (
    EXPERIMENT_COMPLETED_STATUSES,
    EXPERIMENT_RUNNING_STATUS,
    EXPERIMENT_RUNNING_STATUSES,
    LEGACY_EXPERIMENT_RUNNING_STATUS,
    LEGACY_TASK_STORED_STATUS,
    RUN_TRAY_COMPLETED_STATUSES,
    TASK_COMPLETED_STATUS,
    TASK_RUNNING_STATUS,
    TASK_STORED_STATUS,
    UNSCHEDULED_BACKFILL_ELIGIBLE_STATUSES,
    UNSCHEDULED_BACKFILL_HISTORY_ACTION,
    backfill_missing_unscheduled_since,
    derive_experiment_status_map,
    derive_task_status_map,
    has_formal_schedule,
    is_task_stored_status,
    is_unscheduled_since_backfill_eligible,
    parse_experiment_event_detail,
    resolve_experiment_sample_codes,
    resolve_sample_storage_time,
)
from app.core.master_data import DEFAULT_LABS, DEFAULT_TEST_TYPES
from app.db.mysql_snapshot import MySQLConnectionSettings, MySQLSnapshotRepository

RELATIONAL_STORAGE_KEYS = (
    "mes.tasks",
    "mes.schedules",
    "mes.devices",
    "mes.streams",
    "mes.samples",
    "mes.experiments",
    "mes.experiment_runs",
    "mes.experiment_run_trays",
    "mes.experiment_trays",
    "mes.experiment_samples",
)
SNAPSHOT_STORAGE_KEYS = ("mes.conflicts", "mes.staging_events", STORAGE_META_KEY)


class MySQLMesStorageBackend(StorageBackend):
    def __init__(
        self,
        connection_settings: MySQLConnectionSettings,
        snapshot_repository: MySQLSnapshotRepository,
    ) -> None:
        self._connection_settings = connection_settings
        self._snapshot_repository = snapshot_repository
        self._lock = Lock()
        self._schema_initialized = False

    def _connect(self):
        try:
            import pymysql
            from pymysql.cursors import DictCursor
        except ImportError as exc:
            raise RuntimeError("pymysql is required for the MySQL storage backend") from exc

        return pymysql.connect(
            host=self._connection_settings.host,
            port=self._connection_settings.port,
            user=self._connection_settings.user,
            password=self._connection_settings.password,
            database=self._connection_settings.database,
            charset=self._connection_settings.charset,
            autocommit=False,
            cursorclass=DictCursor,
        )

    def list_test_types(self) -> list[dict[str, Any]]:
        self._ensure_schema_extensions()
        with self._connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT
                      test_type_id, test_type_code, test_type_name, test_category,
                      default_duration_hour, status, remark
                    FROM md_test_type
                    WHERE COALESCE(status, 1) = 1
                    ORDER BY test_type_id
                    """
                )
                return [dict(row) for row in cursor.fetchall()]

    def list_labs(self) -> list[dict[str, Any]]:
        self._ensure_schema_extensions()
        with self._connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT
                      l.lab_id, l.lab_code, l.lab_name, l.lab_type, l.test_type_id,
                      tt.test_type_code, tt.test_type_name, l.capacity, l.location_desc,
                      l.status, l.remark
                    FROM md_lab l
                    LEFT JOIN md_test_type tt ON tt.test_type_id = l.test_type_id
                    WHERE COALESCE(l.status, 1) = 1
                    ORDER BY l.lab_id
                    """
                )
                return [dict(row) for row in cursor.fetchall()]

    def _ensure_schema_extensions(self) -> None:
        if self._schema_initialized:
            return
        with self._connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute("SHOW COLUMNS FROM biz_task LIKE 'transfer_status'")
                if cursor.fetchone() is None:
                    cursor.execute("ALTER TABLE biz_task ADD COLUMN transfer_status VARCHAR(30) NULL AFTER task_status")
                cursor.execute("SHOW COLUMNS FROM biz_task LIKE 'tray_limit'")
                if cursor.fetchone() is None:
                    cursor.execute("ALTER TABLE biz_task ADD COLUMN tray_limit INT NULL AFTER sample_count")
                cursor.execute("SHOW COLUMNS FROM biz_task LIKE 'task_type'")
                if parse_varchar_length(cursor.fetchone()) < 200:
                    cursor.execute("ALTER TABLE biz_task MODIFY COLUMN task_type VARCHAR(200) NOT NULL")
                cursor.execute("SHOW COLUMNS FROM biz_task LIKE 'required_device'")
                required_device_column = cursor.fetchone()
                if required_device_column is None:
                    cursor.execute("ALTER TABLE biz_task ADD COLUMN required_device VARCHAR(200) NULL AFTER due_time")
                elif parse_varchar_length(required_device_column) < 200:
                    cursor.execute("ALTER TABLE biz_task MODIFY COLUMN required_device VARCHAR(200) NULL")
                cursor.execute(
                    """
                    CREATE TABLE IF NOT EXISTS md_test_type (
                      test_type_id BIGINT NOT NULL AUTO_INCREMENT,
                      test_type_code VARCHAR(50) NOT NULL,
                      test_type_name VARCHAR(100) NOT NULL,
                      test_category VARCHAR(50) NULL,
                      default_duration_hour DECIMAL(10,2) NULL,
                      status TINYINT NOT NULL DEFAULT 1,
                      remark VARCHAR(300) NULL,
                      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                      PRIMARY KEY (test_type_id),
                      UNIQUE KEY uk_md_test_type_code (test_type_code)
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
                    """
                )
                cursor.execute(
                    """
                    CREATE TABLE IF NOT EXISTS md_lab (
                      lab_id BIGINT NOT NULL AUTO_INCREMENT,
                      lab_code VARCHAR(50) NOT NULL,
                      lab_name VARCHAR(100) NOT NULL,
                      lab_type VARCHAR(30) NULL,
                      test_type_id BIGINT NULL,
                      dept_id BIGINT NULL,
                      manager_user_id BIGINT NULL,
                      capacity INT NULL,
                      location_desc VARCHAR(200) NULL,
                      status TINYINT NOT NULL DEFAULT 1,
                      remark VARCHAR(300) NULL,
                      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                      PRIMARY KEY (lab_id),
                      UNIQUE KEY uk_md_lab_code (lab_code),
                      KEY idx_md_lab_test_type (test_type_id),
                      CONSTRAINT fk_md_lab_test_type FOREIGN KEY (test_type_id) REFERENCES md_test_type(test_type_id)
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
                    """
                )
                master_columns = (
                    ("md_test_type", "test_category", "ALTER TABLE md_test_type ADD COLUMN test_category VARCHAR(50) NULL AFTER test_type_name"),
                    (
                        "md_test_type",
                        "default_duration_hour",
                        "ALTER TABLE md_test_type ADD COLUMN default_duration_hour DECIMAL(10,2) NULL AFTER test_category",
                    ),
                    ("md_test_type", "status", "ALTER TABLE md_test_type ADD COLUMN status TINYINT NOT NULL DEFAULT 1 AFTER default_duration_hour"),
                    ("md_test_type", "remark", "ALTER TABLE md_test_type ADD COLUMN remark VARCHAR(300) NULL AFTER status"),
                    ("md_lab", "lab_type", "ALTER TABLE md_lab ADD COLUMN lab_type VARCHAR(30) NULL AFTER lab_name"),
                    ("md_lab", "test_type_id", "ALTER TABLE md_lab ADD COLUMN test_type_id BIGINT NULL AFTER lab_type"),
                    ("md_lab", "dept_id", "ALTER TABLE md_lab ADD COLUMN dept_id BIGINT NULL AFTER test_type_id"),
                    ("md_lab", "manager_user_id", "ALTER TABLE md_lab ADD COLUMN manager_user_id BIGINT NULL AFTER dept_id"),
                    ("md_lab", "capacity", "ALTER TABLE md_lab ADD COLUMN capacity INT NULL AFTER manager_user_id"),
                    ("md_lab", "location_desc", "ALTER TABLE md_lab ADD COLUMN location_desc VARCHAR(200) NULL AFTER capacity"),
                    ("md_lab", "status", "ALTER TABLE md_lab ADD COLUMN status TINYINT NOT NULL DEFAULT 1 AFTER location_desc"),
                    ("md_lab", "remark", "ALTER TABLE md_lab ADD COLUMN remark VARCHAR(300) NULL AFTER status"),
                    ("md_equipment", "maintenance_start_at", "ALTER TABLE md_equipment ADD COLUMN maintenance_start_at DATETIME NULL AFTER status"),
                    ("md_equipment", "maintenance_end_at", "ALTER TABLE md_equipment ADD COLUMN maintenance_end_at DATETIME NULL AFTER maintenance_start_at"),
                    ("md_equipment", "maintenance_type", "ALTER TABLE md_equipment ADD COLUMN maintenance_type VARCHAR(30) NULL AFTER maintenance_end_at"),
                    ("md_equipment", "maintenance_note", "ALTER TABLE md_equipment ADD COLUMN maintenance_note VARCHAR(500) NULL AFTER maintenance_type"),
                )
                for table_name, column_name, ddl in master_columns:
                    cursor.execute(f"SHOW COLUMNS FROM {table_name} LIKE '{column_name}'")
                    if cursor.fetchone() is None:
                        cursor.execute(ddl)
                master_indexes = (
                    (
                        "md_test_type",
                        "uk_md_test_type_code",
                        "ALTER TABLE md_test_type ADD UNIQUE KEY uk_md_test_type_code (test_type_code)",
                        "test_type_code",
                    ),
                    ("md_lab", "uk_md_lab_code", "ALTER TABLE md_lab ADD UNIQUE KEY uk_md_lab_code (lab_code)", "lab_code"),
                    ("md_lab", "idx_md_lab_test_type", "ALTER TABLE md_lab ADD INDEX idx_md_lab_test_type (test_type_id)", ""),
                )
                for table_name, index_name, ddl, unique_column in master_indexes:
                    cursor.execute(f"SHOW INDEX FROM {table_name} WHERE Key_name = '{index_name}'")
                    if cursor.fetchone() is None:
                        if unique_column:
                            cursor.execute(
                                f"""
                                SELECT {unique_column}, COUNT(*) AS row_count
                                FROM {table_name}
                                WHERE {unique_column} IS NOT NULL AND {unique_column} <> ''
                                GROUP BY {unique_column}
                                HAVING COUNT(*) > 1
                                LIMIT 1
                                """
                            )
                            if cursor.fetchone() is not None:
                                continue
                        cursor.execute(ddl)
                seed_test_type_sql = """
                    INSERT INTO md_test_type (
                      test_type_code, test_type_name, test_category, default_duration_hour, status, remark
                    )
                    SELECT
                      %(test_type_code)s, %(test_type_name)s, %(test_category)s, %(default_duration_hour)s, %(status)s, %(remark)s
                    WHERE NOT EXISTS (
                      SELECT 1 FROM md_test_type WHERE test_type_code = %(test_type_code)s
                    )
                    """
                for row in DEFAULT_TEST_TYPES:
                    cursor.execute(seed_test_type_sql, dict(row))
                seed_lab_sql = """
                    INSERT INTO md_lab (
                      lab_code, lab_name, lab_type, test_type_id, capacity, location_desc, status, remark
                    )
                    SELECT
                      %(lab_code)s,
                      %(lab_name)s,
                      %(lab_type)s,
                      (SELECT test_type_id FROM md_test_type WHERE test_type_code = %(test_type_code)s),
                      %(capacity)s,
                      %(location_desc)s,
                      %(status)s,
                      %(remark)s
                    WHERE NOT EXISTS (
                      SELECT 1 FROM md_lab WHERE lab_code = %(lab_code)s
                    )
                    """
                for row in DEFAULT_LABS:
                    cursor.execute(seed_lab_sql, dict(row))
                cursor.execute("SHOW COLUMNS FROM biz_schedule LIKE 'experiment_no'")
                if cursor.fetchone() is None:
                    cursor.execute("ALTER TABLE biz_schedule ADD COLUMN experiment_no VARCHAR(50) NULL AFTER task_no")
                cursor.execute("SHOW COLUMNS FROM biz_schedule LIKE 'lab_id'")
                if cursor.fetchone() is None:
                    cursor.execute("ALTER TABLE biz_schedule ADD COLUMN lab_id BIGINT NULL AFTER schedule_type")
                cursor.execute(
                    """
                    CREATE TABLE IF NOT EXISTS biz_experiment (
                      experiment_id BIGINT NOT NULL AUTO_INCREMENT,
                      experiment_no VARCHAR(50) NOT NULL,
                      task_id BIGINT NULL,
                      task_no VARCHAR(50) NOT NULL,
                      experiment_name VARCHAR(100) NOT NULL,
                      required_device VARCHAR(100) NULL,
                      priority TINYINT NULL,
                      planned_hours DECIMAL(10,2) NULL,
                      experiment_status VARCHAR(30) NULL,
                      unscheduled_since DATETIME NULL,
                      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                      PRIMARY KEY (experiment_id),
                      UNIQUE KEY uk_biz_experiment_no (experiment_no),
                      KEY idx_biz_experiment_task_no (task_no)
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
                    """
                )
                cursor.execute("SHOW COLUMNS FROM biz_experiment LIKE 'unscheduled_since'")
                if cursor.fetchone() is None:
                    cursor.execute("ALTER TABLE biz_experiment ADD COLUMN unscheduled_since DATETIME NULL AFTER experiment_status")
                cursor.execute("SHOW COLUMNS FROM biz_experiment LIKE 'actual_start_time'")
                if cursor.fetchone() is None:
                    cursor.execute("ALTER TABLE biz_experiment ADD COLUMN actual_start_time DATETIME NULL AFTER unscheduled_since")
                cursor.execute("SHOW COLUMNS FROM biz_experiment LIKE 'actual_end_time'")
                if cursor.fetchone() is None:
                    cursor.execute("ALTER TABLE biz_experiment ADD COLUMN actual_end_time DATETIME NULL AFTER actual_start_time")
                cursor.execute(
                    """
                    CREATE TABLE IF NOT EXISTS biz_experiment_tray (
                      relation_id BIGINT NOT NULL AUTO_INCREMENT,
                      experiment_no VARCHAR(50) NOT NULL,
                      task_no VARCHAR(50) NOT NULL,
                      tray_no VARCHAR(80) NOT NULL,
                      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                      PRIMARY KEY (relation_id),
                      UNIQUE KEY uk_biz_experiment_tray_unique (experiment_no, tray_no),
                      KEY idx_biz_experiment_tray_task_no (task_no),
                      KEY idx_biz_experiment_tray_tray_no (tray_no)
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
                    """
                )
                cursor.execute(
                    """
                    CREATE TABLE IF NOT EXISTS biz_experiment_sample (
                      relation_id BIGINT NOT NULL AUTO_INCREMENT,
                      experiment_no VARCHAR(50) NOT NULL,
                      task_no VARCHAR(50) NOT NULL,
                      sample_no VARCHAR(80) NOT NULL,
                      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                      PRIMARY KEY (relation_id),
                      UNIQUE KEY uk_biz_experiment_sample_unique (experiment_no, sample_no),
                      KEY idx_biz_experiment_sample_task_no (task_no),
                      KEY idx_biz_experiment_sample_sample_no (sample_no)
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
                    """
                )
                cursor.execute(
                    """
                    CREATE TABLE IF NOT EXISTS biz_experiment_run (
                      run_id BIGINT NOT NULL AUTO_INCREMENT,
                      run_no VARCHAR(80) NOT NULL,
                      schedule_no VARCHAR(80) NULL,
                      task_no VARCHAR(50) NOT NULL,
                      experiment_no VARCHAR(50) NOT NULL,
                      device_name VARCHAR(100) NULL,
                      planned_hours DECIMAL(10,2) NULL,
                      run_status VARCHAR(30) NULL,
                      started_at DATETIME NULL,
                      planned_end_at DATETIME NULL,
                      ended_at DATETIME NULL,
                      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                      PRIMARY KEY (run_id),
                      UNIQUE KEY uk_biz_experiment_run_no (run_no),
                      KEY idx_biz_experiment_run_task_exp (task_no, experiment_no),
                      KEY idx_biz_experiment_run_schedule (schedule_no),
                      KEY idx_biz_experiment_run_status (run_status)
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
                    """
                )
                cursor.execute(
                    """
                    CREATE TABLE IF NOT EXISTS biz_experiment_run_tray (
                      relation_id BIGINT NOT NULL AUTO_INCREMENT,
                      run_no VARCHAR(80) NOT NULL,
                      task_no VARCHAR(50) NOT NULL,
                      experiment_no VARCHAR(50) NOT NULL,
                      tray_no VARCHAR(80) NOT NULL,
                      run_tray_status VARCHAR(30) NULL,
                      started_at DATETIME NULL,
                      ended_at DATETIME NULL,
                      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                      PRIMARY KEY (relation_id),
                      UNIQUE KEY uk_biz_experiment_run_tray_unique (run_no, tray_no),
                      KEY idx_biz_experiment_run_tray_exp (task_no, experiment_no),
                      KEY idx_biz_experiment_run_tray_no (tray_no)
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
                    """
                )
                cursor.execute(
                    """
                    CREATE TABLE IF NOT EXISTS biz_mq_message_log (
                      message_log_id BIGINT NOT NULL AUTO_INCREMENT,
                      message_id VARCHAR(100) NULL,
                      direction VARCHAR(20) NOT NULL,
                      topic VARCHAR(255) NOT NULL,
                      message_type VARCHAR(50) NOT NULL,
                      correlation_id VARCHAR(100) NULL,
                      lab_code VARCHAR(50) NULL,
                      task_no VARCHAR(50) NULL,
                      experiment_no VARCHAR(50) NULL,
                      qos TINYINT NULL,
                      retain_flag TINYINT NOT NULL DEFAULT 0,
                      payload_json JSON NULL,
                      process_status VARCHAR(30) NOT NULL DEFAULT 'RECEIVED',
                      error_code VARCHAR(50) NULL,
                      error_message VARCHAR(1000) NULL,
                      received_at DATETIME NULL,
                      processed_at DATETIME NULL,
                      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                      PRIMARY KEY (message_log_id),
                      UNIQUE KEY uk_biz_mq_message_id (message_id),
                      KEY idx_biz_mq_topic_time (topic, created_at),
                      KEY idx_biz_mq_task_exp (task_no, experiment_no),
                      KEY idx_biz_mq_status (process_status)
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
                    """
                )
                cursor.execute(
                    """
                    CREATE TABLE IF NOT EXISTS biz_experiment_event (
                      experiment_event_id BIGINT NOT NULL AUTO_INCREMENT,
                      event_type VARCHAR(50) NOT NULL,
                      task_no VARCHAR(50) NOT NULL,
                      experiment_no VARCHAR(50) NULL,
                      lab_code VARCHAR(50) NULL,
                      success_id VARCHAR(100) NULL,
                      event_time DATETIME NULL,
                      message_id VARCHAR(100) NULL,
                      message_log_id BIGINT NULL,
                      payload_json JSON NULL,
                      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                      PRIMARY KEY (experiment_event_id),
                      UNIQUE KEY uk_biz_experiment_event_message (message_id),
                      KEY idx_biz_experiment_event_task_exp (task_no, experiment_no),
                      KEY idx_biz_experiment_event_time (event_type, event_time)
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
                    """
                )
                cursor.execute(
                    """
                    CREATE TABLE IF NOT EXISTS biz_experiment_result (
                      experiment_result_id BIGINT NOT NULL AUTO_INCREMENT,
                      task_no VARCHAR(50) NOT NULL,
                      experiment_no VARCHAR(50) NOT NULL,
                      lab_code VARCHAR(50) NULL,
                      result_time DATETIME NOT NULL,
                      conclusion VARCHAR(50) NULL,
                      summary TEXT NULL,
                      result_payload_json JSON NOT NULL,
                      message_id VARCHAR(100) NULL,
                      message_log_id BIGINT NULL,
                      status VARCHAR(30) NULL DEFAULT 'RECEIVED',
                      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                      PRIMARY KEY (experiment_result_id),
                      UNIQUE KEY uk_biz_experiment_result_message (message_id),
                      KEY idx_biz_experiment_result_exp (experiment_no),
                      KEY idx_biz_experiment_result_task (task_no)
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
                    """
                )
            connection.commit()
        self._schema_initialized = True

    def _deserialize_snapshot_payloads(self, payloads: Dict[str, str]) -> Dict[str, Any]:
        values: Dict[str, Any] = {}
        for key in SNAPSHOT_STORAGE_KEYS:
            raw_value = payloads.get(key)
            if key == STORAGE_META_KEY:
                try:
                    parsed = json.loads(raw_value) if raw_value else {}
                except json.JSONDecodeError:
                    parsed = {}
                values[key] = _normalize_value(key, parsed if isinstance(parsed, dict) else {})
                continue
            try:
                parsed = json.loads(raw_value) if raw_value else []
            except json.JSONDecodeError:
                parsed = []
            values[key] = _normalize_value(key, parsed if isinstance(parsed, list) else [])
        return values

    def _serialize_snapshot_updates(self, updates: Dict[str, Any]) -> Dict[str, str]:
        serialized: Dict[str, str] = {}
        for key in SNAPSHOT_STORAGE_KEYS:
            if key not in updates:
                continue
            if key == STORAGE_META_KEY:
                normalized = _normalize_value(key, updates.get(key) if isinstance(updates.get(key), dict) else {})
            else:
                normalized = _normalize_value(key, updates.get(key) if isinstance(updates.get(key), list) else [])
            serialized[key] = json.dumps(normalized, ensure_ascii=False)
        return serialized

    def _delete_missing_rows(
        self,
        cursor,
        *,
        table_name: str,
        marker_column: str,
        key_column: str,
        incoming_keys: Iterable[str],
        marker_value: str,
    ) -> None:
        keys = [key for key in incoming_keys if key]
        if not keys:
            cursor.execute(f"DELETE FROM {table_name} WHERE {marker_column} = %s", (marker_value,))
            return
        placeholders = ", ".join(["%s"] * len(keys))
        params = [marker_value, *keys]
        cursor.execute(
            f"DELETE FROM {table_name} WHERE {marker_column} = %s AND {key_column} NOT IN ({placeholders})",
            params,
        )

    def _replace_tasks(self, cursor, tasks: list[dict[str, Any]], *, prune: bool = True) -> None:
        rows = [build_task_insert_row(task) for task in tasks if normalize_text(task.get("code"))]
        if prune:
            self._delete_missing_rows(
                cursor,
                table_name="biz_task",
                marker_column="source_system",
                key_column="task_no",
                incoming_keys=[row["task_no"] for row in rows],
                marker_value=STORAGE_MARKER,
            )
        if not rows:
            return
        cursor.executemany(
            """
            INSERT INTO biz_task (
              task_no, task_source_type, source_system, task_name, client_name, contact_name, contact_phone,
              task_type, sample_type, priority, sample_count, tray_limit, task_status, transfer_status, arrival_time, due_time,
              required_device, conditions_text, attachment_path, remark, created_at, updated_at
            ) VALUES (
              %(task_no)s, %(task_source_type)s, %(source_system)s, %(task_name)s, %(client_name)s, %(contact_name)s, %(contact_phone)s,
              %(task_type)s, %(sample_type)s, %(priority)s, %(sample_count)s, %(tray_limit)s, %(task_status)s, %(transfer_status)s, %(arrival_time)s, %(due_time)s,
              %(required_device)s, %(conditions_text)s, %(attachment_path)s, %(remark)s, %(created_at)s, %(updated_at)s
            )
            ON DUPLICATE KEY UPDATE
              task_source_type = VALUES(task_source_type),
              source_system = VALUES(source_system),
              task_name = VALUES(task_name),
              client_name = VALUES(client_name),
              contact_name = VALUES(contact_name),
              contact_phone = VALUES(contact_phone),
              task_type = VALUES(task_type),
              sample_type = VALUES(sample_type),
              priority = VALUES(priority),
              sample_count = VALUES(sample_count),
              tray_limit = VALUES(tray_limit),
              task_status = VALUES(task_status),
              transfer_status = VALUES(transfer_status),
              arrival_time = VALUES(arrival_time),
              due_time = VALUES(due_time),
              required_device = VALUES(required_device),
              conditions_text = VALUES(conditions_text),
              attachment_path = VALUES(attachment_path),
              remark = VALUES(remark),
              updated_at = VALUES(updated_at)
            """,
            rows,
        )

    def _replace_schedules(self, cursor, schedules: list[dict[str, Any]]) -> None:
        rows = [build_schedule_insert_row(schedule) for schedule in schedules if normalize_text(schedule.get("id"))]
        self._delete_missing_rows(
            cursor,
            table_name="biz_schedule",
            marker_column="schedule_type",
            key_column="schedule_no",
            incoming_keys=[row["schedule_no"] for row in rows],
            marker_value=STORAGE_MARKER,
        )
        if not rows:
            return
        task_nos = sorted({row["task_no"] for row in rows if row["task_no"]})
        task_map: Dict[str, int] = {}
        if task_nos:
            placeholders = ", ".join(["%s"] * len(task_nos))
            cursor.execute(
                f"SELECT task_id, task_no FROM biz_task WHERE task_no IN ({placeholders})",
                task_nos,
            )
            task_map = {row["task_no"]: row["task_id"] for row in cursor.fetchall()}
        lab_lookup_values = sorted({
            value
            for row in rows
            for value in (row.get("device_name"), row.get("lab_code"))
            if normalize_text(value)
        })
        lab_map: Dict[str, int] = {}
        if lab_lookup_values:
            placeholders = ", ".join(["%s"] * len(lab_lookup_values))
            cursor.execute(
                f"""
                SELECT lab_id, lab_code, lab_name
                FROM md_lab
                WHERE COALESCE(status, 1) = 1
                  AND (lab_name IN ({placeholders}) OR lab_code IN ({placeholders}))
                """,
                [*lab_lookup_values, *lab_lookup_values],
            )
            for row in cursor.fetchall():
                lab_id = row.get("lab_id")
                if lab_id is None:
                    continue
                lab_name = normalize_text(row.get("lab_name"))
                lab_code = normalize_text(row.get("lab_code"))
                if lab_name:
                    lab_map[lab_name] = lab_id
                if lab_code:
                    lab_map[lab_code] = lab_id
        cursor.executemany(
            """
            INSERT INTO biz_schedule (
              schedule_no, task_id, task_no, experiment_no, schedule_type, lab_id, equipment_id, temp_room_id,
              device_name, schedule_start_time, schedule_end_time, planned_hours, schedule_status,
              is_retention, created_by, remark
            ) VALUES (
              %(schedule_no)s, %(task_id)s, %(task_no)s, %(experiment_no)s, %(schedule_type)s, %(lab_id)s, NULL, NULL,
              %(device_name)s, %(schedule_start_time)s, %(schedule_end_time)s, %(planned_hours)s, %(schedule_status)s,
              %(is_retention)s, NULL, %(remark)s
            )
            ON DUPLICATE KEY UPDATE
              task_id = VALUES(task_id),
              task_no = VALUES(task_no),
              experiment_no = VALUES(experiment_no),
              schedule_type = VALUES(schedule_type),
              lab_id = VALUES(lab_id),
              device_name = VALUES(device_name),
              schedule_start_time = VALUES(schedule_start_time),
              schedule_end_time = VALUES(schedule_end_time),
              planned_hours = VALUES(planned_hours),
              schedule_status = VALUES(schedule_status),
              is_retention = VALUES(is_retention),
              remark = VALUES(remark)
            """,
            [
                {
                    **row,
                    "task_id": task_map.get(row["task_no"]),
                    "lab_id": lab_map.get(row.get("lab_code")) or row.get("lab_id") or lab_map.get(row["device_name"]),
                }
                for row in rows
            ],
        )

    def _replace_experiments(self, cursor, experiments: list[dict[str, Any]]) -> None:
        rows = [build_experiment_insert_row(experiment) for experiment in experiments if normalize_text(experiment.get("experiment_code"))]
        cursor.execute("DELETE FROM biz_experiment")
        if not rows:
            return
        task_nos = sorted({row["task_no"] for row in rows if row["task_no"]})
        task_map: Dict[str, int] = {}
        if task_nos:
            placeholders = ", ".join(["%s"] * len(task_nos))
            cursor.execute(
                f"SELECT task_id, task_no FROM biz_task WHERE task_no IN ({placeholders})",
                task_nos,
            )
            task_map = {row["task_no"]: row["task_id"] for row in cursor.fetchall()}
        cursor.executemany(
            """
            INSERT INTO biz_experiment (
              experiment_no, task_id, task_no, experiment_name, required_device, priority,
              planned_hours, experiment_status, unscheduled_since, created_at, updated_at
            ) VALUES (
              %(experiment_no)s, %(task_id)s, %(task_no)s, %(experiment_name)s, %(required_device)s, %(priority)s,
              %(planned_hours)s, %(experiment_status)s, %(unscheduled_since)s, %(created_at)s, %(updated_at)s
            )
            ON DUPLICATE KEY UPDATE
              task_id = VALUES(task_id),
              task_no = VALUES(task_no),
              experiment_name = VALUES(experiment_name),
              required_device = VALUES(required_device),
              priority = VALUES(priority),
              planned_hours = VALUES(planned_hours),
              experiment_status = VALUES(experiment_status),
              unscheduled_since = VALUES(unscheduled_since),
              updated_at = VALUES(updated_at)
            """,
            [{**row, "task_id": task_map.get(row["task_no"])} for row in rows],
        )

    def _replace_experiment_trays(self, cursor, experiment_trays: list[dict[str, Any]]) -> None:
        rows = [build_experiment_tray_insert_row(relation) for relation in experiment_trays if normalize_text(relation.get("experiment_code"))]
        cursor.execute("DELETE FROM biz_experiment_tray")
        if not rows:
            return
        cursor.executemany(
            """
            INSERT INTO biz_experiment_tray (experiment_no, task_no, tray_no, created_at, updated_at)
            VALUES (%(experiment_no)s, %(task_no)s, %(tray_no)s, %(created_at)s, %(updated_at)s)
            """,
            rows,
        )

    def _replace_experiment_samples(self, cursor, experiment_samples: list[dict[str, Any]]) -> None:
        rows = [
            build_experiment_sample_insert_row(relation)
            for relation in experiment_samples
            if normalize_text(relation.get("experiment_code")) and normalize_text(relation.get("sample_code"))
        ]
        cursor.execute("DELETE FROM biz_experiment_sample")
        if not rows:
            return
        cursor.executemany(
            """
            INSERT INTO biz_experiment_sample (experiment_no, task_no, sample_no, created_at, updated_at)
            VALUES (%(experiment_no)s, %(task_no)s, %(sample_no)s, %(created_at)s, %(updated_at)s)
            """,
            rows,
        )

    def _replace_experiment_run_trays(self, cursor, experiment_run_trays: list[dict[str, Any]]) -> None:
        rows = [
            build_experiment_run_tray_insert_row(relation)
            for relation in experiment_run_trays
            if normalize_text(relation.get("run_no") or relation.get("runNo"))
            and normalize_text(relation.get("tray_code") or relation.get("tray_no"))
        ]
        cursor.execute("DELETE FROM biz_experiment_run_tray")
        if not rows:
            return
        cursor.executemany(
            """
            INSERT INTO biz_experiment_run_tray (
              run_no, task_no, experiment_no, tray_no, run_tray_status,
              started_at, ended_at, created_at, updated_at
            ) VALUES (
              %(run_no)s, %(task_no)s, %(experiment_no)s, %(tray_no)s, %(run_tray_status)s,
              %(started_at)s, %(ended_at)s, %(created_at)s, %(updated_at)s
            )
            ON DUPLICATE KEY UPDATE
              task_no = VALUES(task_no),
              experiment_no = VALUES(experiment_no),
              run_tray_status = VALUES(run_tray_status),
              started_at = VALUES(started_at),
              ended_at = VALUES(ended_at),
              updated_at = VALUES(updated_at)
            """,
            rows,
        )

    def _replace_experiment_runs(self, cursor, experiment_runs: list[dict[str, Any]], *, replace_trays: bool = True) -> None:
        rows = [
            build_experiment_run_insert_row(run)
            for run in experiment_runs
            if normalize_text(run.get("run_no")) or normalize_text(run.get("id"))
        ]
        tray_rows = [
            tray_row
            for run in experiment_runs
            for tray_row in build_experiment_run_tray_insert_rows(run)
        ]
        if replace_trays:
            cursor.execute("DELETE FROM biz_experiment_run_tray")
        cursor.execute("DELETE FROM biz_experiment_run")
        if rows:
            cursor.executemany(
                """
                INSERT INTO biz_experiment_run (
                  run_no, schedule_no, task_no, experiment_no, device_name, planned_hours,
                  run_status, started_at, planned_end_at, ended_at, created_at, updated_at
                ) VALUES (
                  %(run_no)s, %(schedule_no)s, %(task_no)s, %(experiment_no)s, %(device_name)s, %(planned_hours)s,
                  %(run_status)s, %(started_at)s, %(planned_end_at)s, %(ended_at)s, %(created_at)s, %(updated_at)s
                )
                ON DUPLICATE KEY UPDATE
                  schedule_no = VALUES(schedule_no),
                  task_no = VALUES(task_no),
                  experiment_no = VALUES(experiment_no),
                  device_name = VALUES(device_name),
                  planned_hours = VALUES(planned_hours),
                  run_status = VALUES(run_status),
                  started_at = VALUES(started_at),
                  planned_end_at = VALUES(planned_end_at),
                  ended_at = VALUES(ended_at),
                  updated_at = VALUES(updated_at)
                """,
                rows,
            )
        if replace_trays and tray_rows:
            cursor.executemany(
                """
                INSERT INTO biz_experiment_run_tray (
                  run_no, task_no, experiment_no, tray_no, run_tray_status,
                  started_at, ended_at, created_at, updated_at
                ) VALUES (
                  %(run_no)s, %(task_no)s, %(experiment_no)s, %(tray_no)s, %(run_tray_status)s,
                  %(started_at)s, %(ended_at)s, %(created_at)s, %(updated_at)s
                )
                ON DUPLICATE KEY UPDATE
                  task_no = VALUES(task_no),
                  experiment_no = VALUES(experiment_no),
                  run_tray_status = VALUES(run_tray_status),
                  started_at = VALUES(started_at),
                  ended_at = VALUES(ended_at),
                  updated_at = VALUES(updated_at)
                """,
                tray_rows,
            )

    def _backfill_schedule_task_ids(self, cursor) -> None:
        cursor.execute(
            """
            UPDATE biz_schedule s
            JOIN biz_task t ON t.task_no = s.task_no
            SET s.task_id = t.task_id
            WHERE s.schedule_type = %s
              AND (s.task_id IS NULL OR s.task_id <> t.task_id)
            """,
            (STORAGE_MARKER,),
        )

    def _normalize_legacy_status_columns(self, cursor) -> None:
        cursor.execute(
            """
            UPDATE biz_task
            SET task_status = CASE WHEN task_status = %s THEN %s ELSE task_status END,
                transfer_status = CASE WHEN transfer_status = %s THEN %s ELSE transfer_status END
            WHERE task_status = %s
               OR transfer_status = %s
            """,
            (
                LEGACY_TASK_STORED_STATUS,
                TASK_STORED_STATUS,
                LEGACY_TASK_STORED_STATUS,
                TASK_STORED_STATUS,
                LEGACY_TASK_STORED_STATUS,
                LEGACY_TASK_STORED_STATUS,
            ),
        )
        cursor.execute(
            """
            UPDATE biz_sample
            SET sample_status = CASE WHEN sample_status = %s THEN %s ELSE sample_status END,
                flow_status = CASE WHEN flow_status = %s THEN %s ELSE flow_status END
            WHERE sample_status = %s
               OR flow_status = %s
            """,
            (
                LEGACY_TASK_STORED_STATUS,
                TASK_STORED_STATUS,
                LEGACY_TASK_STORED_STATUS,
                TASK_STORED_STATUS,
                LEGACY_TASK_STORED_STATUS,
                LEGACY_TASK_STORED_STATUS,
            ),
        )
        cursor.execute(
            """
            UPDATE biz_tray
            SET tray_status = CASE WHEN tray_status = %s THEN %s ELSE tray_status END,
                test_state = CASE WHEN test_state = %s THEN %s ELSE test_state END
            WHERE tray_status = %s
               OR test_state = %s
            """,
            (
                LEGACY_TASK_STORED_STATUS,
                TASK_STORED_STATUS,
                LEGACY_TASK_STORED_STATUS,
                TASK_STORED_STATUS,
                LEGACY_TASK_STORED_STATUS,
                LEGACY_TASK_STORED_STATUS,
            ),
        )
        cursor.execute(
            """
            UPDATE biz_tray_item
            SET status = %s
            WHERE status = %s
            """,
            (TASK_STORED_STATUS, LEGACY_TASK_STORED_STATUS),
        )
        cursor.execute(
            """
            UPDATE biz_sample_event
            SET sample_status = CASE WHEN sample_status = %s THEN %s ELSE sample_status END,
                detail = REPLACE(COALESCE(detail, ''), %s, %s)
            WHERE sample_status = %s
               OR detail LIKE %s
            """,
            (
                LEGACY_TASK_STORED_STATUS,
                TASK_STORED_STATUS,
                LEGACY_TASK_STORED_STATUS,
                TASK_STORED_STATUS,
                LEGACY_TASK_STORED_STATUS,
                f"%{LEGACY_TASK_STORED_STATUS}%",
            ),
        )
        cursor.execute(
            """
            UPDATE biz_task
            SET task_status = CASE
              WHEN task_status = %s THEN %s
              WHEN task_status IN (%s, %s) THEN %s
              ELSE task_status
            END
            WHERE task_status IN (%s, %s, %s)
            """,
            (
                LEGACY_EXPERIMENT_RUNNING_STATUS,
                TASK_RUNNING_STATUS,
                "实验完成",
                "实验已经完成",
                TASK_COMPLETED_STATUS,
                LEGACY_EXPERIMENT_RUNNING_STATUS,
                "实验完成",
                "实验已经完成",
            ),
        )
        cursor.execute(
            """
            UPDATE biz_experiment
            SET experiment_status = CASE
              WHEN experiment_status = %s THEN %s
              WHEN experiment_status IN (%s, %s) THEN %s
              ELSE experiment_status
            END
            WHERE experiment_status IN (%s, %s, %s)
            """,
            (
                LEGACY_EXPERIMENT_RUNNING_STATUS,
                EXPERIMENT_RUNNING_STATUS,
                "实验完成",
                "实验已经完成",
                CANONICAL_COMPLETED_STATUS,
                LEGACY_EXPERIMENT_RUNNING_STATUS,
                "实验完成",
                "实验已经完成",
            ),
        )
        cursor.execute(
            """
            UPDATE biz_schedule
            SET schedule_status = CASE
              WHEN schedule_status = %s THEN %s
              WHEN schedule_status IN (%s, %s) THEN %s
              ELSE schedule_status
            END
            WHERE schedule_status IN (%s, %s, %s)
            """,
            (
                LEGACY_EXPERIMENT_RUNNING_STATUS,
                EXPERIMENT_RUNNING_STATUS,
                "实验完成",
                "实验已经完成",
                CANONICAL_COMPLETED_STATUS,
                LEGACY_EXPERIMENT_RUNNING_STATUS,
                "实验完成",
                "实验已经完成",
            ),
        )
        cursor.execute(
            """
            UPDATE biz_sample
            SET sample_status = CASE
                  WHEN sample_status = %s THEN %s
                  WHEN sample_status IN (%s, %s) THEN %s
                  ELSE sample_status
                END,
                flow_status = CASE
                  WHEN flow_status = %s THEN %s
                  WHEN flow_status IN (%s, %s) THEN %s
                  ELSE flow_status
                END
            WHERE sample_status IN (%s, %s, %s)
               OR flow_status IN (%s, %s, %s)
            """,
            (
                LEGACY_EXPERIMENT_RUNNING_STATUS,
                EXPERIMENT_RUNNING_STATUS,
                "实验完成",
                "实验已经完成",
                CANONICAL_COMPLETED_STATUS,
                LEGACY_EXPERIMENT_RUNNING_STATUS,
                EXPERIMENT_RUNNING_STATUS,
                "实验完成",
                "实验已经完成",
                CANONICAL_COMPLETED_STATUS,
                LEGACY_EXPERIMENT_RUNNING_STATUS,
                "实验完成",
                "实验已经完成",
                LEGACY_EXPERIMENT_RUNNING_STATUS,
                "实验完成",
                "实验已经完成",
            ),
        )
        cursor.execute(
            """
            UPDATE biz_tray_item
            SET status = CASE
              WHEN status = %s THEN %s
              WHEN status IN (%s, %s) THEN %s
              ELSE status
            END
            WHERE status IN (%s, %s, %s)
            """,
            (
                LEGACY_EXPERIMENT_RUNNING_STATUS,
                EXPERIMENT_RUNNING_STATUS,
                "实验完成",
                "实验已经完成",
                CANONICAL_COMPLETED_STATUS,
                LEGACY_EXPERIMENT_RUNNING_STATUS,
                "实验完成",
                "实验已经完成",
            ),
        )
        cursor.execute(
            """
            UPDATE biz_sample_event
            SET sample_status = CASE
                  WHEN sample_status = %s THEN %s
                  WHEN sample_status IN (%s, %s) THEN %s
                  ELSE sample_status
                END,
                detail = REPLACE(
                  REPLACE(
                    REPLACE(COALESCE(detail, ''), %s, %s),
                    %s, %s
                  ),
                  %s, %s
                )
            WHERE sample_status IN (%s, %s, %s)
               OR detail LIKE %s
               OR detail LIKE %s
               OR detail LIKE %s
            """,
            (
                LEGACY_EXPERIMENT_RUNNING_STATUS,
                EXPERIMENT_RUNNING_STATUS,
                "实验完成",
                "实验已经完成",
                CANONICAL_COMPLETED_STATUS,
                "实验已经完成",
                CANONICAL_COMPLETED_STATUS,
                "实验完成",
                CANONICAL_COMPLETED_STATUS,
                LEGACY_EXPERIMENT_RUNNING_STATUS,
                EXPERIMENT_RUNNING_STATUS,
                LEGACY_EXPERIMENT_RUNNING_STATUS,
                "实验完成",
                "实验已经完成",
                "%实验中%",
                "%实验完成%",
                "%实验已经完成%",
            ),
        )

    def _sync_progress_statuses(self, cursor) -> None:
        self._normalize_legacy_status_columns(cursor)
        cursor.execute(
            """
            SELECT task_id, task_no, task_status
            FROM biz_task
            WHERE source_system = %s
            ORDER BY task_no ASC
            """,
            (STORAGE_MARKER,),
        )
        tasks = cursor.fetchall()
        if not tasks:
            return

        cursor.execute(
            """
            SELECT experiment_id, experiment_no, task_id, task_no, experiment_name, experiment_status
            FROM biz_experiment
            ORDER BY task_no ASC, experiment_no ASC
            """
        )
        experiments = cursor.fetchall()

        cursor.execute(
            """
            SELECT schedule_id, task_id, task_no, experiment_no, schedule_status
            FROM biz_schedule
            WHERE schedule_type = %s
            ORDER BY task_no ASC, experiment_no ASC
            """,
            (STORAGE_MARKER,),
        )
        schedules = cursor.fetchall()

        cursor.execute(
            """
            SELECT relation_id, experiment_no, task_no, sample_no
            FROM biz_experiment_sample
            ORDER BY task_no ASC, experiment_no ASC, sample_no ASC
            """
        )
        experiment_samples = cursor.fetchall()

        cursor.execute(
            """
            SELECT relation_id, experiment_no, task_no, tray_no
            FROM biz_experiment_tray
            ORDER BY task_no ASC, experiment_no ASC, tray_no ASC
            """
        )
        experiment_trays = cursor.fetchall()

        cursor.execute(
            """
            SELECT relation_id, run_no, task_no, experiment_no, tray_no, run_tray_status
            FROM biz_experiment_run_tray
            ORDER BY task_no ASC, experiment_no ASC, tray_no ASC
            """
        )
        experiment_run_trays = cursor.fetchall()

        cursor.execute(
            """
            SELECT sample_no, task_no, detail
            FROM biz_sample_event
            WHERE task_no IN (
              SELECT task_no FROM biz_task WHERE source_system = %s
            )
            ORDER BY event_time ASC, event_id ASC
            """,
            (STORAGE_MARKER,),
        )
        sample_events = cursor.fetchall()

        experiment_status_map = derive_experiment_status_map(
            experiments,
            schedules,
            experiment_samples,
            sample_events,
            experiment_trays=experiment_trays,
            experiment_run_trays=experiment_run_trays,
        )
        if experiment_status_map:
            cursor.executemany(
                "UPDATE biz_experiment SET experiment_status = %s WHERE experiment_no = %s",
                [(status, experiment_no) for experiment_no, status in experiment_status_map.items()],
            )
            if schedules:
                cursor.executemany(
                    "UPDATE biz_schedule SET schedule_status = %s WHERE schedule_id = %s",
                    [
                        (
                            experiment_status_map.get(normalize_text(row.get("experiment_no")), normalize_text(row.get("schedule_status"))),
                            row["schedule_id"],
                        )
                        for row in schedules
                    ],
                )

        task_status_map = derive_task_status_map(tasks, experiments, experiment_status_map)
        if task_status_map:
            cursor.executemany(
                "UPDATE biz_task SET task_status = %s WHERE task_no = %s",
                [(status, task_no) for task_no, status in task_status_map.items()],
            )

    def _replace_devices(self, cursor, devices: list[dict[str, Any]]) -> None:
        rows = [build_device_insert_row(device) for device in devices if normalize_text(device.get("code"))]
        self._delete_missing_rows(
            cursor,
            table_name="md_equipment",
            marker_column="manufacturer",
            key_column="equipment_code",
            incoming_keys=[row["equipment_code"] for row in rows],
            marker_value=STORAGE_MARKER,
        )
        if not rows:
            return
        cursor.executemany(
            """
            INSERT INTO md_equipment (
              equipment_code, equipment_name, equipment_type, test_type_id, lab_id, model_no,
              manufacturer, status, maintenance_start_at, maintenance_end_at, maintenance_type,
              maintenance_note, acquisition_enabled, next_calibration_date, manager_user_id,
              location_desc, remark
            ) VALUES (
              %(equipment_code)s, %(equipment_name)s, %(equipment_type)s, NULL, NULL, %(model_no)s,
              %(manufacturer)s, %(status)s, %(maintenance_start_at)s, %(maintenance_end_at)s,
              %(maintenance_type)s, %(maintenance_note)s, %(acquisition_enabled)s, %(next_calibration_date)s, NULL,
              %(location_desc)s, %(remark)s
            )
            ON DUPLICATE KEY UPDATE
              equipment_name = VALUES(equipment_name),
              equipment_type = VALUES(equipment_type),
              model_no = VALUES(model_no),
              manufacturer = VALUES(manufacturer),
              status = VALUES(status),
              maintenance_start_at = VALUES(maintenance_start_at),
              maintenance_end_at = VALUES(maintenance_end_at),
              maintenance_type = VALUES(maintenance_type),
              maintenance_note = VALUES(maintenance_note),
              acquisition_enabled = VALUES(acquisition_enabled),
              next_calibration_date = VALUES(next_calibration_date),
              location_desc = VALUES(location_desc),
              remark = VALUES(remark)
            """,
            rows,
        )

    def _replace_streams(self, cursor, streams: list[dict[str, Any]]) -> None:
        rows = [build_stream_insert_row(stream) for stream in streams if normalize_text(stream.get("id"))]
        self._delete_missing_rows(
            cursor,
            table_name="biz_data_stream",
            marker_column="remark",
            key_column="stream_no",
            incoming_keys=[row["stream_no"] for row in rows],
            marker_value=STORAGE_MARKER,
        )
        if not rows:
            return
        cursor.executemany(
            """
            INSERT INTO biz_data_stream (
              stream_no, task_id, task_no, equipment_id, equipment_code, device_name,
              last_packet_time, quality_value, stream_status, reported_flag, remark
            ) VALUES (
              %(stream_no)s, NULL, %(task_no)s, NULL, %(equipment_code)s, %(device_name)s,
              %(last_packet_time)s, %(quality_value)s, %(stream_status)s, %(reported_flag)s, %(remark)s
            )
            ON DUPLICATE KEY UPDATE
              task_no = VALUES(task_no),
              equipment_code = VALUES(equipment_code),
              device_name = VALUES(device_name),
              last_packet_time = VALUES(last_packet_time),
              quality_value = VALUES(quality_value),
              stream_status = VALUES(stream_status),
              reported_flag = VALUES(reported_flag),
              remark = VALUES(remark)
            """,
            rows,
        )

    def _replace_samples(self, cursor, samples: list[dict[str, Any]]) -> None:
        managed_samples = [sample for sample in samples if normalize_text(sample.get("code"))]
        sample_rows = [build_sample_insert_row(sample) for sample in managed_samples]
        incoming_sample_codes = [row["sample_no"] for row in sample_rows]

        cursor.execute(
            "SELECT sample_id, sample_no FROM biz_sample WHERE remark LIKE %s",
            (f"{SAMPLE_META_PREFIX}%",),
        )
        existing_sample_rows = cursor.fetchall()
        existing_sample_ids = [row["sample_id"] for row in existing_sample_rows]

        cursor.execute(
            "SELECT tray_id, tray_no FROM biz_tray WHERE remark = %s",
            (TRAY_META_PREFIX,),
        )
        existing_tray_rows = cursor.fetchall()
        existing_tray_ids = [row["tray_id"] for row in existing_tray_rows]

        if existing_sample_ids:
            placeholders = ", ".join(["%s"] * len(existing_sample_ids))
            cursor.execute(
                f"UPDATE biz_sample SET tray_id = NULL WHERE sample_id IN ({placeholders})",
                existing_sample_ids,
            )
            cursor.execute(
                f"DELETE FROM biz_sample_event WHERE sample_id IN ({placeholders})",
                existing_sample_ids,
            )

        if existing_tray_ids:
            placeholders = ", ".join(["%s"] * len(existing_tray_ids))
            cursor.execute(
                f"DELETE FROM biz_tray_item WHERE tray_id IN ({placeholders})",
                existing_tray_ids,
            )

        if incoming_sample_codes:
            placeholders = ", ".join(["%s"] * len(incoming_sample_codes))
            cursor.execute(
                f"DELETE FROM biz_sample WHERE remark LIKE %s AND sample_no NOT IN ({placeholders})",
                [f"{SAMPLE_META_PREFIX}%", *incoming_sample_codes],
            )
        else:
            cursor.execute("DELETE FROM biz_sample WHERE remark LIKE %s", (f"{SAMPLE_META_PREFIX}%",))

        sample_status_by_code = {
            normalize_text(sample.get("code")): normalize_text(sample.get("status"))
            for sample in managed_samples
            if normalize_text(sample.get("code"))
        }
        tray_defs: Dict[str, dict[str, Any]] = {}
        tray_order_by_sample: Dict[str, list[str]] = {}
        for sample in managed_samples:
            sample_code = normalize_text(sample.get("code"))
            task_code = normalize_text(sample.get("task_code"))
            for tray in sample.get("trays") or []:
                tray_code = normalize_text(tray.get("tray_code"))
                if not tray_code:
                    continue
                tray_defs.setdefault(
                    tray_code,
                    {
                        "tray_no": tray_code,
                        "task_no": task_code,
                        "capacity": None,
                        "load_qty": 0,
                        "tray_status": "ACTIVE",
                        "test_state": normalize_text(tray.get("status")) or normalize_text(sample.get("status")),
                        "bind_time": parse_storage_datetime(tray.get("created_at")) or parse_storage_datetime(sample.get("updated_at")),
                        "remark": TRAY_META_PREFIX,
                        "target_lab": normalize_text(tray.get("target_lab") or tray.get("targetLab")),
                        "samples": [],
                    },
                )
                target_lab = normalize_text(tray.get("target_lab") or tray.get("targetLab"))
                if target_lab:
                    tray_defs[tray_code]["target_lab"] = target_lab
                quantity = parse_int_value(tray.get("quantity")) or 1
                tray_defs[tray_code]["samples"].append((sample_code, quantity, tray))
                tray_defs[tray_code]["load_qty"] += quantity
                tray_defs[tray_code]["capacity"] = max(tray_defs[tray_code]["capacity"] or 0, tray_defs[tray_code]["load_qty"])
                tray_order_by_sample.setdefault(sample_code, [])
                if tray_code not in tray_order_by_sample[sample_code]:
                    tray_order_by_sample[sample_code].append(tray_code)

        incoming_tray_codes = sorted(tray_defs.keys())
        if incoming_tray_codes:
            placeholders = ", ".join(["%s"] * len(incoming_tray_codes))
            cursor.execute(
                f"DELETE FROM biz_tray WHERE remark = %s AND tray_no NOT IN ({placeholders})",
                [TRAY_META_PREFIX, *incoming_tray_codes],
            )
        else:
            cursor.execute("DELETE FROM biz_tray WHERE remark = %s", (TRAY_META_PREFIX,))

        if sample_rows:
            task_nos = sorted({row["task_no"] for row in sample_rows if row["task_no"]})
            task_map: Dict[str, int] = {}
            if task_nos:
                placeholders = ", ".join(["%s"] * len(task_nos))
                cursor.execute(
                    f"SELECT task_id, task_no FROM biz_task WHERE task_no IN ({placeholders})",
                    task_nos,
                )
                task_map = {row["task_no"]: row["task_id"] for row in cursor.fetchall()}

            sample_upsert_rows = []
            for row in sample_rows:
                sample_upsert_rows.append(
                    {
                        **row,
                        "task_id": task_map.get(row["task_no"]),
                    }
                )
            cursor.executemany(
                """
                INSERT INTO biz_sample (
                  sample_no, task_id, tray_id, sample_name, batch_no, sample_type, sample_spec, quantity, unit,
                  sample_status, received_time, arrival_time, storage_condition, barcode_no, location_desc,
                  flow_status, current_owner_id, remark, created_at, updated_at
                ) VALUES (
                  %(sample_no)s, %(task_id)s, NULL, %(sample_name)s, %(batch_no)s, %(sample_type)s, %(sample_spec)s, %(quantity)s, %(unit)s,
                  %(sample_status)s, %(received_time)s, %(arrival_time)s, %(storage_condition)s, %(barcode_no)s, %(location_desc)s,
                  %(flow_status)s, NULL, %(remark)s, %(created_at)s, %(updated_at)s
                )
                ON DUPLICATE KEY UPDATE
                  task_id = VALUES(task_id),
                  tray_id = NULL,
                  sample_name = VALUES(sample_name),
                  batch_no = VALUES(batch_no),
                  sample_type = VALUES(sample_type),
                  sample_spec = VALUES(sample_spec),
                  quantity = VALUES(quantity),
                  unit = VALUES(unit),
                  sample_status = VALUES(sample_status),
                  received_time = VALUES(received_time),
                  arrival_time = VALUES(arrival_time),
                  storage_condition = VALUES(storage_condition),
                  barcode_no = VALUES(barcode_no),
                  location_desc = VALUES(location_desc),
                  flow_status = VALUES(flow_status),
                  current_owner_id = NULL,
                  remark = VALUES(remark),
                  updated_at = VALUES(updated_at)
                """,
                sample_upsert_rows,
            )

        if incoming_sample_codes:
            placeholders = ", ".join(["%s"] * len(incoming_sample_codes))
            cursor.execute(
                f"SELECT sample_id, sample_no, task_id FROM biz_sample WHERE sample_no IN ({placeholders})",
                incoming_sample_codes,
            )
            sample_id_rows = cursor.fetchall()
        else:
            sample_id_rows = []
        sample_id_map = {row["sample_no"]: row["sample_id"] for row in sample_id_rows}
        sample_task_id_map = {row["sample_no"]: row["task_id"] for row in sample_id_rows}

        if tray_defs:
            target_lab_names = sorted({tray["target_lab"] for tray in tray_defs.values() if tray.get("target_lab")})
            target_lab_id_by_name: Dict[str, int] = {}
            if target_lab_names:
                placeholders = ", ".join(["%s"] * len(target_lab_names))
                cursor.execute(
                    f"""
                    SELECT lab_id, lab_code, lab_name
                    FROM md_lab
                    WHERE COALESCE(status, 1) = 1
                      AND (lab_name IN ({placeholders}) OR lab_code IN ({placeholders}))
                    """,
                    [*target_lab_names, *target_lab_names],
                )
                for row in cursor.fetchall():
                    lab_id = row.get("lab_id")
                    if lab_id is None:
                        continue
                    lab_name = normalize_text(row.get("lab_name"))
                    lab_code = normalize_text(row.get("lab_code"))
                    if lab_name:
                        target_lab_id_by_name[lab_name] = lab_id
                    if lab_code:
                        target_lab_id_by_name[lab_code] = lab_id
            tray_upsert_rows = []
            for tray_code, tray in tray_defs.items():
                task_id = None
                if tray["task_no"]:
                    task_id = next((sample_task_id_map.get(sample_code) for sample_code, _, _ in tray["samples"] if sample_task_id_map.get(sample_code)), None)
                current_lab_id = target_lab_id_by_name.get(normalize_text(tray.get("target_lab")))
                tray_upsert_rows.append(
                    {
                        "tray_no": tray_code,
                        "task_id": task_id,
                        "current_lab_id": current_lab_id,
                        "tray_type": STORAGE_MARKER,
                        "capacity": tray["capacity"] or tray["load_qty"],
                        "load_qty": tray["load_qty"],
                        "tray_status": tray["tray_status"],
                        "test_state": tray["test_state"],
                        "bind_time": tray["bind_time"],
                        "remark": TRAY_META_PREFIX,
                    }
                )
            cursor.executemany(
                """
                INSERT INTO biz_tray (
                  tray_no, tray_type, task_id, current_temp_room_id, current_lab_id, current_equipment_id,
                  temp_position_no, capacity, load_qty, tray_status, test_state, bind_time, in_temp_room_time,
                  out_temp_room_time, current_barcode_id, unbind_time, last_barcode_print_time, current_owner_id,
                  remark
                ) VALUES (
                  %(tray_no)s, %(tray_type)s, %(task_id)s, NULL, %(current_lab_id)s, NULL,
                  NULL, %(capacity)s, %(load_qty)s, %(tray_status)s, %(test_state)s, %(bind_time)s, NULL,
                  NULL, NULL, NULL, NULL, NULL,
                  %(remark)s
                )
                ON DUPLICATE KEY UPDATE
                  tray_type = VALUES(tray_type),
                  task_id = VALUES(task_id),
                  current_lab_id = COALESCE(VALUES(current_lab_id), current_lab_id),
                  capacity = VALUES(capacity),
                  load_qty = VALUES(load_qty),
                  tray_status = VALUES(tray_status),
                  test_state = VALUES(test_state),
                  bind_time = VALUES(bind_time),
                  remark = VALUES(remark)
                """,
                tray_upsert_rows,
            )

        if incoming_tray_codes:
            placeholders = ", ".join(["%s"] * len(incoming_tray_codes))
            cursor.execute(
                f"SELECT tray_id, tray_no FROM biz_tray WHERE tray_no IN ({placeholders})",
                incoming_tray_codes,
            )
            tray_id_rows = cursor.fetchall()
        else:
            tray_id_rows = []
        tray_id_map = {row["tray_no"]: row["tray_id"] for row in tray_id_rows}

        tray_item_rows = []
        sample_primary_tray_id: Dict[str, int] = {}
        for tray_code, tray in tray_defs.items():
            tray_id = tray_id_map.get(tray_code)
            if not tray_id:
                continue
            for index, (sample_code, quantity, tray_payload) in enumerate(tray["samples"], start=1):
                sample_id = sample_id_map.get(sample_code)
                if not sample_id:
                    continue
                sample_primary_tray_id.setdefault(sample_code, tray_id)
                tray_item_rows.append(
                    {
                        "tray_id": tray_id,
                        "sample_id": sample_id,
                        "position_no": f"P{index:02d}",
                        "quantity": quantity,
                        "bind_time": parse_storage_datetime(tray_payload.get("created_at")) or parse_storage_datetime(tray_payload.get("updated_at")),
                        "status": normalize_experiment_status_text(tray_payload.get("status")) or sample_status_by_code.get(sample_code) or "ACTIVE",
                        "created_at": parse_storage_datetime(tray_payload.get("created_at")),
                        "updated_at": parse_storage_datetime(tray_payload.get("updated_at")),
                    }
                )
        if tray_item_rows:
            cursor.executemany(
                """
                INSERT INTO biz_tray_item (
                  tray_id, sample_id, position_no, quantity, bind_time, unbind_time, status, created_at, updated_at
                ) VALUES (
                  %(tray_id)s, %(sample_id)s, %(position_no)s, %(quantity)s, %(bind_time)s, NULL, %(status)s,
                  COALESCE(%(created_at)s, CURRENT_TIMESTAMP), COALESCE(%(updated_at)s, CURRENT_TIMESTAMP)
                )
                """,
                tray_item_rows,
            )

        managed_task_nos = sorted(
            {
                normalize_text(sample.get("task_code"))
                for sample in managed_samples
                if normalize_text(sample.get("task_code"))
            }
        )
        if managed_task_nos:
            placeholders = ", ".join(["%s"] * len(managed_task_nos))
            cursor.execute(
                f"""
                DELETE FROM biz_experiment_event
                WHERE event_type = 'FIXTURE_READY'
                  AND message_id LIKE %s
                  AND task_no IN ({placeholders})
                """,
                [f"{FIXTURE_READY_COMPAT_MESSAGE_PREFIX}%", *managed_task_nos],
            )

        fixture_ready_task_times: Dict[str, datetime] = {}
        for sample in managed_samples:
            task_no = normalize_text(sample.get("task_code"))
            if not task_no:
                continue
            for tray in sample.get("trays") or []:
                if not parse_fixture_ready_flag(tray.get("fixture_ready", tray.get("fixtureReady"))):
                    continue
                event_time = (
                    parse_storage_datetime(tray.get("updated_at"))
                    or parse_storage_datetime(sample.get("updated_at"))
                    or current_beijing_datetime()
                )
                current_time = fixture_ready_task_times.get(task_no)
                if current_time is None or event_time > current_time:
                    fixture_ready_task_times[task_no] = event_time

        if fixture_ready_task_times:
            cursor.executemany(
                """
                INSERT INTO biz_experiment_event (
                  event_type, task_no, experiment_no, lab_code, success_id, event_time,
                  message_id, message_log_id, payload_json
                ) VALUES (
                  'FIXTURE_READY', %(task_no)s, NULL, NULL, NULL, %(event_time)s,
                  %(message_id)s, NULL, %(payload_json)s
                )
                ON DUPLICATE KEY UPDATE
                  event_time = VALUES(event_time),
                  payload_json = VALUES(payload_json)
                """,
                [
                    {
                        "task_no": task_no,
                        "event_time": event_time,
                        "message_id": f"{FIXTURE_READY_COMPAT_MESSAGE_PREFIX}{task_no}",
                        "payload_json": json.dumps(
                            {
                                "source": "frontend_fixture_countdown",
                                "taskNo": task_no,
                            },
                            ensure_ascii=False,
                        ),
                    }
                    for task_no, event_time in fixture_ready_task_times.items()
                ],
            )

        if sample_primary_tray_id:
            cursor.executemany(
                "UPDATE biz_sample SET tray_id = %s WHERE sample_no = %s",
                [(tray_id, sample_no) for sample_no, tray_id in sample_primary_tray_id.items()],
            )

        event_rows = []
        for sample in managed_samples:
            sample_no = normalize_text(sample.get("code"))
            sample_id = sample_id_map.get(sample_no)
            if not sample_id:
                continue
            task_id = sample_task_id_map.get(sample_no)
            for event in sample.get("history") or []:
                event_rows.append(
                    {
                        "sample_id": sample_id,
                        "sample_no": sample_no,
                        "task_id": task_id,
                        "task_no": normalize_text(sample.get("task_code")),
                        "action_type": normalize_text(event.get("action")),
                        "location_desc": normalize_text(event.get("location")),
                        "owner_name": normalize_text(event.get("owner")),
                        "sample_status": normalize_experiment_status_text(event.get("status")),
                        "detail": normalize_experiment_detail_text(event.get("detail")),
                        "event_time": parse_storage_datetime(event.get("time")) or parse_storage_datetime(sample.get("updated_at")) or parse_storage_datetime(sample.get("created_at")),
                        "created_at": parse_storage_datetime(event.get("time")) or parse_storage_datetime(sample.get("updated_at")) or parse_storage_datetime(sample.get("created_at")),
                    }
                )
        if event_rows:
            cursor.executemany(
                """
                INSERT INTO biz_sample_event (
                  sample_id, sample_no, task_id, task_no, action_type, location_desc,
                  owner_name, sample_status, detail, event_time, created_at
                ) VALUES (
                  %(sample_id)s, %(sample_no)s, %(task_id)s, %(task_no)s, %(action_type)s, %(location_desc)s,
                  %(owner_name)s, %(sample_status)s, %(detail)s, %(event_time)s, %(created_at)s
                )
                """,
                event_rows,
            )

    def _load_tasks(self, cursor) -> list[dict[str, Any]]:
        cursor.execute(
            """
            SELECT t.task_no, tr.tray_no
            FROM biz_tray tr
            JOIN biz_task t ON t.task_id = tr.task_id
            WHERE tr.remark = %s AND t.source_system = %s
            ORDER BY tr.tray_no ASC
            """,
            (TRAY_META_PREFIX, STORAGE_MARKER),
        )
        tray_map = build_storage_task_tray_codes(cursor.fetchall())
        cursor.execute(
            """
            SELECT task_no, task_name, task_source_type, client_name, contact_name, contact_phone,
                   priority, sample_count, tray_limit, sample_type, task_type, required_device, due_time,
                   arrival_time, conditions_text, attachment_path, remark, task_status, transfer_status, created_at
            FROM biz_task
            WHERE source_system = %s
            ORDER BY created_at DESC, task_no DESC
            """,
            (STORAGE_MARKER,),
        )
        return [build_storage_task_item(row, tray_codes=tray_map.get(row["task_no"])) for row in cursor.fetchall()]

    def _load_schedules(self, cursor) -> list[dict[str, Any]]:
        cursor.execute(
            """
            SELECT s.schedule_no, s.task_no, s.experiment_no, s.device_name, s.lab_id, l.lab_code,
                   s.schedule_start_time, s.schedule_end_time, s.planned_hours, s.schedule_status
            FROM biz_schedule s
            LEFT JOIN md_lab l
              ON l.lab_id = s.lab_id
            WHERE s.schedule_type = %s
            ORDER BY s.schedule_start_time DESC, s.schedule_no DESC
            """,
            (STORAGE_MARKER,),
        )
        return [build_storage_schedule_item(row) for row in cursor.fetchall()]

    def _load_experiments(self, cursor) -> list[dict[str, Any]]:
        cursor.execute(
            """
            SELECT experiment_no, task_no, experiment_name, required_device, priority,
                   planned_hours, experiment_status, unscheduled_since, created_at, updated_at
            FROM biz_experiment
            ORDER BY task_no ASC, experiment_no ASC
            """
        )
        return [build_storage_experiment_item(row) for row in cursor.fetchall()]

    def _load_experiment_trays(self, cursor) -> list[dict[str, Any]]:
        cursor.execute(
            """
            SELECT relation_id, experiment_no, task_no, tray_no, created_at, updated_at
            FROM biz_experiment_tray
            ORDER BY task_no ASC, experiment_no ASC, tray_no ASC
            """
        )
        return [build_storage_experiment_tray_item(row) for row in cursor.fetchall()]

    def _load_experiment_samples(self, cursor) -> list[dict[str, Any]]:
        cursor.execute(
            """
            SELECT relation_id, experiment_no, task_no, sample_no, created_at, updated_at
            FROM biz_experiment_sample
            ORDER BY task_no ASC, experiment_no ASC, sample_no ASC
            """
        )
        return [build_storage_experiment_sample_item(row) for row in cursor.fetchall()]

    def _load_experiment_runs(self, cursor) -> list[dict[str, Any]]:
        cursor.execute(
            """
            SELECT run_no, tray_no
            FROM biz_experiment_run_tray
            ORDER BY run_no ASC, tray_no ASC
            """
        )
        tray_map: dict[str, list[str]] = {}
        for row in cursor.fetchall():
            run_no = normalize_text(row.get("run_no"))
            tray_no = normalize_text(row.get("tray_no"))
            if run_no and tray_no:
                tray_map.setdefault(run_no, []).append(tray_no)

        cursor.execute(
            """
            SELECT run_no, schedule_no, task_no, experiment_no, device_name, planned_hours,
                   run_status, started_at, planned_end_at, ended_at, created_at, updated_at
            FROM biz_experiment_run
            ORDER BY started_at DESC, run_no DESC
            """
        )
        return [build_storage_experiment_run_item(row, tray_codes=tray_map.get(normalize_text(row.get("run_no")))) for row in cursor.fetchall()]

    def _load_experiment_run_trays(self, cursor) -> list[dict[str, Any]]:
        cursor.execute(
            """
            SELECT relation_id, run_no, task_no, experiment_no, tray_no, run_tray_status,
                   started_at, ended_at, created_at, updated_at
            FROM biz_experiment_run_tray
            ORDER BY task_no ASC, experiment_no ASC, run_no ASC, tray_no ASC
            """
        )
        return [build_storage_experiment_run_tray_item(row) for row in cursor.fetchall()]

    def _load_devices(self, cursor) -> list[dict[str, Any]]:
        cursor.execute(
            """
            SELECT equipment_code, equipment_name, equipment_type, model_no, status,
                   maintenance_start_at, maintenance_end_at, maintenance_type, maintenance_note,
                   acquisition_enabled, next_calibration_date, location_desc, remark
            FROM md_equipment
            WHERE manufacturer = %s
            ORDER BY equipment_code ASC
            """,
            (STORAGE_MARKER,),
        )
        return [build_storage_device_item(row) for row in cursor.fetchall()]

    def _load_streams(self, cursor) -> list[dict[str, Any]]:
        cursor.execute(
            """
            SELECT stream_no, task_no, equipment_code, device_name, last_packet_time,
                   quality_value, stream_status, reported_flag
            FROM biz_data_stream
            WHERE remark = %s
            ORDER BY last_packet_time DESC, stream_no DESC
            """,
            (STORAGE_MARKER,),
        )
        return [build_storage_stream_item(row) for row in cursor.fetchall()]

    def _load_samples(
        self,
        cursor,
        staging_event_rows: Iterable[Dict[str, Any]] | None = None,
        schedules: Iterable[Dict[str, Any]] | None = None,
        experiment_trays: Iterable[Dict[str, Any]] | None = None,
    ) -> list[dict[str, Any]]:
        cursor.execute(
            """
            SELECT s.sample_id, s.sample_no, t.task_no, s.sample_type, s.batch_no, s.arrival_time,
                   s.quantity, s.storage_condition, s.barcode_no, s.location_desc, s.sample_status,
                   s.flow_status, s.remark, s.created_at, s.updated_at
            FROM biz_sample s
            LEFT JOIN biz_task t ON t.task_id = s.task_id
            WHERE s.remark LIKE %s
            ORDER BY s.created_at DESC, s.sample_no DESC
            """,
            (f"{SAMPLE_META_PREFIX}%",),
        )
        sample_rows = cursor.fetchall()
        if not sample_rows:
            return []

        sample_ids = [row["sample_id"] for row in sample_rows]
        placeholders = ", ".join(["%s"] * len(sample_ids))

        cursor.execute(
            f"""
            SELECT ti.sample_id, t.task_no, tr.tray_no AS tray_code, s.sample_no AS sample_code, ti.quantity, ti.status,
                   tr.test_state, tr.tray_status, ti.created_at, ti.updated_at
            FROM biz_tray_item ti
            JOIN biz_tray tr ON tr.tray_id = ti.tray_id
            JOIN biz_sample s ON s.sample_id = ti.sample_id
            LEFT JOIN biz_task t ON t.task_id = s.task_id
            WHERE ti.sample_id IN ({placeholders})
            ORDER BY ti.created_at DESC, tr.tray_no ASC
            """,
            sample_ids,
        )
        tray_rows = cursor.fetchall()
        task_nos = sorted({normalize_text(row.get("task_no")) for row in sample_rows if normalize_text(row.get("task_no"))})
        fixture_ready_task_times: Dict[str, datetime] = {}
        latest_install_task_times: Dict[str, datetime] = {}
        if task_nos:
            task_placeholders = ", ".join(["%s"] * len(task_nos))
            cursor.execute(
                f"""
                SELECT task_no, MAX(event_time) AS event_time
                FROM biz_experiment_event
                WHERE event_type = 'FIXTURE_READY'
                  AND task_no IN ({task_placeholders})
                GROUP BY task_no
                """,
                task_nos,
            )
            fixture_ready_task_times = {
                normalize_text(row.get("task_no")): parse_storage_datetime(row.get("event_time"))
                for row in cursor.fetchall()
                if normalize_text(row.get("task_no")) and parse_storage_datetime(row.get("event_time")) is not None
            }
            cursor.execute(
                f"""
                SELECT task_no, MAX(event_time) AS event_time
                FROM biz_sample_event
                WHERE action_type IN ('样品安装', '工装夹具安装')
                  AND task_no IN ({task_placeholders})
                GROUP BY task_no
                """,
                task_nos,
            )
            latest_install_task_times = {
                normalize_text(row.get("task_no")): parse_storage_datetime(row.get("event_time"))
                for row in cursor.fetchall()
                if normalize_text(row.get("task_no")) and parse_storage_datetime(row.get("event_time")) is not None
            }
        tray_map: Dict[int, list[dict[str, Any]]] = {}
        for row in tray_rows:
            task_no = normalize_text(row.get("task_no"))
            fixture_ready_time = fixture_ready_task_times.get(task_no)
            install_time = latest_install_task_times.get(task_no)
            if fixture_ready_time is not None and (install_time is None or fixture_ready_time >= install_time):
                row["fixture_ready"] = True
                row["fixtureReady"] = True
            tray_map.setdefault(row["sample_id"], []).append(row)

        cursor.execute(
            f"""
            SELECT event_id, sample_id, sample_no, action_type, location_desc, owner_name, sample_status, detail, event_time
            FROM biz_sample_event
            WHERE sample_id IN ({placeholders})
            ORDER BY event_time DESC, event_id DESC
            """,
            sample_ids,
        )
        event_rows = cursor.fetchall()
        event_map: Dict[int, list[dict[str, Any]]] = {}
        for row in event_rows:
            event_map.setdefault(row["sample_id"], []).append(row)

        return [
            build_storage_sample_item(
                row,
                tray_rows=tray_map.get(row["sample_id"], []),
                event_rows=event_map.get(row["sample_id"], []),
                staging_event_rows=staging_event_rows,
                schedules=schedules,
                experiment_trays=experiment_trays,
            )
            for row in sample_rows
        ]

    def _update_experiment_unscheduled_since(
        self,
        cursor,
        repaired: dict[str, datetime],
    ) -> None:
        if not repaired:
            return
        cursor.executemany(
            """
            UPDATE biz_experiment
            SET unscheduled_since = %(unscheduled_since)s,
                updated_at = CURRENT_TIMESTAMP
            WHERE experiment_no = %(experiment_no)s
              AND unscheduled_since IS NULL
            """,
            [
                {
                    "experiment_no": experiment_no,
                    "unscheduled_since": unscheduled_since,
                }
                for experiment_no, unscheduled_since in repaired.items()
                if experiment_no
            ],
        )

    def _backfill_unscheduled_since_for_reads(
        self,
        cursor,
        *,
        tasks: list[dict[str, Any]],
        schedules: list[dict[str, Any]],
        experiments: list[dict[str, Any]],
        experiment_trays: list[dict[str, Any]],
        experiment_samples: list[dict[str, Any]],
        samples: list[dict[str, Any]],
    ) -> tuple[list[dict[str, Any]], bool]:
        next_experiments, repaired = backfill_missing_unscheduled_since(
            tasks,
            schedules,
            experiments,
            experiment_trays,
            experiment_samples,
            samples,
        )
        if not repaired:
            return next_experiments, False
        self._update_experiment_unscheduled_since(cursor, repaired)
        return next_experiments, True

    def _write_many_internal(self, updates: Dict[str, Any]) -> None:
        self._ensure_schema_extensions()
        relational_updates = {key: updates.get(key) for key in RELATIONAL_STORAGE_KEYS if key in updates}
        snapshot_updates = self._serialize_snapshot_updates(updates)

        with self._connect() as connection:
            with connection.cursor() as cursor:
                if "mes.devices" in relational_updates:
                    self._replace_devices(cursor, relational_updates["mes.devices"] or [])
                if "mes.tasks" in relational_updates:
                    self._replace_tasks(cursor, relational_updates["mes.tasks"] or [], prune=False)
                if "mes.schedules" in relational_updates:
                    self._replace_schedules(cursor, relational_updates["mes.schedules"] or [])
                if "mes.streams" in relational_updates:
                    self._replace_streams(cursor, relational_updates["mes.streams"] or [])
                if "mes.samples" in relational_updates:
                    self._replace_samples(cursor, relational_updates["mes.samples"] or [])
                if "mes.experiments" in relational_updates:
                    self._replace_experiments(cursor, relational_updates["mes.experiments"] or [])
                if "mes.experiment_runs" in relational_updates:
                    self._replace_experiment_runs(
                        cursor,
                        relational_updates["mes.experiment_runs"] or [],
                        replace_trays="mes.experiment_run_trays" not in relational_updates,
                    )
                if "mes.experiment_run_trays" in relational_updates:
                    self._replace_experiment_run_trays(cursor, relational_updates["mes.experiment_run_trays"] or [])
                if "mes.experiment_trays" in relational_updates:
                    self._replace_experiment_trays(cursor, relational_updates["mes.experiment_trays"] or [])
                if "mes.experiment_samples" in relational_updates:
                    self._replace_experiment_samples(cursor, relational_updates["mes.experiment_samples"] or [])
                if "mes.tasks" in relational_updates:
                    self._replace_tasks(cursor, relational_updates["mes.tasks"] or [], prune=True)
                if relational_updates:
                    self._backfill_schedule_task_ids(cursor)
                    self._sync_progress_statuses(cursor)
            connection.commit()

        if snapshot_updates:
            self._snapshot_repository.write_many(snapshot_updates)

    def read_all(self) -> Dict[str, Any]:
        with self._lock:
            self._ensure_schema_extensions()
            snapshot_values = self._deserialize_snapshot_payloads(self._snapshot_repository.read_all())
            with self._connect() as connection:
                with connection.cursor() as cursor:
                    self._normalize_legacy_status_columns(cursor)
                    connection.commit()
                    tasks = self._load_tasks(cursor)
                    schedules = self._load_schedules(cursor)
                    experiments = self._load_experiments(cursor)
                    experiment_runs = self._load_experiment_runs(cursor)
                    experiment_run_trays = self._load_experiment_run_trays(cursor)
                    experiment_trays = self._load_experiment_trays(cursor)
                    experiment_samples = self._load_experiment_samples(cursor)
                    samples = self._load_samples(
                        cursor,
                        snapshot_values.get("mes.staging_events"),
                        schedules=schedules,
                        experiment_trays=experiment_trays,
                    )
                    experiments, repaired = self._backfill_unscheduled_since_for_reads(
                        cursor,
                        tasks=tasks,
                        schedules=schedules,
                        experiments=experiments,
                        experiment_trays=experiment_trays,
                        experiment_samples=experiment_samples,
                        samples=samples,
                    )
                    if repaired:
                        connection.commit()
                    data = {
                        "mes.tasks": tasks,
                        "mes.schedules": schedules,
                        "mes.devices": self._load_devices(cursor),
                        "mes.streams": self._load_streams(cursor),
                        "mes.samples": samples,
                        "mes.experiments": experiments,
                        "mes.experiment_runs": experiment_runs,
                        "mes.experiment_run_trays": experiment_run_trays,
                        "mes.experiment_trays": experiment_trays,
                        "mes.experiment_samples": experiment_samples,
                    }
            data.update(snapshot_values)
            for key in STORAGE_KEYS:
                data.setdefault(key, [])
            data.setdefault(STORAGE_META_KEY, {"schema_version": CURRENT_SCHEMA_VERSION})
            return normalize_storage_payload(data)

    def read(self, key: str) -> Any:
        if key not in STORAGE_KEYS:
            return []
        with self._lock:
            self._ensure_schema_extensions()
            if key in SNAPSHOT_STORAGE_KEYS:
                snapshot_values = self._deserialize_snapshot_payloads(self._snapshot_repository.read_all())
                return snapshot_values.get(key, [])
            with self._connect() as connection:
                with connection.cursor() as cursor:
                    self._normalize_legacy_status_columns(cursor)
                    connection.commit()
                    tasks = self._load_tasks(cursor)
                    schedules = self._load_schedules(cursor)
                    snapshot_values = self._deserialize_snapshot_payloads(self._snapshot_repository.read_all())
                    experiments = self._load_experiments(cursor)
                    experiment_runs = self._load_experiment_runs(cursor)
                    experiment_run_trays = self._load_experiment_run_trays(cursor)
                    experiment_trays = self._load_experiment_trays(cursor)
                    experiment_samples = self._load_experiment_samples(cursor)
                    samples = self._load_samples(
                        cursor,
                        snapshot_values.get("mes.staging_events"),
                        schedules=schedules,
                        experiment_trays=experiment_trays,
                    )
                    experiments, repaired = self._backfill_unscheduled_since_for_reads(
                        cursor,
                        tasks=tasks,
                        schedules=schedules,
                        experiments=experiments,
                        experiment_trays=experiment_trays,
                        experiment_samples=experiment_samples,
                        samples=samples,
                    )
                    if repaired:
                        connection.commit()
                    if key == "mes.tasks":
                        return tasks
                    if key == "mes.schedules":
                        return schedules
                    if key == "mes.devices":
                        return self._load_devices(cursor)
                    if key == "mes.streams":
                        return self._load_streams(cursor)
                    if key == "mes.samples":
                        return samples
                    if key == "mes.experiments":
                        return experiments
                    if key == "mes.experiment_runs":
                        return experiment_runs
                    if key == "mes.experiment_run_trays":
                        return experiment_run_trays
                    if key == "mes.experiment_trays":
                        return experiment_trays
                    if key == "mes.experiment_samples":
                        return experiment_samples
            return []

    def write(self, key: str, value: Any) -> None:
        self.write_many({key: value})

    def write_many(self, updates: Dict[str, Any]) -> None:
        with self._lock:
            normalized_updates = {
                key: (
                    _normalize_value(key, value if isinstance(value, dict) else {})
                    if key == STORAGE_META_KEY
                    else _normalize_value(key, value if isinstance(value, list) else [])
                )
                for key, value in updates.items()
                if key in STORAGE_KEYS or key == STORAGE_META_KEY
            }
            if not normalized_updates:
                return
            self._write_many_internal(normalized_updates)
