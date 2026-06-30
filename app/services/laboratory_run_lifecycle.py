from __future__ import annotations

from typing import Any

from app.services.experiment_segments import record_sub_experiment_code


COMPLETED_STATUS = "实验已完成"
RUNNING_STATUSES = {"实验进行中", "实验中"}


def normalize_text(value: Any) -> str:
    return str(value or "").strip()


def _record_run_no(record: dict[str, Any]) -> str:
    return normalize_text(record.get("run_no") or record.get("runNo") or record.get("id"))


def _record_task_code(record: dict[str, Any]) -> str:
    return normalize_text(record.get("task_code") or record.get("task_no"))


def _record_experiment_code(record: dict[str, Any]) -> str:
    return normalize_text(record.get("experiment_code") or record.get("experiment_no"))


def _record_tray_code(record: dict[str, Any]) -> str:
    return normalize_text(record.get("tray_code") or record.get("tray_no"))


def _is_running_record(record: dict[str, Any]) -> bool:
    status = normalize_text(record.get("run_tray_status")) or normalize_text(record.get("status"))
    return status in RUNNING_STATUSES


def _matches_scope(
    record: dict[str, Any],
    *,
    task_code: str,
    experiment_code: str,
    sub_experiment_code: str,
) -> bool:
    return (
        _record_task_code(record) == task_code
        and _record_experiment_code(record) == experiment_code
        and (not sub_experiment_code or record_sub_experiment_code(record) == sub_experiment_code)
    )


def close_superseded_running_runs_for_trays(
    *,
    experiment_runs: list[dict[str, Any]],
    experiment_run_trays: list[dict[str, Any]],
    task_code: str,
    experiment_code: str,
    sub_experiment_code: str = "",
    tray_codes: set[str] | list[str],
    current_run_no: str,
    ended_at: str,
    completed_status: str = COMPLETED_STATUS,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    normalized_task_code = normalize_text(task_code)
    normalized_experiment_code = normalize_text(experiment_code)
    normalized_sub_experiment_code = normalize_text(sub_experiment_code)
    normalized_current_run_no = normalize_text(current_run_no)
    affected_tray_codes = {normalize_text(code) for code in tray_codes if normalize_text(code)}
    if not normalized_task_code or not normalized_experiment_code or not normalized_current_run_no or not affected_tray_codes:
        return [dict(item) for item in experiment_runs], [dict(item) for item in experiment_run_trays]

    superseded_run_nos: set[str] = set()
    next_relations: list[dict[str, Any]] = []
    for relation in experiment_run_trays:
        relation_run_no = _record_run_no(relation)
        relation_tray_code = _record_tray_code(relation)
        if (
            relation_run_no
            and relation_run_no != normalized_current_run_no
            and relation_tray_code in affected_tray_codes
            and _matches_scope(
                relation,
                task_code=normalized_task_code,
                experiment_code=normalized_experiment_code,
                sub_experiment_code=normalized_sub_experiment_code,
            )
            and _is_running_record(relation)
        ):
            superseded_run_nos.add(relation_run_no)
            next_relations.append(
                {
                    **relation,
                    "sub_experiment_code": normalized_sub_experiment_code or record_sub_experiment_code(relation),
                    "status": completed_status,
                    "run_tray_status": completed_status,
                    "ended_at": ended_at,
                    "updated_at": ended_at,
                }
            )
            continue
        next_relations.append(dict(relation))

    if not superseded_run_nos:
        return [dict(item) for item in experiment_runs], next_relations

    remaining_running_run_nos = {
        _record_run_no(relation)
        for relation in next_relations
        if _record_run_no(relation) and _is_running_record(relation)
    }

    next_runs: list[dict[str, Any]] = []
    for run in experiment_runs:
        run_no = _record_run_no(run)
        if (
            run_no in superseded_run_nos
            and run_no not in remaining_running_run_nos
            and _matches_scope(
                run,
                task_code=normalized_task_code,
                experiment_code=normalized_experiment_code,
                sub_experiment_code=normalized_sub_experiment_code,
            )
            and normalize_text(run.get("status")) in RUNNING_STATUSES
        ):
            next_runs.append(
                {
                    **run,
                    "sub_experiment_code": normalized_sub_experiment_code or record_sub_experiment_code(run),
                    "status": completed_status,
                    "ended_at": ended_at,
                    "updated_at": ended_at,
                }
            )
            continue
        next_runs.append(dict(run))

    return next_runs, next_relations
