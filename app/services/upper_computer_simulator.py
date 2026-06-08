from __future__ import annotations

import json
import subprocess
import sys
import threading
import time
import webbrowser
from pathlib import Path
from typing import Any
from urllib import parse
from urllib import error, request

from app.core.config import Settings


_opened_simulator_page_lock = threading.RLock()
_opened_simulator_page_urls: set[str] = set()


def _json_request(url: str, *, method: str = "GET", payload: dict[str, Any] | None = None, timeout: float = 2.0) -> dict[str, Any]:
    data = None
    headers = {"Accept": "application/json"}
    if payload is not None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = request.Request(url, data=data, headers=headers, method=method)
    with request.urlopen(req, timeout=timeout) as response:
        body = response.read().decode("utf-8")
    return json.loads(body) if body else {}


def _state_url(app_settings: Settings) -> str:
    return f"{str(app_settings.UPPER_COMPUTER_SIMULATOR_URL).rstrip('/')}/api/state"


def _connect_url(app_settings: Settings) -> str:
    return f"{str(app_settings.UPPER_COMPUTER_SIMULATOR_URL).rstrip('/')}/api/connect"


def _auto_mode_page_url(app_settings: Settings) -> str:
    base_url = str(app_settings.UPPER_COMPUTER_SIMULATOR_URL).rstrip("/") or "http://127.0.0.1:8899"
    parsed = parse.urlsplit(base_url)
    query = dict(parse.parse_qsl(parsed.query, keep_blank_values=True))
    query["auto"] = "1"
    path = parsed.path or "/"
    return parse.urlunsplit(parsed._replace(path=path, query=parse.urlencode(query)))


def open_simulator_page(url: str) -> None:
    webbrowser.open(url, new=1, autoraise=True)


def open_simulator_page_once(url: str, *, force: bool = False) -> bool:
    with _opened_simulator_page_lock:
        if not force and url in _opened_simulator_page_urls:
            return False
        _opened_simulator_page_urls.add(url)
    open_simulator_page(url)
    return True


def _simulator_dir(app_settings: Settings) -> Path:
    return Path(str(app_settings.UPPER_COMPUTER_SIMULATOR_DIR)).expanduser()


def _python_executable(simulator_dir: Path) -> Path:
    if sys.platform.startswith("win"):
        return simulator_dir / ".venv" / "Scripts" / "python.exe"
    return simulator_dir / ".venv" / "bin" / "python"


def _can_read_state(app_settings: Settings) -> bool:
    try:
        _json_request(_state_url(app_settings), timeout=1.0)
        return True
    except Exception:
        return False


def _start_simulator_process(app_settings: Settings) -> None:
    simulator_dir = _simulator_dir(app_settings)
    python_exe = _python_executable(simulator_dir)
    app_py = simulator_dir / "app.py"
    if not simulator_dir.exists() or not app_py.exists():
        raise RuntimeError(f"模拟上位机目录不存在或缺少 app.py：{simulator_dir}")
    if not python_exe.exists():
        raise RuntimeError(f"模拟上位机 Python 环境不存在：{python_exe}")

    creationflags = 0
    if sys.platform.startswith("win"):
        creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    subprocess.Popen(
        [
            str(python_exe),
            "-m",
            "uvicorn",
            "app:app",
            "--host",
            str(app_settings.UPPER_COMPUTER_SIMULATOR_HOST),
            "--port",
            str(app_settings.UPPER_COMPUTER_SIMULATOR_PORT),
        ],
        cwd=str(simulator_dir),
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        creationflags=creationflags,
    )


def ensure_upper_computer_simulator_auto_mode(app_settings: Settings) -> dict[str, Any]:
    if not app_settings.UPPER_COMPUTER_SIMULATOR_AUTO_ENABLE:
        return {"enabled": False, "started": False, "connected": False, "reason": "disabled"}

    started = False
    if not _can_read_state(app_settings):
        if not app_settings.UPPER_COMPUTER_SIMULATOR_AUTO_START:
            raise RuntimeError("模拟上位机未启动")
        _start_simulator_process(app_settings)
        started = True

    deadline = time.monotonic() + float(app_settings.UPPER_COMPUTER_SIMULATOR_START_TIMEOUT_SECONDS)
    while time.monotonic() < deadline:
        if _can_read_state(app_settings):
            break
        time.sleep(0.2)
    else:
        raise RuntimeError("模拟上位机启动超时")

    connect_payload = {
        "host": app_settings.MQTT_HOST,
        "port": app_settings.MQTT_PORT,
        "topicPrefix": app_settings.MQTT_TOPIC_PREFIX,
        "lab_code": app_settings.UPPER_COMPUTER_SIMULATOR_DEFAULT_LAB_CODE,
        "username": app_settings.MQTT_USERNAME,
        "password": app_settings.MQTT_PASSWORD,
        "auto_mode": True,
    }
    try:
        state = _json_request(_connect_url(app_settings), method="POST", payload=connect_payload, timeout=5.0)
    except error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"模拟上位机自动连接失败：{detail or exc}") from exc
    except Exception as exc:
        raise RuntimeError(f"模拟上位机自动连接失败：{exc}") from exc

    if not state.get("connected"):
        raise RuntimeError("模拟上位机已启动但 MQTT 未连接")
    config = state.get("config") if isinstance(state.get("config"), dict) else {}
    page_url = _auto_mode_page_url(app_settings)
    open_simulator_page_once(page_url, force=started)
    return {
        "enabled": True,
        "started": started,
        "connected": True,
        "auto_mode": bool(config.get("auto_mode") or config.get("autoMode")),
        "subscription": f"{str(app_settings.MQTT_TOPIC_PREFIX or 'mes/v1').strip().strip('/')}/labs/+/commands/#",
        "url": app_settings.UPPER_COMPUTER_SIMULATOR_URL,
        "page_url": page_url,
    }
