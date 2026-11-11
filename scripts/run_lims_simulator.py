"""Start the local LIMS simulator with the same connection file as MES."""
import argparse
import os
from pathlib import Path
import subprocess
import sys

from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parents[1]
CONNECTION_KEYS = {
    "RABBITMQ_URL", "RABBITMQ_COMMAND_EXCHANGE", "RABBITMQ_INTAKE_ROUTING_KEY",
    "LIMS_MES_BASE_URL", "LIMS_HTTP_TOKEN", "LIMS_SEQUENCE_PATH", "LIMS_INBOX_PATH",
}


def connection_environment(base, file_values):
    # Do not copy database or administrator credentials from the shared file.
    return {**base, **{key: value for key, value in file_values.items()
                      if key in CONNECTION_KEYS and value is not None}}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8900)
    parser.add_argument("--env-file", type=Path, default=ROOT / ".env")
    args = parser.parse_args()
    environment = connection_environment(os.environ, dotenv_values(args.env_file))
    return subprocess.call([sys.executable, "-m", "uvicorn", "tools.lims_simulator.app:app",
                            "--host", args.host, "--port", str(args.port)], cwd=ROOT, env=environment)


if __name__ == "__main__":
    raise SystemExit(main())
