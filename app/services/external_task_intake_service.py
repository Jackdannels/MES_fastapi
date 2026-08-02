from typing import Any
import re
import uuid

from fastapi import HTTPException

from app.core.storage_backend import get_storage_backend
from app.core.time_utils import now_business_text
from app.services.lims_rabbitmq import LIMS_OUTBOX_KEY


SNAPSHOT_KEYS = (
    "mes.tasks",
    "mes.external_task_intakes",
    "mes.schedules",
    "mes.samples",
    "mes.streams",
    "mes.experiments",
    "mes.experiment_trays",
    "mes.experiment_samples",
    "mes.experiment_runs",
    "mes.experiment_run_trays",
    "mes.experiment_run_steps",
    "mes.staging_events",
)
MIN_SAMPLE_COUNT = 1
MAX_SAMPLE_COUNT = 99
MAX_CONTACT_LENGTH = 15
EXTERNAL_SOURCE = "外部委托"
INTERNAL_SOURCE = "内部新增"
EXTERNAL_INTAKES_KEY = "mes.external_task_intakes"
LIMS_INBOX_KEY = "mes.lims_inbox"
INTEGRATION_KEYS = (LIMS_INBOX_KEY, LIMS_OUTBOX_KEY)
EXTERNAL_INTAKE_PENDING = "pending"
EXTERNAL_INTAKE_ACCEPTED = "accepted"
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


def load_snapshot(storage=None, *, keys: tuple[str, ...] | None = None) -> dict[str, Any]:
    storage_backend = storage or get_storage_backend()
    requested_keys = tuple(dict.fromkeys(keys or (*SNAPSHOT_KEYS, *INTEGRATION_KEYS)))
    read_many = getattr(storage_backend, "read_many", None)
    if callable(read_many):
        snapshot = read_many(requested_keys)
    else:
        snapshot = storage_backend.read_all() if hasattr(storage_backend, "read_all") else {}
    if not isinstance(snapshot, dict):
        snapshot = {}
    for key in requested_keys:
        if key not in snapshot:
            value = storage_backend.read(key) if hasattr(storage_backend, "read") else []
            snapshot[key] = [dict(item) for item in value] if isinstance(value, list) else []
    return snapshot


def task_code(task: dict[str, Any]) -> str:
    return normalize_text(task.get("code") or task.get("task_code") or task.get("taskNo") or task.get("task_no") or task.get("id"))


def ensure_unique_task_code(tasks: list[dict[str, Any]], code: Any) -> None:
    normalized_code = normalize_text(code)
    if not normalized_code:
        return
    if any(normalize_text(task.get("code")) == normalized_code for task in tasks):
        raise HTTPException(status_code=400, detail="任务编号已存在")


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
    if len(contact) > MAX_CONTACT_LENGTH:
        raise HTTPException(status_code=400, detail=f"联系人不能超过 {MAX_CONTACT_LENGTH} 个字")
    if contact_info and not re.fullmatch(r"\d{1,15}", contact_info):
        raise HTTPException(status_code=400, detail="联系方式必须为 1-15 位数字")
    task_name = normalize_text(task.get("name"))
    if len(task_name) > 20:
        raise HTTPException(status_code=400, detail="任务名称不能超过 20 个字")
    for field, label in TASK_TEXT_FIELD_LABELS.items():
        value = normalize_text(task.get(field))
        if value and INVALID_TASK_TEXT_PATTERN.search(value):
            raise HTTPException(status_code=400, detail=f"{label}包含无效字符，请检查输入")


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


def external_intake_id(intake: dict[str, Any]) -> str:
    return normalize_text(intake.get("intake_id") or intake.get("lims_request_id") or intake.get("id"))


def external_intake_status(intake: dict[str, Any]) -> str:
    return normalize_text(intake.get("acceptance_status")) or EXTERNAL_INTAKE_PENDING


def find_external_intake_index(intakes: list[dict[str, Any]], intake_id: str) -> int:
    normalized_id = normalize_text(intake_id)
    for index, intake in enumerate(intakes):
        if external_intake_id(intake) == normalized_id:
            return index
    return -1


def ensure_unique_external_intake(
    intakes: list[dict[str, Any]],
    *,
    intake_id: str,
    task_code_value: str,
) -> None:
    if any(external_intake_id(item) == intake_id for item in intakes):
        raise HTTPException(status_code=409, detail="LIMS 下发请求已存在")
    if any(task_code(item) == task_code_value for item in intakes):
        raise HTTPException(status_code=409, detail="外部委托任务编号已存在")


def build_lims_status_event(intake: dict[str, Any], event_status: str, *, detail: str = "") -> dict[str, Any]:
    intake_id = external_intake_id(intake)
    occurred_at = now_business_text()
    payload = {
        "lims_request_id": intake_id,
        "intake_id": intake_id,
        "code": task_code(intake),
        "acceptance_status": event_status,
        "detail": normalize_text(detail),
        "occurred_at": occurred_at,
    }
    return {
        "event_id": uuid.uuid4().hex,
        "message_id": str(uuid.uuid4()),
        "correlation_id": intake_id,
        "type": f"mes.external-intake.{event_status}.v1",
        "schema_version": 1,
        "source": "MES",
        "occurred_at": occurred_at,
        "routing_key": f"mes.external-intake.{event_status}.v1",
        "payload": payload,
    }


def list_external_task_intakes(storage: Any, acceptance_status: str) -> list[dict[str, Any]]:
    stored = storage.read(EXTERNAL_INTAKES_KEY)
    intakes = [dict(item) for item in stored] if isinstance(stored, list) else []
    normalized_status = normalize_text(acceptance_status)
    if normalized_status:
        intakes = [item for item in intakes if external_intake_status(item) == normalized_status]
    return sorted(intakes, key=lambda item: normalize_text(item.get("received_at")), reverse=True)


def store_external_task_intake(
    storage: Any,
    payload: dict[str, Any],
    *,
    message_id: str,
    publish_update: Any,
) -> dict[str, Any]:
    targeted_task_checker = getattr(storage, "task_code_exists", None)
    store_keys = (EXTERNAL_INTAKES_KEY, LIMS_INBOX_KEY, LIMS_OUTBOX_KEY)
    if not callable(targeted_task_checker):
        store_keys = ("mes.tasks", *store_keys)
    snapshot = load_snapshot(storage, keys=store_keys)
    tasks = [dict(task) for task in snapshot.get("mes.tasks", [])]
    intakes = [dict(item) for item in snapshot.get(EXTERNAL_INTAKES_KEY, [])]
    inbox = [dict(item) for item in snapshot.get(LIMS_INBOX_KEY, [])]
    outbox = [dict(item) for item in snapshot.get(LIMS_OUTBOX_KEY, [])]
    normalized_message_id = normalize_text(message_id)
    if normalized_message_id and any(normalize_text(item.get("message_id")) == normalized_message_id for item in inbox):
        intake_id = normalize_text(payload.get("lims_request_id") or payload.get("intake_id"))
        existing_index = find_external_intake_index(intakes, intake_id)
        if existing_index >= 0:
            return dict(intakes[existing_index])

    next_intake = dict(payload)
    task_code_value = task_code(next_intake)
    if not task_code_value:
        raise HTTPException(status_code=400, detail="请填写任务编号")
    if "test_types" not in next_intake:
        raise HTTPException(status_code=400, detail="test_types is required")
    next_intake["test_types"] = parse_test_types(next_intake.get("test_types"))
    next_intake["test_type"] = " / ".join(next_intake["test_types"])
    next_intake["sample_count"] = validate_sample_count(next_intake.get("sample_count"))
    next_intake["source"] = EXTERNAL_SOURCE
    next_intake["client"] = normalize_text(next_intake.get("client"))
    if not next_intake["client"]:
        raise HTTPException(status_code=400, detail="请填写委托单位/部门")
    validate_task_text_fields(next_intake, require_contact=True)
    intake_id = normalize_text(next_intake.get("lims_request_id") or next_intake.get("intake_id"))
    intake_id = intake_id or f"LIMS-{uuid.uuid4().hex}"
    existing_index = find_external_intake_index(intakes, intake_id)
    if existing_index >= 0:
        existing = dict(intakes[existing_index])
        if task_code(existing) != task_code_value:
            raise HTTPException(status_code=409, detail="LIMS 下发请求号与已有任务不一致")
        if normalized_message_id:
            inbox.insert(0, {"message_id": normalized_message_id, "lims_request_id": intake_id, "received_at": now_business_text()})
            snapshot[LIMS_INBOX_KEY] = inbox[:5000]
            outbox.append(build_lims_status_event(existing, "received", detail="duplicate intake acknowledged"))
            storage.write_many({LIMS_INBOX_KEY: snapshot[LIMS_INBOX_KEY], LIMS_OUTBOX_KEY: outbox})
        return existing

    if callable(targeted_task_checker):
        if targeted_task_checker(task_code_value):
            raise HTTPException(status_code=400, detail="任务编号已存在")
    else:
        ensure_unique_task_code(tasks, task_code_value)
    ensure_unique_external_intake(intakes, intake_id=intake_id, task_code_value=task_code_value)
    next_intake.update(
        {
            "id": intake_id,
            "intake_id": intake_id,
            "lims_request_id": intake_id,
            "code": task_code_value,
            "acceptance_status": EXTERNAL_INTAKE_PENDING,
            "received_at": now_business_text(),
            "accepted_at": "",
            "accepted_task_code": "",
        }
    )
    intakes.insert(0, next_intake)
    inbox.insert(0, {"message_id": normalized_message_id or intake_id, "lims_request_id": intake_id, "received_at": now_business_text()})
    outbox.append(build_lims_status_event(next_intake, "received"))
    storage.write_many(
        {
            EXTERNAL_INTAKES_KEY: intakes,
            LIMS_INBOX_KEY: inbox[:5000],
            LIMS_OUTBOX_KEY: outbox,
        }
    )
    publish_update([EXTERNAL_INTAKES_KEY])
    return next_intake


def accept_external_task_intake(
    storage: Any,
    intake_id: str,
    *,
    add_task_to_snapshot: Any,
    publish_update: Any,
    task_storage_update_keys: list[str] | tuple[str, ...],
) -> dict[str, Any]:
    scope_reader = getattr(storage, "read_task_scope", None)
    scope_writer = getattr(storage, "write_task_scope", None)
    supports_task_scope = callable(scope_reader) and callable(scope_writer)
    if supports_task_scope:
        snapshot = {key: [] for key in SNAPSHOT_KEYS}
        snapshot.update(load_snapshot(storage, keys=(EXTERNAL_INTAKES_KEY, LIMS_OUTBOX_KEY)))
    else:
        snapshot = load_snapshot(storage)
    intakes = [dict(item) for item in snapshot.get(EXTERNAL_INTAKES_KEY, [])]
    intake_index = find_external_intake_index(intakes, intake_id)
    if intake_index < 0:
        raise HTTPException(status_code=404, detail="外部委托不存在")
    current_intake = dict(intakes[intake_index])
    if external_intake_status(current_intake) == EXTERNAL_INTAKE_ACCEPTED:
        accepted_code = normalize_text(current_intake.get("accepted_task_code")) or task_code(current_intake)
        if supports_task_scope and accepted_code:
            scoped = scope_reader({accepted_code}, ("mes.tasks",))
            accepted_tasks = scoped.get("mes.tasks", []) if isinstance(scoped, dict) else []
        else:
            accepted_tasks = snapshot.get("mes.tasks", [])
        accepted_task = next(
            (dict(item) for item in accepted_tasks if task_code(dict(item)) == accepted_code),
            None,
        )
        return {"intake": current_intake, "task": accepted_task}

    accepted_at = now_business_text()
    task_payload = {
        key: value
        for key, value in current_intake.items()
        if key not in {"acceptance_status", "accepted_at", "accepted_task_code", "intake_id", "lims_request_id", "received_at"}
    }
    task_payload["id"] = task_code(current_intake)
    task_payload["accepted_at"] = accepted_at
    task_code_value = task_code(task_payload)
    task_checker = getattr(storage, "task_code_exists", None)
    if supports_task_scope and callable(task_checker) and task_checker(task_code_value):
        raise HTTPException(status_code=400, detail="任务编号已存在")
    accepted_task = add_task_to_snapshot(snapshot, task_payload, source=EXTERNAL_SOURCE)
    current_intake.update(
        {
            "acceptance_status": EXTERNAL_INTAKE_ACCEPTED,
            "accepted_at": accepted_at,
            "accepted_task_code": task_code(accepted_task),
        }
    )
    intakes[intake_index] = current_intake
    snapshot[EXTERNAL_INTAKES_KEY] = intakes
    outbox = [dict(item) for item in snapshot.get(LIMS_OUTBOX_KEY, [])]
    outbox.append(build_lims_status_event(current_intake, "accepted"))
    snapshot[LIMS_OUTBOX_KEY] = outbox
    if supports_task_scope:
        scope_writer(
            {
                "mes.tasks": snapshot["mes.tasks"],
                "mes.samples": snapshot["mes.samples"],
                "mes.experiments": snapshot["mes.experiments"],
            },
            task_codes={task_code(accepted_task)},
        )
        storage.write_many(
            {
                EXTERNAL_INTAKES_KEY: snapshot[EXTERNAL_INTAKES_KEY],
                LIMS_OUTBOX_KEY: snapshot[LIMS_OUTBOX_KEY],
            }
        )
    else:
        storage.write_many(snapshot)
    publish_update(list(task_storage_update_keys))
    return {"intake": current_intake, "task": accepted_task}
