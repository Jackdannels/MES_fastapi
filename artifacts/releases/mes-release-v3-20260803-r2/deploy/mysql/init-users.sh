#!/bin/sh
set -eu

case "${MYSQL_DATABASE:-}" in
  ''|*[!A-Za-z0-9_]*)
    echo "MYSQL_DATABASE must contain only letters, digits, and underscores" >&2
    exit 1
    ;;
esac

escape_sql_string() {
  printf '%s' "$1" | sed "s/'/''/g"
}

migration_user="$(escape_sql_string "${MYSQL_MIGRATION_USER:?MYSQL_MIGRATION_USER is required}")"
migration_password="$(escape_sql_string "${MYSQL_MIGRATION_PASSWORD:?MYSQL_MIGRATION_PASSWORD is required}")"
api_user="$(escape_sql_string "${MYSQL_USER:?MYSQL_USER is required}")"

mysql --protocol=socket -uroot -p"${MYSQL_ROOT_PASSWORD}" <<SQL
REVOKE ALL PRIVILEGES, GRANT OPTION FROM '${api_user}'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE
  ON \`${MYSQL_DATABASE}\`.* TO '${api_user}'@'%';
CREATE USER IF NOT EXISTS '${migration_user}'@'%' IDENTIFIED BY '${migration_password}';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, DROP, INDEX, REFERENCES,
      CREATE ROUTINE, ALTER ROUTINE, EXECUTE
  ON \`${MYSQL_DATABASE}\`.* TO '${migration_user}'@'%';
FLUSH PRIVILEGES;
SQL
