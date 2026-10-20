"""Export a quiesced portable Compose deployment for native Windows restore."""
from __future__ import annotations

import argparse
import base64
from contextlib import redirect_stderr, redirect_stdout
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import subprocess
import sys
import traceback
import urllib.request

PROGRAM = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROGRAM))


def docker(args, **kwargs):
    kwargs.setdefault("timeout", 60)
    result = subprocess.run(["docker", *map(str, args)], capture_output=True, encoding="utf-8", errors="replace",
                            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0), **kwargs)
    if result.returncode:
        raise RuntimeError("Docker export command failed: " + result.stderr[-1500:])
    return result.stdout


def assert_no_active_runs(cursor):
    from app.core.mysql_storage_status import EXPERIMENT_RUNNING_STATUSES
    statuses = sorted({*EXPERIMENT_RUNNING_STATUSES, "实验准备就绪", "running", "paused", "pausing", "resuming", "stopping"})
    cursor.execute("SELECT COUNT(*) FROM biz_experiment_run WHERE run_status IN (" + ",".join(["%s"] * len(statuses)) + ")", statuses)
    if cursor.fetchone()[0]:
        raise ValueError("There are active/paused/prepared experiments; complete the maintenance handover before exporting")


def compose_arguments(deployment, environment_file):
    deployment, environment_file = Path(deployment).resolve(), Path(environment_file).resolve()
    for path in (deployment / "compose.portable.yml", deployment / "compose.portable.simulators.yml", environment_file):
        if not path.is_file():
            raise ValueError(f"Docker deployment input was not found: {path}")
    return ["compose", "--env-file", str(environment_file), "-f", str(deployment / "compose.portable.yml"),
            "-f", str(deployment / "compose.portable.simulators.yml"), "--profile", "simulators"]


def assert_empty_queues(request):
    with urllib.request.urlopen(request, timeout=10) as response:
        queues = json.load(response)
    if any((queue.get("messages") or 0) or (queue.get("messages_unacknowledged") or 0) for queue in queues):
        raise ValueError("Message queues are not empty. Finish message processing before exporting")


def export(deployment, environment_file, output, leave_stopped=False, stop_deployment=False):
    from scripts.deploy.portable_data import inventory, verify, sqlite_snapshot
    import pymysql
    deployment, output = Path(deployment).resolve(), Path(output).resolve()
    if stop_deployment and not leave_stopped:
        raise ValueError("Stopping the complete deployment requires --leave-stopped")
    if output.exists():
        raise ValueError("Export output directory must not exist")
    if output.is_relative_to(PROGRAM) or output.is_relative_to(deployment):
        raise ValueError("Export backup must be outside the program and source deployment directories")
    compose = compose_arguments(deployment, environment_file)
    print("Checking Docker deployment, message queues and active experiments...", flush=True)
    config = json.loads(docker(compose + ["config", "--format", "json"]))
    services = config["services"]
    required = ("api", "web", "lims-simulator", "upper-simulator")
    running = set(docker(compose + ["ps", "--status", "running", "--services"]).split())
    if not all(name in running for name in required):
        raise ValueError("Export expects the complete demo deployment running; inspect partial service state before proceeding")
    mq = services["rabbitmq"]["environment"]
    admin_port = next(port["published"] for port in services["rabbitmq"]["ports"] if int(port["target"]) == 15672)
    token = base64.b64encode((mq["RABBITMQ_DEFAULT_USER"] + ":" + mq["RABBITMQ_DEFAULT_PASS"]).encode()).decode()
    req = urllib.request.Request(f"http://127.0.0.1:{admin_port}/api/queues", headers={"Authorization": "Basic " + token})
    assert_empty_queues(req)
    values = services["mysql"]["environment"]
    port = int(services["mysql"]["ports"][0]["published"])
    db = values["MYSQL_DATABASE"]
    connection_args = dict(host="127.0.0.1", port=port, user="root", password=values["MYSQL_ROOT_PASSWORD"], database=db,
                           charset="utf8mb4", connect_timeout=10)
    with pymysql.connect(**connection_args) as connection:
        with connection.cursor() as cursor:
            assert_no_active_runs(cursor)
    stopped = False
    verified = False
    try:
        print("Stopping Docker business services for a consistent backup...", flush=True)
        # A failed Compose stop can already have stopped some containers.
        stopped = True
        docker(compose + ["stop", *required], timeout=120)
        assert_empty_queues(req)
        output.mkdir(parents=True)
        with pymysql.connect(**connection_args) as connection:
            with connection.cursor() as cursor:
                assert_no_active_runs(cursor)
                cursor.execute("SELECT table_name FROM information_schema.tables WHERE table_schema=%s", (db,))
                tables = [row[0] for row in cursor.fetchall()]
                counts = {}
                import re
                for table in tables:
                    if not re.fullmatch(r"[A-Za-z0-9_]+", table):
                        raise ValueError("Unexpected source table name")
                    cursor.execute(f"SELECT COUNT(*) FROM `{table}`")
                    counts[table] = cursor.fetchone()[0]
                cursor.execute("SELECT version,checksum,success FROM schema_migrations ORDER BY version")
                migrations = cursor.fetchall()
        env = {**os.environ, "MYSQL_PWD": values["MYSQL_ROOT_PASSWORD"]}
        print("Exporting MySQL, reports and LIMS data...", flush=True)
        dump = subprocess.run([str(PROGRAM / "runtime/mysql/bin/mysqldump.exe"), "--no-defaults", "--host=127.0.0.1",
                        f"--port={port}", "--user=root", "--single-transaction", "--quick", "--routines", "--triggers",
                        "--events", "--hex-blob", "--no-tablespaces", "--set-gtid-purged=OFF",
                        f"--result-file={output / 'database.sql'}", db], env=env, capture_output=True,
                        encoding="utf-8", errors="replace", timeout=1800,
                        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        if dump.returncode:
            raise RuntimeError("MySQL data export failed: " + dump.stderr[-1500:].replace(values["MYSQL_ROOT_PASSWORD"], "[redacted]"))
        for name, folder, path in (("api", "reports", "/data/reports"), ("lims-simulator", "lims-source", "/data/lims"),
                                    ("api", "runtime-source", "/data/runtime")):
            container = docker(compose + ["ps", "-a", "-q", name]).strip()
            if not container or "\n" in container:
                raise ValueError("Unexpected source container selection")
            target = output / folder
            target.mkdir()
            docker(["cp", container + ":" + path + "/.", str(target)], timeout=120)
        # Rebuild standalone SQLite files, including any committed WAL data.
        for name in ("task-sequence.sqlite3", "interactions.sqlite3", "communication.sqlite3"):
            sqlite_snapshot(output / "lims-source" / name, output / "lims" / name)
        import shutil
        scratch = (output / "lims-source").resolve()
        if scratch.parent != output:
            raise ValueError("Invalid SQLite staging directory")
        shutil.rmtree(scratch)
        manifest = dict(format="mes-portable-data", format_version=1, consistency="quiesced",
                        created_at_utc=datetime.now(timezone.utc).isoformat(), source_database=db,
                        source_report_path="/data/reports", source_compose_project=config["name"],
                        source_table_counts=counts, schema_migrations=migrations, files=inventory(output))
        (output / "data-manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
        verify(output)
        verified = True
        print(f"Docker data export checksums and SQLite integrity verified: {output}", flush=True)
        if stop_deployment:
            print("Stopping the complete source Compose deployment; containers, images and volumes are retained...", flush=True)
            docker(compose + ["stop"], timeout=180)
            print("Docker source deployment stopped. Native installation may now use its ports.", flush=True)
    finally:
        # Failed or partial exports must not strand the old business services.
        # After a verified cutover backup, keep Docker stopped even if its final
        # infrastructure stop failed; a valid snapshot is already available.
        if stopped and (not verified or not leave_stopped):
            print("Restoring the previously running Docker services...", flush=True)
            docker(compose + ["up", "-d", "--no-build", "--pull", "never", "--wait", "--wait-timeout", "240", *sorted(running)], timeout=300)
            print("Docker services restored.", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--deployment", type=Path, required=True)
    parser.add_argument("--environment-file", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--leave-stopped", action="store_true")
    parser.add_argument("--stop-deployment", action="store_true", help="After verification, stop the source Compose project without deleting containers or volumes")
    parser.add_argument("--log-file", type=Path, help="Write progress and errors to a new log file outside the backup directory")
    args = parser.parse_args()
    if args.log_file:
        if args.log_file.resolve().is_relative_to(args.output.resolve()):
            parser.error("The log file must be outside the backup directory")
        args.log_file.parent.mkdir(parents=True, exist_ok=True)
        with args.log_file.open("x", encoding="utf-8", buffering=1) as log:
            with redirect_stdout(log), redirect_stderr(log):
                try:
                    export(args.deployment, args.environment_file, args.output, args.leave_stopped, args.stop_deployment)
                except Exception:
                    traceback.print_exc()
                    return 1
    else:
        export(args.deployment, args.environment_file, args.output, args.leave_stopped, args.stop_deployment)
    return 0


if __name__ == "__main__":
    sys.exit(main())
