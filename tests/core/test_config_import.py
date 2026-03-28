from __future__ import annotations

import os
import subprocess
import sys


def _import_config_with_env(overrides: dict[str, str]) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    env["PYTHONPATH"] = os.getcwd()
    env.update(overrides)

    return subprocess.run(
        [sys.executable, "-c", "import app.core.config"],
        cwd=os.getcwd(),
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )


def test_config_module_imports_when_mysql_bootstrap_flag_is_present() -> None:
    result = _import_config_with_env({"MYSQL_BOOTSTRAP_FROM_JSON": "false"})

    assert result.returncode == 0, result.stderr


def test_config_module_imports_when_debug_is_release_string() -> None:
    result = _import_config_with_env({"DEBUG": "release"})

    assert result.returncode == 0, result.stderr
