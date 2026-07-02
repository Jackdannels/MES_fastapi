from __future__ import annotations

import threading
from contextlib import ExitStack, contextmanager
from typing import Any, Callable, Iterable

from app.core.storage_backend import normalize_storage_payload
from app.core.time_utils import format_business_datetime, now_business_text
from app.services.experiment_segments import normalize_text


COMPARE_STATUS = "已到达实验室"
INSTALL_STATUS = "工装夹具安装"
READY_STATUS = "实验准备就绪"
AXIS_PARTIAL_STATUS_MARKER = "部分完成"
COMPLETED_EXPERIMENT_STATUSES = {"实验已完成", "实验完成", "实验已经完成", "实验后暂存间存放", "厂家收回"}
OPERATION_STATUS = {
    "compare": COMPARE_STATUS,
    "install": INSTALL_STATUS,
    "ready": READY_STATUS,
    "fixtureReady": INSTALL_STATUS,
    "fixture_ready": INSTALL_STATUS,
}
OPERATION_HISTORY_ACTION = {
    "compare": "任务比对",
    "install": "样品安装",
    "ready": "实验确认",
}
LABORATORY_OPERATION_UPDATE_KEYS = ("mes.samples",)
FIXTURE_READY_KEYS = ("fixtureReady", "fixture_ready")

_LOCKS_GUARD = threading.Lock()
_RESOURCE_LOCKS: dict[str, threading.RLock] = {}
_STORAGE_COMMIT_LOCK = threading.RLock()


def clear_fixture_ready_marker(tray: dict[str, Any]) -> None:
    for key in FIXTURE_READY_KEYS:
        tray.pop(key, None)


def as_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def _resource_lock(key: str) -> threading.RLock:
    with _LOCKS_GUARD:
        lock = _RESOURCE_LOCKS.get(key)
        if lock is None:
            lock = threading.RLock()
            _RESOURCE_LOCKS[key] = lock
        return lock


@contextmanager
def acquire_laboratory_operation_locks(resource_keys: Iterable[str]):
    keys = sorted({normalize_text(key) for key in resource_keys if normalize_text(key)})
    with ExitStack() as stack:
        for key in keys:
            stack.enter_context(_resource_lock(key))
        yield


@contextmanager
def acquire_laboratory_storage_commit_lock():
    with _STORAGE_COMMIT_LOCK:
        yield


def storage_snapshot(payload: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    normalized = normalize_storage_payload(payload)
    return {
        "tasks": [dict(item) for item in as_list(normalized.get("mes.tasks")) if isinstance(item, dict)],
        "samples": [dict(item) for item in as_list(normalized.get("mes.samples")) if isinstance(item, dict)],
        "schedules": [dict(item) for item in as_list(normalized.get("mes.schedules")) if isinstance(item, dict)],
        "experiments": [dict(item) for item in as_list(normalized.get("mes.experiments")) if isinstance(item, dict)],
        "experiment_runs": [dict(item) for item in as_list(normalized.get("mes.experiment_runs")) if isinstance(item, dict)],
        "experiment_run_trays": [dict(item) for item in as_list(normalized.get("mes.experiment_run_trays")) if isinstance(item, dict)],
        "experiment_trays": [dict(item) for item in as_list(normalized.get("mes.experiment_trays")) if isinstance(item, dict)],
        "experiment_samples": [dict(item) for item in as_list(normalized.get("mes.experiment_samples")) if isinstance(item, dict)],
        "staging_events": [dict(item) for item in as_list(normalized.get("mes.staging_events")) if isinstance(item, dict)],
    }


def sample_code(sample: dict[str, Any]) -> str:
    return normalize_text(sample.get("code") or sample.get("sample_code") or sample.get("sampleCode") or sample.get("id"))


def sample_identity(sample: dict[str, Any]) -> tuple[str, str]:
    return (
        normalize_text(sample.get("task_code") or sample.get("taskCode") or sample.get("task_no") or sample.get("taskNo")),
        sample_code(sample),
    )


def sample_tray_codes(sample: dict[str, Any]) -> set[str]:
    return {
        normalize_text(tray.get("tray_code") or tray.get("trayCode") or tray.get("tray_no") or tray.get("trayNo"))
        for tray in as_list(sample.get("trays"))
        if isinstance(tray, dict)
        and normalize_text(tray.get("tray_code") or tray.get("trayCode") or tray.get("tray_no") or tray.get("trayNo"))
    }


def tray_target_experiment_code(tray: dict[str, Any]) -> str:
    return normalize_text(
        tray.get("target_experiment_code")
        or tray.get("targetExperimentCode")
        or tray.get("experiment_code")
        or tray.get("experimentCode")
        or tray.get("experiment_no")
        or tray.get("experimentNo")
    )


def partial_axis_experiment_name(status: Any) -> str:
    normalized = normalize_text(status)
    if AXIS_PARTIAL_STATUS_MARKER not in normalized or not normalized.endswith("轴"):
        return ""
    return normalize_text(normalized.split(AXIS_PARTIAL_STATUS_MARKER, 1)[0])


def experiment_completed_for_tray(
    snapshot: dict[str, list[dict[str, Any]]],
    *,
    task_code: str,
    experiment_code: str,
    tray_code: str,
) -> bool:
    normalized_task_code = normalize_text(task_code)
    normalized_experiment_code = normalize_text(experiment_code)
    normalized_tray_code = normalize_text(tray_code)
    if not normalized_task_code or not normalized_experiment_code or not normalized_tray_code:
        return False
    for relation in snapshot.get("experiment_run_trays", []):
        relation_task_code = normalize_text(
            relation.get("task_code")
            or relation.get("taskCode")
            or relation.get("task_no")
            or relation.get("taskNo")
        )
        relation_experiment_code = normalize_text(
            relation.get("experiment_code")
            or relation.get("experimentCode")
            or relation.get("experiment_no")
            or relation.get("experimentNo")
        )
        relation_tray_code = normalize_text(
            relation.get("tray_code")
            or relation.get("trayCode")
            or relation.get("tray_no")
            or relation.get("trayNo")
        )
        relation_status = normalize_text(
            relation.get("run_tray_status")
            or relation.get("runTrayStatus")
            or relation.get("status")
        )
        if (
            relation_task_code == normalized_task_code
            and relation_experiment_code == normalized_experiment_code
            and relation_tray_code == normalized_tray_code
            and relation_status in COMPLETED_EXPERIMENT_STATUSES
        ):
            return True
    return False


def partial_axis_target_blocks_current_operation(
    snapshot: dict[str, list[dict[str, Any]]],
    *,
    current_experiment_code: str,
    current_experiment_name: str,
    sample: dict[str, Any],
    task_code: str,
    tray: dict[str, Any],
    tray_code: str,
) -> bool:
    target_experiment_code = tray_target_experiment_code(tray)
    normalized_current_experiment_code = normalize_text(current_experiment_code)
    if not target_experiment_code or target_experiment_code == normalized_current_experiment_code:
        return False
    if experiment_completed_for_tray(
        snapshot,
        task_code=task_code,
        experiment_code=target_experiment_code,
        tray_code=tray_code,
    ):
        return False
    current_experiment_name = normalize_text(current_experiment_name)
    return any(
        partial_axis_experiment_name(status) == current_experiment_name
        for status in (tray.get("status"), sample.get("status"), sample.get("flow_status"))
    )


def scope_snapshot_samples_for_experiment(
    snapshot: dict[str, list[dict[str, Any]]],
    *,
    task_code: str,
    experiment_code: str,
    tray_codes: list[str],
) -> dict[str, list[dict[str, Any]]]:
    normalized_task_code = normalize_text(task_code)
    normalized_experiment_code = normalize_text(experiment_code)
    scoped_tray_codes = {normalize_text(code) for code in tray_codes if normalize_text(code)}
    if not normalized_task_code or not normalized_experiment_code or not scoped_tray_codes:
        return snapshot

    current_experiment_name = resolve_experiment_name(snapshot, normalized_task_code, normalized_experiment_code)
    experiment_sample_codes = {
        normalize_text(item.get("sample_code") or item.get("sampleCode") or item.get("sample_no") or item.get("sampleNo"))
        for item in snapshot.get("experiment_samples", [])
        if normalize_text(item.get("task_code") or item.get("taskCode") or item.get("task_no") or item.get("taskNo")) == normalized_task_code
        and normalize_text(item.get("experiment_code") or item.get("experimentCode") or item.get("experiment_no") or item.get("experimentNo")) == normalized_experiment_code
        and normalize_text(item.get("sample_code") or item.get("sampleCode") or item.get("sample_no") or item.get("sampleNo"))
    }
    eligible_sample_codes: set[str] = set()
    for sample in snapshot.get("samples", []):
        if normalize_text(sample.get("task_code") or sample.get("taskCode") or sample.get("task_no") or sample.get("taskNo")) != normalized_task_code:
            continue
        current_sample_code = sample_code(sample)
        matching_tray_codes = sample_tray_codes(sample).intersection(scoped_tray_codes)
        if not matching_tray_codes:
            continue
        for tray in as_list(sample.get("trays")):
            if not isinstance(tray, dict):
                continue
            tray_code = normalize_text(tray.get("tray_code") or tray.get("trayCode") or tray.get("tray_no") or tray.get("trayNo"))
            if tray_code not in matching_tray_codes:
                continue
            if partial_axis_target_blocks_current_operation(
                snapshot,
                current_experiment_code=normalized_experiment_code,
                current_experiment_name=current_experiment_name,
                sample=sample,
                task_code=normalized_task_code,
                tray=tray,
                tray_code=tray_code,
            ):
                continue
            if current_sample_code in experiment_sample_codes:
                eligible_sample_codes.add(current_sample_code)
                continue
            target_experiment_code = tray_target_experiment_code(tray)
            if target_experiment_code == normalized_experiment_code:
                eligible_sample_codes.add(current_sample_code)

    scoped_samples = [
        dict(sample)
        for sample in snapshot.get("samples", [])
        if sample_code(sample) in eligible_sample_codes
    ]
    return {**snapshot, "samples": scoped_samples}


def merge_scoped_samples(
    original_samples: list[dict[str, Any]],
    scoped_samples: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    scoped_by_identity = {sample_identity(sample): sample for sample in scoped_samples if sample_identity(sample)[1]}
    return [
        dict(scoped_by_identity.get(sample_identity(sample), sample))
        for sample in original_samples
    ]


def resolve_experiment_name(snapshot: dict[str, list[dict[str, Any]]], task_code: str, experiment_code: str) -> str:
    normalized_task_code = normalize_text(task_code)
    normalized_experiment_code = normalize_text(experiment_code)
    for experiment in snapshot.get("experiments", []):
        if (
            normalize_text(experiment.get("task_code") or experiment.get("task_no")) == normalized_task_code
            and normalize_text(experiment.get("experiment_code") or experiment.get("experiment_no")) == normalized_experiment_code
        ):
            return normalize_text(experiment.get("experiment_name") or experiment.get("experiment_type") or experiment_code)
    return normalized_experiment_code


def resolve_lab_name(snapshot: dict[str, list[dict[str, Any]]], task_code: str, experiment_code: str, fallback: str = "") -> str:
    normalized_task_code = normalize_text(task_code)
    normalized_experiment_code = normalize_text(experiment_code)
    for schedule in snapshot.get("schedules", []):
        if (
            normalize_text(schedule.get("task_code") or schedule.get("task_no")) == normalized_task_code
            and normalize_text(schedule.get("experiment_code") or schedule.get("experiment_no")) == normalized_experiment_code
        ):
            return normalize_text(schedule.get("device") or schedule.get("labName") or schedule.get("lab_name")) or normalize_text(fallback)
    return normalize_text(fallback)


def operation_resource_keys(*, lab_code: str = "", lab_name: str = "", tray_codes: list[str] | None = None) -> list[str]:
    keys = []
    for lab_key in (normalize_text(lab_code), normalize_text(lab_name)):
        if lab_key:
            keys.append(f"lab:{lab_key}")
    keys.extend(f"tray:{tray_code}" for tray_code in (tray_codes or []) if normalize_text(tray_code))
    return keys


def apply_laboratory_task_operation(
    snapshot: dict[str, list[dict[str, Any]]],
    *,
    operation_type: str,
    task_code: str,
    experiment_code: str,
    sub_experiment_code: str = "",
    lab_name: str = "",
    tray_codes: list[str] | None = None,
    occurred_at: str = "",
) -> dict[str, Any]:
    normalized_operation_type = normalize_text(operation_type)
    next_status = OPERATION_STATUS.get(normalized_operation_type)
    if not next_status:
        raise ValueError("unsupported laboratory operation")
    normalized_task_code = normalize_text(task_code)
    normalized_experiment_code = normalize_text(experiment_code)
    normalized_sub_experiment_code = normalize_text(sub_experiment_code)
    affected_tray_codes = [normalize_text(code) for code in (tray_codes or []) if normalize_text(code)]
    if not normalized_task_code or not normalized_experiment_code:
        raise ValueError("taskCode and experimentCode are required")
    if not affected_tray_codes:
        raise ValueError("trayCodes are required")

    occurred_time = format_business_datetime(occurred_at) or normalize_text(occurred_at) or now_business_text()
    scoped_snapshot = scope_snapshot_samples_for_experiment(
        snapshot,
        task_code=normalized_task_code,
        experiment_code=normalized_experiment_code,
        tray_codes=affected_tray_codes,
    )
    experiment_name = resolve_experiment_name(snapshot, normalized_task_code, normalized_experiment_code)
    target_lab_name = normalize_text(lab_name) or resolve_lab_name(snapshot, normalized_task_code, normalized_experiment_code)
    history_action = OPERATION_HISTORY_ACTION.get(normalized_operation_type, "")
    affected_tray_set = set(affected_tray_codes)
    next_samples: list[dict[str, Any]] = []
    affected_sample_count = 0
    touched_tray_codes: set[str] = set()

    for sample in scoped_snapshot.get("samples", []):
        next_sample = {
            **sample,
            "trays": [dict(tray) for tray in as_list(sample.get("trays")) if isinstance(tray, dict)],
            "history": [dict(entry) for entry in as_list(sample.get("history")) if isinstance(entry, dict)],
        }
        touched = False
        touched_sample_tray_codes: list[str] = []
        for tray in next_sample["trays"]:
            tray_code = normalize_text(tray.get("tray_code") or tray.get("trayCode") or tray.get("tray_no") or tray.get("trayNo"))
            if tray_code not in affected_tray_set:
                continue
            if normalized_operation_type in {"fixtureReady", "fixture_ready"}:
                if normalize_text(tray.get("status")) != INSTALL_STATUS:
                    continue
                tray["fixtureReady"] = True
                tray["fixture_ready"] = True
            else:
                tray["status"] = next_status
                tray["updated_at"] = occurred_time
                tray["target_experiment_code"] = normalized_experiment_code
                if normalized_sub_experiment_code:
                    tray["target_sub_experiment_code"] = normalized_sub_experiment_code
                else:
                    tray.pop("target_sub_experiment_code", None)
                    tray.pop("targetSubExperimentCode", None)
                if target_lab_name:
                    tray["target_lab"] = target_lab_name
                tray.pop("targetExperimentCode", None)
                tray.pop("targetLab", None)
                clear_fixture_ready_marker(tray)
            touched = True
            touched_sample_tray_codes.append(tray_code)
            touched_tray_codes.add(tray_code)
        if touched:
            next_sample["status"] = next_status
            next_sample["flow_status"] = next_status
            next_sample["location"] = target_lab_name or normalize_text(next_sample.get("location"))
            next_sample["updated_at"] = occurred_time
            if history_action:
                history_entries = [
                    {
                        "action": history_action,
                        "detail": (
                            f"{normalized_task_code} / {experiment_name or '-'} / {next_status}"
                            f" / 托盘：{tray_code}"
                        ),
                        "location": normalize_text(next_sample.get("location")),
                        "owner": normalize_text(next_sample.get("owner")),
                        "status": next_status,
                        "time": occurred_time,
                    }
                    for tray_code in touched_sample_tray_codes
                ]
                next_sample["history"] = history_entries + next_sample["history"]
            affected_sample_count += 1
        next_samples.append(next_sample)

    if not touched_tray_codes:
        raise ValueError("current experiment has no matching active tray samples")

    merged_samples = merge_scoped_samples(snapshot.get("samples", []), next_samples)
    return {
        "affectedSampleCount": affected_sample_count,
        "affectedTrayCodes": sorted(touched_tray_codes),
        "samples": merged_samples,
        "status": next_status,
    }


def run_atomic_laboratory_operation(
    *,
    operation: Callable[[dict[str, list[dict[str, Any]]]], dict[str, Any]],
    publish_storage_update: Callable[[list[str]], None] | None,
    resource_keys: list[str],
    storage: Any,
    updates_from_result: Callable[[dict[str, Any]], dict[str, Any]] | None = None,
    update_keys: tuple[str, ...] = LABORATORY_OPERATION_UPDATE_KEYS,
) -> dict[str, Any]:
    with acquire_laboratory_operation_locks(resource_keys):
        with acquire_laboratory_storage_commit_lock():
            snapshot = storage_snapshot(storage.read_all())
            result = operation(snapshot)
            updates = updates_from_result(result) if updates_from_result else {"mes.samples": result["samples"]}
            if updates_from_result is None:
                optional_update_keys = {
                    "experiments": "mes.experiments",
                    "schedules": "mes.schedules",
                    "tasks": "mes.tasks",
                }
                for result_key, storage_key in optional_update_keys.items():
                    if result_key in result:
                        updates[storage_key] = result[result_key]
            storage.write_many(updates)
            if publish_storage_update:
                publish_storage_update(list(dict.fromkeys([*update_keys, *updates.keys()])))
            return result
