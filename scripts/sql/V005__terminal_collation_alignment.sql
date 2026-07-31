-- Align terminal tables that were historically created with the MySQL server's
-- default utf8mb4_0900_ai_ci collation before runtime DDL was removed.
-- The complete release contract uses the project-wide utf8mb4_unicode_ci.

USE `mes_single_branch`;

ALTER TABLE `sys_fixed_terminal`
  CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `sys_terminal_runtime`
  CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `sys_terminal_command`
  CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
