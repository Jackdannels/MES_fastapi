from fastapi import FastAPI
from fastapi.testclient import TestClient
from types import ModuleType

from app.api.routes import mq as mq_route
from app.core.config import Settings
from app.services import mq_publisher


def build_client(monkeypatch):
    published = []

    def fake_publish(command, payload):
        published.append({"command": command, "payload": dict(payload)})
        return {"published": False, "reason": "disabled"}

    monkeypatch.setattr(mq_route, "publish_laboratory_command", fake_publish)
    app = FastAPI()
    app.include_router(mq_route.router)
    return TestClient(app), published


def test_fixture_install_endpoint_publishes_minimal_payload(monkeypatch):
    client, published = build_client(monkeypatch)

    response = client.post(
        "/api/mq/laboratory/fixture-install",
        json={
            "taskId": "SYLU-2026-03-001",
            "labId": "salt-spray-lab-01",
            "sampleType": "",
            "sampleCount": 8,
        },
    )

    assert response.status_code == 200
    assert response.json()["ok"] is True
    assert published == [
        {
            "command": "INSTALL_FIXTURE",
            "payload": {
                "cmd": "INSTALL_FIXTURE",
                "taskId": "SYLU-2026-03-001",
                "labId": "salt-spray-lab-01",
                "sampleType": "",
                "sampleCount": 8,
            },
        }
    ]


def test_ready_endpoint_publishes_minimal_payload(monkeypatch):
    client, published = build_client(monkeypatch)

    response = client.post(
        "/api/mq/laboratory/ready",
        json={
            "taskId": "SYLU-2026-03-001",
            "labId": "salt-spray-lab-01",
        },
    )

    assert response.status_code == 200
    assert response.json()["ok"] is True
    assert published == [
        {
            "command": "READY",
            "payload": {
                "cmd": "READY",
                "taskId": "SYLU-2026-03-001",
                "labId": "salt-spray-lab-01",
            },
        }
    ]


def test_mqtt_publish_starts_network_loop_before_waiting_for_qos_ack(monkeypatch):
    calls = []

    class FakePublishResult:
        rc = 0

        def wait_for_publish(self, timeout=None):
            calls.append(("wait", timeout))
            assert ("loop_start",) in calls

    class FakeClient:
        def __init__(self):
            calls.append(("client",))

        def username_pw_set(self, username, password):
            calls.append(("auth", username, password))

        def connect(self, host, port, keepalive=60):
            calls.append(("connect", host, port, keepalive))

        def loop_start(self):
            calls.append(("loop_start",))

        def publish(self, topic, payload, qos=0, retain=False):
            calls.append(("publish", topic, payload, qos, retain))
            return FakePublishResult()

        def loop_stop(self):
            calls.append(("loop_stop",))

        def disconnect(self):
            calls.append(("disconnect",))

    fake_paho = ModuleType("paho")
    fake_mqtt_package = ModuleType("paho.mqtt")
    fake_mqtt_client = ModuleType("paho.mqtt.client")
    fake_mqtt_client.Client = FakeClient
    fake_mqtt_package.client = fake_mqtt_client
    fake_paho.mqtt = fake_mqtt_package
    modules = __import__("sys").modules
    monkeypatch.setitem(modules, "paho", fake_paho)
    monkeypatch.setitem(modules, "paho.mqtt", fake_mqtt_package)
    monkeypatch.setitem(modules, "paho.mqtt.client", fake_mqtt_client)

    result = mq_publisher.publish_mqtt_json(
        "mes/v1/labs/salt-spray-lab-01/commands/experiment-ready",
        {"cmd": "READY"},
        Settings(MQTT_ENABLED=True, MQTT_USERNAME="guest", MQTT_PASSWORD="guest"),
    )

    assert result["published"] is True
    assert ("loop_stop",) in calls
    assert ("disconnect",) in calls
