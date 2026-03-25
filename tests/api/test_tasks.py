from fastapi import FastAPI
from fastapi.testclient import TestClient


class FakeTaskStorage:
    def __init__(self, tasks=None, schedules=None, samples=None, streams=None):
        self.payloads = {
            "mes.tasks": list(tasks or []),
            "mes.schedules": list(schedules or []),
            "mes.samples": list(samples or []),
            "mes.streams": list(streams or []),
        }

    def read(self, key):
        return list(self.payloads.get(key, []))

    def write(self, key, value):
        self.payloads[key] = list(value)

    def write_many(self, updates):
        for key, value in updates.items():
            self.payloads[key] = list(value)


def build_client(monkeypatch, tasks=None, schedules=None, samples=None, streams=None):
    from app.api.routes import tasks as tasks_route

    storage = FakeTaskStorage(tasks=tasks, schedules=schedules, samples=samples, streams=streams)
    monkeypatch.setattr(tasks_route, "get_storage_backend", lambda: storage)

    app = FastAPI()
    app.state.storage = storage
    app.include_router(tasks_route.router)
    return TestClient(app)


def test_tasks_router_supports_full_lifecycle(monkeypatch):
    client = build_client(
        monkeypatch,
        tasks=[
            {
                "id": "CJ-2026-001",
                "code": "CJ-2026-001",
                "name": "冲击试验-批次A",
                "status": "待排程",
            }
        ],
    )

    listed = client.get("/api/tasks")
    created = client.post(
        "/api/tasks",
        json={
            "id": "MJ-2026-001",
            "code": "MJ-2026-001",
            "name": "霉菌试验",
            "status": "待排程",
        },
    )
    updated = client.put(
        "/api/tasks/MJ-2026-001",
        json={
            "id": "MJ-2026-001",
            "code": "MJ-2026-002",
            "name": "霉菌试验-改",
            "status": "已排程",
        },
    )
    deleted = client.delete("/api/tasks/CJ-2026-001")
    remaining = client.get("/api/tasks")

    assert listed.status_code == 200
    assert listed.json()[0]["code"] == "CJ-2026-001"
    assert created.status_code == 201
    assert created.json()["code"] == "MJ-2026-001"
    assert updated.status_code == 200
    assert updated.json()["code"] == "MJ-2026-002"
    assert updated.json()["status"] == "已排程"
    assert deleted.status_code == 204
    assert [item["code"] for item in remaining.json()] == ["MJ-2026-002"]


def test_tasks_router_returns_404_for_missing_task(monkeypatch):
    client = build_client(monkeypatch, tasks=[])

    updated = client.put(
        "/api/tasks/UNKNOWN-1",
        json={"id": "UNKNOWN-1", "code": "UNKNOWN-1", "name": "missing"},
    )
    deleted = client.delete("/api/tasks/UNKNOWN-1")

    assert updated.status_code == 404
    assert updated.json() == {"detail": "Task not found"}
    assert deleted.status_code == 404
    assert deleted.json() == {"detail": "Task not found"}


def test_delete_task_also_removes_related_records(monkeypatch):
    client = build_client(
        monkeypatch,
        tasks=[
            {"id": "CJ-2026-001", "code": "CJ-2026-001", "name": "冲击试验-批次A"},
            {"id": "MJ-2026-001", "code": "MJ-2026-001", "name": "霉菌试验"},
        ],
        schedules=[
            {"id": "SCH-1", "task_code": "CJ-2026-001"},
            {"id": "SCH-2", "task_code": "MJ-2026-001"},
        ],
        samples=[
            {"id": "CJ-2026-001-SP-001", "code": "CJ-2026-001-SP-001", "task_code": "CJ-2026-001"},
            {"id": "MJ-2026-001-SP-001", "code": "MJ-2026-001-SP-001", "task_code": "MJ-2026-001"},
        ],
        streams=[
            {"id": "STREAM-1", "task_code": "CJ-2026-001"},
            {"id": "STREAM-2", "task_code": "MJ-2026-001"},
        ],
    )

    deleted = client.delete("/api/tasks/CJ-2026-001")
    remaining = client.get("/api/tasks")
    storage = client.app.state.storage

    assert deleted.status_code == 204
    assert [item["code"] for item in remaining.json()] == ["MJ-2026-001"]
    assert [item["task_code"] for item in storage.read("mes.schedules")] == ["MJ-2026-001"]
    assert [item["task_code"] for item in storage.read("mes.samples")] == ["MJ-2026-001"]
    assert [item["task_code"] for item in storage.read("mes.streams")] == ["MJ-2026-001"]
