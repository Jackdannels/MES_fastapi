USE mes_single_branch;

-- Finalize columns and indexes that older application versions created lazily
-- during business requests. After this migration, runtime accounts need no DDL.

DROP PROCEDURE IF EXISTS v4_add_column_if_missing;
DROP PROCEDURE IF EXISTS v4_add_index_if_missing;
DROP PROCEDURE IF EXISTS v4_widen_varchar_if_shorter;

DELIMITER $$

CREATE PROCEDURE v4_add_column_if_missing(
  IN schema_name VARCHAR(64),
  IN table_name_value VARCHAR(64),
  IN column_name_value VARCHAR(64),
  IN ddl_text TEXT
)
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = schema_name
      AND TABLE_NAME = table_name_value
      AND COLUMN_NAME = column_name_value
  ) THEN
    SET @v4_ddl = ddl_text;
    PREPARE v4_stmt FROM @v4_ddl;
    EXECUTE v4_stmt;
    DEALLOCATE PREPARE v4_stmt;
  END IF;
END$$

CREATE PROCEDURE v4_add_index_if_missing(
  IN schema_name VARCHAR(64),
  IN table_name_value VARCHAR(64),
  IN index_name_value VARCHAR(64),
  IN ddl_text TEXT
)
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = schema_name
      AND TABLE_NAME = table_name_value
      AND INDEX_NAME = index_name_value
  ) THEN
    SET @v4_ddl = ddl_text;
    PREPARE v4_stmt FROM @v4_ddl;
    EXECUTE v4_stmt;
    DEALLOCATE PREPARE v4_stmt;
  END IF;
END$$

CREATE PROCEDURE v4_widen_varchar_if_shorter(
  IN schema_name VARCHAR(64),
  IN table_name_value VARCHAR(64),
  IN column_name_value VARCHAR(64),
  IN required_length INT,
  IN ddl_text TEXT
)
BEGIN
  DECLARE current_length BIGINT DEFAULT NULL;

  SELECT CHARACTER_MAXIMUM_LENGTH
    INTO current_length
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = schema_name
    AND TABLE_NAME = table_name_value
    AND COLUMN_NAME = column_name_value
  LIMIT 1;

  IF current_length IS NOT NULL AND current_length < required_length THEN
    SET @v4_ddl = ddl_text;
    PREPARE v4_stmt FROM @v4_ddl;
    EXECUTE v4_stmt;
    DEALLOCATE PREPARE v4_stmt;
  END IF;
END$$

DELIMITER ;

CALL v4_add_column_if_missing('mes_single_branch', 'biz_task', 'transfer_status',
  'ALTER TABLE biz_task ADD COLUMN transfer_status VARCHAR(30) NULL AFTER task_status');
CALL v4_add_column_if_missing('mes_single_branch', 'biz_task', 'tray_limit',
  'ALTER TABLE biz_task ADD COLUMN tray_limit INT NULL AFTER sample_count');
CALL v4_add_column_if_missing('mes_single_branch', 'biz_task', 'required_device',
  'ALTER TABLE biz_task ADD COLUMN required_device VARCHAR(200) NULL AFTER due_time');
CALL v4_widen_varchar_if_shorter('mes_single_branch', 'biz_task', 'task_type', 200,
  'ALTER TABLE biz_task MODIFY COLUMN task_type VARCHAR(200) NOT NULL');
CALL v4_widen_varchar_if_shorter('mes_single_branch', 'biz_task', 'required_device', 200,
  'ALTER TABLE biz_task MODIFY COLUMN required_device VARCHAR(200) NULL');

CALL v4_add_column_if_missing('mes_single_branch', 'biz_tray', 'fixture_ready',
  'ALTER TABLE biz_tray ADD COLUMN fixture_ready TINYINT NOT NULL DEFAULT 0 AFTER test_state');
CALL v4_add_column_if_missing('mes_single_branch', 'biz_tray', 'target_sub_experiment_code',
  'ALTER TABLE biz_tray ADD COLUMN target_sub_experiment_code VARCHAR(80) NULL AFTER fixture_ready');

CALL v4_add_column_if_missing('mes_single_branch', 'md_test_type', 'test_category',
  'ALTER TABLE md_test_type ADD COLUMN test_category VARCHAR(50) NULL AFTER test_type_name');
CALL v4_add_column_if_missing('mes_single_branch', 'md_test_type', 'default_duration_hour',
  'ALTER TABLE md_test_type ADD COLUMN default_duration_hour DECIMAL(10,2) NULL AFTER test_category');
CALL v4_add_column_if_missing('mes_single_branch', 'md_test_type', 'status',
  'ALTER TABLE md_test_type ADD COLUMN status TINYINT NOT NULL DEFAULT 1 AFTER default_duration_hour');
CALL v4_add_column_if_missing('mes_single_branch', 'md_test_type', 'remark',
  'ALTER TABLE md_test_type ADD COLUMN remark VARCHAR(300) NULL AFTER status');

CALL v4_add_column_if_missing('mes_single_branch', 'md_lab', 'lab_type',
  'ALTER TABLE md_lab ADD COLUMN lab_type VARCHAR(30) NULL AFTER lab_name');
CALL v4_add_column_if_missing('mes_single_branch', 'md_lab', 'test_type_id',
  'ALTER TABLE md_lab ADD COLUMN test_type_id BIGINT NULL AFTER lab_type');
CALL v4_add_column_if_missing('mes_single_branch', 'md_lab', 'dept_id',
  'ALTER TABLE md_lab ADD COLUMN dept_id BIGINT NULL AFTER test_type_id');
CALL v4_add_column_if_missing('mes_single_branch', 'md_lab', 'manager_user_id',
  'ALTER TABLE md_lab ADD COLUMN manager_user_id BIGINT NULL AFTER dept_id');
CALL v4_add_column_if_missing('mes_single_branch', 'md_lab', 'capacity',
  'ALTER TABLE md_lab ADD COLUMN capacity INT NULL AFTER manager_user_id');
CALL v4_add_column_if_missing('mes_single_branch', 'md_lab', 'location_desc',
  'ALTER TABLE md_lab ADD COLUMN location_desc VARCHAR(200) NULL AFTER capacity');
CALL v4_add_column_if_missing('mes_single_branch', 'md_lab', 'status',
  'ALTER TABLE md_lab ADD COLUMN status TINYINT NOT NULL DEFAULT 1 AFTER location_desc');
CALL v4_add_column_if_missing('mes_single_branch', 'md_lab', 'remark',
  'ALTER TABLE md_lab ADD COLUMN remark VARCHAR(300) NULL AFTER status');

CALL v4_add_column_if_missing('mes_single_branch', 'md_equipment', 'maintenance_start_at',
  'ALTER TABLE md_equipment ADD COLUMN maintenance_start_at DATETIME NULL AFTER status');
CALL v4_add_column_if_missing('mes_single_branch', 'md_equipment', 'maintenance_end_at',
  'ALTER TABLE md_equipment ADD COLUMN maintenance_end_at DATETIME NULL AFTER maintenance_start_at');
CALL v4_add_column_if_missing('mes_single_branch', 'md_equipment', 'maintenance_type',
  'ALTER TABLE md_equipment ADD COLUMN maintenance_type VARCHAR(30) NULL AFTER maintenance_end_at');
CALL v4_add_column_if_missing('mes_single_branch', 'md_equipment', 'maintenance_note',
  'ALTER TABLE md_equipment ADD COLUMN maintenance_note VARCHAR(500) NULL AFTER maintenance_type');

CALL v4_add_column_if_missing('mes_single_branch', 'biz_schedule', 'experiment_no',
  'ALTER TABLE biz_schedule ADD COLUMN experiment_no VARCHAR(50) NULL AFTER task_no');
CALL v4_add_column_if_missing('mes_single_branch', 'biz_schedule', 'lab_id',
  'ALTER TABLE biz_schedule ADD COLUMN lab_id BIGINT NULL AFTER schedule_type');
CALL v4_add_column_if_missing('mes_single_branch', 'biz_schedule', 'axis_codes_json',
  'ALTER TABLE biz_schedule ADD COLUMN axis_codes_json JSON NULL AFTER device_name');
CALL v4_add_column_if_missing('mes_single_branch', 'biz_schedule', 'axis_batch_no',
  'ALTER TABLE biz_schedule ADD COLUMN axis_batch_no VARCHAR(50) NULL AFTER axis_codes_json');
CALL v4_add_column_if_missing('mes_single_branch', 'biz_schedule', 'sub_experiment_code',
  'ALTER TABLE biz_schedule ADD COLUMN sub_experiment_code VARCHAR(80) NULL AFTER experiment_no');

CALL v4_add_column_if_missing('mes_single_branch', 'biz_experiment', 'unscheduled_since',
  'ALTER TABLE biz_experiment ADD COLUMN unscheduled_since DATETIME NULL AFTER experiment_status');
CALL v4_add_column_if_missing('mes_single_branch', 'biz_experiment', 'axis_codes_json',
  'ALTER TABLE biz_experiment ADD COLUMN axis_codes_json JSON NULL AFTER experiment_status');
CALL v4_add_column_if_missing('mes_single_branch', 'biz_experiment', 'actual_start_time',
  'ALTER TABLE biz_experiment ADD COLUMN actual_start_time DATETIME NULL AFTER unscheduled_since');
CALL v4_add_column_if_missing('mes_single_branch', 'biz_experiment', 'actual_end_time',
  'ALTER TABLE biz_experiment ADD COLUMN actual_end_time DATETIME NULL AFTER actual_start_time');

CALL v4_add_column_if_missing('mes_single_branch', 'biz_experiment_run', 'axis_codes_json',
  'ALTER TABLE biz_experiment_run ADD COLUMN axis_codes_json JSON NULL AFTER device_name');
CALL v4_add_column_if_missing('mes_single_branch', 'biz_experiment_run', 'axis_batch_no',
  'ALTER TABLE biz_experiment_run ADD COLUMN axis_batch_no VARCHAR(50) NULL AFTER axis_codes_json');
CALL v4_add_column_if_missing('mes_single_branch', 'biz_experiment_run', 'sub_experiment_code',
  'ALTER TABLE biz_experiment_run ADD COLUMN sub_experiment_code VARCHAR(80) NULL AFTER experiment_no');
CALL v4_add_column_if_missing('mes_single_branch', 'biz_experiment_run_step', 'sub_experiment_code',
  'ALTER TABLE biz_experiment_run_step ADD COLUMN sub_experiment_code VARCHAR(80) NULL AFTER experiment_no');
CALL v4_add_column_if_missing('mes_single_branch', 'biz_experiment_run_tray', 'sub_experiment_code',
  'ALTER TABLE biz_experiment_run_tray ADD COLUMN sub_experiment_code VARCHAR(80) NULL AFTER experiment_no');
CALL v4_add_column_if_missing('mes_single_branch', 'biz_mq_message_log', 'sub_experiment_code',
  'ALTER TABLE biz_mq_message_log ADD COLUMN sub_experiment_code VARCHAR(80) NULL AFTER experiment_no');
CALL v4_add_column_if_missing('mes_single_branch', 'biz_experiment_event', 'sub_experiment_code',
  'ALTER TABLE biz_experiment_event ADD COLUMN sub_experiment_code VARCHAR(80) NULL AFTER experiment_no');
CALL v4_add_column_if_missing('mes_single_branch', 'biz_experiment_result', 'sub_experiment_code',
  'ALTER TABLE biz_experiment_result ADD COLUMN sub_experiment_code VARCHAR(80) NULL AFTER experiment_no');

CALL v4_add_column_if_missing('mes_single_branch', 'sys_attendance_user', 'qr_token_hash',
  'ALTER TABLE sys_attendance_user ADD COLUMN qr_token_hash VARCHAR(64) NULL AFTER password_hash');
CALL v4_add_column_if_missing('mes_single_branch', 'sys_attendance_user', 'qr_token_payload',
  'ALTER TABLE sys_attendance_user ADD COLUMN qr_token_payload VARCHAR(255) NULL AFTER qr_token_hash');
CALL v4_add_column_if_missing('mes_single_branch', 'sys_attendance_user', 'qr_token_created_at',
  'ALTER TABLE sys_attendance_user ADD COLUMN qr_token_created_at DATETIME NULL AFTER qr_token_payload');

CALL v4_add_index_if_missing('mes_single_branch', 'biz_task', 'idx_biz_task_storage_read',
  'ALTER TABLE biz_task ADD INDEX idx_biz_task_storage_read (source_system, created_at, task_no)');
CALL v4_add_index_if_missing('mes_single_branch', 'biz_sample', 'idx_biz_sample_storage_read',
  'ALTER TABLE biz_sample ADD INDEX idx_biz_sample_storage_read (remark(32))');
CALL v4_add_index_if_missing('mes_single_branch', 'biz_tray', 'idx_biz_tray_storage_read',
  'ALTER TABLE biz_tray ADD INDEX idx_biz_tray_storage_read (remark(32), tray_no, task_id)');
CALL v4_add_index_if_missing('mes_single_branch', 'biz_schedule', 'idx_biz_schedule_storage_read',
  'ALTER TABLE biz_schedule ADD INDEX idx_biz_schedule_storage_read (schedule_type, schedule_start_time, schedule_no)');
CALL v4_add_index_if_missing('mes_single_branch', 'biz_data_stream', 'idx_biz_data_stream_storage_read',
  'ALTER TABLE biz_data_stream ADD INDEX idx_biz_data_stream_storage_read (remark(32), last_packet_time, stream_no)');
CALL v4_add_index_if_missing('mes_single_branch', 'md_lab', 'idx_md_lab_test_type',
  'ALTER TABLE md_lab ADD INDEX idx_md_lab_test_type (test_type_id)');
CALL v4_add_index_if_missing('mes_single_branch', 'sys_attendance_user', 'idx_sys_attendance_user_qr_token_hash',
  'ALTER TABLE sys_attendance_user ADD INDEX idx_sys_attendance_user_qr_token_hash (qr_token_hash)');

DROP PROCEDURE IF EXISTS v4_add_column_if_missing;
DROP PROCEDURE IF EXISTS v4_add_index_if_missing;
DROP PROCEDURE IF EXISTS v4_widen_varchar_if_shorter;
