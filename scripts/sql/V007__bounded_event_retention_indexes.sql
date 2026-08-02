-- Supporting indexes for application-level, small-batch event retention.
-- The helper keeps this migration idempotent for databases that received an
-- equivalent index during an earlier manual capacity intervention.

USE `mes_single_branch`;

DROP PROCEDURE IF EXISTS v7_add_index_if_missing;
DELIMITER $$
CREATE PROCEDURE v7_add_index_if_missing(
  IN p_schema VARCHAR(64),
  IN p_table VARCHAR(64),
  IN p_index VARCHAR(64),
  IN p_ddl TEXT
)
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.statistics
    WHERE table_schema = p_schema
      AND table_name = p_table
      AND index_name = p_index
  ) THEN
    SET @v7_ddl = p_ddl;
    PREPARE v7_statement FROM @v7_ddl;
    EXECUTE v7_statement;
    DEALLOCATE PREPARE v7_statement;
  END IF;
END$$
DELIMITER ;

CALL v7_add_index_if_missing(
  'mes_single_branch',
  'biz_mq_message_log',
  'idx_biz_mq_retention_created',
  'ALTER TABLE biz_mq_message_log ADD INDEX idx_biz_mq_retention_created (created_at, message_log_id)'
);
CALL v7_add_index_if_missing(
  'mes_single_branch',
  'biz_mq_message_log',
  'idx_biz_mq_retention_state',
  'ALTER TABLE biz_mq_message_log ADD INDEX idx_biz_mq_retention_state (direction, lab_code, task_no, experiment_no, sub_experiment_code, message_type, created_at, message_log_id)'
);
CALL v7_add_index_if_missing(
  'mes_single_branch',
  'biz_experiment_event',
  'idx_biz_experiment_event_retention_created',
  'ALTER TABLE biz_experiment_event ADD INDEX idx_biz_experiment_event_retention_created (created_at, experiment_event_id)'
);
CALL v7_add_index_if_missing(
  'mes_single_branch',
  'biz_experiment_event',
  'idx_biz_experiment_event_retention_state',
  'ALTER TABLE biz_experiment_event ADD INDEX idx_biz_experiment_event_retention_state (task_no, experiment_no, sub_experiment_code, lab_code, event_type, created_at, experiment_event_id)'
);

DROP PROCEDURE IF EXISTS v7_add_index_if_missing;
