from copy import deepcopy

from fastapi import FastAPI
from fastapi.testclient import TestClient


class FakeStorage:
    def __init__(self, payloads=None):
        self.payloads = {
            "mes.tasks": [],
            "mes.samples": [],
            "mes.experiments": [],
            "mes.experiment_runs": [],
            "mes.experiment_run_trays": [],
            "mes.experiment_trays": [],
            "mes.schedules": [],
            "mes.staging_events": [],
        }
        self.payloads.update(deepcopy(payloads or {}))

    def read_all(self):
        return deepcopy(self.payloads)


def build_client(monkeypatch, payloads=None, attendance_operations=None):
    from app.api.routes import task_history as task_history_route

    storage = FakeStorage(payloads)
    monkeypatch.setattr(task_history_route, "get_storage_backend", lambda: storage)
    monkeypatch.setattr(
        task_history_route,
        "read_task_attendance_operations",
        lambda task_codes: [
            deepcopy(row)
            for row in (attendance_operations or [])
            if row.get("taskCode") in task_codes
        ],
    )

    app = FastAPI()
    app.include_router(task_history_route.router)
    return TestClient(app), storage


def returned_sample(task_code, tray_code, sample_code=None, time="2026-05-21T09:00:00+08:00"):
    return {
        "code": sample_code or f"{task_code}-SP",
        "task_code": task_code,
        "status": "厂家收回",
        "trays": [{"tray_code": tray_code, "status": "厂家收回"}],
        "history": [{"status": "厂家收回", "detail": f"{tray_code} 厂家收回", "time": time}],
    }


def test_task_history_page_returns_only_requested_page_snapshot(monkeypatch):
    client, _storage = build_client(
        monkeypatch,
        {
            "mes.tasks": [
                {"code": "TASK-A", "name": "A任务", "status": "厂家收回"},
                {"code": "TASK-B", "name": "B任务", "status": "厂家收回"},
                {"code": "TASK-C", "name": "C任务", "status": "厂家收回"},
            ],
            "mes.samples": [
                returned_sample("TASK-A", "TP-A", time="2026-05-21T09:00:00+08:00"),
                returned_sample("TASK-B", "TP-B", time="2026-05-22T09:00:00+08:00"),
                returned_sample("TASK-C", "TP-C", time="2026-05-23T09:00:00+08:00"),
            ],
            "mes.experiments": [
                {"task_code": "TASK-A", "experiment_code": "TASK-A-A"},
                {"task_code": "TASK-B", "experiment_code": "TASK-B-A"},
                {"task_code": "TASK-C", "experiment_code": "TASK-C-A"},
            ],
            "mes.experiment_trays": [
                {"task_code": "TASK-A", "experiment_code": "TASK-A-A", "tray_code": "TP-A"},
                {"task_code": "TASK-B", "experiment_code": "TASK-B-A", "tray_code": "TP-B"},
                {"task_code": "TASK-C", "experiment_code": "TASK-C-A", "tray_code": "TP-C"},
            ],
            "mes.staging_events": [
                {"id": "event-a", "task_code": "TASK-A", "tray_code": "TP-A", "action": "manufacturer_return"},
                {"id": "event-b", "task_code": "TASK-B", "tray_code": "TP-B", "action": "manufacturer_return"},
                {"id": "event-c", "task_code": "TASK-C", "tray_code": "TP-C", "action": "manufacturer_return"},
            ],
        },
        attendance_operations=[
            {"id": 1, "taskCode": "TASK-A", "employeeName": "甲"},
            {"id": 2, "taskCode": "TASK-B", "employeeName": "乙"},
            {"id": 3, "taskCode": "TASK-C", "employeeName": "丙"},
        ],
    )

    response = client.get("/api/task-history?page=1&pageSize=2")

    assert response.status_code == 200
    payload = response.json()
    assert payload["totalCount"] == 3
    assert payload["totalPages"] == 2
    assert [task["code"] for task in payload["tasks"]] == ["TASK-C", "TASK-B"]
    assert {sample["task_code"] for sample in payload["samples"]} == {"TASK-C", "TASK-B"}
    assert {experiment["task_code"] for experiment in payload["experiments"]} == {"TASK-C", "TASK-B"}
    assert {entry["task_code"] for entry in payload["experimentTrays"]} == {"TASK-C", "TASK-B"}
    assert {event["id"] for event in payload["stagingEvents"]} == {"event-c", "event-b"}
    assert {operation["id"] for operation in payload["attendanceOperations"]} == {2, 3}


def test_task_history_page_filters_by_query_and_days(monkeypatch):
    client, _storage = build_client(
        monkeypatch,
        {
            "mes.tasks": [
                {"code": "TASK-OLD", "name": "旧任务", "status": "厂家收回"},
                {"code": "TASK-NEW", "name": "目标任务", "status": "厂家收回"},
            ],
            "mes.samples": [
                returned_sample("TASK-OLD", "TP-OLD", time="2026-04-01T09:00:00+08:00"),
                returned_sample("TASK-NEW", "TP-NEW", time="2026-05-20T09:00:00+08:00"),
            ],
        },
    )

    response = client.get("/api/task-history?query=TP-NEW&days=7&now=2026-05-21T01:00:00Z")

    assert response.status_code == 200
    payload = response.json()
    assert payload["totalCount"] == 1
    assert [task["code"] for task in payload["tasks"]] == ["TASK-NEW"]
