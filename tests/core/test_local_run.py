import subprocess
import sys
from pathlib import Path

from app.core.local_run import APP_ENV_KEYS, build_local_run_env
from scripts.trial_run import (
    build_trial_run_server_command,
    build_trial_run_server_env,
    should_expect_web_app,
)


def test_build_local_run_env_overrides_inherited_environment_with_dotenv_values():
    base_env = {
        "DEBUG": "release",
        "SESSION_SECRET_KEY": "machine-secret",
        "PATH": "C:\\Windows\\System32",
    }
    dotenv_values = {
        "DEBUG": "true",
        "SESSION_SECRET_KEY": "local-dev-session-secret",
        "DEMO_USER": "local-admin",
        "EMPTY_VALUE": None,
    }

    merged_env = build_local_run_env(base_env, dotenv_values)

    assert merged_env["DEBUG"] == "true"
    assert merged_env["SESSION_SECRET_KEY"] == "local-dev-session-secret"
    assert merged_env["DEMO_USER"] == "local-admin"
    assert merged_env["PATH"] == "C:\\Windows\\System32"
    assert "EMPTY_VALUE" not in merged_env


def test_build_local_run_env_drops_inherited_app_settings_when_env_file_omits_them():
    base_env = {
        "DEBUG": "release",
        "DEMO_USER": "machine-user",
        "SESSION_COOKIE_SECURE": "true",
        "SERVE_WEB_APP": "true",
        "FRONTEND_ORIGINS": "http://machine.example",
        "PATH": "C:\\Windows\\System32",
    }
    dotenv_values = {
        "DEBUG": "true",
    }

    merged_env = build_local_run_env(base_env, dotenv_values, managed_keys=APP_ENV_KEYS)

    assert merged_env["DEBUG"] == "true"
    assert "DEMO_USER" not in merged_env
    assert "SESSION_COOKIE_SECURE" not in merged_env
    assert "SERVE_WEB_APP" not in merged_env
    assert "FRONTEND_ORIGINS" not in merged_env
    assert merged_env["PATH"] == "C:\\Windows\\System32"


def test_run_local_script_help_is_invokable_from_repo_root():
    repo_root = Path(__file__).resolve().parents[2]

    result = subprocess.run(
        [sys.executable, "scripts/run_local.py", "--help"],
        cwd=repo_root,
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    assert "Run the MES FastAPI app" in result.stdout
    assert "API-only" in result.stdout
    assert "SERVE_WEB_APP=true" in result.stdout


def test_trial_run_script_help_is_invokable_from_repo_root():
    repo_root = Path(__file__).resolve().parents[2]

    result = subprocess.run(
        [sys.executable, "scripts/trial_run.py", "--help"],
        cwd=repo_root,
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    assert "Start the local server" in result.stdout
    assert "SERVE_WEB_APP" in result.stdout
    assert "404" in result.stdout


def test_build_trial_run_server_env_forces_non_secure_cookie_for_http_smoke_test():
    base_env = {"PATH": "C:\\Windows\\System32"}
    dotenv_values = {
        "DEBUG": "false",
        "SESSION_COOKIE_SECURE": "true",
    }

    server_env = build_trial_run_server_env(base_env, dotenv_values)

    assert server_env["DEBUG"] == "false"
    assert server_env["SESSION_COOKIE_SECURE"] == "false"
    assert server_env["PATH"] == "C:\\Windows\\System32"


def test_build_trial_run_server_command_uses_current_interpreter():
    command = build_trial_run_server_command(host="127.0.0.1", port=8010, env_file=".env")

    assert command[0] == sys.executable
    assert command[1:] == [
        "scripts/run_local.py",
        "--host",
        "127.0.0.1",
        "--port",
        "8010",
        "--env-file",
        ".env",
    ]


def test_should_expect_web_app_defaults_to_false():
    assert should_expect_web_app({}) is False


def test_should_expect_web_app_honors_truthy_values():
    assert should_expect_web_app({"SERVE_WEB_APP": "true"}) is True
    assert should_expect_web_app({"SERVE_WEB_APP": "1"}) is True
