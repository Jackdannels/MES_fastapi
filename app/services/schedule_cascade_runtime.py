"""Event-driven persistence for laboratory schedule delay cascades."""

from __future__ import annotations

from datetime import timedelta
from typing import Any, Iterable

from app.core.storage_backend import normalize_storage_payload
from app.core.time_utils import format_business_datetime, now_business_text, parse_business_datetime
from app.services.schedule_cascade import plan_same_lab_schedule_cascade


CASCADE_READ_KEYS = (
    "mes.schedules",
    "mes.devices",
    "mes.samples",
    "mes.experiment_trays",
    "mes.experiment_runs",
    "mes.experiment_run_trays",
    "mes.experiment_run_steps",
    "mes.conflicts",
)
CASCADE_CONFLICT_TYPE = "schedule_delay_cascade_conflict"
WAITING_ACTIVE_RUN_CONFLICT_TYPE = "schedule_delayed_by_active_run"


def _text(value: Any) -> str:
    return str(value or "").strip()


def _as_rows(value: Any) -> list[dict[str, Any]]:
    return [dict(item) for item in value if isinstance(item, dict)] if isinstance(value, list) else []


def _read_snapshot(storage: Any, keys: Iterable[str] = CASCADE_READ_KEYS) -> dict[str, Any]:
    read_many = getattr(storage, "read_many", None)
    if callable(read_many):
        return normalize_storage_payload(read_many(keys))
    return normalize_storage_payload(storage.read_all())


def _patch_schedules(
    storage: Any,
    snapshot: dict[str, Any],
    updates: list[dict[str, Any]],
) -> None:
    patch_schedules = getattr(storage, "patch_schedules", None)
    if callable(patch_schedules):
        patch_schedules(updates)
        return
    updates_by_id = {_text(item.get("id")): item for item in updates if _text(item.get("id"))}
    merged = [
        dict(updates_by_id.get(_text(item.get("id")), item))
        for item in _as_rows(snapshot.get("mes.schedules"))
    ]
    storage.write("mes.schedules", merged)


def _persist_conflicts(
    storage: Any,
    snapshot: dict[str, Any],
    conflicts: list[dict[str, Any]],
    *,
    current_schedule_id: str,
    reason: str,
    source_run_no: str,
) -> list[dict[str, Any]]:
    existing = _as_rows(snapshot.get("mes.conflicts"))
    existing_by_id = {_text(item.get("id")): item for item in existing if _text(item.get("id"))}
    occurred_at = now_business_text()
    records: list[dict[str, Any]] = []
    for conflict in conflicts:
        schedule_id = _text(conflict.get("schedule_id"))
        code = _text(conflict.get("code")) or "CASCADE_BLOCKED"
        conflict_id = f"schedule-delay:{source_run_no or current_schedule_id}:{schedule_id}:{code}"
        previous = existing_by_id.get(conflict_id, {})
        record = {
            **previous,
            **conflict,
            "id": conflict_id,
            "type": CASCADE_CONFLICT_TYPE,
            "status": "pending",
            "reason": _text(reason) or "前序实验延期",
            "source_run_no": _text(source_run_no),
            "source_schedule_id": _text(current_schedule_id),
            "created_at": _text(previous.get("created_at")) or occurred_at,
            "updated_at": occurred_at,
        }
        existing_by_id[conflict_id] = record
        records.append(record)
    storage.write("mes.conflicts", list(existing_by_id.values()))
    return records


def _resolve_waiting_conflicts(
    storage: Any,
    snapshot: dict[str, Any],
    *,
    source_run_no: str,
) -> list[dict[str, Any]]:
    normalized_run_no = _text(source_run_no)
    if not normalized_run_no:
        return []
    occurred_at = now_business_text()
    changed: list[dict[str, Any]] = []
    next_conflicts: list[dict[str, Any]] = []
    for conflict in _as_rows(snapshot.get("mes.conflicts")):
        if (
            _text(conflict.get("type")) == WAITING_ACTIVE_RUN_CONFLICT_TYPE
            and _text(conflict.get("source_run_no")) == normalized_run_no
            and _text(conflict.get("status")) == "pending"
        ):
            conflict = {
                **conflict,
                "status": "resolved",
                "resolved_at": occurred_at,
                "updated_at": occurred_at,
            }
            changed.append(conflict)
        next_conflicts.append(conflict)
    if changed:
        storage.write("mes.conflicts", next_conflicts)
    return changed


def apply_same_lab_schedule_cascade(
    storage: Any,
    *,
    current_schedule_id: str,
    new_end_at: Any,
    reason: str,
    source_run_no: str = "",
) -> dict[str, Any]:
    """Plan and persist one schedule cascade caused by a lifecycle event.

    The function has no clock loop. It is called only when a start, forecast, or
    completion event supplies a new authoritative boundary for the current run.
    """

    snapshot = _read_snapshot(storage)
    result = plan_same_lab_schedule_cascade(
        snapshot,
        current_schedule_id=current_schedule_id,
        new_end_at=new_end_at,
        reason=reason,
        source_run_no=source_run_no,
    )
    updates = _as_rows(result.get("updates"))
    conflicts = _as_rows(result.get("conflicts"))
    if updates:
        _patch_schedules(storage, snapshot, updates)
    conflict_records = (
        _persist_conflicts(
            storage,
            snapshot,
            conflicts,
            current_schedule_id=current_schedule_id,
            reason=reason,
            source_run_no=source_run_no,
        )
        if conflicts
        else []
    )
    resolved_conflicts = (
        _resolve_waiting_conflicts(storage, snapshot, source_run_no=source_run_no)
        if not conflicts
        else []
    )
    return {
        **result,
        "conflict_records": conflict_records,
        "resolved_conflicts": resolved_conflicts,
        "changed": bool(updates or conflict_records or resolved_conflicts),
    }


def apply_run_schedule_cascade(
    storage: Any,
    run: dict[str, Any] | None,
    *,
    new_end_at: Any,
    reason: str,
) -> dict[str, Any]:
    """Apply a cascade using the persisted schedule identity of one run."""

    current_run = run if isinstance(run, dict) else {}
    schedule_id = _text(
        current_run.get("schedule_id")
        or current_run.get("scheduleId")
        or current_run.get("schedule_no")
        or current_run.get("scheduleNo")
    )
    run_no = _text(current_run.get("run_no") or current_run.get("runNo") or current_run.get("id"))
    if not schedule_id:
        return {
            "updates": [],
            "proposed_updates": [],
            "conflicts": [],
            "conflict_records": [],
            "resolved_conflicts": [],
            "changed": False,
            "skipped_reason": "run_schedule_id_missing",
        }
    if not _text(new_end_at):
        return {
            "updates": [],
            "proposed_updates": [],
            "conflicts": [],
            "conflict_records": [],
            "resolved_conflicts": [],
            "changed": False,
            "skipped_reason": "authoritative_end_missing",
        }
    return apply_same_lab_schedule_cascade(
        storage,
        current_schedule_id=schedule_id,
        new_end_at=new_end_at,
        reason=reason,
        source_run_no=run_no,
    )


def run_forecast_end_at(run: dict[str, Any] | None) -> str:
    """Return a run forecast without deriving it from the wall clock."""

    current_run = run if isinstance(run, dict) else {}
    explicit = _text(current_run.get("planned_end_at") or current_run.get("plannedEndAt"))
    if explicit:
        return explicit
    started_at = parse_business_datetime(current_run.get("started_at") or current_run.get("startedAt"))
    try:
        planned_hours = float(current_run.get("planned_hours") or current_run.get("plannedHours") or 0)
    except (TypeError, ValueError):
        planned_hours = 0
    if started_at is None or planned_hours <= 0:
        return ""
    return format_business_datetime(started_at + timedelta(hours=planned_hours))
