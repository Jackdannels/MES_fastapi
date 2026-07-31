import pytest

from app.core.config import Settings
from app.db.mysql_credentials import migration_credentials


def test_development_migration_credentials_fall_back_to_runtime_account() -> None:
    app_settings = Settings(
        _env_file=None,
        APP_ENV="dev",
        MYSQL_USER="local-user",
        MYSQL_PASSWORD="local-password",
    )

    credentials = migration_credentials(app_settings)

    assert credentials.user == "local-user"
    assert credentials.password == "local-password"


def test_production_requires_a_dedicated_migration_account() -> None:
    app_settings = Settings(
        _env_file=None,
        APP_ENV="prod",
        MYSQL_USER="mes_api",
        MYSQL_PASSWORD="api-password",
    )

    with pytest.raises(RuntimeError, match="MYSQL_MIGRATION_USER is required"):
        migration_credentials(app_settings)


def test_production_rejects_shared_runtime_and_migration_account() -> None:
    app_settings = Settings(
        _env_file=None,
        APP_ENV="prod",
        MYSQL_USER="mes_api",
        MYSQL_PASSWORD="api-password",
        MYSQL_MIGRATION_USER="mes_api",
        MYSQL_MIGRATION_PASSWORD="migration-password",
    )

    with pytest.raises(RuntimeError, match="must differ"):
        migration_credentials(app_settings)


def test_production_uses_explicit_migration_credentials() -> None:
    app_settings = Settings(
        _env_file=None,
        APP_ENV="prod",
        MYSQL_USER="mes_api",
        MYSQL_PASSWORD="api-password",
        MYSQL_MIGRATION_USER="mes_migrator",
        MYSQL_MIGRATION_PASSWORD="migration-password",
    )

    credentials = migration_credentials(app_settings)

    assert credentials.user == "mes_migrator"
    assert credentials.password == "migration-password"
