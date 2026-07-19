from fastapi.testclient import TestClient

from tools.lims_simulator import app as lims_app


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
    return TestClient(lims_app.app), fake


def test_lims_simulator_serves_rabbit_state_and_generates_valid_task(monkeypatch):
    client, _fake = build_client(monkeypatch)

    state = client.get("/api/state")
    generated = client.post("/api/tasks/generate")

    assert state.status_code == 200
    assert state.json()["connected"] is True
    assert state.json()["rabbitmq_url"] == "127.0.0.1:5672/"
    assert state.json()["version"] == "1.0"
    assert client.get("/openapi.json").json()["info"]["version"] == "1.0"
    assert generated.status_code == 200
    assert generated.json()["source"] == "外部委托"
    assert generated.json()["client"].endswith("单位")
    assert generated.json()["test_types"]
    axis_map = generated.json()["axis_codes_by_test_type"]
    assert set(axis_map).issubset(set(generated.json()["test_types"]))
    assert all(axis_codes == ["x+", "x-", "y+", "y-", "z+", "z-"] for axis_codes in axis_map.values())
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
        "code": "SYLU-2026-07-021",
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
