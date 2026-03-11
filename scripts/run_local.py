import argparse
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from app.core.local_run import load_local_run_env


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run the MES FastAPI app with .env values overriding inherited environment variables.",
    )
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--reload", action="store_true")
    parser.add_argument("--env-file", default=".env")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    env = load_local_run_env(REPO_ROOT / args.env_file)
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
    return subprocess.call(command, cwd=REPO_ROOT, env=env)


if __name__ == "__main__":
    raise SystemExit(main())
