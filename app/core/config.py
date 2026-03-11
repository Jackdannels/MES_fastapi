from typing import Optional

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    APP_NAME: str = "MES"
    DEBUG: bool = False
    SERVE_WEB_APP: bool = False
    DEMO_USER: Optional[str] = None
    DEMO_PASSWORD: Optional[str] = None
    SESSION_COOKIE_NAME: str = "mes_session"
    SESSION_COOKIE_SECURE: Optional[bool] = None
    SESSION_SECRET_KEY: Optional[str] = None
    SESSION_IDLE_TIMEOUT_MINUTES: int = 30
    SESSION_MAX_AGE_HOURS: int = 8
    FRONTEND_ORIGINS: str = "http://127.0.0.1:5173,http://localhost:5173"

    DM_DSN: Optional[str] = None
    DM_HOST: str = "127.0.0.1"
    DM_PORT: int = 5236
    DM_USER: str = "SYSDBA"
    DM_PASSWORD: str = "SYSDBA"
    DM_DATABASE: str = "MES"

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")


settings = Settings()
