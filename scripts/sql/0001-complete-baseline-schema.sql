-- Complete empty-database baseline for the MES single-branch application.
-- Schema only: no production data, demo data, users, or current AUTO_INCREMENT values.
-- Generated from the verified application schema; keep seed data in a separate migration.

CREATE DATABASE IF NOT EXISTS `mes_single_branch`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE `mes_single_branch`;

-- app_storage_snapshot
CREATE TABLE IF NOT EXISTS `app_storage_snapshot` (
  `storage_key` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `payload_json` longtext COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`storage_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- sys_role
CREATE TABLE IF NOT EXISTS `sys_role` (
  `role_id` bigint NOT NULL AUTO_INCREMENT,
  `role_code` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `role_name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `role_type` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `data_scope` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `key_permissions` varchar(300) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` tinyint NOT NULL DEFAULT '1',
  `remark` varchar(300) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`role_id`),
  UNIQUE KEY `uk_sys_role_code` (`role_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- sys_config
CREATE TABLE IF NOT EXISTS `sys_config` (
  `config_id` bigint NOT NULL AUTO_INCREMENT,
  `config_key` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `config_value` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `config_group` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `config_name` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `remark` varchar(300) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`config_id`),
  UNIQUE KEY `uk_sys_config_key` (`config_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- sys_dept
CREATE TABLE IF NOT EXISTS `sys_dept` (
  `dept_id` bigint NOT NULL AUTO_INCREMENT,
  `dept_code` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `dept_name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `parent_id` bigint DEFAULT NULL,
  `dept_type` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `manager_user_id` bigint DEFAULT NULL,
  `status` tinyint NOT NULL DEFAULT '1',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`dept_id`),
  UNIQUE KEY `uk_sys_dept_code` (`dept_code`),
  KEY `idx_sys_dept_parent_id` (`parent_id`),
  KEY `fk_sys_dept_manager` (`manager_user_id`),
  CONSTRAINT `fk_sys_dept_parent` FOREIGN KEY (`parent_id`) REFERENCES `sys_dept` (`dept_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- sys_user
CREATE TABLE IF NOT EXISTS `sys_user` (
  `user_id` bigint NOT NULL AUTO_INCREMENT,
  `username` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `password_hash` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL,
  `real_name` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `dept_id` bigint DEFAULT NULL,
  `phone` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `email` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` tinyint NOT NULL DEFAULT '1',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`),
  UNIQUE KEY `uk_sys_user_username` (`username`),
  KEY `idx_sys_user_dept_id` (`dept_id`),
  CONSTRAINT `fk_sys_user_dept` FOREIGN KEY (`dept_id`) REFERENCES `sys_dept` (`dept_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Complete the deferred sys_dept <-> sys_user circular foreign key.
SET @sys_dept_manager_fk_exists = (
  SELECT COUNT(*)
  FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'sys_dept'
    AND CONSTRAINT_NAME = 'fk_sys_dept_manager'
    AND CONSTRAINT_TYPE = 'FOREIGN KEY'
);
SET @sys_dept_manager_fk_ddl = IF(
  @sys_dept_manager_fk_exists = 0,
  'ALTER TABLE `sys_dept` ADD CONSTRAINT `fk_sys_dept_manager` FOREIGN KEY (`manager_user_id`) REFERENCES `sys_user` (`user_id`)',
  'SELECT 1'
);
PREPARE sys_dept_manager_fk_stmt FROM @sys_dept_manager_fk_ddl;
EXECUTE sys_dept_manager_fk_stmt;
DEALLOCATE PREPARE sys_dept_manager_fk_stmt;

-- sys_attendance_user
CREATE TABLE IF NOT EXISTS `sys_attendance_user` (
  `user_id` bigint NOT NULL AUTO_INCREMENT,
  `username` varchar(80) COLLATE utf8mb4_unicode_ci NOT NULL,
  `employee_name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `role_name` varchar(80) COLLATE utf8mb4_unicode_ci NOT NULL,
  `password_hash` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `qr_token_hash` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `qr_token_payload` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `qr_token_created_at` datetime DEFAULT NULL,
  `active` tinyint NOT NULL DEFAULT '1',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`),
  UNIQUE KEY `uk_sys_attendance_user_username` (`username`),
  KEY `idx_sys_attendance_user_qr_token_hash` (`qr_token_hash`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- md_test_type
CREATE TABLE IF NOT EXISTS `md_test_type` (
  `test_type_id` bigint NOT NULL AUTO_INCREMENT,
  `test_type_code` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `test_type_name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `test_category` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `default_duration_hour` decimal(10,2) DEFAULT NULL,
  `status` tinyint NOT NULL DEFAULT '1',
  `remark` varchar(300) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`test_type_id`),
  UNIQUE KEY `uk_md_test_type_code` (`test_type_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- lab_task_issue
CREATE TABLE IF NOT EXISTS `lab_task_issue` (
  `issue_id` bigint NOT NULL AUTO_INCREMENT,
  `task_no` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `source_system` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `external_task_id` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `task_name` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL,
  `task_type` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `sample_type` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `priority` tinyint DEFAULT NULL,
  `sample_count` int DEFAULT NULL,
  `task_status` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `apply_dept_name` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `apply_user_name` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `remark` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`issue_id`),
  UNIQUE KEY `uk_lab_task_issue_task_no` (`task_no`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- wh_temp_room
CREATE TABLE IF NOT EXISTS `wh_temp_room` (
  `temp_room_id` bigint NOT NULL AUTO_INCREMENT,
  `temp_room_code` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `temp_room_name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `dept_id` bigint DEFAULT NULL,
  `capacity_tray_qty` int DEFAULT NULL,
  `used_tray_qty` int DEFAULT NULL,
  `keeper_user_id` bigint DEFAULT NULL,
  `location_desc` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` tinyint NOT NULL DEFAULT '1',
  `remark` varchar(300) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`temp_room_id`),
  UNIQUE KEY `uk_wh_temp_room_code` (`temp_room_code`),
  KEY `fk_wh_temp_room_dept` (`dept_id`),
  KEY `fk_wh_temp_room_keeper` (`keeper_user_id`),
  CONSTRAINT `fk_wh_temp_room_dept` FOREIGN KEY (`dept_id`) REFERENCES `sys_dept` (`dept_id`),
  CONSTRAINT `fk_wh_temp_room_keeper` FOREIGN KEY (`keeper_user_id`) REFERENCES `sys_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- md_lab
CREATE TABLE IF NOT EXISTS `md_lab` (
  `lab_id` bigint NOT NULL AUTO_INCREMENT,
  `lab_code` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `lab_name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `lab_type` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `test_type_id` bigint DEFAULT NULL,
  `dept_id` bigint DEFAULT NULL,
  `manager_user_id` bigint DEFAULT NULL,
  `capacity` int DEFAULT NULL,
  `location_desc` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` tinyint NOT NULL DEFAULT '1',
  `remark` varchar(300) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`lab_id`),
  UNIQUE KEY `uk_md_lab_code` (`lab_code`),
  KEY `fk_md_lab_dept` (`dept_id`),
  KEY `fk_md_lab_manager` (`manager_user_id`),
  KEY `idx_md_lab_test_type` (`test_type_id`),
  CONSTRAINT `fk_md_lab_dept` FOREIGN KEY (`dept_id`) REFERENCES `sys_dept` (`dept_id`),
  CONSTRAINT `fk_md_lab_manager` FOREIGN KEY (`manager_user_id`) REFERENCES `sys_user` (`user_id`),
  CONSTRAINT `fk_md_lab_test_type` FOREIGN KEY (`test_type_id`) REFERENCES `md_test_type` (`test_type_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- md_equipment
CREATE TABLE IF NOT EXISTS `md_equipment` (
  `equipment_id` bigint NOT NULL AUTO_INCREMENT,
  `equipment_code` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `equipment_name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `equipment_type` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `test_type_id` bigint DEFAULT NULL,
  `lab_id` bigint DEFAULT NULL,
  `model_no` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `manufacturer` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `maintenance_start_at` datetime DEFAULT NULL,
  `maintenance_end_at` datetime DEFAULT NULL,
  `maintenance_type` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `maintenance_note` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `acquisition_enabled` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '启用',
  `next_calibration_date` date DEFAULT NULL,
  `manager_user_id` bigint DEFAULT NULL,
  `location_desc` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `remark` varchar(300) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`equipment_id`),
  UNIQUE KEY `uk_md_equipment_code` (`equipment_code`),
  KEY `fk_md_equipment_test_type` (`test_type_id`),
  KEY `fk_md_equipment_lab` (`lab_id`),
  KEY `fk_md_equipment_manager` (`manager_user_id`),
  CONSTRAINT `fk_md_equipment_lab` FOREIGN KEY (`lab_id`) REFERENCES `md_lab` (`lab_id`),
  CONSTRAINT `fk_md_equipment_manager` FOREIGN KEY (`manager_user_id`) REFERENCES `sys_user` (`user_id`),
  CONSTRAINT `fk_md_equipment_test_type` FOREIGN KEY (`test_type_id`) REFERENCES `md_test_type` (`test_type_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- md_equipment_connection
CREATE TABLE IF NOT EXISTS `md_equipment_connection` (
  `connection_id` bigint NOT NULL AUTO_INCREMENT,
  `equipment_id` bigint NOT NULL,
  `protocol` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `endpoint` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `port` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `station_id` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `function_code` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `parity` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `polling_interval` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `retry_policy` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `remark` varchar(300) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`connection_id`),
  UNIQUE KEY `uk_md_equipment_connection_equipment` (`equipment_id`),
  CONSTRAINT `fk_md_equipment_connection_equipment` FOREIGN KEY (`equipment_id`) REFERENCES `md_equipment` (`equipment_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- md_equipment_point
CREATE TABLE IF NOT EXISTS `md_equipment_point` (
  `point_id` bigint NOT NULL AUTO_INCREMENT,
  `equipment_id` bigint NOT NULL,
  `point_name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `point_code` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `address` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `data_type` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `frequency` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `ratio` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `unit` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `note` varchar(300) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` tinyint NOT NULL DEFAULT '1',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`point_id`),
  UNIQUE KEY `uk_md_equipment_point_unique` (`equipment_id`,`address`,`point_name`),
  CONSTRAINT `fk_md_equipment_point_equipment` FOREIGN KEY (`equipment_id`) REFERENCES `md_equipment` (`equipment_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- biz_task
CREATE TABLE IF NOT EXISTS `biz_task` (
  `task_id` bigint NOT NULL AUTO_INCREMENT,
  `issue_id` bigint DEFAULT NULL,
  `task_no` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `task_source_type` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `source_system` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `external_task_id` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `task_name` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL,
  `client_name` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `contact_name` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `contact_phone` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `task_type` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL,
  `sample_type` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `priority` tinyint DEFAULT NULL,
  `sample_count` int DEFAULT NULL,
  `tray_limit` int DEFAULT NULL,
  `tray_count` int DEFAULT NULL,
  `finished_tray_count` int DEFAULT NULL,
  `arrival_status` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `task_status` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `transfer_status` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `arrival_time` datetime DEFAULT NULL,
  `due_time` datetime DEFAULT NULL,
  `plan_start_time` datetime DEFAULT NULL,
  `plan_end_time` datetime DEFAULT NULL,
  `actual_end_time` datetime DEFAULT NULL,
  `required_device` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `conditions_text` text COLLATE utf8mb4_unicode_ci,
  `attachment_path` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `assign_dept_id` bigint DEFAULT NULL,
  `generated_by` bigint DEFAULT NULL,
  `remark` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`task_id`),
  UNIQUE KEY `uk_biz_task_task_no` (`task_no`),
  KEY `fk_biz_task_issue` (`issue_id`),
  KEY `fk_biz_task_assign_dept` (`assign_dept_id`),
  KEY `fk_biz_task_generated_by` (`generated_by`),
  KEY `idx_biz_task_storage_read` (`source_system`,`created_at`,`task_no`),
  CONSTRAINT `fk_biz_task_assign_dept` FOREIGN KEY (`assign_dept_id`) REFERENCES `sys_dept` (`dept_id`),
  CONSTRAINT `fk_biz_task_generated_by` FOREIGN KEY (`generated_by`) REFERENCES `sys_user` (`user_id`),
  CONSTRAINT `fk_biz_task_issue` FOREIGN KEY (`issue_id`) REFERENCES `lab_task_issue` (`issue_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- biz_barcode
CREATE TABLE IF NOT EXISTS `biz_barcode` (
  `barcode_id` bigint NOT NULL AUTO_INCREMENT,
  `task_id` bigint DEFAULT NULL,
  `object_type` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
  `object_id` bigint NOT NULL,
  `barcode_no` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `barcode_content` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL,
  `barcode_type` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `print_count` int DEFAULT NULL,
  `last_print_time` datetime DEFAULT NULL,
  `status` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `generated_by` bigint DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`barcode_id`),
  UNIQUE KEY `uk_biz_barcode_barcode_no` (`barcode_no`),
  KEY `fk_biz_barcode_task` (`task_id`),
  KEY `fk_biz_barcode_generated_by` (`generated_by`),
  CONSTRAINT `fk_biz_barcode_generated_by` FOREIGN KEY (`generated_by`) REFERENCES `sys_user` (`user_id`),
  CONSTRAINT `fk_biz_barcode_task` FOREIGN KEY (`task_id`) REFERENCES `biz_task` (`task_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- biz_tray
CREATE TABLE IF NOT EXISTS `biz_tray` (
  `tray_id` bigint NOT NULL AUTO_INCREMENT,
  `tray_no` varchar(80) COLLATE utf8mb4_unicode_ci NOT NULL,
  `tray_type` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `task_id` bigint DEFAULT NULL,
  `current_temp_room_id` bigint DEFAULT NULL,
  `current_lab_id` bigint DEFAULT NULL,
  `current_equipment_id` bigint DEFAULT NULL,
  `temp_position_no` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `capacity` int DEFAULT NULL,
  `load_qty` int DEFAULT NULL,
  `tray_status` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `test_state` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `fixture_ready` tinyint NOT NULL DEFAULT '0',
  `target_sub_experiment_code` varchar(80) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `bind_time` datetime DEFAULT NULL,
  `in_temp_room_time` datetime DEFAULT NULL,
  `out_temp_room_time` datetime DEFAULT NULL,
  `current_barcode_id` bigint DEFAULT NULL,
  `unbind_time` datetime DEFAULT NULL,
  `last_barcode_print_time` datetime DEFAULT NULL,
  `current_owner_id` bigint DEFAULT NULL,
  `remark` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`tray_id`),
  UNIQUE KEY `uk_biz_tray_tray_no` (`tray_no`),
  KEY `fk_biz_tray_task` (`task_id`),
  KEY `fk_biz_tray_temp_room` (`current_temp_room_id`),
  KEY `fk_biz_tray_lab` (`current_lab_id`),
  KEY `fk_biz_tray_equipment` (`current_equipment_id`),
  KEY `fk_biz_tray_owner` (`current_owner_id`),
  KEY `fk_biz_tray_current_barcode` (`current_barcode_id`),
  KEY `idx_biz_tray_storage_read` (`remark`(32),`tray_no`,`task_id`),
  CONSTRAINT `fk_biz_tray_current_barcode` FOREIGN KEY (`current_barcode_id`) REFERENCES `biz_barcode` (`barcode_id`),
  CONSTRAINT `fk_biz_tray_equipment` FOREIGN KEY (`current_equipment_id`) REFERENCES `md_equipment` (`equipment_id`),
  CONSTRAINT `fk_biz_tray_lab` FOREIGN KEY (`current_lab_id`) REFERENCES `md_lab` (`lab_id`),
  CONSTRAINT `fk_biz_tray_owner` FOREIGN KEY (`current_owner_id`) REFERENCES `sys_user` (`user_id`),
  CONSTRAINT `fk_biz_tray_task` FOREIGN KEY (`task_id`) REFERENCES `biz_task` (`task_id`),
  CONSTRAINT `fk_biz_tray_temp_room` FOREIGN KEY (`current_temp_room_id`) REFERENCES `wh_temp_room` (`temp_room_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- biz_sample
CREATE TABLE IF NOT EXISTS `biz_sample` (
  `sample_id` bigint NOT NULL AUTO_INCREMENT,
  `sample_no` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `task_id` bigint DEFAULT NULL,
  `tray_id` bigint DEFAULT NULL,
  `sample_name` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `batch_no` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `sample_type` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `sample_spec` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `quantity` int DEFAULT NULL,
  `unit` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `sample_status` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `received_time` datetime DEFAULT NULL,
  `arrival_time` datetime DEFAULT NULL,
  `storage_condition` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `barcode_no` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `location_desc` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `flow_status` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `current_owner_id` bigint DEFAULT NULL,
  `remark` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`sample_id`),
  UNIQUE KEY `uk_biz_sample_sample_no` (`sample_no`),
  KEY `fk_biz_sample_task` (`task_id`),
  KEY `fk_biz_sample_tray` (`tray_id`),
  KEY `fk_biz_sample_owner` (`current_owner_id`),
  KEY `idx_biz_sample_storage_read` (`remark`(32)),
  CONSTRAINT `fk_biz_sample_owner` FOREIGN KEY (`current_owner_id`) REFERENCES `sys_user` (`user_id`),
  CONSTRAINT `fk_biz_sample_task` FOREIGN KEY (`task_id`) REFERENCES `biz_task` (`task_id`),
  CONSTRAINT `fk_biz_sample_tray` FOREIGN KEY (`tray_id`) REFERENCES `biz_tray` (`tray_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- biz_tray_item
CREATE TABLE IF NOT EXISTS `biz_tray_item` (
  `tray_item_id` bigint NOT NULL AUTO_INCREMENT,
  `tray_id` bigint NOT NULL,
  `sample_id` bigint NOT NULL,
  `position_no` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `quantity` int DEFAULT NULL,
  `bind_time` datetime DEFAULT NULL,
  `unbind_time` datetime DEFAULT NULL,
  `status` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`tray_item_id`),
  UNIQUE KEY `uk_biz_tray_item` (`tray_id`,`sample_id`),
  KEY `fk_biz_tray_item_sample` (`sample_id`),
  CONSTRAINT `fk_biz_tray_item_sample` FOREIGN KEY (`sample_id`) REFERENCES `biz_sample` (`sample_id`),
  CONSTRAINT `fk_biz_tray_item_tray` FOREIGN KEY (`tray_id`) REFERENCES `biz_tray` (`tray_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- biz_sample_event
CREATE TABLE IF NOT EXISTS `biz_sample_event` (
  `event_id` bigint NOT NULL AUTO_INCREMENT,
  `sample_id` bigint NOT NULL,
  `sample_no` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `task_id` bigint DEFAULT NULL,
  `task_no` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `action_type` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `location_desc` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `owner_name` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `sample_status` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `detail` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `event_time` datetime NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`event_id`),
  KEY `idx_biz_sample_event_sample_time` (`sample_id`,`event_time`),
  KEY `idx_biz_sample_event_task_id` (`task_id`),
  CONSTRAINT `fk_biz_sample_event_sample` FOREIGN KEY (`sample_id`) REFERENCES `biz_sample` (`sample_id`),
  CONSTRAINT `fk_biz_sample_event_task` FOREIGN KEY (`task_id`) REFERENCES `biz_task` (`task_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- biz_schedule
CREATE TABLE IF NOT EXISTS `biz_schedule` (
  `schedule_id` bigint NOT NULL AUTO_INCREMENT,
  `schedule_no` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `task_id` bigint DEFAULT NULL,
  `task_no` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `experiment_no` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `sub_experiment_code` varchar(80) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `schedule_type` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `lab_id` bigint DEFAULT NULL,
  `equipment_id` bigint DEFAULT NULL,
  `temp_room_id` bigint DEFAULT NULL,
  `device_name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `axis_codes_json` json DEFAULT NULL,
  `axis_batch_no` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `schedule_start_time` datetime NOT NULL,
  `schedule_end_time` datetime NOT NULL,
  `planned_hours` decimal(10,2) DEFAULT NULL,
  `schedule_status` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `is_retention` tinyint NOT NULL DEFAULT '0',
  `created_by` bigint DEFAULT NULL,
  `remark` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`schedule_id`),
  UNIQUE KEY `uk_biz_schedule_no` (`schedule_no`),
  KEY `idx_biz_schedule_task_id` (`task_id`),
  KEY `idx_biz_schedule_task_no` (`task_no`),
  KEY `idx_biz_schedule_device_time` (`device_name`,`schedule_start_time`,`schedule_end_time`),
  KEY `fk_biz_schedule_lab` (`lab_id`),
  KEY `fk_biz_schedule_equipment` (`equipment_id`),
  KEY `fk_biz_schedule_temp_room` (`temp_room_id`),
  KEY `fk_biz_schedule_created_by` (`created_by`),
  KEY `idx_biz_schedule_storage_read` (`schedule_type`,`schedule_start_time`,`schedule_no`),
  CONSTRAINT `fk_biz_schedule_created_by` FOREIGN KEY (`created_by`) REFERENCES `sys_user` (`user_id`),
  CONSTRAINT `fk_biz_schedule_equipment` FOREIGN KEY (`equipment_id`) REFERENCES `md_equipment` (`equipment_id`),
  CONSTRAINT `fk_biz_schedule_lab` FOREIGN KEY (`lab_id`) REFERENCES `md_lab` (`lab_id`),
  CONSTRAINT `fk_biz_schedule_task` FOREIGN KEY (`task_id`) REFERENCES `biz_task` (`task_id`),
  CONSTRAINT `fk_biz_schedule_temp_room` FOREIGN KEY (`temp_room_id`) REFERENCES `wh_temp_room` (`temp_room_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- biz_data_stream
CREATE TABLE IF NOT EXISTS `biz_data_stream` (
  `stream_id` bigint NOT NULL AUTO_INCREMENT,
  `stream_no` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `task_id` bigint DEFAULT NULL,
  `task_no` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `equipment_id` bigint DEFAULT NULL,
  `equipment_code` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `device_name` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `last_packet_time` datetime DEFAULT NULL,
  `quality_value` decimal(6,2) DEFAULT NULL,
  `stream_status` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `reported_flag` tinyint NOT NULL DEFAULT '0',
  `remark` varchar(300) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`stream_id`),
  UNIQUE KEY `uk_biz_data_stream_no` (`stream_no`),
  KEY `idx_biz_data_stream_task_id` (`task_id`),
  KEY `idx_biz_data_stream_task_no` (`task_no`),
  KEY `fk_biz_data_stream_equipment` (`equipment_id`),
  KEY `idx_biz_data_stream_storage_read` (`remark`(32),`last_packet_time`,`stream_no`),
  CONSTRAINT `fk_biz_data_stream_equipment` FOREIGN KEY (`equipment_id`) REFERENCES `md_equipment` (`equipment_id`),
  CONSTRAINT `fk_biz_data_stream_task` FOREIGN KEY (`task_id`) REFERENCES `biz_task` (`task_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- biz_experiment
CREATE TABLE IF NOT EXISTS `biz_experiment` (
  `experiment_id` bigint NOT NULL AUTO_INCREMENT,
  `experiment_no` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `task_id` bigint DEFAULT NULL,
  `task_no` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `experiment_name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `required_device` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `priority` tinyint DEFAULT NULL,
  `planned_hours` decimal(10,2) DEFAULT NULL,
  `experiment_status` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `axis_codes_json` json DEFAULT NULL,
  `unscheduled_since` datetime DEFAULT NULL,
  `actual_start_time` datetime DEFAULT NULL,
  `actual_end_time` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`experiment_id`),
  UNIQUE KEY `uk_biz_experiment_no` (`experiment_no`),
  KEY `idx_biz_experiment_task_no` (`task_no`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- biz_experiment_tray
CREATE TABLE IF NOT EXISTS `biz_experiment_tray` (
  `relation_id` bigint NOT NULL AUTO_INCREMENT,
  `experiment_no` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `task_no` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `tray_no` varchar(80) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`relation_id`),
  UNIQUE KEY `uk_biz_experiment_tray_unique` (`experiment_no`,`tray_no`),
  KEY `idx_biz_experiment_tray_task_no` (`task_no`),
  KEY `idx_biz_experiment_tray_tray_no` (`tray_no`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- biz_experiment_sample
CREATE TABLE IF NOT EXISTS `biz_experiment_sample` (
  `relation_id` bigint NOT NULL AUTO_INCREMENT,
  `experiment_no` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `task_no` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `sample_no` varchar(80) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`relation_id`),
  UNIQUE KEY `uk_biz_experiment_sample_unique` (`experiment_no`,`sample_no`),
  KEY `idx_biz_experiment_sample_task_no` (`task_no`),
  KEY `idx_biz_experiment_sample_sample_no` (`sample_no`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- biz_experiment_run
CREATE TABLE IF NOT EXISTS `biz_experiment_run` (
  `run_id` bigint NOT NULL AUTO_INCREMENT,
  `run_no` varchar(80) COLLATE utf8mb4_unicode_ci NOT NULL,
  `schedule_no` varchar(80) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `task_no` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `experiment_no` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `sub_experiment_code` varchar(80) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `device_name` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `axis_codes_json` json DEFAULT NULL,
  `axis_batch_no` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `planned_hours` decimal(10,2) DEFAULT NULL,
  `run_status` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `started_at` datetime DEFAULT NULL,
  `planned_end_at` datetime DEFAULT NULL,
  `ended_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`run_id`),
  UNIQUE KEY `uk_biz_experiment_run_no` (`run_no`),
  KEY `idx_biz_experiment_run_task_exp` (`task_no`,`experiment_no`),
  KEY `idx_biz_experiment_run_schedule` (`schedule_no`),
  KEY `idx_biz_experiment_run_status` (`run_status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- biz_experiment_run_step
CREATE TABLE IF NOT EXISTS `biz_experiment_run_step` (
  `step_id` bigint NOT NULL AUTO_INCREMENT,
  `run_no` varchar(80) COLLATE utf8mb4_unicode_ci NOT NULL,
  `task_no` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `experiment_no` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `sub_experiment_code` varchar(80) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `axis_code` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `step_no` int NOT NULL,
  `step_status` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `started_at` datetime DEFAULT NULL,
  `ended_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`step_id`),
  UNIQUE KEY `uk_biz_experiment_run_step_axis` (`run_no`,`axis_code`),
  KEY `idx_biz_experiment_run_step_run` (`run_no`),
  KEY `idx_biz_experiment_run_step_task_exp` (`task_no`,`experiment_no`),
  KEY `idx_biz_experiment_run_step_status` (`step_status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- biz_experiment_run_tray
CREATE TABLE IF NOT EXISTS `biz_experiment_run_tray` (
  `relation_id` bigint NOT NULL AUTO_INCREMENT,
  `run_no` varchar(80) COLLATE utf8mb4_unicode_ci NOT NULL,
  `task_no` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `experiment_no` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `sub_experiment_code` varchar(80) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `tray_no` varchar(80) COLLATE utf8mb4_unicode_ci NOT NULL,
  `run_tray_status` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `started_at` datetime DEFAULT NULL,
  `ended_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`relation_id`),
  UNIQUE KEY `uk_biz_experiment_run_tray_unique` (`run_no`,`tray_no`),
  KEY `idx_biz_experiment_run_tray_exp` (`task_no`,`experiment_no`),
  KEY `idx_biz_experiment_run_tray_no` (`tray_no`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- biz_experiment_event
CREATE TABLE IF NOT EXISTS `biz_experiment_event` (
  `experiment_event_id` bigint NOT NULL AUTO_INCREMENT,
  `event_type` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `task_no` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `experiment_no` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `sub_experiment_code` varchar(80) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `lab_code` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `success_id` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `event_time` datetime DEFAULT NULL,
  `message_id` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `message_log_id` bigint DEFAULT NULL,
  `payload_json` json DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`experiment_event_id`),
  UNIQUE KEY `uk_biz_experiment_event_message` (`message_id`),
  KEY `idx_biz_experiment_event_task_exp` (`task_no`,`experiment_no`),
  KEY `idx_biz_experiment_event_time` (`event_type`,`event_time`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- biz_fixture_install_pending
CREATE TABLE IF NOT EXISTS `biz_fixture_install_pending` (
  `fixture_install_id` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `tray_no` varchar(80) COLLATE utf8mb4_unicode_ci NOT NULL,
  `task_no` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `experiment_no` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `lab_code` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'PENDING',
  `requested_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `ready_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`fixture_install_id`,`tray_no`),
  KEY `idx_biz_fixture_install_pending_match` (`task_no`,`experiment_no`,`lab_code`,`tray_no`,`status`),
  KEY `idx_biz_fixture_install_pending_status` (`status`,`requested_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- biz_experiment_result
CREATE TABLE IF NOT EXISTS `biz_experiment_result` (
  `experiment_result_id` bigint NOT NULL AUTO_INCREMENT,
  `task_no` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `experiment_no` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `sub_experiment_code` varchar(80) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `lab_code` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `result_time` datetime NOT NULL,
  `conclusion` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `summary` text COLLATE utf8mb4_unicode_ci,
  `result_payload_json` json NOT NULL,
  `message_id` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `message_log_id` bigint DEFAULT NULL,
  `status` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT 'RECEIVED',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`experiment_result_id`),
  UNIQUE KEY `uk_biz_experiment_result_message` (`message_id`),
  KEY `idx_biz_experiment_result_exp` (`experiment_no`),
  KEY `idx_biz_experiment_result_task` (`task_no`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- biz_mq_message_log
CREATE TABLE IF NOT EXISTS `biz_mq_message_log` (
  `message_log_id` bigint NOT NULL AUTO_INCREMENT,
  `message_id` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `direction` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `topic` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `message_type` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `correlation_id` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `lab_code` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `task_no` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `experiment_no` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `sub_experiment_code` varchar(80) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `qos` tinyint DEFAULT NULL,
  `retain_flag` tinyint NOT NULL DEFAULT '0',
  `payload_json` json DEFAULT NULL,
  `process_status` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'RECEIVED',
  `error_code` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `error_message` varchar(1000) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `received_at` datetime DEFAULT NULL,
  `processed_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`message_log_id`),
  UNIQUE KEY `uk_biz_mq_message_id` (`message_id`),
  KEY `idx_biz_mq_topic_time` (`topic`,`created_at`),
  KEY `idx_biz_mq_task_exp` (`task_no`,`experiment_no`),
  KEY `idx_biz_mq_status` (`process_status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- biz_lab_attendance_session
CREATE TABLE IF NOT EXISTS `biz_lab_attendance_session` (
  `session_id` bigint NOT NULL AUTO_INCREMENT,
  `username` varchar(80) COLLATE utf8mb4_unicode_ci NOT NULL,
  `employee_name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `lab_name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `lab_code` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `active` tinyint NOT NULL DEFAULT '1',
  `logged_in_at` datetime NOT NULL,
  `last_seen_at` datetime DEFAULT NULL,
  `logged_out_at` datetime DEFAULT NULL,
  `reason` varchar(80) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `work_started_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`session_id`),
  KEY `idx_biz_lab_attendance_active_lab` (`active`,`lab_name`),
  KEY `idx_biz_lab_attendance_username` (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- biz_lab_work_interval
CREATE TABLE IF NOT EXISTS `biz_lab_work_interval` (
  `interval_id` bigint NOT NULL AUTO_INCREMENT,
  `session_id` bigint DEFAULT NULL,
  `username` varchar(80) COLLATE utf8mb4_unicode_ci NOT NULL,
  `employee_name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `lab_name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `lab_code` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `run_no` varchar(80) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `task_no` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `experiment_no` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `source` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `started_at` datetime NOT NULL,
  `ended_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`interval_id`),
  KEY `idx_biz_lab_work_username_time` (`username`,`started_at`),
  KEY `idx_biz_lab_work_run_no` (`run_no`),
  KEY `idx_biz_lab_work_lab_open` (`lab_name`,`ended_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- biz_lab_operation_log
CREATE TABLE IF NOT EXISTS `biz_lab_operation_log` (
  `operation_log_id` bigint NOT NULL AUTO_INCREMENT,
  `session_id` bigint DEFAULT NULL,
  `username` varchar(80) COLLATE utf8mb4_unicode_ci NOT NULL,
  `employee_name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `lab_name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `lab_code` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `action_name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `task_no` varchar(80) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `experiment_no` varchar(80) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `tray_no` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `run_no` varchar(80) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `source` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `operated_at` datetime NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`operation_log_id`),
  KEY `idx_biz_lab_operation_time` (`operated_at`),
  KEY `idx_biz_lab_operation_employee_time` (`username`,`operated_at`),
  KEY `idx_biz_lab_operation_lab_time` (`lab_name`,`operated_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- biz_test_data_export
CREATE TABLE IF NOT EXISTS `biz_test_data_export` (
  `export_key` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `task_no` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `experiment_no` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `run_no` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `axis_code` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `sample_no` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `export_status` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `file_path` varchar(1024) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `relative_path` varchar(1024) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `error_text` text COLLATE utf8mb4_unicode_ci,
  `attempts` int NOT NULL DEFAULT '0',
  `generated_at` varchar(40) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updated_at` varchar(40) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `payload_json` json NOT NULL,
  PRIMARY KEY (`export_key`),
  KEY `idx_test_data_export_task` (`task_no`,`experiment_no`),
  KEY `idx_test_data_export_status` (`export_status`,`updated_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- biz_test_data_share
CREATE TABLE IF NOT EXISTS `biz_test_data_share` (
  `share_token` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL,
  `task_no` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `experiment_no` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL,
  `updated_at` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL,
  PRIMARY KEY (`share_token`),
  UNIQUE KEY `uk_test_data_share_scope` (`task_no`,`experiment_no`),
  KEY `idx_test_data_share_active` (`active`,`updated_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- sys_fixed_terminal
CREATE TABLE IF NOT EXISTS `sys_fixed_terminal` (
  `terminal_id` varchar(128) NOT NULL,
  `terminal_name` varchar(255) NOT NULL,
  `secret_hash` char(64) NOT NULL,
  `bound_module` varchar(32) NOT NULL,
  `bound_lab_name` varchar(128) NOT NULL DEFAULT '',
  `active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `last_authenticated_at` datetime DEFAULT NULL,
  PRIMARY KEY (`terminal_id`),
  KEY `idx_fixed_terminal_active` (`active`,`bound_module`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- sys_terminal_runtime
CREATE TABLE IF NOT EXISTS `sys_terminal_runtime` (
  `terminal_id` varchar(128) NOT NULL,
  `machine_name` varchar(255) NOT NULL DEFAULT '',
  `ip_address` varchar(64) NOT NULL DEFAULT '',
  `configured_path` varchar(1024) NOT NULL DEFAULT '',
  `current_path` varchar(1024) NOT NULL DEFAULT '',
  `current_title` varchar(255) NOT NULL DEFAULT '',
  `agent_version` varchar(32) NOT NULL DEFAULT '',
  `allow_reload` tinyint(1) NOT NULL DEFAULT '0',
  `allow_power` tinyint(1) NOT NULL DEFAULT '0',
  `last_seen_at` datetime DEFAULT NULL,
  `last_page_seen_at` datetime DEFAULT NULL,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`terminal_id`),
  KEY `idx_terminal_runtime_seen` (`last_seen_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- sys_terminal_command
CREATE TABLE IF NOT EXISTS `sys_terminal_command` (
  `command_id` bigint NOT NULL AUTO_INCREMENT,
  `terminal_id` varchar(128) NOT NULL,
  `action` varchar(16) NOT NULL,
  `status` varchar(16) NOT NULL DEFAULT 'queued',
  `requested_by` varchar(128) NOT NULL,
  `message` varchar(512) NOT NULL DEFAULT '',
  `created_at` datetime NOT NULL,
  `dispatched_at` datetime DEFAULT NULL,
  `completed_at` datetime DEFAULT NULL,
  PRIMARY KEY (`command_id`),
  KEY `idx_terminal_command_pending` (`terminal_id`,`status`,`command_id`),
  KEY `idx_terminal_command_latest` (`terminal_id`,`command_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
