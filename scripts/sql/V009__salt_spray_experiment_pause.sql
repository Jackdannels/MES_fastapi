USE `mes_single_branch`;

CREATE TABLE IF NOT EXISTS `biz_experiment_run_pause` (
  `pause_id` bigint NOT NULL AUTO_INCREMENT,
  `pause_no` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `run_no` varchar(80) COLLATE utf8mb4_unicode_ci NOT NULL,
  `task_no` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `experiment_no` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `lab_code` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `pause_status` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
  `inspection_tray_codes_json` json NOT NULL,
  `pause_reason` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `paused_at` datetime DEFAULT NULL,
  `resumed_at` datetime DEFAULT NULL,
  `stopped_at` datetime DEFAULT NULL,
  `pause_seconds` int NOT NULL DEFAULT '0',
  `termination_type` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `termination_reason` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`pause_id`),
  UNIQUE KEY `uk_biz_experiment_run_pause_no` (`pause_no`),
  KEY `idx_biz_experiment_run_pause_run_status` (`run_no`,`pause_status`),
  KEY `idx_biz_experiment_run_pause_task_exp` (`task_no`,`experiment_no`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
