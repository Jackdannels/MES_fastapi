from __future__ import annotations

import json
import re
from datetime import date, datetime, timezone
from threading import Lock
from typing import Any, Dict, Iterable

from app.core.storage_backend import (
    CURRENT_SCHEMA_VERSION,
    STORAGE_KEYS,
    STORAGE_META_KEY,
    StorageBackend,
    _normalize_payload,
    _normalize_value,
)
from app.db.mysql_snapshot import MySQLConnectionSettings, MySQLSnapshotRepository

STORAGE_MARKER = "FRONTEND_STORAGE"
SAMPLE_META_PREFIX = f"{STORAGE_MARKER}:SAMPLE:"
TRAY_META_PREFIX = f"{STORAGE_MARKER}:TRAY"
RELATIONAL_STORAGE_KEYS = (
    "mes.tasks",
    "mes.schedules",
    "mes.devices",
    "mes.streams",
    "mes.samples",
    "mes.experiments",
    "mes.experiment_trays",
    "mes.experiment_samples",
)
SNAPSHOT_STORAGE_KEYS = ("mes.conflicts", STORAGE_META_KEY)
RETENTION_KEYWORD = "暂存间"
SAMPLE_TASK_CODE_PATTERN = re.compile(r"^(?P<task_code>.+)-SP-\d+$")


def normalize_text(value: Any) -> str:
    return str(value or "").strip()


def derive_task_code_from_sample_code(sample_code: Any) -> str:
    text = normalize_text(sample_code)
    match = SAMPLE_TASK_CODE_PATTERN.match(text)
    if not match:
        return ""
    return normalize_text(match.group("task_code"))


def normalize_storage_payload(payload: Dict[str, Any]) -> Dict[str, Any]:
    normalized_payload, _changed = _normalize_payload(dict(payload))
    normalized_payload.setdefault(STORAGE_META_KEY, {"schema_version": CURRENT_SCHEMA_VERSION})
    return normalized_payload


def parse_storage_datetime(value: Any) -> datetime | None:
    text = normalize_text(value)
    if not text:
        return None

    iso_candidate = text.replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(iso_candidate)
    except ValueError:
        parsed = None

    if parsed is None:
        for pattern in ("%Y-%m-%d %H:%M", "%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M", "%Y-%m-%dT%H:%M:%S"):
            try:
                parsed = datetime.strptime(text, pattern)
                break
            except ValueError:
                continue

    if parsed is None:
        return None

    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(timezone.utc).replace(tzinfo=None)

    return parsed


def format_iso_storage_datetime(value: Any) -> str:
    parsed = parse_storage_datetime(value) if not isinstance(value, datetime) else value
    if parsed is None:
        return ""
    return parsed.strftime("%Y-%m-%dT%H:%M:%SZ")


def format_display_storage_datetime(value: Any) -> str:
    parsed = parse_storage_datetime(value) if not isinstance(value, datetime) else value
    if parsed is None:
        return ""
    return parsed.strftime("%Y-%m-%d %H:%M")


def parse_priority_value(value: Any) -> int | None:
    text = normalize_text(value)
    if not text:
        return None
    if text == "高":
        return 3
    if text == "中":
        return 2
    if text == "低":
        return 1
    try:
        parsed = int(text)
    except ValueError:
        return None
    return parsed


def format_priority_value(value: Any) -> str:
    if value in (3, "3"):
        return "高"
    if value in (2, "2"):
        return "中"
    if value in (1, "1"):
        return "低"
    return normalize_text(value)


def parse_int_value(value: Any) -> int | None:
    text = normalize_text(value)
    if not text:
        return None
    try:
        return int(text)
    except ValueError:
        return None


def parse_float_value(value: Any) -> float | None:
    text = normalize_text(value).replace("%", "")
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def format_quality_value(value: Any) -> str:
    parsed = parse_float_value(value)
    if parsed is None:
        return "0.0%"
    text = f"{parsed:.2f}".rstrip("0").rstrip(".")
    if "." not in text:
        text = f"{text}.0"
    return f"{text}%"


def parse_bool_flag(value: Any) -> int:
    if isinstance(value, bool):
        return 1 if value else 0
    text = normalize_text(value).lower()
    return 1 if text in {"1", "true", "yes"} else 0


def parse_date_value(value: Any) -> date | None:
    text = normalize_text(value)
    if not text:
        return None
    try:
        return datetime.strptime(text, "%Y-%m-%d").date()
    except ValueError:
        return None


def format_date_value(value: Any) -> str:
    if isinstance(value, date):
        return value.strftime("%Y-%m-%d")
    text = normalize_text(value)
    if len(text) >= 10:
        return text[:10]
    return ""


def encode_sample_meta(*, owner: str = "", remark: str = "") -> str:
    payload = {"owner": normalize_text(owner), "remark": normalize_text(remark)}
    return f"{SAMPLE_META_PREFIX}{json.dumps(payload, ensure_ascii=False, separators=(',', ':'))}"


def decode_sample_meta(value: Any) -> dict[str, str]:
    text = normalize_text(value)
    if not text.startswith(SAMPLE_META_PREFIX):
        return {"owner": "", "remark": text}
    raw_payload = text[len(SAMPLE_META_PREFIX) :]
    try:
        parsed = json.loads(raw_payload)
    except json.JSONDecodeError:
        return {"owner": "", "remark": ""}
    return {
        "owner": normalize_text(parsed.get("owner")),
        "remark": normalize_text(parsed.get("remark")),
    }


def build_task_insert_row(task: Dict[str, Any]) -> Dict[str, Any]:
    now_utc = datetime.now(timezone.utc).replace(tzinfo=None)
    return {
        "task_no": normalize_text(task.get("code")),
        "task_source_type": normalize_text(task.get("source")),
        "source_system": STORAGE_MARKER,
        "task_name": normalize_text(task.get("name")),
        "client_name": normalize_text(task.get("client")),
        "contact_name": normalize_text(task.get("contact")),
        "contact_phone": normalize_text(task.get("contact_info")),
        "task_type": normalize_text(task.get("test_type")),
        "sample_type": normalize_text(task.get("sample_type")),
        "priority": parse_priority_value(task.get("priority")),
        "sample_count": parse_int_value(task.get("sample_count")),
        "task_status": normalize_text(task.get("status")),
        "arrival_time": parse_storage_datetime(task.get("arrival_at")),
        "due_time": parse_storage_datetime(task.get("due_at")),
        "required_device": normalize_text(task.get("required_device")),
        "conditions_text": normalize_text(task.get("conditions")),
        "attachment_path": normalize_text(task.get("attachment")),
        "remark": normalize_text(task.get("remark")),
        "created_at": parse_storage_datetime(task.get("created_at")) or now_utc,
        "updated_at": parse_storage_datetime(task.get("updated_at")) or now_utc,
    }


def build_storage_task_tray_codes(rows: Iterable[Dict[str, Any]]) -> Dict[str, list[str]]:
    tray_map: Dict[str, list[str]] = {}
    for row in rows:
        task_no = normalize_text(row.get("task_no"))
        tray_no = normalize_text(row.get("tray_no"))
        if not task_no or not tray_no:
            continue
        tray_map.setdefault(task_no, [])
        if tray_no not in tray_map[task_no]:
            tray_map[task_no].append(tray_no)
    for key in tray_map:
        tray_map[key].sort()
    return tray_map


def build_storage_task_item(row: Dict[str, Any], tray_codes: Iterable[str] | None = None) -> Dict[str, Any]:
    return {
        "id": normalize_text(row.get("task_no")),
        "code": normalize_text(row.get("task_no")),
        "name": normalize_text(row.get("task_name")),
        "source": normalize_text(row.get("task_source_type")),
        "client": normalize_text(row.get("client_name")),
        "contact": normalize_text(row.get("contact_name")),
        "contact_info": normalize_text(row.get("contact_phone")),
        "priority": format_priority_value(row.get("priority")),
        "sample_count": "" if row.get("sample_count") is None else str(row.get("sample_count")),
        "sample_type": normalize_text(row.get("sample_type")),
        "test_type": normalize_text(row.get("task_type")),
        "required_device": normalize_text(row.get("required_device")),
        "due_at": format_display_storage_datetime(row.get("due_time")),
        "arrival_at": format_display_storage_datetime(row.get("arrival_time")),
        "conditions": normalize_text(row.get("conditions_text")),
        "attachment": normalize_text(row.get("attachment_path")),
        "remark": normalize_text(row.get("remark")),
        "status": normalize_text(row.get("task_status")),
        "created_at": format_iso_storage_datetime(row.get("created_at")),
        "tray_codes": [normalize_text(code) for code in (tray_codes or []) if normalize_text(code)],
    }


def build_experiment_insert_row(experiment: Dict[str, Any]) -> Dict[str, Any]:
    now_utc = datetime.now(timezone.utc).replace(tzinfo=None)
    return {
        "experiment_no": normalize_text(experiment.get("experiment_code")),
        "task_no": normalize_text(experiment.get("task_code")),
        "experiment_name": normalize_text(experiment.get("experiment_name")),
        "required_device": normalize_text(experiment.get("required_device")),
        "priority": parse_priority_value(experiment.get("priority")),
        "planned_hours": parse_float_value(experiment.get("planned_hours")),
        "experiment_status": normalize_text(experiment.get("status")),
        "created_at": parse_storage_datetime(experiment.get("created_at")) or now_utc,
        "updated_at": parse_storage_datetime(experiment.get("updated_at")) or now_utc,
    }


def build_storage_experiment_item(row: Dict[str, Any]) -> Dict[str, Any]:
    planned_hours = row.get("planned_hours")
    return {
        "id": normalize_text(row.get("experiment_no")),
        "task_code": normalize_text(row.get("task_no")),
        "experiment_code": normalize_text(row.get("experiment_no")),
        "experiment_name": normalize_text(row.get("experiment_name")),
        "required_device": normalize_text(row.get("required_device")),
        "priority": format_priority_value(row.get("priority")),
        "planned_hours": 0 if planned_hours in (None, "") else float(planned_hours),
        "status": normalize_text(row.get("experiment_status")),
        "created_at": format_iso_storage_datetime(row.get("created_at")),
        "updated_at": format_iso_storage_datetime(row.get("updated_at")),
    }


def build_experiment_tray_insert_row(relation: Dict[str, Any]) -> Dict[str, Any]:
    now_utc = datetime.now(timezone.utc).replace(tzinfo=None)
    return {
        "experiment_no": normalize_text(relation.get("experiment_code")),
        "task_no": normalize_text(relation.get("task_code")),
        "tray_no": normalize_text(relation.get("tray_code")),
        "created_at": parse_storage_datetime(relation.get("created_at")) or now_utc,
        "updated_at": parse_storage_datetime(relation.get("updated_at")) or now_utc,
    }


def build_storage_experiment_tray_item(row: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": normalize_text(row.get("relation_id")) or (
            f"{normalize_text(row.get('experiment_no'))}:{normalize_text(row.get('tray_no'))}"
        ),
        "task_code": normalize_text(row.get("task_no")),
        "experiment_code": normalize_text(row.get("experiment_no")),
        "tray_code": normalize_text(row.get("tray_no")),
        "created_at": format_iso_storage_datetime(row.get("created_at")),
        "updated_at": format_iso_storage_datetime(row.get("updated_at")),
    }


def build_experiment_sample_insert_row(relation: Dict[str, Any]) -> Dict[str, Any]:
    now_utc = datetime.now(timezone.utc).replace(tzinfo=None)
    return {
        "experiment_no": normalize_text(relation.get("experiment_code")),
        "task_no": normalize_text(relation.get("task_code")),
        "sample_no": normalize_text(relation.get("sample_code")),
        "created_at": parse_storage_datetime(relation.get("created_at")) or now_utc,
        "updated_at": parse_storage_datetime(relation.get("updated_at")) or now_utc,
    }


def build_storage_experiment_sample_item(row: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": normalize_text(row.get("relation_id")) or (
            f"{normalize_text(row.get('experiment_no'))}:{normalize_text(row.get('sample_no'))}"
        ),
        "task_code": normalize_text(row.get("task_no")),
        "experiment_code": normalize_text(row.get("experiment_no")),
        "sample_code": normalize_text(row.get("sample_no")),
        "created_at": format_iso_storage_datetime(row.get("created_at")),
        "updated_at": format_iso_storage_datetime(row.get("updated_at")),
    }


def build_schedule_insert_row(schedule: Dict[str, Any]) -> Dict[str, Any]:
    device = normalize_text(schedule.get("device"))
    return {
        "schedule_no": normalize_text(schedule.get("id")),
        "task_no": normalize_text(schedule.get("task_code")),
        "experiment_no": normalize_text(schedule.get("experiment_code")),
        "schedule_type": STORAGE_MARKER,
        "device_name": device,
        "schedule_start_time": parse_storage_datetime(schedule.get("start_at")),
        "schedule_end_time": parse_storage_datetime(schedule.get("end_at")),
        "planned_hours": parse_float_value(schedule.get("planned_hours")),
        "schedule_status": normalize_text(schedule.get("status")),
        "is_retention": 1 if RETENTION_KEYWORD in device else 0,
        "remark": "",
    }


def build_storage_schedule_item(row: Dict[str, Any]) -> Dict[str, Any]:
    planned_hours = row.get("planned_hours")
    return {
        "id": normalize_text(row.get("schedule_no")),
        "task_code": normalize_text(row.get("task_no")),
        "experiment_code": normalize_text(row.get("experiment_no")),
        "device": normalize_text(row.get("device_name")),
        "start_at": format_iso_storage_datetime(row.get("schedule_start_time")),
        "end_at": format_iso_storage_datetime(row.get("schedule_end_time")),
        "planned_hours": 0 if planned_hours in (None, "") else float(planned_hours),
        "status": normalize_text(row.get("schedule_status")),
    }


def build_device_insert_row(device: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "equipment_code": normalize_text(device.get("code")),
        "equipment_name": normalize_text(device.get("name")),
        "equipment_type": normalize_text(device.get("type")),
        "model_no": normalize_text(device.get("model")),
        "manufacturer": STORAGE_MARKER,
        "status": normalize_text(device.get("status")),
        "acquisition_enabled": normalize_text(device.get("acquisition_enabled")) or "启用",
        "next_calibration_date": parse_date_value(device.get("next_cal")),
        "location_desc": normalize_text(device.get("location")),
        "remark": normalize_text(device.get("owner")),
    }


def build_storage_device_item(row: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": normalize_text(row.get("equipment_code")),
        "code": normalize_text(row.get("equipment_code")),
        "name": normalize_text(row.get("equipment_name")),
        "type": normalize_text(row.get("equipment_type")),
        "status": normalize_text(row.get("status")),
        "location": normalize_text(row.get("location_desc")),
        "next_cal": format_date_value(row.get("next_calibration_date")),
        "owner": normalize_text(row.get("remark")),
        "model": normalize_text(row.get("model_no")),
        "acquisition_enabled": normalize_text(row.get("acquisition_enabled")) or "启用",
    }


def build_stream_insert_row(stream: Dict[str, Any]) -> Dict[str, Any]:
    device = normalize_text(stream.get("device"))
    return {
        "stream_no": normalize_text(stream.get("id")),
        "task_no": normalize_text(stream.get("task_code")),
        "equipment_code": device,
        "device_name": device,
        "last_packet_time": parse_storage_datetime(stream.get("last_packet")),
        "quality_value": parse_float_value(stream.get("quality")),
        "stream_status": normalize_text(stream.get("status")),
        "reported_flag": parse_bool_flag(stream.get("reported")),
        "remark": STORAGE_MARKER,
    }


def build_storage_stream_item(row: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": normalize_text(row.get("stream_no")),
        "task_code": normalize_text(row.get("task_no")),
        "device": normalize_text(row.get("device_name") or row.get("equipment_code")),
        "last_packet": format_display_storage_datetime(row.get("last_packet_time")),
        "quality": format_quality_value(row.get("quality_value")),
        "status": normalize_text(row.get("stream_status")),
        "reported": bool(row.get("reported_flag")),
    }


def build_sample_insert_row(sample: Dict[str, Any]) -> Dict[str, Any]:
    code = normalize_text(sample.get("code"))
    return {
        "sample_no": code,
        "task_no": normalize_text(sample.get("task_code")),
        "sample_name": code,
        "batch_no": normalize_text(sample.get("batch_no")),
        "sample_type": normalize_text(sample.get("sample_type")),
        "sample_spec": "",
        "quantity": parse_int_value(sample.get("quantity")),
        "unit": "",
        "sample_status": normalize_text(sample.get("status")),
        "received_time": parse_storage_datetime(sample.get("created_at")) or parse_storage_datetime(sample.get("arrival_at")),
        "arrival_time": parse_storage_datetime(sample.get("arrival_at")),
        "storage_condition": normalize_text(sample.get("storage_condition")),
        "barcode_no": normalize_text(sample.get("barcode")),
        "location_desc": normalize_text(sample.get("location")),
        "flow_status": normalize_text(sample.get("flow_status")),
        "remark": encode_sample_meta(owner=sample.get("owner"), remark=sample.get("remark")),
        "created_at": parse_storage_datetime(sample.get("created_at")) or datetime.now(timezone.utc).replace(tzinfo=None),
        "updated_at": parse_storage_datetime(sample.get("updated_at")) or datetime.now(timezone.utc).replace(tzinfo=None),
    }


def build_storage_sample_item(
    row: Dict[str, Any],
    *,
    tray_rows: Iterable[Dict[str, Any]] | None = None,
    event_rows: Iterable[Dict[str, Any]] | None = None,
) -> Dict[str, Any]:
    meta = decode_sample_meta(row.get("remark"))
    resolved_task_code = normalize_text(row.get("task_no")) or derive_task_code_from_sample_code(row.get("sample_no"))
    trays = [
        {
            "id": normalize_text(tray.get("tray_code") or tray.get("id")),
            "tray_code": normalize_text(tray.get("tray_code")),
            "sample_code": normalize_text(tray.get("sample_code") or row.get("sample_no")),
            "quantity": 0 if tray.get("quantity") in (None, "") else int(tray.get("quantity")),
            "created_at": format_iso_storage_datetime(tray.get("created_at")),
            "updated_at": format_iso_storage_datetime(tray.get("updated_at")),
        }
        for tray in (tray_rows or [])
        if normalize_text(tray.get("tray_code"))
    ]
    history = [
        {
            "id": normalize_text(event.get("id") or event.get("event_id") or event.get("sample_no")),
            "time": format_iso_storage_datetime(event.get("time") or event.get("event_time")),
            "action": normalize_text(event.get("action") or event.get("action_type")),
            "location": normalize_text(event.get("location") or event.get("location_desc")),
            "owner": normalize_text(event.get("owner") or event.get("owner_name")),
            "status": normalize_text(event.get("status") or event.get("sample_status")),
            "detail": normalize_text(event.get("detail")),
        }
        for event in (event_rows or [])
    ]
    history.sort(key=lambda item: normalize_text(item.get("time")), reverse=True)
    return {
        "id": normalize_text(row.get("sample_no")),
        "code": normalize_text(row.get("sample_no")),
        "task_code": resolved_task_code,
        "sample_type": normalize_text(row.get("sample_type")),
        "batch_no": normalize_text(row.get("batch_no")),
        "arrival_at": format_display_storage_datetime(row.get("arrival_time")),
        "quantity": "" if row.get("quantity") is None else str(row.get("quantity")),
        "storage_condition": normalize_text(row.get("storage_condition")),
        "barcode": normalize_text(row.get("barcode_no")),
        "remark": meta["remark"],
        "location": normalize_text(row.get("location_desc")),
        "owner": meta["owner"],
        "status": normalize_text(row.get("sample_status")),
        "flow_status": normalize_text(row.get("flow_status")),
        "created_at": format_iso_storage_datetime(row.get("created_at")),
        "updated_at": format_iso_storage_datetime(row.get("updated_at")),
        "trays": trays,
        "history": history,
    }


class MySQLMesStorageBackend(StorageBackend):
    def __init__(
        self,
        connection_settings: MySQLConnectionSettings,
        snapshot_repository: MySQLSnapshotRepository,
        bootstrap_storage: StorageBackend | None = None,
    ) -> None:
        self._connection_settings = connection_settings
        self._snapshot_repository = snapshot_repository
        self._bootstrap_storage = bootstrap_storage
        self._lock = Lock()
        self._schema_initialized = False

    def _connect(self):
        try:
            import pymysql
            from pymysql.cursors import DictCursor
        except ImportError as exc:
            raise RuntimeError("pymysql is required for the MySQL storage backend") from exc

        return pymysql.connect(
            host=self._connection_settings.host,
            port=self._connection_settings.port,
            user=self._connection_settings.user,
            password=self._connection_settings.password,
            database=self._connection_settings.database,
            charset=self._connection_settings.charset,
            autocommit=False,
            cursorclass=DictCursor,
        )

    def _ensure_schema_extensions(self) -> None:
        if self._schema_initialized:
            return
        with self._connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute("SHOW COLUMNS FROM biz_schedule LIKE 'experiment_no'")
                if cursor.fetchone() is None:
                    cursor.execute("ALTER TABLE biz_schedule ADD COLUMN experiment_no VARCHAR(50) NULL AFTER task_no")
                cursor.execute(
                    """
                    CREATE TABLE IF NOT EXISTS biz_experiment (
                      experiment_id BIGINT NOT NULL AUTO_INCREMENT,
                      experiment_no VARCHAR(50) NOT NULL,
                      task_id BIGINT NULL,
                      task_no VARCHAR(50) NOT NULL,
                      experiment_name VARCHAR(100) NOT NULL,
                      required_device VARCHAR(100) NULL,
                      priority TINYINT NULL,
                      planned_hours DECIMAL(10,2) NULL,
                      experiment_status VARCHAR(30) NULL,
                      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                      PRIMARY KEY (experiment_id),
                      UNIQUE KEY uk_biz_experiment_no (experiment_no),
                      KEY idx_biz_experiment_task_no (task_no)
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
                    """
                )
                cursor.execute(
                    """
                    CREATE TABLE IF NOT EXISTS biz_experiment_tray (
                      relation_id BIGINT NOT NULL AUTO_INCREMENT,
                      experiment_no VARCHAR(50) NOT NULL,
                      task_no VARCHAR(50) NOT NULL,
                      tray_no VARCHAR(80) NOT NULL,
                      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                      PRIMARY KEY (relation_id),
                      UNIQUE KEY uk_biz_experiment_tray_unique (experiment_no, tray_no),
                      KEY idx_biz_experiment_tray_task_no (task_no),
                      KEY idx_biz_experiment_tray_tray_no (tray_no)
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
                    """
                )
                cursor.execute(
                    """
                    CREATE TABLE IF NOT EXISTS biz_experiment_sample (
                      relation_id BIGINT NOT NULL AUTO_INCREMENT,
                      experiment_no VARCHAR(50) NOT NULL,
                      task_no VARCHAR(50) NOT NULL,
                      sample_no VARCHAR(80) NOT NULL,
                      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                      PRIMARY KEY (relation_id),
                      UNIQUE KEY uk_biz_experiment_sample_unique (experiment_no, sample_no),
                      KEY idx_biz_experiment_sample_task_no (task_no),
                      KEY idx_biz_experiment_sample_sample_no (sample_no)
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
                    """
                )
            connection.commit()
        self._schema_initialized = True

    def _deserialize_snapshot_payloads(self, payloads: Dict[str, str]) -> Dict[str, Any]:
        values: Dict[str, Any] = {}
        for key in SNAPSHOT_STORAGE_KEYS:
            raw_value = payloads.get(key)
            if key == STORAGE_META_KEY:
                try:
                    parsed = json.loads(raw_value) if raw_value else {}
                except json.JSONDecodeError:
                    parsed = {}
                values[key] = _normalize_value(key, parsed if isinstance(parsed, dict) else {})
                continue
            try:
                parsed = json.loads(raw_value) if raw_value else []
            except json.JSONDecodeError:
                parsed = []
            values[key] = _normalize_value(key, parsed if isinstance(parsed, list) else [])
        return values

    def _serialize_snapshot_updates(self, updates: Dict[str, Any]) -> Dict[str, str]:
        serialized: Dict[str, str] = {}
        for key in SNAPSHOT_STORAGE_KEYS:
            if key not in updates:
                continue
            if key == STORAGE_META_KEY:
                normalized = _normalize_value(key, updates.get(key) if isinstance(updates.get(key), dict) else {})
            else:
                normalized = _normalize_value(key, updates.get(key) if isinstance(updates.get(key), list) else [])
            serialized[key] = json.dumps(normalized, ensure_ascii=False)
        return serialized

    def _managed_counts(self) -> dict[str, int]:
        self._ensure_schema_extensions()
        with self._connect() as connection:
            with connection.cursor() as cursor:
                cursor.execute("SELECT COUNT(*) AS total FROM biz_task WHERE source_system = %s", (STORAGE_MARKER,))
                task_count = int(cursor.fetchone()["total"])
                cursor.execute("SELECT COUNT(*) AS total FROM biz_schedule WHERE schedule_type = %s", (STORAGE_MARKER,))
                schedule_count = int(cursor.fetchone()["total"])
                cursor.execute("SELECT COUNT(*) AS total FROM md_equipment WHERE manufacturer = %s", (STORAGE_MARKER,))
                device_count = int(cursor.fetchone()["total"])
                cursor.execute("SELECT COUNT(*) AS total FROM biz_data_stream WHERE remark = %s", (STORAGE_MARKER,))
                stream_count = int(cursor.fetchone()["total"])
                cursor.execute("SELECT COUNT(*) AS total FROM biz_sample WHERE remark LIKE %s", (f"{SAMPLE_META_PREFIX}%",))
                sample_count = int(cursor.fetchone()["total"])
        return {
            "mes.tasks": task_count,
            "mes.schedules": schedule_count,
            "mes.devices": device_count,
            "mes.streams": stream_count,
            "mes.samples": sample_count,
        }

    def _ensure_bootstrapped(self) -> None:
        self._ensure_schema_extensions()
        snapshot_payloads = self._snapshot_repository.read_all()
        if self._bootstrap_storage is None:
            return
        counts = self._managed_counts()
        pending_updates: Dict[str, Any] = {}

        if not any(counts.values()):
            bootstrap_payload = self._bootstrap_storage.read_all()
            merged_payload = dict(bootstrap_payload)
            for key in SNAPSHOT_STORAGE_KEYS:
                if normalize_text(snapshot_payloads.get(key)):
                    try:
                        merged_payload[key] = json.loads(snapshot_payloads[key])
                    except json.JSONDecodeError:
                        merged_payload[key] = bootstrap_payload.get(key, [])
            self._write_many_internal(merged_payload)
            return

        if counts["mes.samples"] == 0:
            raw_sample_payload = snapshot_payloads.get("mes.samples")
            if normalize_text(raw_sample_payload):
                try:
                    pending_updates["mes.samples"] = json.loads(raw_sample_payload)
                except json.JSONDecodeError:
                    pending_updates["mes.samples"] = self._bootstrap_storage.read("mes.samples")
            else:
                pending_updates["mes.samples"] = self._bootstrap_storage.read("mes.samples")

        if pending_updates:
            self._write_many_internal(pending_updates)

    def _delete_missing_rows(
        self,
        cursor,
        *,
        table_name: str,
        marker_column: str,
        key_column: str,
        incoming_keys: Iterable[str],
        marker_value: str,
    ) -> None:
        keys = [key for key in incoming_keys if key]
        if not keys:
            cursor.execute(f"DELETE FROM {table_name} WHERE {marker_column} = %s", (marker_value,))
            return
        placeholders = ", ".join(["%s"] * len(keys))
        params = [marker_value, *keys]
        cursor.execute(
            f"DELETE FROM {table_name} WHERE {marker_column} = %s AND {key_column} NOT IN ({placeholders})",
            params,
        )

    def _replace_tasks(self, cursor, tasks: list[dict[str, Any]], *, prune: bool = True) -> None:
        rows = [build_task_insert_row(task) for task in tasks if normalize_text(task.get("code"))]
        if prune:
            self._delete_missing_rows(
                cursor,
                table_name="biz_task",
                marker_column="source_system",
                key_column="task_no",
                incoming_keys=[row["task_no"] for row in rows],
                marker_value=STORAGE_MARKER,
            )
        if not rows:
            return
        cursor.executemany(
            """
            INSERT INTO biz_task (
              task_no, task_source_type, source_system, task_name, client_name, contact_name, contact_phone,
              task_type, sample_type, priority, sample_count, task_status, arrival_time, due_time,
              required_device, conditions_text, attachment_path, remark, created_at, updated_at
            ) VALUES (
              %(task_no)s, %(task_source_type)s, %(source_system)s, %(task_name)s, %(client_name)s, %(contact_name)s, %(contact_phone)s,
              %(task_type)s, %(sample_type)s, %(priority)s, %(sample_count)s, %(task_status)s, %(arrival_time)s, %(due_time)s,
              %(required_device)s, %(conditions_text)s, %(attachment_path)s, %(remark)s, %(created_at)s, %(updated_at)s
            )
            ON DUPLICATE KEY UPDATE
              task_source_type = VALUES(task_source_type),
              source_system = VALUES(source_system),
              task_name = VALUES(task_name),
              client_name = VALUES(client_name),
              contact_name = VALUES(contact_name),
              contact_phone = VALUES(contact_phone),
              task_type = VALUES(task_type),
              sample_type = VALUES(sample_type),
              priority = VALUES(priority),
              sample_count = VALUES(sample_count),
              task_status = VALUES(task_status),
              arrival_time = VALUES(arrival_time),
              due_time = VALUES(due_time),
              required_device = VALUES(required_device),
              conditions_text = VALUES(conditions_text),
              attachment_path = VALUES(attachment_path),
              remark = VALUES(remark),
              updated_at = VALUES(updated_at)
            """,
            rows,
        )

    def _replace_schedules(self, cursor, schedules: list[dict[str, Any]]) -> None:
        rows = [build_schedule_insert_row(schedule) for schedule in schedules if normalize_text(schedule.get("id"))]
        self._delete_missing_rows(
            cursor,
            table_name="biz_schedule",
            marker_column="schedule_type",
            key_column="schedule_no",
            incoming_keys=[row["schedule_no"] for row in rows],
            marker_value=STORAGE_MARKER,
        )
        if not rows:
            return
        cursor.executemany(
            """
            INSERT INTO biz_schedule (
              schedule_no, task_id, task_no, experiment_no, schedule_type, lab_id, equipment_id, temp_room_id,
              device_name, schedule_start_time, schedule_end_time, planned_hours, schedule_status,
              is_retention, created_by, remark
            ) VALUES (
              %(schedule_no)s, NULL, %(task_no)s, %(experiment_no)s, %(schedule_type)s, NULL, NULL, NULL,
              %(device_name)s, %(schedule_start_time)s, %(schedule_end_time)s, %(planned_hours)s, %(schedule_status)s,
              %(is_retention)s, NULL, %(remark)s
            )
            ON DUPLICATE KEY UPDATE
              task_no = VALUES(task_no),
              experiment_no = VALUES(experiment_no),
              schedule_type = VALUES(schedule_type),
              device_name = VALUES(device_name),
              schedule_start_time = VALUES(schedule_start_time),
              schedule_end_time = VALUES(schedule_end_time),
              planned_hours = VALUES(planned_hours),
              schedule_status = VALUES(schedule_status),
              is_retention = VALUES(is_retention),
              remark = VALUES(remark)
            """,
            rows,
        )

    def _replace_experiments(self, cursor, experiments: list[dict[str, Any]]) -> None:
        rows = [build_experiment_insert_row(experiment) for experiment in experiments if normalize_text(experiment.get("experiment_code"))]
        cursor.execute("DELETE FROM biz_experiment")
        if not rows:
            return
        task_nos = sorted({row["task_no"] for row in rows if row["task_no"]})
        task_map: Dict[str, int] = {}
        if task_nos:
            placeholders = ", ".join(["%s"] * len(task_nos))
            cursor.execute(
                f"SELECT task_id, task_no FROM biz_task WHERE task_no IN ({placeholders})",
                task_nos,
            )
            task_map = {row["task_no"]: row["task_id"] for row in cursor.fetchall()}
        cursor.executemany(
            """
            INSERT INTO biz_experiment (
              experiment_no, task_id, task_no, experiment_name, required_device, priority,
              planned_hours, experiment_status, created_at, updated_at
            ) VALUES (
              %(experiment_no)s, %(task_id)s, %(task_no)s, %(experiment_name)s, %(required_device)s, %(priority)s,
              %(planned_hours)s, %(experiment_status)s, %(created_at)s, %(updated_at)s
            )
            ON DUPLICATE KEY UPDATE
              task_id = VALUES(task_id),
              task_no = VALUES(task_no),
              experiment_name = VALUES(experiment_name),
              required_device = VALUES(required_device),
              priority = VALUES(priority),
              planned_hours = VALUES(planned_hours),
              experiment_status = VALUES(experiment_status),
              updated_at = VALUES(updated_at)
            """,
            [{**row, "task_id": task_map.get(row["task_no"])} for row in rows],
        )

    def _replace_experiment_trays(self, cursor, experiment_trays: list[dict[str, Any]]) -> None:
        rows = [build_experiment_tray_insert_row(relation) for relation in experiment_trays if normalize_text(relation.get("experiment_code"))]
        cursor.execute("DELETE FROM biz_experiment_tray")
        if not rows:
            return
        cursor.executemany(
            """
            INSERT INTO biz_experiment_tray (experiment_no, task_no, tray_no, created_at, updated_at)
            VALUES (%(experiment_no)s, %(task_no)s, %(tray_no)s, %(created_at)s, %(updated_at)s)
            """,
            rows,
        )

    def _replace_experiment_samples(self, cursor, experiment_samples: list[dict[str, Any]]) -> None:
        rows = [
            build_experiment_sample_insert_row(relation)
            for relation in experiment_samples
            if normalize_text(relation.get("experiment_code")) and normalize_text(relation.get("sample_code"))
        ]
        cursor.execute("DELETE FROM biz_experiment_sample")
        if not rows:
            return
        cursor.executemany(
            """
            INSERT INTO biz_experiment_sample (experiment_no, task_no, sample_no, created_at, updated_at)
            VALUES (%(experiment_no)s, %(task_no)s, %(sample_no)s, %(created_at)s, %(updated_at)s)
            """,
            rows,
        )

    def _replace_devices(self, cursor, devices: list[dict[str, Any]]) -> None:
        rows = [build_device_insert_row(device) for device in devices if normalize_text(device.get("code"))]
        self._delete_missing_rows(
            cursor,
            table_name="md_equipment",
            marker_column="manufacturer",
            key_column="equipment_code",
            incoming_keys=[row["equipment_code"] for row in rows],
            marker_value=STORAGE_MARKER,
        )
        if not rows:
            return
        cursor.executemany(
            """
            INSERT INTO md_equipment (
              equipment_code, equipment_name, equipment_type, test_type_id, lab_id, model_no,
              manufacturer, status, acquisition_enabled, next_calibration_date, manager_user_id,
              location_desc, remark
            ) VALUES (
              %(equipment_code)s, %(equipment_name)s, %(equipment_type)s, NULL, NULL, %(model_no)s,
              %(manufacturer)s, %(status)s, %(acquisition_enabled)s, %(next_calibration_date)s, NULL,
              %(location_desc)s, %(remark)s
            )
            ON DUPLICATE KEY UPDATE
              equipment_name = VALUES(equipment_name),
              equipment_type = VALUES(equipment_type),
              model_no = VALUES(model_no),
              manufacturer = VALUES(manufacturer),
              status = VALUES(status),
              acquisition_enabled = VALUES(acquisition_enabled),
              next_calibration_date = VALUES(next_calibration_date),
              location_desc = VALUES(location_desc),
              remark = VALUES(remark)
            """,
            rows,
        )

    def _replace_streams(self, cursor, streams: list[dict[str, Any]]) -> None:
        rows = [build_stream_insert_row(stream) for stream in streams if normalize_text(stream.get("id"))]
        self._delete_missing_rows(
            cursor,
            table_name="biz_data_stream",
            marker_column="remark",
            key_column="stream_no",
            incoming_keys=[row["stream_no"] for row in rows],
            marker_value=STORAGE_MARKER,
        )
        if not rows:
            return
        cursor.executemany(
            """
            INSERT INTO biz_data_stream (
              stream_no, task_id, task_no, equipment_id, equipment_code, device_name,
              last_packet_time, quality_value, stream_status, reported_flag, remark
            ) VALUES (
              %(stream_no)s, NULL, %(task_no)s, NULL, %(equipment_code)s, %(device_name)s,
              %(last_packet_time)s, %(quality_value)s, %(stream_status)s, %(reported_flag)s, %(remark)s
            )
            ON DUPLICATE KEY UPDATE
              task_no = VALUES(task_no),
              equipment_code = VALUES(equipment_code),
              device_name = VALUES(device_name),
              last_packet_time = VALUES(last_packet_time),
              quality_value = VALUES(quality_value),
              stream_status = VALUES(stream_status),
              reported_flag = VALUES(reported_flag),
              remark = VALUES(remark)
            """,
            rows,
        )

    def _replace_samples(self, cursor, samples: list[dict[str, Any]]) -> None:
        managed_samples = [sample for sample in samples if normalize_text(sample.get("code"))]
        sample_rows = [build_sample_insert_row(sample) for sample in managed_samples]
        incoming_sample_codes = [row["sample_no"] for row in sample_rows]

        cursor.execute(
            "SELECT sample_id, sample_no FROM biz_sample WHERE remark LIKE %s",
            (f"{SAMPLE_META_PREFIX}%",),
        )
        existing_sample_rows = cursor.fetchall()
        existing_sample_ids = [row["sample_id"] for row in existing_sample_rows]

        cursor.execute(
            "SELECT tray_id, tray_no FROM biz_tray WHERE remark = %s",
            (TRAY_META_PREFIX,),
        )
        existing_tray_rows = cursor.fetchall()
        existing_tray_ids = [row["tray_id"] for row in existing_tray_rows]

        if existing_sample_ids:
            placeholders = ", ".join(["%s"] * len(existing_sample_ids))
            cursor.execute(
                f"UPDATE biz_sample SET tray_id = NULL WHERE sample_id IN ({placeholders})",
                existing_sample_ids,
            )
            cursor.execute(
                f"DELETE FROM biz_sample_event WHERE sample_id IN ({placeholders})",
                existing_sample_ids,
            )

        if existing_tray_ids:
            placeholders = ", ".join(["%s"] * len(existing_tray_ids))
            cursor.execute(
                f"DELETE FROM biz_tray_item WHERE tray_id IN ({placeholders})",
                existing_tray_ids,
            )

        if incoming_sample_codes:
            placeholders = ", ".join(["%s"] * len(incoming_sample_codes))
            cursor.execute(
                f"DELETE FROM biz_sample WHERE remark LIKE %s AND sample_no NOT IN ({placeholders})",
                [f"{SAMPLE_META_PREFIX}%", *incoming_sample_codes],
            )
        else:
            cursor.execute("DELETE FROM biz_sample WHERE remark LIKE %s", (f"{SAMPLE_META_PREFIX}%",))

        tray_defs: Dict[str, dict[str, Any]] = {}
        tray_order_by_sample: Dict[str, list[str]] = {}
        for sample in managed_samples:
            sample_code = normalize_text(sample.get("code"))
            task_code = normalize_text(sample.get("task_code"))
            for tray in sample.get("trays") or []:
                tray_code = normalize_text(tray.get("tray_code"))
                if not tray_code:
                    continue
                tray_defs.setdefault(
                    tray_code,
                    {
                        "tray_no": tray_code,
                        "task_no": task_code,
                        "capacity": None,
                        "load_qty": 0,
                        "tray_status": "ACTIVE",
                        "test_state": normalize_text(sample.get("status")),
                        "bind_time": parse_storage_datetime(tray.get("created_at")) or parse_storage_datetime(sample.get("updated_at")),
                        "remark": TRAY_META_PREFIX,
                        "samples": [],
                    },
                )
                quantity = parse_int_value(tray.get("quantity")) or 1
                tray_defs[tray_code]["samples"].append((sample_code, quantity, tray))
                tray_defs[tray_code]["load_qty"] += quantity
                tray_defs[tray_code]["capacity"] = max(tray_defs[tray_code]["capacity"] or 0, tray_defs[tray_code]["load_qty"])
                tray_order_by_sample.setdefault(sample_code, [])
                if tray_code not in tray_order_by_sample[sample_code]:
                    tray_order_by_sample[sample_code].append(tray_code)

        incoming_tray_codes = sorted(tray_defs.keys())
        if incoming_tray_codes:
            placeholders = ", ".join(["%s"] * len(incoming_tray_codes))
            cursor.execute(
                f"DELETE FROM biz_tray WHERE remark = %s AND tray_no NOT IN ({placeholders})",
                [TRAY_META_PREFIX, *incoming_tray_codes],
            )
        else:
            cursor.execute("DELETE FROM biz_tray WHERE remark = %s", (TRAY_META_PREFIX,))

        if sample_rows:
            task_nos = sorted({row["task_no"] for row in sample_rows if row["task_no"]})
            task_map: Dict[str, int] = {}
            if task_nos:
                placeholders = ", ".join(["%s"] * len(task_nos))
                cursor.execute(
                    f"SELECT task_id, task_no FROM biz_task WHERE task_no IN ({placeholders})",
                    task_nos,
                )
                task_map = {row["task_no"]: row["task_id"] for row in cursor.fetchall()}

            sample_upsert_rows = []
            for row in sample_rows:
                sample_upsert_rows.append(
                    {
                        **row,
                        "task_id": task_map.get(row["task_no"]),
                    }
                )
            cursor.executemany(
                """
                INSERT INTO biz_sample (
                  sample_no, task_id, tray_id, sample_name, batch_no, sample_type, sample_spec, quantity, unit,
                  sample_status, received_time, arrival_time, storage_condition, barcode_no, location_desc,
                  flow_status, current_owner_id, remark, created_at, updated_at
                ) VALUES (
                  %(sample_no)s, %(task_id)s, NULL, %(sample_name)s, %(batch_no)s, %(sample_type)s, %(sample_spec)s, %(quantity)s, %(unit)s,
                  %(sample_status)s, %(received_time)s, %(arrival_time)s, %(storage_condition)s, %(barcode_no)s, %(location_desc)s,
                  %(flow_status)s, NULL, %(remark)s, %(created_at)s, %(updated_at)s
                )
                ON DUPLICATE KEY UPDATE
                  task_id = VALUES(task_id),
                  tray_id = NULL,
                  sample_name = VALUES(sample_name),
                  batch_no = VALUES(batch_no),
                  sample_type = VALUES(sample_type),
                  sample_spec = VALUES(sample_spec),
                  quantity = VALUES(quantity),
                  unit = VALUES(unit),
                  sample_status = VALUES(sample_status),
                  received_time = VALUES(received_time),
                  arrival_time = VALUES(arrival_time),
                  storage_condition = VALUES(storage_condition),
                  barcode_no = VALUES(barcode_no),
                  location_desc = VALUES(location_desc),
                  flow_status = VALUES(flow_status),
                  current_owner_id = NULL,
                  remark = VALUES(remark),
                  updated_at = VALUES(updated_at)
                """,
                sample_upsert_rows,
            )

        if incoming_sample_codes:
            placeholders = ", ".join(["%s"] * len(incoming_sample_codes))
            cursor.execute(
                f"SELECT sample_id, sample_no, task_id FROM biz_sample WHERE sample_no IN ({placeholders})",
                incoming_sample_codes,
            )
            sample_id_rows = cursor.fetchall()
        else:
            sample_id_rows = []
        sample_id_map = {row["sample_no"]: row["sample_id"] for row in sample_id_rows}
        sample_task_id_map = {row["sample_no"]: row["task_id"] for row in sample_id_rows}

        if tray_defs:
            tray_upsert_rows = []
            for tray_code, tray in tray_defs.items():
                task_id = None
                if tray["task_no"]:
                    task_id = next((sample_task_id_map.get(sample_code) for sample_code, _, _ in tray["samples"] if sample_task_id_map.get(sample_code)), None)
                tray_upsert_rows.append(
                    {
                        "tray_no": tray_code,
                        "task_id": task_id,
                        "tray_type": STORAGE_MARKER,
                        "capacity": tray["capacity"] or tray["load_qty"],
                        "load_qty": tray["load_qty"],
                        "tray_status": tray["tray_status"],
                        "test_state": tray["test_state"],
                        "bind_time": tray["bind_time"],
                        "remark": TRAY_META_PREFIX,
                    }
                )
            cursor.executemany(
                """
                INSERT INTO biz_tray (
                  tray_no, tray_type, task_id, current_temp_room_id, current_lab_id, current_equipment_id,
                  temp_position_no, capacity, load_qty, tray_status, test_state, bind_time, in_temp_room_time,
                  out_temp_room_time, current_barcode_id, unbind_time, last_barcode_print_time, current_owner_id,
                  remark
                ) VALUES (
                  %(tray_no)s, %(tray_type)s, %(task_id)s, NULL, NULL, NULL,
                  NULL, %(capacity)s, %(load_qty)s, %(tray_status)s, %(test_state)s, %(bind_time)s, NULL,
                  NULL, NULL, NULL, NULL, NULL,
                  %(remark)s
                )
                ON DUPLICATE KEY UPDATE
                  tray_type = VALUES(tray_type),
                  task_id = VALUES(task_id),
                  capacity = VALUES(capacity),
                  load_qty = VALUES(load_qty),
                  tray_status = VALUES(tray_status),
                  test_state = VALUES(test_state),
                  bind_time = VALUES(bind_time),
                  remark = VALUES(remark)
                """,
                tray_upsert_rows,
            )

        if incoming_tray_codes:
            placeholders = ", ".join(["%s"] * len(incoming_tray_codes))
            cursor.execute(
                f"SELECT tray_id, tray_no FROM biz_tray WHERE tray_no IN ({placeholders})",
                incoming_tray_codes,
            )
            tray_id_rows = cursor.fetchall()
        else:
            tray_id_rows = []
        tray_id_map = {row["tray_no"]: row["tray_id"] for row in tray_id_rows}

        tray_item_rows = []
        sample_primary_tray_id: Dict[str, int] = {}
        for tray_code, tray in tray_defs.items():
            tray_id = tray_id_map.get(tray_code)
            if not tray_id:
                continue
            for index, (sample_code, quantity, tray_payload) in enumerate(tray["samples"], start=1):
                sample_id = sample_id_map.get(sample_code)
                if not sample_id:
                    continue
                sample_primary_tray_id.setdefault(sample_code, tray_id)
                tray_item_rows.append(
                    {
                        "tray_id": tray_id,
                        "sample_id": sample_id,
                        "position_no": f"P{index:02d}",
                        "quantity": quantity,
                        "bind_time": parse_storage_datetime(tray_payload.get("created_at")) or parse_storage_datetime(tray_payload.get("updated_at")),
                        "status": "ACTIVE",
                        "created_at": parse_storage_datetime(tray_payload.get("created_at")),
                        "updated_at": parse_storage_datetime(tray_payload.get("updated_at")),
                    }
                )
        if tray_item_rows:
            cursor.executemany(
                """
                INSERT INTO biz_tray_item (
                  tray_id, sample_id, position_no, quantity, bind_time, unbind_time, status, created_at, updated_at
                ) VALUES (
                  %(tray_id)s, %(sample_id)s, %(position_no)s, %(quantity)s, %(bind_time)s, NULL, %(status)s,
                  COALESCE(%(created_at)s, CURRENT_TIMESTAMP), COALESCE(%(updated_at)s, CURRENT_TIMESTAMP)
                )
                """,
                tray_item_rows,
            )

        if sample_primary_tray_id:
            cursor.executemany(
                "UPDATE biz_sample SET tray_id = %s WHERE sample_no = %s",
                [(tray_id, sample_no) for sample_no, tray_id in sample_primary_tray_id.items()],
            )

        event_rows = []
        for sample in managed_samples:
            sample_no = normalize_text(sample.get("code"))
            sample_id = sample_id_map.get(sample_no)
            if not sample_id:
                continue
            task_id = sample_task_id_map.get(sample_no)
            for event in sample.get("history") or []:
                event_rows.append(
                    {
                        "sample_id": sample_id,
                        "sample_no": sample_no,
                        "task_id": task_id,
                        "task_no": normalize_text(sample.get("task_code")),
                        "action_type": normalize_text(event.get("action")),
                        "location_desc": normalize_text(event.get("location")),
                        "owner_name": normalize_text(event.get("owner")),
                        "sample_status": normalize_text(event.get("status")),
                        "detail": normalize_text(event.get("detail")),
                        "event_time": parse_storage_datetime(event.get("time")) or parse_storage_datetime(sample.get("updated_at")) or parse_storage_datetime(sample.get("created_at")),
                        "created_at": parse_storage_datetime(event.get("time")) or parse_storage_datetime(sample.get("updated_at")) or parse_storage_datetime(sample.get("created_at")),
                    }
                )
        if event_rows:
            cursor.executemany(
                """
                INSERT INTO biz_sample_event (
                  sample_id, sample_no, task_id, task_no, action_type, location_desc,
                  owner_name, sample_status, detail, event_time, created_at
                ) VALUES (
                  %(sample_id)s, %(sample_no)s, %(task_id)s, %(task_no)s, %(action_type)s, %(location_desc)s,
                  %(owner_name)s, %(sample_status)s, %(detail)s, %(event_time)s, %(created_at)s
                )
                """,
                event_rows,
            )

    def _load_tasks(self, cursor) -> list[dict[str, Any]]:
        cursor.execute(
            """
            SELECT t.task_no, tr.tray_no
            FROM biz_tray tr
            JOIN biz_task t ON t.task_id = tr.task_id
            WHERE tr.remark = %s AND t.source_system = %s
            ORDER BY tr.tray_no ASC
            """,
            (TRAY_META_PREFIX, STORAGE_MARKER),
        )
        tray_map = build_storage_task_tray_codes(cursor.fetchall())
        cursor.execute(
            """
            SELECT task_no, task_name, task_source_type, client_name, contact_name, contact_phone,
                   priority, sample_count, sample_type, task_type, required_device, due_time,
                   arrival_time, conditions_text, attachment_path, remark, task_status, created_at
            FROM biz_task
            WHERE source_system = %s
            ORDER BY created_at DESC, task_no DESC
            """,
            (STORAGE_MARKER,),
        )
        return [build_storage_task_item(row, tray_codes=tray_map.get(row["task_no"])) for row in cursor.fetchall()]

    def _load_schedules(self, cursor) -> list[dict[str, Any]]:
        cursor.execute(
            """
            SELECT schedule_no, task_no, experiment_no, device_name, schedule_start_time, schedule_end_time,
                   planned_hours, schedule_status
            FROM biz_schedule
            WHERE schedule_type = %s
            ORDER BY schedule_start_time DESC, schedule_no DESC
            """,
            (STORAGE_MARKER,),
        )
        return [build_storage_schedule_item(row) for row in cursor.fetchall()]

    def _load_experiments(self, cursor) -> list[dict[str, Any]]:
        cursor.execute(
            """
            SELECT experiment_no, task_no, experiment_name, required_device, priority,
                   planned_hours, experiment_status, created_at, updated_at
            FROM biz_experiment
            ORDER BY task_no ASC, experiment_no ASC
            """
        )
        return [build_storage_experiment_item(row) for row in cursor.fetchall()]

    def _load_experiment_trays(self, cursor) -> list[dict[str, Any]]:
        cursor.execute(
            """
            SELECT relation_id, experiment_no, task_no, tray_no, created_at, updated_at
            FROM biz_experiment_tray
            ORDER BY task_no ASC, experiment_no ASC, tray_no ASC
            """
        )
        return [build_storage_experiment_tray_item(row) for row in cursor.fetchall()]

    def _load_experiment_samples(self, cursor) -> list[dict[str, Any]]:
        cursor.execute(
            """
            SELECT relation_id, experiment_no, task_no, sample_no, created_at, updated_at
            FROM biz_experiment_sample
            ORDER BY task_no ASC, experiment_no ASC, sample_no ASC
            """
        )
        return [build_storage_experiment_sample_item(row) for row in cursor.fetchall()]

    def _load_devices(self, cursor) -> list[dict[str, Any]]:
        cursor.execute(
            """
            SELECT equipment_code, equipment_name, equipment_type, model_no, status,
                   acquisition_enabled, next_calibration_date, location_desc, remark
            FROM md_equipment
            WHERE manufacturer = %s
            ORDER BY equipment_code ASC
            """,
            (STORAGE_MARKER,),
        )
        return [build_storage_device_item(row) for row in cursor.fetchall()]

    def _load_streams(self, cursor) -> list[dict[str, Any]]:
        cursor.execute(
            """
            SELECT stream_no, task_no, equipment_code, device_name, last_packet_time,
                   quality_value, stream_status, reported_flag
            FROM biz_data_stream
            WHERE remark = %s
            ORDER BY last_packet_time DESC, stream_no DESC
            """,
            (STORAGE_MARKER,),
        )
        return [build_storage_stream_item(row) for row in cursor.fetchall()]

    def _load_samples(self, cursor) -> list[dict[str, Any]]:
        cursor.execute(
            """
            SELECT s.sample_id, s.sample_no, t.task_no, s.sample_type, s.batch_no, s.arrival_time,
                   s.quantity, s.storage_condition, s.barcode_no, s.location_desc, s.sample_status,
                   s.flow_status, s.remark, s.created_at, s.updated_at
            FROM biz_sample s
            LEFT JOIN biz_task t ON t.task_id = s.task_id
            WHERE s.remark LIKE %s
            ORDER BY s.created_at DESC, s.sample_no DESC
            """,
            (f"{SAMPLE_META_PREFIX}%",),
        )
        sample_rows = cursor.fetchall()
        if not sample_rows:
            return []

        sample_ids = [row["sample_id"] for row in sample_rows]
        placeholders = ", ".join(["%s"] * len(sample_ids))

        cursor.execute(
            f"""
            SELECT ti.sample_id, tr.tray_no AS tray_code, s.sample_no AS sample_code, ti.quantity, ti.created_at, ti.updated_at
            FROM biz_tray_item ti
            JOIN biz_tray tr ON tr.tray_id = ti.tray_id
            JOIN biz_sample s ON s.sample_id = ti.sample_id
            WHERE ti.sample_id IN ({placeholders})
            ORDER BY ti.created_at DESC, tr.tray_no ASC
            """,
            sample_ids,
        )
        tray_rows = cursor.fetchall()
        tray_map: Dict[int, list[dict[str, Any]]] = {}
        for row in tray_rows:
            tray_map.setdefault(row["sample_id"], []).append(row)

        cursor.execute(
            f"""
            SELECT event_id, sample_id, sample_no, action_type, location_desc, owner_name, sample_status, detail, event_time
            FROM biz_sample_event
            WHERE sample_id IN ({placeholders})
            ORDER BY event_time DESC, event_id DESC
            """,
            sample_ids,
        )
        event_rows = cursor.fetchall()
        event_map: Dict[int, list[dict[str, Any]]] = {}
        for row in event_rows:
            event_map.setdefault(row["sample_id"], []).append(row)

        return [
            build_storage_sample_item(
                row,
                tray_rows=tray_map.get(row["sample_id"], []),
                event_rows=event_map.get(row["sample_id"], []),
            )
            for row in sample_rows
        ]

    def _write_many_internal(self, updates: Dict[str, Any]) -> None:
        self._ensure_schema_extensions()
        relational_updates = {key: updates.get(key) for key in RELATIONAL_STORAGE_KEYS if key in updates}
        snapshot_updates = self._serialize_snapshot_updates(updates)

        with self._connect() as connection:
            with connection.cursor() as cursor:
                if "mes.devices" in relational_updates:
                    self._replace_devices(cursor, relational_updates["mes.devices"] or [])
                if "mes.tasks" in relational_updates:
                    self._replace_tasks(cursor, relational_updates["mes.tasks"] or [], prune=False)
                if "mes.schedules" in relational_updates:
                    self._replace_schedules(cursor, relational_updates["mes.schedules"] or [])
                if "mes.streams" in relational_updates:
                    self._replace_streams(cursor, relational_updates["mes.streams"] or [])
                if "mes.samples" in relational_updates:
                    self._replace_samples(cursor, relational_updates["mes.samples"] or [])
                if "mes.experiments" in relational_updates:
                    self._replace_experiments(cursor, relational_updates["mes.experiments"] or [])
                if "mes.experiment_trays" in relational_updates:
                    self._replace_experiment_trays(cursor, relational_updates["mes.experiment_trays"] or [])
                if "mes.experiment_samples" in relational_updates:
                    self._replace_experiment_samples(cursor, relational_updates["mes.experiment_samples"] or [])
                if "mes.tasks" in relational_updates:
                    self._replace_tasks(cursor, relational_updates["mes.tasks"] or [], prune=True)
            connection.commit()

        if snapshot_updates:
            self._snapshot_repository.write_many(snapshot_updates)

    def read_all(self) -> Dict[str, Any]:
        with self._lock:
            self._ensure_schema_extensions()
            self._ensure_bootstrapped()
            snapshot_values = self._deserialize_snapshot_payloads(self._snapshot_repository.read_all())
            with self._connect() as connection:
                with connection.cursor() as cursor:
                    data = {
                        "mes.tasks": self._load_tasks(cursor),
                        "mes.schedules": self._load_schedules(cursor),
                        "mes.devices": self._load_devices(cursor),
                        "mes.streams": self._load_streams(cursor),
                        "mes.samples": self._load_samples(cursor),
                        "mes.experiments": self._load_experiments(cursor),
                        "mes.experiment_trays": self._load_experiment_trays(cursor),
                        "mes.experiment_samples": self._load_experiment_samples(cursor),
                    }
            data.update(snapshot_values)
            for key in STORAGE_KEYS:
                data.setdefault(key, [])
            data.setdefault(STORAGE_META_KEY, {"schema_version": CURRENT_SCHEMA_VERSION})
            return normalize_storage_payload(data)

    def read(self, key: str) -> Any:
        if key not in STORAGE_KEYS:
            return []
        with self._lock:
            self._ensure_schema_extensions()
            self._ensure_bootstrapped()
            if key in SNAPSHOT_STORAGE_KEYS:
                snapshot_values = self._deserialize_snapshot_payloads(self._snapshot_repository.read_all())
                return snapshot_values.get(key, [])
            with self._connect() as connection:
                with connection.cursor() as cursor:
                    if key == "mes.tasks":
                        return self._load_tasks(cursor)
                    if key == "mes.schedules":
                        return self._load_schedules(cursor)
                    if key == "mes.devices":
                        return self._load_devices(cursor)
                    if key == "mes.streams":
                        return self._load_streams(cursor)
                    if key == "mes.samples":
                        return self._load_samples(cursor)
                    if key == "mes.experiments":
                        return self._load_experiments(cursor)
                    if key == "mes.experiment_trays":
                        return self._load_experiment_trays(cursor)
                    if key == "mes.experiment_samples":
                        return self._load_experiment_samples(cursor)
            return []

    def write(self, key: str, value: Any) -> None:
        self.write_many({key: value})

    def write_many(self, updates: Dict[str, Any]) -> None:
        with self._lock:
            normalized_updates = {
                key: (
                    _normalize_value(key, value if isinstance(value, dict) else {})
                    if key == STORAGE_META_KEY
                    else _normalize_value(key, value if isinstance(value, list) else [])
                )
                for key, value in updates.items()
                if key in STORAGE_KEYS or key == STORAGE_META_KEY
            }
            if not normalized_updates:
                return
            self._write_many_internal(normalize_storage_payload(normalized_updates))
