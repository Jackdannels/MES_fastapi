from typing import Any

from fastapi import APIRouter, Body, HTTPException, status

from app.core.storage_backend import get_storage_backend

router = APIRouter(prefix="/api/tasks", tags=["tasks"])


def normalize_text(value: Any) -> str:
    return str(value or "").strip()


def load_tasks() -> list[dict[str, Any]]:
    storage = get_storage_backend()
    tasks = storage.read("mes.tasks")
    return [dict(task) for task in tasks] if isinstance(tasks, list) else []


def find_task_index(tasks: list[dict[str, Any]], task_id: str) -> int:
    normalized_id = normalize_text(task_id)
    for index, task in enumerate(tasks):
        if normalize_text(task.get("id")) == normalized_id or normalize_text(task.get("code")) == normalized_id:
            return index
    return -1


def filter_related_rows(rows: Any, task_code: str) -> list[dict[str, Any]]:
    if not isinstance(rows, list):
        return []
    return [dict(row) for row in rows if normalize_text(row.get("task_code")) != task_code]


@router.get("")
def list_tasks() -> list[dict[str, Any]]:
    return load_tasks()


@router.post("", status_code=status.HTTP_201_CREATED)
def create_task(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
    tasks = load_tasks()
    next_task = dict(payload)
    tasks.insert(0, next_task)
    get_storage_backend().write("mes.tasks", tasks)
    return next_task


@router.put("/{task_id}")
def update_task(task_id: str, payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
    tasks = load_tasks()
    task_index = find_task_index(tasks, task_id)
    if task_index < 0:
        raise HTTPException(status_code=404, detail="Task not found")
    updated_task = {**tasks[task_index], **dict(payload)}
    tasks[task_index] = updated_task
    get_storage_backend().write("mes.tasks", tasks)
    return updated_task


@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_task(task_id: str) -> None:
    storage = get_storage_backend()
    tasks = load_tasks()
    task_index = find_task_index(tasks, task_id)
    if task_index < 0:
        raise HTTPException(status_code=404, detail="Task not found")
    removed_task = tasks.pop(task_index)
    task_code = normalize_text(removed_task.get("code")) or normalize_text(removed_task.get("id"))

    storage.write_many(
        {
            "mes.schedules": filter_related_rows(storage.read("mes.schedules"), task_code),
            "mes.samples": filter_related_rows(storage.read("mes.samples"), task_code),
            "mes.streams": filter_related_rows(storage.read("mes.streams"), task_code),
        }
    )
    storage.write("mes.tasks", tasks)
    return None
