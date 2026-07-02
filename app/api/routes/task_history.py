from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

from fastapi import APIRouter, Query

from app.core.storage_backend import get_storage_backend


router = APIRouter(prefix="/api/task-history", tags=["task-history"])

RETURNED_STATUS = "厂家收回"


def normalize_text(value: Any) -> str:
    return str(value or "").strip()


def as_list(value: Any) -> list[Any]:
    return value if isinstance(value, list) else []


def parse_time(value: Any) -> datetime | None:
    text = normalize_text(value)
    if not text:
        return None
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None


def task_code_value(row: Any) -> str:
    if not isinstance(row, dict):
        return ""
    return normalize_text(row.get("code") or row.get("task_code") or row.get("taskCode") or row.get("id"))


def sample_task_code(sample: Any) -> str:
    if not isinstance(sample, dict):
        return ""
    return normalize_text(sample.get("task_code") or sample.get("taskCode") or sample.get("task_no") or sample.get("taskNo"))


def relation_task_code(row: Any) -> str:
    if not isinstance(row, dict):
        return ""
    return normalize_text(row.get("task_code") or row.get("taskCode") or row.get("task_no") or row.get("taskNo"))


def sample_code_value(sample: Any) -> str:
    if not isinstance(sample, dict):
        return ""
    return normalize_text(sample.get("code") or sample.get("sample_code") or sample.get("sampleCode") or sample.get("id"))


def tray_code_value(tray: Any) -> str:
    if not isinstance(tray, dict):
        return ""
    return normalize_text(tray.get("tray_code") or tray.get("trayCode") or tray.get("tray_no") or tray.get("trayNo"))


def status_value(row: Any) -> str:
    if not isinstance(row, dict):
        return ""
    return normalize_text(row.get("status") or row.get("tray_status") or row.get("trayStatus") or row.get("sampleStatus"))


def is_returned(value: Any) -> bool:
    return normalize_text(value) == RETURNED_STATUS


def entry_matches_tray(entry: Any, tray_code: str) -> bool:
    if not isinstance(entry, dict) or not tray_code:
        return False
    structured_code = tray_code_value(entry)
    if structured_code:
        return structured_code == tray_code
    return tray_code in normalize_text(entry.get("detail"))


def sample_history_marks_tray_returned(sample: dict[str, Any], tray: dict[str, Any]) -> bool:
    tray_code = tray_code_value(tray)
    tray_codes = [tray_code_value(item) for item in as_list(sample.get("trays")) if tray_code_value(item)]
    for entry in as_list(sample.get("history")):
        if not isinstance(entry, dict):
            continue
        entry_returned = is_returned(entry.get("status")) or is_returned(entry.get("action")) or is_returned(entry.get("detail"))
        if entry_returned and (entry_matches_tray(entry, tray_code) or (not normalize_text(entry.get("detail")) and len(tray_codes) == 1)):
            return True
    return False


def collect_tray_codes(samples: list[dict[str, Any]]) -> set[str]:
    codes: set[str] = set()
    for sample in samples:
        for tray in as_list(sample.get("trays")):
            tray_code = tray_code_value(tray)
            if tray_code:
                codes.add(tray_code)
    return codes


def collect_assigned_tray_codes(task: dict[str, Any], samples: list[dict[str, Any]], experiment_trays: list[dict[str, Any]]) -> set[str]:
    task_code = task_code_value(task) or sample_task_code(samples[0] if samples else {})
    codes = collect_tray_codes(samples)
    for tray_code in as_list(task.get("tray_codes") or task.get("trayCodes") or task.get("tray_nos") or task.get("trayNos")):
        normalized = normalize_text(tray_code)
        if normalized:
            codes.add(normalized)
    for relation in experiment_trays:
        if relation_task_code(relation) != task_code:
            continue
        tray_code = tray_code_value(relation)
        if tray_code:
            codes.add(tray_code)
    return codes


def collect_returned_tray_codes(samples: list[dict[str, Any]]) -> set[str]:
    returned: set[str] = set()
    for sample in samples:
        sample_status = status_value(sample)
        sample_location = normalize_text(sample.get("location"))
        for tray in as_list(sample.get("trays")):
            if not isinstance(tray, dict):
                continue
            tray_code = tray_code_value(tray)
            if not tray_code:
                continue
            if (
                is_returned(status_value(tray))
                or is_returned(sample_status)
                or is_returned(sample_location)
                or sample_history_marks_tray_returned(sample, tray)
            ):
                returned.add(tray_code)
    return returned


def latest_return_time(samples: list[dict[str, Any]]) -> str:
    latest_text = ""
    latest_time: datetime | None = None
    for sample in samples:
        for entry in as_list(sample.get("history")):
            if not isinstance(entry, dict):
                continue
            if not (is_returned(entry.get("status")) or is_returned(entry.get("action")) or is_returned(entry.get("detail"))):
                continue
            time_text = normalize_text(entry.get("time") or entry.get("created_at") or entry.get("updated_at") or entry.get("timestamp"))
            parsed = parse_time(time_text)
            if parsed is not None and (latest_time is None or parsed >= latest_time):
                latest_time = parsed
                latest_text = time_text
    return latest_text


def group_by_task(rows: list[Any], resolver) -> dict[str, list[dict[str, Any]]]:
    grouped: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        task_code = resolver(row)
        if not task_code:
            continue
        grouped.setdefault(task_code, []).append(row)
    return grouped


def build_history_summaries(snapshot: dict[str, Any], *, query: str, days: int, now: str) -> list[dict[str, Any]]:
    tasks = [dict(task) for task in as_list(snapshot.get("mes.tasks")) if isinstance(task, dict)]
    samples = [dict(sample) for sample in as_list(snapshot.get("mes.samples")) if isinstance(sample, dict)]
    experiment_trays = [dict(row) for row in as_list(snapshot.get("mes.experiment_trays")) if isinstance(row, dict)]
    samples_by_task = group_by_task(samples, sample_task_code)
    task_by_code = {task_code_value(task): task for task in tasks if task_code_value(task)}
    task_codes = sorted({*task_by_code.keys(), *samples_by_task.keys()})
    normalized_query = normalize_text(query).lower()
    now_time = parse_time(now) or datetime.now()

    summaries: list[dict[str, Any]] = []
    for task_code in task_codes:
        task = task_by_code.get(task_code, {"code": task_code})
        task_samples = samples_by_task.get(task_code, [])
        assigned_trays = collect_assigned_tray_codes(task, task_samples, experiment_trays)
        returned_trays = collect_returned_tray_codes(task_samples)
        has_history = bool(returned_trays) or (bool(assigned_trays) and len(returned_trays) == len(assigned_trays)) or is_returned(task.get("transfer_status") or task.get("status"))
        if not has_history:
            continue
        updated_at = latest_return_time(task_samples) or normalize_text(task.get("updated_at") or task.get("created_at"))
        if days > 0:
            task_time = parse_time(updated_at)
            if task_time is None or task_time.timestamp() < (now_time - timedelta(days=days)).timestamp():
                continue
        search_text = " ".join(
            [
                task_code,
                normalize_text(task.get("name") or task.get("task_name") or task.get("test_type") or task.get("experiment_type")),
                normalize_text(task.get("status") or task.get("transfer_status")),
                *sorted(assigned_trays | returned_trays),
                *[sample_code_value(sample) for sample in task_samples],
            ]
        ).lower()
        if normalized_query and normalized_query not in search_text:
            continue
        summaries.append({"code": task_code, "updatedAt": updated_at})

    summaries.sort(key=lambda item: item.get("code") or "")
    summaries.sort(key=lambda item: item.get("updatedAt") or "", reverse=True)
    return summaries


def filter_rows_by_task(snapshot: dict[str, Any], key: str, task_codes: set[str]) -> list[dict[str, Any]]:
    return [dict(row) for row in as_list(snapshot.get(key)) if isinstance(row, dict) and relation_task_code(row) in task_codes]


@router.get("")
def read_task_history_page(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=8, alias="pageSize", ge=1, le=100),
    query: str = Query(default=""),
    days: int = Query(default=0, ge=0),
    now: str = Query(default=""),
) -> dict[str, Any]:
    storage = get_storage_backend()
    snapshot = storage.read_all()
    if not isinstance(snapshot, dict):
        snapshot = {}

    summaries = build_history_summaries(snapshot, query=query, days=days, now=now)
    total_count = len(summaries)
    total_pages = max(1, (total_count + page_size - 1) // page_size)
    current_page = min(max(page, 1), total_pages)
    start_index = (current_page - 1) * page_size
    page_summaries = summaries[start_index:start_index + page_size]
    page_codes = {item["code"] for item in page_summaries}
    task_by_code = {task_code_value(task): dict(task) for task in as_list(snapshot.get("mes.tasks")) if isinstance(task, dict) and task_code_value(task)}
    tasks = [task_by_code.get(item["code"], {"code": item["code"]}) for item in page_summaries]

    return {
        "currentPage": current_page,
        "totalCount": total_count,
        "totalPages": total_pages,
        "tasks": tasks,
        "samples": filter_rows_by_task(snapshot, "mes.samples", page_codes),
        "experiments": filter_rows_by_task(snapshot, "mes.experiments", page_codes),
        "experimentRuns": filter_rows_by_task(snapshot, "mes.experiment_runs", page_codes),
        "experimentRunTrays": filter_rows_by_task(snapshot, "mes.experiment_run_trays", page_codes),
        "experimentTrays": filter_rows_by_task(snapshot, "mes.experiment_trays", page_codes),
        "schedules": filter_rows_by_task(snapshot, "mes.schedules", page_codes),
    }
