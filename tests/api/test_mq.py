from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest
from types import ModuleType

from app.api.routes import mq as mq_route
from app import main as app_main
from app.core.config import Settings
from app.services import mq_publisher
from app.services import mq_runtime
from app.services import mq_subscriber
from app.services.mq_event_processor import (
    MySQLMqEventRepository,
    merge_scoped_samples,
    process_laboratory_event,
    publish_realtime_update,
    scope_snapshot_samples_for_experiment,
)
from app.core.legacy_fallback import get_legacy_fallback_hits, reset_legacy_fallback_hits


@pytest.fixture(autouse=True)
def _reset_legacy_fallback_hits():
    reset_legacy_fallback_hits()
    yield
    reset_legacy_fallback_hits()


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
            "task_code": "SYLU-2026-03-001",
            "lab_code": "LAB_SALT",
            "sample_type": "",
            "sample_count": 8,
        },
    )

    assert response.status_code == 200
    assert response.json()["ok"] is True
    assert published == [
        {
            "command": "INSTALL_FIXTURE",
                "payload": {
                    "task_code": "SYLU-2026-03-001",
                    "lab_code": "LAB_SALT",
                    "experiment_code": "",
                    "sample_type": "",
                    "sample_count": 8,
                },
        }
    ]


def test_fixture_install_endpoint_rejects_sample_count_above_task_limit(monkeypatch):
    client, published = build_client(monkeypatch)

    response = client.post(
        "/api/mq/laboratory/fixture-install",
        json={
            "task_code": "SYLU-2026-03-001",
            "lab_code": "LAB_SALT",
            "sample_type": "",
            "sample_count": 100,
        },
    )

    assert response.status_code == 422
    assert published == []


def test_ready_endpoint_publishes_minimal_payload(monkeypatch):
    client, published = build_client(monkeypatch)

    response = client.post(
        "/api/mq/laboratory/ready",
        json={
            "task_code": "SYLU-2026-03-001",
            "lab_code": "LAB_SALT",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["payload"]["run_no"].startswith("run-")
    assert published == [
        {
            "command": "READY",
            "payload": {
                "task_code": "SYLU-2026-03-001",
                "lab_code": "LAB_SALT",
                "experiment_code": "",
                "run_no": body["payload"]["run_no"],
            },
        }
    ]


def test_ready_endpoint_preserves_payload_run_no(monkeypatch):
    client, published = build_client(monkeypatch)

    response = client.post(
        "/api/mq/laboratory/ready",
        json={
            "task_code": "SYLU-2026-03-001",
            "lab_code": "LAB_SALT",
            "experiment_code": "SYLU-2026-03-001-A",
            "runNo": "RUN-FROM-CLIENT",
        },
    )

    assert response.status_code == 200
    assert response.json()["payload"]["run_no"] == "RUN-FROM-CLIENT"
    assert published[0]["payload"]["run_no"] == "RUN-FROM-CLIENT"


def test_ready_endpoint_preserves_schedule_and_axis_context(monkeypatch):
    client, published = build_client(monkeypatch)

    response = client.post(
        "/api/mq/laboratory/ready",
        json={
            "task_code": "SYLU-2026-06-021",
            "lab_code": "LAB_IMPACT_2",
            "experiment_code": "SYLU-2026-06-021-A",
            "scheduleId": "schedule-impact-axis-x-plus",
            "axisCodes": ["x+", "x-"],
            "axisBatchNo": "axis-batch-001",
            "currentAxisCode": "x+",
            "subExperimentCode": "SYLU-2026-06-021-A-AXIS-X",
            "runNo": "RUN-FROM-CLIENT",
        },
    )

    assert response.status_code == 200
    assert published[0]["payload"] == {
        "task_code": "SYLU-2026-06-021",
        "lab_code": "LAB_IMPACT_2",
        "experiment_code": "SYLU-2026-06-021-A",
        "run_no": "RUN-FROM-CLIENT",
        "schedule_id": "schedule-impact-axis-x-plus",
        "axis_codes": ["x+", "x-"],
        "axis_batch_no": "axis-batch-001",
        "current_axis_code": "x+",
        "sub_experiment_code": "SYLU-2026-06-021-A-AXIS-X",
    }


def test_mq_realtime_update_publishes_experiment_run_trays(monkeypatch):
    published_updates = []
    from app.api.routes import storage as storage_route

    monkeypatch.setattr(storage_route, "publish_storage_update", lambda keys: published_updates.append(list(keys)), raising=False)

    publish_realtime_update()

    assert published_updates == [[
        "mes.experiments",
        "mes.experiment_runs",
        "mes.experiment_run_trays",
        "mes.experiment_run_steps",
        "mes.samples",
        "mes.schedules",
    ]]


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


def test_publish_laboratory_command_records_context_before_mqtt_publish(monkeypatch):
    calls = []

    def fake_record(command, topic, payload, publish_result):
        calls.append(("record", command, topic, dict(payload), publish_result.get("process_status")))
        return 91

    def fake_publish(topic, payload, app_settings):
        calls.append(("publish", topic, dict(payload)))
        return {"published": True, "reason": "", "topic": topic}

    def fake_update(message_log_id, publish_result):
        calls.append(("update", message_log_id, dict(publish_result)))

    monkeypatch.setattr(mq_publisher, "record_laboratory_command", fake_record)
    monkeypatch.setattr(mq_publisher, "publish_mqtt_json", fake_publish)
    monkeypatch.setattr(mq_publisher, "update_laboratory_command_publish_result", fake_update)

    result = mq_publisher.publish_laboratory_command(
        "INSTALL_FIXTURE",
        {
            "task_code": "SYLU-2026-06-021",
            "lab_code": "LAB_IMPACT_1",
            "experiment_code": "SYLU-2026-06-021-A",
        },
        Settings(MQTT_ENABLED=True),
    )

    assert result == {"published": True, "reason": "", "topic": "mes/v1/labs/LAB_IMPACT_1/commands/fixture-install"}
    assert calls == [
        (
            "record",
            "INSTALL_FIXTURE",
            "mes/v1/labs/LAB_IMPACT_1/commands/fixture-install",
            {
                "task_code": "SYLU-2026-06-021",
                "lab_code": "LAB_IMPACT_1",
                "experiment_code": "SYLU-2026-06-021-A",
            },
            "SENDING",
        ),
        (
            "publish",
            "mes/v1/labs/LAB_IMPACT_1/commands/fixture-install",
            {
                "task_code": "SYLU-2026-06-021",
                "lab_code": "LAB_IMPACT_1",
                "experiment_code": "SYLU-2026-06-021-A",
            },
        ),
        ("update", 91, {"published": True, "reason": "", "topic": "mes/v1/labs/LAB_IMPACT_1/commands/fixture-install"}),
    ]


def test_bind_laboratory_context_does_not_fallback_to_sample_status(monkeypatch):
    class TupleCursor:
        description = None

        def __init__(self):
            self.update_sql = ""

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def execute(self, sql, params=None):
            if "FROM md_lab" in sql:
                self.description = (("lab_id",),)
            elif "UPDATE biz_tray tr" in sql:
                self.update_sql = " ".join(sql.split())
                self.description = None

        def fetchone(self):
            columns = [column[0] for column in (self.description or [])]
            if columns == ["lab_id"]:
                return (17,)
            return None

    class TupleConnection:
        def __init__(self):
            self.cursor_obj = TupleCursor()
            self.committed = False

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def cursor(self):
            return self.cursor_obj

        def commit(self):
            self.committed = True

    connection = TupleConnection()
    monkeypatch.setattr(mq_publisher, "get_connection", lambda: connection)

    mq_publisher.bind_laboratory_context({"task_code": "TASK-SHARED", "lab_code": "LAB_IMPACT_1"})

    assert connection.committed is True
    assert "COALESCE(ti.status, '') = ''" not in connection.cursor_obj.update_sql
    assert "COALESCE(tr.test_state, '') = ''" not in connection.cursor_obj.update_sql
    assert "sm.sample_status IN" not in connection.cursor_obj.update_sql
    assert "sm.flow_status IN" not in connection.cursor_obj.update_sql


def test_bind_laboratory_context_scopes_update_by_payload_experiment(monkeypatch):
    class TupleCursor:
        description = None

        def __init__(self):
            self.update_sql = ""
            self.update_params = None

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def execute(self, sql, params=None):
            if "FROM md_lab" in sql:
                self.description = (("lab_id",),)
            elif "UPDATE biz_tray tr" in sql:
                self.update_sql = " ".join(sql.split())
                self.update_params = params
                self.description = None

        def fetchone(self):
            columns = [column[0] for column in (self.description or [])]
            if columns == ["lab_id"]:
                return (17,)
            return None

    class TupleConnection:
        def __init__(self):
            self.cursor_obj = TupleCursor()

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def cursor(self):
            return self.cursor_obj

        def commit(self):
            pass

    connection = TupleConnection()
    monkeypatch.setattr(mq_publisher, "get_connection", lambda: connection)

    mq_publisher.bind_laboratory_context(
        {
            "task_code": "TASK-SHARED",
            "experiment_code": "EXP-IMPACT",
            "lab_code": "LAB_IMPACT_1",
        }
    )

    assert "JOIN biz_experiment_tray" in connection.cursor_obj.update_sql
    assert "et.experiment_no = %s" in connection.cursor_obj.update_sql
    assert connection.cursor_obj.update_params == (17, "TASK-SHARED", "EXP-IMPACT")


def test_merge_scoped_samples_uses_task_and_sample_code_identity():
    original_samples = [
        {
            "code": "SP-001",
            "task_code": "TASK-A",
            "status": "实验准备就绪",
            "trays": [{"tray_code": "TP-A", "status": "实验准备就绪"}],
        },
        {
            "code": "SP-001",
            "task_code": "TASK-B",
            "status": "实验准备就绪",
            "trays": [{"tray_code": "TP-B", "status": "实验准备就绪"}],
        },
    ]
    scoped_samples = [
        {
            "code": "SP-001",
            "task_code": "TASK-B",
            "status": "实验进行中",
            "trays": [{"tray_code": "TP-B", "status": "实验进行中"}],
        }
    ]

    merged = merge_scoped_samples(original_samples, scoped_samples)

    assert merged[0]["task_code"] == "TASK-A"
    assert merged[0]["status"] == "实验准备就绪"
    assert merged[0]["trays"][0]["status"] == "实验准备就绪"
    assert merged[1]["task_code"] == "TASK-B"
    assert merged[1]["status"] == "实验进行中"
    assert merged[1]["trays"][0]["status"] == "实验进行中"


def test_scope_snapshot_samples_for_experiment_requires_sample_relation_or_tray_target():
    reset_legacy_fallback_hits()
    snapshot = {
        "experiment_samples": [],
        "experiment_trays": [
            {"task_code": "TASK-001", "experiment_code": "EXP-001", "tray_code": "TP-001"},
        ],
        "samples": [
            {
                "code": "SP-001",
                "task_code": "TASK-001",
                "trays": [{"tray_code": "TP-001", "status": "实验准备就绪"}],
            },
            {
                "code": "SP-002",
                "task_code": "TASK-001",
                "trays": [{"tray_code": "TP-002", "status": "实验准备就绪"}],
            },
        ],
    }

    scoped = scope_snapshot_samples_for_experiment(
        snapshot,
        task_code="TASK-001",
        experiment_code="EXP-001",
        tray_codes=["TP-001"],
    )

    assert scoped["samples"] == []
    assert [sample["code"] for sample in snapshot["samples"]] == ["SP-001", "SP-002"]
    assert get_legacy_fallback_hits() == []


def test_mqtt_subscriber_routes_lab_events_to_processor(monkeypatch):
    calls = []

    class FakeMessage:
        topic = "mes/v1/labs/LAB_SALT/events/experiment-started"
        payload = b'{"lab_code":"LAB_SALT","started_at":"2026-05-16 10:00:00"}'

    class FakeClient:
        def __init__(self):
            self.on_connect = None
            self.on_message = None
            calls.append(("client",))

        def username_pw_set(self, username, password):
            calls.append(("auth", username, password))

        def connect(self, host, port, keepalive=60):
            calls.append(("connect", host, port, keepalive))
            self.on_connect(self, None, None, 0)

        def subscribe(self, topic, qos=0):
            calls.append(("subscribe", topic, qos))

        def loop_start(self):
            calls.append(("loop_start",))
            self.on_message(self, None, FakeMessage())

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

    processed = []
    monkeypatch.setattr(mq_subscriber, "process_laboratory_event", lambda topic, payload: processed.append((topic, payload)))

    handle = mq_subscriber.start_mqtt_subscriber(Settings(MQTT_ENABLED=True, MQTT_USERNAME="guest", MQTT_PASSWORD="guest"))
    handle.stop()

    assert ("subscribe", "mes/v1/labs/+/events/#", 1) in calls
    assert processed == [
        (
            "mes/v1/labs/LAB_SALT/events/experiment-started",
            {"lab_code": "LAB_SALT", "started_at": "2026-05-16 10:00:00"},
        )
    ]
    assert ("loop_stop",) in calls
    assert ("disconnect",) in calls


def test_mqtt_subscriber_keeps_consuming_after_one_bad_lab_event(monkeypatch):
    calls = []

    class BadMessage:
        topic = "mes/v1/labs/LAB_IMPACT_1/events/fixture-ready"
        payload = b'{"lab_code":"LAB_IMPACT_1","fixture_ready_at":"2026-06-03 09:31:00"}'

    class GoodMessage:
        topic = "mes/v1/labs/LAB_SALT/events/fixture-ready"
        payload = b'{"lab_code":"LAB_SALT","fixture_ready_at":"2026-06-03 09:31:01"}'

    class FakeClient:
        def __init__(self):
            self.on_connect = None
            self.on_message = None
            calls.append(("client",))

        def username_pw_set(self, username, password):
            calls.append(("auth", username, password))

        def connect(self, host, port, keepalive=60):
            calls.append(("connect", host, port, keepalive))
            self.on_connect(self, None, None, 0)

        def subscribe(self, topic, qos=0):
            calls.append(("subscribe", topic, qos))

        def loop_start(self):
            calls.append(("loop_start",))
            self.on_message(self, None, BadMessage())
            self.on_message(self, None, GoodMessage())

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

    processed = []

    def fake_process(topic, payload):
        processed.append((topic, payload))
        if payload["lab_code"] == "LAB_IMPACT_1":
            raise ValueError("fixture install context is required for lab_code: LAB_IMPACT_1")

    monkeypatch.setattr(mq_subscriber, "process_laboratory_event", fake_process)

    handle = mq_subscriber.start_mqtt_subscriber(Settings(MQTT_ENABLED=True, MQTT_USERNAME="guest", MQTT_PASSWORD="guest"))
    handle.stop()

    assert processed == [
        (
            "mes/v1/labs/LAB_IMPACT_1/events/fixture-ready",
            {"lab_code": "LAB_IMPACT_1", "fixture_ready_at": "2026-06-03 09:31:00"},
        ),
        (
            "mes/v1/labs/LAB_SALT/events/fixture-ready",
            {"lab_code": "LAB_SALT", "fixture_ready_at": "2026-06-03 09:31:01"},
        ),
    ]


def test_create_app_starts_mqtt_subscriber_only_when_enabled(monkeypatch):
    calls = []

    monkeypatch.setattr(mq_runtime.MqttRuntimeController, "shutdown", lambda self: calls.append(("shutdown", self.mode)))

    app = app_main.create_app(Settings(MQTT_ENABLED=True, UPPER_COMPUTER_SIMULATOR_AUTO_ENABLE=False))
    with TestClient(app) as client:
        assert client.get("/api/mq/interface-mode").json() == {
            "ok": True,
            "mode": "mock",
            "mqtt_enabled": True,
            "subscriber_running": False,
            "upper_computer": {
                "enabled": False,
                "connected": False,
                "auto_mode": False,
                "reason": "paused",
            },
            "reason": "paused",
        }

    assert calls == [("shutdown", "mock")]


def test_interface_mode_endpoint_starts_and_stops_subscriber_when_switching_modes():
    calls = []

    class FakeHandle:
        def stop(self):
            calls.append("stop")

    def fake_start(app_settings):
        calls.append(("start", app_settings.MQTT_ENABLED))
        return FakeHandle()

    app = FastAPI()
    app.state.mq_runtime = mq_runtime.MqttRuntimeController(
        Settings(MQTT_ENABLED=True, UPPER_COMPUTER_SIMULATOR_AUTO_ENABLE=False),
        starter=fake_start,
    )
    app.include_router(mq_route.router)
    client = TestClient(app)

    mqtt_response = client.post("/api/mq/interface-mode", json={"mode": "mqtt"})
    assert mqtt_response.status_code == 200
    assert mqtt_response.json() == {
        "ok": True,
        "mode": "mqtt",
        "mqtt_enabled": True,
        "subscriber_running": True,
        "upper_computer": {
            "enabled": False,
            "started": False,
            "connected": False,
            "reason": "disabled",
        },
        "reason": "",
    }

    mock_response = client.post("/api/mq/interface-mode", json={"mode": "mock"})
    assert mock_response.status_code == 200
    assert mock_response.json() == {
        "ok": True,
        "mode": "mock",
        "mqtt_enabled": True,
        "subscriber_running": False,
        "upper_computer": {
            "enabled": False,
            "connected": False,
            "auto_mode": False,
            "reason": "paused",
        },
        "reason": "paused",
    }
    assert calls == [("start", True), "stop"]


def test_interface_mode_endpoint_auto_connects_upper_computer_simulator_when_enabled():
    calls = []

    class FakeHandle:
        def stop(self):
            calls.append("stop")

    def fake_start(app_settings):
        calls.append(("start", app_settings.MQTT_ENABLED))
        return FakeHandle()

    def fake_connect(app_settings):
        calls.append(("upper", app_settings.MQTT_TOPIC_PREFIX))
        return {
            "enabled": True,
            "started": True,
            "connected": True,
            "auto_mode": True,
            "subscription": "mes/v1/labs/+/commands/#",
            "url": "http://127.0.0.1:8899",
        }

    app = FastAPI()
    app.state.mq_runtime = mq_runtime.MqttRuntimeController(
        Settings(MQTT_ENABLED=True, UPPER_COMPUTER_SIMULATOR_AUTO_ENABLE=True),
        starter=fake_start,
        upper_computer_connector=fake_connect,
    )
    app.include_router(mq_route.router)
    client = TestClient(app)

    response = client.post("/api/mq/interface-mode", json={"mode": "mqtt"})

    assert response.status_code == 200
    assert response.json()["upper_computer"] == {
        "enabled": True,
        "started": True,
        "connected": True,
        "auto_mode": True,
        "subscription": "mes/v1/labs/+/commands/#",
        "url": "http://127.0.0.1:8899",
    }
    assert calls == [("start", True), ("upper", "mes/v1")]


def test_interface_mode_endpoint_does_not_reconnect_upper_computer_when_mqtt_mode_is_already_ready():
    calls = []

    class FakeHandle:
        def is_running(self):
            return True

        def stop(self):
            calls.append("stop")

    def fake_start(app_settings):
        calls.append(("start", app_settings.MQTT_ENABLED))
        return FakeHandle()

    def fake_connect(app_settings):
        calls.append(("upper", app_settings.MQTT_TOPIC_PREFIX))
        return {
            "enabled": True,
            "started": False,
            "connected": True,
            "auto_mode": True,
            "subscription": "mes/v1/labs/+/commands/#",
            "url": "http://127.0.0.1:8899",
        }

    app = FastAPI()
    app.state.mq_runtime = mq_runtime.MqttRuntimeController(
        Settings(MQTT_ENABLED=True, UPPER_COMPUTER_SIMULATOR_AUTO_ENABLE=True),
        starter=fake_start,
        upper_computer_connector=fake_connect,
    )
    app.include_router(mq_route.router)
    client = TestClient(app)

    assert client.post("/api/mq/interface-mode", json={"mode": "mqtt"}).status_code == 200
    assert client.post("/api/mq/interface-mode", json={"mode": "mqtt"}).status_code == 200

    assert calls == [("start", True), ("upper", "mes/v1")]


def test_upper_computer_auto_connect_opens_visible_auto_mode_page(monkeypatch):
    from app.services import upper_computer_simulator

    opened_urls = []

    upper_computer_simulator._opened_simulator_page_urls.clear()
    monkeypatch.setattr(upper_computer_simulator, "_can_read_state", lambda _settings: True)
    monkeypatch.setattr(
        upper_computer_simulator,
        "_json_request",
        lambda *_args, **_kwargs: {
            "connected": True,
            "config": {"auto_mode": True},
        },
    )
    monkeypatch.setattr(
        upper_computer_simulator,
        "open_simulator_page",
        lambda url: opened_urls.append(url),
        raising=False,
    )

    status = upper_computer_simulator.ensure_upper_computer_simulator_auto_mode(
        Settings(
            MQTT_ENABLED=True,
            UPPER_COMPUTER_SIMULATOR_AUTO_ENABLE=True,
            UPPER_COMPUTER_SIMULATOR_URL="http://127.0.0.1:8899",
        ),
    )

    assert opened_urls == ["http://127.0.0.1:8899/?auto=1"]
    assert status["page_url"] == "http://127.0.0.1:8899/?auto=1"


def test_upper_computer_auto_connect_opens_auto_mode_page_only_once(monkeypatch):
    from app.services import upper_computer_simulator

    opened_urls = []

    upper_computer_simulator._opened_simulator_page_urls.clear()
    monkeypatch.setattr(upper_computer_simulator, "_can_read_state", lambda _settings: True)
    monkeypatch.setattr(
        upper_computer_simulator,
        "_json_request",
        lambda *_args, **_kwargs: {
            "connected": True,
            "config": {"auto_mode": True},
        },
    )
    monkeypatch.setattr(
        upper_computer_simulator,
        "open_simulator_page",
        lambda url: opened_urls.append(url),
        raising=False,
    )

    settings = Settings(
        MQTT_ENABLED=True,
        UPPER_COMPUTER_SIMULATOR_AUTO_ENABLE=True,
        UPPER_COMPUTER_SIMULATOR_URL="http://127.0.0.1:8899",
    )

    upper_computer_simulator.ensure_upper_computer_simulator_auto_mode(settings)
    upper_computer_simulator.ensure_upper_computer_simulator_auto_mode(settings)

    assert opened_urls == ["http://127.0.0.1:8899/?auto=1"]


def test_interface_mode_endpoint_restarts_stale_mqtt_subscriber_when_switching_to_mqtt_again():
    calls = []
    handles = []

    class FakeHandle:
        def __init__(self, running):
            self.running = running
            handles.append(self)

        def is_running(self):
            return self.running

        def stop(self):
            calls.append("stop")

    def fake_start(app_settings):
        calls.append(("start", app_settings.MQTT_ENABLED))
        return FakeHandle(running=True)

    app = FastAPI()
    app.state.mq_runtime = mq_runtime.MqttRuntimeController(
        Settings(MQTT_ENABLED=True, UPPER_COMPUTER_SIMULATOR_AUTO_ENABLE=False),
        starter=fake_start,
    )
    app.include_router(mq_route.router)
    client = TestClient(app)

    assert client.post("/api/mq/interface-mode", json={"mode": "mqtt"}).json()["subscriber_running"] is True
    handles[0].running = False

    response = client.post("/api/mq/interface-mode", json={"mode": "mqtt"})

    assert response.status_code == 200
    assert response.json()["subscriber_running"] is True
    assert calls == [("start", True), "stop", ("start", True)]


def test_interface_mode_endpoint_does_not_start_subscriber_when_env_disabled():
    calls = []
    app = FastAPI()
    app.state.mq_runtime = mq_runtime.MqttRuntimeController(
        Settings(MQTT_ENABLED=False, UPPER_COMPUTER_SIMULATOR_AUTO_ENABLE=False),
        starter=lambda app_settings: calls.append(("start", app_settings.MQTT_ENABLED)),
    )
    app.include_router(mq_route.router)
    client = TestClient(app)

    response = client.post("/api/mq/interface-mode", json={"mode": "mqtt"})

    assert response.status_code == 200
    assert response.json() == {
        "ok": True,
        "mode": "mqtt",
        "mqtt_enabled": False,
        "subscriber_running": False,
        "upper_computer": {
            "enabled": False,
            "connected": False,
            "auto_mode": False,
            "reason": "mqtt_disabled",
        },
        "reason": "disabled",
    }
    assert calls == []


def test_interface_mode_endpoint_reports_startup_failure_and_keeps_previous_mode():
    app = FastAPI()
    app.state.mq_runtime = mq_runtime.MqttRuntimeController(
        Settings(MQTT_ENABLED=True, UPPER_COMPUTER_SIMULATOR_AUTO_ENABLE=False),
        starter=lambda _app_settings: (_ for _ in ()).throw(ConnectionRefusedError("broker unavailable")),
    )
    app.include_router(mq_route.router)
    client = TestClient(app)

    response = client.post("/api/mq/interface-mode", json={"mode": "mqtt"})

    assert response.status_code == 503
    assert "broker unavailable" in response.json()["detail"]
    assert client.get("/api/mq/interface-mode").json() == {
        "ok": True,
        "mode": "mock",
        "mqtt_enabled": True,
        "subscriber_running": False,
        "upper_computer": {
            "enabled": False,
            "connected": False,
            "auto_mode": False,
            "reason": "paused",
        },
        "reason": "paused",
    }


class FakeMqEventRepository:
    def __init__(self, existing_message_ids=None):
        self.existing_message_ids = set(existing_message_ids or [])
        self.messages = []
        self.events = []
        self.results = []
        self.started = []
        self.ended = []
        self.started_contexts = []
        self.context_payloads = []
        self.completed_runs_by_lab = {}
        self.contexts_by_lab = {
            "LAB_SALT": {
                "task_no": "SYLU-2026-03-001",
                "experiment_no": "SYLU-2026-03-001-A",
                "schedule_no": "schedule-salt",
                "device_name": "盐雾试验室",
                "planned_hours": 3.5,
                "tray_nos": ["SYLU-2026-03-001-TP-001"],
                "sample_nos": ["SYLU-2026-03-001-SP-001"],
            },
            "LAB_IMPACT_1": {
                "task_no": "SYLU-2026-06-002",
                "experiment_no": "SYLU-2026-06-002-C",
                "schedule_no": "schedule-impact",
                "device_name": "冲击一室",
                "planned_hours": 3.5,
                "tray_nos": ["SYLU-2026-06-002-TP-002"],
                "sample_nos": ["SYLU-2026-06-002-SP-005", "SYLU-2026-06-002-SP-006"],
            }
        }
        self.runs_by_lab = {
            "LAB_SALT": {
                "run_no": "RUN-SALT-001",
                "task_no": "SYLU-2026-03-001",
                "experiment_no": "SYLU-2026-03-001-A",
                "lab_code": "LAB_SALT",
            }
        }

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

    def find_active_run_by_lab(self, lab_code):
        return self.runs_by_lab.get(lab_code)

    def find_run_by_no(self, run_no):
        for run in self.runs_by_lab.values():
            if run.get("run_no") == run_no:
                return dict(run)
        for run in self.completed_runs_by_lab.values():
            if run.get("run_no") == run_no:
                return dict(run)
        return None

    def find_current_context_by_lab(self, lab_code, candidate_statuses, context_payload=None):
        self.context_payloads.append(dict(context_payload or {}))
        context = self.contexts_by_lab.get(lab_code)
        if not context:
            return None
        return {**context, "candidate_statuses": list(candidate_statuses)}

    def start_run_for_context(self, context, occurred_at, run_no=""):
        self.started_contexts.append((dict(context), occurred_at))
        return {
            "run_no": run_no or "RUN-CREATED-FROM-LAB",
            "task_no": context["task_no"],
            "experiment_no": context["experiment_no"],
            "sub_experiment_code": context.get("sub_experiment_code", ""),
            "device_name": context["device_name"],
            "run_status": "实验进行中",
        }

    def mark_run_started(self, run_no, occurred_at):
        self.started.append((run_no, occurred_at))

    def mark_run_ended(self, run_no, occurred_at, axis_code="", next_axis_code="", sub_experiment_code=""):
        self.ended.append((run_no, occurred_at, axis_code, next_axis_code, sub_experiment_code))
        for lab_code, run in list(self.runs_by_lab.items()):
            if run.get("run_no") == run_no:
                self.completed_runs_by_lab[lab_code] = {
                    **run,
                    "run_status": "实验已完成",
                    "ended_at": occurred_at,
                }
                del self.runs_by_lab[lab_code]
                break


def test_process_fixture_ready_records_event_and_returns_ack():
    repository = FakeMqEventRepository()

    ack = process_laboratory_event(
        "mes/v1/labs/salt-spray-lab-01/events/fixture-ready",
        {
            "task_code": "SYLU-2026-03-001",
            "lab_code": "LAB_SALT",
            "subExperimentCode": "SYLU-2026-03-001-A-AXIS-Z",
            "success_id": "PLC-OK-001",
            "fixture_ready_at": "2026-05-16 09:31:00",
        },
        repository=repository,
    )

    assert ack["message_type"] == "EVENT_ACK"
    assert ack["correlation_id"] == "HOST-FIXTURE_READY-LAB_SALT-2026-05-16 09:31:00"
    assert ack["status"] == "PROCESSED"
    assert repository.messages[0]["message_type"] == "FIXTURE_READY"
    assert repository.events == [
        {
            "event_type": "FIXTURE_READY",
            "task_no": "SYLU-2026-03-001",
            "experiment_no": "",
            "sub_experiment_code": "SYLU-2026-03-001-A-AXIS-Z",
            "lab_code": "LAB_SALT",
            "success_id": "PLC-OK-001",
            "event_time": "2026-05-16 09:31:00",
            "message_id": "HOST-FIXTURE_READY-LAB_SALT-2026-05-16 09:31:00",
            "message_log_id": 1,
            "payload": repository.messages[0]["payload"],
        }
    ]


def test_process_fixture_ready_resolves_task_from_lab_code_without_host_task_code():
    repository = FakeMqEventRepository()

    ack = process_laboratory_event(
        "mes/v1/labs/LAB_SALT/events/fixture-ready",
        {
            "lab_code": "LAB_SALT",
            "success_sig": "PLC-OK-001",
            "fixture_ready_at": "2026-05-16 09:31:00",
        },
        repository=repository,
    )

    assert ack["status"] == "PROCESSED"
    assert repository.events[0]["task_no"] == "SYLU-2026-03-001"
    assert repository.events[0]["experiment_no"] == "SYLU-2026-03-001-A"
    assert repository.events[0]["payload"] == {
        "lab_code": "LAB_SALT",
        "success_sig": "PLC-OK-001",
        "fixture_ready_at": "2026-05-16 09:31:00",
    }
    assert repository.events[0]["success_id"] == "PLC-OK-001"


def test_process_fixture_ready_resolves_non_salt_lab_context_without_host_task_code():
    repository = FakeMqEventRepository()

    ack = process_laboratory_event(
        "mes/v1/labs/LAB_IMPACT_1/events/fixture-ready",
        {
            "lab_code": "LAB_IMPACT_1",
            "success_id": "PLC-OK-IMPACT",
            "fixture_ready_at": "2026-06-03 09:31:00",
        },
        repository=repository,
    )

    assert ack["status"] == "PROCESSED"
    assert repository.events[0]["task_no"] == "SYLU-2026-06-002"
    assert repository.events[0]["experiment_no"] == "SYLU-2026-06-002-C"
    assert repository.events[0]["lab_code"] == "LAB_IMPACT_1"
    assert repository.events[0]["payload"] == {
        "lab_code": "LAB_IMPACT_1",
        "success_id": "PLC-OK-IMPACT",
        "fixture_ready_at": "2026-06-03 09:31:00",
    }


def test_process_duplicate_message_returns_ack_without_duplicate_event():
    repository = FakeMqEventRepository(existing_message_ids={"HOST-FIXTURE_READY-LAB_SALT-2026-05-16 09:31:00"})

    ack = process_laboratory_event(
        "mes/v1/labs/salt-spray-lab-01/events/fixture-ready",
        {
            "task_code": "SYLU-2026-03-001",
            "lab_code": "LAB_SALT",
            "success_id": "PLC-OK-001",
            "fixture_ready_at": "2026-05-16 09:31:00",
        },
        repository=repository,
    )

    assert ack["status"] == "DUPLICATE"
    assert repository.messages == []
    assert repository.events == []


def test_process_experiment_started_starts_ready_context_even_when_active_run_exists():
    repository = FakeMqEventRepository()
    repository.runs_by_lab["LAB_SALT"]["run_status"] = "实验进行中"

    ack = process_laboratory_event(
        "mes/v1/labs/salt-spray-lab-01/events/experiment-started",
        {
            "lab_code": "LAB_SALT",
            "started_at": "2026-05-16 10:00:00",
        },
        repository=repository,
    )

    assert ack["status"] == "PROCESSED"
    assert repository.started == []
    assert repository.started_contexts[0][0]["task_no"] == "SYLU-2026-03-001"
    assert repository.started_contexts[0][0]["experiment_no"] == "SYLU-2026-03-001-A"


def test_process_experiment_started_rejects_before_ready_even_when_stale_run_exists():
    repository = FakeMqEventRepository()
    repository.contexts_by_lab = {}
    repository.runs_by_lab = {
        "LAB_IMPACT_1": {
            "run_no": "RUN-STALE",
            "task_no": "SYLU-2026-06-OLD",
            "experiment_no": "SYLU-2026-06-OLD-A",
            "lab_code": "LAB_IMPACT_1",
            "run_status": "实验进行中",
        }
    }

    ack = process_laboratory_event(
        "mes/v1/labs/LAB_IMPACT_1/events/experiment-started",
        {
            "lab_code": "LAB_IMPACT_1",
            "started_at": "2026-06-03 10:00:00",
        },
        repository=repository,
    )

    assert ack["status"] == "REJECTED"
    assert ack["error_code"] == "READY_CONTEXT_REQUIRED"
    assert repository.messages == []
    assert repository.events == []
    assert repository.started == []
    assert repository.started_contexts == []


def test_process_experiment_ended_rejects_old_lab_after_tray_moved_to_next_lab():
    repository = FakeMqEventRepository()
    repository.runs_by_lab = {}

    try:
        process_laboratory_event(
            "mes/v1/labs/LAB_IMPACT_1/events/experiment-ended",
            {
                "lab_code": "LAB_IMPACT_1",
                "ended_at": "2026-06-04 12:50:00",
            },
            repository=repository,
        )
    except ValueError as exc:
        assert "active experiment run is required" in str(exc)
    else:
        raise AssertionError("expected old laboratory experiment-ended event to be rejected")

    assert repository.ended == []
    assert repository.messages == []
    assert repository.events == []


def test_process_experiment_started_ready_context_takes_precedence_over_stale_run():
    repository = FakeMqEventRepository()
    repository.runs_by_lab = {
        "LAB_IMPACT_1": {
            "run_no": "RUN-STALE",
            "task_no": "SYLU-2026-06-OLD",
            "experiment_no": "SYLU-2026-06-OLD-A",
            "lab_code": "LAB_IMPACT_1",
            "run_status": "实验进行中",
        }
    }

    ack = process_laboratory_event(
        "mes/v1/labs/LAB_IMPACT_1/events/experiment-started",
        {
            "lab_code": "LAB_IMPACT_1",
            "started_at": "2026-06-03 10:00:00",
        },
        repository=repository,
    )

    assert ack["status"] == "PROCESSED"
    assert repository.started == []
    assert repository.started_contexts[0][0]["task_no"] == "SYLU-2026-06-002"
    assert repository.started_contexts[0][0]["experiment_no"] == "SYLU-2026-06-002-C"
    assert repository.messages[0]["task_no"] == "SYLU-2026-06-002"
    assert repository.messages[0]["experiment_no"] == "SYLU-2026-06-002-C"


def test_process_experiment_started_rejected_early_event_can_be_retried_after_ready():
    repository = FakeMqEventRepository()
    ready_context = dict(repository.contexts_by_lab["LAB_IMPACT_1"])
    repository.contexts_by_lab = {}
    repository.runs_by_lab = {}
    payload = {
        "message_id": "HOST-START-LAB-IMPACT-001",
        "lab_code": "LAB_IMPACT_1",
        "started_at": "2026-06-03 10:00:00",
    }

    rejected = process_laboratory_event(
        "mes/v1/labs/LAB_IMPACT_1/events/experiment-started",
        payload,
        repository=repository,
    )
    repository.contexts_by_lab = {"LAB_IMPACT_1": ready_context}
    processed = process_laboratory_event(
        "mes/v1/labs/LAB_IMPACT_1/events/experiment-started",
        payload,
        repository=repository,
    )

    assert rejected["status"] == "REJECTED"
    assert rejected["error_code"] == "READY_CONTEXT_REQUIRED"
    assert processed["status"] == "PROCESSED"
    assert repository.messages[0]["message_id"] == "HOST-START-LAB-IMPACT-001"
    assert len(repository.messages) == 1
    assert repository.started_contexts[0][0]["task_no"] == "SYLU-2026-06-002"


def test_process_experiment_started_creates_run_from_ready_lab_context_when_no_active_run():
    repository = FakeMqEventRepository()
    repository.runs_by_lab = {}
    repository.contexts_by_lab["LAB_SALT"]["sub_experiment_code"] = "SYLU-2026-03-001-A-AXIS-X"

    ack = process_laboratory_event(
        "mes/v1/labs/LAB_SALT/events/experiment-started",
        {
            "lab_code": "LAB_SALT",
            "started_at": "2026-05-16 10:00:00",
        },
        repository=repository,
    )

    assert ack["status"] == "PROCESSED"
    assert repository.started == []
    assert repository.started_contexts == [
        (
            {
                "task_no": "SYLU-2026-03-001",
                "experiment_no": "SYLU-2026-03-001-A",
                "schedule_no": "schedule-salt",
                "sub_experiment_code": "SYLU-2026-03-001-A-AXIS-X",
                "device_name": "盐雾试验室",
                "planned_hours": 3.5,
                "tray_nos": ["SYLU-2026-03-001-TP-001"],
                "sample_nos": ["SYLU-2026-03-001-SP-001"],
                "candidate_statuses": ["实验准备就绪"],
            },
            "2026-05-16 10:00:00",
        )
    ]
    assert repository.messages[0]["task_no"] == "SYLU-2026-03-001"
    assert repository.messages[0]["experiment_no"] == "SYLU-2026-03-001-A"
    assert repository.messages[0]["sub_experiment_code"] == "SYLU-2026-03-001-A-AXIS-X"
    assert repository.events[0]["event_type"] == "EXPERIMENT_STARTED"
    assert repository.events[0]["sub_experiment_code"] == "SYLU-2026-03-001-A-AXIS-X"


def test_process_experiment_started_uses_payload_run_no_for_created_run():
    repository = FakeMqEventRepository()
    repository.runs_by_lab = {}

    ack = process_laboratory_event(
        "mes/v1/labs/LAB_SALT/events/experiment-started",
        {
            "lab_code": "LAB_SALT",
            "run_no": "RUN-READY-001",
            "started_at": "2026-05-16 10:00:00",
        },
        repository=repository,
    )

    assert ack["status"] == "PROCESSED"
    assert repository.events[0]["run_no"] == "RUN-READY-001"
    assert repository.messages[0]["task_no"] == "SYLU-2026-03-001"
    assert repository.messages[0]["experiment_no"] == "SYLU-2026-03-001-A"


def test_process_experiment_started_creates_run_from_non_salt_ready_context():
    repository = FakeMqEventRepository()
    repository.runs_by_lab = {}

    ack = process_laboratory_event(
        "mes/v1/labs/LAB_IMPACT_1/events/experiment-started",
        {
            "lab_code": "LAB_IMPACT_1",
            "started_at": "2026-06-03 10:00:00",
        },
        repository=repository,
    )

    assert ack["status"] == "PROCESSED"
    assert repository.started == []
    assert repository.started_contexts == [
        (
            {
                "task_no": "SYLU-2026-06-002",
                "experiment_no": "SYLU-2026-06-002-C",
                "schedule_no": "schedule-impact",
                "device_name": "冲击一室",
                "planned_hours": 3.5,
                "tray_nos": ["SYLU-2026-06-002-TP-002"],
                "sample_nos": ["SYLU-2026-06-002-SP-005", "SYLU-2026-06-002-SP-006"],
                "candidate_statuses": ["实验准备就绪"],
            },
            "2026-06-03 10:00:00",
        )
    ]
    assert repository.messages[0]["lab_code"] == "LAB_IMPACT_1"
    assert repository.messages[0]["task_no"] == "SYLU-2026-06-002"
    assert repository.messages[0]["experiment_no"] == "SYLU-2026-06-002-C"
    assert repository.events[0]["event_type"] == "EXPERIMENT_STARTED"


def test_process_experiment_started_prefers_ready_context_over_payload_experiment_code():
    repository = FakeMqEventRepository()
    repository.runs_by_lab = {}

    ack = process_laboratory_event(
        "mes/v1/labs/LAB_IMPACT_1/events/experiment-started",
        {
            "lab_code": "LAB_IMPACT_1",
            "task_code": "SYLU-2026-06-OLD",
            "experiment_code": "SYLU-2026-06-002-OLD",
            "started_at": "2026-06-03 10:00:00",
        },
        repository=repository,
    )

    assert ack["status"] == "PROCESSED"
    assert repository.started_contexts[0][0]["task_no"] == "SYLU-2026-06-002"
    assert repository.started_contexts[0][0]["experiment_no"] == "SYLU-2026-06-002-C"
    assert repository.messages[0]["task_no"] == "SYLU-2026-06-002"
    assert repository.messages[0]["experiment_no"] == "SYLU-2026-06-002-C"
    assert repository.events[0]["task_no"] == "SYLU-2026-06-002"
    assert repository.events[0]["experiment_no"] == "SYLU-2026-06-002-C"


def test_mysql_start_run_for_context_uses_mock_start_rules(monkeypatch):
    class FakeStorage:
        def __init__(self):
            self.writes = []
            self.payload = {
                "mes.tasks": [{"id": "TASK-001", "code": "TASK-001", "status": "已入库"}],
                "mes.samples": [
                    {
                        "code": "SAMPLE-001",
                        "task_code": "TASK-001",
                        "status": "实验准备就绪",
                        "flow_status": "实验准备就绪",
                        "location": "盐雾试验室",
                        "trays": [
                            {
                                "tray_code": "TRAY-001",
                                "status": "实验准备就绪",
                                "target_lab": "盐雾试验室",
                                "target_experiment_code": "EXP-001",
                            }
                        ],
                        "history": [],
                    }
                ],
                "mes.experiments": [
                    {
                        "task_code": "TASK-001",
                        "experiment_code": "EXP-001",
                        "experiment_name": "盐雾试验",
                        "status": "实验准备就绪",
                    }
                ],
                "mes.schedules": [
                    {
                        "id": "schedule-salt",
                        "task_code": "TASK-001",
                        "experiment_code": "EXP-001",
                        "device": "盐雾试验室",
                        "status": "实验准备就绪",
                    }
                ],
                "mes.experiment_runs": [],
                "mes.experiment_run_trays": [],
                "mes.experiment_trays": [
                    {
                        "task_code": "TASK-001",
                        "experiment_code": "EXP-001",
                        "tray_code": "TRAY-001",
                    }
                ],
                "mes.experiment_samples": [
                    {"task_code": "TASK-001", "experiment_code": "EXP-001", "sample_code": "SAMPLE-001"}
                ],
            }

        def read_all(self):
            return self.payload

        def write_many(self, updates):
            self.writes.append(updates)
            self.payload.update(updates)

    storage = FakeStorage()
    monkeypatch.setattr("app.services.mq_event_processor.get_storage_backend", lambda: storage)
    monkeypatch.setattr(
        "app.services.mq_event_processor.get_connection",
        lambda: (_ for _ in ()).throw(AssertionError("MQTT started should use shared start storage adapter")),
    )

    run = MySQLMqEventRepository().start_run_for_context(
        {
            "task_no": "TASK-001",
            "experiment_no": "EXP-001",
            "sub_experiment_code": "EXP-001-AXIS-X",
            "schedule_no": "schedule-salt",
            "device_name": "盐雾试验室",
            "planned_hours": 3.5,
            "schedule_end_time": "2026-05-16 11:00:00",
            "tray_nos": ["TRAY-001"],
            "sample_nos": ["SAMPLE-001"],
        },
        "2026-05-16 10:00:00",
    )

    written = storage.writes[-1]
    started_tray = written["mes.samples"][0]["trays"][0]
    assert run["run_status"] == "实验进行中"
    assert run["run_no"]
    assert written["mes.tasks"][0]["status"] == "任务进行中"
    assert written["mes.experiments"][0]["status"] == "实验进行中"
    assert written["mes.schedules"][0]["status"] == "实验进行中"
    assert written["mes.samples"][0]["status"] == "实验进行中"
    assert started_tray["status"] == "实验进行中"
    assert "target_lab" not in started_tray
    assert "target_experiment_code" not in started_tray
    assert written["mes.samples"][0]["history"][0]["detail"] == "TASK-001 / 盐雾试验 / 实验进行中 / 托盘：TRAY-001"
    assert written["mes.experiment_runs"][0]["run_no"] == run["run_no"]
    assert written["mes.experiment_runs"][0]["sub_experiment_code"] == "EXP-001-AXIS-X"
    assert written["mes.experiment_runs"][0]["planned_end_at"] == "2026-05-16 13:30:00"
    assert written["mes.experiment_run_trays"][0]["run_no"] == run["run_no"]
    assert written["mes.experiment_run_trays"][0]["sub_experiment_code"] == "EXP-001-AXIS-X"


def test_mysql_start_run_for_context_rejects_returned_trays_with_mock_start_rules(monkeypatch):
    class FakeStorage:
        def __init__(self):
            self.writes = []
            self.payload = {
                "mes.tasks": [{"id": "TASK-001", "code": "TASK-001", "status": "任务进行中"}],
                "mes.samples": [
                    {
                        "code": "SAMPLE-001",
                        "task_code": "TASK-001",
                        "status": "厂家收回",
                        "flow_status": "厂家收回",
                        "location": "厂家收回",
                        "trays": [{"tray_code": "TRAY-001", "status": "厂家收回"}],
                        "history": [],
                    }
                ],
                "mes.experiments": [
                    {
                        "task_code": "TASK-001",
                        "experiment_code": "EXP-001",
                        "experiment_name": "温度冲击试验",
                        "status": "已排程",
                    }
                ],
                "mes.schedules": [
                    {
                        "id": "schedule-temp",
                        "task_code": "TASK-001",
                        "experiment_code": "EXP-001",
                        "device": "温度冲击二室",
                        "status": "已排程",
                    }
                ],
                "mes.experiment_runs": [],
                "mes.experiment_run_trays": [
                    {
                        "run_no": "RETURNED-EXP-001",
                        "task_code": "TASK-001",
                        "experiment_code": "EXP-001",
                        "tray_code": "TRAY-001",
                        "run_tray_status": "厂家收回",
                    }
                ],
                "mes.experiment_trays": [
                    {
                        "task_code": "TASK-001",
                        "experiment_code": "EXP-001",
                        "tray_code": "TRAY-001",
                    }
                ],
                "mes.experiment_samples": [
                    {"task_code": "TASK-001", "experiment_code": "EXP-001", "sample_code": "SAMPLE-001"}
                ],
            }

        def read_all(self):
            return self.payload

        def write_many(self, updates):
            self.writes.append(updates)
            self.payload.update(updates)

    storage = FakeStorage()
    monkeypatch.setattr("app.services.mq_event_processor.get_storage_backend", lambda: storage)
    monkeypatch.setattr(
        "app.services.mq_event_processor.get_connection",
        lambda: (_ for _ in ()).throw(AssertionError("MQTT started should use shared start storage adapter")),
    )

    with pytest.raises(ValueError, match="current experiment has no matching active tray samples"):
        MySQLMqEventRepository().start_run_for_context(
            {
                "task_no": "TASK-001",
                "experiment_no": "EXP-001",
                "schedule_no": "schedule-temp",
                "device_name": "温度冲击二室",
                "tray_nos": ["TRAY-001"],
                "sample_nos": ["SAMPLE-001"],
            },
            "2026-06-06 12:59:00",
        )

    assert storage.writes == []


def test_mysql_start_run_for_context_rejects_tray_status_returned_without_run_tray_record(monkeypatch):
    class FakeStorage:
        def __init__(self):
            self.writes = []
            self.payload = {
                "mes.tasks": [{"id": "TASK-001", "code": "TASK-001", "status": "任务进行中"}],
                "mes.samples": [
                    {
                        "code": "SAMPLE-001",
                        "task_code": "TASK-001",
                        "status": "厂家收回",
                        "flow_status": "厂家收回",
                        "location": "厂家收回",
                        "trays": [{"tray_code": "TRAY-001", "status": "厂家收回"}],
                        "history": [],
                    }
                ],
                "mes.experiments": [
                    {
                        "task_code": "TASK-001",
                        "experiment_code": "EXP-001",
                        "experiment_name": "温度冲击试验",
                        "status": "已排程",
                    }
                ],
                "mes.schedules": [
                    {
                        "id": "schedule-temp",
                        "task_code": "TASK-001",
                        "experiment_code": "EXP-001",
                        "device": "温度冲击二室",
                        "status": "已排程",
                    }
                ],
                "mes.experiment_runs": [],
                "mes.experiment_run_trays": [],
                "mes.experiment_trays": [
                    {
                        "task_code": "TASK-001",
                        "experiment_code": "EXP-001",
                        "tray_code": "TRAY-001",
                    }
                ],
                "mes.experiment_samples": [
                    {"task_code": "TASK-001", "experiment_code": "EXP-001", "sample_code": "SAMPLE-001"}
                ],
            }

        def read_all(self):
            return self.payload

        def write_many(self, updates):
            self.writes.append(updates)
            self.payload.update(updates)

    storage = FakeStorage()
    monkeypatch.setattr("app.services.mq_event_processor.get_storage_backend", lambda: storage)
    monkeypatch.setattr(
        "app.services.mq_event_processor.get_connection",
        lambda: (_ for _ in ()).throw(AssertionError("MQTT started should use shared start storage adapter")),
    )

    with pytest.raises(ValueError, match="current experiment has no matching active tray samples"):
        MySQLMqEventRepository().start_run_for_context(
            {
                "task_no": "TASK-001",
                "experiment_no": "EXP-001",
                "schedule_no": "schedule-temp",
                "device_name": "温度冲击二室",
                "tray_nos": ["TRAY-001"],
                "sample_nos": ["SAMPLE-001"],
            },
            "2026-06-06 12:59:00",
        )

    assert storage.writes == []


def test_mysql_start_run_for_context_ignores_returned_sample_from_other_experiment(monkeypatch):
    class FakeStorage:
        def __init__(self):
            self.writes = []
            self.payload = {
                "mes.tasks": [{"id": "TASK-001", "code": "TASK-001", "status": "任务进行中"}],
                "mes.samples": [
                    {
                        "code": "SAMPLE-OLD",
                        "task_code": "TASK-001",
                        "status": "厂家收回",
                        "flow_status": "厂家收回",
                        "location": "厂家收回",
                        "trays": [{"tray_code": "TRAY-001", "status": "厂家收回"}],
                        "history": [],
                    },
                    {
                        "code": "SAMPLE-CURRENT",
                        "task_code": "TASK-001",
                        "status": "实验准备就绪",
                        "flow_status": "实验准备就绪",
                        "location": "温度冲击二室",
                        "trays": [
                            {
                                "tray_code": "TRAY-001",
                                "status": "实验准备就绪",
                                "target_experiment_code": "EXP-001",
                            }
                        ],
                        "history": [],
                    },
                ],
                "mes.experiments": [
                    {
                        "task_code": "TASK-001",
                        "experiment_code": "EXP-001",
                        "experiment_name": "温度冲击试验",
                        "status": "实验准备就绪",
                    }
                ],
                "mes.schedules": [
                    {
                        "id": "schedule-temp",
                        "task_code": "TASK-001",
                        "experiment_code": "EXP-001",
                        "device": "温度冲击二室",
                        "status": "实验准备就绪",
                    }
                ],
                "mes.experiment_runs": [],
                "mes.experiment_run_trays": [],
                "mes.experiment_trays": [
                    {"task_code": "TASK-001", "experiment_code": "EXP-OLD", "tray_code": "TRAY-001"},
                    {"task_code": "TASK-001", "experiment_code": "EXP-001", "tray_code": "TRAY-001"},
                ],
                "mes.experiment_samples": [
                    {"task_code": "TASK-001", "experiment_code": "EXP-OLD", "sample_code": "SAMPLE-OLD"},
                    {"task_code": "TASK-001", "experiment_code": "EXP-001", "sample_code": "SAMPLE-CURRENT"},
                ],
            }

        def read_all(self):
            return self.payload

        def write_many(self, updates):
            self.writes.append(updates)
            self.payload.update(updates)

    storage = FakeStorage()
    monkeypatch.setattr("app.services.mq_event_processor.get_storage_backend", lambda: storage)
    monkeypatch.setattr(
        "app.services.mq_event_processor.get_connection",
        lambda: (_ for _ in ()).throw(AssertionError("MQTT started should use shared start storage adapter")),
    )

    MySQLMqEventRepository().start_run_for_context(
        {
            "task_no": "TASK-001",
            "experiment_no": "EXP-001",
            "schedule_no": "schedule-temp",
            "device_name": "温度冲击二室",
            "tray_nos": ["TRAY-001"],
            "sample_nos": ["SAMPLE-CURRENT"],
        },
        "2026-06-06 13:10:00",
    )

    written_samples = {sample["code"]: sample for sample in storage.writes[-1]["mes.samples"]}
    assert written_samples["SAMPLE-OLD"]["status"] == "厂家收回"
    assert written_samples["SAMPLE-OLD"]["trays"][0]["status"] == "厂家收回"
    assert written_samples["SAMPLE-CURRENT"]["status"] == "实验进行中"
    assert written_samples["SAMPLE-CURRENT"]["trays"][0]["status"] == "实验进行中"


def test_mysql_find_active_run_by_lab_matches_tray_lab_code_when_device_name_differs(monkeypatch):
    class TupleCursor:
        description = None

        def __init__(self):
            self.matching_active_run_query = False
            self.params = []

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def execute(self, sql, params=None):
            self.params.append(params)
            self.matching_active_run_query = False
            if "FROM md_lab" in sql:
                self.description = (("lab_name",),)
            elif "JOIN biz_experiment_run_tray" in sql and "lab.lab_code = %s" in sql:
                self.description = (("run_no",), ("task_no",), ("experiment_no",), ("device_name",), ("run_status",))
                self.matching_active_run_query = True
            else:
                self.description = None

        def fetchone(self):
            columns = [column[0] for column in (self.description or [])]
            if columns == ["lab_name"]:
                return ("Salt Spray Lab",)
            if self.matching_active_run_query and columns == ["run_no", "task_no", "experiment_no", "device_name", "run_status"]:
                return ("RUN-SALT-001", "SYLU-2026-03-001", "SYLU-2026-03-001-A", "盐雾试验室", "实验进行中")
            return None

    class TupleConnection:
        def __init__(self):
            self.cursor_obj = TupleCursor()

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def cursor(self):
            return self.cursor_obj

    connection = TupleConnection()
    monkeypatch.setattr("app.services.mq_event_processor.get_connection", lambda: connection)

    run = MySQLMqEventRepository().find_active_run_by_lab("LAB_SALT")

    assert run == {
        "run_no": "RUN-SALT-001",
        "task_no": "SYLU-2026-03-001",
        "experiment_no": "SYLU-2026-03-001-A",
        "device_name": "盐雾试验室",
        "run_status": "实验进行中",
    }
    assert any(params and params[-1] == "LAB_SALT" for params in connection.cursor_obj.params)


def test_mysql_find_active_run_by_lab_prioritizes_running_runs_in_query(monkeypatch):
    class TupleCursor:
        description = None

        def __init__(self):
            self.active_run_sql = ""

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def execute(self, sql, params=None):
            if "JOIN biz_experiment_run_tray" in sql and "lab.lab_code = %s" in sql:
                self.active_run_sql = " ".join(sql.split())
                self.description = (("run_no",), ("task_no",), ("experiment_no",), ("device_name",), ("run_status",))
            else:
                self.description = None

        def fetchone(self):
            return None

    class TupleConnection:
        def __init__(self):
            self.cursor_obj = TupleCursor()

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def cursor(self):
            return self.cursor_obj

    connection = TupleConnection()
    monkeypatch.setattr("app.services.mq_event_processor.get_connection", lambda: connection)

    MySQLMqEventRepository().find_active_run_by_lab("LAB_SALT")

    assert "CASE WHEN er.run_status = '实验进行中' THEN 0 ELSE 1 END" in connection.cursor_obj.active_run_sql
    assert connection.cursor_obj.active_run_sql.index("CASE WHEN er.run_status") < connection.cursor_obj.active_run_sql.index("er.started_at DESC")


def test_mysql_find_run_by_no_uses_exact_run_no(monkeypatch):
    class TupleCursor:
        description = None

        def __init__(self):
            self.query_sql = ""
            self.query_params = None

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def execute(self, sql, params=None):
            self.query_sql = " ".join(sql.split())
            self.query_params = tuple(params or ())
            self.description = (
                ("run_no",),
                ("task_no",),
                ("experiment_no",),
                ("device_name",),
                ("run_status",),
            )

        def fetchone(self):
            return (
                "RUN-001",
                "SYLU-2026-06-022",
                "SYLU-2026-06-022-A",
                "冲击一室",
                "实验已完成",
            )

    class TupleConnection:
        def __init__(self):
            self.cursor_obj = TupleCursor()

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def cursor(self):
            return self.cursor_obj

    connection = TupleConnection()
    monkeypatch.setattr("app.services.mq_event_processor.get_connection", lambda: connection)

    run = MySQLMqEventRepository().find_run_by_no("RUN-001")

    assert "FROM biz_experiment_run er" in connection.cursor_obj.query_sql
    assert "WHERE er.run_no = %s" in connection.cursor_obj.query_sql
    assert connection.cursor_obj.query_params == ("RUN-001",)
    assert run == {
        "run_no": "RUN-001",
        "task_no": "SYLU-2026-06-022",
        "experiment_no": "SYLU-2026-06-022-A",
        "device_name": "冲击一室",
        "run_status": "实验已完成",
    }


def test_mysql_find_current_context_filters_schedules_to_current_lab(monkeypatch):
    class TupleCursor:
        description = None

        def __init__(self):
            self.schedule_query_params = None
            self.schedule_query_sql = ""

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def execute(self, sql, params=None):
            if "FROM md_lab" in sql:
                self.description = (("lab_name",),)
            elif "FROM biz_mq_message_log" in sql:
                self.description = (("task_no",), ("experiment_no",), ("payload_json",))
            elif "FROM biz_tray tr" in sql:
                self.description = (("tray_no",), ("sample_no",), ("location_desc",), ("current_lab_id",))
            elif "FROM biz_schedule s" in sql:
                self.schedule_query_sql = " ".join(sql.split())
                self.description = (
                    ("schedule_no",),
                    ("task_no",),
                    ("experiment_no",),
                    ("device_name",),
                    ("planned_hours",),
                    ("schedule_end_time",),
                    ("scoped_tray_no",),
                )
                self.schedule_query_params = list(params or [])
            else:
                self.description = None

        def fetchone(self):
            columns = [column[0] for column in (self.description or [])]
            if columns == ["lab_name"]:
                return ("冲击一室",)
            return None

        def fetchall(self):
            columns = [column[0] for column in (self.description or [])]
            if columns == ["task_no", "experiment_no", "payload_json"]:
                return [("SYLU-2026-06-002", "", "{}")]
            if columns == ["tray_no", "sample_no", "location_desc", "current_lab_id"]:
                return [
                    ("SYLU-2026-06-002-TP-002", "SYLU-2026-06-002-SP-005", "冲击一室", 4),
                    ("SYLU-2026-06-002-TP-002", "SYLU-2026-06-002-SP-006", "冲击一室", 4),
                ]
            if columns == ["schedule_no", "task_no", "experiment_no", "device_name", "planned_hours", "schedule_end_time", "scoped_tray_no"]:
                if (
                    self.schedule_query_params
                    and "LAB_IMPACT_1" in self.schedule_query_params
                    and "schedule_lab.lab_code = %s" in self.schedule_query_sql
                ):
                    return [
                        (
                            "schedule-impact",
                            "SYLU-2026-06-002",
                            "SYLU-2026-06-002-C",
                            "冲击一室",
                            3.5,
                            "2026-06-03 15:30:00",
                            "SYLU-2026-06-002-TP-002",
                        )
                    ]
                return [
                    (
                        "schedule-salt",
                        "SYLU-2026-06-002",
                        "SYLU-2026-06-002-B",
                        "盐雾试验室",
                        3.5,
                        "2026-06-03 11:30:00",
                        "SYLU-2026-06-002-TP-002",
                    ),
                    (
                        "schedule-impact",
                        "SYLU-2026-06-002",
                        "SYLU-2026-06-002-C",
                        "冲击一室",
                        3.5,
                        "2026-06-03 15:30:00",
                        "SYLU-2026-06-002-TP-002",
                    ),
                ]
            return []

    class TupleConnection:
        def __init__(self):
            self.cursor_obj = TupleCursor()

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def cursor(self):
            return self.cursor_obj

    connection = TupleConnection()
    monkeypatch.setattr("app.services.mq_event_processor.get_connection", lambda: connection)

    context = MySQLMqEventRepository().find_current_context_by_lab("LAB_IMPACT_1", ["工装夹具安装"])

    assert "LEFT JOIN md_lab schedule_lab ON schedule_lab.lab_id = s.lab_id" in connection.cursor_obj.schedule_query_sql
    assert "schedule_lab.lab_code = %s" in connection.cursor_obj.schedule_query_sql
    assert "s.device_name IN" not in connection.cursor_obj.schedule_query_sql
    assert context == {
        "task_no": "SYLU-2026-06-002",
        "experiment_no": "SYLU-2026-06-002-C",
        "schedule_no": "schedule-impact",
        "device_name": "冲击一室",
        "planned_hours": 3.5,
        "schedule_end_time": "2026-06-03 15:30:00",
        "tray_nos": ["SYLU-2026-06-002-TP-002"],
        "sample_nos": ["SYLU-2026-06-002-SP-005", "SYLU-2026-06-002-SP-006"],
    }


def test_mysql_find_current_context_uses_schedule_lab_code_when_master_lab_name_differs_from_schedule_device(monkeypatch):
    class TupleCursor:
        description = None

        def __init__(self):
            self.schedule_query_params = None
            self.schedule_query_sql = ""

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def execute(self, sql, params=None):
            if "FROM md_lab" in sql:
                self.description = (("lab_name",),)
            elif "FROM biz_mq_message_log" in sql:
                self.description = (("task_no",), ("experiment_no",), ("payload_json",))
            elif "FROM biz_tray tr" in sql:
                self.description = (("tray_no",), ("sample_no",), ("location_desc",), ("current_lab_id",))
            elif "FROM biz_schedule s" in sql:
                self.schedule_query_sql = " ".join(sql.split())
                self.description = (
                    ("schedule_no",),
                    ("task_no",),
                    ("experiment_no",),
                    ("device_name",),
                    ("planned_hours",),
                    ("schedule_end_time",),
                    ("scoped_tray_no",),
                )
                self.schedule_query_params = list(params or [])
            else:
                self.description = None

        def fetchone(self):
            columns = [column[0] for column in (self.description or [])]
            if columns == ["lab_name"]:
                return ("Salt Spray Lab",)
            return None

        def fetchall(self):
            columns = [column[0] for column in (self.description or [])]
            if columns == ["task_no", "experiment_no", "payload_json"]:
                return [("SYLU-2026-06-001", "SYLU-2026-06-001-A", "{}")]
            if columns == ["tray_no", "sample_no", "location_desc", "current_lab_id"]:
                return [
                    ("SYLU-2026-06-001-TP-001", "SYLU-2026-06-001-SP-001", "盐雾试验室", 3),
                    ("SYLU-2026-06-001-TP-001", "SYLU-2026-06-001-SP-002", "盐雾试验室", 3),
                ]
            if columns == ["schedule_no", "task_no", "experiment_no", "device_name", "planned_hours", "schedule_end_time", "scoped_tray_no"]:
                if (
                    self.schedule_query_params
                    and "LAB_SALT" in self.schedule_query_params
                    and "schedule_lab.lab_code = %s" in self.schedule_query_sql
                ):
                    return [
                        (
                            "schedule-salt",
                            "SYLU-2026-06-001",
                            "SYLU-2026-06-001-A",
                            "盐雾试验室",
                            3.5,
                            "2026-06-07 11:30:00",
                            "SYLU-2026-06-001-TP-001",
                        )
                    ]
                return []
            return []

    class TupleConnection:
        def __init__(self):
            self.cursor_obj = TupleCursor()

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def cursor(self):
            return self.cursor_obj

    connection = TupleConnection()
    monkeypatch.setattr("app.services.mq_event_processor.get_connection", lambda: connection)

    context = MySQLMqEventRepository().find_current_context_by_lab("LAB_SALT", ["工装夹具安装"])

    assert "LEFT JOIN md_lab schedule_lab ON schedule_lab.lab_id = s.lab_id" in connection.cursor_obj.schedule_query_sql
    assert "schedule_lab.lab_code = %s" in connection.cursor_obj.schedule_query_sql
    assert "s.device_name IN" not in connection.cursor_obj.schedule_query_sql
    assert context == {
        "task_no": "SYLU-2026-06-001",
        "experiment_no": "SYLU-2026-06-001-A",
        "schedule_no": "schedule-salt",
        "device_name": "盐雾试验室",
        "planned_hours": 3.5,
        "schedule_end_time": "2026-06-07 11:30:00",
        "tray_nos": ["SYLU-2026-06-001-TP-001"],
        "sample_nos": ["SYLU-2026-06-001-SP-001", "SYLU-2026-06-001-SP-002"],
    }


def test_mysql_find_current_context_does_not_use_moved_sample_location_as_device_candidate(monkeypatch):
    class TupleCursor:
        description = None

        def __init__(self):
            self.schedule_query_params = None
            self.schedule_query_sql = ""

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def execute(self, sql, params=None):
            if "FROM md_lab" in sql:
                self.description = (("lab_name",),)
            elif "FROM biz_mq_message_log" in sql:
                self.description = (("task_no",), ("experiment_no",), ("payload_json",))
            elif "FROM biz_tray tr" in sql:
                self.description = (("tray_no",), ("sample_no",), ("location_desc",), ("current_lab_id",))
            elif "FROM biz_schedule s" in sql:
                self.schedule_query_sql = " ".join(sql.split())
                self.description = (
                    ("schedule_no",),
                    ("task_no",),
                    ("experiment_no",),
                    ("device_name",),
                    ("planned_hours",),
                    ("schedule_end_time",),
                    ("scoped_tray_no",),
                )
                self.schedule_query_params = list(params or [])
            else:
                self.description = None

        def fetchone(self):
            columns = [column[0] for column in (self.description or [])]
            if columns == ["lab_name"]:
                return ("冲击一室",)
            return None

        def fetchall(self):
            columns = [column[0] for column in (self.description or [])]
            if columns == ["task_no", "experiment_no", "payload_json"]:
                return [("TASK-SHARED", "", "{}")]
            if columns == ["tray_no", "sample_no", "location_desc", "current_lab_id"]:
                return [("TP-SHARED", "SP-SHARED", "温度冲击一室", 4)]
            if columns == ["schedule_no", "task_no", "experiment_no", "device_name", "planned_hours", "schedule_end_time", "scoped_tray_no"]:
                if self.schedule_query_params and "温度冲击一室" in self.schedule_query_params:
                    return [
                        (
                            "schedule-temp",
                            "TASK-SHARED",
                            "EXP-TEMP",
                            "温度冲击一室",
                            3.5,
                            "2026-06-04 16:00:00",
                            "TP-SHARED",
                        )
                    ]
                return []
            return []

    class TupleConnection:
        def __init__(self):
            self.cursor_obj = TupleCursor()

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def cursor(self):
            return self.cursor_obj

    connection = TupleConnection()
    monkeypatch.setattr("app.services.mq_event_processor.get_connection", lambda: connection)

    context = MySQLMqEventRepository().find_current_context_by_lab("LAB_IMPACT_1", ["实验准备就绪"])

    assert context is None
    assert "schedule_lab.lab_code = %s" in connection.cursor_obj.schedule_query_sql
    assert "s.device_name IN" not in connection.cursor_obj.schedule_query_sql
    assert "温度冲击一室" not in connection.cursor_obj.schedule_query_params


def test_mysql_find_current_context_does_not_fallback_to_sample_status_when_tray_status_is_empty(monkeypatch):
    class TupleCursor:
        description = None

        def __init__(self):
            self.tray_query = ""

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def execute(self, sql, params=None):
            if "FROM md_lab" in sql:
                self.description = (("lab_name",),)
            elif "FROM biz_mq_message_log" in sql:
                self.description = (("task_no",), ("experiment_no",), ("payload_json",))
            elif "FROM biz_tray tr" in sql:
                self.tray_query = " ".join(sql.split())
                self.description = (("tray_no",), ("sample_no",), ("location_desc",), ("current_lab_id",))
            elif "FROM biz_schedule s" in sql:
                self.description = (
                    ("schedule_no",),
                    ("task_no",),
                    ("experiment_no",),
                    ("device_name",),
                    ("planned_hours",),
                    ("schedule_end_time",),
                    ("scoped_tray_no",),
                )
            else:
                self.description = None

        def fetchone(self):
            columns = [column[0] for column in (self.description or [])]
            if columns == ["lab_name"]:
                return ("冲击一室",)
            return None

        def fetchall(self):
            columns = [column[0] for column in (self.description or [])]
            if columns == ["task_no", "experiment_no", "payload_json"]:
                return [("TASK-SHARED", "EXP-IMPACT", "{}")]
            return []

    class TupleConnection:
        def __init__(self):
            self.cursor_obj = TupleCursor()

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def cursor(self):
            return self.cursor_obj

    connection = TupleConnection()
    monkeypatch.setattr("app.services.mq_event_processor.get_connection", lambda: connection)

    context = MySQLMqEventRepository().find_current_context_by_lab("LAB_IMPACT_1", ["实验准备就绪"])

    assert context is None
    assert "COALESCE(ti.status, '') = ''" not in connection.cursor_obj.tray_query
    assert "COALESCE(tr.test_state, '') = ''" not in connection.cursor_obj.tray_query
    assert "sm.sample_status IN" not in connection.cursor_obj.tray_query
    assert "sm.flow_status IN" not in connection.cursor_obj.tray_query


def test_mysql_find_current_context_rejects_old_lab_after_tray_moved_to_next_lab(monkeypatch):
    class TupleCursor:
        description = None

        def __init__(self):
            self.schedule_query_executed = False

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def execute(self, sql, params=None):
            if "FROM md_lab" in sql:
                self.description = (("lab_name",),)
            elif "FROM biz_mq_message_log" in sql:
                self.description = (("task_no",), ("experiment_no",), ("payload_json",))
            elif "FROM biz_tray tr" in sql:
                self.description = (("tray_no",), ("sample_no",), ("location_desc",), ("current_lab_id",))
            elif "FROM biz_schedule s" in sql:
                self.schedule_query_executed = True
                self.description = (
                    ("schedule_no",),
                    ("task_no",),
                    ("experiment_no",),
                    ("device_name",),
                    ("planned_hours",),
                    ("schedule_end_time",),
                    ("scoped_tray_no",),
                )
            else:
                self.description = None

        def fetchone(self):
            columns = [column[0] for column in (self.description or [])]
            if columns == ["lab_name"]:
                return ("冲击一室",)
            return None

        def fetchall(self):
            columns = [column[0] for column in (self.description or [])]
            if columns == ["task_no", "experiment_no", "payload_json"]:
                return [("TASK-SHARED", "EXP-IMPACT", "{}")]
            if columns == ["tray_no", "sample_no", "location_desc", "current_lab_id"]:
                return []
            return []

    class TupleConnection:
        def __init__(self):
            self.cursor_obj = TupleCursor()

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def cursor(self):
            return self.cursor_obj

    connection = TupleConnection()
    monkeypatch.setattr("app.services.mq_event_processor.get_connection", lambda: connection)

    context = MySQLMqEventRepository().find_current_context_by_lab("LAB_IMPACT_1", ["实验准备就绪"])

    assert context is None
    assert connection.cursor_obj.schedule_query_executed is False


def test_mysql_mark_run_ended_keeps_mock_completion_history_idempotent(monkeypatch):
    completion_detail = "TASK-001 / 振动实验 / 实验已完成"

    class FakeStorage:
        def __init__(self):
            self.writes = []
            self.payload = {
                "mes.tasks": [{"id": "TASK-001", "code": "TASK-001", "status": "任务进行中"}],
                "mes.samples": [
                    {
                        "code": "SAMPLE-001",
                        "task_code": "TASK-001",
                        "status": "实验进行中",
                        "flow_status": "实验进行中",
                        "location": "振动一室",
                        "owner": "测试员",
                        "trays": [{"tray_code": "TRAY-001", "status": "实验进行中"}],
                        "history": [
                            {
                                "action": "实验完成",
                                "detail": completion_detail,
                                "location": "振动一室",
                                "owner": "测试员",
                                "status": "实验已完成",
                                "time": "2026-05-16 12:00:00",
                            }
                        ],
                    }
                ],
                "mes.experiments": [
                    {
                        "task_code": "TASK-001",
                        "experiment_code": "EXP-001",
                        "experiment_name": "振动实验",
                        "status": "实验进行中",
                    }
                ],
                "mes.schedules": [
                    {
                        "task_code": "TASK-001",
                        "experiment_code": "EXP-001",
                        "status": "实验进行中",
                    }
                ],
                "mes.experiment_runs": [
                    {
                        "run_no": "RUN-001",
                        "task_code": "TASK-001",
                        "experiment_code": "EXP-001",
                        "status": "实验进行中",
                        "tray_codes": ["TRAY-001"],
                    }
                ],
                "mes.experiment_run_trays": [
                    {
                        "run_no": "RUN-001",
                        "task_code": "TASK-001",
                        "experiment_code": "EXP-001",
                        "tray_code": "TRAY-001",
                        "status": "实验进行中",
                        "run_tray_status": "实验进行中",
                    }
                ],
                "mes.experiment_trays": [
                    {
                        "task_code": "TASK-001",
                        "experiment_code": "EXP-001",
                        "tray_code": "TRAY-001",
                    }
                ],
                "mes.experiment_samples": [
                    {"task_code": "TASK-001", "experiment_code": "EXP-001", "sample_code": "SAMPLE-001"}
                ],
            }

        def read_all(self):
            return self.payload

        def write_many(self, updates):
            self.writes.append(updates)
            self.payload.update(updates)

    storage = FakeStorage()
    monkeypatch.setattr("app.services.mq_event_processor.get_storage_backend", lambda: storage)
    monkeypatch.setattr(
        "app.services.mq_event_processor.get_connection",
        lambda: (_ for _ in ()).throw(AssertionError("MQTT ended should not write completion SQL directly")),
    )

    MySQLMqEventRepository().mark_run_ended("RUN-001", "2026-05-16 12:00:00")

    history = storage.writes[-1]["mes.samples"][0]["history"]
    assert [entry["detail"] for entry in history].count(completion_detail) == 1
    assert history[0]["location"] == "振动一室"
    assert history[0]["owner"] == "测试员"


def test_mysql_mark_run_started_rejects_missing_run_tray_relation_without_run_tray_codes_fallback(monkeypatch):
    class FakeStorage:
        def __init__(self):
            self.writes = []
            self.payload = {
                "mes.tasks": [{"id": "TASK-001", "code": "TASK-001", "status": "任务进行中"}],
                "mes.samples": [
                    {
                        "code": "SAMPLE-001",
                        "task_code": "TASK-001",
                        "status": "实验准备就绪",
                        "flow_status": "实验准备就绪",
                        "location": "振动一室",
                        "trays": [{"tray_code": "TRAY-001", "status": "实验准备就绪"}],
                        "history": [],
                    }
                ],
                "mes.experiments": [
                    {"task_code": "TASK-001", "experiment_code": "EXP-001", "experiment_name": "振动实验"}
                ],
                "mes.schedules": [
                    {"task_code": "TASK-001", "experiment_code": "EXP-001", "status": "实验准备就绪"}
                ],
                "mes.experiment_runs": [
                    {
                        "run_no": "RUN-001",
                        "task_code": "TASK-001",
                        "experiment_code": "EXP-001",
                        "status": "实验准备就绪",
                        "tray_codes": ["TRAY-001"],
                    }
                ],
                "mes.experiment_run_trays": [],
                "mes.experiment_trays": [
                    {"task_code": "TASK-001", "experiment_code": "EXP-001", "tray_code": "TRAY-001"}
                ],
                "mes.experiment_samples": [
                    {"task_code": "TASK-001", "experiment_code": "EXP-001", "sample_code": "SAMPLE-001"}
                ],
            }

        def read_all(self):
            return self.payload

        def write_many(self, updates):
            self.writes.append(updates)
            self.payload.update(updates)

    storage = FakeStorage()
    monkeypatch.setattr("app.services.mq_event_processor.get_storage_backend", lambda: storage)

    with pytest.raises(ValueError, match="experiment_run_trays"):
        MySQLMqEventRepository().mark_run_started("RUN-001", "2026-05-16 11:00:00")

    assert storage.writes == []


def test_mysql_mark_run_ended_rejects_missing_run_tray_relation_without_run_tray_codes_fallback(monkeypatch):
    class FakeStorage:
        def __init__(self):
            self.writes = []
            self.payload = {
                "mes.tasks": [{"id": "TASK-001", "code": "TASK-001", "status": "任务进行中"}],
                "mes.samples": [
                    {
                        "code": "SAMPLE-001",
                        "task_code": "TASK-001",
                        "status": "实验进行中",
                        "flow_status": "实验进行中",
                        "location": "振动一室",
                        "trays": [{"tray_code": "TRAY-001", "status": "实验进行中"}],
                        "history": [],
                    }
                ],
                "mes.experiments": [
                    {"task_code": "TASK-001", "experiment_code": "EXP-001", "experiment_name": "振动实验"}
                ],
                "mes.schedules": [
                    {"task_code": "TASK-001", "experiment_code": "EXP-001", "status": "实验进行中"}
                ],
                "mes.experiment_runs": [
                    {
                        "run_no": "RUN-001",
                        "task_code": "TASK-001",
                        "experiment_code": "EXP-001",
                        "status": "实验进行中",
                        "tray_codes": ["TRAY-001"],
                    }
                ],
                "mes.experiment_run_trays": [],
                "mes.experiment_trays": [
                    {"task_code": "TASK-001", "experiment_code": "EXP-001", "tray_code": "TRAY-001"}
                ],
                "mes.experiment_samples": [
                    {"task_code": "TASK-001", "experiment_code": "EXP-001", "sample_code": "SAMPLE-001"}
                ],
            }

        def read_all(self):
            return self.payload

        def write_many(self, updates):
            self.writes.append(updates)
            self.payload.update(updates)

    storage = FakeStorage()
    monkeypatch.setattr("app.services.mq_event_processor.get_storage_backend", lambda: storage)

    with pytest.raises(ValueError, match="experiment_run_trays"):
        MySQLMqEventRepository().mark_run_ended("RUN-001", "2026-05-16 12:00:00")

    assert storage.writes == []


def test_mysql_mark_run_ended_uses_mock_completion_rules(monkeypatch):
    class FakeStorage:
        def __init__(self):
            self.writes = []
            self.payload = {
                "mes.tasks": [{"id": "TASK-001", "code": "TASK-001", "status": "任务进行中"}],
                "mes.samples": [
                    {
                        "code": "SAMPLE-001",
                        "task_code": "TASK-001",
                        "status": "实验进行中",
                        "flow_status": "实验进行中",
                        "location": "振动一室",
                        "trays": [
                            {
                                "tray_code": "TRAY-001",
                                "status": "实验进行中",
                                "target_lab": "振动一室",
                                "target_experiment_code": "EXP-001",
                            }
                        ],
                        "history": [],
                    }
                ],
                "mes.experiments": [
                    {
                        "task_code": "TASK-001",
                        "experiment_code": "EXP-001",
                        "experiment_name": "振动实验",
                        "status": "实验进行中",
                    }
                ],
                "mes.schedules": [
                    {
                        "task_code": "TASK-001",
                        "experiment_code": "EXP-001",
                        "status": "实验进行中",
                    }
                ],
                "mes.experiment_runs": [
                    {
                        "run_no": "RUN-001",
                        "task_code": "TASK-001",
                        "experiment_code": "EXP-001",
                        "status": "实验进行中",
                        "tray_codes": ["TRAY-001"],
                    }
                ],
                "mes.experiment_run_trays": [
                    {
                        "run_no": "RUN-001",
                        "task_code": "TASK-001",
                        "experiment_code": "EXP-001",
                        "tray_code": "TRAY-001",
                        "status": "实验进行中",
                        "run_tray_status": "实验进行中",
                    }
                ],
                "mes.experiment_trays": [
                    {
                        "task_code": "TASK-001",
                        "experiment_code": "EXP-001",
                        "tray_code": "TRAY-001",
                    }
                ],
                "mes.experiment_samples": [
                    {"task_code": "TASK-001", "experiment_code": "EXP-001", "sample_code": "SAMPLE-001"}
                ],
            }

        def read_all(self):
            return self.payload

        def write_many(self, updates):
            self.writes.append(updates)
            self.payload.update(updates)

    storage = FakeStorage()
    monkeypatch.setattr("app.services.mq_event_processor.get_storage_backend", lambda: storage, raising=False)
    monkeypatch.setattr(
        "app.services.mq_event_processor.get_connection",
        lambda: (_ for _ in ()).throw(AssertionError("MQTT ended should use shared completion storage adapter")),
    )

    MySQLMqEventRepository().mark_run_ended("RUN-001", "2026-05-16 12:00:00")

    assert storage.writes
    written = storage.writes[-1]
    completed_tray = written["mes.samples"][0]["trays"][0]
    assert completed_tray["status"] == "实验已完成"
    assert "target_lab" not in completed_tray
    assert "target_experiment_code" not in completed_tray
    assert written["mes.experiments"][0]["status"] == "实验已完成"
    assert written["mes.schedules"][0]["status"] == "实验已完成"
    assert written["mes.experiment_runs"][0]["status"] == "实验已完成"
    assert written["mes.experiment_run_trays"][0]["run_tray_status"] == "实验已完成"


def test_mysql_mark_axis_run_ended_marks_current_schedule_complete_without_finishing_all_axes(monkeypatch):
    class FakeStorage:
        def __init__(self):
            self.writes = []
            self.payload = {
                "mes.tasks": [{"id": "TASK-AXIS", "code": "TASK-AXIS", "status": "任务进行中"}],
                "mes.samples": [
                    {
                        "code": "SAMPLE-AXIS",
                        "task_code": "TASK-AXIS",
                        "status": "实验进行中",
                        "flow_status": "实验进行中",
                        "location": "冲击一室",
                        "trays": [
                            {
                                "tray_code": "TRAY-AXIS",
                                "status": "实验进行中",
                                "target_lab": "冲击一室",
                                "target_experiment_code": "EXP-AXIS",
                            }
                        ],
                        "history": [],
                    }
                ],
                "mes.experiments": [
                    {
                        "task_code": "TASK-AXIS",
                        "experiment_code": "EXP-AXIS",
                        "experiment_name": "冲击试验",
                        "status": "实验进行中",
                        "axis_codes": ["z-", "y+", "x-", "x+"],
                    }
                ],
                "mes.schedules": [
                        {
                            "id": "SCH-AXIS-1",
                            "task_code": "TASK-AXIS",
                            "experiment_code": "EXP-AXIS",
                            "sub_experiment_code": "EXP-AXIS-AXIS-001",
                            "status": "实验进行中",
                            "axis_codes": ["z-", "y+"],
                        },
                    {
                            "id": "SCH-AXIS-2",
                            "task_code": "TASK-AXIS",
                            "experiment_code": "EXP-AXIS",
                            "sub_experiment_code": "EXP-AXIS-AXIS-002",
                            "status": "已排程",
                            "axis_codes": ["x-", "x+"],
                    },
                ],
                "mes.experiment_runs": [
                    {
                            "run_no": "RUN-AXIS",
                            "task_code": "TASK-AXIS",
                            "experiment_code": "EXP-AXIS",
                            "sub_experiment_code": "EXP-AXIS-AXIS-001",
                            "schedule_id": "SCH-AXIS-1",
                            "status": "实验进行中",
                        "axis_codes": ["z-", "y+"],
                        "tray_codes": ["TRAY-AXIS"],
                    }
                ],
                "mes.experiment_run_trays": [
                    {
                            "run_no": "RUN-AXIS",
                            "task_code": "TASK-AXIS",
                            "experiment_code": "EXP-AXIS",
                            "sub_experiment_code": "EXP-AXIS-AXIS-001",
                            "tray_code": "TRAY-AXIS",
                        "status": "实验进行中",
                        "run_tray_status": "实验进行中",
                    }
                ],
                "mes.experiment_run_steps": [
                    {
                            "run_no": "RUN-AXIS",
                            "task_code": "TASK-AXIS",
                            "experiment_code": "EXP-AXIS",
                            "sub_experiment_code": "EXP-AXIS-AXIS-001",
                            "axis_code": "z-",
                        "status": "实验已完成",
                    },
                    {
                            "run_no": "RUN-AXIS",
                            "task_code": "TASK-AXIS",
                            "experiment_code": "EXP-AXIS",
                            "sub_experiment_code": "EXP-AXIS-AXIS-001",
                            "axis_code": "y+",
                        "status": "实验进行中",
                    },
                ],
                "mes.experiment_trays": [
                    {"task_code": "TASK-AXIS", "experiment_code": "EXP-AXIS", "tray_code": "TRAY-AXIS"}
                ],
                "mes.experiment_samples": [
                    {"task_code": "TASK-AXIS", "experiment_code": "EXP-AXIS", "sample_code": "SAMPLE-AXIS"}
                ],
            }

        def read_all(self):
            return self.payload

        def write_many(self, updates):
            self.writes.append(updates)
            self.payload.update(updates)

    storage = FakeStorage()
    monkeypatch.setattr("app.services.mq_event_processor.get_storage_backend", lambda: storage, raising=False)
    monkeypatch.setattr(
        "app.services.mq_event_processor.get_connection",
        lambda: (_ for _ in ()).throw(AssertionError("axis run completion should use shared storage adapter")),
    )

    MySQLMqEventRepository().mark_run_ended("RUN-AXIS", "2026-06-24 10:00:00", axis_code="y+")

    written = storage.writes[-1]
    assert written["mes.samples"][0]["status"] == "冲击试验部分完成 2/4轴"
    assert written["mes.samples"][0]["flow_status"] == "冲击试验部分完成 2/4轴"
    assert written["mes.samples"][0]["trays"][0]["status"] == "冲击试验部分完成 2/4轴"
    assert not any(
        entry.get("detail") == "TASK-AXIS / 冲击试验 / 实验已完成"
        for entry in written["mes.samples"][0]["history"]
    )
    assert "target_lab" not in written["mes.samples"][0]["trays"][0]
    assert written["mes.experiments"][0]["status"] == "实验进行中"
    assert written["mes.schedules"][0]["status"] == "实验已完成"
    assert written["mes.schedules"][1]["status"] == "已排程"
    assert written["mes.experiment_runs"][0]["status"] == "实验已完成"
    assert written["mes.experiment_run_trays"][0]["run_tray_status"] == "实验已完成"


def test_mysql_mark_run_ended_ignores_sample_from_other_experiment(monkeypatch):
    class FakeStorage:
        def __init__(self):
            self.writes = []
            self.payload = {
                "mes.tasks": [{"id": "TASK-001", "code": "TASK-001", "status": "任务进行中"}],
                "mes.samples": [
                    {
                        "code": "SAMPLE-OLD",
                        "task_code": "TASK-001",
                        "status": "厂家收回",
                        "flow_status": "厂家收回",
                        "location": "厂家收回",
                        "trays": [{"tray_code": "TRAY-001", "status": "厂家收回"}],
                        "history": [],
                    },
                    {
                        "code": "SAMPLE-CURRENT",
                        "task_code": "TASK-001",
                        "status": "实验进行中",
                        "flow_status": "实验进行中",
                        "location": "温度冲击二室",
                        "trays": [{"tray_code": "TRAY-001", "status": "实验进行中"}],
                        "history": [],
                    },
                ],
                "mes.experiments": [
                    {
                        "task_code": "TASK-001",
                        "experiment_code": "EXP-001",
                        "experiment_name": "温度冲击试验",
                        "status": "实验进行中",
                    }
                ],
                "mes.schedules": [
                    {
                        "id": "schedule-temp",
                        "task_code": "TASK-001",
                        "experiment_code": "EXP-001",
                        "device": "温度冲击二室",
                        "status": "实验进行中",
                    }
                ],
                "mes.experiment_runs": [
                    {
                        "run_no": "RUN-001",
                        "task_code": "TASK-001",
                        "experiment_code": "EXP-001",
                        "status": "实验进行中",
                        "tray_codes": ["TRAY-001"],
                    }
                ],
                "mes.experiment_run_trays": [
                    {
                        "run_no": "RUN-001",
                        "task_code": "TASK-001",
                        "experiment_code": "EXP-001",
                        "tray_code": "TRAY-001",
                        "status": "实验进行中",
                        "run_tray_status": "实验进行中",
                    }
                ],
                "mes.experiment_trays": [
                    {"task_code": "TASK-001", "experiment_code": "EXP-OLD", "tray_code": "TRAY-001"},
                    {"task_code": "TASK-001", "experiment_code": "EXP-001", "tray_code": "TRAY-001"},
                ],
                "mes.experiment_samples": [
                    {"task_code": "TASK-001", "experiment_code": "EXP-OLD", "sample_code": "SAMPLE-OLD"},
                    {"task_code": "TASK-001", "experiment_code": "EXP-001", "sample_code": "SAMPLE-CURRENT"},
                ],
            }

        def read_all(self):
            return self.payload

        def write_many(self, updates):
            self.writes.append(updates)
            self.payload.update(updates)

    storage = FakeStorage()
    monkeypatch.setattr("app.services.mq_event_processor.get_storage_backend", lambda: storage)
    monkeypatch.setattr(
        "app.services.mq_event_processor.get_connection",
        lambda: (_ for _ in ()).throw(AssertionError("MQTT ended should use shared completion storage adapter")),
    )

    MySQLMqEventRepository().mark_run_ended("RUN-001", "2026-06-06 15:10:00")

    written_samples = {sample["code"]: sample for sample in storage.writes[-1]["mes.samples"]}
    assert written_samples["SAMPLE-OLD"]["status"] == "厂家收回"
    assert written_samples["SAMPLE-OLD"]["trays"][0]["status"] == "厂家收回"
    assert written_samples["SAMPLE-CURRENT"]["status"] == "实验已完成"
    assert written_samples["SAMPLE-CURRENT"]["trays"][0]["status"] == "实验已完成"


def test_mysql_mark_run_ended_keeps_experiment_open_when_bound_tray_is_not_finished(monkeypatch):
    class FakeStorage:
        def __init__(self):
            self.writes = []
            self.payload = {
                "mes.tasks": [{"id": "TASK-001", "code": "TASK-001", "status": "任务进行中"}],
                "mes.samples": [
                    {
                        "code": "SAMPLE-001",
                        "task_code": "TASK-001",
                        "status": "实验进行中",
                        "flow_status": "实验进行中",
                        "location": "盐雾试验室",
                        "trays": [{"tray_code": "TRAY-001", "status": "实验进行中"}],
                        "history": [],
                    },
                    {
                        "code": "SAMPLE-002",
                        "task_code": "TASK-001",
                        "status": "实验准备就绪",
                        "flow_status": "实验准备就绪",
                        "location": "盐雾试验室",
                        "trays": [{"tray_code": "TRAY-002", "status": "实验准备就绪"}],
                        "history": [],
                    },
                ],
                "mes.experiments": [
                    {
                        "task_code": "TASK-001",
                        "experiment_code": "EXP-001",
                        "experiment_name": "盐雾试验",
                        "status": "实验进行中",
                    }
                ],
                "mes.schedules": [
                    {
                        "task_code": "TASK-001",
                        "experiment_code": "EXP-001",
                        "status": "实验进行中",
                    }
                ],
                "mes.experiment_runs": [
                    {
                        "run_no": "RUN-001",
                        "task_code": "TASK-001",
                        "experiment_code": "EXP-001",
                        "status": "实验进行中",
                        "tray_codes": ["TRAY-001"],
                    }
                ],
                "mes.experiment_run_trays": [
                    {
                        "run_no": "RUN-001",
                        "task_code": "TASK-001",
                        "experiment_code": "EXP-001",
                        "tray_code": "TRAY-001",
                        "status": "实验进行中",
                        "run_tray_status": "实验进行中",
                    }
                ],
                "mes.experiment_trays": [
                    {
                        "task_code": "TASK-001",
                        "experiment_code": "EXP-001",
                        "tray_code": "TRAY-001",
                    },
                    {
                        "task_code": "TASK-001",
                        "experiment_code": "EXP-001",
                        "tray_code": "TRAY-002",
                    },
                ],
                "mes.experiment_samples": [
                    {"task_code": "TASK-001", "experiment_code": "EXP-001", "sample_code": "SAMPLE-001"},
                    {"task_code": "TASK-001", "experiment_code": "EXP-001", "sample_code": "SAMPLE-002"},
                ],
            }

        def read_all(self):
            return self.payload

        def write_many(self, updates):
            self.writes.append(updates)
            self.payload.update(updates)

    storage = FakeStorage()
    monkeypatch.setattr("app.services.mq_event_processor.get_storage_backend", lambda: storage)
    monkeypatch.setattr(
        "app.services.mq_event_processor.get_connection",
        lambda: (_ for _ in ()).throw(AssertionError("MQTT ended should not write completion SQL directly")),
    )

    MySQLMqEventRepository().mark_run_ended("RUN-001", "2026-05-16 12:00:00")

    written = storage.writes[-1]
    assert written["mes.experiments"][0]["status"] == "实验进行中"
    assert written["mes.schedules"][0]["status"] == "实验进行中"
    assert written["mes.samples"][0]["location"] == "盐雾试验室"
    assert written["mes.samples"][0]["status"] == "实验已完成"
    assert written["mes.samples"][0]["flow_status"] == "实验已完成"
    assert written["mes.samples"][0]["trays"][0]["status"] == "实验已完成"
    assert written["mes.samples"][1]["status"] == "实验准备就绪"
    assert written["mes.samples"][1]["trays"][0]["status"] == "实验准备就绪"
    assert written["mes.experiment_run_trays"][0]["run_tray_status"] == "实验已完成"


def test_mysql_find_current_context_scopes_ready_trays_to_matched_experiment(monkeypatch):
    class TupleCursor:
        description = None

        def __init__(self):
            self.schedule_query_params = None

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def execute(self, sql, params=None):
            if "FROM md_lab" in sql:
                self.description = (("lab_name",),)
            elif "FROM biz_mq_message_log" in sql:
                self.description = (("task_no",), ("experiment_no",), ("payload_json",))
            elif "FROM biz_tray tr" in sql:
                self.description = (("tray_no",), ("sample_no",), ("location_desc",), ("current_lab_id",))
            elif "FROM biz_schedule s" in sql:
                self.description = (
                    ("schedule_no",),
                    ("task_no",),
                    ("experiment_no",),
                    ("device_name",),
                    ("planned_hours",),
                    ("schedule_end_time",),
                    ("scoped_tray_no",),
                )
                self.schedule_query_params = list(params or [])
            else:
                self.description = None

        def fetchone(self):
            columns = [column[0] for column in (self.description or [])]
            if columns == ["lab_name"]:
                return ("冲击一室",)
            return None

        def fetchall(self):
            columns = [column[0] for column in (self.description or [])]
            if columns == ["task_no", "experiment_no", "payload_json"]:
                return [("TASK-SCOPED", "EXP-A", "{}")]
            if columns == ["tray_no", "sample_no", "location_desc", "current_lab_id"]:
                return [
                    ("TP-001", "SP-001", "冲击一室", 4),
                    ("TP-002", "SP-002", "冲击一室", 4),
                ]
            if columns == [
                "schedule_no",
                "task_no",
                "experiment_no",
                "device_name",
                "planned_hours",
                "schedule_end_time",
                "scoped_tray_no",
            ]:
                return [
                    (
                        "schedule-impact",
                        "TASK-SCOPED",
                        "EXP-A",
                        "冲击一室",
                        3.5,
                        "2026-06-04 16:00:00",
                        "TP-001",
                    )
                ]
            return []

    class TupleConnection:
        def __init__(self):
            self.cursor_obj = TupleCursor()

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def cursor(self):
            return self.cursor_obj

    connection = TupleConnection()
    monkeypatch.setattr("app.services.mq_event_processor.get_connection", lambda: connection)

    context = MySQLMqEventRepository().find_current_context_by_lab("LAB_IMPACT_1", ["实验准备就绪"])

    assert context == {
        "task_no": "TASK-SCOPED",
        "experiment_no": "EXP-A",
        "schedule_no": "schedule-impact",
        "device_name": "冲击一室",
        "planned_hours": 3.5,
        "schedule_end_time": "2026-06-04 16:00:00",
        "tray_nos": ["TP-001"],
        "sample_nos": ["SP-001"],
    }


def test_mysql_find_current_context_uses_ready_schedule_id_to_disambiguate_axis_schedules(monkeypatch):
    class TupleCursor:
        description = None

        def __init__(self):
            self.schedule_query_params = None
            self.schedule_query_sql = ""

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def execute(self, sql, params=None):
            if "FROM md_lab" in sql:
                self.description = (("lab_name",),)
            elif "FROM biz_mq_message_log" in sql:
                self.description = (("task_no",), ("experiment_no",), ("payload_json",))
            elif "FROM biz_tray tr" in sql:
                self.description = (("tray_no",), ("sample_no",), ("location_desc",), ("current_lab_id",))
            elif "FROM biz_schedule s" in sql:
                self.schedule_query_sql = " ".join(sql.split())
                self.schedule_query_params = list(params or [])
                self.description = (
                    ("schedule_no",),
                    ("task_no",),
                    ("experiment_no",),
                    ("device_name",),
                    ("planned_hours",),
                    ("schedule_end_time",),
                    ("scoped_tray_no",),
                )
            else:
                self.description = None

        def fetchone(self):
            columns = [column[0] for column in (self.description or [])]
            if columns == ["lab_name"]:
                return ("冲击二室",)
            return None

        def fetchall(self):
            columns = [column[0] for column in (self.description or [])]
            if columns == ["task_no", "experiment_no", "payload_json"]:
                return [
                    (
                        "SYLU-2026-06-021",
                        "SYLU-2026-06-021-A",
                        '{"schedule_id":"schedule-impact-axis-x-plus","axis_codes":["x+"]}',
                    )
                ]
            if columns == ["tray_no", "sample_no", "location_desc", "current_lab_id"]:
                return [("TP-AXIS-001", "SP-AXIS-001", "冲击二室", 5)]
            if columns == [
                "schedule_no",
                "task_no",
                "experiment_no",
                "device_name",
                "planned_hours",
                "schedule_end_time",
                "scoped_tray_no",
            ]:
                if (
                    "s.schedule_no = %s" in self.schedule_query_sql
                    and "schedule-impact-axis-x-plus" in self.schedule_query_params
                ):
                    return [
                        (
                            "schedule-impact-axis-x-plus",
                            "SYLU-2026-06-021",
                            "SYLU-2026-06-021-A",
                            "冲击二室",
                            1.5,
                            "2026-06-21 10:30:00",
                            "TP-AXIS-001",
                        )
                    ]
                return [
                    (
                        "schedule-impact-axis-x-plus",
                        "SYLU-2026-06-021",
                        "SYLU-2026-06-021-A",
                        "冲击二室",
                        1.5,
                        "2026-06-21 10:30:00",
                        "TP-AXIS-001",
                    ),
                    (
                        "schedule-impact-axis-x-minus",
                        "SYLU-2026-06-021",
                        "SYLU-2026-06-021-A",
                        "冲击二室",
                        1.5,
                        "2026-06-21 12:30:00",
                        "TP-AXIS-001",
                    ),
                ]
            return []

    class TupleConnection:
        def __init__(self):
            self.cursor_obj = TupleCursor()

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def cursor(self):
            return self.cursor_obj

    connection = TupleConnection()
    monkeypatch.setattr("app.services.mq_event_processor.get_connection", lambda: connection)

    context = MySQLMqEventRepository().find_current_context_by_lab("LAB_IMPACT_2", ["实验准备就绪"])

    assert "s.schedule_no = %s" in connection.cursor_obj.schedule_query_sql
    assert context == {
        "task_no": "SYLU-2026-06-021",
        "experiment_no": "SYLU-2026-06-021-A",
        "schedule_no": "schedule-impact-axis-x-plus",
        "device_name": "冲击二室",
        "planned_hours": 1.5,
        "schedule_end_time": "2026-06-21 10:30:00",
        "tray_nos": ["TP-AXIS-001"],
        "sample_nos": ["SP-AXIS-001"],
    }


def test_mysql_find_current_context_prefers_event_schedule_id_over_command_context(monkeypatch):
    class TupleCursor:
        description = None

        def __init__(self):
            self.schedule_query_params = None
            self.schedule_query_sql = ""

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def execute(self, sql, params=None):
            if "FROM md_lab" in sql:
                self.description = (("lab_name",),)
            elif "FROM biz_mq_message_log" in sql:
                self.description = (("task_no",), ("experiment_no",), ("payload_json",))
            elif "FROM biz_tray tr" in sql:
                self.description = (("tray_no",), ("sample_no",), ("location_desc",), ("current_lab_id",))
            elif "FROM biz_schedule s" in sql:
                self.schedule_query_sql = " ".join(sql.split())
                self.schedule_query_params = list(params or [])
                self.description = (
                    ("schedule_no",),
                    ("task_no",),
                    ("experiment_no",),
                    ("device_name",),
                    ("planned_hours",),
                    ("schedule_end_time",),
                    ("scoped_tray_no",),
                )
            else:
                self.description = None

        def fetchone(self):
            return None

        def fetchall(self):
            columns = [column[0] for column in (self.description or [])]
            if columns == ["task_no", "experiment_no", "payload_json"]:
                return [("SYLU-2026-06-021", "SYLU-2026-06-021-A", "{}")]
            if columns == ["tray_no", "sample_no", "location_desc", "current_lab_id"]:
                return [("TP-AXIS-001", "SP-AXIS-001", "冲击二室", 5)]
            if columns == [
                "schedule_no",
                "task_no",
                "experiment_no",
                "device_name",
                "planned_hours",
                "schedule_end_time",
                "scoped_tray_no",
            ]:
                if (
                    "s.schedule_no = %s" in self.schedule_query_sql
                    and "schedule-impact-axis-x-minus" in self.schedule_query_params
                ):
                    return [
                        (
                            "schedule-impact-axis-x-minus",
                            "SYLU-2026-06-021",
                            "SYLU-2026-06-021-A",
                            "冲击二室",
                            1.5,
                            "2026-06-21 12:30:00",
                            "TP-AXIS-001",
                        )
                    ]
                return [
                    (
                        "schedule-impact-axis-x-plus",
                        "SYLU-2026-06-021",
                        "SYLU-2026-06-021-A",
                        "冲击二室",
                        1.5,
                        "2026-06-21 10:30:00",
                        "TP-AXIS-001",
                    ),
                    (
                        "schedule-impact-axis-x-minus",
                        "SYLU-2026-06-021",
                        "SYLU-2026-06-021-A",
                        "冲击二室",
                        1.5,
                        "2026-06-21 12:30:00",
                        "TP-AXIS-001",
                    ),
                ]
            return []

    class TupleConnection:
        def __init__(self):
            self.cursor_obj = TupleCursor()

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def cursor(self):
            return self.cursor_obj

    connection = TupleConnection()
    monkeypatch.setattr("app.services.mq_event_processor.get_connection", lambda: connection)

    context = MySQLMqEventRepository().find_current_context_by_lab(
        "LAB_IMPACT_2",
        ["实验准备就绪"],
        {"schedule_id": "schedule-impact-axis-x-minus"},
    )

    assert "s.schedule_no = %s" in connection.cursor_obj.schedule_query_sql
    assert context["schedule_no"] == "schedule-impact-axis-x-minus"


def test_mysql_find_current_context_allows_axis_schedule_when_status_is_stale_completed_without_run_tray_evidence(monkeypatch):
    class TupleCursor:
        description = None

        def __init__(self):
            self.schedule_query_params = []
            self.schedule_query_sql = ""

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def execute(self, sql, params=None):
            if "FROM biz_mq_message_log" in sql:
                self.description = (("task_no",), ("experiment_no",), ("payload_json",))
            elif "FROM biz_tray tr" in sql:
                self.description = (("tray_no",), ("sample_no",), ("location_desc",), ("current_lab_id",))
            elif "FROM biz_schedule s" in sql:
                self.schedule_query_sql = " ".join(sql.split())
                self.schedule_query_params = list(params or [])
                self.description = (
                    ("schedule_no",),
                    ("task_no",),
                    ("experiment_no",),
                    ("device_name",),
                    ("planned_hours",),
                    ("schedule_end_time",),
                    ("scoped_tray_no",),
                )
            else:
                self.description = None

        def fetchall(self):
            columns = [column[0] for column in (self.description or [])]
            if columns == ["task_no", "experiment_no", "payload_json"]:
                return [
                    (
                        "SYLU-2026-07-001",
                        "SYLU-2026-07-001-A",
                        '{"schedule_id":"schedule-axis-002","sub_experiment_code":"SYLU-2026-07-001-A-AXIS-002"}',
                    )
                ]
            if columns == ["tray_no", "sample_no", "location_desc", "current_lab_id"]:
                return [("SYLU-2026-07-001-TP-001", "SYLU-2026-07-001-SP-001", "冲击二室", 4)]
            if columns == [
                "schedule_no",
                "task_no",
                "experiment_no",
                "device_name",
                "planned_hours",
                "schedule_end_time",
                "scoped_tray_no",
            ]:
                if "NOT EXISTS" not in self.schedule_query_sql:
                    return []
                if "biz_experiment_run_tray completed_rt" not in self.schedule_query_sql:
                    return []
                if "SYLU-2026-07-001-A-AXIS-002" not in self.schedule_query_params:
                    return []
                return [
                    (
                        "schedule-axis-002",
                        "SYLU-2026-07-001",
                        "SYLU-2026-07-001-A",
                        "冲击二室",
                        3.0,
                        "2026-07-01 15:00:00",
                        "SYLU-2026-07-001-TP-001",
                    )
                ]
            return []

    class TupleConnection:
        def __init__(self):
            self.cursor_obj = TupleCursor()

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def cursor(self):
            return self.cursor_obj

    connection = TupleConnection()
    monkeypatch.setattr("app.services.mq_event_processor.get_connection", lambda: connection)

    context = MySQLMqEventRepository().find_current_context_by_lab("LAB_IMPACT_2", ["实验准备就绪"])

    assert context == {
        "task_no": "SYLU-2026-07-001",
        "experiment_no": "SYLU-2026-07-001-A",
        "sub_experiment_code": "SYLU-2026-07-001-A-AXIS-002",
        "schedule_no": "schedule-axis-002",
        "device_name": "冲击二室",
        "planned_hours": 3.0,
        "schedule_end_time": "2026-07-01 15:00:00",
        "tray_nos": ["SYLU-2026-07-001-TP-001"],
        "sample_nos": ["SYLU-2026-07-001-SP-001"],
    }


def test_mysql_find_current_context_allows_legacy_schedule_without_lab_id_when_command_has_experiment(monkeypatch):
    class TupleCursor:
        description = None
        schedule_sql = ""

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def execute(self, sql, params=None):
            if "FROM biz_mq_message_log" in sql:
                self.description = (("task_no",), ("experiment_no",), ("payload_json",))
            elif "FROM biz_tray tr" in sql:
                self.description = (("tray_no",), ("sample_no",), ("location_desc",), ("current_lab_id",))
            elif "FROM biz_schedule s" in sql:
                self.description = (
                    ("schedule_no",),
                    ("task_no",),
                    ("experiment_no",),
                    ("device_name",),
                    ("planned_hours",),
                    ("schedule_end_time",),
                    ("scoped_tray_no",),
                )
                self.schedule_sql = sql
            else:
                self.description = None

        def fetchall(self):
            columns = [column[0] for column in (self.description or [])]
            if columns == ["task_no", "experiment_no", "payload_json"]:
                return [("TASK-LEGACY", "EXP-SALT", "{}")]
            if columns == ["tray_no", "sample_no", "location_desc", "current_lab_id"]:
                return [("TP-001", "SP-001", "盐雾试验室", 3)]
            if columns == [
                "schedule_no",
                "task_no",
                "experiment_no",
                "device_name",
                "planned_hours",
                "schedule_end_time",
                "scoped_tray_no",
            ]:
                if "schedule_lab.lab_code = %s OR schedule_lab.lab_code IS NULL" not in self.schedule_sql:
                    return []
                return [("schedule-salt", "TASK-LEGACY", "EXP-SALT", "盐雾试验室", 2.0, "2026-06-07 18:00:00", "TP-001")]
            return []

    class TupleConnection:
        def __init__(self):
            self.cursor_obj = TupleCursor()

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def cursor(self):
            return self.cursor_obj

    connection = TupleConnection()
    monkeypatch.setattr("app.services.mq_event_processor.get_connection", lambda: connection)

    context = MySQLMqEventRepository().find_current_context_by_lab("LAB_SALT", ["工装夹具安装"])

    assert context == {
        "task_no": "TASK-LEGACY",
        "experiment_no": "EXP-SALT",
        "schedule_no": "schedule-salt",
        "device_name": "盐雾试验室",
        "planned_hours": 2.0,
        "schedule_end_time": "2026-06-07 18:00:00",
        "tray_nos": ["TP-001"],
        "sample_nos": ["SP-001"],
    }


def test_mysql_find_current_context_rejects_legacy_completed_axis_schedule_without_sub_experiment(monkeypatch):
    class TupleCursor:
        description = None
        schedule_sql = ""
        schedule_params = []

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def execute(self, sql, params=None):
            if "FROM biz_mq_message_log" in sql:
                self.description = (("task_no",), ("experiment_no",), ("payload_json",))
            elif "FROM biz_tray tr" in sql:
                self.description = (("tray_no",), ("sample_no",), ("location_desc",), ("current_lab_id",))
            elif "FROM biz_schedule s" in sql:
                self.description = (
                    ("schedule_no",),
                    ("task_no",),
                    ("experiment_no",),
                    ("sub_experiment_code",),
                    ("axis_batch_no",),
                    ("device_name",),
                    ("planned_hours",),
                    ("schedule_end_time",),
                    ("scoped_tray_no",),
                )
                self.schedule_sql = " ".join(sql.split())
                self.schedule_params = list(params or [])
            else:
                self.description = None

        def fetchall(self):
            columns = [column[0] for column in (self.description or [])]
            if columns == ["task_no", "experiment_no", "payload_json"]:
                return [
                    (
                        "SYLU-2026-07-001",
                        "SYLU-2026-07-001-A",
                        '{"schedule_id":"schedule-axis-z","sub_experiment_code":"SYLU-2026-07-001-A-AXIS-002"}',
                    )
                ]
            if columns == ["tray_no", "sample_no", "location_desc", "current_lab_id"]:
                return [("SYLU-2026-07-001-TP-001", "SYLU-2026-07-001-SP-001", "冲击一室", 4)]
            if columns == [
                "schedule_no",
                "task_no",
                "experiment_no",
                "device_name",
                "planned_hours",
                "schedule_end_time",
                "scoped_tray_no",
            ]:
                return []
            return []

    class TupleConnection:
        def __init__(self):
            self.cursor_obj = TupleCursor()

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def cursor(self):
            return self.cursor_obj

    connection = TupleConnection()
    monkeypatch.setattr("app.services.mq_event_processor.get_connection", lambda: connection)

    context = MySQLMqEventRepository().find_current_context_by_lab("LAB_IMPACT_1", ["实验准备就绪"])

    assert "s.schedule_no = %s" in connection.cursor_obj.schedule_sql
    assert "COALESCE(s.sub_experiment_code, '') = %s" in connection.cursor_obj.schedule_sql
    assert "COALESCE(s.schedule_status, '') NOT IN" in connection.cursor_obj.schedule_sql
    assert context is None


def test_process_experiment_started_rejects_lab_without_ready_context():
    repository = FakeMqEventRepository()
    repository.runs_by_lab = {}
    repository.contexts_by_lab = {}

    ack = process_laboratory_event(
        "mes/v1/labs/LAB_SALT/events/experiment-started",
        {
            "lab_code": "LAB_SALT",
            "started_at": "2026-05-16 10:00:00",
        },
        repository=repository,
    )

    assert ack["status"] == "REJECTED"
    assert ack["error_code"] == "READY_CONTEXT_REQUIRED"
    assert repository.messages == []
    assert repository.events == []


def test_process_experiment_ended_marks_active_run_by_lab_code():
    repository = FakeMqEventRepository()
    repository.runs_by_lab["LAB_SALT"]["sub_experiment_code"] = "SYLU-2026-03-001-A-AXIS-Y"

    ack = process_laboratory_event(
        "mes/v1/labs/LAB_SALT/events/experiment-ended",
        {
            "lab_code": "LAB_SALT",
            "ended_at": "2026-05-16 11:00:00",
        },
        repository=repository,
    )

    assert ack["status"] == "PROCESSED"
    assert repository.ended == [("RUN-SALT-001", "2026-05-16 11:00:00", "", "", "SYLU-2026-03-001-A-AXIS-Y")]
    assert repository.events[0]["task_no"] == "SYLU-2026-03-001"
    assert repository.events[0]["experiment_no"] == "SYLU-2026-03-001-A"
    assert repository.events[0]["sub_experiment_code"] == "SYLU-2026-03-001-A-AXIS-Y"


def test_process_experiment_ended_prefers_active_run_over_payload_experiment_code():
    repository = FakeMqEventRepository()

    ack = process_laboratory_event(
        "mes/v1/labs/LAB_SALT/events/experiment-ended",
        {
            "lab_code": "LAB_SALT",
            "task_code": "SYLU-2026-03-OLD",
            "experiment_code": "SYLU-2026-03-001-OLD",
            "ended_at": "2026-05-16 11:00:00",
        },
        repository=repository,
    )

    assert ack["status"] == "PROCESSED"
    assert repository.ended == [("RUN-SALT-001", "2026-05-16 11:00:00", "", "", "")]
    assert repository.messages[0]["task_no"] == "SYLU-2026-03-001"
    assert repository.messages[0]["experiment_no"] == "SYLU-2026-03-001-A"
    assert repository.events[0]["task_no"] == "SYLU-2026-03-001"
    assert repository.events[0]["experiment_no"] == "SYLU-2026-03-001-A"


def test_process_experiment_ended_passes_axis_fields_to_run_completion():
    repository = FakeMqEventRepository()

    ack = process_laboratory_event(
        "mes/v1/labs/LAB_SALT/events/experiment-ended",
        {
            "lab_code": "LAB_SALT",
            "ended_at": "2026-05-16 11:00:00",
            "axis_code": "y+",
            "next_axis_code": "x-",
        },
        repository=repository,
    )

    assert ack["status"] == "PROCESSED"
    assert repository.ended == [("RUN-SALT-001", "2026-05-16 11:00:00", "y+", "x-", "")]


def test_process_experiment_ended_passes_payload_sub_experiment_code_to_run_completion():
    repository = FakeMqEventRepository()

    ack = process_laboratory_event(
        "mes/v1/labs/LAB_SALT/events/experiment-ended",
        {
            "lab_code": "LAB_SALT",
            "ended_at": "2026-05-16 11:00:00",
            "sub_experiment_code": "SYLU-2026-03-001-A-AXIS-Z",
        },
        repository=repository,
    )

    assert ack["status"] == "PROCESSED"
    assert repository.ended == [("RUN-SALT-001", "2026-05-16 11:00:00", "", "", "SYLU-2026-03-001-A-AXIS-Z")]
    assert repository.events[0]["sub_experiment_code"] == "SYLU-2026-03-001-A-AXIS-Z"


def test_process_experiment_result_records_result_package():
    repository = FakeMqEventRepository()
    repository.runs_by_lab["LAB_SALT"]["sub_experiment_code"] = "SYLU-2026-03-001-A-AXIS-R"

    ack = process_laboratory_event(
        "mes/v1/labs/salt-spray-lab-01/events/experiment-result",
        {
            "lab_code": "LAB_SALT",
            "run_no": "RUN-SALT-001",
            "result_at": "2026-05-16 17:30:00",
            "result_package": {
                "result_id": "R-001",
                "conclusion": "PASS",
                "summary": "合格",
                "items": [],
                "attachments": [],
            },
        },
        repository=repository,
    )

    assert ack["status"] == "PROCESSED"
    assert repository.results[0]["sub_experiment_code"] == "SYLU-2026-03-001-A-AXIS-R"
    assert repository.results[0]["conclusion"] == "PASS"
    assert repository.results[0]["summary"] == "合格"


def test_process_experiment_result_rejects_missing_run_no_after_ended_event():
    repository = FakeMqEventRepository()

    process_laboratory_event(
        "mes/v1/labs/LAB_SALT/events/experiment-ended",
        {
            "lab_code": "LAB_SALT",
            "ended_at": "2026-05-16 17:30:00",
        },
        repository=repository,
    )

    with pytest.raises(ValueError, match="run_no is required"):
        process_laboratory_event(
            "mes/v1/labs/LAB_SALT/events/experiment-result",
            {
                "lab_code": "LAB_SALT",
                "result_at": "2026-05-16 17:31:00",
                "result_package": {
                    "result_id": "R-ENDED-001",
                    "conclusion": "PASS",
                    "summary": "结束后结果包",
                    "items": [],
                    "attachments": [],
                },
            },
            repository=repository,
        )

    assert repository.results == []
    assert repository.messages[-1]["message_type"] == "EXPERIMENT_ENDED"
    assert get_legacy_fallback_hits() == []


def test_process_experiment_result_uses_payload_run_no_without_recent_completed_fallback():
    repository = FakeMqEventRepository()

    process_laboratory_event(
        "mes/v1/labs/LAB_SALT/events/experiment-ended",
        {
            "lab_code": "LAB_SALT",
            "ended_at": "2026-05-16 17:30:00",
        },
        repository=repository,
    )
    reset_legacy_fallback_hits()

    ack = process_laboratory_event(
        "mes/v1/labs/LAB_SALT/events/experiment-result",
        {
            "lab_code": "LAB_SALT",
            "run_no": "RUN-SALT-001",
            "result_at": "2026-05-16 17:31:00",
            "result_package": {
                "result_id": "R-RUN-001",
                "conclusion": "PASS",
                "summary": "按run_no精确绑定",
                "items": [],
                "attachments": [],
            },
        },
        repository=repository,
    )

    assert ack["status"] == "PROCESSED"
    assert repository.results[0]["task_no"] == "SYLU-2026-03-001"
    assert repository.results[0]["experiment_no"] == "SYLU-2026-03-001-A"
    assert repository.results[0]["summary"] == "按run_no精确绑定"
    assert get_legacy_fallback_hits() == []


def test_process_experiment_result_rejects_unknown_payload_run_no_without_recent_completed_fallback():
    repository = FakeMqEventRepository()

    process_laboratory_event(
        "mes/v1/labs/LAB_SALT/events/experiment-ended",
        {
            "lab_code": "LAB_SALT",
            "ended_at": "2026-05-16 17:30:00",
        },
        repository=repository,
    )
    reset_legacy_fallback_hits()

    with pytest.raises(ValueError, match="experiment run is required"):
        process_laboratory_event(
            "mes/v1/labs/LAB_SALT/events/experiment-result",
            {
                "lab_code": "LAB_SALT",
                "run_no": "RUN-UNKNOWN",
                "result_at": "2026-05-16 17:31:00",
                "result_package": {
                    "result_id": "R-RUN-UNKNOWN",
                    "conclusion": "PASS",
                    "summary": "不应绑定最近完成run",
                    "items": [],
                    "attachments": [],
                },
            },
            repository=repository,
        )

    assert repository.results == []
    assert get_legacy_fallback_hits() == []


def test_process_experiment_result_prefers_active_run_over_payload_experiment_code():
    repository = FakeMqEventRepository()

    ack = process_laboratory_event(
        "mes/v1/labs/salt-spray-lab-01/events/experiment-result",
        {
            "lab_code": "LAB_SALT",
            "run_no": "RUN-SALT-001",
            "task_code": "SYLU-2026-03-OLD",
            "experiment_code": "SYLU-2026-03-001-OLD",
            "result_at": "2026-05-16 17:30:00",
            "result_package": {
                "result_id": "R-001",
                "conclusion": "PASS",
                "summary": "合格",
                "items": [],
                "attachments": [],
            },
        },
        repository=repository,
    )

    assert ack["status"] == "PROCESSED"
    assert repository.messages[0]["task_no"] == "SYLU-2026-03-001"
    assert repository.messages[0]["experiment_no"] == "SYLU-2026-03-001-A"
    assert repository.results[0]["task_no"] == "SYLU-2026-03-001"
    assert repository.results[0]["experiment_no"] == "SYLU-2026-03-001-A"


def test_inbound_event_endpoint_uses_processor(monkeypatch):
    calls = []

    def fake_process(topic, payload):
        calls.append((topic, payload))
        return {"message_type": "EVENT_ACK", "correlation_id": payload["lab_code"], "status": "PROCESSED"}

    monkeypatch.setattr(mq_route, "process_laboratory_event", fake_process)
    app = FastAPI()
    app.include_router(mq_route.router)
    client = TestClient(app)

    response = client.post(
        "/api/mq/laboratory/events/fixture-ready",
        json={
            "task_code": "SYLU-2026-03-001",
            "lab_code": "LAB_SALT",
            "success_id": "PLC-OK-001",
            "fixture_ready_at": "2026-05-16 09:31:00",
        },
    )

    assert response.status_code == 200
    assert response.json()["status"] == "PROCESSED"
    assert calls[0][0] == "mes/v1/labs/LAB_SALT/events/fixture-ready"
