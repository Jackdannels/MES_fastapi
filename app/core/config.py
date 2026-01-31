from typing import Optional

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    APP_NAME: str = "MES"
    DEBUG: bool = True

    DM_DSN: Optional[str] = None
    DM_HOST: str = "127.0.0.1"
    DM_PORT: int = 5236
    DM_USER: str = "SYSDBA"
    DM_PASSWORD: str = "SYSDBA"
    DM_DATABASE: str = "MES"

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")


settings = Settings()
