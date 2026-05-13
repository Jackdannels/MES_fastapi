from typing import Any
import re

from fastapi import APIRouter, Body, HTTPException, Query, status

from app.core.demo_data_reset import run_demo_reset
from app.core.storage_backend import get_storage_backend

router = APIRouter(prefix="/api/tasks", tags=["tasks"])
SNAPSHOT_KEYS = (
    "mes.tasks",
    "mes.schedules",
    "mes.samples",
    "mes.streams",
    "mes.experiments",
    "mes.experiment_trays",
    "mes.experiment_samples",
)
RETURNED_STATUS = "厂家收回"
MIN_SAMPLE_COUNT = 1
MAX_SAMPLE_COUNT = 99


def normalize_text(value: Any) -> str:
    return str(value or "").strip()


def load_snapshot(storage=None) -> dict[str, Any]:
    storage_backend = storage or get_storage_backend()
    snapshot = storage_backend.read_all() if hasattr(storage_backend, "read_all") else {}
    if not isinstance(snapshot, dict):
        snapshot = {}
    for key in SNAPSHOT_KEYS:
        if key not in snapshot:
            value = storage_backend.read(key) if hasattr(storage_backend, "read") else []
            snapshot[key] = [dict(item) for item in value] if isinstance(value, list) else []
    return snapshot


def as_list(value: Any) -> list[Any]:
    return list(value) if isinstance(value, list) else []


def sample_task_code(sample: dict[str, Any]) -> str:
    return normalize_text(sample.get("task_code") or sample.get("taskCode") or sample.get("taskNo") or sample.get("task_no"))


def task_code(task: dict[str, Any]) -> str:
    return normalize_text(task.get("code") or task.get("task_code") or task.get("taskNo") or task.get("task_no") or task.get("id"))


def has_returned_status(value: Any) -> bool:
    return normalize_text(value) == RETURNED_STATUS


def is_returned_task(task: dict[str, Any], samples: list[dict[str, Any]]) -> bool:
    code = task_code(task)
    tray_statuses: dict[str, str] = {}
    for sample in samples:
        if sample_task_code(sample) != code:
            continue
        sample_status = normalize_text(sample.get("status") or sample.get("flow_status"))
        for index, tray in enumerate(as_list(sample.get("trays"))):
            tray_code = normalize_text(tray.get("tray_code") or tray.get("trayCode") or tray.get("trayNo") or tray.get("tray_no")) or f"{code}-tray-{index + 1}"
            tray_status = normalize_text(tray.get("status") or tray.get("tray_status") or tray.get("trayStatus") or sample_status)
            if tray_code and tray_status:
                tray_statuses[tray_code] = tray_status
    if tray_statuses:
        return all(has_returned_status(status) for status in tray_statuses.values())
    return (
        has_returned_status(task.get("transfer_status"))
        or has_returned_status(task.get("transferStatus"))
        or has_returned_status(task.get("status"))
        or has_returned_status(task.get("displayStatus"))
        or has_returned_status(task.get("display_status"))
    )


def load_tasks(include_archived: bool = False) -> list[dict[str, Any]]:
    snapshot = load_snapshot()
    tasks = snapshot.get("mes.tasks", [])
    samples = [dict(sample) for sample in snapshot.get("mes.samples", [])] if isinstance(snapshot.get("mes.samples"), list) else []
    task_list = [dict(task) for task in tasks] if isinstance(tasks, list) else []
    if include_archived:
        return task_list
    return [task for task in task_list if not is_returned_task(task, samples)]


def load_experiments() -> list[dict[str, Any]]:
    experiments = load_snapshot().get("mes.experiments", [])
    return [dict(experiment) for experiment in experiments] if isinstance(experiments, list) else []


def find_task_index(tasks: list[dict[str, Any]], task_id: str) -> int:
    normalized_id = normalize_text(task_id)
    for index, task in enumerate(tasks):
        if normalize_text(task.get("id")) == normalized_id or normalize_text(task.get("code")) == normalized_id:
            return index
    return -1


def ensure_unique_task_code(tasks: list[dict[str, Any]], code: Any) -> None:
    normalized_code = normalize_text(code)
    if not normalized_code:
        return
    if any(normalize_text(task.get("code")) == normalized_code for task in tasks):
        raise HTTPException(status_code=400, detail="任务编号已存在")


def filter_related_rows(rows: Any, task_code: str) -> list[dict[str, Any]]:
    if not isinstance(rows, list):
        return []
    return [dict(row) for row in rows if normalize_text(row.get("task_code")) != task_code]


def parse_int(value: Any) -> int:
    try:
        parsed = int(str(value).strip())
    except (TypeError, ValueError):
        return 0
    return parsed if parsed > 0 else 0


def validate_sample_count(value: Any) -> str:
    normalized = normalize_text(value)
    if not normalized:
        raise HTTPException(status_code=400, detail="请填写样品数量")
    if not re.fullmatch(r"-?\d+", normalized):
        raise HTTPException(status_code=400, detail="样品数量必须为整数")
    parsed = int(normalized)
    if parsed < MIN_SAMPLE_COUNT:
        raise HTTPException(status_code=400, detail="样品数量至少为 1")
    if parsed > MAX_SAMPLE_COUNT:
        raise HTTPException(status_code=400, detail="样品数量最多为 99")
    return str(parsed)


def collect_unique_texts(*values: Any) -> list[str]:
    collected: list[str] = []
    for value in values:
        normalized = normalize_text(value)
        if normalized and normalized not in collected:
            collected.append(normalized)
    return collected


def split_experiment_summary(value: Any) -> list[str]:
    return collect_unique_texts(*(str(value or "").split("/")))


def parse_test_types(value: Any) -> list[str]:
    if not isinstance(value, list):
        raise HTTPException(status_code=400, detail="test_types must be an array")
    normalized = [normalize_text(item) for item in value]
    if not normalized or not any(normalized):
        raise HTTPException(status_code=400, detail="test_types must contain at least one experiment type")
    if any(not item for item in normalized):
        raise HTTPException(status_code=400, detail="test_types must not contain empty values")
    if len(set(normalized)) != len(normalized):
        raise HTTPException(status_code=400, detail="test_types must not contain duplicates")
    return normalized


def extract_task_test_types(task: dict[str, Any], existing_experiments: list[dict[str, Any]] | None = None) -> list[str]:
    explicit_types = task.get("test_types")
    if isinstance(explicit_types, list):
        collected = collect_unique_texts(*explicit_types)
        if collected:
            return collected

    existing_list = [dict(experiment) for experiment in (existing_experiments or [])]
    return collect_unique_texts(
        *split_experiment_summary(task.get("test_type")),
        *(experiment.get("experiment_name") for experiment in existing_list),
        *split_experiment_summary(task.get("required_device")),
        task.get("name"),
    )


def build_experiment_types(task: dict[str, Any], count: int, existing_experiments: list[dict[str, Any]] | None = None) -> list[str]:
    experiment_types = extract_task_test_types(task, existing_experiments)
    if isinstance(task.get("test_types"), list) and experiment_types:
        return experiment_types
    while len(experiment_types) < count:
        experiment_types.append(f"实验{len(experiment_types) + 1}")
    return experiment_types[:count]


def build_experiment_codes(task_code: str, count: int, seed_codes: list[str] | None = None) -> list[str]:
    normalized_task_code = normalize_text(task_code) or "TASK"
    codes: list[str] = []
    seen: set[str] = set()

    for code in seed_codes or []:
        normalized_code = normalize_text(code)
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


def build_task_experiments(task: dict[str, Any], existing_experiments: list[dict[str, Any]] | None = None) -> list[dict[str, Any]]:
    task_code = normalize_text(task.get("code")) or normalize_text(task.get("id")) or "TASK"
    existing_list = [dict(experiment) for experiment in (existing_experiments or [])]
    existing_codes = [normalize_text(experiment.get("experiment_code")) for experiment in existing_list if normalize_text(experiment.get("experiment_code"))]
    explicit_codes = [normalize_text(code) for code in (task.get("experiment_codes") if isinstance(task.get("experiment_codes"), list) else []) if normalize_text(code)]
    explicit_count = parse_int(task.get("experiment_count"))
    experiment_types = extract_task_test_types(task, existing_list)

    if isinstance(task.get("test_types"), list) and experiment_types:
        desired_count = len(experiment_types)
    else:
        desired_count = max(
            explicit_count,
            len(explicit_codes),
            len(experiment_types),
            len(existing_list),
        )
    if desired_count <= 0:
        desired_count = 1

    seed_codes = explicit_codes if explicit_codes else existing_codes
    experiment_codes = build_experiment_codes(task_code, desired_count, seed_codes)
    experiment_types = build_experiment_types(task, desired_count, existing_list)
    existing_by_code = {normalize_text(experiment.get("experiment_code")): dict(experiment) for experiment in existing_list}

    experiments: list[dict[str, Any]] = []
    for index, experiment_code in enumerate(experiment_codes):
        source = existing_by_code.get(experiment_code, {})
        experiment_name = normalize_text(source.get("experiment_name"))
        if not experiment_name or re.fullmatch(r"[A-Z]实验", experiment_name):
            experiment_name = experiment_types[index]
        required_device = normalize_text(source.get("required_device")) or experiment_types[index]
        experiments.append(
            {
                **source,
                "id": normalize_text(source.get("id")) or experiment_code,
                "task_code": task_code,
                "experiment_code": experiment_code,
                "experiment_name": experiment_name,
                "required_device": required_device,
                "priority": normalize_text(source.get("priority")) or normalize_text(task.get("priority")),
                "status": normalize_text(source.get("status")) or normalize_text(task.get("status")) or "待排程",
            }
        )
    return experiments


def persist_task_experiments(task: dict[str, Any], existing_experiments: list[dict[str, Any]] | None = None) -> list[dict[str, Any]]:
    experiments = build_task_experiments(task, existing_experiments)
    task["test_types"] = build_experiment_types(task, len(experiments), existing_experiments)
    task["test_type"] = " / ".join(task["test_types"])
    if not normalize_text(task.get("required_device")):
        task["required_device"] = task["test_type"]
    task["experiment_codes"] = [normalize_text(experiment.get("experiment_code")) for experiment in experiments if normalize_text(experiment.get("experiment_code"))]
    task["experiment_count"] = len(task["experiment_codes"])
    return experiments


@router.get("")
def list_tasks(include_archived: bool = Query(False, alias="includeArchived")) -> list[dict[str, Any]]:
    return load_tasks(include_archived)


@router.post("", status_code=status.HTTP_201_CREATED)
def create_task(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
    storage = get_storage_backend()
    snapshot = load_snapshot(storage)
    tasks = [dict(task) for task in snapshot.get("mes.tasks", [])]
    experiments = [dict(experiment) for experiment in snapshot.get("mes.experiments", [])]
    next_task = dict(payload)
    if "test_types" not in next_task:
        raise HTTPException(status_code=400, detail="test_types is required")
    next_task["test_types"] = parse_test_types(next_task.get("test_types"))
    next_task["sample_count"] = validate_sample_count(next_task.get("sample_count"))
    ensure_unique_task_code(tasks, next_task.get("code"))
    next_experiments = persist_task_experiments(next_task)
    tasks.insert(0, next_task)
    snapshot["mes.tasks"] = tasks
    snapshot["mes.experiments"] = experiments + next_experiments
    storage.write_many(snapshot)
    return next_task


@router.post("/reset")
def reset_tasks() -> dict[str, int]:
    storage = get_storage_backend()
    return run_demo_reset(storage)


@router.put("/{task_id}")
def update_task(task_id: str, payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
    storage = get_storage_backend()
    snapshot = load_snapshot(storage)
    tasks = [dict(task) for task in snapshot.get("mes.tasks", [])]
    task_index = find_task_index(tasks, task_id)
    if task_index < 0:
        raise HTTPException(status_code=404, detail="Task not found")
    previous_task = dict(tasks[task_index])
    updated_task = {**tasks[task_index], **dict(payload)}
    updated_task["sample_count"] = validate_sample_count(updated_task.get("sample_count"))
    all_experiments = [dict(experiment) for experiment in snapshot.get("mes.experiments", [])]
    existing_experiments = [experiment for experiment in all_experiments if normalize_text(experiment.get("task_code")) == normalize_text(previous_task.get("code"))]
    next_experiments = persist_task_experiments(updated_task, existing_experiments)
    tasks[task_index] = updated_task
    snapshot["mes.tasks"] = tasks
    snapshot["mes.experiments"] = [
        experiment for experiment in all_experiments if normalize_text(experiment.get("task_code")) != normalize_text(previous_task.get("code"))
    ] + next_experiments
    storage.write_many(snapshot)
    return updated_task


@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_task(task_id: str) -> None:
    storage = get_storage_backend()
    snapshot = load_snapshot(storage)
    tasks = [dict(task) for task in snapshot.get("mes.tasks", [])]
    task_index = find_task_index(tasks, task_id)
    if task_index < 0:
        raise HTTPException(status_code=404, detail="Task not found")
    removed_task = tasks.pop(task_index)
    task_code = normalize_text(removed_task.get("code")) or normalize_text(removed_task.get("id"))
    snapshot["mes.tasks"] = tasks
    snapshot["mes.schedules"] = filter_related_rows(snapshot.get("mes.schedules"), task_code)
    snapshot["mes.samples"] = filter_related_rows(snapshot.get("mes.samples"), task_code)
    snapshot["mes.streams"] = filter_related_rows(snapshot.get("mes.streams"), task_code)
    snapshot["mes.experiments"] = filter_related_rows(snapshot.get("mes.experiments"), task_code)
    snapshot["mes.experiment_trays"] = filter_related_rows(snapshot.get("mes.experiment_trays"), task_code)
    snapshot["mes.experiment_samples"] = filter_related_rows(snapshot.get("mes.experiment_samples"), task_code)
    storage.write_many(snapshot)
    return None
