from app.core.config import settings

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


def get_connection():
    if settings.STORAGE_BACKEND == "mysql":
        if pymysql is None:
            raise RuntimeError("pymysql is not installed") from _mysql_import_error
        return pymysql.connect(
            host=settings.MYSQL_HOST,
            port=settings.MYSQL_PORT,
            user=settings.MYSQL_USER,
            password=settings.MYSQL_PASSWORD,
            database=settings.MYSQL_DATABASE,
            charset="utf8mb4",
            autocommit=False,
        )

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
