from __future__ import annotations

from typing import Any

from app.core.time_utils import parse_business_datetime


def normalize_text(value: Any) -> str:
    return str(value or "").strip()


def as_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def parse_time(value: Any):
    return parse_business_datetime(value)


def item_time(item: dict[str, Any]) -> Any:
    return parse_time(item.get("updated_at") or item.get("updatedAt") or item.get("time") or item.get("created_at"))


def incoming_is_not_older(incoming: dict[str, Any], current: dict[str, Any]) -> bool:
    incoming_time = item_time(incoming)
    current_time = item_time(current)
    if incoming_time is None or current_time is None:
        return True
    return incoming_time >= current_time


def sample_key(sample: Any) -> str:
    if not isinstance(sample, dict):
        return ""
    return normalize_text(sample.get("code") or sample.get("sample_code") or sample.get("sampleCode") or sample.get("id"))


def task_code_value(item: Any) -> str:
    if not isinstance(item, dict):
        return ""
    return normalize_text(item.get("task_code") or item.get("taskCode"))


def tray_key(tray: Any) -> str:
    if not isinstance(tray, dict):
        return ""
    return normalize_text(tray.get("tray_code") or tray.get("trayCode") or tray.get("tray_no") or tray.get("trayNo"))


def history_key(entry: Any) -> tuple[str, str, str, str, str]:
    if not isinstance(entry, dict):
        return ("", "", "", "", "")
    return (
        normalize_text(entry.get("action")),
        normalize_text(entry.get("detail")),
        normalize_text(entry.get("status")),
        normalize_text(entry.get("location")),
        normalize_text(entry.get("time")),
    )


def merge_history(current_history: list[Any], incoming_history: list[Any]) -> list[Any]:
    merged: list[Any] = []
    seen: set[tuple[str, str, str, str, str]] = set()
    for entry in [*as_list(incoming_history), *as_list(current_history)]:
        if not isinstance(entry, dict):
            continue
        key = history_key(entry)
        if key in seen:
            continue
        seen.add(key)
        merged.append(dict(entry))
    return merged


def merge_trays(current_trays: list[Any], incoming_trays: list[Any], *, preserve_current_only: bool = True) -> list[dict[str, Any]]:
    current_by_key = {tray_key(tray): dict(tray) for tray in as_list(current_trays) if isinstance(tray, dict) and tray_key(tray)}
    incoming_by_key = {tray_key(tray): dict(tray) for tray in as_list(incoming_trays) if isinstance(tray, dict) and tray_key(tray)}
    ordered_keys = []
    for tray in [*as_list(current_trays), *as_list(incoming_trays)]:
        key = tray_key(tray)
        if key and key not in ordered_keys:
            ordered_keys.append(key)

    merged: list[dict[str, Any]] = []
    for key in ordered_keys:
        current = current_by_key.get(key)
        incoming = incoming_by_key.get(key)
        if current is None and incoming is not None:
            merged.append(dict(incoming))
        elif incoming is None and current is not None and preserve_current_only:
            merged.append(dict(current))
        elif current is not None and incoming is not None:
            merged.append(dict(incoming if incoming_is_not_older(incoming, current) else current))
    return merged


def merge_samples(current_samples: list[Any], incoming_samples: list[Any]) -> list[dict[str, Any]]:
    current_by_key = {sample_key(sample): dict(sample) for sample in as_list(current_samples) if isinstance(sample, dict) and sample_key(sample)}
    incoming_by_key = {sample_key(sample): dict(sample) for sample in as_list(incoming_samples) if isinstance(sample, dict) and sample_key(sample)}
    ordered_keys = []
    for sample in [*as_list(current_samples), *as_list(incoming_samples)]:
        key = sample_key(sample)
        if key and key not in ordered_keys:
            ordered_keys.append(key)

    merged: list[dict[str, Any]] = []
    for key in ordered_keys:
        current = current_by_key.get(key)
        incoming = incoming_by_key.get(key)
        if current is None and incoming is not None:
            merged.append(dict(incoming))
            continue
        if incoming is None and current is not None and item_time(current) is not None:
            merged.append(dict(current))
            continue
        if current is None or incoming is None:
            continue
        incoming_selected = incoming_is_not_older(incoming, current)
        base = dict(incoming if incoming_selected else current)
        base["trays"] = merge_trays(
            current.get("trays"),
            incoming.get("trays"),
            preserve_current_only=not incoming_selected,
        )
        merged.append(base)
    return merged


def event_key(event: Any) -> tuple[str, str, str, str, str, str, str, str]:
    if not isinstance(event, dict):
        return ("", "", "", "", "", "", "", "")
    event_id = normalize_text(event.get("id"))
    if event_id:
        return ("id", event_id, "", "", "", "", "", "")
    return (
        normalize_text(event.get("tray_code") or event.get("trayCode")),
        normalize_text(event.get("task_code") or event.get("taskCode")),
        normalize_text(event.get("action")),
        normalize_text(event.get("room") or event.get("storage_room") or event.get("storageRoom")),
        normalize_text(event.get("time")),
        normalize_text(event.get("target_lab") or event.get("targetLab")),
        normalize_text(event.get("target_experiment_code") or event.get("targetExperimentCode")),
        normalize_text(event.get("target_type") or event.get("targetType")),
    )


def merge_events(current_events: list[Any], incoming_events: list[Any]) -> list[dict[str, Any]]:
    merged: list[dict[str, Any]] = []
    seen: set[tuple[str, str, str, str, str, str, str, str]] = set()
    for event in [*as_list(current_events), *as_list(incoming_events)]:
        if not isinstance(event, dict):
            continue
        key = event_key(event)
        if key in seen:
            continue
        seen.add(key)
        merged.append(dict(event))
    return merged


def generic_item_key(key: str, item: Any) -> str:
    if not isinstance(item, dict):
        return ""
    if key == "mes.tasks":
        return normalize_text(item.get("code") or item.get("id"))
    if key == "mes.experiments":
        return "::".join([normalize_text(item.get("task_code") or item.get("taskCode")), normalize_text(item.get("experiment_code") or item.get("experimentCode"))])
    if key == "mes.schedules":
        return normalize_text(item.get("id")) or "::".join([
            normalize_text(item.get("task_code") or item.get("taskCode")),
            normalize_text(item.get("experiment_code") or item.get("experimentCode")),
            normalize_text(item.get("device")),
        ])
    if key == "mes.experiment_runs":
        return normalize_text(item.get("run_no") or item.get("runNo") or item.get("id"))
    if key == "mes.experiment_run_trays":
        return "::".join([
            normalize_text(item.get("run_no") or item.get("runNo")),
            normalize_text(item.get("task_code") or item.get("taskCode")),
            normalize_text(item.get("experiment_code") or item.get("experimentCode")),
            normalize_text(item.get("tray_code") or item.get("trayCode")),
        ])
    if key == "mes.experiment_run_steps":
        return "::".join([
            normalize_text(item.get("run_no") or item.get("runNo")),
            normalize_text(item.get("task_code") or item.get("taskCode")),
            normalize_text(item.get("experiment_code") or item.get("experimentCode")),
            normalize_text(item.get("axis_code") or item.get("axisCode")),
        ])
    if key == "mes.experiment_trays":
        return "::".join([
            normalize_text(item.get("task_code") or item.get("taskCode")),
            normalize_text(item.get("experiment_code") or item.get("experimentCode")),
            normalize_text(item.get("tray_code") or item.get("trayCode")),
        ])
    if key == "mes.experiment_samples":
        return "::".join([
            normalize_text(item.get("task_code") or item.get("taskCode")),
            normalize_text(item.get("experiment_code") or item.get("experimentCode")),
            normalize_text(item.get("sample_code") or item.get("sampleCode")),
        ])
    return normalize_text(item.get("id"))


def merge_keyed_rows(
    key: str,
    current_rows: list[Any],
    incoming_rows: list[Any],
    *,
    replace_task_codes: set[str] | None = None,
) -> list[dict[str, Any]]:
    normalized_replace_task_codes = {normalize_text(task_code) for task_code in replace_task_codes or set() if normalize_text(task_code)}
    current_by_key = {generic_item_key(key, item): dict(item) for item in as_list(current_rows) if isinstance(item, dict) and generic_item_key(key, item)}
    incoming_by_key = {generic_item_key(key, item): dict(item) for item in as_list(incoming_rows) if isinstance(item, dict) and generic_item_key(key, item)}
    ordered_keys = []
    for item in [*as_list(current_rows), *as_list(incoming_rows)]:
        item_key = generic_item_key(key, item)
        if item_key and item_key not in ordered_keys:
            ordered_keys.append(item_key)

    merged: list[dict[str, Any]] = []
    for item_key in ordered_keys:
        current = current_by_key.get(item_key)
        incoming = incoming_by_key.get(item_key)
        if current is None and incoming is not None:
            merged.append(dict(incoming))
        elif (
            incoming is None
            and current is not None
            and task_code_value(current) not in normalized_replace_task_codes
            and item_time(current) is not None
        ):
            merged.append(dict(current))
        elif current is not None and incoming is not None:
            merged.append(dict(incoming if incoming_is_not_older(incoming, current) else current))
    return merged


def merge_concurrent_storage_updates(
    current_payload: dict[str, Any],
    updates: dict[str, Any],
    *,
    replace_task_codes: set[str] | None = None,
) -> dict[str, Any]:
    merged = dict(updates)
    if "mes.samples" in merged:
        merged["mes.samples"] = merge_samples(current_payload.get("mes.samples"), merged["mes.samples"])
    if "mes.staging_events" in merged:
        merged["mes.staging_events"] = merge_events(current_payload.get("mes.staging_events"), merged["mes.staging_events"])
    for key in (
        "mes.tasks",
        "mes.schedules",
        "mes.experiments",
        "mes.experiment_runs",
        "mes.experiment_run_trays",
        "mes.experiment_run_steps",
        "mes.experiment_trays",
        "mes.experiment_samples",
    ):
        if key in merged:
            merged[key] = merge_keyed_rows(
                key,
                current_payload.get(key),
                merged[key],
                replace_task_codes=replace_task_codes,
            )
    return merged
