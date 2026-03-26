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

STORAGE_KEYS: Iterable[str] = (
    "mes.tasks",
    "mes.schedules",
    "mes.experiments",
    "mes.experiment_trays",
    "mes.samples",
    "mes.devices",
    "mes.streams",
    "mes.conflicts",
)
SYLU_TASK_PATTERN = re.compile(r"^SYLU-(\d{4})-(\d{2})-(\d{3})$")
LEGACY_TASK_PATTERN = re.compile(r"^[A-Z]+-\d{4}-\d{3}$")
EXPERIMENT_SUFFIX_PATTERN = re.compile(r"-([A-Z]+)$")
SAMPLE_SUFFIX_PATTERN = re.compile(r"-SP-(\d+)$")
TRAY_SUFFIX_PATTERN = re.compile(r"-TP-(\d+)$")
LEGACY_MULTI_EXPERIMENT_TASK_COUNTS: dict[str, int] = {
    "GDW-2024-005": 3,
}
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


def _is_sylu_task_code(value: Any) -> bool:
    return bool(SYLU_TASK_PATTERN.match(str(value or "").strip()))


def _is_legacy_mes_task_code(value: Any) -> bool:
    return bool(LEGACY_TASK_PATTERN.match(str(value or "").strip()))


def _extract_experiment_suffix(value: Any, fallback_index: int) -> str:
    text = str(value or "").strip()
    match = EXPERIMENT_SUFFIX_PATTERN.search(text)
    if match:
        return match.group(1)
    return chr(65 + fallback_index)


def _extract_numeric_suffix(value: Any, pattern: re.Pattern[str], fallback_index: int) -> str:
    text = str(value or "").strip()
    match = pattern.search(text)
    if match:
        return match.group(1)
    return str(fallback_index + 1).zfill(3)


def _task_sort_key(task: dict[str, Any]) -> tuple[str, datetime, str]:
    task_date = (
        _parse_storage_datetime(task.get("arrival_at"))
        or _parse_storage_datetime(task.get("created_at"))
        or _parse_storage_datetime(task.get("due_at"))
        or datetime(2026, 1, 1)
    )
    return (task_date.strftime("%Y-%m"), task_date, str(task.get("code") or "").strip())


def _replace_strings(value: Any, replacements: dict[str, str]) -> Any:
    if isinstance(value, list):
        return [_replace_strings(item, replacements) for item in value]
    if isinstance(value, dict):
        return {key: _replace_strings(item, replacements) for key, item in value.items()}
    if isinstance(value, str):
        text = value
        for source, target in replacements.items():
            if source:
                text = text.replace(source, target)
        return text
    return value


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
    return max(LEGACY_MULTI_EXPERIMENT_TASK_COUNTS.get(str(task.get("code") or "").strip(), 1), MIN_EXPERIMENTS_PER_TASK)


def _build_experiment_types(task_type: str, count: int) -> list[str]:
    base_type = str(task_type or "").strip()
    types: list[str] = []
    if base_type:
        types.append(base_type)
    for experiment_type in EXPERIMENT_TYPE_OPTIONS:
        if len(types) >= count:
            break
        if experiment_type not in types:
            types.append(experiment_type)
    while len(types) < count:
        types.append(base_type or EXPERIMENT_TYPE_OPTIONS[0])
    return types


def _migrate_payload_to_sylu(payload: Dict[str, Any]) -> Dict[str, Any]:
    tasks = [dict(task) for task in (payload.get("mes.tasks") if isinstance(payload.get("mes.tasks"), list) else [])]
    samples = [dict(sample) for sample in (payload.get("mes.samples") if isinstance(payload.get("mes.samples"), list) else [])]
    schedules = [dict(schedule) for schedule in (payload.get("mes.schedules") if isinstance(payload.get("mes.schedules"), list) else [])]
    experiments = [dict(experiment) for experiment in (payload.get("mes.experiments") if isinstance(payload.get("mes.experiments"), list) else [])]
    experiment_trays = [dict(relation) for relation in (payload.get("mes.experiment_trays") if isinstance(payload.get("mes.experiment_trays"), list) else [])]
    streams = [dict(stream) for stream in (payload.get("mes.streams") if isinstance(payload.get("mes.streams"), list) else [])]

    legacy_codes = {str(task.get("code") or "").strip() for task in tasks if str(task.get("code") or "").strip()}
    if not legacy_codes:
        migrated = dict(payload)
        migrated[STORAGE_META_KEY] = {"schema_version": CURRENT_SCHEMA_VERSION}
        return migrated

    reserved_sequence_by_month: dict[str, int] = {}
    task_code_map: dict[str, str] = {}
    for task in tasks:
        legacy_code = str(task.get("code") or "").strip()
        match = SYLU_TASK_PATTERN.match(legacy_code)
        if not match:
            continue
        month_key = f"{match.group(1)}-{match.group(2)}"
        reserved_sequence_by_month[month_key] = max(reserved_sequence_by_month.get(month_key, 0), int(match.group(3)))
        task_code_map[legacy_code] = legacy_code

    for task in sorted(tasks, key=_task_sort_key):
        legacy_code = str(task.get("code") or "").strip()
        if not legacy_code or legacy_code in task_code_map:
            continue
        task_date = (
            _parse_storage_datetime(task.get("arrival_at"))
            or _parse_storage_datetime(task.get("created_at"))
            or _parse_storage_datetime(task.get("due_at"))
            or datetime(2026, 1, 1)
        )
        month_key = task_date.strftime("%Y-%m")
        next_sequence = reserved_sequence_by_month.get(month_key, 0) + 1
        reserved_sequence_by_month[month_key] = next_sequence
        task_code_map[legacy_code] = f"SYLU-{task_date.year:04d}-{task_date.month:02d}-{next_sequence:03d}"

    sample_code_map: dict[str, str] = {}
    for task_code, migrated_task_code in task_code_map.items():
        task_samples = [sample for sample in samples if str(sample.get("task_code") or "").strip() == task_code]
        task_samples.sort(key=lambda sample: (_parse_storage_datetime(sample.get("created_at")) or datetime(2026, 1, 1), str(sample.get("code") or "").strip()))
        for index, sample in enumerate(task_samples):
            sample_code = str(sample.get("code") or "").strip()
            if not sample_code:
                continue
            sample_suffix = _extract_numeric_suffix(sample_code, SAMPLE_SUFFIX_PATTERN, index)
            sample_code_map[sample_code] = f"{migrated_task_code}-SP-{sample_suffix.zfill(3)}"

    tray_code_map: dict[str, str] = {}
    task_tray_codes: dict[str, list[str]] = {}

    def remember_tray_code(task_code: str, tray_code: str) -> None:
        normalized_task_code = str(task_code or "").strip()
        normalized_tray_code = str(tray_code or "").strip()
        if not normalized_task_code or not normalized_tray_code:
            return
        task_tray_codes.setdefault(normalized_task_code, [])
        if normalized_tray_code not in task_tray_codes[normalized_task_code]:
            task_tray_codes[normalized_task_code].append(normalized_tray_code)

    for task in tasks:
        for tray_code in task.get("tray_codes") or []:
            remember_tray_code(task.get("code"), tray_code)
    for sample in samples:
        for tray in sample.get("trays") or []:
            remember_tray_code(sample.get("task_code"), tray.get("tray_code"))
    for relation in experiment_trays:
        remember_tray_code(relation.get("task_code"), relation.get("tray_code"))

    for legacy_task_code, tray_codes in task_tray_codes.items():
        migrated_task_code = task_code_map.get(legacy_task_code, legacy_task_code)
        for index, tray_code in enumerate(sorted(tray_codes)):
            tray_suffix = _extract_numeric_suffix(tray_code, TRAY_SUFFIX_PATTERN, index)
            tray_code_map[tray_code] = f"{migrated_task_code}-TP-{tray_suffix.zfill(3)}"

    experiments_by_task: dict[str, list[dict[str, Any]]] = {}
    for experiment in experiments:
        experiments_by_task.setdefault(str(experiment.get("task_code") or "").strip(), []).append(experiment)

    experiment_code_map: dict[str, str] = {}
    migrated_experiments: list[dict[str, Any]] = []
    for task in sorted(tasks, key=_task_sort_key):
        legacy_task_code = str(task.get("code") or "").strip()
        migrated_task_code = task_code_map.get(legacy_task_code, legacy_task_code)
        explicit_experiments = list(experiments_by_task.get(legacy_task_code, []))
        explicit_experiments.sort(key=lambda item: str(item.get("experiment_code") or "").strip())
        experiment_count = _resolve_experiment_count(task, len(explicit_experiments))
        experiment_types = _build_experiment_types(str(task.get("test_type") or task.get("required_device") or "").strip(), experiment_count)

        if not explicit_experiments:
            explicit_experiments = [
                {
                    "id": f"{legacy_task_code}-experiment-{index + 1}",
                    "task_code": legacy_task_code,
                    "experiment_code": f"{legacy_task_code}-{chr(65 + index)}",
                    "experiment_name": experiment_types[index],
                    "required_device": experiment_types[index],
                    "priority": task.get("priority", ""),
                    "planned_hours": 0,
                    "status": task.get("status", "待排程"),
                    "created_at": task.get("created_at"),
                    "updated_at": task.get("updated_at") or task.get("created_at"),
                }
                for index in range(experiment_count)
            ]

        for index, experiment in enumerate(explicit_experiments):
            suffix = _extract_experiment_suffix(experiment.get("experiment_code"), index)
            migrated_experiment_code = f"{migrated_task_code}-{suffix}"
            required_device = str(experiment.get("required_device") or "").strip() or experiment_types[index]
            experiment_name = str(experiment.get("experiment_name") or "").strip()
            if not experiment_name or re.fullmatch(r"[A-Z]实验", experiment_name):
                experiment_name = required_device
            experiment_code_map[str(experiment.get("experiment_code") or "").strip()] = migrated_experiment_code
            migrated_experiments.append(
                {
                    **experiment,
                    "id": migrated_experiment_code,
                    "task_code": migrated_task_code,
                    "experiment_code": migrated_experiment_code,
                    "experiment_name": experiment_name,
                    "required_device": required_device,
                }
            )

    task_experiment_codes: dict[str, list[str]] = {}
    for experiment in migrated_experiments:
        task_experiment_codes.setdefault(str(experiment.get("task_code") or "").strip(), []).append(str(experiment.get("experiment_code") or "").strip())

    for task in tasks:
        legacy_task_code = str(task.get("code") or "").strip()
        migrated_task_code = task_code_map.get(legacy_task_code, legacy_task_code)
        task["code"] = migrated_task_code
        task["id"] = task.get("id") or migrated_task_code
        task["experiment_codes"] = task_experiment_codes.get(migrated_task_code, [])
        task["experiment_count"] = len(task["experiment_codes"])
        task["tray_codes"] = [
            tray_code_map.get(str(tray_code or "").strip(), str(tray_code or "").strip())
            for tray_code in (task.get("tray_codes") or [])
        ]

    for sample in samples:
        legacy_task_code = str(sample.get("task_code") or "").strip()
        sample["task_code"] = task_code_map.get(legacy_task_code, legacy_task_code)
        sample["code"] = sample_code_map.get(str(sample.get("code") or "").strip(), str(sample.get("code") or "").strip())
        sample["trays"] = [
            {
                **tray,
                "tray_code": tray_code_map.get(str(tray.get("tray_code") or "").strip(), str(tray.get("tray_code") or "").strip()),
                "sample_code": sample_code_map.get(str(tray.get("sample_code") or "").strip(), sample["code"]),
            }
            for tray in (sample.get("trays") or [])
        ]

    for schedule in schedules:
        legacy_task_code = str(schedule.get("task_code") or "").strip()
        migrated_task_code = task_code_map.get(legacy_task_code, legacy_task_code)
        schedule["task_code"] = migrated_task_code
        legacy_experiment_code = str(schedule.get("experiment_code") or "").strip()
        migrated_experiment_code = experiment_code_map.get(legacy_experiment_code, "")
        if not migrated_experiment_code and legacy_experiment_code:
            suffix = _extract_experiment_suffix(legacy_experiment_code, 0)
            candidate_code = f"{migrated_task_code}-{suffix}"
            if candidate_code in task_experiment_codes.get(migrated_task_code, []):
                migrated_experiment_code = candidate_code
        if not migrated_experiment_code and task_experiment_codes.get(migrated_task_code):
            migrated_experiment_code = task_experiment_codes[migrated_task_code][0]
        schedule["experiment_code"] = migrated_experiment_code

    for relation in experiment_trays:
        legacy_task_code = str(relation.get("task_code") or "").strip()
        relation["task_code"] = task_code_map.get(legacy_task_code, legacy_task_code)
        relation["experiment_code"] = experiment_code_map.get(
            str(relation.get("experiment_code") or "").strip(),
            str(relation.get("experiment_code") or "").strip(),
        )
        relation["tray_code"] = tray_code_map.get(str(relation.get("tray_code") or "").strip(), str(relation.get("tray_code") or "").strip())

    for stream in streams:
        legacy_task_code = str(stream.get("task_code") or "").strip()
        stream["task_code"] = task_code_map.get(legacy_task_code, legacy_task_code)

    replacements = {
        **task_code_map,
        **sample_code_map,
        **tray_code_map,
        **experiment_code_map,
    }

    migrated_payload = dict(payload)
    migrated_payload["mes.tasks"] = _replace_strings(tasks, replacements)
    migrated_payload["mes.samples"] = _replace_strings(samples, replacements)
    migrated_payload["mes.schedules"] = _replace_strings(schedules, replacements)
    migrated_payload["mes.experiments"] = _replace_strings(migrated_experiments, replacements)
    migrated_payload["mes.experiment_trays"] = _replace_strings(experiment_trays, replacements)
    migrated_payload["mes.streams"] = _replace_strings(streams, replacements)
    migrated_payload[STORAGE_META_KEY] = {"schema_version": CURRENT_SCHEMA_VERSION}
    return migrated_payload


def _normalize_value(key: str, value: Any) -> Any:
    if key == "mes.samples" and isinstance(value, list):
        return _sanitize_sample_collection(value)
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
    if any(
        not _is_sylu_task_code(task.get("code")) and _is_legacy_mes_task_code(task.get("code"))
        for task in normalized.get("mes.tasks", [])
        if isinstance(task, dict) and str(task.get("code") or "").strip()
    ):
        normalized = _migrate_payload_to_sylu(normalized)
        changed = True
    elif normalized_meta.get("schema_version", 0) < CURRENT_SCHEMA_VERSION:
        normalized[STORAGE_META_KEY] = {"schema_version": CURRENT_SCHEMA_VERSION}
        changed = True
    return normalized, changed


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


def get_storage_backend() -> StorageBackend:
    global _storage_backend
    if _storage_backend is None:
        backend_name = settings.STORAGE_BACKEND.strip().lower()
        if backend_name == "mysql":
            from app.core.mysql_storage_backend import MySQLMesStorageBackend

            repository = MySQLSnapshotRepository(
                MySQLConnectionSettings(
                    host=settings.MYSQL_HOST,
                    port=settings.MYSQL_PORT,
                    user=settings.MYSQL_USER,
                    password=settings.MYSQL_PASSWORD,
                    database=settings.MYSQL_DATABASE,
                )
            )
            _storage_backend = MySQLMesStorageBackend(
                MySQLConnectionSettings(
                    host=settings.MYSQL_HOST,
                    port=settings.MYSQL_PORT,
                    user=settings.MYSQL_USER,
                    password=settings.MYSQL_PASSWORD,
                    database=settings.MYSQL_DATABASE,
                ),
                repository,
                bootstrap_storage=JsonFileStorage(DEFAULT_STORE_PATH),
            )
        else:
            _storage_backend = JsonFileStorage(DEFAULT_STORE_PATH)
    return _storage_backend
