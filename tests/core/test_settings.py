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
