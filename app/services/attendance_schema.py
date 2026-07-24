"""MySQL schema owned by the attendance repository."""

ATTENDANCE_SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS sys_attendance_user (
  user_id BIGINT NOT NULL AUTO_INCREMENT,
  username VARCHAR(80) NOT NULL,
  employee_name VARCHAR(100) NOT NULL,
  role_name VARCHAR(80) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  qr_token_hash VARCHAR(64) NULL,
  qr_token_payload VARCHAR(255) NULL,
  qr_token_created_at DATETIME NULL,
  active TINYINT NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id),
  UNIQUE KEY uk_sys_attendance_user_username (username),
  KEY idx_sys_attendance_user_qr_token_hash (qr_token_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS biz_lab_attendance_session (
  session_id BIGINT NOT NULL AUTO_INCREMENT,
  username VARCHAR(80) NOT NULL,
  employee_name VARCHAR(100) NOT NULL,
  lab_name VARCHAR(100) NOT NULL,
  lab_code VARCHAR(50) NULL,
  active TINYINT NOT NULL DEFAULT 1,
  logged_in_at DATETIME NOT NULL,
  last_seen_at DATETIME NULL,
  logged_out_at DATETIME NULL,
  reason VARCHAR(80) NULL,
  work_started_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (session_id),
  KEY idx_biz_lab_attendance_active_lab (active, lab_name),
  KEY idx_biz_lab_attendance_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS biz_lab_work_interval (
  interval_id BIGINT NOT NULL AUTO_INCREMENT,
  session_id BIGINT NULL,
  username VARCHAR(80) NOT NULL,
  employee_name VARCHAR(100) NOT NULL,
  lab_name VARCHAR(100) NOT NULL,
  lab_code VARCHAR(50) NULL,
  run_no VARCHAR(80) NULL,
  task_no VARCHAR(50) NULL,
  experiment_no VARCHAR(50) NULL,
  source VARCHAR(20) NULL,
  started_at DATETIME NOT NULL,
  ended_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (interval_id),
  KEY idx_biz_lab_work_username_time (username, started_at),
  KEY idx_biz_lab_work_run_no (run_no),
  KEY idx_biz_lab_work_lab_open (lab_name, ended_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS biz_lab_operation_log (
  operation_log_id BIGINT NOT NULL AUTO_INCREMENT,
  session_id BIGINT NULL,
  username VARCHAR(80) NOT NULL,
  employee_name VARCHAR(100) NOT NULL,
  lab_name VARCHAR(100) NOT NULL,
  lab_code VARCHAR(50) NULL,
  action_name VARCHAR(100) NOT NULL,
  task_no VARCHAR(80) NULL,
  experiment_no VARCHAR(80) NULL,
  tray_no VARCHAR(100) NULL,
  run_no VARCHAR(80) NULL,
  source VARCHAR(20) NULL,
  operated_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (operation_log_id),
  KEY idx_biz_lab_operation_time (operated_at),
  KEY idx_biz_lab_operation_employee_time (username, operated_at),
  KEY idx_biz_lab_operation_lab_time (lab_name, operated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
"""
