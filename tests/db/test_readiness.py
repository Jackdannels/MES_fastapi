from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.db import readiness
from app import main as app_main


class _Connection:
    def __init__(self) -> None:
        self.cursor_instance = SimpleNamespace()
        self.closed = False

    def cursor(self):
        connection = self

        class _CursorContext:
            def __enter__(self):
                return connection.cursor_instance

            def __exit__(self, exc_type, exc, traceback):
                return False

        return _CursorContext()

    def close(self) -> None:
        self.closed = True


def test_runtime_database_readiness_uses_runtime_account_and_production_gate(monkeypatch) -> None:
    connection = _Connection()
    connect_calls = []
    schema_calls = []

    monkeypatch.setattr(
        "pymysql.connect",
        lambda **kwargs: connect_calls.append(kwargs) or connection,
    )
    monkeypatch.setattr(
        readiness,
        "require_schema_version",
        lambda cursor, *, app_env: schema_calls.append((cursor, app_env)),
    )
    app_settings = Settings(
        _env_file=None,
        APP_ENV="prod",
        MYSQL_USER="mes_api",
        MYSQL_PASSWORD="api-secret",
        MYSQL_MIGRATION_USER="mes_migrator",
        MYSQL_MIGRATION_PASSWORD="migration-secret",
        MYSQL_DATABASE="mes_prod",
    )

    readiness.require_runtime_database_ready(app_settings)

    assert connect_calls[0]["user"] == "mes_api"
    assert connect_calls[0]["password"] == "api-secret"
    assert connect_calls[0]["database"] == "mes_prod"
    assert schema_calls == [(connection.cursor_instance, "prod")]
    assert connection.closed is True


def test_runtime_database_readiness_rejects_non_mysql_backend() -> None:
    app_settings = Settings(_env_file=None)
    app_settings.STORAGE_BACKEND = "dm"

    with pytest.raises(RuntimeError, match="MySQL"):
        readiness.require_runtime_database_ready(app_settings)


def test_production_readiness_rejects_mysql_root_runtime_account() -> None:
    app_settings = Settings(
        _env_file=None,
        APP_ENV="prod",
        MYSQL_USER="root",
    )

    with pytest.raises(RuntimeError, match="must not use.*root"):
        readiness.require_runtime_database_ready(app_settings)


def test_production_app_checks_database_before_serving(monkeypatch) -> None:
    checks = []
    monkeypatch.setattr(
        app_main,
        "require_runtime_database_ready",
        lambda configured: checks.append(configured.MYSQL_DATABASE),
    )
    app_settings = Settings(
        _env_file=None,
        APP_ENV="prod",
        MYSQL_DATABASE="mes_prod",
        RABBITMQ_ENABLED=False,
        MQTT_ENABLED=False,
    )

    with TestClient(app_main.create_app(app_settings)) as client:
        assert client.get("/health/live").status_code == 200

    assert checks == ["mes_prod"]


def test_production_app_refuses_startup_when_database_is_not_ready(monkeypatch) -> None:
    monkeypatch.setattr(
        app_main,
        "require_runtime_database_ready",
        lambda _configured: (_ for _ in ()).throw(RuntimeError("V005 missing")),
    )
    app_settings = Settings(
        _env_file=None,
        APP_ENV="prod",
        RABBITMQ_ENABLED=False,
        MQTT_ENABLED=False,
    )

    with pytest.raises(RuntimeError, match="V005 missing"):
        with TestClient(app_main.create_app(app_settings)):
            pass
