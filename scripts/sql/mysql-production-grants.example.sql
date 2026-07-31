-- Production account template. Replace every <...> placeholder before use.
-- Run this file as a MySQL DBA; it is not part of the V001-V005 migration chain.
-- The database must already exist before granting database-scoped privileges.

CREATE USER IF NOT EXISTS 'mes_migrator'@'<application-host>'
  IDENTIFIED BY '<strong-migration-password>';
CREATE USER IF NOT EXISTS 'mes_api'@'<application-host>'
  IDENTIFIED BY '<strong-api-password>';

GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, DROP, INDEX, REFERENCES,
      CREATE ROUTINE, ALTER ROUTINE, EXECUTE
  ON `mes_single_branch`.* TO 'mes_migrator'@'<application-host>';

GRANT SELECT, INSERT, UPDATE, DELETE
  ON `mes_single_branch`.* TO 'mes_api'@'<application-host>';

-- Confirm the effective grants before deploying:
SHOW GRANTS FOR 'mes_migrator'@'<application-host>';
SHOW GRANTS FOR 'mes_api'@'<application-host>';
