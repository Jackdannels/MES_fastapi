from typing import Optional

from pydantic import field_validator
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
    STORAGE_BACKEND: str = "json"

    MYSQL_HOST: str = "127.0.0.1"
    MYSQL_PORT: int = 3306
    MYSQL_USER: str = "root"
    MYSQL_PASSWORD: str = ""
    MYSQL_DATABASE: str = "mes_single_branch"
    MYSQL_BOOTSTRAP_FROM_JSON: bool = True

    DM_DSN: Optional[str] = None
    DM_HOST: str = "127.0.0.1"
    DM_PORT: int = 5236
    DM_USER: str = "SYSDBA"
    DM_PASSWORD: str = "SYSDBA"
    DM_DATABASE: str = "MES"

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    @field_validator("DEBUG", mode="before")
    @classmethod
    def normalize_debug_aliases(cls, value: object) -> object:
        if isinstance(value, str):
            normalized = value.strip().lower()
            if normalized in {"release", "production", "prod"}:
                return False
            if normalized in {"debug", "development", "dev"}:
                return True
        return value


settings = Settings()
