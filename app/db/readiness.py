from __future__ import annotations

from app.core.config import Settings
from app.db.schema_version import require_schema_version
from app.db.mysql_tls import mysql_tls_connect_options


def require_runtime_database_ready(app_settings: Settings) -> None:
    if app_settings.STORAGE_BACKEND != "mysql":
        raise RuntimeError("Production readiness requires the MySQL storage backend.")
    if app_settings.APP_ENV == "prod" and app_settings.MYSQL_USER.strip().lower() == "root":
        raise RuntimeError("Production runtime must not use the MySQL root account.")

    try:
        import pymysql
    except ImportError as exc:
        raise RuntimeError("pymysql is required for MySQL readiness checks.") from exc

    connection = pymysql.connect(
        host=app_settings.MYSQL_HOST,
        port=app_settings.MYSQL_PORT,
        user=app_settings.MYSQL_USER,
        password=app_settings.MYSQL_PASSWORD,
        database=app_settings.MYSQL_DATABASE,
        charset="utf8mb4",
        autocommit=True,
        **mysql_tls_connect_options(app_settings),
    )
    try:
        with connection.cursor() as cursor:
            require_schema_version(cursor, app_env=app_settings.APP_ENV)
    finally:
        connection.close()
