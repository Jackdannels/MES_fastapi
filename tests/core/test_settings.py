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
