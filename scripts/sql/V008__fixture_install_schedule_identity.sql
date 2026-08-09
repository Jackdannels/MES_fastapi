-- Persist the exact schedule identity for asynchronous fixture-install callbacks.
-- Existing pending rows cannot be mapped safely to a schedule, so they are
-- intentionally discarded instead of using a legacy inference fallback.

USE `mes_single_branch`;

DELETE FROM biz_fixture_install_pending;

DROP PROCEDURE IF EXISTS v8_add_column_if_missing;
DROP PROCEDURE IF EXISTS v8_add_index_if_missing;

DELIMITER $$

CREATE PROCEDURE v8_add_column_if_missing(
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
    SET @v8_ddl = ddl_text;
    PREPARE v8_stmt FROM @v8_ddl;
    EXECUTE v8_stmt;
    DEALLOCATE PREPARE v8_stmt;
  END IF;
END$$

CREATE PROCEDURE v8_add_index_if_missing(
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
    SET @v8_ddl = ddl_text;
    PREPARE v8_stmt FROM @v8_ddl;
    EXECUTE v8_stmt;
    DEALLOCATE PREPARE v8_stmt;
  END IF;
END$$

DELIMITER ;

CALL v8_add_column_if_missing(
  'mes_single_branch',
  'biz_fixture_install_pending',
  'schedule_no',
  'ALTER TABLE biz_fixture_install_pending ADD COLUMN schedule_no VARCHAR(80) NOT NULL AFTER experiment_no'
);
CALL v8_add_column_if_missing(
  'mes_single_branch',
  'biz_fixture_install_pending',
  'sub_experiment_code',
  'ALTER TABLE biz_fixture_install_pending ADD COLUMN sub_experiment_code VARCHAR(80) NULL AFTER schedule_no'
);
CALL v8_add_index_if_missing(
  'mes_single_branch',
  'biz_fixture_install_pending',
  'idx_biz_fixture_install_pending_task_tray_status',
  'ALTER TABLE biz_fixture_install_pending ADD INDEX idx_biz_fixture_install_pending_task_tray_status (task_no, tray_no, status)'
);

DROP PROCEDURE IF EXISTS v8_add_column_if_missing;
DROP PROCEDURE IF EXISTS v8_add_index_if_missing;
