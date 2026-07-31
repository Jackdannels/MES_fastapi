from __future__ import annotations

from typing import Any

from app.db.schema_version import require_schema_version


def ensure_schema_extensions(backend: Any) -> None:
    """Validate the migrated schema once without changing database structure."""
    if backend._schema_initialized:
        return
    with backend._connect() as connection:
        with connection.cursor() as cursor:
            require_schema_version(cursor)
    backend._schema_initialized = True
