from __future__ import annotations

from typing import Any

from app.core.axis_codes import canonical_axis_code
from app.core.time_utils import format_business_datetime, now_business_text
from app.services.experiment_segments import record_sub_experiment_code, resolve_record_sub_experiment_code
from app.services.laboratory_operations import clear_fixture_ready_marker
from app.services.laboratory_run_lifecycle import close_superseded_running_runs_for_trays
from app.services.laboratory_completion_rules import (
    COMPLETED_STATUS,
    COMPLETION_ACTION,
    EXPERIMENT_TRAY_FINISHED_STATUSES,
    PARTIAL_AXIS_CONTINUATION_STATUS,
    RUNNING_STATUS,
    axis_partial_completion_status,
    completion_history_detail,
    experiment_status_for_completed_trays,
    experiment_trays_are_completed,
    normalize_axis_codes,
    normalize_text,
    required_axis_codes_for_completion,
    run_axis_codes,
    run_tray_completed_statuses_for_experiment,
)


def completed_axis_codes_for_completion(
    *,
    affected_tray_codes: set[str],
    current_run_no: str,
    experiment_code: str,
    experiment_runs: list[dict[str, Any]],
    experiment_run_steps: list[dict[str, Any]],
    experiment_run_trays: list[dict[str, Any]],
    include_all_sub_experiments: bool = False,
    sub_experiment_code: str = "",
    task_code: str,
) -> set[str]:
    normalized_task_code = normalize_text(task_code)
    normalized_experiment_code = normalize_text(experiment_code)
    normalized_current_run_no = normalize_text(current_run_no)
    normalized_sub_experiment_code = normalize_text(sub_experiment_code)
    run_by_no = {
        normalize_text(run.get("run_no") or run.get("runNo") or run.get("id")): run
        for run in experiment_runs
        if normalize_text(run.get("task_code") or run.get("task_no")) == normalized_task_code
        and normalize_text(run.get("experiment_code") or run.get("experiment_no")) == normalized_experiment_code
        and (
            include_all_sub_experiments
            or not normalized_sub_experiment_code
            or record_sub_experiment_code(run) == normalized_sub_experiment_code
        )
        and normalize_text(run.get("run_no") or run.get("runNo") or run.get("id"))
    }
    tray_codes_by_run_no: dict[str, set[str]] = {}
    for relation in experiment_run_trays:
        if (
            normalize_text(relation.get("task_code") or relation.get("task_no")) != normalized_task_code
            or normalize_text(relation.get("experiment_code") or relation.get("experiment_no")) != normalized_experiment_code
            or (
                not include_all_sub_experiments
                and normalized_sub_experiment_code
                and record_sub_experiment_code(relation) != normalized_sub_experiment_code
            )
        ):
            continue
        relation_run_no = normalize_text(relation.get("run_no") or relation.get("runNo"))
        relation_tray_code = normalize_text(relation.get("tray_code") or relation.get("tray_no"))
        if relation_run_no and relation_tray_code:
            tray_codes_by_run_no.setdefault(relation_run_no, set()).add(relation_tray_code)
    for run_no, run in run_by_no.items():
        for tray_code in normalize_axis_codes(run.get("tray_codes") or run.get("trayCodes")):
            tray_codes_by_run_no.setdefault(run_no, set()).add(tray_code)

    def step_matches_affected_tray_scope(step: dict[str, Any]) -> bool:
        if not affected_tray_codes:
            return True
        step_run_no = normalize_text(step.get("run_no") or step.get("runNo"))
        if normalized_current_run_no and step_run_no == normalized_current_run_no:
            return True
        return bool(tray_codes_by_run_no.get(step_run_no, set()) & affected_tray_codes)

    completed_axes = {
        canonical_axis_code(step.get("axis_code") or step.get("axisCode"))
        for step in experiment_run_steps
        if normalize_text(step.get("task_code") or step.get("task_no")) == normalized_task_code
        and normalize_text(step.get("experiment_code") or step.get("experiment_no")) == normalized_experiment_code
        and (
            include_all_sub_experiments
            or not normalized_sub_experiment_code
            or record_sub_experiment_code(step) == normalized_sub_experiment_code
        )
        and normalize_text(step.get("status")) in EXPERIMENT_TRAY_FINISHED_STATUSES
        and step_matches_affected_tray_scope(step)
        and canonical_axis_code(step.get("axis_code") or step.get("axisCode"))
    }
    for relation in experiment_run_trays:
        if (
            normalize_text(relation.get("task_code") or relation.get("task_no")) != normalized_task_code
            or normalize_text(relation.get("experiment_code") or relation.get("experiment_no")) != normalized_experiment_code
            or (
                not include_all_sub_experiments
                and normalized_sub_experiment_code
                and record_sub_experiment_code(relation) != normalized_sub_experiment_code
            )
        ):
            continue
        tray_code = normalize_text(relation.get("tray_code") or relation.get("tray_no"))
        if affected_tray_codes and tray_code not in affected_tray_codes:
            continue
        run_no = normalize_text(relation.get("run_no") or relation.get("runNo"))
        relation_completed = normalize_text(relation.get("status") or relation.get("run_tray_status")) in EXPERIMENT_TRAY_FINISHED_STATUSES
        if relation_completed or (normalized_current_run_no and run_no == normalized_current_run_no):
            completed_axes.update(run_axis_codes(run_by_no.get(run_no)))
    return {axis_code for axis_code in completed_axes if axis_code}


def full_axis_codes_for_experiment(
    experiments: list[dict[str, Any]],
    schedules: list[dict[str, Any]],
    *,
    experiment_code: str,
    task_code: str,
) -> list[str]:
    return required_axis_codes_for_completion(
        experiments,
        schedules,
        experiment_code=experiment_code,
        sub_experiment_code="",
        task_code=task_code,
    )


def axis_completion_status_for_trays(
    *,
    affected_tray_codes: set[str],
    current_run_no: str,
    experiment_code: str,
    experiment_name: str,
    experiment_runs: list[dict[str, Any]],
    experiment_run_steps: list[dict[str, Any]],
    experiment_run_trays: list[dict[str, Any]],
    experiments: list[dict[str, Any]],
    schedules: list[dict[str, Any]],
    task_code: str,
) -> str:
    required_axes = full_axis_codes_for_experiment(
        experiments,
        schedules,
        experiment_code=experiment_code,
        task_code=task_code,
    )
    if not required_axes:
        return ""
    completed_axes = completed_axis_codes_for_completion(
        affected_tray_codes=affected_tray_codes,
        current_run_no=current_run_no,
        experiment_code=experiment_code,
        experiment_runs=experiment_runs,
        experiment_run_steps=experiment_run_steps,
        experiment_run_trays=experiment_run_trays,
        include_all_sub_experiments=True,
        sub_experiment_code="",
        task_code=task_code,
    )
    if not completed_axes:
        return ""
    if set(required_axes).issubset(completed_axes):
        return COMPLETED_STATUS
    return axis_partial_completion_status(experiment_name, len(completed_axes), len(required_axes))


def axis_completion_is_incomplete(
    *,
    affected_tray_codes: set[str],
    current_run_no: str,
    experiment_code: str,
    experiment_runs: list[dict[str, Any]],
    experiment_run_steps: list[dict[str, Any]],
    experiment_run_trays: list[dict[str, Any]],
    experiments: list[dict[str, Any]],
    schedules: list[dict[str, Any]],
    sub_experiment_code: str = "",
    task_code: str,
) -> bool:
    required_axes = required_axis_codes_for_completion(
        experiments,
        schedules,
        experiment_code=experiment_code,
        sub_experiment_code=sub_experiment_code,
        task_code=task_code,
    )
    if not required_axes:
        return False
    completed_axes = completed_axis_codes_for_completion(
        affected_tray_codes=affected_tray_codes,
        current_run_no=current_run_no,
        experiment_code=experiment_code,
        experiment_runs=experiment_runs,
        experiment_run_steps=experiment_run_steps,
        experiment_run_trays=experiment_run_trays,
        sub_experiment_code=sub_experiment_code,
        task_code=task_code,
    )
    if not completed_axes:
        return False
    if not set(required_axes).issubset(completed_axes):
        return True
    full_required_axes = full_axis_codes_for_experiment(
        experiments,
        schedules,
        experiment_code=experiment_code,
        task_code=task_code,
    )
    if full_required_axes:
        full_completed_axes = completed_axis_codes_for_completion(
            affected_tray_codes=affected_tray_codes,
            current_run_no=current_run_no,
            experiment_code=experiment_code,
            experiment_runs=experiment_runs,
            experiment_run_steps=experiment_run_steps,
            experiment_run_trays=experiment_run_trays,
            include_all_sub_experiments=True,
            sub_experiment_code="",
            task_code=task_code,
        )
        if not set(full_required_axes).issubset(full_completed_axes):
            return True
    return False


def tray_assigned_experiments_are_completed(
    *,
    task_code: str,
    tray_code: str,
    experiment_trays: list[dict[str, Any]] | None = None,
    experiment_run_trays: list[dict[str, Any]] | None = None,
) -> bool:
    normalized_task_code = normalize_text(task_code)
    normalized_tray_code = normalize_text(tray_code)
    if not normalized_task_code or not normalized_tray_code:
        return False

    assigned_experiment_codes = {
        normalize_text(item.get("experiment_code") or item.get("experiment_no"))
        for item in experiment_trays or []
        if normalize_text(item.get("task_code") or item.get("task_no")) == normalized_task_code
        and normalize_text(item.get("tray_code") or item.get("tray_no")) == normalized_tray_code
        and normalize_text(item.get("experiment_code") or item.get("experiment_no"))
    }
    if not assigned_experiment_codes:
        return False

    completed_experiment_codes = {
        normalize_text(item.get("experiment_code") or item.get("experiment_no"))
        for item in experiment_run_trays or []
        if normalize_text(item.get("task_code") or item.get("task_no")) == normalized_task_code
        and normalize_text(item.get("tray_code") or item.get("tray_no")) == normalized_tray_code
        and normalize_text(item.get("status") or item.get("run_tray_status")) in EXPERIMENT_TRAY_FINISHED_STATUSES
        and normalize_text(item.get("experiment_code") or item.get("experiment_no"))
    }
    return assigned_experiment_codes.issubset(completed_experiment_codes)


def complete_storage_laboratory_experiment(
    snapshot: dict[str, list[dict[str, Any]]],
    *,
    task_code: str,
    experiment_code: str,
    sub_experiment_code: str = "",
    run_no: str = "",
    tray_codes: list[str] | None = None,
    completed_at: str = "",
) -> dict[str, Any]:
    normalized_task_code = normalize_text(task_code)
    normalized_experiment_code = normalize_text(experiment_code)
    normalized_sub_experiment_code = normalize_text(sub_experiment_code)
    normalized_run_no = normalize_text(run_no)
    completed_time = format_business_datetime(completed_at) or normalize_text(completed_at) or now_business_text()
    if not normalized_task_code or not normalized_experiment_code:
        raise ValueError("task_code and experiment_code are required")

    experiments = [dict(item) for item in snapshot.get("experiments", [])]
    schedules = [dict(item) for item in snapshot.get("schedules", [])]
    experiment_runs = [dict(item) for item in snapshot.get("experiment_runs", [])]
    experiment_run_trays = [dict(item) for item in snapshot.get("experiment_run_trays", [])]
    experiment_trays = [dict(item) for item in snapshot.get("experiment_trays", [])]
    experiment_samples = [dict(item) for item in snapshot.get("experiment_samples", [])]
    samples = [
        {
            **sample,
            "trays": [dict(tray) for tray in sample.get("trays", []) if isinstance(tray, dict)],
            "history": [dict(entry) for entry in sample.get("history", []) if isinstance(entry, dict)],
        }
        for sample in snapshot.get("samples", [])
    ]

    experiment = next(
        (
            item
            for item in experiments
            if normalize_text(item.get("task_code")) == normalized_task_code
            and normalize_text(item.get("experiment_code")) == normalized_experiment_code
        ),
        None,
    )
    experiment_name = normalize_text((experiment or {}).get("experiment_name") or (experiment or {}).get("experiment_type")) or normalized_experiment_code
    scoped_tray_codes = {
        normalize_text(item.get("tray_code"))
        for item in experiment_trays
        if normalize_text(item.get("task_code")) == normalized_task_code
        and normalize_text(item.get("experiment_code")) == normalized_experiment_code
        and normalize_text(item.get("tray_code"))
    }
    requested_tray_codes = {normalize_text(code) for code in (tray_codes or []) if normalize_text(code)}
    if not normalized_sub_experiment_code and normalized_run_no:
        for run in experiment_runs:
            if (
                normalize_text(run.get("run_no") or run.get("runNo") or run.get("id")) == normalized_run_no
                and normalize_text(run.get("task_code") or run.get("task_no")) == normalized_task_code
                and normalize_text(run.get("experiment_code") or run.get("experiment_no")) == normalized_experiment_code
            ):
                normalized_sub_experiment_code = resolve_record_sub_experiment_code(
                    run,
                    experiment_code=normalized_experiment_code,
                )
                break

    def run_matches_request(run: dict[str, Any]) -> bool:
        run_key = normalize_text(run.get("run_no") or run.get("runNo") or run.get("id"))
        return (
            run_key == normalized_run_no
            and normalize_text(run.get("task_code")) == normalized_task_code
            and normalize_text(run.get("experiment_code")) == normalized_experiment_code
            and (not normalized_sub_experiment_code or record_sub_experiment_code(run) == normalized_sub_experiment_code)
        )

    def infer_tray_codes_from_run() -> set[str]:
        if not normalized_run_no:
            return set()
        inferred_from_relations = {
            normalize_text(item.get("tray_code") or item.get("tray_no"))
            for item in experiment_run_trays
            if normalize_text(item.get("run_no") or item.get("runNo")) == normalized_run_no
            and normalize_text(item.get("task_code")) == normalized_task_code
            and normalize_text(item.get("experiment_code")) == normalized_experiment_code
            and (not normalized_sub_experiment_code or record_sub_experiment_code(item) == normalized_sub_experiment_code)
            and normalize_text(item.get("tray_code") or item.get("tray_no"))
        }
        matched_run = next((run for run in experiment_runs if run_matches_request(run)), None)
        if matched_run and not inferred_from_relations:
            raise ValueError("experiment_run_trays are required when completing by run_no")
        return inferred_from_relations

    def structured_tray_codes_for_run() -> set[str]:
        if not normalized_run_no:
            return set()
        return {
            normalize_text(item.get("tray_code") or item.get("tray_no"))
            for item in experiment_run_trays
            if normalize_text(item.get("run_no") or item.get("runNo")) == normalized_run_no
            and normalize_text(item.get("task_code")) == normalized_task_code
            and normalize_text(item.get("experiment_code")) == normalized_experiment_code
            and (not normalized_sub_experiment_code or record_sub_experiment_code(item) == normalized_sub_experiment_code)
            and normalize_text(item.get("tray_code") or item.get("tray_no"))
        }

    if requested_tray_codes:
        affected_tray_codes = requested_tray_codes
    else:
        inferred_run_tray_codes = infer_tray_codes_from_run()
        if inferred_run_tray_codes:
            affected_tray_codes = inferred_run_tray_codes
        else:
            raise ValueError("trayCodes are required for experiment completion")
    run_bound_tray_codes = structured_tray_codes_for_run()
    if run_bound_tray_codes:
        affected_tray_codes = {tray_code for tray_code in affected_tray_codes if tray_code in run_bound_tray_codes}
    if scoped_tray_codes:
        affected_tray_codes = {tray_code for tray_code in affected_tray_codes if tray_code in scoped_tray_codes}
    if not affected_tray_codes:
        raise ValueError("current experiment has no matching tray samples")

    completed_experiment_tray_codes = run_tray_completed_statuses_for_experiment(
        experiment_runs,
        completed_tray_codes=affected_tray_codes,
        experiment_code=normalized_experiment_code,
        experiment_run_trays=experiment_run_trays,
        sub_experiment_code=normalized_sub_experiment_code,
        task_code=normalized_task_code,
    )
    axis_run_requires_sub_experiment = False
    if normalized_run_no:
        matched_axis_run = next((run for run in experiment_runs if run_matches_request(run)), None)
        axis_run_requires_sub_experiment = bool(normalize_axis_codes((matched_axis_run or {}).get("axis_codes") or (matched_axis_run or {}).get("axisCodes")))
        matched_schedule_id = normalize_text((matched_axis_run or {}).get("schedule_id") or (matched_axis_run or {}).get("scheduleId"))
        if not axis_run_requires_sub_experiment and matched_schedule_id:
            axis_run_requires_sub_experiment = any(
                normalize_text(item.get("id") or item.get("schedule_id") or item.get("scheduleId")) == matched_schedule_id
                and bool(normalize_axis_codes(item.get("axis_codes") or item.get("axisCodes")))
                for item in schedules
            )
    if axis_run_requires_sub_experiment and not normalized_sub_experiment_code:
        raise ValueError("sub_experiment_code is required for axis experiment completion")
    axis_completion_incomplete = axis_completion_is_incomplete(
        affected_tray_codes=affected_tray_codes,
        current_run_no=normalized_run_no,
        experiment_code=normalized_experiment_code,
        experiment_runs=experiment_runs,
        experiment_run_steps=snapshot.get("experiment_run_steps", []),
        experiment_run_trays=experiment_run_trays,
        experiments=experiments,
        schedules=schedules,
        sub_experiment_code=normalized_sub_experiment_code,
        task_code=normalized_task_code,
    )
    axis_tray_completion_status = ""
    if axis_run_requires_sub_experiment:
        axis_tray_completion_status = axis_completion_status_for_trays(
            affected_tray_codes=affected_tray_codes,
            current_run_no=normalized_run_no,
            experiment_code=normalized_experiment_code,
            experiment_name=experiment_name,
            experiment_runs=experiment_runs,
            experiment_run_steps=snapshot.get("experiment_run_steps", []),
            experiment_run_trays=experiment_run_trays,
            experiments=experiments,
            schedules=schedules,
            task_code=normalized_task_code,
        )
    next_experiment_status = RUNNING_STATUS if axis_completion_incomplete else experiment_status_for_completed_trays(
        scoped_tray_codes,
        completed_experiment_tray_codes,
    )
    completed_scope_trays_satisfy_schedule = (
        experiment_trays_are_completed(scoped_tray_codes, completed_experiment_tray_codes)
        if scoped_tray_codes
        else True
    )
    completed_run_schedule_id = ""
    if normalized_run_no:
        matched_run = next((run for run in experiment_runs if run_matches_request(run)), None)
        completed_run_schedule_id = normalize_text((matched_run or {}).get("schedule_id") or (matched_run or {}).get("scheduleId"))
        if not normalized_sub_experiment_code and matched_run:
            normalized_sub_experiment_code = resolve_record_sub_experiment_code(
                matched_run,
                experiment_code=normalized_experiment_code,
            )

    def schedule_matches_completed_scope(item: dict[str, Any]) -> bool:
        if normalize_text(item.get("task_code")) != normalized_task_code:
            return False
        if normalize_text(item.get("experiment_code")) != normalized_experiment_code:
            return False
        schedule_key = normalize_text(item.get("id") or item.get("schedule_id") or item.get("scheduleId"))
        if completed_run_schedule_id and axis_completion_incomplete:
            return schedule_key == completed_run_schedule_id
        if normalized_sub_experiment_code:
            return record_sub_experiment_code(item) == normalized_sub_experiment_code
        return True

    related_schedules = [
        item
        for item in schedules
        if normalize_text(item.get("task_code")) == normalized_task_code
        and normalize_text(item.get("experiment_code")) == normalized_experiment_code
    ]
    if normalized_sub_experiment_code and next_experiment_status == COMPLETED_STATUS and related_schedules:
        has_unfinished_other_schedule = any(
            not schedule_matches_completed_scope(item)
            and normalize_text(item.get("status") or item.get("schedule_status")) not in EXPERIMENT_TRAY_FINISHED_STATUSES
            for item in related_schedules
        )
        if has_unfinished_other_schedule:
            next_experiment_status = RUNNING_STATUS

    is_partial_axis_continuation = (
        axis_run_requires_sub_experiment
        and bool(normalized_sub_experiment_code)
        and next_experiment_status != COMPLETED_STATUS
    )
    sample_completion_status = (
        axis_tray_completion_status
        or (PARTIAL_AXIS_CONTINUATION_STATUS if is_partial_axis_continuation else COMPLETED_STATUS)
    )

    scoped_sample_codes = {
        normalize_text(item.get("sample_code") or item.get("sample_no") or item.get("sample_id"))
        for item in experiment_samples
        if normalize_text(item.get("task_code") or item.get("task_no")) == normalized_task_code
        and normalize_text(item.get("experiment_code") or item.get("experiment_no")) == normalized_experiment_code
        and normalize_text(item.get("sample_code") or item.get("sample_no") or item.get("sample_id"))
    }

    def sample_matches_current_experiment(sample: dict[str, Any]) -> bool:
        if normalize_text(sample.get("task_code") or sample.get("task_no")) != normalized_task_code:
            return False
        sample_code = normalize_text(sample.get("code") or sample.get("sample_code") or sample.get("sample_no") or sample.get("id"))
        if sample_code in scoped_sample_codes:
            return True
        for tray in sample.get("trays", []):
            tray_code = normalize_text(tray.get("tray_code") or tray.get("trayCode") or tray.get("tray_no"))
            if tray_code not in affected_tray_codes:
                continue
            target_experiment_code = normalize_text(
                tray.get("target_experiment_code")
                or tray.get("targetExperimentCode")
                or tray.get("experiment_code")
                or tray.get("experimentCode")
                or tray.get("experiment_no")
                or tray.get("experimentNo")
            )
            if target_experiment_code == normalized_experiment_code:
                return True
        return False

    detail = f"{normalized_task_code} / {experiment_name} / {sample_completion_status}"
    affected_sample_count = 0
    for sample in samples:
        if not sample_matches_current_experiment(sample):
            continue
        previous_location = normalize_text(sample.get("location"))
        touched = False
        touched_tray_codes: list[str] = []
        next_trays = []
        for tray in sample.get("trays", []):
            tray_code = normalize_text(tray.get("tray_code"))
            if tray_code in affected_tray_codes:
                next_tray = {
                    **tray,
                    "status": sample_completion_status,
                    "updated_at": completed_time,
                }
                for target_key in ("target_lab", "targetLab", "target_experiment_code", "targetExperimentCode"):
                    next_tray.pop(target_key, None)
                next_tray.pop("target_sub_experiment_code", None)
                next_tray.pop("targetSubExperimentCode", None)
                clear_fixture_ready_marker(next_tray)
                touched = True
                touched_tray_codes.append(tray_code)
            else:
                next_tray = tray
            next_trays.append(next_tray)
        if not touched:
            continue
        if next_trays and all(
            normalize_text(tray.get("status")) in EXPERIMENT_TRAY_FINISHED_STATUSES
            or normalize_text(tray.get("status")) == sample_completion_status
            for tray in next_trays
        ):
            sample["status"] = sample_completion_status
            sample["flow_status"] = sample_completion_status
        sample["updated_at"] = completed_time
        sample["trays"] = next_trays
        if sample_completion_status != PARTIAL_AXIS_CONTINUATION_STATUS:
            history_entry = {
                "action": COMPLETION_ACTION,
                "detail": detail,
                "location": previous_location,
                "owner": normalize_text(sample.get("owner")),
                "status": sample_completion_status,
                "time": completed_time,
            }
            history_tray_codes = sorted({code for code in touched_tray_codes if code})
            if len(history_tray_codes) == 1:
                history_entry["tray_code"] = history_tray_codes[0]
            elif history_tray_codes:
                history_entry["tray_codes"] = history_tray_codes
            duplicate = any(
                normalize_text(entry.get("detail")) == detail
                and normalize_text(entry.get("time")) == completed_time
                for entry in sample.get("history", [])
            )
            if not duplicate:
                sample["history"] = [history_entry, *sample.get("history", [])]
        affected_sample_count += 1

    if affected_sample_count == 0:
        raise ValueError("current experiment has no matching tray samples")

    experiments = [
        {
            **item,
            "status": next_experiment_status,
            "updated_at": completed_time,
        }
        if normalize_text(item.get("task_code")) == normalized_task_code
        and normalize_text(item.get("experiment_code")) == normalized_experiment_code
        else item
        for item in experiments
    ]
    def next_schedule_record(item: dict[str, Any]) -> dict[str, Any]:
        if not schedule_matches_completed_scope(item):
            return item
        if completed_scope_trays_satisfy_schedule:
            return {
                **item,
                "status": COMPLETED_STATUS,
                "updated_at": completed_time,
            }
        schedule_key = normalize_text(item.get("id") or item.get("schedule_id") or item.get("scheduleId"))
        if completed_run_schedule_id and schedule_key != completed_run_schedule_id:
            return item
        return {
            **item,
            "status": RUNNING_STATUS,
            "updated_at": completed_time,
        }

    schedules = [next_schedule_record(item) for item in schedules]
    def run_matches_completion(item: dict[str, Any]) -> bool:
        if normalized_run_no:
            return run_matches_request(item)
        if (
            normalize_text(item.get("task_code")) != normalized_task_code
            or normalize_text(item.get("experiment_code")) != normalized_experiment_code
            or (normalized_sub_experiment_code and record_sub_experiment_code(item) != normalized_sub_experiment_code)
            or normalize_text(item.get("status")) != RUNNING_STATUS
        ):
            return False
        run_key = normalize_text(item.get("run_no") or item.get("runNo") or item.get("id"))
        run_tray_codes = {
            normalize_text(relation.get("tray_code") or relation.get("tray_no"))
            for relation in experiment_run_trays
            if normalize_text(relation.get("run_no") or relation.get("runNo")) == run_key
            and normalize_text(relation.get("task_code") or relation.get("task_no")) == normalized_task_code
            and normalize_text(relation.get("experiment_code") or relation.get("experiment_no")) == normalized_experiment_code
            and (not normalized_sub_experiment_code or record_sub_experiment_code(relation) == normalized_sub_experiment_code)
            and normalize_text(relation.get("tray_code") or relation.get("tray_no"))
        }
        return bool(run_tray_codes) and affected_tray_codes.issubset(run_tray_codes)

    experiment_runs = [
        {
            **item,
            "sub_experiment_code": normalized_sub_experiment_code or record_sub_experiment_code(item),
            "status": COMPLETED_STATUS,
            "ended_at": completed_time,
            "updated_at": completed_time,
        }
        if run_matches_completion(item)
        else item
        for item in experiment_runs
    ]

    existing_relation_keys = {
        (
            normalize_text(item.get("run_no") or item.get("runNo")),
            normalize_text(item.get("tray_code") or item.get("tray_no")),
        )
        for item in experiment_run_trays
    }
    experiment_run_trays = [
        {
            **item,
            "status": COMPLETED_STATUS,
            "run_tray_status": COMPLETED_STATUS,
            "ended_at": completed_time,
            "updated_at": completed_time,
        }
        if (
            normalize_text(item.get("task_code")) == normalized_task_code
            and normalize_text(item.get("experiment_code")) == normalized_experiment_code
            and (not normalized_sub_experiment_code or record_sub_experiment_code(item) == normalized_sub_experiment_code)
            and (not normalized_run_no or normalize_text(item.get("run_no") or item.get("runNo")) == normalized_run_no)
            and normalize_text(item.get("tray_code") or item.get("tray_no")) in affected_tray_codes
        )
        else item
        for item in experiment_run_trays
    ]
    for run in experiment_runs:
        run_key = normalize_text(run.get("run_no") or run.get("id"))
        if normalized_run_no and run_key != normalized_run_no:
            continue
        if (
            normalize_text(run.get("task_code")) != normalized_task_code
            or normalize_text(run.get("experiment_code")) != normalized_experiment_code
            or (normalized_sub_experiment_code and record_sub_experiment_code(run) != normalized_sub_experiment_code)
        ):
            continue
        for tray_code in affected_tray_codes:
            if (run_key, tray_code) in existing_relation_keys:
                continue
            experiment_run_trays.append(
                {
                    "run_no": run_key,
                    "task_code": normalized_task_code,
                    "experiment_code": normalized_experiment_code,
                    "sub_experiment_code": normalized_sub_experiment_code,
                    "tray_code": tray_code,
                    "status": COMPLETED_STATUS,
                    "run_tray_status": COMPLETED_STATUS,
                    "started_at": normalize_text(run.get("started_at")),
                    "ended_at": completed_time,
                    "created_at": normalize_text(run.get("created_at")) or completed_time,
                    "updated_at": completed_time,
                }
            )

    if normalized_run_no:
        experiment_runs, experiment_run_trays = close_superseded_running_runs_for_trays(
            experiment_runs=experiment_runs,
            experiment_run_trays=experiment_run_trays,
            task_code=normalized_task_code,
            experiment_code=normalized_experiment_code,
            sub_experiment_code=normalized_sub_experiment_code,
            tray_codes=affected_tray_codes,
            current_run_no=normalized_run_no,
            ended_at=completed_time,
        )

    return {
        "affectedSampleCount": affected_sample_count,
        "affectedTrayCodes": sorted(affected_tray_codes),
        "completedAt": completed_time,
        "experiments": experiments,
        "experimentRunTrays": experiment_run_trays,
        "experimentRuns": experiment_runs,
        "samples": samples,
        "schedules": schedules,
    }
