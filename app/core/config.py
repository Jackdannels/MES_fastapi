from typing import Optional
from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


REPO_ROOT = Path(__file__).resolve().parents[2]
ENV_FILE = REPO_ROOT / ".env"
DEFAULT_UPPER_COMPUTER_SIMULATOR_DIR = Path.home() / "Desktop" / "MES_upper_computer_simulator"


class Settings(BaseSettings):
    APP_NAME: str = "MES"
    APP_ENV: str = "dev"
    DEBUG: bool = False
    SERVE_WEB_APP: bool = False
    DEMO_USER: Optional[str] = None
    DEMO_PASSWORD: Optional[str] = None
    SESSION_COOKIE_NAME: str = "mes_session"
    SESSION_COOKIE_SECURE: Optional[bool] = None
    SESSION_SECRET_KEY: Optional[str] = None
    SESSION_IDLE_TIMEOUT_MINUTES: int = 0
    SESSION_MAX_AGE_HOURS: int = 0
    FRONTEND_ORIGINS: str = "http://127.0.0.1:5173,http://localhost:5173"
    STORAGE_BACKEND: str = "mysql"

    MYSQL_HOST: str = "127.0.0.1"
    MYSQL_PORT: int = 3306
    MYSQL_USER: str = "root"
    MYSQL_PASSWORD: str = ""
    MYSQL_DATABASE: str = "mes_single_branch"
    MYSQL_AUTO_INIT_SCHEMA: bool = False
    MYSQL_AUTO_SEED_DEMO: bool = False
    MYSQL_POOL_SIZE: int = 20
    MYSQL_POOL_TIMEOUT_SECONDS: float = 5.0

    MQTT_ENABLED: bool = False
    MQTT_HOST: str = "127.0.0.1"
    MQTT_PORT: int = 1883
    MQTT_USERNAME: str = "guest"
    MQTT_PASSWORD: str = "guest"
    MQTT_QOS: int = 1
    MQTT_TOPIC_PREFIX: str = "mes/v1"

    UPPER_COMPUTER_SIMULATOR_AUTO_ENABLE: bool = False
    UPPER_COMPUTER_SIMULATOR_AUTO_START: bool = True
    UPPER_COMPUTER_SIMULATOR_DIR: str = str(DEFAULT_UPPER_COMPUTER_SIMULATOR_DIR)
    UPPER_COMPUTER_SIMULATOR_HOST: str = "127.0.0.1"
    UPPER_COMPUTER_SIMULATOR_PORT: int = 8899
    UPPER_COMPUTER_SIMULATOR_URL: str = "http://127.0.0.1:8899"
    UPPER_COMPUTER_SIMULATOR_DEFAULT_LAB_CODE: str = "LAB_SALT"
    UPPER_COMPUTER_SIMULATOR_START_TIMEOUT_SECONDS: float = 8.0

    DM_DSN: Optional[str] = None
    DM_HOST: str = "127.0.0.1"
    DM_PORT: int = 5236
    DM_USER: str = "SYSDBA"
    DM_PASSWORD: str = "SYSDBA"
    DM_DATABASE: str = "MES"

    model_config = SettingsConfigDict(env_file=str(ENV_FILE), env_file_encoding="utf-8")

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

    @field_validator("APP_ENV", mode="before")
    @classmethod
    def normalize_app_env(cls, value: object) -> str:
        normalized = str(value or "dev").strip().lower()
        if normalized in {"development", "local"}:
            return "dev"
        if normalized in {"production", "release"}:
            return "prod"
        if normalized in {"testing"}:
            return "test"
        return normalized or "dev"

    @field_validator("STORAGE_BACKEND", mode="before")
    @classmethod
    def normalize_storage_backend(cls, value: object) -> str:
        return str(value or "mysql").strip().lower() or "mysql"

    @field_validator("UPPER_COMPUTER_SIMULATOR_DIR", mode="before")
    @classmethod
    def normalize_upper_computer_simulator_dir(cls, value: object) -> str:
        normalized = str(value or "").strip()
        return normalized or str(DEFAULT_UPPER_COMPUTER_SIMULATOR_DIR)


settings = Settings()
