from app.core.config import settings

try:
    import dmPython
except ImportError as exc:
    dmPython = None
    _import_error = exc
else:
    _import_error = None


def get_connection():
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
