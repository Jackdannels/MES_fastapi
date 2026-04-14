from __future__ import annotations

import json
import re
from datetime import datetime
from pathlib import Path
from threading import Lock
from typing import Any, Dict, Iterable

from app.core.config import settings
from app.db.mysql_snapshot import MySQLConnectionSettings, MySQLSnapshotRepository

BASE_DIR = Path(__file__).resolve().parents[1]
DEFAULT_STORE_PATH = BASE_DIR / "data" / "mes_store.json"
STORAGE_META_KEY = "mes.meta"
CURRENT_SCHEMA_VERSION = 2
MYSQL_HEALTHCHECK_TIMEOUT_SECONDS = 3
RUNTIME_STORAGE_BACKEND = "mysql"
UNSUPPORTED_RUNTIME_BACKEND_DETAIL = "Only mysql runtime storage is supported"

STORAGE_KEYS: Iterable[str] = (
    "mes.tasks",
    "mes.schedules",
    "mes.experiments",
    "mes.experiment_trays",
    "mes.experiment_samples",
    "mes.samples",
    "mes.staging_events",
    "mes.devices",
    "mes.streams",
    "mes.conflicts",
)
MIN_EXPERIMENTS_PER_TASK = 3
EXPERIMENT_TYPE_OPTIONS: tuple[str, ...] = (
    "冲击试验",
    "振动试验",
    "四综合试验",
    "温度冲击试验",
    "高低温湿热试验",
    "盐雾试验",
    "霉菌试验",
)

SAMPLE_TEXT_REPLACEMENTS: tuple[tuple[str, str], ...] = (
    ("鏍峰搧鐧昏", "样品登记"),
    ("鏍峰搧缂栧彿閲嶆帓", "样品编号重排"),
    ("鏍峰搧缁戝畾浠诲姟", "样品绑定任务"),
    ("浠诲姟鏍峰搧閲嶇粦", "任务样品重绑"),
    ("浠诲姟鏍峰搧鍏ュ簱锛堟帴椹冲尯锛", "任务样品入库（接驳区）"),
    ("閫佽揪鏆傚瓨闂", "送达暂存间"),
    ("閫佽嚦鏆傚瓨闂", "送至暂存间"),
    ("瀹ゅ鎺ラ┏鍖", "室外接驳区"),
    ("瀹ゅ", "室外"),
    ("鎺ラ┏鍖", "接驳区"),
    ("鎭掓俯鎭掓箍闂达紙鏆傚瓨闂达級", "恒温恒湿间（暂存间）"),
    ("鏀舵牱鍙", "收样台"),
    ("鏍峰搧搴", "样品库"),
    ("宸叉帴鏀", "已接收"),
    ("宸插叆搴", "已入库"),
    ("杩愯緭涓", "运输中"),
    ("鍒拌揣", "到货"),
    ("浠诲姟 ", "任务 "),
)

CANONICAL_RUNNING_STATUS = "实验进行中"
CANONICAL_COMPLETED_STATUS = "实验已完成"
CANONICAL_TASK_RUNNING_STATUS = "任务进行中"
CANONICAL_TASK_COMPLETED_STATUS = "任务已完成"
LEGACY_RUNNING_STATUSES = {"实验中"}
LEGACY_COMPLETED_STATUSES = {"实验完成", "实验已经完成"}
STATUS_VALUE_KEYS = {"status", "flow_status", "task_status", "experiment_status", "schedule_status", "sample_status"}


def _default_store() -> Dict[str, Any]:
    return {
        **{key: [] for key in STORAGE_KEYS},
        STORAGE_META_KEY: {"schema_version": CURRENT_SCHEMA_VERSION},
    }


def _sanitize_sample_text(value: str) -> str:
    text = str(value)
    for source, target in SAMPLE_TEXT_REPLACEMENTS:
        text = text.replace(source, target)
    return text.rstrip("�?")


def normalize_experiment_status_text(value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    if text == CANONICAL_RUNNING_STATUS or text in LEGACY_RUNNING_STATUSES:
        return CANONICAL_RUNNING_STATUS
    if text == CANONICAL_COMPLETED_STATUS or text in LEGACY_COMPLETED_STATUSES:
        return CANONICAL_COMPLETED_STATUS
    return text


def normalize_task_status_text(value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    if text in {CANONICAL_TASK_RUNNING_STATUS, CANONICAL_RUNNING_STATUS, *LEGACY_RUNNING_STATUSES}:
        return CANONICAL_TASK_RUNNING_STATUS
    if text in {CANONICAL_TASK_COMPLETED_STATUS, CANONICAL_COMPLETED_STATUS, *LEGACY_COMPLETED_STATUSES}:
        return CANONICAL_TASK_COMPLETED_STATUS
    return text


def normalize_experiment_detail_text(value: Any) -> str:
    text = str(value or "")
    if not text:
        return ""
    for source in LEGACY_RUNNING_STATUSES:
        text = text.replace(source, CANONICAL_RUNNING_STATUS)
    for source in LEGACY_COMPLETED_STATUSES:
        text = text.replace(source, CANONICAL_COMPLETED_STATUS)
    return text


def _normalize_status_collection(value: Any, *, field_name: str = "", status_scope: str = "experiment") -> Any:
    if isinstance(value, list):
        return [_normalize_status_collection(item, status_scope=status_scope) for item in value]
    if isinstance(value, dict):
        return {key: _normalize_status_collection(entry, field_name=key, status_scope=status_scope) for key, entry in value.items()}
    if isinstance(value, str):
        if field_name in STATUS_VALUE_KEYS:
            return normalize_task_status_text(value) if status_scope == "task" else normalize_experiment_status_text(value)
        if field_name == "detail":
            return normalize_experiment_detail_text(value)
    return value


def _sanitize_sample_collection(value: Any) -> Any:
    if isinstance(value, list):
        return [_sanitize_sample_collection(item) for item in value]
    if isinstance(value, dict):
        return {key: _sanitize_sample_collection(entry) for key, entry in value.items()}
    if isinstance(value, str):
        return _sanitize_sample_text(value)
    return value


def _parse_storage_datetime(value: Any) -> datetime | None:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).replace(tzinfo=None)
    except ValueError:
        pass
    for pattern in ("%Y-%m-%d %H:%M", "%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M", "%Y-%m-%dT%H:%M:%S"):
        try:
            return datetime.strptime(text, pattern)
        except ValueError:
            continue
    return None


def _normalize_meta(value: Any) -> dict[str, Any]:
    meta = dict(value) if isinstance(value, dict) else {}
    schema_version = meta.get("schema_version")
    try:
        meta["schema_version"] = int(schema_version)
    except (TypeError, ValueError):
        meta["schema_version"] = 0
    return meta


def _resolve_experiment_count(task: dict[str, Any], explicit_count: int) -> int:
    if explicit_count > 0:
        return max(explicit_count, MIN_EXPERIMENTS_PER_TASK)
    raw_codes = task.get("experiment_codes")
    if isinstance(raw_codes, list):
        normalized_codes = [str(code or "").strip() for code in raw_codes if str(code or "").strip()]
        if normalized_codes:
            return max(len(normalized_codes), MIN_EXPERIMENTS_PER_TASK)
    try:
        explicit_task_count = int(task.get("experiment_count") or 0)
    except (TypeError, ValueError):
        explicit_task_count = 0
    if explicit_task_count > 0:
        return max(explicit_task_count, MIN_EXPERIMENTS_PER_TASK)
    return MIN_EXPERIMENTS_PER_TASK


def _build_experiment_types(task_type: str, count: int) -> list[str]:
    base_type = str(task_type or "").strip()
    types: list[str] = []
    for candidate in re.split(r"[/、,，;；]+", base_type):
        normalized = candidate.strip()
        if normalized and normalized not in types:
            types.append(normalized)
    for experiment_type in EXPERIMENT_TYPE_OPTIONS:
        if len(types) >= count:
            break
        if experiment_type not in types:
            types.append(experiment_type)
    while len(types) < count:
        types.append(base_type or EXPERIMENT_TYPE_OPTIONS[0])
    return types


def _build_experiment_codes(task_code: str, count: int, seed_codes: list[str] | None = None) -> list[str]:
    normalized_task_code = str(task_code or "").strip() or "TASK"
    codes: list[str] = []
    seen: set[str] = set()

    for code in seed_codes or []:
        normalized_code = str(code or "").strip()
        if normalized_code and normalized_code not in seen:
            codes.append(normalized_code)
            seen.add(normalized_code)

    suffix_index = 0
    while len(codes) < count:
        suffix = chr(65 + suffix_index)
        suffix_index += 1
        next_code = f"{normalized_task_code}-{suffix}"
        if next_code in seen:
            continue
        codes.append(next_code)
        seen.add(next_code)
    return codes[:count]


def _ensure_task_experiment_rows(payload: Dict[str, Any]) -> tuple[Dict[str, Any], bool]:
    normalized = dict(payload)
    tasks = [dict(task) for task in (normalized.get("mes.tasks") if isinstance(normalized.get("mes.tasks"), list) else [])]
    experiments = [dict(experiment) for experiment in (normalized.get("mes.experiments") if isinstance(normalized.get("mes.experiments"), list) else [])]
    if not tasks:
        return normalized, False

    experiments_by_task: dict[str, list[dict[str, Any]]] = {}
    for experiment in experiments:
        task_code = str(experiment.get("task_code") or "").strip()
        if not task_code:
            continue
        experiments_by_task.setdefault(task_code, []).append(experiment)

    task_codes = {str(task.get("code") or "").strip() for task in tasks if str(task.get("code") or "").strip()}
    next_experiments: list[dict[str, Any]] = [dict(experiment) for experiment in experiments if str(experiment.get("task_code") or "").strip() not in task_codes]
    changed = False

    for task in tasks:
        task_code = str(task.get("code") or "").strip()
        if not task_code:
            continue
        existing_list = list(experiments_by_task.get(task_code, []))
        existing_codes = [
            str(experiment.get("experiment_code") or "").strip()
            for experiment in existing_list
            if str(experiment.get("experiment_code") or "").strip()
        ]
        explicit_codes = [
            str(code or "").strip()
            for code in (task.get("experiment_codes") if isinstance(task.get("experiment_codes"), list) else [])
            if str(code or "").strip()
        ]
        desired_count = _resolve_experiment_count(task, len(existing_list))
        experiment_codes = _build_experiment_codes(task_code, desired_count, explicit_codes or existing_codes)
        experiment_types = _build_experiment_types(
            str(task.get("test_type") or task.get("required_device") or task.get("name") or "").strip(),
            desired_count,
        )
        existing_by_code = {
            str(experiment.get("experiment_code") or "").strip(): dict(experiment)
            for experiment in existing_list
        }

        normalized_experiments: list[dict[str, Any]] = []
        for index, experiment_code in enumerate(experiment_codes):
            source = existing_by_code.get(experiment_code, {})
            experiment_name = str(source.get("experiment_name") or "").strip()
            required_device = str(source.get("required_device") or "").strip() or experiment_types[index]
            if not experiment_name or re.fullmatch(r"[A-Z]实验", experiment_name):
                experiment_name = required_device
            normalized_experiments.append(
                {
                    **source,
                    "id": str(source.get("id") or "").strip() or experiment_code,
                    "task_code": task_code,
                    "experiment_code": experiment_code,
                    "experiment_name": experiment_name,
                    "required_device": required_device,
                    "priority": source.get("priority") if source.get("priority") is not None else task.get("priority", ""),
                    "planned_hours": source.get("planned_hours", 0),
                    "status": str(source.get("status") or task.get("status") or "待排程").strip(),
                    "created_at": source.get("created_at") or task.get("created_at"),
                    "updated_at": source.get("updated_at") or task.get("updated_at") or task.get("created_at"),
                }
            )

        if task.get("experiment_codes") != experiment_codes:
            task["experiment_codes"] = experiment_codes
            changed = True
        if task.get("experiment_count") != len(experiment_codes):
            task["experiment_count"] = len(experiment_codes)
            changed = True
        if normalized_experiments != existing_list:
            changed = True
        next_experiments.extend(normalized_experiments)

    if changed:
        normalized["mes.tasks"] = tasks
        normalized["mes.experiments"] = next_experiments
    return normalized, changed


def _normalize_value(key: str, value: Any) -> Any:
    if key == "mes.samples" and isinstance(value, list):
        return _normalize_status_collection(_sanitize_sample_collection(value), status_scope="experiment")
    if key == "mes.tasks" and isinstance(value, list):
        return _normalize_status_collection(value, status_scope="task")
    if key in {"mes.schedules", "mes.experiments"} and isinstance(value, list):
        return _normalize_status_collection(value, status_scope="experiment")
    if key == STORAGE_META_KEY:
        return _normalize_meta(value)
    return value


def _normalize_payload(payload: Dict[str, Any]) -> tuple[Dict[str, Any], bool]:
    normalized = dict(payload)
    changed = False
    for key in STORAGE_KEYS:
        existing_value = normalized.get(key, [])
        normalized_value = _normalize_value(key, existing_value)
        if normalized_value != existing_value:
            normalized[key] = normalized_value
            changed = True
        elif key not in normalized:
            normalized[key] = []
            changed = True
    existing_meta = normalized.get(STORAGE_META_KEY, {})
    normalized_meta = _normalize_meta(existing_meta)
    if normalized_meta != existing_meta:
        normalized[STORAGE_META_KEY] = normalized_meta
        changed = True
    elif STORAGE_META_KEY not in normalized:
        normalized[STORAGE_META_KEY] = normalized_meta
        changed = True
    if normalized_meta.get("schema_version", 0) < CURRENT_SCHEMA_VERSION:
        normalized[STORAGE_META_KEY] = {"schema_version": CURRENT_SCHEMA_VERSION}
        changed = True
    normalized, experiment_changed = _ensure_task_experiment_rows(normalized)
    if experiment_changed:
        changed = True
    return normalized, changed


def normalize_storage_payload(payload: Dict[str, Any]) -> Dict[str, Any]:
    normalized, _changed = _normalize_payload(payload)
    return normalized


class StorageBackend:
    """Storage backend interface for future database migration."""

    def read_all(self) -> Dict[str, Any]:
        raise NotImplementedError

    def read(self, key: str) -> Any:
        raise NotImplementedError

    def write(self, key: str, value: Any) -> None:
        raise NotImplementedError

    def write_many(self, updates: Dict[str, Any]) -> None:
        raise NotImplementedError


class DatabaseStorageBackend(StorageBackend):
    def __init__(self, repository, bootstrap_storage: StorageBackend | None = None) -> None:
        self._repository = repository
        self._bootstrap_storage = bootstrap_storage
        self._lock = Lock()

    def _deserialize_payloads(self, payloads: Dict[str, str]) -> Dict[str, Any]:
        normalized: Dict[str, Any] = {}
        for key in STORAGE_KEYS:
            raw_value = payloads.get(key)
            try:
                parsed = json.loads(raw_value) if raw_value else []
            except json.JSONDecodeError:
                parsed = []
            normalized[key] = _normalize_value(key, parsed if isinstance(parsed, list) else [])
        meta_payload = payloads.get(STORAGE_META_KEY)
        try:
            parsed_meta = json.loads(meta_payload) if meta_payload else {}
        except json.JSONDecodeError:
            parsed_meta = {}
        normalized[STORAGE_META_KEY] = _normalize_value(STORAGE_META_KEY, parsed_meta if isinstance(parsed_meta, dict) else {})
        normalized, _ = _normalize_payload(normalized)
        return normalized

    def _serialize_updates(self, updates: Dict[str, Any]) -> Dict[str, str]:
        serialized: Dict[str, str] = {}
        for key, value in updates.items():
            if key not in STORAGE_KEYS and key != STORAGE_META_KEY:
                continue
            if key == STORAGE_META_KEY:
                normalized = _normalize_value(key, value if isinstance(value, dict) else {})
            else:
                normalized = _normalize_value(key, value if isinstance(value, list) else [])
            serialized[key] = json.dumps(normalized, ensure_ascii=False)
        return serialized

    def _ensure_bootstrapped(self) -> Dict[str, str]:
        payloads = self._repository.read_all()
        if payloads or self._bootstrap_storage is None:
            return payloads
        bootstrap_payload = self._bootstrap_storage.read_all()
        serialized = self._serialize_updates(bootstrap_payload)
        self._repository.write_many(serialized)
        return self._repository.read_all()

    def read_all(self) -> Dict[str, Any]:
        with self._lock:
            payloads = self._ensure_bootstrapped()
            return self._deserialize_payloads(payloads)

    def read(self, key: str) -> Any:
        with self._lock:
            if key not in STORAGE_KEYS:
                return []
            payloads = self._ensure_bootstrapped()
            return self._deserialize_payloads(payloads).get(key, [])

    def write(self, key: str, value: Any) -> None:
        self.write_many({key: value})

    def write_many(self, updates: Dict[str, Any]) -> None:
        with self._lock:
            serialized = self._serialize_updates(updates)
            if not serialized:
                return
            self._repository.write_many(serialized)


class JsonFileStorage(StorageBackend):
    def __init__(self, path: Path) -> None:
        self._path = path
        self._lock = Lock()
        self._ensure_file()

    def _ensure_file(self) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        if self._path.exists():
            return
        self._write_file(_default_store())

    def _load_file(self) -> tuple[Dict[str, Any], bool]:
        try:
            content = self._path.read_text(encoding="utf-8")
            payload = json.loads(content)
        except Exception:
            payload = {}
        if not isinstance(payload, dict):
            payload = {}
        return _normalize_payload(payload)

    def _write_file(self, payload: Dict[str, Any]) -> None:
        data = dict(payload)
        for key in STORAGE_KEYS:
            data.setdefault(key, [])
        data.setdefault(STORAGE_META_KEY, {"schema_version": CURRENT_SCHEMA_VERSION})
        tmp_path = self._path.with_suffix(".tmp")
        tmp_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp_path.replace(self._path)

    def read_all(self) -> Dict[str, Any]:
        with self._lock:
            payload, changed = self._load_file()
            if changed:
                self._write_file(payload)
            return payload

    def read(self, key: str) -> Any:
        with self._lock:
            payload, changed = self._load_file()
            if changed:
                self._write_file(payload)
            return payload.get(key, [])

    def write(self, key: str, value: Any) -> None:
        with self._lock:
            payload, _ = self._load_file()
            payload[key] = _normalize_value(key, value)
            self._write_file(payload)

    def write_many(self, updates: Dict[str, Any]) -> None:
        with self._lock:
            payload, _ = self._load_file()
            payload.update({key: _normalize_value(key, value) for key, value in updates.items()})
            self._write_file(payload)


_storage_backend: StorageBackend | None = None


def _backend_name(backend: StorageBackend | None) -> str | None:
    if backend is None:
        return None
    if isinstance(backend, JsonFileStorage):
        return "json"
    if backend.__class__.__name__ == "MySQLMesStorageBackend":
        return "mysql"
    if isinstance(backend, DatabaseStorageBackend):
        return "database"
    return backend.__class__.__name__.lower()


def check_mysql_storage_connection() -> Dict[str, Any]:
    try:
        import pymysql
    except ImportError:
        return {
            "status": "unhealthy",
            "detail": "pymysql is required for the MySQL storage backend",
        }

    connection = None
    try:
        connection = pymysql.connect(
            host=settings.MYSQL_HOST,
            port=settings.MYSQL_PORT,
            user=settings.MYSQL_USER,
            password=settings.MYSQL_PASSWORD,
            database=settings.MYSQL_DATABASE,
            charset="utf8mb4",
            autocommit=True,
            connect_timeout=MYSQL_HEALTHCHECK_TIMEOUT_SECONDS,
            read_timeout=MYSQL_HEALTHCHECK_TIMEOUT_SECONDS,
            write_timeout=MYSQL_HEALTHCHECK_TIMEOUT_SECONDS,
        )
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
            row = cursor.fetchone()
    except Exception as exc:
        return {
            "status": "unhealthy",
            "detail": str(exc),
        }
    finally:
        if connection is not None:
            connection.close()

    result = row[0] if isinstance(row, (list, tuple)) and row else row
    return {
        "status": "ok",
        "result": result,
        "database": settings.MYSQL_DATABASE,
        "host": settings.MYSQL_HOST,
        "port": settings.MYSQL_PORT,
    }


def get_storage_health_report() -> Dict[str, Any]:
    configured_backend = settings.STORAGE_BACKEND.strip().lower() or RUNTIME_STORAGE_BACKEND
    mysql_report = check_mysql_storage_connection()
    report: Dict[str, Any] = {
        "status": "ok",
        "configured_backend": configured_backend,
        "active_backend": _backend_name(_storage_backend),
        "database": {"status": "not_checked"},
        "mysql": mysql_report,
        "bootstrap": {
            "from_json_enabled": False,
            "source_path": str(DEFAULT_STORE_PATH),
            "last_result": "disabled",
        },
    }

    if configured_backend == RUNTIME_STORAGE_BACKEND:
        report["database"] = mysql_report
        if report["database"].get("status") != "ok":
            report["status"] = "unhealthy"
    else:
        report["status"] = "unhealthy"
        report["active_backend"] = None
        report["database"] = {
            "status": "unsupported",
            "detail": UNSUPPORTED_RUNTIME_BACKEND_DETAIL,
        }
        report["bootstrap"]["last_result"] = "unsupported_runtime_backend"

    return report


def get_storage_backend() -> StorageBackend:
    global _storage_backend
    if _storage_backend is None:
        backend_name = settings.STORAGE_BACKEND.strip().lower() or RUNTIME_STORAGE_BACKEND
        if backend_name != RUNTIME_STORAGE_BACKEND:
            raise RuntimeError(UNSUPPORTED_RUNTIME_BACKEND_DETAIL)

        from app.core.mysql_storage_backend import MySQLMesStorageBackend

        connection_settings = MySQLConnectionSettings(
            host=settings.MYSQL_HOST,
            port=settings.MYSQL_PORT,
            user=settings.MYSQL_USER,
            password=settings.MYSQL_PASSWORD,
            database=settings.MYSQL_DATABASE,
        )
        repository = MySQLSnapshotRepository(connection_settings)
        _storage_backend = MySQLMesStorageBackend(
            connection_settings,
            repository,
            bootstrap_storage=None,
        )
    return _storage_backend
