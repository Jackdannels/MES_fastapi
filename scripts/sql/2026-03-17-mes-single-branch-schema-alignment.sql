USE mes_single_branch;

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

DROP PROCEDURE IF EXISTS add_column_if_missing;
DROP PROCEDURE IF EXISTS add_index_if_missing;
DROP PROCEDURE IF EXISTS add_unique_index_if_missing;

DELIMITER $$
CREATE PROCEDURE add_column_if_missing(
  IN p_schema_name VARCHAR(64),
  IN p_table_name VARCHAR(64),
  IN p_column_name VARCHAR(64),
  IN p_ddl TEXT
)
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = p_schema_name
      AND TABLE_NAME = p_table_name
      AND COLUMN_NAME = p_column_name
  ) THEN
    SET @ddl = p_ddl;
    PREPARE stmt FROM @ddl;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END $$

CREATE PROCEDURE add_index_if_missing(
  IN p_schema_name VARCHAR(64),
  IN p_table_name VARCHAR(64),
  IN p_index_name VARCHAR(64),
  IN p_ddl TEXT
)
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = p_schema_name
      AND TABLE_NAME = p_table_name
      AND INDEX_NAME = p_index_name
  ) THEN
    SET @ddl = p_ddl;
    PREPARE stmt FROM @ddl;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END $$

CREATE PROCEDURE add_unique_index_if_missing(
  IN p_schema_name VARCHAR(64),
  IN p_table_name VARCHAR(64),
  IN p_index_name VARCHAR(64),
  IN p_duplicate_check_sql TEXT,
  IN p_ddl TEXT
)
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = p_schema_name
      AND TABLE_NAME = p_table_name
      AND INDEX_NAME = p_index_name
  ) THEN
    SET @duplicate_count = 0;
    SET @duplicate_sql = p_duplicate_check_sql;
    PREPARE duplicate_stmt FROM @duplicate_sql;
    EXECUTE duplicate_stmt;
    DEALLOCATE PREPARE duplicate_stmt;

    IF @duplicate_count = 0 THEN
      SET @ddl = p_ddl;
      PREPARE stmt FROM @ddl;
      EXECUTE stmt;
      DEALLOCATE PREPARE stmt;
    END IF;
  END IF;
END $$
DELIMITER ;

CALL add_column_if_missing('mes_single_branch', 'sys_role', 'key_permissions',
  'ALTER TABLE sys_role ADD COLUMN key_permissions VARCHAR(300) NULL AFTER data_scope');

CALL add_column_if_missing('mes_single_branch', 'md_equipment', 'acquisition_enabled',
  'ALTER TABLE md_equipment ADD COLUMN acquisition_enabled VARCHAR(20) NOT NULL DEFAULT ''启用'' AFTER status');

CALL add_column_if_missing('mes_single_branch', 'biz_task', 'client_name',
  'ALTER TABLE biz_task ADD COLUMN client_name VARCHAR(100) NULL AFTER task_name');
CALL add_column_if_missing('mes_single_branch', 'biz_task', 'contact_name',
  'ALTER TABLE biz_task ADD COLUMN contact_name VARCHAR(50) NULL AFTER client_name');
CALL add_column_if_missing('mes_single_branch', 'biz_task', 'contact_phone',
  'ALTER TABLE biz_task ADD COLUMN contact_phone VARCHAR(30) NULL AFTER contact_name');
CALL add_column_if_missing('mes_single_branch', 'biz_task', 'arrival_time',
  'ALTER TABLE biz_task ADD COLUMN arrival_time DATETIME NULL AFTER task_status');
CALL add_column_if_missing('mes_single_branch', 'biz_task', 'due_time',
  'ALTER TABLE biz_task ADD COLUMN due_time DATETIME NULL AFTER arrival_time');
CALL add_column_if_missing('mes_single_branch', 'biz_task', 'required_device',
  'ALTER TABLE biz_task ADD COLUMN required_device VARCHAR(100) NULL AFTER actual_end_time');
CALL add_column_if_missing('mes_single_branch', 'biz_task', 'conditions_text',
  'ALTER TABLE biz_task ADD COLUMN conditions_text TEXT NULL AFTER required_device');
CALL add_column_if_missing('mes_single_branch', 'biz_task', 'attachment_path',
  'ALTER TABLE biz_task ADD COLUMN attachment_path VARCHAR(500) NULL AFTER conditions_text');

ALTER TABLE biz_task MODIFY COLUMN task_type VARCHAR(200) NOT NULL;
ALTER TABLE biz_task MODIFY COLUMN required_device VARCHAR(200) NULL;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CALL add_column_if_missing('mes_single_branch', 'md_test_type', 'test_category',
  'ALTER TABLE md_test_type ADD COLUMN test_category VARCHAR(50) NULL AFTER test_type_name');
CALL add_column_if_missing('mes_single_branch', 'md_test_type', 'default_duration_hour',
  'ALTER TABLE md_test_type ADD COLUMN default_duration_hour DECIMAL(10,2) NULL AFTER test_category');
CALL add_column_if_missing('mes_single_branch', 'md_test_type', 'status',
  'ALTER TABLE md_test_type ADD COLUMN status TINYINT NOT NULL DEFAULT 1 AFTER default_duration_hour');
CALL add_column_if_missing('mes_single_branch', 'md_test_type', 'remark',
  'ALTER TABLE md_test_type ADD COLUMN remark VARCHAR(300) NULL AFTER status');
CALL add_column_if_missing('mes_single_branch', 'md_lab', 'lab_type',
  'ALTER TABLE md_lab ADD COLUMN lab_type VARCHAR(30) NULL AFTER lab_name');
CALL add_column_if_missing('mes_single_branch', 'md_lab', 'test_type_id',
  'ALTER TABLE md_lab ADD COLUMN test_type_id BIGINT NULL AFTER lab_type');
CALL add_column_if_missing('mes_single_branch', 'md_lab', 'dept_id',
  'ALTER TABLE md_lab ADD COLUMN dept_id BIGINT NULL AFTER test_type_id');
CALL add_column_if_missing('mes_single_branch', 'md_lab', 'manager_user_id',
  'ALTER TABLE md_lab ADD COLUMN manager_user_id BIGINT NULL AFTER dept_id');
CALL add_column_if_missing('mes_single_branch', 'md_lab', 'capacity',
  'ALTER TABLE md_lab ADD COLUMN capacity INT NULL AFTER manager_user_id');
CALL add_column_if_missing('mes_single_branch', 'md_lab', 'location_desc',
  'ALTER TABLE md_lab ADD COLUMN location_desc VARCHAR(200) NULL AFTER capacity');
CALL add_column_if_missing('mes_single_branch', 'md_lab', 'status',
  'ALTER TABLE md_lab ADD COLUMN status TINYINT NOT NULL DEFAULT 1 AFTER location_desc');
CALL add_column_if_missing('mes_single_branch', 'md_lab', 'remark',
  'ALTER TABLE md_lab ADD COLUMN remark VARCHAR(300) NULL AFTER status');

CALL add_unique_index_if_missing('mes_single_branch', 'md_test_type', 'uk_md_test_type_code',
  'SELECT COUNT(*) INTO @duplicate_count FROM (SELECT test_type_code FROM md_test_type WHERE test_type_code IS NOT NULL AND test_type_code <> '''' GROUP BY test_type_code HAVING COUNT(*) > 1 LIMIT 1) duplicated_codes',
  'ALTER TABLE md_test_type ADD UNIQUE KEY uk_md_test_type_code (test_type_code)');
CALL add_unique_index_if_missing('mes_single_branch', 'md_lab', 'uk_md_lab_code',
  'SELECT COUNT(*) INTO @duplicate_count FROM (SELECT lab_code FROM md_lab WHERE lab_code IS NOT NULL AND lab_code <> '''' GROUP BY lab_code HAVING COUNT(*) > 1 LIMIT 1) duplicated_codes',
  'ALTER TABLE md_lab ADD UNIQUE KEY uk_md_lab_code (lab_code)');
CALL add_index_if_missing('mes_single_branch', 'md_lab', 'idx_md_lab_test_type',
  'ALTER TABLE md_lab ADD INDEX idx_md_lab_test_type (test_type_id)');

INSERT INTO md_test_type (
  test_type_code, test_type_name, test_category, default_duration_hour, status, remark
)
SELECT seed.test_type_code, seed.test_type_name, seed.test_category, seed.default_duration_hour, seed.status, seed.remark
FROM (
  SELECT 'CJ' AS test_type_code, '冲击试验' AS test_type_name, '力学试验' AS test_category, NULL AS default_duration_hour, 1 AS status, 'FRONTEND_MASTER_DATA' AS remark
  UNION ALL SELECT 'ZD', '振动试验', '力学试验', NULL, 1, 'FRONTEND_MASTER_DATA'
  UNION ALL SELECT 'SZH', '四综合试验', '综合试验', NULL, 1, 'FRONTEND_MASTER_DATA'
  UNION ALL SELECT 'WDC', '温度冲击试验', '环境试验', NULL, 1, 'FRONTEND_MASTER_DATA'
  UNION ALL SELECT 'GDW', '高低温湿热试验', '环境试验', NULL, 1, 'FRONTEND_MASTER_DATA'
  UNION ALL SELECT 'YW', '盐雾试验', '环境试验', NULL, 1, 'FRONTEND_MASTER_DATA'
  UNION ALL SELECT 'MJ', '霉菌试验', '环境试验', NULL, 1, 'FRONTEND_MASTER_DATA'
) seed
WHERE NOT EXISTS (
  SELECT 1 FROM md_test_type existing_type WHERE existing_type.test_type_code = seed.test_type_code
);

INSERT INTO md_lab (
  lab_code, lab_name, lab_type, test_type_id, capacity, location_desc, status, remark
)
SELECT 'LAB_IMPACT_1', '冲击一室', '实验室', test_type_id, 4, '', 1, 'FRONTEND_MASTER_DATA'
FROM md_test_type
WHERE test_type_code = 'CJ'
  AND NOT EXISTS (SELECT 1 FROM md_lab WHERE lab_code = 'LAB_IMPACT_1');

INSERT INTO md_lab (
  lab_code, lab_name, lab_type, test_type_id, capacity, location_desc, status, remark
)
SELECT 'LAB_IMPACT_2', '冲击二室', '实验室', test_type_id, 4, '', 1, 'FRONTEND_MASTER_DATA'
FROM md_test_type
WHERE test_type_code = 'CJ'
  AND NOT EXISTS (SELECT 1 FROM md_lab WHERE lab_code = 'LAB_IMPACT_2');

INSERT INTO md_lab (
  lab_code, lab_name, lab_type, test_type_id, capacity, location_desc, status, remark
)
SELECT 'LAB_VIBRATION_1', '振动一室', '实验室', test_type_id, 4, '', 1, 'FRONTEND_MASTER_DATA'
FROM md_test_type
WHERE test_type_code = 'ZD'
  AND NOT EXISTS (SELECT 1 FROM md_lab WHERE lab_code = 'LAB_VIBRATION_1');

INSERT INTO md_lab (
  lab_code, lab_name, lab_type, test_type_id, capacity, location_desc, status, remark
)
SELECT 'LAB_VIBRATION_2', '振动二室', '实验室', test_type_id, 4, '', 1, 'FRONTEND_MASTER_DATA'
FROM md_test_type
WHERE test_type_code = 'ZD'
  AND NOT EXISTS (SELECT 1 FROM md_lab WHERE lab_code = 'LAB_VIBRATION_2');

INSERT INTO md_lab (
  lab_code, lab_name, lab_type, test_type_id, capacity, location_desc, status, remark
)
SELECT 'LAB_COMPREHENSIVE', '四综合实验室', '实验室', test_type_id, 4, '', 1, 'FRONTEND_MASTER_DATA'
FROM md_test_type
WHERE test_type_code = 'SZH'
  AND NOT EXISTS (SELECT 1 FROM md_lab WHERE lab_code = 'LAB_COMPREHENSIVE');

INSERT INTO md_lab (
  lab_code, lab_name, lab_type, test_type_id, capacity, location_desc, status, remark
)
SELECT 'LAB_TEMP_SHOCK_1', '温度冲击一室', '实验室', test_type_id, 4, '', 1, 'FRONTEND_MASTER_DATA'
FROM md_test_type
WHERE test_type_code = 'WDC'
  AND NOT EXISTS (SELECT 1 FROM md_lab WHERE lab_code = 'LAB_TEMP_SHOCK_1');

INSERT INTO md_lab (
  lab_code, lab_name, lab_type, test_type_id, capacity, location_desc, status, remark
)
SELECT 'LAB_TEMP_SHOCK_2', '温度冲击二室', '实验室', test_type_id, 4, '', 1, 'FRONTEND_MASTER_DATA'
FROM md_test_type
WHERE test_type_code = 'WDC'
  AND NOT EXISTS (SELECT 1 FROM md_lab WHERE lab_code = 'LAB_TEMP_SHOCK_2');

INSERT INTO md_lab (
  lab_code, lab_name, lab_type, test_type_id, capacity, location_desc, status, remark
)
SELECT 'LAB_HOT_HUMID', '高低温湿热一室', '实验室', test_type_id, 4, '', 1, 'FRONTEND_MASTER_DATA'
FROM md_test_type
WHERE test_type_code = 'GDW'
  AND NOT EXISTS (SELECT 1 FROM md_lab WHERE lab_code = 'LAB_HOT_HUMID');

INSERT INTO md_lab (
  lab_code, lab_name, lab_type, test_type_id, capacity, location_desc, status, remark
)
SELECT 'LAB_HOT_HUMID_2', '高低温湿热二室', '实验室', test_type_id, 4, '', 1, 'FRONTEND_MASTER_DATA'
FROM md_test_type
WHERE test_type_code = 'GDW'
  AND NOT EXISTS (SELECT 1 FROM md_lab WHERE lab_code = 'LAB_HOT_HUMID_2');

INSERT INTO md_lab (
  lab_code, lab_name, lab_type, test_type_id, capacity, location_desc, status, remark
)
SELECT 'LAB_SALT', '盐雾试验室', '实验室', test_type_id, 4, '', 1, 'FRONTEND_MASTER_DATA'
FROM md_test_type
WHERE test_type_code = 'YW'
  AND NOT EXISTS (SELECT 1 FROM md_lab WHERE lab_code = 'LAB_SALT');

INSERT INTO md_lab (
  lab_code, lab_name, lab_type, test_type_id, capacity, location_desc, status, remark
)
SELECT 'LAB_MOLD', '霉菌试验室', '实验室', test_type_id, 4, '', 1, 'FRONTEND_MASTER_DATA'
FROM md_test_type
WHERE test_type_code = 'MJ'
  AND NOT EXISTS (SELECT 1 FROM md_lab WHERE lab_code = 'LAB_MOLD');

INSERT INTO md_lab (lab_code, lab_name, lab_type, test_type_id, capacity, location_desc, status, remark)
SELECT seed.lab_code, seed.lab_name, seed.lab_type, NULL, seed.capacity, seed.location_desc, seed.status, seed.remark
FROM (
  SELECT 'AREA_STAGING_PRE' AS lab_code, '恒温恒湿间（暂存间）' AS lab_name, '暂存间' AS lab_type, 0 AS capacity, '' AS location_desc, 1 AS status, 'FRONTEND_MASTER_DATA' AS remark
  UNION ALL SELECT 'AREA_STAGING_POST', '恒温恒湿间（实验后暂存间）', '暂存间', 0, '', 1, 'FRONTEND_MASTER_DATA'
  UNION ALL SELECT 'AREA_APPEARANCE', '外观检测间', '检测间', 0, '', 1, 'FRONTEND_MASTER_DATA'
  UNION ALL SELECT 'AREA_UNBOX', '拆箱操作间', '操作区', 0, '', 1, 'FRONTEND_MASTER_DATA'
  UNION ALL SELECT 'AREA_OUTDOOR_HANDOVER', '室外接驳区', '接驳区', 0, '', 1, 'FRONTEND_MASTER_DATA'
) seed
WHERE NOT EXISTS (
  SELECT 1 FROM md_lab existing_lab WHERE existing_lab.lab_code = seed.lab_code
);

CALL add_column_if_missing('mes_single_branch', 'biz_sample', 'batch_no',
  'ALTER TABLE biz_sample ADD COLUMN batch_no VARCHAR(100) NULL AFTER sample_name');
CALL add_column_if_missing('mes_single_branch', 'biz_sample', 'arrival_time',
  'ALTER TABLE biz_sample ADD COLUMN arrival_time DATETIME NULL AFTER received_time');
CALL add_column_if_missing('mes_single_branch', 'biz_sample', 'storage_condition',
  'ALTER TABLE biz_sample ADD COLUMN storage_condition VARCHAR(100) NULL AFTER arrival_time');
CALL add_column_if_missing('mes_single_branch', 'biz_sample', 'barcode_no',
  'ALTER TABLE biz_sample ADD COLUMN barcode_no VARCHAR(100) NULL AFTER storage_condition');
CALL add_column_if_missing('mes_single_branch', 'biz_sample', 'location_desc',
  'ALTER TABLE biz_sample ADD COLUMN location_desc VARCHAR(200) NULL AFTER barcode_no');
CALL add_column_if_missing('mes_single_branch', 'biz_sample', 'flow_status',
  'ALTER TABLE biz_sample ADD COLUMN flow_status VARCHAR(30) NULL AFTER location_desc');

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
  actual_start_time DATETIME NULL,
  actual_end_time DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (experiment_id),
  UNIQUE KEY uk_biz_experiment_no (experiment_no),
  KEY idx_biz_experiment_task_no (task_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CALL add_column_if_missing('mes_single_branch', 'biz_experiment', 'unscheduled_since',
  'ALTER TABLE biz_experiment ADD COLUMN unscheduled_since DATETIME NULL AFTER experiment_status');
CALL add_column_if_missing('mes_single_branch', 'biz_experiment', 'actual_start_time',
  'ALTER TABLE biz_experiment ADD COLUMN actual_start_time DATETIME NULL AFTER unscheduled_since');
CALL add_column_if_missing('mes_single_branch', 'biz_experiment', 'actual_end_time',
  'ALTER TABLE biz_experiment ADD COLUMN actual_end_time DATETIME NULL AFTER actual_start_time');

DROP PROCEDURE IF EXISTS add_column_if_missing;

CREATE TABLE IF NOT EXISTS sys_config (
  config_id BIGINT NOT NULL AUTO_INCREMENT,
  config_key VARCHAR(100) NOT NULL,
  config_value VARCHAR(500) NULL,
  config_group VARCHAR(50) NULL,
  config_name VARCHAR(100) NULL,
  remark VARCHAR(300) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (config_id),
  UNIQUE KEY uk_sys_config_key (config_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS md_equipment_connection (
  connection_id BIGINT NOT NULL AUTO_INCREMENT,
  equipment_id BIGINT NOT NULL,
  protocol VARCHAR(30) NULL,
  endpoint VARCHAR(100) NULL,
  port VARCHAR(20) NULL,
  station_id VARCHAR(20) NULL,
  function_code VARCHAR(50) NULL,
  parity VARCHAR(30) NULL,
  polling_interval VARCHAR(30) NULL,
  retry_policy VARCHAR(50) NULL,
  status VARCHAR(30) NULL,
  remark VARCHAR(300) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (connection_id),
  UNIQUE KEY uk_md_equipment_connection_equipment (equipment_id),
  CONSTRAINT fk_md_equipment_connection_equipment FOREIGN KEY (equipment_id) REFERENCES md_equipment(equipment_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS md_equipment_point (
  point_id BIGINT NOT NULL AUTO_INCREMENT,
  equipment_id BIGINT NOT NULL,
  point_name VARCHAR(100) NOT NULL,
  point_code VARCHAR(50) NULL,
  address VARCHAR(50) NOT NULL,
  data_type VARCHAR(30) NULL,
  frequency VARCHAR(30) NULL,
  ratio VARCHAR(30) NULL,
  unit VARCHAR(30) NULL,
  note VARCHAR(300) NULL,
  status TINYINT NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (point_id),
  UNIQUE KEY uk_md_equipment_point_unique (equipment_id, address, point_name),
  CONSTRAINT fk_md_equipment_point_equipment FOREIGN KEY (equipment_id) REFERENCES md_equipment(equipment_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS biz_schedule (
  schedule_id BIGINT NOT NULL AUTO_INCREMENT,
  schedule_no VARCHAR(50) NOT NULL,
  task_id BIGINT NULL,
  task_no VARCHAR(50) NOT NULL,
  sub_experiment_code VARCHAR(80) NULL,
  schedule_type VARCHAR(30) NULL,
  lab_id BIGINT NULL,
  equipment_id BIGINT NULL,
  temp_room_id BIGINT NULL,
  device_name VARCHAR(100) NOT NULL,
  schedule_start_time DATETIME NOT NULL,
  schedule_end_time DATETIME NOT NULL,
  planned_hours DECIMAL(10,2) NULL,
  schedule_status VARCHAR(30) NULL,
  is_retention TINYINT NOT NULL DEFAULT 0,
  created_by BIGINT NULL,
  remark VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (schedule_id),
  UNIQUE KEY uk_biz_schedule_no (schedule_no),
  KEY idx_biz_schedule_task_id (task_id),
  KEY idx_biz_schedule_task_no (task_no),
  KEY idx_biz_schedule_device_time (device_name, schedule_start_time, schedule_end_time),
  CONSTRAINT fk_biz_schedule_task FOREIGN KEY (task_id) REFERENCES biz_task(task_id),
  CONSTRAINT fk_biz_schedule_lab FOREIGN KEY (lab_id) REFERENCES md_lab(lab_id),
  CONSTRAINT fk_biz_schedule_equipment FOREIGN KEY (equipment_id) REFERENCES md_equipment(equipment_id),
  CONSTRAINT fk_biz_schedule_temp_room FOREIGN KEY (temp_room_id) REFERENCES wh_temp_room(temp_room_id),
  CONSTRAINT fk_biz_schedule_created_by FOREIGN KEY (created_by) REFERENCES sys_user(user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS biz_data_stream (
  stream_id BIGINT NOT NULL AUTO_INCREMENT,
  stream_no VARCHAR(50) NOT NULL,
  task_id BIGINT NULL,
  task_no VARCHAR(50) NOT NULL,
  equipment_id BIGINT NULL,
  equipment_code VARCHAR(50) NULL,
  device_name VARCHAR(100) NULL,
  last_packet_time DATETIME NULL,
  quality_value DECIMAL(6,2) NULL,
  stream_status VARCHAR(30) NULL,
  reported_flag TINYINT NOT NULL DEFAULT 0,
  remark VARCHAR(300) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (stream_id),
  UNIQUE KEY uk_biz_data_stream_no (stream_no),
  KEY idx_biz_data_stream_task_id (task_id),
  KEY idx_biz_data_stream_task_no (task_no),
  CONSTRAINT fk_biz_data_stream_task FOREIGN KEY (task_id) REFERENCES biz_task(task_id),
  CONSTRAINT fk_biz_data_stream_equipment FOREIGN KEY (equipment_id) REFERENCES md_equipment(equipment_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS biz_sample_event (
  event_id BIGINT NOT NULL AUTO_INCREMENT,
  sample_id BIGINT NOT NULL,
  sample_no VARCHAR(50) NOT NULL,
  task_id BIGINT NULL,
  task_no VARCHAR(50) NULL,
  action_type VARCHAR(50) NOT NULL,
  location_desc VARCHAR(200) NULL,
  owner_name VARCHAR(100) NULL,
  sample_status VARCHAR(30) NULL,
  detail VARCHAR(500) NULL,
  event_time DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (event_id),
  KEY idx_biz_sample_event_sample_time (sample_id, event_time),
  KEY idx_biz_sample_event_task_id (task_id),
  CONSTRAINT fk_biz_sample_event_sample FOREIGN KEY (sample_id) REFERENCES biz_sample(sample_id),
  CONSTRAINT fk_biz_sample_event_task FOREIGN KEY (task_id) REFERENCES biz_task(task_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

UPDATE md_equipment
SET acquisition_enabled = '启用'
WHERE acquisition_enabled IS NULL OR acquisition_enabled = '';

UPDATE sys_role
SET key_permissions = CASE role_code
  WHEN 'ADMIN' THEN '全部权限'
  WHEN 'LAB_MANAGER' THEN '审批、数据锁定、排程协调'
  WHEN 'OPERATOR' THEN '创建、改排、执行登记'
  WHEN 'VIEWER' THEN '只读查看'
  ELSE '基础权限'
END
WHERE key_permissions IS NULL OR key_permissions = '';

UPDATE biz_task t
LEFT JOIN lab_task_issue i ON i.issue_id = t.issue_id
SET t.client_name = COALESCE(NULLIF(t.client_name, ''), i.apply_dept_name),
    t.contact_name = COALESCE(NULLIF(t.contact_name, ''), i.apply_user_name),
    t.contact_phone = COALESCE(NULLIF(t.contact_phone, ''), ''),
    t.arrival_time = COALESCE(t.arrival_time, t.created_at),
    t.due_time = COALESCE(t.due_time, t.plan_end_time),
    t.required_device = COALESCE(NULLIF(t.required_device, ''), t.task_type),
    t.conditions_text = COALESCE(NULLIF(t.conditions_text, ''), ''),
    t.attachment_path = COALESCE(NULLIF(t.attachment_path, ''), '')
WHERE t.task_id IS NOT NULL;

UPDATE biz_sample s
LEFT JOIN biz_task t ON t.task_id = s.task_id
LEFT JOIN biz_tray tr ON tr.tray_id = s.tray_id
LEFT JOIN md_equipment e ON e.equipment_id = tr.current_equipment_id
LEFT JOIN md_lab l ON l.lab_id = tr.current_lab_id
LEFT JOIN wh_temp_room r ON r.temp_room_id = tr.current_temp_room_id
SET s.batch_no = COALESCE(NULLIF(s.batch_no, ''), CONCAT(COALESCE(t.task_no, 'TASK'), '-B1')),
    s.arrival_time = COALESCE(s.arrival_time, s.received_time),
    s.storage_condition = COALESCE(NULLIF(s.storage_condition, ''), '常温'),
    s.barcode_no = COALESCE(NULLIF(s.barcode_no, ''), CONCAT('BC-', s.sample_no)),
    s.location_desc = COALESCE(
      NULLIF(s.location_desc, ''),
      e.equipment_name,
      l.lab_name,
      r.temp_room_name,
      ''
    ),
    s.flow_status = COALESCE(NULLIF(s.flow_status, ''), s.sample_status)
WHERE s.sample_id IS NOT NULL;

INSERT INTO sys_config (config_key, config_value, config_group, config_name, remark, created_at, updated_at)
VALUES
  ('notification.channel', '站内通知', 'system', '通知渠道', 'System notification channel', NOW(), NOW()),
  ('retention.period', '36 个月', 'system', '留样期限', 'Retention period', NOW(), NOW()),
  ('shift.config', '白班 08:00-16:00', 'system', '班次配置', 'Shift config', NOW(), NOW())
ON DUPLICATE KEY UPDATE
  config_value = VALUES(config_value),
  config_group = VALUES(config_group),
  config_name = VALUES(config_name),
  remark = VALUES(remark),
  updated_at = VALUES(updated_at);

INSERT INTO md_equipment_connection (
  equipment_id, protocol, endpoint, port, station_id, function_code,
  parity, polling_interval, retry_policy, status, remark, created_at, updated_at
)
SELECT
  e.equipment_id,
  seed.protocol,
  seed.endpoint,
  seed.port,
  seed.station_id,
  seed.function_code,
  seed.parity,
  seed.polling_interval,
  seed.retry_policy,
  seed.status,
  seed.remark,
  NOW(),
  NOW()
FROM md_equipment e
JOIN (
  SELECT 'EQ-IM-001' AS equipment_code, 'Modbus TCP' AS protocol, '192.168.10.21' AS endpoint, '502' AS port,
         '1' AS station_id, '03' AS function_code, 'None' AS parity, '5s' AS polling_interval,
         '3 times' AS retry_policy, 'ACTIVE' AS status, 'Impact rig default connection' AS remark
  UNION ALL
  SELECT 'EQ-VB-001', 'Modbus TCP', '192.168.10.22', '502', '2', '03', 'None', '5s', '3 times', 'ACTIVE',
         'Vibration bench default connection'
  UNION ALL
  SELECT 'EQ-SS-001', 'Modbus TCP', '192.168.10.23', '502', '3', '03', 'None', '10s', '3 times', 'ACTIVE',
         'Salt chamber default connection'
) seed ON seed.equipment_code = e.equipment_code
WHERE NOT EXISTS (
  SELECT 1
  FROM md_equipment_connection c
  WHERE c.equipment_id = e.equipment_id
);

INSERT INTO md_equipment_point (
  equipment_id, point_name, point_code, address, data_type, frequency,
  ratio, unit, note, status, created_at, updated_at
)
SELECT
  e.equipment_id,
  seed.point_name,
  seed.point_code,
  seed.address,
  seed.data_type,
  seed.frequency,
  seed.ratio,
  seed.unit,
  seed.note,
  1,
  NOW(),
  NOW()
FROM md_equipment e
JOIN (
  SELECT 'EQ-IM-001' AS equipment_code, '冲击峰值' AS point_name, 'IMPACT_PEAK' AS point_code, '40001' AS address,
         'FLOAT' AS data_type, '1s' AS frequency, '1' AS ratio, 'g' AS unit, 'Impact peak value' AS note
  UNION ALL
  SELECT 'EQ-IM-001', '脉宽', 'IMPACT_WIDTH', '40002', 'FLOAT', '1s', '1', 'ms', 'Impact pulse width'
  UNION ALL
  SELECT 'EQ-VB-001', '振动频率', 'VB_FREQ', '40011', 'FLOAT', '2s', '1', 'Hz', 'Vibration frequency'
  UNION ALL
  SELECT 'EQ-VB-001', '振动幅值', 'VB_AMPL', '40012', 'FLOAT', '2s', '1', 'mm', 'Vibration amplitude'
  UNION ALL
  SELECT 'EQ-SS-001', '箱内温度', 'SS_TEMP', '40021', 'FLOAT', '5s', '1', 'C', 'Salt chamber temperature'
  UNION ALL
  SELECT 'EQ-SS-001', '盐雾浓度', 'SS_DENSITY', '40022', 'FLOAT', '10s', '1', '%', 'Salt spray density'
) seed ON seed.equipment_code = e.equipment_code
LEFT JOIN md_equipment_point p
  ON p.equipment_id = e.equipment_id
 AND p.address = seed.address
 AND p.point_name = seed.point_name
WHERE p.point_id IS NULL;

INSERT INTO biz_schedule (
  schedule_no, task_id, task_no, schedule_type, lab_id, equipment_id, temp_room_id,
  device_name, schedule_start_time, schedule_end_time, planned_hours, schedule_status,
  is_retention, created_by, remark, created_at, updated_at
)
SELECT
  seed.schedule_no,
  t.task_id,
  t.task_no,
  seed.schedule_type,
  l.lab_id,
  e.equipment_id,
  r.temp_room_id,
  seed.device_name,
  seed.schedule_start_time,
  seed.schedule_end_time,
  seed.planned_hours,
  seed.schedule_status,
  seed.is_retention,
  u.user_id,
  seed.remark,
  NOW(),
  NOW()
FROM (
  SELECT 'SCH-20260317-001' AS schedule_no, 'CJ-2024-001' AS task_no, '试验排程' AS schedule_type,
         'LAB_IMPACT_1' AS lab_code, 'EQ-IM-001' AS equipment_code, NULL AS temp_room_code,
         'Impact Rig 1' AS device_name, '2026-03-17 09:00:00' AS schedule_start_time,
         '2026-03-17 17:00:00' AS schedule_end_time, 8.00 AS planned_hours, '已排程' AS schedule_status,
         0 AS is_retention, 'admin' AS created_by_username, 'Impact task planned schedule' AS remark
  UNION ALL
  SELECT 'SCH-20260317-002', 'YW-2024-002', '试验排程', 'LAB_SALT', 'EQ-SS-001', NULL,
         'Salt Chamber 1', '2026-03-17 10:00:00', '2026-03-18 10:00:00', 24.00, '已排程',
         0, 'lab_mgr', 'Salt spray task planned schedule'
  UNION ALL
  SELECT 'SCH-20260317-003', 'CJ-2024-001', '留样排程', NULL, NULL, 'TEMP_001',
         'Unified Temp Room', '2026-03-17 18:00:00', '2026-04-17 18:00:00', 744.00, '留样中',
         1, 'keeper_a', 'Retention storage schedule'
) seed
JOIN biz_task t ON t.task_no = seed.task_no
LEFT JOIN md_lab l ON l.lab_code = seed.lab_code
LEFT JOIN md_equipment e ON e.equipment_code = seed.equipment_code
LEFT JOIN wh_temp_room r ON r.temp_room_code = seed.temp_room_code
LEFT JOIN sys_user u ON u.username = seed.created_by_username
WHERE NOT EXISTS (
  SELECT 1
  FROM biz_schedule s
  WHERE s.schedule_no = seed.schedule_no
);

INSERT INTO biz_data_stream (
  stream_no, task_id, task_no, equipment_id, equipment_code, device_name,
  last_packet_time, quality_value, stream_status, reported_flag, remark, created_at, updated_at
)
SELECT
  seed.stream_no,
  t.task_id,
  t.task_no,
  e.equipment_id,
  e.equipment_code,
  seed.device_name,
  seed.last_packet_time,
  seed.quality_value,
  seed.stream_status,
  seed.reported_flag,
  seed.remark,
  NOW(),
  NOW()
FROM (
  SELECT 'STREAM-20260317-001' AS stream_no, 'CJ-2024-001' AS task_no, 'EQ-IM-001' AS equipment_code,
         'Impact Rig 1' AS device_name, '2026-03-17 09:15:00' AS last_packet_time, 98.60 AS quality_value,
         'RUNNING' AS stream_status, 0 AS reported_flag, 'Impact data stream' AS remark
  UNION ALL
  SELECT 'STREAM-20260317-002', 'YW-2024-002', 'EQ-SS-001', 'Salt Chamber 1',
         '2026-03-17 10:15:00', 96.20, 'RUNNING', 1, 'Salt spray data stream'
) seed
JOIN biz_task t ON t.task_no = seed.task_no
JOIN md_equipment e ON e.equipment_code = seed.equipment_code
WHERE NOT EXISTS (
  SELECT 1
  FROM biz_data_stream s
  WHERE s.stream_no = seed.stream_no
);

INSERT INTO biz_sample_event (
  sample_id, sample_no, task_id, task_no, action_type, location_desc,
  owner_name, sample_status, detail, event_time, created_at
)
SELECT
  s.sample_id,
  s.sample_no,
  t.task_id,
  t.task_no,
  'RECEIVED',
  COALESCE(NULLIF(s.location_desc, ''), '收样台'),
  COALESCE(u.real_name, 'System'),
  s.sample_status,
  'Sample intake registration',
  COALESCE(s.arrival_time, s.received_time, s.created_at),
  NOW()
FROM biz_sample s
LEFT JOIN biz_task t ON t.task_id = s.task_id
LEFT JOIN sys_user u ON u.user_id = s.current_owner_id
WHERE NOT EXISTS (
  SELECT 1
  FROM biz_sample_event e
  WHERE e.sample_id = s.sample_id
    AND e.action_type = 'RECEIVED'
);

INSERT INTO biz_sample_event (
  sample_id, sample_no, task_id, task_no, action_type, location_desc,
  owner_name, sample_status, detail, event_time, created_at
)
SELECT
  s.sample_id,
  s.sample_no,
  t.task_id,
  t.task_no,
  'LOADED',
  COALESCE(NULLIF(s.location_desc, ''), tr.tray_no),
  COALESCE(u.real_name, 'System'),
  s.sample_status,
  CONCAT('Loaded to tray ', tr.tray_no),
  COALESCE(s.updated_at, s.created_at),
  NOW()
FROM biz_sample s
JOIN biz_tray tr ON tr.tray_id = s.tray_id
LEFT JOIN biz_task t ON t.task_id = s.task_id
LEFT JOIN sys_user u ON u.user_id = s.current_owner_id
WHERE s.tray_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM biz_sample_event e
    WHERE e.sample_id = s.sample_id
      AND e.action_type = 'LOADED'
  );

INSERT INTO biz_sample_event (
  sample_id, sample_no, task_id, task_no, action_type, location_desc,
  owner_name, sample_status, detail, event_time, created_at
)
SELECT
  s.sample_id,
  s.sample_no,
  t.task_id,
  t.task_no,
  'IN_TEST',
  COALESCE(eq.equipment_name, NULLIF(s.location_desc, ''), '实验室'),
  COALESCE(u.real_name, 'System'),
  s.sample_status,
  'Sample entered test stage',
  COALESCE(s.updated_at, s.created_at),
  NOW()
FROM biz_sample s
LEFT JOIN biz_task t ON t.task_id = s.task_id
LEFT JOIN biz_tray tr ON tr.tray_id = s.tray_id
LEFT JOIN md_equipment eq ON eq.equipment_id = tr.current_equipment_id
LEFT JOIN sys_user u ON u.user_id = s.current_owner_id
WHERE s.sample_status = 'IN_TEST'
  AND NOT EXISTS (
    SELECT 1
    FROM biz_sample_event e
    WHERE e.sample_id = s.sample_id
      AND e.action_type = 'IN_TEST'
  );

SET FOREIGN_KEY_CHECKS = 1;
