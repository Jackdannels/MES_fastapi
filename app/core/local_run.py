import os
from pathlib import Path
from typing import Iterable, Mapping

from dotenv import dotenv_values

APP_ENV_KEYS = {
    "APP_NAME",
    "DEBUG",
    "SERVE_WEB_APP",
    "DEMO_USER",
    "DEMO_PASSWORD",
    "SESSION_COOKIE_NAME",
    "SESSION_COOKIE_SECURE",
    "SESSION_SECRET_KEY",
    "SESSION_IDLE_TIMEOUT_MINUTES",
    "SESSION_MAX_AGE_HOURS",
    "FRONTEND_ORIGINS",
    "STORAGE_BACKEND",
    "MYSQL_HOST",
    "MYSQL_PORT",
    "MYSQL_USER",
    "MYSQL_PASSWORD",
    "MYSQL_DATABASE",
    "MYSQL_AUTO_INIT_SCHEMA",
    "MYSQL_AUTO_SEED_DEMO",
    "MQTT_ENABLED",
    "MQTT_HOST",
    "MQTT_PORT",
    "MQTT_USERNAME",
    "MQTT_PASSWORD",
    "MQTT_QOS",
    "MQTT_TOPIC_PREFIX",
    "UPPER_COMPUTER_SIMULATOR_AUTO_ENABLE",
    "UPPER_COMPUTER_SIMULATOR_AUTO_START",
    "UPPER_COMPUTER_SIMULATOR_DIR",
    "UPPER_COMPUTER_SIMULATOR_HOST",
    "UPPER_COMPUTER_SIMULATOR_PORT",
    "UPPER_COMPUTER_SIMULATOR_URL",
    "UPPER_COMPUTER_SIMULATOR_DEFAULT_LAB_CODE",
    "UPPER_COMPUTER_SIMULATOR_START_TIMEOUT_SECONDS",
    "DM_DSN",
    "DM_HOST",
    "DM_PORT",
    "DM_USER",
    "DM_PASSWORD",
    "DM_DATABASE",
}


def build_local_run_env(
    base_env: Mapping[str, str],
    env_file_values: Mapping[str, str | None],
    *,
    managed_keys: Iterable[str] = APP_ENV_KEYS,
    overrides: Mapping[str, str | None] | None = None,
) -> dict[str, str]:
    merged_env = {key: value for key, value in base_env.items() if key not in set(managed_keys)}
    for key, value in env_file_values.items():
        if value is not None:
            merged_env[key] = value
    if overrides:
        for key, value in overrides.items():
            if value is None:
                merged_env.pop(key, None)
            else:
                merged_env[key] = value
    return merged_env


def load_local_run_env(
    env_path: str | Path = ".env",
    *,
    overrides: Mapping[str, str | None] | None = None,
) -> dict[str, str]:
    return build_local_run_env(os.environ, dotenv_values(env_path), overrides=overrides)
