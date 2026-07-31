from app.core.config import Settings


def test_settings_default_to_debug_disabled_without_environment_overrides(monkeypatch):
    monkeypatch.delenv("DEBUG", raising=False)

    settings = Settings(
        _env_file=None,
        APP_NAME="MES",
        DEMO_USER=None,
        DEMO_PASSWORD=None,
        SESSION_SECRET_KEY=None,
    )

    assert settings.DEBUG is False


def test_settings_default_to_backend_api_only_without_web_app_hosting(monkeypatch):
    monkeypatch.delenv("SERVE_WEB_APP", raising=False)

    settings = Settings(
        _env_file=None,
        APP_NAME="MES",
        DEMO_USER=None,
        DEMO_PASSWORD=None,
        SESSION_SECRET_KEY=None,
    )

    assert settings.SERVE_WEB_APP is False


def test_settings_enable_slow_request_observability_without_logging_every_request(monkeypatch):
    monkeypatch.delenv("PERFORMANCE_MONITOR_ENABLED", raising=False)
    monkeypatch.delenv("PERFORMANCE_LOG_ALL_REQUESTS", raising=False)
    monkeypatch.delenv("PERFORMANCE_SLOW_REQUEST_MS", raising=False)
    monkeypatch.delenv("READ_SNAPSHOT_CACHE_TTL_SECONDS", raising=False)

    settings = Settings(_env_file=None)

    assert settings.PERFORMANCE_MONITOR_ENABLED is True
    assert settings.PERFORMANCE_LOG_ALL_REQUESTS is False
    assert settings.PERFORMANCE_SLOW_REQUEST_MS == 500.0
    assert settings.READ_SNAPSHOT_CACHE_TTL_SECONDS == 5.0


def test_settings_disable_auth_session_timeouts_by_default(monkeypatch):
    monkeypatch.delenv("SESSION_IDLE_TIMEOUT_MINUTES", raising=False)
    monkeypatch.delenv("SESSION_MAX_AGE_HOURS", raising=False)

    settings = Settings(
        _env_file=None,
        APP_NAME="MES",
        DEMO_USER=None,
        DEMO_PASSWORD=None,
        SESSION_SECRET_KEY=None,
    )

    assert settings.SESSION_IDLE_TIMEOUT_MINUTES == 0
    assert settings.SESSION_MAX_AGE_HOURS == 0


def test_settings_default_upper_computer_simulator_dir_uses_current_user_desktop(monkeypatch):
    monkeypatch.delenv("UPPER_COMPUTER_SIMULATOR_DIR", raising=False)

    settings = Settings(_env_file=None)

    assert settings.UPPER_COMPUTER_SIMULATOR_DIR.endswith("MES_upper_computer_simulator")
    assert "Desktop" in settings.UPPER_COMPUTER_SIMULATOR_DIR


def test_settings_blank_upper_computer_simulator_dir_falls_back_to_default(monkeypatch):
    monkeypatch.delenv("UPPER_COMPUTER_SIMULATOR_DIR", raising=False)

    settings = Settings(_env_file=None, UPPER_COMPUTER_SIMULATOR_DIR="  ")

    assert settings.UPPER_COMPUTER_SIMULATOR_DIR.endswith("MES_upper_computer_simulator")
    assert "Desktop" in settings.UPPER_COMPUTER_SIMULATOR_DIR


def test_settings_keep_runtime_and_migration_mysql_credentials_separate() -> None:
    settings = Settings(
        _env_file=None,
        MYSQL_USER="mes_api",
        MYSQL_PASSWORD="api-secret",
        MYSQL_MIGRATION_USER="mes_migrator",
        MYSQL_MIGRATION_PASSWORD="migration-secret",
    )

    assert settings.MYSQL_USER == "mes_api"
    assert settings.MYSQL_PASSWORD == "api-secret"
    assert settings.MYSQL_MIGRATION_USER == "mes_migrator"
    assert settings.MYSQL_MIGRATION_PASSWORD == "migration-secret"


def test_settings_load_docker_secret_files(tmp_path, monkeypatch) -> None:
    monkeypatch.delenv("SESSION_SECRET_KEY", raising=False)
    (tmp_path / "MYSQL_PASSWORD").write_text("api-secret-from-file", encoding="utf-8")
    (tmp_path / "SESSION_SECRET_KEY").write_text("session-secret-from-file", encoding="utf-8")

    settings = Settings(_env_file=None, _secrets_dir=tmp_path)

    assert settings.MYSQL_PASSWORD == "api-secret-from-file"
    assert settings.SESSION_SECRET_KEY == "session-secret-from-file"
