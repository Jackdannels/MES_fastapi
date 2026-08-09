from __future__ import annotations

import logging
from typing import Any

from app.db.schema_contract import (
    REQUIRED_SCHEMA_TABLES,
    SCHEMA_CONTRACT,
    SchemaContractError,
    find_schema_contract_gaps,
    validate_schema_contract,
)


logger = logging.getLogger(__name__)

REQUIRED_SCHEMA_VERSION = "V008"
# Backward-compatible exports for diagnostics and tests. The legacy fingerprint is
# now the complete release contract, not a small representative subset.
LEGACY_REQUIRED_TABLES = set(REQUIRED_SCHEMA_TABLES)
LEGACY_REQUIRED_COLUMNS = {
    (table_name, column_name)
    for table_name, table in SCHEMA_CONTRACT["tables"].items()
    for column_name in table["columns"]
}
LEGACY_REQUIRED_INDEXES = {
    (table_name, index_name)
    for table_name, table in SCHEMA_CONTRACT["tables"].items()
    for index_name in table["indexes"]
}


def _first_value(row: Any, default: Any = None) -> Any:
    if isinstance(row, dict):
        return next(iter(row.values()), default)
    if isinstance(row, (tuple, list)) and row:
        return row[0]
    return default


def _normalized_app_env(app_env: str | None) -> str:
    if app_env is None:
        from app.core.config import settings

        app_env = settings.APP_ENV
    normalized = str(app_env or "dev").strip().lower()
    if normalized in {"production", "release"}:
        return "prod"
    if normalized in {"development", "local"}:
        return "dev"
    return normalized


def find_legacy_schema_gaps(cursor: Any) -> list[str]:
    """Return full release-contract drift for a history-less development database."""

    return find_schema_contract_gaps(cursor)


def require_schema_version(
    cursor: Any,
    required_version: str = REQUIRED_SCHEMA_VERSION,
    *,
    app_env: str | None = None,
) -> None:
    try:
        cursor.execute(
            "SELECT COUNT(*) FROM information_schema.tables "
            "WHERE table_schema = DATABASE() AND table_name = 'schema_migrations'"
        )
        history_exists = bool(_first_value(cursor.fetchone(), 0))
    except Exception as exc:
        raise RuntimeError("MySQL schema metadata cannot be read.") from exc

    if not history_exists:
        if _normalized_app_env(app_env) == "prod":
            raise RuntimeError(
                "MySQL schema migration history is required in production. "
                "Run scripts/init_mysql_storage.py with the migration database account before starting MES."
            )
        try:
            validate_schema_contract(cursor)
        except SchemaContractError as exc:
            raise RuntimeError(
                "MySQL legacy schema is incomplete or has drifted and has no migration history. "
                f"{exc}"
            ) from exc
        except Exception as exc:
            raise RuntimeError("MySQL schema metadata cannot be read.") from exc
        logger.warning(
            f"MySQL database has no schema_migrations history; allowing a complete {required_version} legacy schema "
            "outside production only. Run scripts/init_mysql_storage.py before deployment."
        )
        return

    cursor.execute(
        "SELECT version, success FROM schema_migrations WHERE version = %s",
        (required_version,),
    )
    row = cursor.fetchone()
    if isinstance(row, dict):
        version = row.get("version")
        success = row.get("success")
    elif isinstance(row, (tuple, list)) and len(row) >= 2:
        version, success = row[0], row[1]
    else:
        version, success = None, None

    if str(version or "") != required_version or not bool(success):
        raise RuntimeError(
            f"MySQL schema version {required_version} is required. "
            "Run scripts/init_mysql_storage.py with the migration database account before starting MES."
        )

    try:
        validate_schema_contract(cursor)
    except SchemaContractError as exc:
        raise RuntimeError(
            f"MySQL schema migration {required_version} is recorded, but the physical schema has drifted. {exc}"
        ) from exc
    except Exception as exc:
        raise RuntimeError("MySQL schema metadata cannot be read.") from exc
