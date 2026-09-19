"""Completion intent capture and recoverable result materialization for LIMS."""
from __future__ import annotations

import copy
import hashlib
import json
import logging
import secrets
import time
from pathlib import Path
from urllib.parse import quote, urlsplit

from app.core.config import settings
from app.core.master_data import DEFAULT_LABS
from app.core.storage_backend import get_storage_backend
from app.core.time_utils import now_business_text
from app.services.attendance_service import get_attendance_service
from app.services.laboratory_operations import acquire_laboratory_storage_commit_lock
from app.services.lims_completion_model import COMPLETION_KEY, build_completion, personnel_snapshot, text, stable_id
from app.services.lims_http import EXTERNAL_INTAKE_LOCK, LIMS_OUTBOX_KEY
from app.services.test_data_repository import get_test_data_repository
from app.services.test_data_reports import read_test_data_settings, _ensure_within_root, archive_completion_reports

logger = logging.getLogger(__name__)
_REPORT_RETRY_AT: dict[str, float] = {}


def prepare_completion_updates(storage, snapshot: dict, result: dict, *, task_code: str,
                               experiment_code: str, run_no: str, completed_at: str) -> dict:
    """Called under workflow commit lock BEFORE committing the completed state.

    Open attendance intervals are clipped to the immutable completion cutoff, not
    force-closed. This also works for multi-axis work sessions and process recovery.
    """
    if not result.get("affectedTrayCodes"):
        return {}
    reader = getattr(storage, "read", None)
    records = list((reader(COMPLETION_KEY) if callable(reader) else storage.read_all().get(COMPLETION_KEY)) or [])
    record = build_completion(snapshot, result, task_code, experiment_code, run_no, completed_at, records)
    if record is None:
        return {}
    record["token"] = secrets.token_urlsafe(32)
    if not record["payload"]["lims_request_id"]:
        intakes = (reader("mes.external_task_intakes") if callable(reader) else storage.read_all().get("mes.external_task_intakes")) or []
        intake = next((row for row in intakes if text(row.get("accepted_task_code") or row.get("code")) == task_code), {})
        record["payload"]["lims_request_id"] = text(intake.get("lims_request_id") or intake.get("intake_id"))
    devices = (reader("mes.devices") if callable(reader) else storage.read_all().get("mes.devices")) or []
    for execution in record["payload"]["executions"]:
        name = execution["device_name"]
        if not execution["lab_code"]:
            execution["lab_code"] = next((lab["lab_code"] for lab in DEFAULT_LABS if lab["lab_name"] == name), "")
        matches = [d for d in devices if name and name in {text(d.get("name")), text(d.get("location")), text(d.get("lab_name"))}]
        if len(matches) == 1:
            execution["device_code"] = text(matches[0].get("code") or matches[0].get("device_code"))
        if not execution["device_code"]:
            record["payload"]["data_quality"] = sorted(set([*record["payload"]["data_quality"], "device_identity_incomplete"]))
    try:
        intervals, sessions = get_attendance_service().repository.completion_records(
            sorted({row["run_no"] for row in record["payload"]["executions"]}))
        record["payload"]["personnel"] = personnel_snapshot(record["payload"]["executions"], intervals, sessions, completed_at)
        if not record["payload"]["personnel"]:
            record["payload"]["data_quality"].append("attendance_records_missing")
    except Exception:
        # Keep the physical event retryable without losing the completion intent.
        record["attendance_pending"] = True
        record["payload"]["data_quality"].append("attendance_unavailable")
        logger.exception("LIMS completion attendance snapshot unavailable run=%s", run_no)
    return {COMPLETION_KEY: [*records, record]}


def _base_url(value: str) -> str:
    value = value.strip().rstrip("/")
    if not value:
        return ""
    parsed = urlsplit(value)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
        return ""
    return value


def file_path(storage, export: dict) -> Path | None:
    if export.get("status") != "success" or not export.get("filePath"):
        return None
    try:
        root = Path(read_test_data_settings(storage=storage)["savePath"])
        path = _ensure_within_root(root, Path(export["filePath"]))
        return path if path.is_file() else None
    except (ValueError, OSError):
        return None


def build_data_manifest(storage, record: dict, exports: dict, public_base: str) -> dict:
    base = _base_url(public_base)
    page_url = f"{base}/api/test-data/completions/{record['token']}" if base else None
    files = []
    for expected in record["expected_files"]:
        export = exports.get(expected["export_key"], {})
        path = file_path(storage, export)
        ready = path is not None and bool(base)
        files.append({**expected, "status": "ready" if ready else "failed" if export.get("status") == "failed" else "pending",
                      "file_name": path.name if path else None, "media_type": "application/pdf",
                      "generated_at": export.get("generatedAt"), "updated_at": export.get("updatedAt"),
                      "url": f"{page_url}/files/{quote(expected['export_key'], safe='')}" if ready else None})
    available = sum(row["status"] == "ready" for row in files)
    return {"status": "ready" if files and available == len(files) else "partial" if available else "pending",
            "url": page_url, "files": files, "missing_count": len(files) - available,
            "url_status": "configured" if base else "public_base_url_missing"}


def recover_completion_reports(storage, records: list[dict]) -> None:
    """Repair the crash window after completion commit but before report IO.

Uses frozen scope, never today's tray assignments. Failures are rate-limited
and don't prevent completion notifications with pending file status.
"""
    repository = get_test_data_repository(storage)
    exports = {row["exportKey"]: row for row in repository.list_exports()}
    budget = 10
    for record in records:
        snapshot = record.get("report_snapshot")
        if not snapshot:
            continue
        for execution in record["payload"]["executions"]:
            expected = [row for row in record["expected_files"] if row["run_no"] == execution["run_no"] and row["axis_code"] == execution["axis_code"]]
            key = stable_id(record["completion_id"], execution["execution_id"])
            if not expected or all(file_path(storage, exports.get(row["export_key"], {})) for row in expected):
                continue
            if _REPORT_RETRY_AT.get(key, 0) > time.monotonic():
                continue
            if budget <= 0:
                return
            budget -= 1
            _REPORT_RETRY_AT[key] = time.monotonic() + 30
            archive_completion_reports(
                storage=storage, snapshot=snapshot,
                result={"affectedTrayCodes": execution["tray_codes"], "samples": snapshot["samples"]},
                task_code=record["task_code"], experiment_code=record["experiment_code"],
                run_no=execution["run_no"], axis_code=execution["axis_code"],
                completed_at=execution["ended_at"] or record["payload"]["completed_at"],
            )


def materialize_completions(storage=None, *, public_base: str | None = None, recover_reports: bool = True) -> int:
    """Resume committed intents; revisions contain full snapshots, never deltas.

The worker polls file availability so successful archive retries automatically
produce a new revision, without re-reading mutable tray/sample assignments.
"""
    storage = storage or get_storage_backend()
    base = (settings.LIMS_DATA_PUBLIC_BASE_URL or settings.TEST_DATA_PUBLIC_BASE_URL) if public_base is None else public_base
    if recover_reports:
        # PDF IO must not hold the workflow commit lock.
        captured = copy.deepcopy(storage.read(COMPLETION_KEY) or [])
        if captured:
            try:
                recover_completion_reports(storage, captured)
            except Exception:
                logger.exception("LIMS completion report recovery failed; pending notification is still eligible")
    with acquire_laboratory_storage_commit_lock(), EXTERNAL_INTAKE_LOCK:
        records = copy.deepcopy(storage.read(COMPLETION_KEY) or [])
        if not records:
            return 0
        exports = {row["exportKey"]: row for row in get_test_data_repository(storage).list_exports()}
        outbox = list(storage.read(LIMS_OUTBOX_KEY) or [])
        emitted = 0
        for record in records:
            try:
                payload = copy.deepcopy(record["payload"])
                if record.get("attendance_pending"):
                    try:
                        intervals, sessions = get_attendance_service().repository.completion_records(
                            sorted({row["run_no"] for row in payload["executions"]}))
                        payload["personnel"] = personnel_snapshot(payload["executions"], intervals, sessions, payload["completed_at"])
                        payload["data_quality"] = [q for q in payload["data_quality"] if q != "attendance_unavailable"]
                        if not payload["personnel"]:
                            payload["data_quality"].append("attendance_records_missing")
                        record["attendance_pending"] = False
                    except Exception:
                        pass  # First receipt explicitly marks missing data; retry later.
                payload["data"] = build_data_manifest(storage, record, exports, base)
                payload.pop("revision", None)
                fingerprint = hashlib.sha256(json.dumps(payload, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
                if fingerprint == record.get("last_fingerprint"):
                    continue
                revision = int(record["payload"].get("revision", 0)) + 1
                payload["revision"] = revision
                event_id = stable_id(record["completion_id"], revision)
                outbox.append({"event_id": event_id, "message_id": event_id,
                    "correlation_id": payload.get("lims_request_id") or payload["code"],
                    "type": "mes.experiment.completion.v1", "source": "MES", "schema_version": 1,
                    "occurred_at": now_business_text(), "payload": payload})
                record.update(payload=payload, last_fingerprint=fingerprint, state="queued", event_id=event_id)
                emitted += 1
            except Exception:
                logger.exception("LIMS completion materialization failed completion=%s", record.get("completion_id"))
        if emitted:
            # The MySQL backend commits these two snapshot keys in one transaction.
            storage.write_many({COMPLETION_KEY: records, LIMS_OUTBOX_KEY: outbox})
        return emitted


def resolve_completion(token: str, storage=None) -> dict:
    storage = storage or get_storage_backend()
    record = next((r for r in storage.read(COMPLETION_KEY) or [] if secrets.compare_digest(text(r.get("token")), token)), None)
    if not record:
        raise FileNotFoundError("完成记录不存在或链接已失效")
    return record


def resolve_completion_file(token: str, export_key: str, storage=None) -> Path:
    storage = storage or get_storage_backend()
    record = resolve_completion(token, storage)
    if not any(row["export_key"] == export_key for row in record["expected_files"]):
        raise FileNotFoundError("文件不属于本次完成范围")
    export = get_test_data_repository(storage).get_export(export_key) or {}
    path = file_path(storage, export)
    if not path:
        raise FileNotFoundError("文件尚未生成或已移除")
    return path
