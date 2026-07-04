from __future__ import annotations

from typing import Any

from app.core.axis_codes import canonical_axis_code, sort_axis_codes
from app.core.time_utils import format_business_datetime, now_business_text
from app.services.experiment_segments import record_sub_experiment_code, resolve_record_sub_experiment_code
from app.services.laboratory_completion import (
    axis_partial_completion_status,
    complete_storage_laboratory_experiment,
)
from app.services.laboratory_operations import clear_fixture_ready_marker
from app.services.laboratory_run_lifecycle import close_superseded_running_runs_for_trays


AXIS_COMPLETED_STATUS = "实验已完成"
AXIS_PENDING_STATUS = "待执行"
AXIS_RUNNING_STATUS = "实验进行中"
PARTIAL_AXIS_CONTINUATION_STATUS = "送至实验室"


def normalize_text(value: Any) -> str:
    return str(value or "").strip()


def normalize_axis_codes(value: Any) -> list[str]:
    if isinstance(value, list):
        raw_values = value
    elif isinstance(value, str):
        raw_values = value.replace("，", ",").split(",")
    else:
        raw_values = []
    result: list[str] = []
    seen: set[str] = set()
    for item in raw_values:
        normalized = normalize_text(item)
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        result.append(normalized)
    return sort_axis_codes(result)


def scheduled_axis_codes_for_experiment(
    schedules: list[dict[str, Any]],
    *,
    task_code: str,
    experiment_code: str,
    sub_experiment_code: str = "",
) -> list[str]:
    normalized_task_code = normalize_text(task_code)
    normalized_experiment_code = normalize_text(experiment_code)
    normalized_sub_experiment_code = normalize_text(sub_experiment_code)
    related = [
        schedule
        for schedule in schedules
        if normalize_text(schedule.get("task_code") or schedule.get("task_no")) == normalized_task_code
        and normalize_text(schedule.get("experiment_code") or schedule.get("experiment_no")) == normalized_experiment_code
        and (
            not normalized_sub_experiment_code
            or resolve_record_sub_experiment_code(schedule, experiment_code=normalized_experiment_code) == normalized_sub_experiment_code
        )
    ]
    related.sort(key=lambda item: normalize_text(item.get("start_at") or item.get("startAt") or item.get("start_time")))
    axes: list[str] = []
    seen: set[str] = set()
    for schedule in related:
        for axis_code in normalize_axis_codes(schedule.get("axis_codes") or schedule.get("axisCodes")):
            if axis_code in seen:
                continue
            seen.add(axis_code)
            axes.append(axis_code)
    return sort_axis_codes(axes)


def dispatched_axis_codes_for_experiment(
    experiments: list[dict[str, Any]],
    *,
    task_code: str,
    experiment_code: str,
) -> list[str]:
    normalized_task_code = normalize_text(task_code)
    normalized_experiment_code = normalize_text(experiment_code)
    for experiment in experiments:
        if normalize_text(experiment.get("task_code") or experiment.get("task_no")) != normalized_task_code:
            continue
        if normalize_text(experiment.get("experiment_code") or experiment.get("experiment_no")) != normalized_experiment_code:
            continue
        axes = normalize_axis_codes(experiment.get("axis_codes") or experiment.get("axisCodes"))
        if axes:
            return sort_axis_codes(axes)
    return []


def required_axis_codes_for_experiment(
    snapshot: dict[str, list[dict[str, Any]]],
    *,
    task_code: str,
    experiment_code: str,
    sub_experiment_code: str = "",
    fallback_axis_codes: list[str] | None = None,
) -> list[str]:
    normalized_sub_experiment_code = normalize_text(sub_experiment_code)
    if normalized_sub_experiment_code:
        scheduled_axes = scheduled_axis_codes_for_experiment(
            snapshot.get("schedules", []),
            task_code=task_code,
            experiment_code=experiment_code,
            sub_experiment_code=normalized_sub_experiment_code,
        )
        if scheduled_axes:
            return scheduled_axes
        return normalize_axis_codes(fallback_axis_codes or [])
    dispatched_axes = dispatched_axis_codes_for_experiment(
        snapshot.get("experiments", []),
        task_code=task_code,
        experiment_code=experiment_code,
    )
    if dispatched_axes:
        return dispatched_axes
    scheduled_axes = scheduled_axis_codes_for_experiment(
        snapshot.get("schedules", []),
        task_code=task_code,
        experiment_code=experiment_code,
    )
    if scheduled_axes:
        return scheduled_axes
    return normalize_axis_codes(fallback_axis_codes or [])


def planned_axis_codes_for_run(
    snapshot: dict[str, list[dict[str, Any]]],
    *,
    task_code: str,
    experiment_code: str,
    run_no: str,
    sub_experiment_code: str = "",
) -> list[str]:
    normalized_run_no = normalize_text(run_no)
    matched_run: dict[str, Any] | None = None
    for run in snapshot.get("experiment_runs", []):
        if normalize_text(run.get("run_no") or run.get("id")) != normalized_run_no:
            continue
        matched_run = run
        axes = normalize_axis_codes(run.get("axis_codes") or run.get("axisCodes"))
        if axes:
            return sort_axis_codes(axes)
        break
    if matched_run:
        schedule_id = normalize_text(matched_run.get("schedule_id") or matched_run.get("scheduleId"))
        if schedule_id:
            for schedule in snapshot.get("schedules", []):
                if normalize_text(schedule.get("id") or schedule.get("schedule_id") or schedule.get("scheduleId")) != schedule_id:
                    continue
                axes = normalize_axis_codes(schedule.get("axis_codes") or schedule.get("axisCodes"))
                if axes:
                    return sort_axis_codes(axes)
    return scheduled_axis_codes_for_experiment(
        snapshot.get("schedules", []),
        task_code=task_code,
        experiment_code=experiment_code,
        sub_experiment_code=sub_experiment_code,
    )


def ensure_run_steps(
    steps: list[dict[str, Any]],
    *,
    axis_codes: list[str],
    experiment_code: str,
    run_no: str,
    sub_experiment_code: str = "",
    task_code: str,
) -> list[dict[str, Any]]:
    normalized_run_no = normalize_text(run_no)
    normalized_task_code = normalize_text(task_code)
    normalized_experiment_code = normalize_text(experiment_code)
    normalized_sub_experiment_code = normalize_text(sub_experiment_code)
    next_steps = [dict(step) for step in steps]
    existing = {
        (
            normalize_text(step.get("run_no") or step.get("runNo")),
            canonical_axis_code(step.get("axis_code") or step.get("axisCode")),
        )
        for step in next_steps
    }
    for index, axis_code in enumerate(axis_codes, start=1):
        key = (normalized_run_no, axis_code)
        if key in existing:
            continue
        next_steps.append(
            {
                "id": f"{normalized_run_no}:{index}:{axis_code}",
                "run_no": normalized_run_no,
                "task_code": normalized_task_code,
                "experiment_code": normalized_experiment_code,
                "sub_experiment_code": normalized_sub_experiment_code,
                "axis_code": axis_code,
                "step_no": index,
                "status": AXIS_PENDING_STATUS,
            }
        )
    return next_steps


def complete_storage_laboratory_axis_step(
    snapshot: dict[str, list[dict[str, Any]]],
    *,
    task_code: str,
    experiment_code: str,
    sub_experiment_code: str = "",
    run_no: str,
    axis_code: str,
    next_axis_code: str = "",
    completed_at: str = "",
) -> dict[str, Any]:
    normalized_task_code = normalize_text(task_code)
    normalized_experiment_code = normalize_text(experiment_code)
    normalized_sub_experiment_code = normalize_text(sub_experiment_code)
    normalized_run_no = normalize_text(run_no)
    normalized_axis_code = canonical_axis_code(axis_code)
    normalized_next_axis_code = canonical_axis_code(next_axis_code)
    completed_time = format_business_datetime(completed_at) or normalize_text(completed_at) or now_business_text()
    if not normalized_task_code or not normalized_experiment_code or not normalized_run_no or not normalized_axis_code:
        raise ValueError("task_code, experiment_code, run_no and axis_code are required")
    if not normalized_sub_experiment_code:
        for run in snapshot.get("experiment_runs", []):
            if normalize_text(run.get("run_no") or run.get("runNo") or run.get("id")) != normalized_run_no:
                continue
            normalized_sub_experiment_code = resolve_record_sub_experiment_code(
                run,
                experiment_code=normalized_experiment_code,
            )
            break
    if not normalized_sub_experiment_code:
        raise ValueError("sub_experiment_code is required for axis step completion")

    run_axes = planned_axis_codes_for_run(
        snapshot,
        task_code=normalized_task_code,
        experiment_code=normalized_experiment_code,
        run_no=normalized_run_no,
        sub_experiment_code=normalized_sub_experiment_code,
    )
    if normalized_axis_code not in run_axes:
        run_axes = [*run_axes, normalized_axis_code]
    if normalized_next_axis_code and normalized_next_axis_code not in run_axes:
        run_axes = [*run_axes, normalized_next_axis_code]
    run_axes = sort_axis_codes(run_axes)
    required_axes = required_axis_codes_for_experiment(
        snapshot,
        task_code=normalized_task_code,
        experiment_code=normalized_experiment_code,
        sub_experiment_code=normalized_sub_experiment_code,
        fallback_axis_codes=run_axes,
    )
    if normalized_axis_code not in required_axes:
        required_axes = [*required_axes, normalized_axis_code]
    if normalized_next_axis_code and normalized_next_axis_code not in required_axes:
        required_axes = [*required_axes, normalized_next_axis_code]
    required_axes = sort_axis_codes(required_axes)

    steps = ensure_run_steps(
        snapshot.get("experiment_run_steps", []),
        axis_codes=run_axes,
        experiment_code=normalized_experiment_code,
        run_no=normalized_run_no,
        sub_experiment_code=normalized_sub_experiment_code,
        task_code=normalized_task_code,
    )
    completed_before = {
        canonical_axis_code(step.get("axis_code") or step.get("axisCode"))
        for step in steps
        if normalize_text(step.get("run_no") or step.get("runNo")) == normalized_run_no
        and normalize_text(step.get("status")) == AXIS_COMPLETED_STATUS
    }
    effective_next_axis_code = ""
    if normalized_axis_code in run_axes:
        for axis in run_axes[run_axes.index(normalized_axis_code) + 1:]:
            if axis not in completed_before:
                effective_next_axis_code = axis
                break
    elif normalized_next_axis_code in run_axes:
        effective_next_axis_code = normalized_next_axis_code
    next_steps: list[dict[str, Any]] = []
    for step in steps:
        step_run_no = normalize_text(step.get("run_no") or step.get("runNo"))
        step_axis_code = canonical_axis_code(step.get("axis_code") or step.get("axisCode"))
        if step_run_no != normalized_run_no:
            next_steps.append(step)
            continue
        if step_axis_code == normalized_axis_code:
            next_steps.append(
                {
                    **step,
                    "sub_experiment_code": normalized_sub_experiment_code or record_sub_experiment_code(step),
                    "status": AXIS_COMPLETED_STATUS,
                    "ended_at": completed_time,
                    "updated_at": completed_time,
                }
            )
        elif effective_next_axis_code and step_axis_code == effective_next_axis_code:
            next_steps.append(
                {
                    **step,
                    "sub_experiment_code": normalized_sub_experiment_code or record_sub_experiment_code(step),
                    "status": AXIS_RUNNING_STATUS,
                    "started_at": normalize_text(step.get("started_at") or step.get("startedAt")) or completed_time,
                    "updated_at": completed_time,
                }
            )
        else:
            next_steps.append(step)

    run_scopes = {
        normalize_text(run.get("run_no") or run.get("runNo") or run.get("id")): (
            normalize_text(run.get("task_code") or run.get("task_no")),
            normalize_text(run.get("experiment_code") or run.get("experiment_no")),
        )
        for run in snapshot.get("experiment_runs", [])
    }
    tray_codes_by_run_no: dict[str, set[str]] = {}
    for relation in snapshot.get("experiment_run_trays", []):
        relation_run_no = normalize_text(relation.get("run_no") or relation.get("runNo"))
        relation_tray_code = normalize_text(relation.get("tray_code") or relation.get("tray_no"))
        if not relation_run_no or not relation_tray_code:
            continue
        tray_codes_by_run_no.setdefault(relation_run_no, set()).add(relation_tray_code)
    for run in snapshot.get("experiment_runs", []):
        run_no = normalize_text(run.get("run_no") or run.get("runNo") or run.get("id"))
        if not run_no:
            continue
        for tray_code in normalize_axis_codes(run.get("tray_codes") or run.get("trayCodes")):
            tray_codes_by_run_no.setdefault(run_no, set()).add(tray_code)
    current_run_tray_codes = tray_codes_by_run_no.get(normalized_run_no, set())

    def step_matches_experiment(step: dict[str, Any]) -> bool:
        step_task_code = normalize_text(step.get("task_code") or step.get("task_no"))
        step_experiment_code = normalize_text(step.get("experiment_code") or step.get("experiment_no"))
        step_sub_experiment_code = record_sub_experiment_code(step)
        if step_task_code or step_experiment_code:
            return (
                step_task_code == normalized_task_code
                and step_experiment_code == normalized_experiment_code
                and (not normalized_sub_experiment_code or step_sub_experiment_code == normalized_sub_experiment_code)
            )
        step_run_no = normalize_text(step.get("run_no") or step.get("runNo"))
        return run_scopes.get(step_run_no) == (normalized_task_code, normalized_experiment_code)

    def step_matches_current_run_tray_scope(step: dict[str, Any]) -> bool:
        if not current_run_tray_codes:
            return True
        step_run_no = normalize_text(step.get("run_no") or step.get("runNo"))
        if step_run_no == normalized_run_no:
            return True
        return bool(tray_codes_by_run_no.get(step_run_no, set()) & current_run_tray_codes)

    completed_axes = {
        canonical_axis_code(step.get("axis_code") or step.get("axisCode"))
        for step in next_steps
        if step_matches_experiment(step)
        and step_matches_current_run_tray_scope(step)
        and normalize_text(step.get("status")) == AXIS_COMPLETED_STATUS
    }
    all_axes_completed = bool(required_axes) and set(required_axes).issubset(completed_axes)
    if all_axes_completed:
        next_snapshot = {**snapshot, "experiment_run_steps": next_steps}
        result = complete_storage_laboratory_experiment(
            next_snapshot,
            task_code=normalized_task_code,
            experiment_code=normalized_experiment_code,
            sub_experiment_code=normalized_sub_experiment_code,
            run_no=normalized_run_no,
            completed_at=completed_time,
        )
        return {**result, "experimentRunSteps": next_steps}

    current_run_completed_axes = {
        canonical_axis_code(step.get("axis_code") or step.get("axisCode"))
        for step in next_steps
        if normalize_text(step.get("run_no") or step.get("runNo")) == normalized_run_no
        and normalize_text(step.get("status")) == AXIS_COMPLETED_STATUS
    }
    run_axes_completed = bool(run_axes) and set(run_axes).issubset(current_run_completed_axes)
    if run_axes_completed:
        experiment_runs = [dict(item) for item in snapshot.get("experiment_runs", [])]
        experiments = [dict(item) for item in snapshot.get("experiments", [])]
        current_run = next(
            (
                item
                for item in experiment_runs
                if normalize_text(item.get("run_no") or item.get("runNo") or item.get("id")) == normalized_run_no
                and normalize_text(item.get("task_code") or item.get("task_no")) == normalized_task_code
                and normalize_text(item.get("experiment_code") or item.get("experiment_no")) == normalized_experiment_code
                and (not normalized_sub_experiment_code or record_sub_experiment_code(item) == normalized_sub_experiment_code)
            ),
            None,
        )
        current_schedule_id = normalize_text((current_run or {}).get("schedule_id") or (current_run or {}).get("scheduleId"))
        experiment_run_trays = [
            {
                **item,
                "status": AXIS_COMPLETED_STATUS,
                "run_tray_status": AXIS_COMPLETED_STATUS,
                "sub_experiment_code": normalized_sub_experiment_code or record_sub_experiment_code(item),
                "ended_at": completed_time,
                "updated_at": completed_time,
            }
            if normalize_text(item.get("run_no") or item.get("runNo")) == normalized_run_no
            and normalize_text(item.get("task_code") or item.get("task_no")) == normalized_task_code
            and normalize_text(item.get("experiment_code") or item.get("experiment_no")) == normalized_experiment_code
            else dict(item)
            for item in snapshot.get("experiment_run_trays", [])
        ]
        experiment_runs, experiment_run_trays = close_superseded_running_runs_for_trays(
            experiment_runs=experiment_runs,
            experiment_run_trays=experiment_run_trays,
            task_code=normalized_task_code,
            experiment_code=normalized_experiment_code,
            sub_experiment_code=normalized_sub_experiment_code,
            tray_codes=current_run_tray_codes,
            current_run_no=normalized_run_no,
            ended_at=completed_time,
        )
        completed_run_tray_codes = sorted(
            {
                normalize_text(item.get("tray_code") or item.get("tray_no"))
                for item in experiment_run_trays
                if normalize_text(item.get("run_no") or item.get("runNo")) == normalized_run_no
                and normalize_text(item.get("tray_code") or item.get("tray_no"))
            }
        )
        completed_run_tray_code_set = set(completed_run_tray_codes)
        scoped_tray_codes = {
            normalize_text(item.get("tray_code") or item.get("tray_no"))
            for item in snapshot.get("experiment_trays", [])
            if normalize_text(item.get("task_code") or item.get("task_no")) == normalized_task_code
            and normalize_text(item.get("experiment_code") or item.get("experiment_no")) == normalized_experiment_code
            and normalize_text(item.get("tray_code") or item.get("tray_no"))
        }
        completed_scope_trays_satisfy_schedule = (
            scoped_tray_codes.issubset(completed_run_tray_code_set)
            if scoped_tray_codes
            else True
        )
        experiment = next(
            (
                item
                for item in experiments
                if normalize_text(item.get("task_code") or item.get("task_no")) == normalized_task_code
                and normalize_text(item.get("experiment_code") or item.get("experiment_no")) == normalized_experiment_code
            ),
            {},
        )
        experiment_name = (
            normalize_text(experiment.get("experiment_name"))
            or normalize_text(experiment.get("experiment_type"))
            or normalized_experiment_code
        )
        samples: list[dict[str, Any]] = []
        affected_sample_count = 0
        finished_statuses = {
            AXIS_COMPLETED_STATUS,
            PARTIAL_AXIS_CONTINUATION_STATUS,
            "实验完成",
            "实验已经完成",
            "实验后暂存间存放",
            "厂家收回",
        }
        sample_completion_status = axis_partial_completion_status(
            experiment_name,
            len(current_run_completed_axes),
            len(required_axes),
        )
        finished_statuses.add(sample_completion_status)
        for sample in snapshot.get("samples", []):
            next_sample = {
                **sample,
                "trays": [dict(tray) for tray in sample.get("trays", []) if isinstance(tray, dict)],
                "history": [dict(entry) for entry in sample.get("history", []) if isinstance(entry, dict)],
            }
            if normalize_text(next_sample.get("task_code") or next_sample.get("task_no")) != normalized_task_code:
                samples.append(next_sample)
                continue
            touched_tray_codes: list[str] = []
            next_trays: list[dict[str, Any]] = []
            for tray in next_sample.get("trays", []):
                tray_code = normalize_text(tray.get("tray_code") or tray.get("trayCode") or tray.get("tray_no"))
                if tray_code in completed_run_tray_code_set:
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
                    touched_tray_codes.append(tray_code)
                else:
                    next_tray = tray
                next_trays.append(next_tray)
            if touched_tray_codes:
                next_sample["trays"] = next_trays
                if next_trays and all(normalize_text(tray.get("status")) in finished_statuses for tray in next_trays):
                    next_sample["status"] = sample_completion_status
                    next_sample["flow_status"] = sample_completion_status
                next_sample["updated_at"] = completed_time
                affected_sample_count += 1
            samples.append(next_sample)
        experiment_runs = [
            {
                **item,
                "status": AXIS_COMPLETED_STATUS,
                "ended_at": completed_time,
                "updated_at": completed_time,
            }
            if normalize_text(item.get("run_no") or item.get("runNo") or item.get("id")) == normalized_run_no
            and normalize_text(item.get("task_code") or item.get("task_no")) == normalized_task_code
            and normalize_text(item.get("experiment_code") or item.get("experiment_no")) == normalized_experiment_code
            else item
            for item in experiment_runs
        ]

        def next_schedule_record(item: dict[str, Any]) -> dict[str, Any]:
            schedule_key = normalize_text(item.get("id") or item.get("schedule_id") or item.get("scheduleId"))
            if not current_schedule_id or schedule_key != current_schedule_id:
                return dict(item)
            if completed_scope_trays_satisfy_schedule:
                return {
                    **item,
                    "status": AXIS_COMPLETED_STATUS,
                    "updated_at": completed_time,
                }
            return {
                **item,
                "status": AXIS_RUNNING_STATUS,
                "updated_at": completed_time,
            }

        schedules = [next_schedule_record(item) for item in snapshot.get("schedules", [])]
        return {
            "affectedSampleCount": affected_sample_count,
            "affectedTrayCodes": completed_run_tray_codes,
            "completedAt": completed_time,
            "experiments": experiments,
            "experimentRunSteps": next_steps,
            "experimentRunTrays": experiment_run_trays,
            "experimentRuns": experiment_runs,
            "samples": samples,
            "schedules": schedules,
        }

    return {
        "affectedSampleCount": 0,
        "affectedTrayCodes": [],
        "completedAt": completed_time,
        "experiments": [dict(item) for item in snapshot.get("experiments", [])],
        "experimentRunSteps": next_steps,
        "experimentRunTrays": [dict(item) for item in snapshot.get("experiment_run_trays", [])],
        "experimentRuns": [dict(item) for item in snapshot.get("experiment_runs", [])],
        "samples": [dict(item) for item in snapshot.get("samples", [])],
        "schedules": [dict(item) for item in snapshot.get("schedules", [])],
    }
