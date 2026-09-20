from typing import Optional
from pathlib import Path

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


REPO_ROOT = Path(__file__).resolve().parents[2]
ENV_FILE = REPO_ROOT / ".env"
DEFAULT_UPPER_COMPUTER_SIMULATOR_DIR = Path.home() / "Desktop" / "MES_upper_computer_simulator"
DOCKER_SECRETS_DIR = Path("/run/secrets")


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
    FRONTEND_ORIGINS: str = "http://192.168.110.15:5173,http://127.0.0.1:5173,http://localhost:5173"
    # Empty/"auto" derives test-data share links from the browser's current
    # same-host Origin (or the request URL). Production may set an explicit URL.
    TEST_DATA_PUBLIC_BASE_URL: str = ""
    TEST_DATA_SAVE_PATH: Optional[str] = None
    # Empty disables the optional secondary file backup. Never replaces savePath.
    TEST_DATA_BACKUP_PATH: str = ""
    TEST_DATA_BACKUP_STATE_PATH: str = str(REPO_ROOT / ".runtime" / "test-data-backup.sqlite3")
    TEST_DATA_BACKUP_INTERVAL_SECONDS: float = Field(default=30, ge=1, le=86400)
    TEST_DATA_BACKUP_TIMEOUT_SECONDS: float = Field(default=120, ge=1, le=3600)
    TEST_DATA_BACKUP_BATCH_SIZE: int = Field(default=50, ge=1, le=1000)

    @field_validator("TEST_DATA_BACKUP_PATH", "TEST_DATA_BACKUP_STATE_PATH")
    @classmethod
    def validate_test_data_backup_paths(cls, value: str, info) -> str:
        value = value.strip()
        if not value and info.field_name == "TEST_DATA_BACKUP_PATH":
            return ""
        if not Path(value).is_absolute():
            raise ValueError("试验数据备份路径必须是绝对路径；Windows UNC 配置请勿加引号")
        if info.field_name == "TEST_DATA_BACKUP_STATE_PATH" and value.startswith(("\\\\", "//")):
            raise ValueError("备份队列必须保存在本机，不能使用 UNC 路径")
        return value

    STORAGE_BACKEND: str = "mysql"

    MYSQL_HOST: str = "127.0.0.1"
    MYSQL_PORT: int = 3306
    MYSQL_USER: str = "root"
    MYSQL_PASSWORD: str = ""
    MYSQL_MIGRATION_USER: Optional[str] = None
    MYSQL_MIGRATION_PASSWORD: Optional[str] = None
    MYSQL_DATABASE: str = "mes_single_branch"
    MYSQL_AUTO_INIT_SCHEMA: bool = False
    MYSQL_AUTO_SEED_DEMO: bool = False
    MYSQL_POOL_SIZE: int = 20
    MYSQL_POOL_TIMEOUT_SECONDS: float = 5.0
    MYSQL_SSL_CA: Optional[str] = None
    MYSQL_SSL_CERT: Optional[str] = None
    MYSQL_SSL_KEY: Optional[str] = None
    MYSQL_SSL_VERIFY_CERT: bool = False
    MYSQL_SSL_VERIFY_IDENTITY: bool = False

    PERFORMANCE_MONITOR_ENABLED: bool = True
    PERFORMANCE_LOG_ALL_REQUESTS: bool = False
    PERFORMANCE_SLOW_REQUEST_MS: float = 500.0
    READ_SNAPSHOT_CACHE_TTL_SECONDS: float = 5.0
    READ_SNAPSHOT_CACHE_STALE_SECONDS: float = 30.0

    CAPACITY_WARN_POOL_UTILIZATION: float = 0.8
    CAPACITY_WARN_STAGING_EVENT_ITEMS: int = 20000
    CAPACITY_WARN_STAGING_EVENT_BYTES: int = 16 * 1024 * 1024
    CAPACITY_WARN_MQ_MESSAGE_ROWS: int = 500000
    CAPACITY_WARN_EXPERIMENT_EVENT_ROWS: int = 500000

    RETENTION_ENABLED: bool = True
    RETENTION_STARTUP_DELAY_SECONDS: float = 60.0
    RETENTION_INTERVAL_SECONDS: float = 3600.0
    RETENTION_BATCH_SIZE: int = 500
    RETENTION_MAX_BATCHES_PER_RUN: int = 10
    MQ_MESSAGE_LOG_RETENTION_DAYS: int = 90
    EXPERIMENT_EVENT_RETENTION_DAYS: int = 365
    STAGING_EVENT_RETENTION_DAYS: int = 365

    MQTT_ENABLED: bool = False
    MQTT_HOST: str = "127.0.0.1"
    MQTT_PORT: int = 1883
    MQTT_USERNAME: str = "guest"
    MQTT_PASSWORD: str = "guest"
    MQTT_QOS: int = 1
    MQTT_TOPIC_PREFIX: str = "mes/v1"
    MQTT_HTTP_EVENT_INGRESS_ENABLED: bool = False
    MQTT_CONNECT_TIMEOUT_SECONDS: float = 10.0
    MQTT_PUBLISH_TIMEOUT_SECONDS: float = 10.0
    MQTT_PUBLISH_SLOW_MS: float = 250.0
    TELEMETRY_DELAYED_AFTER_SECONDS: float = 5.0
    TELEMETRY_OFFLINE_AFTER_SECONDS: float = 15.0

    RABBITMQ_ENABLED: bool = False
    RABBITMQ_REQUIRED: bool = True
    RABBITMQ_URL: str = "amqp://guest:guest@127.0.0.1:5672/"
    RABBITMQ_COMMAND_EXCHANGE: str = "lims.mes.commands"
    RABBITMQ_EVENT_EXCHANGE: str = "mes.lims.events"
    RABBITMQ_DLX_EXCHANGE: str = "lims.mes.dlx"
    RABBITMQ_INTAKE_QUEUE: str = "mes.external-intake.v1"
    RABBITMQ_INTAKE_ROUTING_KEY: str = "lims.external-intake.created.v1"
    RABBITMQ_STATUS_QUEUE: str = "lims.external-intake-status.v1"
    RABBITMQ_PREFETCH_COUNT: int = 10

    # Empty disables delivery, but never discards pending notifications.
    LIMS_HTTP_CALLBACK_URL: str = ""
    # Read-only peer status endpoint; must return {"connected": true|false}.
    LIMS_HEALTH_URL: str = ""
    LIMS_HTTP_TOKEN: str = ""
    LIMS_DATA_PUBLIC_BASE_URL: str = ""
    LIMS_HTTP_TIMEOUT_SECONDS: float = Field(default=5.0, gt=0, le=60)
    LIMS_COMMUNICATION_ENABLED: bool = True
    LIMS_COMMUNICATION_URL: str = ""
    # Consumed by the simulator; accepted here so a shared .env remains valid.
    LIMS_MES_BASE_URL: str = "http://127.0.0.1:8000"
    LIMS_COMMUNICATION_INTERVAL_SECONDS: float = Field(default=60.0, ge=1, le=3600)
    # Temporary acceptance policy requested by the user (not ten minutes).
    LIMS_COMMUNICATION_RETRY_SECONDS: float = Field(default=10.0, ge=1, le=3600)

    @field_validator("LIMS_DATA_PUBLIC_BASE_URL")
    @classmethod
    def validate_lims_data_url(cls, value: str) -> str:
        from urllib.parse import urlsplit
        value = value.strip().rstrip("/")
        if value:
            parsed = urlsplit(value)
            _port = parsed.port
            if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
                raise ValueError("LIMS data base must be an explicit HTTP(S) URL without credentials, query or fragment")
        return value

    @field_validator("LIMS_HTTP_CALLBACK_URL", "LIMS_HEALTH_URL", "LIMS_COMMUNICATION_URL")
    @classmethod
    def validate_lims_callback_url(cls, value: str) -> str:
        from urllib.parse import urlsplit
        value = value.strip()
        if value:
            parsed = urlsplit(value)
            if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password or parsed.fragment:
                raise ValueError("LIMS callback must be an HTTP(S) URL without credentials or fragment")
        return value

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


# Docker/Compose secrets are mounted as files named after each setting. Avoid
# probing a nonexistent Linux path (and emitting warnings) during local runs.
settings = Settings(_secrets_dir=DOCKER_SECRETS_DIR if DOCKER_SECRETS_DIR.is_dir() else None)
