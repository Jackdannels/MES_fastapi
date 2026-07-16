from app.core.config import settings
from app.db.mysql_pool import get_mysql_connection_pool
from app.db.mysql_snapshot import MySQLConnectionSettings

try:
    import dmPython
except ImportError as exc:
    dmPython = None
    _import_error = exc
else:
    _import_error = None

try:
    import pymysql
except ImportError as exc:
    pymysql = None
    _mysql_import_error = exc
else:
    _mysql_import_error = None


_mysql_pool = None


def get_connection():
    if settings.STORAGE_BACKEND == "mysql":
        if pymysql is None:
            raise RuntimeError("pymysql is not installed") from _mysql_import_error
        global _mysql_pool
        if _mysql_pool is None:
            connection_settings = MySQLConnectionSettings(
                host=settings.MYSQL_HOST,
                port=settings.MYSQL_PORT,
                user=settings.MYSQL_USER,
                password=settings.MYSQL_PASSWORD,
                database=settings.MYSQL_DATABASE,
                charset="utf8mb4",
                pool_size=settings.MYSQL_POOL_SIZE,
                pool_timeout_seconds=settings.MYSQL_POOL_TIMEOUT_SECONDS,
            )
            _mysql_pool = get_mysql_connection_pool(connection_settings)
        return _mysql_pool.acquire()

    if dmPython is None:
        raise RuntimeError("dmPython is not installed") from _import_error

    if settings.DM_DSN:
        return dmPython.connect(settings.DM_DSN)

    return dmPython.connect(
        user=settings.DM_USER,
        password=settings.DM_PASSWORD,
        server=settings.DM_HOST,
        port=settings.DM_PORT,
        database=settings.DM_DATABASE,
    )
