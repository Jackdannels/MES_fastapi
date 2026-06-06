from __future__ import annotations

import re
from datetime import datetime
from typing import Any, Dict, Iterable

from app.core.config import settings
from app.core.time_utils import format_business_datetime, parse_business_datetime
from app.db.mysql_snapshot import MySQLConnectionSettings, MySQLSnapshotRepository

STORAGE_META_KEY = "mes.meta"
CURRENT_SCHEMA_VERSION = 2
MYSQL_HEALTHCHECK_TIMEOUT_SECONDS = 3
RUNTIME_STORAGE_BACKEND = "mysql"
UNSUPPORTED_RUNTIME_BACKEND_DETAIL = "Only mysql runtime storage is supported"
RETURNED_STATUS = "厂家收回"
CANONICAL_HANDOVER_STORED_STATUS = "到货"
LEGACY_HANDOVER_STORED_STATUSES = {"已入库"}
EXPERIMENT_TERMINAL_STATUSES = {
    "实验已完成",
    RETURNED_STATUS,
    "实验完成",
    "实验已经完成",
    "放置实验后暂存间",
    "已到达暂存间",
}

STORAGE_KEYS: Iterable[str] = (
    "mes.tasks",
    "mes.schedules",
    "mes.experiments",
    "mes.experiment_runs",
    "mes.experiment_run_trays",
    "mes.experiment_trays",
    "mes.experiment_samples",
    "mes.samples",
    "mes.staging_events",
    "mes.devices",
    "mes.streams",
    "mes.conflicts",
)
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
    ("宸插叆搴", CANONICAL_HANDOVER_STORED_STATUS),
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
STATUS_VALUE_KEYS = {
    "status",
    "flow_status",
    "flowStatus",
    "task_status",
    "taskStatus",
    "transfer_status",
    "transferStatus",
    "experiment_status",
    "experimentStatus",
    "schedule_status",
    "scheduleStatus",
    "sample_status",
    "sampleStatus",
    "tray_status",
    "trayStatus",
    "run_tray_status",
    "runTrayStatus",
}
DATETIME_VALUE_KEYS = {
    "acknowledged_at",
    "acknowledgedAt",
    "arrival_at",
    "arrivalAt",
    "completed_at",
    "completedAt",
    "created_at",
    "createdAt",
    "due_at",
    "dueAt",
    "end_at",
    "endAt",
    "ended_at",
    "endedAt",
    "event_time",
    "eventTime",
    "fixture_ready_at",
    "fixtureReadyAt",
    "maintenance_end_at",
    "maintenanceEndAt",
    "maintenance_start_at",
    "maintenanceStartAt",
    "planned_end_at",
    "plannedEndAt",
    "processed_at",
    "processedAt",
    "result_at",
    "resultAt",
    "start_at",
    "startAt",
    "started_at",
    "startedAt",
    "time",
    "timestamp",
    "updated_at",
    "updatedAt",
    "unscheduled_since",
    "unscheduledSince",
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
    if text in LEGACY_HANDOVER_STORED_STATUSES:
        return CANONICAL_HANDOVER_STORED_STATUS
    if text == CANONICAL_RUNNING_STATUS or text in LEGACY_RUNNING_STATUSES:
        return CANONICAL_RUNNING_STATUS
    if text == CANONICAL_COMPLETED_STATUS or text in LEGACY_COMPLETED_STATUSES:
        return CANONICAL_COMPLETED_STATUS
    return text


def normalize_task_status_text(value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    if text in LEGACY_HANDOVER_STORED_STATUSES:
        return CANONICAL_HANDOVER_STORED_STATUS
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
    return parse_business_datetime(value)


def _format_storage_datetime(value: Any) -> str:
    return format_business_datetime(value) or str(value or "").strip()


def _normalize_datetime_collection(value: Any, *, field_name: str = "") -> Any:
    if isinstance(value, list):
        return [_normalize_datetime_collection(item, field_name=field_name) for item in value]
    if isinstance(value, dict):
        return {key: _normalize_datetime_collection(entry, field_name=key) for key, entry in value.items()}
    if isinstance(value, str) and field_name in DATETIME_VALUE_KEYS:
        return _format_storage_datetime(value)
    return value


def _normalize_meta(value: Any) -> dict[str, Any]:
    meta = dict(value) if isinstance(value, dict) else {}
    schema_version = meta.get("schema_version")
    try:
        meta["schema_version"] = int(schema_version)
    except (TypeError, ValueError):
        meta["schema_version"] = 0
    return meta


def _resolve_experiment_count(task: dict[str, Any], explicit_count: int) -> int:
    raw_types = task.get("test_types")
    if isinstance(raw_types, list):
        normalized_types = [str(item or "").strip() for item in raw_types if str(item or "").strip()]
        if normalized_types:
            return len(normalized_types)
    raw_codes = task.get("experiment_codes")
    if isinstance(raw_codes, list):
        normalized_codes = [str(code or "").strip() for code in raw_codes if str(code or "").strip()]
        if normalized_codes:
            return len(normalized_codes)
    if explicit_count > 0:
        return explicit_count
    try:
        explicit_task_count = int(task.get("experiment_count") or 0)
    except (TypeError, ValueError):
        explicit_task_count = 0
    if explicit_task_count > 0:
        return explicit_task_count
    legacy_types = _split_experiment_type_text(task.get("test_type") or task.get("required_device"))
    if legacy_types:
        return len(legacy_types)
    return 1


def _split_experiment_type_text(value: Any) -> list[str]:
    types: list[str] = []
    for candidate in re.split(r"[/、,，;；]+", str(value or "")):
        normalized = candidate.strip()
        if normalized and normalized not in types:
            types.append(normalized)
    return types


def _build_experiment_types(task: dict[str, Any], count: int) -> list[str]:
    base_type = str(task.get("test_type") or task.get("required_device") or "").strip()
    types: list[str] = []
    raw_types = task.get("test_types")
    if isinstance(raw_types, list):
        for candidate in raw_types:
            normalized = str(candidate or "").strip()
            if normalized and normalized not in types:
                types.append(normalized)
    for normalized in _split_experiment_type_text(base_type):
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
        experiment_types = _build_experiment_types(task, desired_count)
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


def _latest_staging_events_by_tray(events: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    latest: dict[str, tuple[datetime | None, int, dict[str, Any]]] = {}
    for index, event in enumerate(events):
        tray_code = str(event.get("tray_code") or event.get("trayCode") or "").strip()
        if not tray_code:
            continue
        event_time = _parse_storage_datetime(event.get("time") or event.get("created_at") or event.get("updated_at"))
        current = latest.get(tray_code)
        if current is None:
            latest[tray_code] = (event_time, index, event)
            continue
        current_time, current_index, _current_event = current
        if event_time and current_time:
            if event_time >= current_time:
                latest[tray_code] = (event_time, index, event)
            continue
        if event_time and not current_time:
            latest[tray_code] = (event_time, index, event)
            continue
        if not event_time and not current_time and index >= current_index:
            latest[tray_code] = (event_time, index, event)
    return {tray_code: event for tray_code, (_time, _index, event) in latest.items()}


def _append_return_history(sample: dict[str, Any], tray_code: str, event: dict[str, Any]) -> bool:
    event_time = str(event.get("time") or event.get("created_at") or event.get("updated_at") or "").strip()
    if not event_time:
        return False
    detail = f"{tray_code} {RETURNED_STATUS}"
    history = sample.get("history") if isinstance(sample.get("history"), list) else []
    if any(
        str(entry.get("time") or "").strip() == event_time
        and str(entry.get("detail") or "").strip() == detail
        for entry in history
        if isinstance(entry, dict)
    ):
        sample["history"] = history
        return False
    sample["history"] = [
        {
            "action": RETURNED_STATUS,
            "status": RETURNED_STATUS,
            "detail": detail,
            "time": event_time,
            "location": RETURNED_STATUS,
            "owner": str(event.get("operator") or "").strip(),
        },
        *history,
    ]
    return True


def _apply_staging_returned_tasks(payload: Dict[str, Any]) -> tuple[Dict[str, Any], bool]:
    tasks = [dict(task) for task in (payload.get("mes.tasks") if isinstance(payload.get("mes.tasks"), list) else [])]
    samples = [dict(sample) for sample in (payload.get("mes.samples") if isinstance(payload.get("mes.samples"), list) else [])]
    experiment_trays = [
        dict(item)
        for item in (payload.get("mes.experiment_trays") if isinstance(payload.get("mes.experiment_trays"), list) else [])
    ]
    experiment_run_trays = [
        dict(item)
        for item in (payload.get("mes.experiment_run_trays") if isinstance(payload.get("mes.experiment_run_trays"), list) else [])
    ]
    experiments = [
        dict(item)
        for item in (payload.get("mes.experiments") if isinstance(payload.get("mes.experiments"), list) else [])
    ]
    schedules = [
        dict(item)
        for item in (payload.get("mes.schedules") if isinstance(payload.get("mes.schedules"), list) else [])
    ]
    staging_events = [
        dict(item)
        for item in (payload.get("mes.staging_events") if isinstance(payload.get("mes.staging_events"), list) else [])
    ]
    if not tasks or not staging_events:
        return payload, False

    returned_by_tray = _latest_staging_events_by_tray(
        [
            event
            for event in staging_events
            if str(event.get("action") or "").strip() == "manufacturer_return"
        ]
    )
    if not returned_by_tray:
        return payload, False

    task_trays: dict[str, set[str]] = {}
    sample_trays: dict[tuple[str, str], set[str]] = {}
    legacy_sample_trays: dict[tuple[str, str], set[str]] = {}
    task_sample_codes: dict[str, set[str]] = {}
    task_tray_limits: dict[str, int] = {}
    task_experiment_codes: dict[str, set[str]] = {}
    clear_runtime_or_relation_evidence: set[str] = set()

    for task in tasks:
        task_code = str(task.get("code") or task.get("task_code") or task.get("id") or "").strip()
        if not task_code:
            continue
        try:
            tray_limit = int(str(task.get("tray_limit") or "").strip())
        except (TypeError, ValueError):
            tray_limit = 0
        task_tray_limits[task_code] = tray_limit if tray_limit > 0 else 4
        raw_experiment_codes = task.get("experiment_codes")
        if isinstance(raw_experiment_codes, list):
            for experiment_code in raw_experiment_codes:
                normalized_code = str(experiment_code or "").strip()
                if normalized_code:
                    task_experiment_codes.setdefault(task_code, set()).add(normalized_code)

    for experiment in experiments:
        task_code = str(experiment.get("task_code") or experiment.get("taskCode") or "").strip()
        experiment_code = str(experiment.get("experiment_code") or experiment.get("experimentCode") or "").strip()
        if task_code and experiment_code:
            task_experiment_codes.setdefault(task_code, set()).add(experiment_code)
        status = str(experiment.get("status") or experiment.get("experiment_status") or experiment.get("experimentStatus") or "").strip()
        if task_code and status in {CANONICAL_RUNNING_STATUS, *LEGACY_RUNNING_STATUSES}:
            clear_runtime_or_relation_evidence.add(task_code)

    for schedule in schedules:
        task_code = str(schedule.get("task_code") or schedule.get("taskCode") or "").strip()
        status = str(schedule.get("status") or schedule.get("schedule_status") or schedule.get("scheduleStatus") or "").strip()
        if task_code and status in {CANONICAL_RUNNING_STATUS, *LEGACY_RUNNING_STATUSES}:
            clear_runtime_or_relation_evidence.add(task_code)

    for relation in experiment_trays:
        task_code = str(relation.get("task_code") or "").strip()
        tray_code = str(relation.get("tray_code") or "").strip()
        if not task_code or not tray_code:
            continue
        task_trays.setdefault(task_code, set()).add(tray_code)
        clear_runtime_or_relation_evidence.add(task_code)

    for relation in experiment_run_trays:
        task_code = str(relation.get("task_code") or relation.get("taskCode") or relation.get("task_no") or relation.get("taskNo") or "").strip()
        tray_code = str(relation.get("tray_code") or relation.get("trayCode") or relation.get("tray_no") or relation.get("trayNo") or "").strip()
        if not task_code or not tray_code:
            continue
        task_trays.setdefault(task_code, set()).add(tray_code)
        clear_runtime_or_relation_evidence.add(task_code)

    for sample in samples:
        task_code = str(sample.get("task_code") or "").strip()
        sample_code = str(sample.get("code") or sample.get("sample_code") or sample.get("id") or "").strip()
        if task_code and sample_code:
            task_sample_codes.setdefault(task_code, set()).add(sample_code)
        for tray in sample.get("trays") if isinstance(sample.get("trays"), list) else []:
            tray_code = str(tray.get("tray_code") or tray.get("trayCode") or tray.get("trayNo") or "").strip()
            if not task_code or not tray_code:
                continue
            structured_task_trays = task_trays.get(task_code, set())
            if tray_code in structured_task_trays and sample_code:
                sample_trays.setdefault((task_code, sample_code), set()).add(tray_code)
            elif not structured_task_trays and sample_code:
                legacy_sample_trays.setdefault((task_code, sample_code), set()).add(tray_code)

    for (task_code, sample_code), tray_codes in legacy_sample_trays.items():
        experiment_count = len(task_experiment_codes.get(task_code, set())) or 1
        task_legacy_trays = {
            tray_code
            for (legacy_task_code, _sample_code), legacy_tray_codes in legacy_sample_trays.items()
            if legacy_task_code == task_code
            for tray_code in legacy_tray_codes
        }
        if (
            experiment_count == 1
            and len(task_legacy_trays) == 1
            and task_code not in clear_runtime_or_relation_evidence
        ):
            task_trays.setdefault(task_code, set()).update(task_legacy_trays)
            sample_trays.setdefault((task_code, sample_code), set()).update(tray_codes)

    for task_code, tray_codes in task_trays.items():
        if any(key[0] == task_code for key in sample_trays):
            continue
        sorted_samples = sorted(task_sample_codes.get(task_code, set()))
        sorted_trays = sorted(tray_codes)
        if not sorted_samples or not sorted_trays:
            continue
        tray_limit = task_tray_limits.get(task_code, 4)
        for index, sample_code in enumerate(sorted_samples):
            tray_index = min(index // tray_limit, len(sorted_trays) - 1)
            sample_trays.setdefault((task_code, sample_code), set()).add(sorted_trays[tray_index])

    returned_task_codes = {
        task_code
        for task_code, tray_codes in task_trays.items()
        if tray_codes
        and all(tray_code in returned_by_tray for tray_code in tray_codes)
    }
    if not returned_task_codes:
        return payload, False

    changed = False
    for task in tasks:
        task_code = str(task.get("code") or task.get("task_code") or task.get("id") or "").strip()
        if task_code not in returned_task_codes:
            continue
        if task.get("status") != RETURNED_STATUS:
            task["status"] = RETURNED_STATUS
            changed = True
        if task.get("transfer_status") != RETURNED_STATUS:
            task["transfer_status"] = RETURNED_STATUS
            changed = True

    for sample in samples:
        task_code = str(sample.get("task_code") or "").strip()
        sample_code = str(sample.get("code") or sample.get("sample_code") or sample.get("id") or "").strip()
        if task_code not in returned_task_codes:
            continue
        task_has_sample_tray_mapping = any(key[0] == task_code for key in sample_trays)
        tray_codes = sorted(sample_trays.get((task_code, sample_code), set()))
        if task_has_sample_tray_mapping and not tray_codes:
            continue
        latest_return_time = ""
        for tray_code in tray_codes:
            event_time = str(returned_by_tray.get(tray_code, {}).get("time") or "").strip()
            if event_time and event_time > latest_return_time:
                latest_return_time = event_time
        for field in ("status", "flow_status", "location"):
            if sample.get(field) != RETURNED_STATUS:
                sample[field] = RETURNED_STATUS
                changed = True
        if latest_return_time and sample.get("updated_at") != latest_return_time:
            sample["updated_at"] = latest_return_time
            changed = True
        trays = [dict(tray) for tray in (sample.get("trays") if isinstance(sample.get("trays"), list) else [])]
        trays_by_code = {
            str(tray.get("tray_code") or tray.get("trayCode") or tray.get("trayNo") or "").strip(): tray
            for tray in trays
            if str(tray.get("tray_code") or tray.get("trayCode") or tray.get("trayNo") or "").strip()
        }
        for tray_code in tray_codes:
            event = returned_by_tray.get(tray_code, {})
            event_time = str(event.get("time") or event.get("created_at") or event.get("updated_at") or "").strip()
            tray = trays_by_code.get(tray_code)
            if tray is None:
                trays.append(
                    {
                        "tray_code": tray_code,
                        "sample_code": sample_code,
                        "status": RETURNED_STATUS,
                        "quantity": 1,
                        "updated_at": event_time,
                    }
                )
                changed = True
            else:
                if tray.get("status") != RETURNED_STATUS:
                    tray["status"] = RETURNED_STATUS
                    changed = True
                if event_time and tray.get("updated_at") != event_time:
                    tray["updated_at"] = event_time
                    changed = True
            if _append_return_history(sample, tray_code, event):
                changed = True
        if sample.get("trays") != trays:
            sample["trays"] = trays
            changed = True

    if not changed:
        return payload, False
    normalized = dict(payload)
    normalized["mes.tasks"] = tasks
    normalized["mes.samples"] = samples
    return normalized, True


def _apply_terminal_experiments_for_returned_trays(payload: Dict[str, Any]) -> tuple[Dict[str, Any], bool]:
    experiment_trays = [
        dict(item)
        for item in (payload.get("mes.experiment_trays") if isinstance(payload.get("mes.experiment_trays"), list) else [])
    ]
    staging_events = [
        dict(item)
        for item in (payload.get("mes.staging_events") if isinstance(payload.get("mes.staging_events"), list) else [])
    ]
    if not experiment_trays or not staging_events:
        return payload, False

    returned_by_tray = _latest_staging_events_by_tray(
        [
            event
            for event in staging_events
            if str(event.get("action") or "").strip() == "manufacturer_return"
        ]
    )
    task_codes_by_returned_tray: dict[str, set[str]] = {}
    for relation in experiment_trays:
        task_code = str(relation.get("task_code") or relation.get("taskCode") or "").strip()
        tray_code = str(relation.get("tray_code") or relation.get("trayCode") or relation.get("trayNo") or "").strip()
        if task_code and tray_code in returned_by_tray:
            task_codes_by_returned_tray.setdefault(tray_code, set()).add(task_code)
    touched_task_codes = {
        str(event.get("task_code") or event.get("taskCode") or "").strip()
        for event in returned_by_tray.values()
        if str(event.get("task_code") or event.get("taskCode") or "").strip()
    }
    touched_task_codes.update(
        task_code
        for task_codes in task_codes_by_returned_tray.values()
        for task_code in task_codes
    )
    if not touched_task_codes:
        return payload, False

    scoped_trays: dict[tuple[str, str], set[str]] = {}
    for relation in experiment_trays:
        task_code = str(relation.get("task_code") or relation.get("taskCode") or "").strip()
        experiment_code = str(relation.get("experiment_code") or relation.get("experimentCode") or "").strip()
        tray_code = str(relation.get("tray_code") or relation.get("trayCode") or relation.get("trayNo") or "").strip()
        if task_code in touched_task_codes and experiment_code and tray_code:
            scoped_trays.setdefault((task_code, experiment_code), set()).add(tray_code)

    if not scoped_trays:
        return payload, False

    experiment_run_trays = [
        dict(item)
        for item in (payload.get("mes.experiment_run_trays") if isinstance(payload.get("mes.experiment_run_trays"), list) else [])
    ]
    completed_run_trays: set[tuple[str, str, str]] = set()
    run_tray_by_key: dict[tuple[str, str, str], dict[str, Any]] = {}
    for relation in experiment_run_trays:
        task_code = str(relation.get("task_code") or relation.get("taskCode") or relation.get("task_no") or relation.get("taskNo") or "").strip()
        experiment_code = str(
            relation.get("experiment_code")
            or relation.get("experimentCode")
            or relation.get("experiment_no")
            or relation.get("experimentNo")
            or ""
        ).strip()
        tray_code = str(relation.get("tray_code") or relation.get("trayCode") or relation.get("tray_no") or relation.get("trayNo") or "").strip()
        status = str(relation.get("run_tray_status") or relation.get("runTrayStatus") or relation.get("status") or "").strip()
        if task_code and experiment_code and tray_code:
            key = (task_code, experiment_code, tray_code)
            run_tray_by_key.setdefault(key, relation)
            if status in EXPERIMENT_TERMINAL_STATUSES:
                completed_run_trays.add(key)

    returned_experiment_tray_keys = {
        (task_code, experiment_code, tray_code)
        for (task_code, experiment_code), tray_codes in scoped_trays.items()
        for tray_code in tray_codes
        if tray_code in returned_by_tray and (task_code, experiment_code, tray_code) not in completed_run_trays
    }

    terminal_experiments = {
        (task_code, experiment_code)
        for (task_code, experiment_code), tray_codes in scoped_trays.items()
        if tray_codes
        and all(
            (task_code, experiment_code, tray_code) in completed_run_trays
            or tray_code in returned_by_tray
            for tray_code in tray_codes
        )
    }
    if not terminal_experiments and not returned_experiment_tray_keys:
        return payload, False

    changed = False
    experiments = [dict(item) for item in (payload.get("mes.experiments") if isinstance(payload.get("mes.experiments"), list) else [])]
    for experiment in experiments:
        key = (
            str(experiment.get("task_code") or experiment.get("taskCode") or "").strip(),
            str(experiment.get("experiment_code") or experiment.get("experimentCode") or "").strip(),
        )
        if key in terminal_experiments and experiment.get("status") != CANONICAL_COMPLETED_STATUS:
            experiment["status"] = CANONICAL_COMPLETED_STATUS
            changed = True

    schedules = [dict(item) for item in (payload.get("mes.schedules") if isinstance(payload.get("mes.schedules"), list) else [])]
    filtered_schedules = [
        schedule
        for schedule in schedules
        if (
            str(schedule.get("task_code") or schedule.get("taskCode") or "").strip(),
            str(schedule.get("experiment_code") or schedule.get("experimentCode") or "").strip(),
        )
        not in terminal_experiments
    ]
    if filtered_schedules != schedules:
        changed = True

    for task_code, experiment_code, tray_code in sorted(returned_experiment_tray_keys):
        event = returned_by_tray[tray_code]
        event_time = str(event.get("time") or event.get("created_at") or event.get("updated_at") or "").strip()
        key = (task_code, experiment_code, tray_code)
        relation = run_tray_by_key.get(key)
        if relation is None:
            relation = {
                "run_no": f"RETURNED-{experiment_code}",
                "task_code": task_code,
                "experiment_code": experiment_code,
                "tray_code": tray_code,
                "run_tray_status": RETURNED_STATUS,
            }
            if event_time:
                relation["ended_at"] = event_time
                relation["updated_at"] = event_time
            experiment_run_trays.append(relation)
            run_tray_by_key[key] = relation
            changed = True
            continue
        if relation.get("run_tray_status") != RETURNED_STATUS:
            relation["run_tray_status"] = RETURNED_STATUS
            changed = True
        if not str(relation.get("run_no") or relation.get("runNo") or "").strip():
            relation["run_no"] = f"RETURNED-{experiment_code}"
            changed = True
        if event_time and relation.get("updated_at") != event_time:
            relation["updated_at"] = event_time
            changed = True
        if event_time and not relation.get("ended_at"):
            relation["ended_at"] = event_time
            changed = True

    if not changed:
        return payload, False
    normalized = dict(payload)
    normalized["mes.experiments"] = experiments
    normalized["mes.schedules"] = filtered_schedules
    normalized["mes.experiment_run_trays"] = experiment_run_trays
    return normalized, True


def _normalize_value(key: str, value: Any) -> Any:
    value = _normalize_datetime_collection(value)
    if key == "mes.samples" and isinstance(value, list):
        return _normalize_status_collection(_sanitize_sample_collection(value), status_scope="experiment")
    if key == "mes.tasks" and isinstance(value, list):
        return _normalize_status_collection(value, status_scope="task")
    if key in {"mes.schedules", "mes.experiments", "mes.experiment_runs", "mes.experiment_run_trays"} and isinstance(value, list):
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
    normalized, returned_changed = _apply_staging_returned_tasks(normalized)
    if returned_changed:
        changed = True
    normalized, terminal_experiment_changed = _apply_terminal_experiments_for_returned_trays(normalized)
    if terminal_experiment_changed:
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


_storage_backend: StorageBackend | None = None


def _backend_name(backend: StorageBackend | None) -> str | None:
    if backend is None:
        return None
    if backend.__class__.__name__ == "MySQLMesStorageBackend":
        return "mysql"
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
        )
    return _storage_backend
