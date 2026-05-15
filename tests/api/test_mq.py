from fastapi import FastAPI
from fastapi.testclient import TestClient
from types import ModuleType

from app.api.routes import mq as mq_route
from app.core.config import Settings
from app.services import mq_publisher
from app.services.mq_event_processor import process_laboratory_event


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


class FakeMqEventRepository:
    def __init__(self, existing_message_ids=None):
        self.existing_message_ids = set(existing_message_ids or [])
        self.messages = []
        self.events = []
        self.results = []
        self.started = []
        self.ended = []

    def message_exists(self, message_id):
        return message_id in self.existing_message_ids

    def record_message(self, message):
        self.messages.append(dict(message))
        self.existing_message_ids.add(message.get("message_id"))
        return len(self.messages)

    def record_event(self, event):
        self.events.append(dict(event))

    def record_result(self, result):
        self.results.append(dict(result))

    def mark_experiment_started(self, task_no, experiment_no, occurred_at):
        self.started.append((task_no, experiment_no, occurred_at))

    def mark_experiment_ended(self, task_no, experiment_no, occurred_at):
        self.ended.append((task_no, experiment_no, occurred_at))


def test_process_fixture_ready_records_event_and_returns_ack():
    repository = FakeMqEventRepository()

    ack = process_laboratory_event(
        "mes/v1/labs/salt-spray-lab-01/events/fixture-ready",
        {
            "protocol": "MES_LAB_MQTT",
            "version": "1.0",
            "messageId": "HOST-READY-001",
            "correlationId": "MES-INSTALL-001",
            "messageType": "FIXTURE_READY",
            "taskId": "SYLU-2026-03-001",
            "labId": "salt-spray-lab-01",
            "successId": "PLC-OK-001",
            "sentAt": "2026-05-16T09:31:01+08:00",
            "occurredAt": "2026-05-16T09:31:00+08:00",
        },
        repository=repository,
    )

    assert ack["messageType"] == "EVENT_ACK"
    assert ack["correlationId"] == "HOST-READY-001"
    assert ack["status"] == "PROCESSED"
    assert repository.messages[0]["message_type"] == "FIXTURE_READY"
    assert repository.events == [
        {
            "event_type": "FIXTURE_READY",
            "task_no": "SYLU-2026-03-001",
            "experiment_no": "",
            "lab_code": "salt-spray-lab-01",
            "success_id": "PLC-OK-001",
            "event_time": "2026-05-16T09:31:00+08:00",
            "message_id": "HOST-READY-001",
            "message_log_id": 1,
            "payload": repository.messages[0]["payload"],
        }
    ]


def test_process_duplicate_message_returns_ack_without_duplicate_event():
    repository = FakeMqEventRepository(existing_message_ids={"HOST-READY-001"})

    ack = process_laboratory_event(
        "mes/v1/labs/salt-spray-lab-01/events/fixture-ready",
        {
            "protocol": "MES_LAB_MQTT",
            "version": "1.0",
            "messageId": "HOST-READY-001",
            "messageType": "FIXTURE_READY",
            "taskId": "SYLU-2026-03-001",
            "labId": "salt-spray-lab-01",
            "successId": "PLC-OK-001",
            "occurredAt": "2026-05-16T09:31:00+08:00",
        },
        repository=repository,
    )

    assert ack["status"] == "DUPLICATE"
    assert repository.messages == []
    assert repository.events == []


def test_process_experiment_started_marks_actual_start():
    repository = FakeMqEventRepository()

    ack = process_laboratory_event(
        "mes/v1/labs/salt-spray-lab-01/events/experiment-started",
        {
            "protocol": "MES_LAB_MQTT",
            "version": "1.0",
            "messageId": "HOST-START-001",
            "messageType": "EXPERIMENT_STARTED",
            "taskId": "SYLU-2026-03-001",
            "experimentId": "SYLU-2026-03-001-A",
            "labId": "salt-spray-lab-01",
            "occurredAt": "2026-05-16T10:00:00+08:00",
        },
        repository=repository,
    )

    assert ack["status"] == "PROCESSED"
    assert repository.started == [("SYLU-2026-03-001", "SYLU-2026-03-001-A", "2026-05-16T10:00:00+08:00")]


def test_process_experiment_result_records_result_package():
    repository = FakeMqEventRepository()

    ack = process_laboratory_event(
        "mes/v1/labs/salt-spray-lab-01/events/experiment-result",
        {
            "protocol": "MES_LAB_MQTT",
            "version": "1.0",
            "messageId": "HOST-RESULT-001",
            "messageType": "EXPERIMENT_RESULT",
            "taskId": "SYLU-2026-03-001",
            "experimentId": "SYLU-2026-03-001-A",
            "labId": "salt-spray-lab-01",
            "occurredAt": "2026-05-16T17:30:00+08:00",
            "resultPackage": {
                "resultId": "R-001",
                "conclusion": "PASS",
                "summary": "合格",
                "items": [],
                "attachments": [],
            },
        },
        repository=repository,
    )

    assert ack["status"] == "PROCESSED"
    assert repository.results[0]["conclusion"] == "PASS"
    assert repository.results[0]["summary"] == "合格"


def test_inbound_event_endpoint_uses_processor(monkeypatch):
    calls = []

    def fake_process(topic, payload):
        calls.append((topic, payload))
        return {"messageType": "EVENT_ACK", "correlationId": payload["messageId"], "status": "PROCESSED"}

    monkeypatch.setattr(mq_route, "process_laboratory_event", fake_process)
    app = FastAPI()
    app.include_router(mq_route.router)
    client = TestClient(app)

    response = client.post(
        "/api/mq/laboratory/events/fixture-ready",
        json={
            "messageId": "HOST-READY-001",
            "messageType": "FIXTURE_READY",
            "taskId": "SYLU-2026-03-001",
            "labId": "salt-spray-lab-01",
        },
    )

    assert response.status_code == 200
    assert response.json()["status"] == "PROCESSED"
    assert calls[0][0] == "mes/v1/labs/salt-spray-lab-01/events/fixture-ready"
