-- Add bounded, query-aligned indexes for MQTT command lookup and retained
-- experiment-event history. The helper keeps the migration safe to rerun
-- manually against databases that may already contain one or more indexes.

USE `mes_single_branch`;

DROP PROCEDURE IF EXISTS v6_add_index_if_missing;

DELIMITER $$

CREATE PROCEDURE v6_add_index_if_missing(
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
    SET @v6_ddl = ddl_text;
    PREPARE v6_stmt FROM @v6_ddl;
    EXECUTE v6_stmt;
    DEALLOCATE PREPARE v6_stmt;
  END IF;
END$$

DELIMITER ;

CALL v6_add_index_if_missing('mes_single_branch', 'biz_mq_message_log', 'idx_biz_mq_latest_command',
  'ALTER TABLE biz_mq_message_log ADD INDEX idx_biz_mq_latest_command (direction, lab_code, message_type, created_at, message_log_id)');
CALL v6_add_index_if_missing('mes_single_branch', 'biz_mq_message_log', 'idx_biz_mq_status_created',
  'ALTER TABLE biz_mq_message_log ADD INDEX idx_biz_mq_status_created (process_status, created_at, message_log_id)');
CALL v6_add_index_if_missing('mes_single_branch', 'biz_mq_message_log', 'idx_biz_mq_task_exp_created',
  'ALTER TABLE biz_mq_message_log ADD INDEX idx_biz_mq_task_exp_created (task_no, experiment_no, created_at, message_log_id)');
CALL v6_add_index_if_missing('mes_single_branch', 'biz_experiment_event', 'idx_biz_experiment_event_task_exp_time',
  'ALTER TABLE biz_experiment_event ADD INDEX idx_biz_experiment_event_task_exp_time (task_no, experiment_no, event_time, experiment_event_id)');
CALL v6_add_index_if_missing('mes_single_branch', 'biz_experiment_event', 'idx_biz_experiment_event_lab_type_time',
  'ALTER TABLE biz_experiment_event ADD INDEX idx_biz_experiment_event_lab_type_time (lab_code, event_type, event_time, experiment_event_id)');

DROP PROCEDURE IF EXISTS v6_add_index_if_missing;
