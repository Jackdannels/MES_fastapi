from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterable


RUNNING_STATUSES = {"实验进行中", "实验中", "实验暂停"}
COMPLETED_STATUSES = {"实验已完成", "实验完成", "实验已经完成"}
STOPPED_STATUSES = {"实验已停止", "实验停止", "实验异常", "异常结束"}
LABORATORY_OCCUPANCY_SAMPLES_KEY = "laboratory_occupancy_samples"
LABORATORY_OCCUPANCY_RUNS_KEY = "laboratory_occupancy_experiment_runs"
LABORATORY_OCCUPANCY_RUN_TRAYS_KEY = "laboratory_occupancy_experiment_run_trays"
@dataclass(frozen=True)
class LaboratoryOccupancy:
    laboratory: str
    task_code: str
    experiment_code: str
    run_no: str
    tray_code: str
    run_status: str
    tray_status: str


def _text(value: Any) -> str:
    return str(value or "").strip()


def _record_text(record: Any, *keys: str) -> str:
    if not isinstance(record, dict):
        return ""
    for key in keys:
        value = _text(record.get(key))
        if value:
            return value
    return ""


def _aliases(record: Any, *keys: str) -> set[str]:
    if not isinstance(record, dict):
        return set()
    return {_text(record.get(key)) for key in keys if _text(record.get(key))}


def _run_no(record: Any) -> str:
    return _record_text(record, "run_no", "runNo", "id")


def _tray_code(record: Any) -> str:
    return _record_text(record, "tray_code", "trayCode", "tray_no", "trayNo")


def _run_has_started(run: dict[str, Any], relation: dict[str, Any]) -> bool:
    if _record_text(run, "started_at", "startedAt") or _record_text(relation, "started_at", "startedAt"):
        return True
    status = _record_text(run, "status", "run_status", "runStatus")
    relation_status = _record_text(relation, "run_tray_status", "runTrayStatus", "status")
    return _is_post_start_status(status) or _is_post_start_status(relation_status)


def _is_post_start_status(value: Any) -> bool:
    status = _text(value)
    return (
        status in RUNNING_STATUSES
        or status in COMPLETED_STATUSES
        or status in STOPPED_STATUSES
        or ("部分完成" in status and "轴" in status)
    )


def _current_tray_state(
    samples: Iterable[Any],
    *,
    tray_code: str,
    target_lab_aliases: set[str],
    experiment_code: str,
    schedule_id: str,
) -> tuple[str, bool]:
    for sample in samples:
        if not isinstance(sample, dict):
            continue
        sample_lab_aliases = _aliases(
            sample,
            "location",
            "lab_name",
            "labName",
            "lab_code",
            "labCode",
            "current_lab_name",
            "currentLabName",
            "current_lab_code",
            "currentLabCode",
        )
        for tray in sample.get("trays") or []:
            if not isinstance(tray, dict) or _tray_code(tray) != tray_code:
                continue
            current_experiment_code = _record_text(
                tray,
                "target_experiment_code",
                "targetExperimentCode",
                "experiment_code",
                "experimentCode",
                "experiment_no",
                "experimentNo",
            )
            if current_experiment_code and experiment_code and current_experiment_code != experiment_code:
                continue
            current_schedule_id = _record_text(
                tray,
                "target_schedule_id",
                "targetScheduleId",
                "schedule_id",
                "scheduleId",
                "schedule_no",
                "scheduleNo",
            )
            if current_schedule_id and schedule_id and current_schedule_id != schedule_id:
                continue
            tray_current_lab_aliases = _aliases(
                tray,
                "current_lab_name",
                "currentLabName",
                "current_lab_code",
                "currentLabCode",
            )
            tray_target_lab_aliases = _aliases(
                tray,
                "target_lab",
                "targetLab",
                "target_lab_code",
                "targetLabCode",
            )
            current_lab_aliases = sample_lab_aliases or tray_current_lab_aliases or tray_target_lab_aliases
            if not target_lab_aliases.intersection(current_lab_aliases):
                continue
            status = _record_text(tray, "status", "flow_status", "flowStatus") or _record_text(
                sample, "status", "flow_status", "flowStatus"
            )
            return status, True
    return "", False


def find_laboratory_occupancy(
    *,
    target_lab_name: str = "",
    target_lab_code: str = "",
    samples: Iterable[Any],
    experiment_runs: Iterable[Any],
    experiment_run_trays: Iterable[Any],
    excluded_tray_code: str = "",
) -> LaboratoryOccupancy | None:
    """Return a started run whose tray still occupies the target laboratory.

    A run locks the laboratory only after it has started. Completion does not
    release the lock: the associated tray must also leave the laboratory for
    its next workflow state. Pre-start arrival/fixture/ready states deliberately
    remain unlocked so that all trays for one experiment can be installed.
    """

    target_aliases = {_text(target_lab_name), _text(target_lab_code)} - {""}
    if not target_aliases:
        return None

    normalized_excluded_tray = _text(excluded_tray_code)
    runs_by_no = {
        _run_no(run): run
        for run in experiment_runs
        if isinstance(run, dict) and _run_no(run)
    }
    candidates: list[tuple[str, LaboratoryOccupancy]] = []
    for relation in experiment_run_trays:
        if not isinstance(relation, dict):
            continue
        tray_code = _tray_code(relation)
        if not tray_code or tray_code == normalized_excluded_tray:
            continue
        run_no = _run_no(relation)
        run = runs_by_no.get(run_no)
        if not isinstance(run, dict) or not _run_has_started(run, relation):
            continue
        run_lab_aliases = _aliases(
            run,
            "device",
            "device_name",
            "deviceName",
            "laboratory",
            "lab_name",
            "labName",
            "lab_code",
            "labCode",
        )
        if not target_aliases.intersection(run_lab_aliases):
            continue
        tray_status, occupies = _current_tray_state(
            samples,
            tray_code=tray_code,
            target_lab_aliases=target_aliases,
            experiment_code=_record_text(
                run, "experiment_code", "experimentCode", "experiment_no", "experimentNo"
            ),
            schedule_id=_record_text(run, "schedule_id", "scheduleId", "schedule_no", "scheduleNo"),
        )
        if not occupies:
            continue
        run_status = _record_text(run, "status", "run_status", "runStatus")
        occupancy = LaboratoryOccupancy(
            laboratory=_text(target_lab_name) or _text(target_lab_code),
            task_code=_record_text(run, "task_code", "taskCode", "task_no", "taskNo")
            or _record_text(relation, "task_code", "taskCode", "task_no", "taskNo"),
            experiment_code=_record_text(
                run, "experiment_code", "experimentCode", "experiment_no", "experimentNo"
            )
            or _record_text(
                relation, "experiment_code", "experimentCode", "experiment_no", "experimentNo"
            ),
            run_no=run_no,
            tray_code=tray_code,
            run_status=run_status,
            tray_status=tray_status,
        )
        sort_key = _record_text(run, "started_at", "startedAt", "updated_at", "updatedAt")
        candidates.append((sort_key, occupancy))

    if not candidates:
        return None
    candidates.sort(key=lambda item: (item[0], item[1].run_no, item[1].tray_code), reverse=True)
    return candidates[0][1]


def find_laboratory_occupancy_in_snapshot(
    snapshot: dict[str, Any],
    *,
    target_lab_name: str = "",
    target_lab_code: str = "",
    excluded_tray_code: str = "",
) -> LaboratoryOccupancy | None:
    """Apply the occupancy rule to either a route or storage snapshot.

    Dedicated occupancy keys take precedence so callers can attach global
    resource rows without replacing their task-scoped mutation rows.
    """

    return find_laboratory_occupancy(
        target_lab_name=target_lab_name,
        target_lab_code=target_lab_code,
        samples=snapshot.get(
            LABORATORY_OCCUPANCY_SAMPLES_KEY,
            snapshot.get("samples", snapshot.get("mes.samples", [])),
        ),
        experiment_runs=snapshot.get(
            LABORATORY_OCCUPANCY_RUNS_KEY,
            snapshot.get("experiment_runs", snapshot.get("mes.experiment_runs", [])),
        ),
        experiment_run_trays=snapshot.get(
            LABORATORY_OCCUPANCY_RUN_TRAYS_KEY,
            snapshot.get("experiment_run_trays", snapshot.get("mes.experiment_run_trays", [])),
        ),
        excluded_tray_code=excluded_tray_code,
    )


def laboratory_occupancy_conflict_detail(occupancy: LaboratoryOccupancy) -> str:
    laboratory = occupancy.laboratory or "目标实验室"
    return f"{laboratory}仍有已开始实验的托盘尚未推出，暂不能接收新托盘"


__all__ = [
    "LABORATORY_OCCUPANCY_RUNS_KEY",
    "LABORATORY_OCCUPANCY_RUN_TRAYS_KEY",
    "LABORATORY_OCCUPANCY_SAMPLES_KEY",
    "LaboratoryOccupancy",
    "find_laboratory_occupancy",
    "find_laboratory_occupancy_in_snapshot",
    "laboratory_occupancy_conflict_detail",
]
