from typing import Any
import re

from fastapi import APIRouter, Body, HTTPException, status

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

MIN_EXPERIMENTS_PER_TASK = 3
EXPERIMENT_TYPE_OPTIONS = (
    "高低温湿热试验",
    "温度冲击试验",
    "冲击试验",
    "振动试验",
    "盐雾试验",
    "霉菌试验",
    "四综合试验",
)


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


def load_tasks() -> list[dict[str, Any]]:
    tasks = load_snapshot().get("mes.tasks", [])
    return [dict(task) for task in tasks] if isinstance(tasks, list) else []


def load_experiments() -> list[dict[str, Any]]:
    experiments = load_snapshot().get("mes.experiments", [])
    return [dict(experiment) for experiment in experiments] if isinstance(experiments, list) else []


def find_task_index(tasks: list[dict[str, Any]], task_id: str) -> int:
    normalized_id = normalize_text(task_id)
    for index, task in enumerate(tasks):
        if normalize_text(task.get("id")) == normalized_id or normalize_text(task.get("code")) == normalized_id:
            return index
    return -1


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


def build_experiment_types(task: dict[str, Any], count: int) -> list[str]:
    task_type = normalize_text(task.get("test_type")) or normalize_text(task.get("required_device")) or normalize_text(task.get("name"))
    experiment_types: list[str] = []
    for candidate in (task_type, *EXPERIMENT_TYPE_OPTIONS):
        normalized = normalize_text(candidate)
        if not normalized or normalized in experiment_types:
            continue
        experiment_types.append(normalized)
        if len(experiment_types) >= count:
            break
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

    if explicit_count > 0 or explicit_codes:
        desired_count = max(MIN_EXPERIMENTS_PER_TASK, explicit_count, len(explicit_codes))
    else:
        desired_count = max(MIN_EXPERIMENTS_PER_TASK, len(existing_list))

    seed_codes = explicit_codes if explicit_codes else existing_codes
    experiment_codes = build_experiment_codes(task_code, desired_count, seed_codes)
    experiment_types = build_experiment_types(task, desired_count)
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
    task["experiment_codes"] = [normalize_text(experiment.get("experiment_code")) for experiment in experiments if normalize_text(experiment.get("experiment_code"))]
    task["experiment_count"] = len(task["experiment_codes"])
    return experiments


@router.get("")
def list_tasks() -> list[dict[str, Any]]:
    return load_tasks()


@router.post("", status_code=status.HTTP_201_CREATED)
def create_task(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
    storage = get_storage_backend()
    snapshot = load_snapshot(storage)
    tasks = [dict(task) for task in snapshot.get("mes.tasks", [])]
    experiments = [dict(experiment) for experiment in snapshot.get("mes.experiments", [])]
    next_task = dict(payload)
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
