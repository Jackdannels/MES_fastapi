"""Schedule immutability rules after comparison, fixture work, or lab start."""

from typing import Any

from fastapi import HTTPException

from app.services.storage_policies import (
    SCHEDULE_COMPARE_LOCKED_DETAIL,
    SCHEDULE_LOCKED_AFTER_COMPARE_STATUSES,
)
from app.services.storage_read_helpers import (
    _as_list,
    _experiment_code,
    _normalize_text,
    _record_axis_batch_no,
    _record_axis_codes,
    _record_schedule_id,
    _record_sub_code,
    _run_no,
    _schedule_id,
    _task_code,
    _tray_code,
)


SCHEDULE_LOCKED_FIELDS = {
    "axis_batch_no",
    "axis_codes",
    "device",
    "end_at",
    "experiment_code",
    "lab_code",
    "lab_id",
    "planned_hours",
    "start_at",
    "sub_experiment_code",
    "task_code",
}


def _experiment_tray_codes(experiment_trays: Any, task_code: str, experiment_code: str) -> set[str]:
    codes: set[str] = set()
    for entry in _as_list(experiment_trays):
        if not isinstance(entry, dict):
            continue
        if _task_code(entry) != task_code or _experiment_code(entry) != experiment_code:
            continue
        tray_code = _tray_code(entry)
        if tray_code:
            codes.add(tray_code)
    return codes


def _shared_experiment_tray_codes(experiment_trays: Any, task_code: str) -> set[str]:
    experiment_codes_by_tray: dict[str, set[str]] = {}
    for entry in _as_list(experiment_trays):
        if not isinstance(entry, dict) or _task_code(entry) != task_code:
            continue
        tray_code = _tray_code(entry)
        experiment_code = _experiment_code(entry)
        if not tray_code or not experiment_code:
            continue
        experiment_codes_by_tray.setdefault(tray_code, set()).add(experiment_code)
    return {
        tray_code
        for tray_code, experiment_codes in experiment_codes_by_tray.items()
        if len(experiment_codes) > 1
    }


def _sample_has_fixture_locked_tray(
    sample: Any,
    tray_codes: set[str],
    schedule: Any,
    shared_tray_codes: set[str],
) -> bool:
    if not isinstance(sample, dict):
        return False
    sample_statuses = {
        _normalize_text(sample.get("status")),
        _normalize_text(sample.get("flow_status")),
    }
    for tray in _as_list(sample.get("trays")):
        if not isinstance(tray, dict):
            continue
        tray_code = _tray_code(tray)
        if tray_code not in tray_codes:
            continue
        tray_statuses = {_normalize_text(tray.get("status")), _normalize_text(tray.get("flow_status"))}
        if not (sample_statuses | tray_statuses) & SCHEDULE_LOCKED_AFTER_COMPARE_STATUSES:
            continue
        schedule_experiment_code = _experiment_code(schedule)
        tray_target_experiment_code = _normalize_text(
            tray.get("target_experiment_code") or tray.get("targetExperimentCode")
        )
        if tray_target_experiment_code and tray_target_experiment_code != schedule_experiment_code:
            continue
        schedule_sub_code = _record_sub_code(schedule, experiment_code=schedule_experiment_code)
        if not schedule_sub_code:
            if not tray_target_experiment_code and tray_code in shared_tray_codes:
                continue
            return True
        tray_target_sub_code = _normalize_text(
            tray.get("target_sub_experiment_code") or tray.get("targetSubExperimentCode")
        )
        if tray_target_sub_code == schedule_sub_code:
            return True
    return False


def _record_has_schedule_locked_status(record: Any) -> bool:
    if not isinstance(record, dict):
        return False
    statuses = {
        _normalize_text(record.get("status")),
        _normalize_text(record.get("schedule_status")),
        _normalize_text(record.get("run_tray_status")),
        _normalize_text(record.get("experiment_status")),
    }
    return bool(statuses & SCHEDULE_LOCKED_AFTER_COMPARE_STATUSES)


def _record_matches_schedule_scope(record: Any, schedule: Any, *, allow_legacy_experiment_fallback: bool = False) -> bool:
    if not isinstance(record, dict) or not isinstance(schedule, dict):
        return False
    task_code = _task_code(schedule)
    experiment_code = _experiment_code(schedule)
    if _task_code(record) != task_code or _experiment_code(record) != experiment_code:
        return False

    schedule_id = _schedule_id(schedule)
    record_schedule_id = _record_schedule_id(record)
    if schedule_id and record_schedule_id:
        return schedule_id == record_schedule_id

    schedule_sub_code = _record_sub_code(schedule, experiment_code=experiment_code)
    record_sub_code = _record_sub_code(record, experiment_code=experiment_code)
    if schedule_sub_code and record_sub_code:
        return schedule_sub_code == record_sub_code

    schedule_axis_batch_no = _record_axis_batch_no(schedule)
    record_axis_batch_no = _record_axis_batch_no(record)
    if schedule_axis_batch_no and record_axis_batch_no:
        return schedule_axis_batch_no == record_axis_batch_no

    schedule_axis_codes = set(_record_axis_codes(schedule))
    record_axis_codes = set(_record_axis_codes(record))
    if schedule_axis_codes and record_axis_codes:
        return bool(schedule_axis_codes & record_axis_codes)

    schedule_scoped = bool(schedule_sub_code or schedule_axis_batch_no or schedule_axis_codes)
    record_scoped = bool(record_schedule_id or record_sub_code or record_axis_batch_no or record_axis_codes)
    if schedule_scoped or record_scoped:
        return False
    return allow_legacy_experiment_fallback


def _schedule_has_started_record(schedule: Any, experiment_runs: Any, experiment_run_trays: Any) -> bool:
    if not isinstance(schedule, dict):
        return False
    matching_run_nos: set[str] = set()
    for run in _as_list(experiment_runs):
        if (
            isinstance(run, dict)
            and _record_has_schedule_locked_status(run)
            and _record_matches_schedule_scope(run, schedule, allow_legacy_experiment_fallback=True)
        ):
            run_no = _run_no(run)
            if run_no:
                matching_run_nos.add(run_no)
            return True
    for relation in _as_list(experiment_run_trays):
        if not isinstance(relation, dict) or not _record_has_schedule_locked_status(relation):
            continue
        run_no = _run_no(relation)
        if (run_no and run_no in matching_run_nos) or _record_matches_schedule_scope(relation, schedule):
            return True
    return False


def _schedule_has_started_step(schedule: Any, experiment_run_steps: Any) -> bool:
    return any(
        isinstance(step, dict)
        and _record_has_schedule_locked_status(step)
        and _record_matches_schedule_scope(step, schedule)
        for step in _as_list(experiment_run_steps)
    )


def _schedule_is_fixture_locked(
    schedule: Any,
    samples: Any,
    experiment_trays: Any,
    experiment_runs: Any = None,
    experiment_run_trays: Any = None,
    experiment_run_steps: Any = None,
) -> bool:
    if not isinstance(schedule, dict):
        return False
    task_code = _task_code(schedule)
    experiment_code = _experiment_code(schedule)
    if not task_code or not experiment_code:
        return False
    if _schedule_has_started_record(schedule, experiment_runs, experiment_run_trays):
        return True
    if _schedule_has_started_step(schedule, experiment_run_steps):
        return True
    tray_codes = _experiment_tray_codes(experiment_trays, task_code, experiment_code)
    if not tray_codes:
        return False
    shared_tray_codes = _shared_experiment_tray_codes(experiment_trays, task_code)
    return any(
        _task_code(sample) == task_code
        and _sample_has_fixture_locked_tray(sample, tray_codes, schedule, shared_tray_codes)
        for sample in _as_list(samples)
    )


def schedule_is_locked_for_automatic_reschedule(snapshot: Any, schedule: Any) -> bool:
    """Return whether a schedule has crossed the existing comparison/start lock boundary.

    Automatic delay propagation uses the same lock evidence as manual schedule edits so
    it cannot silently move a schedule whose trays or run have already entered the lab.
    """

    if not isinstance(snapshot, dict) or not isinstance(schedule, dict):
        return False
    if _record_has_schedule_locked_status(schedule):
        return True
    return _schedule_is_fixture_locked(
        schedule,
        snapshot.get("samples") or snapshot.get("mes.samples"),
        snapshot.get("experiment_trays") or snapshot.get("mes.experiment_trays"),
        snapshot.get("experiment_runs") or snapshot.get("mes.experiment_runs"),
        snapshot.get("experiment_run_trays") or snapshot.get("mes.experiment_run_trays"),
        snapshot.get("experiment_run_steps") or snapshot.get("mes.experiment_run_steps"),
    )


def _locked_schedule_fields_changed(current_schedule: Any, next_schedule: Any) -> bool:
    if not isinstance(current_schedule, dict) or not isinstance(next_schedule, dict):
        return True
    return any(
        _normalize_text(current_schedule.get(field)) != _normalize_text(next_schedule.get(field))
        for field in SCHEDULE_LOCKED_FIELDS
    )


def validate_fixture_locked_schedules(
    current_schedules: Any,
    next_schedules: Any,
    samples: Any,
    experiment_runs: Any,
    experiment_run_trays: Any,
    experiment_trays: Any,
    experiment_run_steps: Any,
    *,
    allow_terminal_schedule_cleanup: bool = False,
) -> None:
    if not isinstance(next_schedules, list):
        return
    next_by_id = {
        _schedule_id(schedule): schedule
        for schedule in _as_list(next_schedules)
        if isinstance(schedule, dict) and _schedule_id(schedule)
    }
    for current_schedule in _as_list(current_schedules):
        if not isinstance(current_schedule, dict) or not _schedule_is_fixture_locked(
            current_schedule,
            samples,
            experiment_trays,
            experiment_runs,
            experiment_run_trays,
            experiment_run_steps,
        ):
            continue
        schedule_id = _schedule_id(current_schedule)
        next_schedule = next_by_id.get(schedule_id)
        if schedule_id and next_schedule is None and allow_terminal_schedule_cleanup:
            continue
        if not schedule_id or next_schedule is None or _locked_schedule_fields_changed(current_schedule, next_schedule):
            raise HTTPException(status_code=400, detail=SCHEDULE_COMPARE_LOCKED_DETAIL)
