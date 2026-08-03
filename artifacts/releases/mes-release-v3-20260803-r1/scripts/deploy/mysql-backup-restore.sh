#!/bin/sh
set -eu

MYSQL_PWD="$(cat /run/secrets/mysql_password)"
export MYSQL_PWD

case "${1:-}" in
  backup)
    mysqldump \
      --host="$MES_DB_HOST" \
      --port="$MES_DB_PORT" \
      --user="$MES_DB_USER" \
      --single-transaction \
      --quick \
      --routines \
      --triggers \
      --events \
      --hex-blob \
      --set-gtid-purged=OFF \
      --no-tablespaces \
      "$MES_DB_NAME" > /backup/database.sql
    ;;
  prepare)
    case "$MES_DB_NAME" in
      *_restore_test) ;;
      *) echo "Refusing non-rehearsal target database." >&2; exit 2 ;;
    esac
    mysql \
      --host="$MES_DB_HOST" \
      --port="$MES_DB_PORT" \
      --user="$MES_DB_USER" \
      -e "CREATE DATABASE IF NOT EXISTS \`$MES_DB_NAME\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
    table_count="$(mysql \
      --host="$MES_DB_HOST" \
      --port="$MES_DB_PORT" \
      --user="$MES_DB_USER" \
      --batch \
      --skip-column-names \
      -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = '$MES_DB_NAME'")"
    test "$table_count" = "0"
    ;;
  restore)
    mysql \
      --host="$MES_DB_HOST" \
      --port="$MES_DB_PORT" \
      --user="$MES_DB_USER" \
      "$MES_DB_NAME" < /backup/database.sql
    ;;
  *)
    echo "Usage: mysql-backup-restore.sh <backup|prepare|restore>" >&2
    exit 2
    ;;
esac
