from typing import Any
import re

from fastapi import APIRouter, Body, HTTPException, Query, status

from app.core.demo_data_reset import run_demo_reset
from app.core.storage_backend import get_storage_backend
from app.api.routes.storage import publish_storage_update

router = APIRouter(prefix="/api/tasks", tags=["tasks"])
SNAPSHOT_KEYS = (
    "mes.tasks",
    "mes.schedules",
    "mes.samples",
    "mes.streams",
    "mes.experiments",
    "mes.experiment_trays",
    "mes.experiment_samples",
    "mes.experiment_runs",
    "mes.experiment_run_trays",
)
TASK_STORAGE_UPDATE_KEYS = (
    *SNAPSHOT_KEYS,
    "mes.conflicts",
)
RETURNED_STATUS = "厂家收回"
MIN_SAMPLE_COUNT = 1
MAX_SAMPLE_COUNT = 99
STORAGE_CONFIRMED_STATUS = "到货"
TRANSFER_PENDING_STATUS = "未入库"
SAMPLE_TRANSPORT_STATUS = "运输中"
SCHEDULED_EXPERIMENT_REMOVAL_CODE = "SCHEDULED_EXPERIMENT_REMOVAL_REQUIRES_CONFIRMATION"
SCHEDULED_EXPERIMENT_REMOVAL_MESSAGE = "删除已排程实验类型需要确认"
EXPERIMENT_TYPE_LOCKED_MESSAGE = "该任务样品已在接驳区确认到货，不允许更改实验类型"
SAMPLE_COUNT_LOCKED_MESSAGE = "该任务样品已在接驳区确认到货，不允许更改样品数量"
COMPLETED_TASK_EDIT_LOCKED_MESSAGE = "任务已完成，仅允许修改任务名称"
RUNNING_TASK_DELETE_MESSAGE = "任务存在进行中的实验，不能删除任务"
RUNNING_EXPERIMENT_STATUSES = {"实验进行中", "实验中"}
RUNNING_TASK_STATUSES = {"任务进行中", "实验进行中", "实验中"}
COMPLETED_EXPERIMENT_STATUSES = {"实验已完成", "实验完成", "实验已经完成"}
COMPLETED_TASK_STATUSES = {"任务已完成", "任务完成", *COMPLETED_EXPERIMENT_STATUSES}
COMPLETED_TASK_EDITABLE_FIELDS = {"name"}
TRANSFER_HISTORY_ACTIONS = {"样品分装托盘", "任务已确认入库", "任务重新载装", "任务重新入库"}
INVALID_TASK_TEXT_PATTERN = re.compile(r"[\uFFFD&^*#<>`{}|\\]")
TASK_TEXT_FIELD_LABELS = {
    "attachment": "附件",
    "client": "委托单位/部门",
    "conditions": "环境/特殊条件",
    "contact": "联系人",
    "contact_info": "联系方式",
    "name": "任务名称",
    "remark": "备注",
    "sample_type": "样品类型",
}


def normalize_text(value: Any) -> str:
    return str(value or "").strip()


def is_storage_confirmed_status(value: Any) -> bool:
    return normalize_text(value) == STORAGE_CONFIRMED_STATUS


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


def is_returned_task(task: dict[str, Any]) -> bool:
    return has_returned_status(task.get("transfer_status")) or has_returned_status(task.get("transferStatus"))


def load_tasks(include_archived: bool = False) -> list[dict[str, Any]]:
    snapshot = load_snapshot()
    tasks = snapshot.get("mes.tasks", [])
    task_list = [dict(task) for task in tasks] if isinstance(tasks, list) else []
    if include_archived:
        return task_list
    return [task for task in task_list if not is_returned_task(task)]


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


def row_task_code(row: dict[str, Any]) -> str:
    return normalize_text(row.get("task_code") or row.get("taskCode") or row.get("taskNo") or row.get("task_no"))


def row_has_running_experiment_status(row: dict[str, Any], fields: tuple[str, ...] = ("status",)) -> bool:
    return any(normalize_text(row.get(field)) in RUNNING_EXPERIMENT_STATUSES for field in fields)


def task_has_running_experiment(snapshot: dict[str, Any], task: dict[str, Any]) -> bool:
    normalized_task_code = task_code(task)
    if not normalized_task_code:
        return False
    if normalize_text(task.get("status")) in RUNNING_TASK_STATUSES:
        return True
    for key in ("mes.schedules", "mes.experiments", "mes.experiment_runs"):
        if any(row_task_code(row) == normalized_task_code and row_has_running_experiment_status(row) for row in as_list(snapshot.get(key))):
            return True
    if any(
        row_task_code(row) == normalized_task_code
        and row_has_running_experiment_status(row, ("run_tray_status", "status", "experiment_status"))
        for row in as_list(snapshot.get("mes.experiment_run_trays"))
    ):
        return True
    for sample in as_list(snapshot.get("mes.samples")):
        if row_task_code(sample) != normalized_task_code:
            continue
        if any(row_has_running_experiment_status(tray) for tray in as_list(sample.get("trays"))):
            return True
    return False


def task_is_completed(task: dict[str, Any], existing_experiments: list[dict[str, Any]]) -> bool:
    if normalize_text(task.get("status")) in COMPLETED_TASK_STATUSES:
        return True
    task_experiments = [dict(experiment) for experiment in existing_experiments if normalize_text(experiment.get("status"))]
    return bool(task_experiments) and all(
        normalize_text(experiment.get("status")) in COMPLETED_EXPERIMENT_STATUSES
        for experiment in task_experiments
    )


def comparable_task_value(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: comparable_task_value(value[key]) for key in sorted(value)}
    if isinstance(value, list):
        return [comparable_task_value(item) for item in value]
    return normalize_text(value)


def task_update_changes_only_completed_editable_fields(previous_task: dict[str, Any], payload: dict[str, Any]) -> bool:
    for field, value in payload.items():
        if field in COMPLETED_TASK_EDITABLE_FIELDS:
            continue
        if comparable_task_value(previous_task.get(field)) != comparable_task_value(value):
            return False
    return True


def is_retention_schedule(row: dict[str, Any]) -> bool:
    return "暂存间" in normalize_text(row.get("device"))


def experiment_label(experiment: dict[str, Any]) -> str:
    return normalize_text(
        experiment.get("experiment_name")
        or experiment.get("experiment_type")
        or experiment.get("required_device")
    )


def test_types_changed(previous_types: list[str], next_types: list[str]) -> bool:
    return [normalize_text(item) for item in previous_types] != [normalize_text(item) for item in next_types]


def parse_bool_flag(value: Any) -> bool:
    return value is True


def task_storage_confirmed(task: dict[str, Any], samples: list[dict[str, Any]]) -> bool:
    code = task_code(task)
    if is_storage_confirmed_status(task.get("transfer_status") or task.get("transferStatus")):
        return True
    for sample in samples:
        if sample_task_code(sample) != code:
            continue
        if is_storage_confirmed_status(sample.get("status")) or is_storage_confirmed_status(sample.get("flow_status")):
            return True
        for tray in as_list(sample.get("trays")):
            if is_storage_confirmed_status(tray.get("status") or tray.get("tray_status") or tray.get("trayStatus")):
                return True
    return False


def affected_experiment_codes(
    previous_experiments: list[dict[str, Any]],
    next_experiments: list[dict[str, Any]],
) -> set[str]:
    previous_by_code = {
        normalize_text(experiment.get("experiment_code")): dict(experiment)
        for experiment in previous_experiments
        if normalize_text(experiment.get("experiment_code"))
    }
    next_by_code = {
        normalize_text(experiment.get("experiment_code")): dict(experiment)
        for experiment in next_experiments
        if normalize_text(experiment.get("experiment_code"))
    }
    affected = set(previous_by_code) - set(next_by_code)
    for code in set(previous_by_code) & set(next_by_code):
        if experiment_label(previous_by_code[code]) != experiment_label(next_by_code[code]):
            affected.add(code)
    return affected


def schedule_requires_experiment_removal_confirmation(schedule: dict[str, Any], task_code_value: str, experiment_codes: set[str]) -> bool:
    return (
        normalize_text(schedule.get("task_code")) == task_code_value
        and normalize_text(schedule.get("experiment_code")) in experiment_codes
        and not is_retention_schedule(schedule)
    )


def affected_scheduled_experiment_rows(schedules: list[dict[str, Any]], task_code_value: str, experiment_codes: set[str]) -> list[dict[str, str]]:
    rows = []
    for schedule in schedules:
        if not schedule_requires_experiment_removal_confirmation(schedule, task_code_value, experiment_codes):
            continue
        rows.append(
            {
                "id": normalize_text(schedule.get("id")),
                "experiment_code": normalize_text(schedule.get("experiment_code")),
                "device": normalize_text(schedule.get("device")),
                "start_at": normalize_text(schedule.get("start_at")),
                "end_at": normalize_text(schedule.get("end_at")),
            }
        )
    return rows


def task_formal_schedule_rows(schedules: list[dict[str, Any]], task_code_value: str) -> list[dict[str, str]]:
    rows = []
    for schedule in schedules:
        if normalize_text(schedule.get("task_code")) != task_code_value or is_retention_schedule(schedule):
            continue
        rows.append(
            {
                "id": normalize_text(schedule.get("id")),
                "experiment_code": normalize_text(schedule.get("experiment_code")),
                "device": normalize_text(schedule.get("device")),
                "start_at": normalize_text(schedule.get("start_at")),
                "end_at": normalize_text(schedule.get("end_at")),
            }
        )
    return rows


def keep_row_outside_removed_experiments(row: dict[str, Any], task_code_value: str, experiment_codes: set[str]) -> bool:
    return not (
        normalize_text(row.get("task_code")) == task_code_value
        and normalize_text(row.get("experiment_code")) in experiment_codes
    )


def keep_row_outside_task(row: dict[str, Any], task_code_value: str) -> bool:
    return normalize_text(row.get("task_code")) != task_code_value


def reset_task_preallocation(task: dict[str, Any], samples: list[dict[str, Any]], task_code_value: str) -> None:
    task["transfer_status"] = TRANSFER_PENDING_STATUS
    task["tray_codes"] = []
    task["status"] = "待排程"
    for sample in samples:
        if sample_task_code(sample) != task_code_value:
            continue
        sample["status"] = SAMPLE_TRANSPORT_STATUS
        sample["flow_status"] = SAMPLE_TRANSPORT_STATUS
        sample["location"] = ""
        sample["trays"] = []
        if isinstance(sample.get("history"), list):
            sample["history"] = [
                entry
                for entry in sample["history"]
                if normalize_text(entry.get("action")) not in TRANSFER_HISTORY_ACTIONS
            ]


def reset_experiments_for_reschedule(experiments: list[dict[str, Any]]) -> None:
    for experiment in experiments:
        experiment["status"] = "待排程"
        experiment["unscheduled_since"] = ""


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
        raise HTTPException(status_code=400, detail=f"样品数量最多为 {MAX_SAMPLE_COUNT}")
    return str(parsed)


def validate_task_text_fields(task: dict[str, Any], *, require_contact: bool = False) -> None:
    contact = normalize_text(task.get("contact"))
    contact_info = normalize_text(task.get("contact_info"))
    if require_contact and not contact:
        raise HTTPException(status_code=400, detail="请填写联系人")
    if require_contact and not contact_info:
        raise HTTPException(status_code=400, detail="请填写联系方式")
    if contact_info and not re.fullmatch(r"\d{1,15}", contact_info):
        raise HTTPException(status_code=400, detail="联系方式必须为 1-15 位数字")
    task_name = normalize_text(task.get("name"))
    if len(task_name) > 20:
        raise HTTPException(status_code=400, detail="任务名称不能超过 20 个字")
    for field, label in TASK_TEXT_FIELD_LABELS.items():
        value = normalize_text(task.get(field))
        if value and INVALID_TASK_TEXT_PATTERN.search(value):
            raise HTTPException(status_code=400, detail=f"{label}包含无效字符，请检查输入")


def build_default_task_name(task_code_value: str, tasks: list[dict[str, Any]]) -> str:
    digits = re.sub(r"\D", "", normalize_text(task_code_value))
    suffix = (digits or "00000")[-5:].zfill(5)
    base_name = f"测试实验{suffix}"
    existing_names = {normalize_text(task.get("name")) for task in tasks if normalize_text(task.get("name"))}
    if base_name not in existing_names:
        return base_name
    for index in range(2, 1000):
        candidate = f"{base_name}-{index}"
        if candidate not in existing_names:
            return candidate
    return f"{base_name}-999"


def task_sample_code(task_code_value: str, index: int) -> str:
    return f"{task_code_value}-SP-{index:03d}"


def sample_sort_key(sample: dict[str, Any]) -> tuple[int, str, str]:
    code = normalize_text(sample.get("code"))
    matched = re.search(r"-SP-(\d+)$", code)
    serial = int(matched.group(1)) if matched else MAX_SAMPLE_COUNT + 1
    return (serial, code, normalize_text(sample.get("id")))


def build_task_sample(task: dict[str, Any], code: str) -> dict[str, Any]:
    return {
        "id": code,
        "code": code,
        "task_code": task_code(task),
        "sample_type": normalize_text(task.get("sample_type")),
        "batch_no": "",
        "arrival_at": normalize_text(task.get("arrival_at")),
        "quantity": "1",
        "storage_condition": "",
        "barcode": "",
        "remark": "",
        "location": "",
        "owner": "",
        "status": "运输中",
        "flow_status": "运输中",
        "trays": [],
        "history": [],
    }


def migrate_task_sample_code(sample: dict[str, Any], previous_task_code: str, next_task_code: str) -> None:
    if not previous_task_code or previous_task_code == next_task_code:
        return
    sample["task_code"] = next_task_code
    matched = re.fullmatch(rf"{re.escape(previous_task_code)}-SP-(\d{{3}})", normalize_text(sample.get("code")))
    if matched:
        sample["code"] = task_sample_code(next_task_code, int(matched.group(1)))
        if normalize_text(sample.get("id")) == f"{previous_task_code}-SP-{matched.group(1)}":
            sample["id"] = sample["code"]


def sync_task_samples(samples: list[dict[str, Any]], task: dict[str, Any], previous_task_code: str = "") -> list[dict[str, Any]]:
    next_task_code = task_code(task)
    if not next_task_code:
        return [dict(sample) for sample in samples]
    planned_count = parse_int(task.get("sample_count"))
    if planned_count <= 0:
        return [dict(sample) for sample in samples if sample_task_code(dict(sample)) != next_task_code]

    old_task_code = normalize_text(previous_task_code) or next_task_code
    normalized_samples = [dict(sample) for sample in samples]
    for sample in normalized_samples:
        if sample_task_code(sample) == old_task_code:
            migrate_task_sample_code(sample, old_task_code, next_task_code)

    related_samples = sorted(
        [sample for sample in normalized_samples if sample_task_code(sample) == next_task_code],
        key=sample_sort_key,
    )
    other_samples = [sample for sample in normalized_samples if sample_task_code(sample) != next_task_code]
    next_samples = other_samples + related_samples[:planned_count]
    existing_codes = {normalize_text(sample.get("code")) for sample in next_samples if normalize_text(sample.get("code"))}

    serial = 1
    while len(next_samples) - len(other_samples) < planned_count:
        code = task_sample_code(next_task_code, serial)
        serial += 1
        if code in existing_codes:
            continue
        next_samples.append(build_task_sample(task, code))
        existing_codes.add(code)

    return next_samples


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
    )


def task_has_selected_experiments(task: dict[str, Any], existing_experiments: list[dict[str, Any]] | None = None) -> bool:
    if existing_experiments:
        return True
    return bool(extract_task_test_types(task, existing_experiments))


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
    explicit_test_types = isinstance(task.get("test_types"), list) and bool(experiment_types)

    experiments: list[dict[str, Any]] = []
    for index, experiment_code in enumerate(experiment_codes):
        source = existing_by_code.get(experiment_code, {})
        if explicit_test_types:
            experiment_name = experiment_types[index]
            required_device = experiment_types[index]
        else:
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
    explicit_test_types = isinstance(task.get("test_types"), list)
    experiments = build_task_experiments(task, existing_experiments)
    task["test_types"] = build_experiment_types(task, len(experiments), existing_experiments)
    task["test_type"] = " / ".join(task["test_types"])
    if explicit_test_types or not normalize_text(task.get("required_device")):
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
    if not normalize_text(next_task.get("name")):
        next_task["name"] = build_default_task_name(task_code(next_task), tasks)
    next_task["sample_count"] = validate_sample_count(next_task.get("sample_count"))
    ensure_unique_task_code(tasks, next_task.get("code"))
    validate_task_text_fields(next_task, require_contact=True)
    next_experiments = persist_task_experiments(next_task)
    tasks.insert(0, next_task)
    snapshot["mes.tasks"] = tasks
    snapshot["mes.samples"] = sync_task_samples([dict(sample) for sample in snapshot.get("mes.samples", [])], next_task)
    snapshot["mes.experiments"] = experiments + next_experiments
    storage.write_many(snapshot)
    publish_storage_update(list(TASK_STORAGE_UPDATE_KEYS))
    return next_task


@router.post("/reset")
def reset_tasks() -> dict[str, int]:
    storage = get_storage_backend()
    result = run_demo_reset(storage)
    publish_storage_update(list(TASK_STORAGE_UPDATE_KEYS))
    return result


@router.put("/{task_id}")
def update_task(task_id: str, payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
    storage = get_storage_backend()
    snapshot = load_snapshot(storage)
    tasks = [dict(task) for task in snapshot.get("mes.tasks", [])]
    task_index = find_task_index(tasks, task_id)
    if task_index < 0:
        raise HTTPException(status_code=404, detail="Task not found")
    previous_task = dict(tasks[task_index])
    payload_dict = dict(payload)
    confirm_remove_scheduled_experiments = parse_bool_flag(payload_dict.pop("confirm_remove_scheduled_experiments", False))
    updated_task = {**tasks[task_index], **payload_dict}
    all_experiments = [dict(experiment) for experiment in snapshot.get("mes.experiments", [])]
    samples = [dict(sample) for sample in snapshot.get("mes.samples", [])]
    previous_task_code = task_code(previous_task)
    existing_experiments = [experiment for experiment in all_experiments if normalize_text(experiment.get("task_code")) == previous_task_code]
    if task_is_completed(previous_task, existing_experiments):
        if not task_update_changes_only_completed_editable_fields(previous_task, payload_dict):
            raise HTTPException(status_code=400, detail=COMPLETED_TASK_EDIT_LOCKED_MESSAGE)
        completed_task = dict(previous_task)
        if "name" in payload_dict:
            completed_task["name"] = payload_dict.get("name")
        if not normalize_text(completed_task.get("name")):
            completed_task["name"] = build_default_task_name(task_code(completed_task), tasks)
        validate_task_text_fields(completed_task)
        tasks[task_index] = completed_task
        snapshot["mes.tasks"] = tasks
        storage.write_many(snapshot)
        publish_storage_update(list(TASK_STORAGE_UPDATE_KEYS))
        return completed_task
    previous_test_types = extract_task_test_types(previous_task, existing_experiments)
    experiment_types_changed = False
    if "test_types" in payload_dict:
        updated_task["test_types"] = parse_test_types(updated_task.get("test_types"))
        experiment_types_changed = test_types_changed(previous_test_types, updated_task["test_types"])
        if experiment_types_changed:
            if task_storage_confirmed(previous_task, samples):
                raise HTTPException(status_code=400, detail=EXPERIMENT_TYPE_LOCKED_MESSAGE)
    if not normalize_text(updated_task.get("name")):
        updated_task["name"] = build_default_task_name(task_code(updated_task), tasks)
    validate_task_text_fields(updated_task)
    next_sample_count = validate_sample_count(updated_task.get("sample_count"))
    sample_count_changed = parse_int(previous_task.get("sample_count")) != parse_int(next_sample_count)
    if (
        sample_count_changed
        and task_storage_confirmed(previous_task, samples)
        and task_has_selected_experiments(previous_task, existing_experiments)
    ):
        raise HTTPException(status_code=400, detail=SAMPLE_COUNT_LOCKED_MESSAGE)
    updated_task["sample_count"] = next_sample_count
    next_experiments = persist_task_experiments(updated_task, existing_experiments)
    removed_or_changed_codes = affected_experiment_codes(existing_experiments, next_experiments)
    schedules = [dict(schedule) for schedule in snapshot.get("mes.schedules", [])]
    affected_schedules = (
        task_formal_schedule_rows(schedules, previous_task_code)
        if experiment_types_changed
        else affected_scheduled_experiment_rows(schedules, previous_task_code, removed_or_changed_codes)
    )
    if affected_schedules and not confirm_remove_scheduled_experiments:
        raise HTTPException(
            status_code=409,
            detail={
                "code": SCHEDULED_EXPERIMENT_REMOVAL_CODE,
                "message": SCHEDULED_EXPERIMENT_REMOVAL_MESSAGE,
                "affected_schedules": affected_schedules,
            },
        )
    tasks[task_index] = updated_task
    snapshot["mes.tasks"] = tasks
    snapshot["mes.samples"] = sync_task_samples(
        [dict(sample) for sample in snapshot.get("mes.samples", [])],
        updated_task,
        previous_task_code,
    )
    if experiment_types_changed:
        reset_task_preallocation(updated_task, snapshot["mes.samples"], task_code(updated_task))
        reset_experiments_for_reschedule(next_experiments)
    snapshot["mes.experiments"] = [
        experiment for experiment in all_experiments if normalize_text(experiment.get("task_code")) != previous_task_code
    ] + next_experiments
    if experiment_types_changed:
        snapshot["mes.schedules"] = [
            schedule for schedule in schedules if keep_row_outside_task(schedule, previous_task_code)
        ]
        snapshot["mes.experiment_trays"] = [
            dict(row)
            for row in snapshot.get("mes.experiment_trays", [])
            if keep_row_outside_task(dict(row), previous_task_code)
        ]
        snapshot["mes.experiment_samples"] = [
            dict(row)
            for row in snapshot.get("mes.experiment_samples", [])
            if keep_row_outside_task(dict(row), previous_task_code)
        ]
        snapshot["mes.experiment_runs"] = [
            dict(row)
            for row in snapshot.get("mes.experiment_runs", [])
            if keep_row_outside_task(dict(row), previous_task_code)
        ]
        snapshot["mes.experiment_run_trays"] = [
            dict(row)
            for row in snapshot.get("mes.experiment_run_trays", [])
            if keep_row_outside_task(dict(row), previous_task_code)
        ]
    elif removed_or_changed_codes:
        snapshot["mes.schedules"] = [
            schedule
            for schedule in schedules
            if keep_row_outside_removed_experiments(schedule, previous_task_code, removed_or_changed_codes)
        ]
        snapshot["mes.experiment_trays"] = [
            dict(row)
            for row in snapshot.get("mes.experiment_trays", [])
            if keep_row_outside_removed_experiments(dict(row), previous_task_code, removed_or_changed_codes)
        ]
        snapshot["mes.experiment_samples"] = [
            dict(row)
            for row in snapshot.get("mes.experiment_samples", [])
            if keep_row_outside_removed_experiments(dict(row), previous_task_code, removed_or_changed_codes)
        ]
        snapshot["mes.experiment_runs"] = [
            dict(row)
            for row in snapshot.get("mes.experiment_runs", [])
            if keep_row_outside_removed_experiments(dict(row), previous_task_code, removed_or_changed_codes)
        ]
        snapshot["mes.experiment_run_trays"] = [
            dict(row)
            for row in snapshot.get("mes.experiment_run_trays", [])
            if keep_row_outside_removed_experiments(dict(row), previous_task_code, removed_or_changed_codes)
        ]
    storage.write_many(snapshot)
    publish_storage_update(list(TASK_STORAGE_UPDATE_KEYS))
    return updated_task


@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_task(task_id: str) -> None:
    storage = get_storage_backend()
    snapshot = load_snapshot(storage)
    tasks = [dict(task) for task in snapshot.get("mes.tasks", [])]
    task_index = find_task_index(tasks, task_id)
    if task_index < 0:
        raise HTTPException(status_code=404, detail="Task not found")
    removed_task = tasks[task_index]
    if task_has_running_experiment(snapshot, removed_task):
        raise HTTPException(status_code=409, detail=RUNNING_TASK_DELETE_MESSAGE)
    removed_task = tasks.pop(task_index)
    task_code = normalize_text(removed_task.get("code")) or normalize_text(removed_task.get("id"))
    snapshot["mes.tasks"] = tasks
    snapshot["mes.schedules"] = filter_related_rows(snapshot.get("mes.schedules"), task_code)
    snapshot["mes.samples"] = filter_related_rows(snapshot.get("mes.samples"), task_code)
    snapshot["mes.streams"] = filter_related_rows(snapshot.get("mes.streams"), task_code)
    snapshot["mes.experiments"] = filter_related_rows(snapshot.get("mes.experiments"), task_code)
    snapshot["mes.experiment_trays"] = filter_related_rows(snapshot.get("mes.experiment_trays"), task_code)
    snapshot["mes.experiment_samples"] = filter_related_rows(snapshot.get("mes.experiment_samples"), task_code)
    snapshot["mes.experiment_runs"] = filter_related_rows(snapshot.get("mes.experiment_runs"), task_code)
    snapshot["mes.experiment_run_trays"] = filter_related_rows(snapshot.get("mes.experiment_run_trays"), task_code)
    storage.write_many(snapshot)
    publish_storage_update(list(TASK_STORAGE_UPDATE_KEYS))
    return None
