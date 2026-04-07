from fastapi import FastAPI
from fastapi.testclient import TestClient


class FakeTaskStorage:
    def __init__(self, tasks=None, schedules=None, samples=None, streams=None, experiments=None, experiment_trays=None, experiment_samples=None):
        self.payloads = {
            "mes.tasks": list(tasks or []),
            "mes.schedules": list(schedules or []),
            "mes.samples": list(samples or []),
            "mes.streams": list(streams or []),
            "mes.experiments": list(experiments or []),
            "mes.experiment_trays": list(experiment_trays or []),
            "mes.experiment_samples": list(experiment_samples or []),
        }

    def read(self, key):
        return list(self.payloads.get(key, []))

    def read_all(self):
        return {key: list(value) for key, value in self.payloads.items()}

    def write(self, key, value):
        self.payloads[key] = list(value)

    def write_many(self, updates):
        for key, value in updates.items():
            self.payloads[key] = list(value)


def build_client(monkeypatch, tasks=None, schedules=None, samples=None, streams=None, experiments=None, experiment_trays=None, experiment_samples=None):
    from app.api.routes import tasks as tasks_route

    storage = FakeTaskStorage(
        tasks=tasks,
        schedules=schedules,
        samples=samples,
        streams=streams,
        experiments=experiments,
        experiment_trays=experiment_trays,
        experiment_samples=experiment_samples,
    )
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
                "id": "SYLU-2026-03-001",
                "code": "SYLU-2026-03-001",
                "name": "冲击试验-批次A",
                "status": "待排程",
            }
        ],
    )

    listed = client.get("/api/tasks")
    created = client.post(
        "/api/tasks",
        json={
            "id": "SYLU-2026-03-002",
            "code": "SYLU-2026-03-002",
            "name": "霉菌试验",
            "status": "待排程",
        },
    )
    updated = client.put(
        "/api/tasks/SYLU-2026-03-002",
        json={
            "id": "SYLU-2026-03-002",
            "code": "SYLU-2026-03-003",
            "name": "霉菌试验-改",
            "status": "已排程",
        },
    )
    deleted = client.delete("/api/tasks/SYLU-2026-03-001")
    remaining = client.get("/api/tasks")

    assert listed.status_code == 200
    assert listed.json()[0]["code"] == "SYLU-2026-03-001"
    assert created.status_code == 201
    assert created.json()["code"] == "SYLU-2026-03-002"
    assert created.json()["experiment_count"] == 3
    assert len(created.json()["experiment_codes"]) == 3
    assert updated.status_code == 200
    assert updated.json()["code"] == "SYLU-2026-03-003"
    assert updated.json()["status"] == "已排程"
    assert updated.json()["experiment_count"] == 3
    assert deleted.status_code == 204
    assert [item["code"] for item in remaining.json()] == ["SYLU-2026-03-003"]
    assert remaining.json()[0]["experiment_count"] == 3
    assert len(remaining.json()[0]["experiment_codes"]) == 3


def test_create_task_generates_three_distinct_experiments_and_persists_relation_rows(monkeypatch):
    client = build_client(monkeypatch, tasks=[])

    created = client.post(
        "/api/tasks",
        json={
            "id": "SYLU-2026-04-105",
            "code": "SYLU-2026-04-105",
            "name": "高低温湿热试验-批次E",
            "test_type": "高低温湿热试验",
            "required_device": "高低温湿热试验",
            "status": "待排程",
        },
    )

    storage = client.app.state.storage

    assert created.status_code == 201
    assert created.json()["experiment_count"] == 3
    assert created.json()["experiment_codes"] == [
        "SYLU-2026-04-105-A",
        "SYLU-2026-04-105-B",
        "SYLU-2026-04-105-C",
    ]
    assert [item["experiment_code"] for item in storage.read("mes.experiments")] == [
        "SYLU-2026-04-105-A",
        "SYLU-2026-04-105-B",
        "SYLU-2026-04-105-C",
    ]
    assert [item["experiment_name"] for item in storage.read("mes.experiments")][0] == "高低温湿热试验"
    assert len({item["experiment_name"] for item in storage.read("mes.experiments")}) == 3
    assert storage.read("mes.tasks")[0]["experiment_count"] == 3
    assert storage.read("mes.tasks")[0]["experiment_codes"] == [
        "SYLU-2026-04-105-A",
        "SYLU-2026-04-105-B",
        "SYLU-2026-04-105-C",
    ]


def test_create_task_preserves_existing_experiments_for_other_tasks(monkeypatch):
    client = build_client(
        monkeypatch,
        tasks=[{"id": "SYLU-2026-03-001", "code": "SYLU-2026-03-001", "name": "旧任务", "status": "待排程"}],
        experiments=[
            {
                "id": "SYLU-2026-03-001-A",
                "task_code": "SYLU-2026-03-001",
                "experiment_code": "SYLU-2026-03-001-A",
                "experiment_name": "温度冲击试验",
                "required_device": "温度冲击试验",
            }
        ],
    )

    created = client.post(
        "/api/tasks",
        json={
            "id": "SYLU-2026-03-002",
            "code": "SYLU-2026-03-002",
            "name": "新任务",
            "test_type": "振动试验",
            "status": "待排程",
        },
    )

    storage = client.app.state.storage

    assert created.status_code == 201
    assert [item["experiment_code"] for item in storage.read("mes.experiments")] == [
        "SYLU-2026-03-001-A",
        "SYLU-2026-03-002-A",
        "SYLU-2026-03-002-B",
        "SYLU-2026-03-002-C",
    ]


def test_update_task_keeps_experiment_metadata_in_sync(monkeypatch):
    client = build_client(
        monkeypatch,
        tasks=[
            {
                "id": "SYLU-2026-04-105",
                "code": "SYLU-2026-04-105",
                "name": "高低温湿热试验-批次E",
                "test_type": "高低温湿热试验",
                "required_device": "高低温湿热试验",
                "status": "待排程",
                "experiment_count": 1,
                "experiment_codes": ["SYLU-2026-04-105-A"],
            }
        ],
        experiments=[
            {
                "id": "SYLU-2026-04-105-A",
                "task_code": "SYLU-2026-04-105",
                "experiment_code": "SYLU-2026-04-105-A",
                "experiment_name": "高低温湿热试验",
                "required_device": "高低温湿热试验",
            }
        ],
    )

    updated = client.put(
        "/api/tasks/SYLU-2026-04-105",
        json={
            "id": "SYLU-2026-04-105",
            "code": "SYLU-2026-04-105",
            "name": "高低温湿热试验-批次E",
            "test_type": "高低温湿热试验",
            "required_device": "高低温湿热试验",
            "status": "已排程",
            "experiment_count": 3,
            "experiment_codes": ["SYLU-2026-04-105-A", "SYLU-2026-04-105-B", "SYLU-2026-04-105-C"],
        },
    )

    storage = client.app.state.storage

    assert updated.status_code == 200
    assert updated.json()["experiment_count"] == 3
    assert updated.json()["experiment_codes"] == ["SYLU-2026-04-105-A", "SYLU-2026-04-105-B", "SYLU-2026-04-105-C"]
    assert [item["experiment_code"] for item in storage.read("mes.experiments")] == [
        "SYLU-2026-04-105-A",
        "SYLU-2026-04-105-B",
        "SYLU-2026-04-105-C",
    ]
    assert storage.read("mes.tasks")[0]["experiment_count"] == 3
    assert storage.read("mes.tasks")[0]["experiment_codes"] == [
        "SYLU-2026-04-105-A",
        "SYLU-2026-04-105-B",
        "SYLU-2026-04-105-C",
    ]


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
            {"id": "SYLU-2026-03-001", "code": "SYLU-2026-03-001", "name": "冲击试验-批次A"},
            {"id": "SYLU-2026-03-002", "code": "SYLU-2026-03-002", "name": "霉菌试验"},
        ],
        schedules=[
            {"id": "SCH-1", "task_code": "SYLU-2026-03-001"},
            {"id": "SCH-2", "task_code": "SYLU-2026-03-002"},
        ],
        samples=[
            {"id": "SYLU-2026-03-001-SP-001", "code": "SYLU-2026-03-001-SP-001", "task_code": "SYLU-2026-03-001"},
            {"id": "SYLU-2026-03-002-SP-001", "code": "SYLU-2026-03-002-SP-001", "task_code": "SYLU-2026-03-002"},
        ],
        streams=[
            {"id": "STREAM-1", "task_code": "SYLU-2026-03-001"},
            {"id": "STREAM-2", "task_code": "SYLU-2026-03-002"},
        ],
        experiments=[
            {"id": "EXP-1", "task_code": "SYLU-2026-03-001", "experiment_code": "SYLU-2026-03-001-A"},
            {"id": "EXP-2", "task_code": "SYLU-2026-03-002", "experiment_code": "SYLU-2026-03-002-A"},
        ],
        experiment_trays=[
            {"id": "REL-1", "task_code": "SYLU-2026-03-001", "experiment_code": "SYLU-2026-03-001-A", "tray_code": "SYLU-2026-03-001-TP-001"},
            {"id": "REL-2", "task_code": "SYLU-2026-03-002", "experiment_code": "SYLU-2026-03-002-A", "tray_code": "SYLU-2026-03-002-TP-001"},
        ],
        experiment_samples=[
            {"id": "EXS-1", "task_code": "SYLU-2026-03-001", "experiment_code": "SYLU-2026-03-001-A", "sample_code": "SYLU-2026-03-001-SP-001"},
            {"id": "EXS-2", "task_code": "SYLU-2026-03-002", "experiment_code": "SYLU-2026-03-002-A", "sample_code": "SYLU-2026-03-002-SP-001"},
        ],
    )

    deleted = client.delete("/api/tasks/SYLU-2026-03-001")
    remaining = client.get("/api/tasks")
    storage = client.app.state.storage

    assert deleted.status_code == 204
    assert [item["code"] for item in remaining.json()] == ["SYLU-2026-03-002"]
    assert [item["task_code"] for item in storage.read("mes.schedules")] == ["SYLU-2026-03-002"]
    assert [item["task_code"] for item in storage.read("mes.samples")] == ["SYLU-2026-03-002"]
    assert [item["task_code"] for item in storage.read("mes.streams")] == ["SYLU-2026-03-002"]
    assert [item["task_code"] for item in storage.read("mes.experiments")] == ["SYLU-2026-03-002"]
    assert [item["task_code"] for item in storage.read("mes.experiment_trays")] == ["SYLU-2026-03-002"]
    assert [item["task_code"] for item in storage.read("mes.experiment_samples")] == ["SYLU-2026-03-002"]

