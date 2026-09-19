from fastapi.testclient import TestClient
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor
import pytest

from tools.lims_simulator import app as lims_app
from tools.lims_simulator.task_numbers import TaskNumberSequence


@pytest.fixture(autouse=True)
def isolate_simulator_sequence(monkeypatch, tmp_path):
    monkeypatch.setenv("LIMS_HTTP_TOKEN", "")
    monkeypatch.delenv("LIMS_INBOX_PATH", raising=False)
    monkeypatch.setattr(lims_app, "simulator", lims_app.LimsSimulator(sequence_path=tmp_path / "sequence.sqlite3"))


class FakeRabbitClient:
    def __init__(self):
        self.published = []

    def state(self):
        return {"connected": True, "rabbitmq_url": "127.0.0.1:5672/", "last_error": ""}

    async def publish_intake(self, payload):
        self.published.append(dict(payload))
        return {
            "message_id": "MSG-001",
            "correlation_id": payload["lims_request_id"],
            "type": "lims.external-intake.created.v1",
            "schema_version": 1,
            "payload": dict(payload),
        }


def build_client(monkeypatch):
    fake = FakeRabbitClient()

    async def noop():
        return None

    monkeypatch.setattr(lims_app.rabbit_client, "start", noop)
    monkeypatch.setattr(lims_app.rabbit_client, "stop", noop)
    monkeypatch.setattr(lims_app.simulator, "rabbit", fake)
    return TestClient(lims_app.app, client=("127.0.0.1", 50000)), fake


def test_lims_simulator_uses_type_specific_axis_sequences():
    assert lims_app.AXIS_CODES_BY_EXPERIMENT_TYPE == {
        "冲击试验": ("x+", "x-", "y+", "z+", "y-", "z-"),
        "振动试验": ("x", "y+", "z+", "y-", "z-"),
    }


def test_lims_simulator_serves_rabbit_state_and_generates_valid_task(monkeypatch):
    client, _fake = build_client(monkeypatch)

    state = client.get("/api/state")
    generated = client.post("/api/tasks/generate")

    assert state.status_code == 200
    assert state.json()["connected"] is True
    assert state.json()["rabbitmq_url"] == "127.0.0.1:5672/"
    assert state.json()["version"] == "1.1"
    assert client.get("/openapi.json").json()["info"]["version"] == "1.1"
    assert generated.status_code == 200
    assert generated.json()["code"] == f"SYLUW-{lims_app.now_beijing():%Y-%m}-021"
    assert generated.json()["source"] == "外部委托"
    assert generated.json()["client"].endswith("单位")
    assert generated.json()["test_types"]
    axis_map = generated.json()["axis_codes_by_test_type"]
    assert set(axis_map).issubset(set(generated.json()["test_types"]))
    assert axis_map.get("冲击试验", ["x+", "x-", "y+", "z+", "y-", "z-"]) == [
        "x+", "x-", "y+", "z+", "y-", "z-",
    ]
    assert axis_map.get("振动试验", ["x", "y+", "z+", "y-", "z-"]) == [
        "x", "y+", "z+", "y-", "z-",
    ]
    assert 1 <= int(generated.json()["sample_count"]) <= 12

    page = client.get("/")
    script = client.get("/static/app.js")
    assert page.status_code == 200
    assert 'id="duePickerTrigger"' in page.text
    assert 'id="dueHourWheel"' in page.text
    assert 'id="dueMinuteWheel"' in page.text
    assert 'id="testTypesTrigger"' in page.text
    assert 'id="testTypesModal"' in page.text
    assert 'id="axisModal"' in page.text
    assert "const wheelOffsets = [-2, -1, 0, 1, 2]" in script.text
    assert 'const AXIS_AWARE_EXPERIMENT_TYPES = new Set(["冲击试验", "振动试验"])' in script.text
    assert 'due_at: $("dueAt").value' in script.text


def test_lims_simulator_publishes_only_through_rabbitmq(monkeypatch):
    client, fake = build_client(monkeypatch)
    payload = {
        "code": "SYLUW-2026-07-021",
        "name": "LIMS委托021",
        "client": "37单位",
        "contact": "李四",
        "contact_info": "13900001234",
        "sample_count": "2",
        "test_types": ["盐雾试验"],
        "axis_codes_by_test_type": {},
    }

    response = client.post("/api/tasks/send", json=payload)

    assert response.status_code == 200
    assert response.json()["publish_status"] == "published"
    assert fake.published[0]["source"] == "外部委托"
    assert fake.published[0]["lims_request_id"].startswith("LIMS-")
    assert fake.published[0]["axis_codes_by_test_type"] == {}


def test_sequence_survives_restart_and_resets_by_month(tmp_path):
    path = tmp_path / "sequence.sqlite3"
    assert TaskNumberSequence(path).next_code("2026-09") == "SYLUW-2026-09-021"
    assert TaskNumberSequence(path).next_code("2026-09") == "SYLUW-2026-09-022"
    assert TaskNumberSequence(path).next_code("2026-10") == "SYLUW-2026-10-021"
    assert TaskNumberSequence(path).next_code("2026-09") == "SYLUW-2026-09-023"


def test_sequence_allocates_unique_numbers_across_instances(tmp_path):
    path = tmp_path / "sequence.sqlite3"
    with ThreadPoolExecutor(max_workers=4) as pool:
        codes = list(pool.map(lambda _: TaskNumberSequence(path).next_code("2026-09"), range(24)))
    assert set(codes) == {f"SYLUW-2026-09-{value:03d}" for value in range(21, 45)}


def test_manual_send_advances_sequence_without_wrapping(monkeypatch):
    monkeypatch.setattr(lims_app, "now_beijing", lambda: datetime(2026, 9, 18, tzinfo=lims_app.BEIJING_TZ))
    client, fake = build_client(monkeypatch)
    assert client.post("/api/tasks/send", json={"code": "SYLUW-2026-09-999"}).status_code == 200
    assert fake.published[0]["code"] == "SYLUW-2026-09-999"
    assert client.post("/api/tasks/generate").json()["code"] == "SYLUW-2026-09-1000"


@pytest.mark.parametrize("code", ["SYLUN-2026-09-001", "SYLU-2026-09-001", "SYLUW-2026-13-001", "SYLUW-2026-09-000"])
def test_simulator_rejects_wrong_namespace_before_publishing(monkeypatch, code):
    client, fake = build_client(monkeypatch)
    response = client.post("/api/tasks/send", json={"code": code})
    assert response.status_code == 400
    assert "SYLUW" in response.json()["detail"]
    assert fake.published == []
