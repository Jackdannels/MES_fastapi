"""One-way report backup with a local, restart-safe queue; no business DB writes.

Run only in the isolated worker, never on the report-generation/request thread.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
from pathlib import Path, PureWindowsPath
import sqlite3
import tempfile
import time
from typing import Any

logger = logging.getLogger(__name__)


def _digest(path: Path) -> str:
    result = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            result.update(chunk)
    return result.hexdigest()


def _no_links(path: Path) -> None:
    for part in (path, *path.parents):
        if part.is_symlink() or (hasattr(part, "is_junction") and part.is_junction()):
            raise ValueError("备份路径不能经过符号链接或目录联接")


def _relative(value: str) -> Path:
    # Export metadata may use Windows separators even in a Linux deployment.
    parsed = PureWindowsPath(value)
    if (not value or parsed.is_absolute() or parsed.drive or parsed.root
            or any(p in {"..", "."} or ":" in p for p in parsed.parts)
            or parsed.suffix.lower() != ".pdf"):
        raise ValueError("报告相对路径无效")
    return Path(*parsed.parts)


def _fingerprint(path: Path) -> str:
    stat = path.stat()
    return f"{stat.st_size}:{stat.st_mtime_ns}:{stat.st_ctime_ns}"


def copy_report(source: Path, relative: str, destination: Path) -> tuple[Path, str]:
    """Copy a complete PDF, verify SHA-256 and publish without overwriting data."""
    rel = _relative(relative)
    if not source.is_absolute() or source.suffix.lower() != ".pdf":
        raise ValueError("报告源路径必须是 PDF 绝对路径")
    if tuple(source.parts[-len(rel.parts):]) != rel.parts:
        raise ValueError("报告源路径与相对路径不一致")
    source_root = source.parents[len(rel.parts) - 1]
    if not destination.is_absolute():
        raise ValueError("备份目录必须是绝对路径")
    _no_links(source)
    _no_links(destination)
    source_root = source_root.resolve()
    destination = destination.resolve()
    if destination.is_relative_to(source_root) or source_root.is_relative_to(destination):
        raise ValueError("本地报告目录与备份目录不能相同或互相包含")
    if not destination.is_dir():
        raise FileNotFoundError("备份根目录不存在或共享目录不可访问")
    fingerprint = _fingerprint(source)
    digest = _digest(source)
    target = destination / rel
    _no_links(target)
    if target.exists():
        if _digest(target) == digest:
            return target, digest
        # Keep previous reports, including files uploaded by another workstation.
        target = target.with_name(f"{target.stem}.{digest}{target.suffix}")
        _no_links(target)
        if target.exists():
            if _digest(target) != digest:
                raise ValueError("同名版本备份校验失败，拒绝覆盖")
            return target, digest
    target.parent.mkdir(parents=True, exist_ok=True)
    _no_links(target)
    descriptor, temporary_name = tempfile.mkstemp(prefix=".mes-backup-", suffix=".tmp", dir=target.parent)
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "wb") as output, source.open("rb") as input_stream:
            for chunk in iter(lambda: input_stream.read(1024 * 1024), b""):
                output.write(chunk)
            output.flush()
            os.fsync(output.fileno())
        if _digest(temporary) != digest or _fingerprint(source) != fingerprint:
            raise OSError("报告复制过程中发生变化或校验失败，将自动重试")
        _no_links(target)
        try:
            if os.name == "nt":
                os.rename(temporary, target)  # Windows rename refuses existing files.
            else:
                os.link(temporary, target)  # Atomic no-clobber publication on POSIX.
        except FileExistsError:
            if _digest(target) != digest:
                raise OSError("备份目标并发变化，将自动重试")
        if _digest(target) != digest:
            raise OSError("服务器文件 SHA-256 校验失败")
        return target, digest
    finally:
        temporary.unlink(missing_ok=True)


def _open_queue(path: Path) -> sqlite3.Connection:
    if not path.is_absolute() or str(path).startswith(("\\\\", "//")):
        raise ValueError("备份队列必须使用本机绝对路径")
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path, timeout=3)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("""CREATE TABLE IF NOT EXISTS backups (
        destination TEXT NOT NULL, export_key TEXT NOT NULL,
        source TEXT NOT NULL, relative_path TEXT NOT NULL, fingerprint TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
        next_at REAL NOT NULL DEFAULT 0, updated_at REAL NOT NULL DEFAULT 0,
        remote_path TEXT NOT NULL DEFAULT '', sha256 TEXT NOT NULL DEFAULT '',
        error TEXT NOT NULL DEFAULT '', PRIMARY KEY(destination, export_key)
    )""")
    connection.commit()
    return connection


def backup_once(records: list[dict[str, Any]], *, destination: Path, state_path: Path,
                batch_size: int = 50, retry_seconds: float = 30) -> dict[str, int]:
    """Discover old/new reports and retry durable jobs, even if metadata disappears."""
    destination_key = str(destination)
    counts = {"succeeded": 0, "failed": 0}
    connection = _open_queue(state_path)
    try:
        for record in records:
            if record.get("status") != "success" or not record.get("exportKey"):
                continue
            source = str(record.get("filePath") or "")
            relative = str(record.get("relativePath") or "")
            try:
                fingerprint = _fingerprint(Path(source))
            except OSError:
                fingerprint = "missing"
            connection.execute("""INSERT INTO backups
                (destination,export_key,source,relative_path,fingerprint) VALUES (?,?,?,?,?)
                ON CONFLICT(destination,export_key) DO UPDATE SET
                source=excluded.source,relative_path=excluded.relative_path,
                fingerprint=excluded.fingerprint,status='pending',next_at=0,error=''
                WHERE backups.source != excluded.source
                   OR backups.relative_path != excluded.relative_path
                   OR (backups.fingerprint != excluded.fingerprint AND excluded.fingerprint != 'missing')
                """, (destination_key, str(record["exportKey"]), source, relative, fingerprint))
        connection.commit()
        jobs = connection.execute("""SELECT * FROM backups WHERE destination=? AND next_at<=?
            ORDER BY next_at,updated_at,export_key LIMIT ?""", (destination_key, time.time(), batch_size)).fetchall()
        for job in jobs:
            key = (destination_key, job["export_key"])
            # Commit before touching the network; a killed/hung worker leaves a retryable job.
            claimed = connection.execute("""UPDATE backups SET status='pending', attempts=attempts+1,
                next_at=?,updated_at=? WHERE destination=? AND export_key=? AND next_at=?""",
                (time.time() + retry_seconds, time.time(), *key, job["next_at"]))
            connection.commit()
            if not claimed.rowcount:
                continue
            try:
                source = Path(job["source"])
                if job["sha256"] and not source.exists():
                    # Local cleanup must not remove a confirmed remote backup.
                    remote = Path(job["remote_path"])
                    if not remote.is_relative_to(destination):
                        raise ValueError("备份记录目标越界")
                    _no_links(remote)
                    if _digest(remote) != job["sha256"]:
                        raise OSError("本地文件已删除且服务器备份校验失败")
                    digest = job["sha256"]
                else:
                    remote, digest = copy_report(source, job["relative_path"], destination)
                connection.execute("""UPDATE backups SET status='synced',remote_path=?,sha256=?,
                    error='',next_at=?,updated_at=? WHERE destination=? AND export_key=?""",
                    (str(remote), digest, time.time() + 3600, time.time(), *key))
                counts["succeeded"] += 1
            except Exception as exc:
                connection.execute("""UPDATE backups SET status='failed',error=?,updated_at=?
                    WHERE destination=? AND export_key=?""", (str(exc), time.time(), *key))
                counts["failed"] += 1
                logger.warning("Report backup failed (%s): %s", job["export_key"], exc)
            connection.commit()
    finally:
        connection.close()
    return counts


def backup_status(state_path: Path, destination: str) -> dict[str, Any]:
    result: dict[str, Any] = {"counts": {"pending": 0, "synced": 0, "failed": 0}, "failures": []}
    if not state_path.is_file():
        return result
    connection = sqlite3.connect(state_path.as_uri() + "?mode=ro", uri=True, timeout=1)
    connection.row_factory = sqlite3.Row
    try:
        rows = connection.execute("SELECT status,COUNT(*) AS count FROM backups WHERE destination=? GROUP BY status", (destination,))
        result["counts"].update({row["status"]: row["count"] for row in rows})
        result["failures"] = [dict(row) for row in connection.execute(
            "SELECT export_key,error,attempts,updated_at FROM backups WHERE destination=? AND status='failed' ORDER BY updated_at DESC LIMIT 20", (destination,))]
    finally:
        connection.close()
    return result


def main() -> None:
    from app.core.config import settings
    from app.core.storage_backend import get_storage_backend
    from app.services.test_data_repository import get_test_data_repository

    if not settings.TEST_DATA_BACKUP_PATH.strip():
        return
    discovery_error = None
    try:
        records = get_test_data_repository(get_storage_backend()).list_exports(status="success")
    except Exception as exc:
        # Existing durable jobs remain usable while the business DB is unavailable.
        records = []
        discovery_error = exc
        logger.warning("Cannot discover new reports: %s", exc)
    result = backup_once(records, destination=Path(settings.TEST_DATA_BACKUP_PATH),
                         state_path=Path(settings.TEST_DATA_BACKUP_STATE_PATH),
                         batch_size=settings.TEST_DATA_BACKUP_BATCH_SIZE,
                         retry_seconds=settings.TEST_DATA_BACKUP_INTERVAL_SECONDS)
    print(json.dumps(result))
    if discovery_error is not None:
        raise RuntimeError("新报告发现失败，已尝试处理本地备份队列") from discovery_error


if __name__ == "__main__":
    main()
