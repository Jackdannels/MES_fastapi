import argparse
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from app.core.local_run import load_local_run_env


ENABLE_VIRTUAL_TERMINAL_PROCESSING = 0x0004
STD_OUTPUT_HANDLE = -11
STD_ERROR_HANDLE = -12


def enable_windows_virtual_terminal() -> bool:
    """Enable ANSI color processing for the inherited Windows console handles."""
    if sys.platform != "win32":
        return False
    try:
        import ctypes
        from ctypes import wintypes

        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel32.GetStdHandle.argtypes = [wintypes.DWORD]
        kernel32.GetStdHandle.restype = wintypes.HANDLE
        kernel32.GetConsoleMode.argtypes = [wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD)]
        kernel32.GetConsoleMode.restype = wintypes.BOOL
        kernel32.SetConsoleMode.argtypes = [wintypes.HANDLE, wintypes.DWORD]
        kernel32.SetConsoleMode.restype = wintypes.BOOL
        enabled = False
        for stream_id in (STD_OUTPUT_HANDLE, STD_ERROR_HANDLE):
            handle = kernel32.GetStdHandle(stream_id)
            mode = wintypes.DWORD()
            if handle and kernel32.GetConsoleMode(handle, ctypes.byref(mode)):
                enabled = bool(kernel32.SetConsoleMode(handle, mode.value | ENABLE_VIRTUAL_TERMINAL_PROCESSING)) or enabled
        return enabled
    except (AttributeError, OSError, ValueError):
        return False


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Run the MES FastAPI app with .env values overriding inherited environment variables. "
            "The backend runs in API-only mode by default; set SERVE_WEB_APP=true in the env file "
            "if you need FastAPI to serve frontend/dist for compatibility."
        ),
    )
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--reload", action="store_true")
    parser.add_argument(
        "--no-use-colors",
        action="store_true",
        help="Disable ANSI colors in Uvicorn output.",
    )
    parser.add_argument(
        "--env-file",
        default=".env",
        help="Path to the env file. Use SERVE_WEB_APP=true there to enable compatibility web hosting.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    env = load_local_run_env(REPO_ROOT / args.env_file)
    if not args.no_use_colors:
        enable_windows_virtual_terminal()
        env["PYTHONUTF8"] = "1"
        env["PYTHONIOENCODING"] = "utf-8"
    command = [
        sys.executable,
        "-m",
        "uvicorn",
        "app.main:app",
        "--host",
        args.host,
        "--port",
        str(args.port),
    ]
    if args.reload:
        command.append("--reload")
    if args.no_use_colors:
        command.append("--no-use-colors")
    return subprocess.call(command, cwd=REPO_ROOT, env=env)


if __name__ == "__main__":
    raise SystemExit(main())
