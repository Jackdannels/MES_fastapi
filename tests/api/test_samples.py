from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.routes import samples as samples_route
from app.services.sample_page_queries import SampleSummaryPage


class FakeStorage:
    def __init__(self, samples, tasks=None):
        self.samples = samples
        self.tasks = tasks or []
        self.read_calls = []

    def read(self, key):
        self.read_calls.append(key)
        if key == "mes.samples":
            return self.samples
        if key == "mes.tasks":
            return self.tasks
        return []


def build_client(monkeypatch, samples):
    storage = FakeStorage(samples)
    monkeypatch.setattr(samples_route, "get_storage_backend", lambda: storage)
    app = FastAPI()
    app.include_router(samples_route.router)
    return TestClient(app), storage


def test_sample_page_returns_bounded_summaries_without_history_or_full_trays(monkeypatch):
    samples = [
        {
            "id": index,
            "code": f"TASK-001-SP-{index:03d}",
            "task_code": "TASK-001",
            "location": "接驳区",
            "owner": "张三",
            "status": "到货",
            "flow_status": "到货",
            "history": [{"action": "received"}],
            "trays": [{"tray_code": f"TRAY-{index:03d}", "status": "到货", "target_lab": "冲击一室"}],
        }
        for index in range(1, 13)
    ]
    client, storage = build_client(monkeypatch, samples)

    response = client.get("/api/samples/page?page=2&pageSize=8")

    assert response.status_code == 200
    payload = response.json()
    assert payload["currentPage"] == 2
    assert payload["totalCount"] == 12
    assert payload["totalPages"] == 2
    assert len(payload["samples"]) == 4
    assert payload["samples"][0]["trayCodes"] == ["TRAY-009"]
    assert "history" not in payload["samples"][0]
    assert "trays" not in payload["samples"][0]
    assert storage.read_calls == ["mes.samples", "mes.tasks"]


def test_staging_sample_page_filters_before_pagination_and_facets(monkeypatch):
    client, _storage = build_client(
        monkeypatch,
        [
            {"id": 1, "code": "SP-001", "task_code": "TASK-A", "location": "接驳区", "status": "到货"},
            {"id": 2, "code": "SP-002", "task_code": "TASK-B", "location": "恒温恒湿间（暂存间）", "status": "已到达暂存间"},
            {"id": 3, "code": "SP-003", "task_code": "TASK-C", "location": "恒温恒湿间（实验后暂存间）", "status": "实验后暂存间存放"},
        ],
    )

    response = client.get("/api/samples/page?view=staging&pageSize=8")

    assert response.status_code == 200
    payload = response.json()
    assert [sample["code"] for sample in payload["samples"]] == ["SP-002", "SP-003"]
    assert payload["totalCount"] == 2
    assert payload["taskOptions"] == ["TASK-B", "TASK-C"]


def test_sample_detail_loads_one_complete_sample_on_demand(monkeypatch):
    client, storage = build_client(
        monkeypatch,
        [
            {
                "id": 7,
                "code": "TASK-001-SP-007",
                "task_code": "TASK-001",
                "history": [{"action": "received"}],
                "trays": [{"tray_code": "TRAY-007", "status": "到货"}],
            },
            {"id": 8, "code": "TASK-001-SP-008", "task_code": "TASK-001"},
        ],
    )

    response = client.get("/api/samples/TASK-001-SP-007")

    assert response.status_code == 200
    assert response.json()["history"] == [{"action": "received"}]
    assert response.json()["trays"] == [{"tray_code": "TRAY-007", "status": "到货"}]
    assert storage.read_calls == ["mes.samples"]


def test_sample_detail_returns_not_found(monkeypatch):
    client, _storage = build_client(monkeypatch, [])

    response = client.get("/api/samples/missing")

    assert response.status_code == 404


def test_capacity_sized_sample_page_keeps_response_bounded(monkeypatch):
    samples = [
        {
            "id": f"TASK-{index // 100:03d}-SP-{index:04d}",
            "code": f"TASK-{index // 100:03d}-SP-{index:04d}",
            "task_code": f"TASK-{index // 100:03d}",
            "location": "接驳区",
            "owner": "容量测试",
            "status": "到货",
            "flow_status": "到货",
            "trays": [{"tray_code": f"TRAY-{index:04d}", "status": "到货"}],
            "history": [{"action": "历史明细", "detail": "不会进入分页摘要" * 20}],
        }
        for index in range(3200)
    ]
    client, _storage = build_client(monkeypatch, samples)

    response = client.get("/api/samples/page?page=1&pageSize=8")

    assert response.status_code == 200
    assert response.json()["totalCount"] == 3200
    assert len(response.json()["samples"]) == 8
    assert len(response.content) < 20_000
    assert b"history" not in response.content


def test_mysql_sample_summary_id_round_trips_to_scoped_detail(monkeypatch):
    class ScopedStorage:
        def read_task_scope(self, task_codes, keys):
            assert task_codes == {"TASK-001"}
            assert keys == ["mes.samples"]
            return {
                "mes.samples": [
                    {
                        "id": "TASK-001-SP-001",
                        "code": "TASK-001-SP-001",
                        "task_code": "TASK-001",
                        "history": [{"action": "received"}],
                    }
                ]
            }

    class Repository:
        def list_samples(self, **_kwargs):
            return SampleSummaryPage(
                current_page=1,
                samples=({"id": "TASK-001-SP-001", "code": "TASK-001-SP-001"},),
                status_options=(),
                task_options=("TASK-001",),
                total_count=1,
                total_pages=1,
            )

        def find_task_code(self, identifier):
            assert identifier == "TASK-001-SP-001"
            return "TASK-001"

    monkeypatch.setattr(samples_route, "get_storage_backend", lambda: ScopedStorage())
    monkeypatch.setattr(samples_route, "get_sample_page_query_repository", lambda: Repository())
    app = FastAPI()
    app.include_router(samples_route.router)
    client = TestClient(app)

    page = client.get("/api/samples/page")
    detail = client.get(f"/api/samples/{page.json()['samples'][0]['id']}")

    assert detail.status_code == 200
    assert detail.json()["code"] == "TASK-001-SP-001"
    assert detail.json()["history"] == [{"action": "received"}]
