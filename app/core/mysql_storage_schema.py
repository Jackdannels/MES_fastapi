from __future__ import annotations

from typing import Any

from app.core.master_data import DEFAULT_LABS, DEFAULT_TEST_TYPES
from app.core.mysql_storage_codecs import parse_varchar_length
from app.services.attendance_service import ATTENDANCE_SCHEMA_SQL


def ensure_schema_extensions(backend: Any) -> None:
    if backend._schema_initialized:
        return
    with backend._connect() as connection:
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
            cursor.execute("SHOW COLUMNS FROM biz_schedule LIKE 'axis_codes_json'")
            if cursor.fetchone() is None:
                cursor.execute("ALTER TABLE biz_schedule ADD COLUMN axis_codes_json JSON NULL AFTER device_name")
            cursor.execute("SHOW COLUMNS FROM biz_schedule LIKE 'axis_batch_no'")
            if cursor.fetchone() is None:
                cursor.execute("ALTER TABLE biz_schedule ADD COLUMN axis_batch_no VARCHAR(50) NULL AFTER axis_codes_json")
            cursor.execute("SHOW COLUMNS FROM biz_schedule LIKE 'sub_experiment_code'")
            if cursor.fetchone() is None:
                cursor.execute("ALTER TABLE biz_schedule ADD COLUMN sub_experiment_code VARCHAR(80) NULL AFTER experiment_no")
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
                  axis_codes_json JSON NULL,
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
            cursor.execute("SHOW COLUMNS FROM biz_experiment LIKE 'axis_codes_json'")
            if cursor.fetchone() is None:
                cursor.execute("ALTER TABLE biz_experiment ADD COLUMN axis_codes_json JSON NULL AFTER experiment_status")
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
                  sub_experiment_code VARCHAR(80) NULL,
                  device_name VARCHAR(100) NULL,
                  axis_codes_json JSON NULL,
                  axis_batch_no VARCHAR(50) NULL,
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
            cursor.execute("SHOW COLUMNS FROM biz_experiment_run LIKE 'axis_codes_json'")
            if cursor.fetchone() is None:
                cursor.execute("ALTER TABLE biz_experiment_run ADD COLUMN axis_codes_json JSON NULL AFTER device_name")
            cursor.execute("SHOW COLUMNS FROM biz_experiment_run LIKE 'axis_batch_no'")
            if cursor.fetchone() is None:
                cursor.execute("ALTER TABLE biz_experiment_run ADD COLUMN axis_batch_no VARCHAR(50) NULL AFTER axis_codes_json")
            cursor.execute("SHOW COLUMNS FROM biz_experiment_run LIKE 'sub_experiment_code'")
            if cursor.fetchone() is None:
                cursor.execute("ALTER TABLE biz_experiment_run ADD COLUMN sub_experiment_code VARCHAR(80) NULL AFTER experiment_no")
            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS biz_experiment_run_step (
                  step_id BIGINT NOT NULL AUTO_INCREMENT,
                  run_no VARCHAR(80) NOT NULL,
                  task_no VARCHAR(50) NOT NULL,
                  experiment_no VARCHAR(50) NOT NULL,
                  sub_experiment_code VARCHAR(80) NULL,
                  axis_code VARCHAR(20) NOT NULL,
                  step_no INT NOT NULL,
                  step_status VARCHAR(30) NULL,
                  started_at DATETIME NULL,
                  ended_at DATETIME NULL,
                  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                  PRIMARY KEY (step_id),
                  UNIQUE KEY uk_biz_experiment_run_step_axis (run_no, axis_code),
                  KEY idx_biz_experiment_run_step_run (run_no),
                  KEY idx_biz_experiment_run_step_task_exp (task_no, experiment_no),
                  KEY idx_biz_experiment_run_step_status (step_status)
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
                  sub_experiment_code VARCHAR(80) NULL,
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
            cursor.execute("SHOW COLUMNS FROM biz_experiment_run_step LIKE 'sub_experiment_code'")
            if cursor.fetchone() is None:
                cursor.execute("ALTER TABLE biz_experiment_run_step ADD COLUMN sub_experiment_code VARCHAR(80) NULL AFTER experiment_no")
            cursor.execute("SHOW COLUMNS FROM biz_experiment_run_tray LIKE 'sub_experiment_code'")
            if cursor.fetchone() is None:
                cursor.execute("ALTER TABLE biz_experiment_run_tray ADD COLUMN sub_experiment_code VARCHAR(80) NULL AFTER experiment_no")
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
                  sub_experiment_code VARCHAR(80) NULL,
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
                  sub_experiment_code VARCHAR(80) NULL,
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
                  sub_experiment_code VARCHAR(80) NULL,
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
            cursor.execute("SHOW COLUMNS FROM biz_mq_message_log LIKE 'sub_experiment_code'")
            if cursor.fetchone() is None:
                cursor.execute("ALTER TABLE biz_mq_message_log ADD COLUMN sub_experiment_code VARCHAR(80) NULL AFTER experiment_no")
            cursor.execute("SHOW COLUMNS FROM biz_experiment_event LIKE 'sub_experiment_code'")
            if cursor.fetchone() is None:
                cursor.execute("ALTER TABLE biz_experiment_event ADD COLUMN sub_experiment_code VARCHAR(80) NULL AFTER experiment_no")
            cursor.execute("SHOW COLUMNS FROM biz_experiment_result LIKE 'sub_experiment_code'")
            if cursor.fetchone() is None:
                cursor.execute("ALTER TABLE biz_experiment_result ADD COLUMN sub_experiment_code VARCHAR(80) NULL AFTER experiment_no")
            for statement in ATTENDANCE_SCHEMA_SQL.split(";"):
                normalized_statement = statement.strip()
                if normalized_statement:
                    cursor.execute(normalized_statement)
        connection.commit()
    backend._schema_initialized = True
