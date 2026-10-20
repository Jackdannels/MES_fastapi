"""Foreground service process using the package's private Python environment."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import socket
import sys
import time


def configure(path: Path, service: str):
    config = json.loads(path.read_text(encoding="utf-8-sig"))
    environment = config["environment"]
    # Each process receives only its own integration configuration. LIMS and the
    # device simulator must never inherit database/admin credentials.
    if service == "lims":
        keys = {"RABBITMQ_URL", "LIMS_MES_BASE_URL", "LIMS_HTTP_TOKEN", "LIMS_SEQUENCE_PATH", "LIMS_INBOX_PATH"}
    elif service == "upper":
        keys = {"MQTT_HOST", "MQTT_PORT", "MQTT_USERNAME", "MQTT_PASSWORD", "MQTT_TOPIC_PREFIX", "SIMULATOR_AUTO_CONNECT"}
    else:
        keys = set(environment) - {"MYSQL_MIGRATION_USER", "MYSQL_MIGRATION_PASSWORD"}
    os.environ.update({key: str(environment[key]) for key in keys if key in environment})
    os.environ["PYTHONUTF8"] = "1"
    os.environ["PYTHONIOENCODING"] = "utf-8"
    return config


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True, type=Path)
    parser.add_argument("--service", choices=("api", "lims", "upper"), required=True)
    args = parser.parse_args()
    config = configure(args.config, args.service)
    sys.path.insert(0, config["program_root"])
    # Service control dependencies signal process start, not DB readiness.
    for port in (config["ports"]["mysql"], config["ports"]["amqp"]):
        deadline = time.monotonic() + 120
        while True:
            try:
                with socket.create_connection(("127.0.0.1", port), timeout=2):
                    break
            except OSError:
                if time.monotonic() > deadline:
                    raise RuntimeError(f"Service dependency on port {port} did not become ready")
                time.sleep(1)
    import uvicorn
    applications = {"api": "app.main:app", "lims": "tools.lims_simulator.app:app", "upper": "tools.upper_computer_simulator.runtime:app"}
    uvicorn.run(applications[args.service], host="127.0.0.1", port=config["ports"][args.service],
                workers=1, proxy_headers=args.service == "api", forwarded_allow_ips="127.0.0.1",
                log_level="info", use_colors=False)


if __name__ == "__main__":
    main()
