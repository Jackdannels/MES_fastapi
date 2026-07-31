from __future__ import annotations

from dataclasses import dataclass

from app.core.config import Settings


@dataclass(frozen=True)
class MySQLCredentials:
    user: str
    password: str


def migration_credentials(app_settings: Settings) -> MySQLCredentials:
    migration_user = str(app_settings.MYSQL_MIGRATION_USER or "").strip()
    production = app_settings.APP_ENV == "prod"

    if not migration_user:
        if production:
            raise RuntimeError(
                "MYSQL_MIGRATION_USER is required in production and must identify a dedicated DDL account."
            )
        return MySQLCredentials(
            user=app_settings.MYSQL_USER,
            password=app_settings.MYSQL_PASSWORD,
        )

    if production and migration_user == app_settings.MYSQL_USER:
        raise RuntimeError(
            "MYSQL_MIGRATION_USER must differ from MYSQL_USER in production."
        )

    migration_password = app_settings.MYSQL_MIGRATION_PASSWORD
    if migration_password is None:
        if production:
            raise RuntimeError("MYSQL_MIGRATION_PASSWORD is required in production.")
        migration_password = app_settings.MYSQL_PASSWORD if migration_user == app_settings.MYSQL_USER else ""

    return MySQLCredentials(user=migration_user, password=migration_password)
