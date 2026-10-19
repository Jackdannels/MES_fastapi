"""Snapshot native MES data and prepare a fresh Linux container deployment.

Backup uses the source Python environment. Verify/rebase/restore-files use the API
image, so the destination PC only needs Docker and PowerShell.
"""
from __future__ import annotations

import argparse
from contextlib import closing
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path, PurePosixPath, PureWindowsPath
import re
import shutil
import socket
import sqlite3
import subprocess
import sys


def digest(path: Path) -> str:
    result = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            result.update(chunk)
    return result.hexdigest()


def relative_path(value: str) -> Path:
    parsed = PureWindowsPath(value)
    if (not value or parsed.drive or parsed.root or ".." in parsed.parts
            or any(":" in part for part in parsed.parts)):
        raise ValueError(f"Unsafe relative path: {value}")
    return Path(*parsed.parts)


def regular_files(root: Path):
    if root.is_symlink() or (hasattr(root, "is_junction") and root.is_junction()):
        raise ValueError(f"Linked directory is not supported: {root}")
    for path in sorted(root.rglob("*")):
        if path.is_symlink() or (hasattr(path, "is_junction") and path.is_junction()):
            raise ValueError(f"Linked file or directory is not supported: {path}")
        if path.is_file():
            yield path


def inventory(root: Path) -> list[dict]:
    return [{"path": path.relative_to(root).as_posix(), "bytes": path.stat().st_size,
             "sha256": digest(path)} for path in regular_files(root) if path.name != "data-manifest.json"]


def verify(root: Path) -> dict:
    root = root.resolve()
    manifest = json.loads((root / "data-manifest.json").read_text(encoding="utf-8"))
    if manifest.get("format") != "mes-portable-data" or manifest.get("format_version") != 1:
        raise ValueError("Unsupported data backup format")
    declared = {}
    folded = set()
    for entry in manifest["files"]:
        name = entry["path"]
        if "\\" in name or PurePosixPath(name).is_absolute():
            raise ValueError("Backup requires portable relative paths")
        rel = relative_path(name)
        if name.casefold() in folded:
            raise ValueError("Duplicate or case-colliding backup path")
        folded.add(name.casefold())
        path = root / rel
        if not path.resolve().is_relative_to(root) or not path.is_file():
            raise ValueError(f"Missing or escaped backup file: {name}")
        if path.stat().st_size != entry["bytes"] or digest(path) != entry["sha256"]:
            raise ValueError(f"Backup checksum mismatch: {name}")
        declared[name] = entry
    actual = {item["path"] for item in inventory(root)}
    if actual != set(declared) or "database.sql" not in declared:
        raise ValueError("Backup file inventory mismatch")
    for name in ("task-sequence.sqlite3", "interactions.sqlite3", "communication.sqlite3"):
        if f"lims/{name}" not in declared:
            raise ValueError(f"Missing LIMS data file: {name}")
    for name in declared:
        if name.endswith(".sqlite3"):
            with closing(sqlite3.connect((root / name).as_uri() + "?mode=ro&immutable=1", uri=True)) as connection:
                if connection.execute("PRAGMA quick_check").fetchone()[0] != "ok":
                    raise ValueError(f"SQLite integrity failure: {name}")
    return manifest


def sqlite_snapshot(source: Path, target: Path):
    target.parent.mkdir(parents=True, exist_ok=True)
    with closing(sqlite3.connect(source.resolve().as_uri() + "?mode=ro", uri=True)) as src:
        with closing(sqlite3.connect(target)) as dst:
            src.backup(dst)
            dst.execute("PRAGMA journal_mode=DELETE").fetchone()


def copy_stable(source: Path, target: Path):
    target.parent.mkdir(parents=True, exist_ok=True)
    before = source.stat()
    before_digest = digest(source)
    shutil.copy2(source, target)
    after = source.stat()
    if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns) or digest(target) != before_digest or digest(source) != before_digest:
        raise ValueError(f"Source file changed during backup: {source}")


def connect(settings):
    import pymysql
    return pymysql.connect(host=settings.MYSQL_HOST, port=settings.MYSQL_PORT,
                           user=settings.MYSQL_USER, password=settings.MYSQL_PASSWORD,
                           database=settings.MYSQL_DATABASE, charset="utf8mb4",
                           connect_timeout=10, read_timeout=60)


def backup(destination: Path, mysql_bin: Path | None, quiesced: bool):
    project = Path(__file__).resolve().parents[2]
    sys.path.insert(0, str(project))
    from app.core.config import settings
    if destination.exists():
        raise ValueError("Backup directory already exists")
    if quiesced:
        for port in (8000, 8899, 8900):
            with socket.socket() as probe:
                probe.settimeout(1)
                if probe.connect_ex(("127.0.0.1", port)) == 0:
                    raise ValueError(f"Source service on port {port} must be stopped for a quiesced backup")
    native = mysql_bin or Path(r"C:\Program Files\MySQL\MySQL Server 9.6\bin\mysqldump.exe")
    if not native.is_file():
        raise ValueError("mysqldump was not found; specify --mysqldump")
    with connect(settings) as connection:
        with connection.cursor() as cursor:
            cursor.execute("SELECT payload_json FROM app_storage_snapshot WHERE storage_key=%s", ("mes.test_data_settings",))
            row = cursor.fetchone()
            records = json.loads(row[0]) if row else []
            reports = Path(records[0]["savePath"]) if records else Path(settings.TEST_DATA_SAVE_PATH or Path.home() / "Desktop" / "MES试验数据")
            cursor.execute("SELECT version, checksum, success FROM schema_migrations ORDER BY version")
            migrations = cursor.fetchall()
            cursor.execute("SELECT table_name FROM information_schema.tables WHERE table_schema=%s", (settings.MYSQL_DATABASE,))
            tables = [row[0] for row in cursor.fetchall()]
            counts = {}
            for table in tables:
                if not re.fullmatch(r"[A-Za-z0-9_]+", table):
                    raise ValueError("Unexpected database table name")
                cursor.execute(f"SELECT COUNT(*) FROM `{table}`")
                counts[table] = cursor.fetchone()[0]
    if not reports.is_dir():
        raise ValueError(f"Report directory does not exist: {reports}")
    # Refuse a recursive backup of the backup itself.
    if destination.resolve().is_relative_to(reports.resolve()):
        raise ValueError("Backup directory must be outside the report directory")
    destination.mkdir(parents=True)
    environment = {**os.environ, "MYSQL_PWD": settings.MYSQL_PASSWORD}
    command = [str(native), f"--host={settings.MYSQL_HOST}", f"--port={settings.MYSQL_PORT}",
               f"--user={settings.MYSQL_USER}", "--single-transaction", "--quick", "--routines",
               "--triggers", "--events", "--hex-blob", "--set-gtid-purged=OFF", "--no-tablespaces",
               f"--result-file={destination / 'database.sql'}", settings.MYSQL_DATABASE]
    subprocess.run(command, env=environment, check=True)
    for source in regular_files(reports):
        copy_stable(source, destination / "reports" / source.relative_to(reports))
    for name in ("task-sequence.sqlite3", "interactions.sqlite3", "communication.sqlite3"):
        source = project / "tools" / "lims_simulator" / "data" / name
        if not source.is_file():
            raise ValueError(f"LIMS SQLite file is missing: {source}")
        sqlite_snapshot(source, destination / "lims" / name)
    runtime = Path(settings.TEST_DATA_BACKUP_STATE_PATH)
    if runtime.exists():
        sqlite_snapshot(runtime, destination / "runtime-source" / runtime.name)
    local_settings = runtime.with_suffix(".settings.json")
    if local_settings.exists():
        copy_stable(local_settings, destination / "runtime-source" / local_settings.name)
    manifest = {"format": "mes-portable-data", "format_version": 1,
                "created_at_utc": datetime.now(timezone.utc).isoformat(),
                "consistency": "quiesced" if quiesced else "live_snapshot",
                "source_database": settings.MYSQL_DATABASE, "source_report_path": str(reports),
                "schema_migrations": migrations, "source_table_counts": counts,
                "files": inventory(destination)}
    (destination / "data-manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    verify(destination)
    print(f"Data backup verified ({manifest['consistency']}): {destination}")


def restore_files(root: Path):
    verify(root)
    targets = [(root / "reports", Path("/data/reports")), (root / "lims", Path("/data/lims"))]
    for _source, target in targets:
        target.mkdir(parents=True, exist_ok=True)
        if any(target.iterdir()):
            raise ValueError(f"Restore requires an empty data volume: {target}")
    for source, target in targets:
        if source.exists():
            shutil.copytree(source, target, dirs_exist_ok=True)
        for path in [target, *target.rglob("*")]:
            os.chown(path, 10001, 10001)
    # Native Windows backup destinations and queues are preserved in the backup;
    # the target starts its own ledger after a destination is configured there.
    print("Report and LIMS data restored to empty volumes")


def assert_empty_target():
    from app.core.config import settings
    if not re.fullmatch(r"[A-Za-z0-9_]+", settings.MYSQL_DATABASE):
        raise ValueError("Invalid target database name")
    with connect(settings) as connection:
        with connection.cursor() as cursor:
            cursor.execute("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=%s", (settings.MYSQL_DATABASE,))
            if cursor.fetchone()[0]:
                raise ValueError("Restore requires an empty target database; existing data was not overwritten")
    print("Target database is empty")


def rebase_export(record: dict, report_root: Path) -> dict:
    record = dict(record)
    if record.get("filePath"):
        relative = relative_path(str(record.get("relativePath") or ""))
        target = report_root / relative
        if not target.resolve().is_relative_to(report_root.resolve()):
            raise ValueError("Report path escaped target report directory")
        if record.get("status") == "success" and not target.is_file():
            raise ValueError(f"Historical report is missing: {relative}")
        record["filePath"] = str(target)
        record["relativePath"] = relative.as_posix()
    return record


def rebase(root: Path):
    manifest = verify(root)
    from app.core.config import settings
    target = Path("/data/reports")
    with connect(settings) as connection:
        with connection.cursor() as cursor:
            # Validate restore counts before any application/background worker starts.
            if manifest["consistency"] == "quiesced":
                for table, expected in manifest["source_table_counts"].items():
                    if not re.fullmatch(r"[A-Za-z0-9_]+", table):
                        raise ValueError("Invalid table name in backup")
                    cursor.execute(f"SELECT COUNT(*) FROM `{table}`")
                    if cursor.fetchone()[0] != expected:
                        raise ValueError(f"Restored table count mismatch: {table}")
            cursor.execute("SELECT export_key, payload_json FROM biz_test_data_export")
            for key, payload in cursor.fetchall():
                record = rebase_export(json.loads(payload), target)
                cursor.execute("UPDATE biz_test_data_export SET file_path=%s, relative_path=%s, payload_json=%s WHERE export_key=%s",
                               (record.get("filePath"), record.get("relativePath"), json.dumps(record, ensure_ascii=False), key))
            cursor.execute("SELECT payload_json FROM app_storage_snapshot WHERE storage_key=%s", ("mes.test_data_exports",))
            row = cursor.fetchone()
            if row:
                records = [rebase_export(item, target) for item in json.loads(row[0])]
                cursor.execute("UPDATE app_storage_snapshot SET payload_json=%s WHERE storage_key=%s",
                               (json.dumps(records, ensure_ascii=False), "mes.test_data_exports"))
            records = [{"savePath": str(target), "updatedAt": datetime.now(timezone.utc).isoformat()}]
            cursor.execute("INSERT INTO app_storage_snapshot(storage_key,payload_json) VALUES(%s,%s) ON DUPLICATE KEY UPDATE payload_json=VALUES(payload_json)",
                           ("mes.test_data_settings", json.dumps(records)))
        connection.commit()
    print("Database counts verified; report paths converted for the container")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("backup", "verify", "restore-files", "rebase", "assert-empty"))
    parser.add_argument("--directory", required=True, type=Path)
    parser.add_argument("--mysqldump", type=Path)
    parser.add_argument("--quiesced", action="store_true")
    args = parser.parse_args()
    if args.action == "backup":
        backup(args.directory.resolve(), args.mysqldump, args.quiesced)
    elif args.action == "verify":
        manifest = verify(args.directory)
        print(f"Backup checksums and SQLite integrity verified ({manifest['consistency']})")
    elif args.action == "restore-files":
        restore_files(args.directory)
    elif args.action == "assert-empty":
        assert_empty_target()
    else:
        rebase(args.directory)


if __name__ == "__main__":
    main()
