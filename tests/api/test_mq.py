from fastapi import FastAPI
from fastapi.testclient import TestClient
from types import ModuleType

from app.api.routes import mq as mq_route
from app import main as app_main
from app.core.config import Settings
from app.services import mq_publisher
from app.services import mq_runtime
from app.services import mq_subscriber
from app.services.mq_event_processor import MySQLMqEventRepository, process_laboratory_event


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
    assert response.json()["ok"] is True
    assert published == [
        {
            "command": "READY",
                "payload": {
                    "task_code": "SYLU-2026-03-001",
                    "lab_code": "LAB_SALT",
                    "experiment_code": "",
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


def test_create_app_starts_mqtt_subscriber_only_when_enabled(monkeypatch):
    calls = []

    monkeypatch.setattr(mq_runtime.MqttRuntimeController, "shutdown", lambda self: calls.append(("shutdown", self.mode)))

    app = app_main.create_app(Settings(MQTT_ENABLED=True))
    with TestClient(app) as client:
        assert client.get("/api/mq/interface-mode").json() == {
            "ok": True,
            "mode": "mock",
            "mqtt_enabled": True,
            "subscriber_running": False,
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
    app.state.mq_runtime = mq_runtime.MqttRuntimeController(Settings(MQTT_ENABLED=True), starter=fake_start)
    app.include_router(mq_route.router)
    client = TestClient(app)

    mqtt_response = client.post("/api/mq/interface-mode", json={"mode": "mqtt"})
    assert mqtt_response.status_code == 200
    assert mqtt_response.json() == {
        "ok": True,
        "mode": "mqtt",
        "mqtt_enabled": True,
        "subscriber_running": True,
        "reason": "",
    }

    mock_response = client.post("/api/mq/interface-mode", json={"mode": "mock"})
    assert mock_response.status_code == 200
    assert mock_response.json() == {
        "ok": True,
        "mode": "mock",
        "mqtt_enabled": True,
        "subscriber_running": False,
        "reason": "paused",
    }
    assert calls == [("start", True), "stop"]


def test_interface_mode_endpoint_does_not_start_subscriber_when_env_disabled():
    calls = []
    app = FastAPI()
    app.state.mq_runtime = mq_runtime.MqttRuntimeController(
        Settings(MQTT_ENABLED=False),
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
        "reason": "disabled",
    }
    assert calls == []


def test_interface_mode_endpoint_reports_startup_failure_and_keeps_previous_mode():
    app = FastAPI()
    app.state.mq_runtime = mq_runtime.MqttRuntimeController(
        Settings(MQTT_ENABLED=True),
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
        self.legacy_started = []
        self.legacy_ended = []
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

    def mark_experiment_started(self, task_no, experiment_no, occurred_at):
        self.legacy_started.append((task_no, experiment_no, occurred_at))

    def mark_experiment_ended(self, task_no, experiment_no, occurred_at):
        self.legacy_ended.append((task_no, experiment_no, occurred_at))

    def find_active_run_by_lab(self, lab_code):
        return self.runs_by_lab.get(lab_code)

    def find_current_context_by_lab(self, lab_code, candidate_statuses):
        context = self.contexts_by_lab.get(lab_code)
        if not context:
            return None
        return {**context, "candidate_statuses": list(candidate_statuses)}

    def start_run_for_context(self, context, occurred_at):
        self.started_contexts.append((dict(context), occurred_at))
        return {
            "run_no": "RUN-CREATED-FROM-LAB",
            "task_no": context["task_no"],
            "experiment_no": context["experiment_no"],
            "device_name": context["device_name"],
            "run_status": "实验进行中",
        }

    def mark_run_started(self, run_no, occurred_at):
        self.started.append((run_no, occurred_at))

    def mark_run_ended(self, run_no, occurred_at):
        self.ended.append((run_no, occurred_at))


def test_process_fixture_ready_records_event_and_returns_ack():
    repository = FakeMqEventRepository()

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

    assert ack["message_type"] == "EVENT_ACK"
    assert ack["correlation_id"] == "HOST-FIXTURE_READY-LAB_SALT-2026-05-16 09:31:00"
    assert ack["status"] == "PROCESSED"
    assert repository.messages[0]["message_type"] == "FIXTURE_READY"
    assert repository.events == [
        {
            "event_type": "FIXTURE_READY",
            "task_no": "SYLU-2026-03-001",
            "experiment_no": "",
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
            "success_id": "PLC-OK-001",
            "fixture_ready_at": "2026-05-16 09:31:00",
        },
        repository=repository,
    )

    assert ack["status"] == "PROCESSED"
    assert repository.events[0]["task_no"] == "SYLU-2026-03-001"
    assert repository.events[0]["experiment_no"] == "SYLU-2026-03-001-A"
    assert repository.events[0]["payload"] == {
        "lab_code": "LAB_SALT",
        "success_id": "PLC-OK-001",
        "fixture_ready_at": "2026-05-16 09:31:00",
    }


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


def test_process_experiment_started_marks_actual_start():
    repository = FakeMqEventRepository()

    ack = process_laboratory_event(
        "mes/v1/labs/salt-spray-lab-01/events/experiment-started",
        {
            "lab_code": "LAB_SALT",
            "started_at": "2026-05-16 10:00:00",
        },
        repository=repository,
    )

    assert ack["status"] == "PROCESSED"
    assert repository.started == [("RUN-SALT-001", "2026-05-16 10:00:00")]


def test_process_experiment_started_creates_run_from_ready_lab_context_when_no_active_run():
    repository = FakeMqEventRepository()
    repository.runs_by_lab = {}

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
    assert repository.events[0]["event_type"] == "EXPERIMENT_STARTED"


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


def test_mysql_start_run_handles_tuple_cursor_sample_rows(monkeypatch):
    class TupleCursor:
        description = None

        def __init__(self):
            self.sample_events = []

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def execute(self, sql, params=None):
            if "SELECT sm.sample_id, sm.sample_no, task.task_id" in sql:
                self.description = (("sample_id",), ("sample_no",), ("task_id",))
            else:
                self.description = None

        def executemany(self, sql, rows):
            if "INSERT INTO biz_sample_event" in sql:
                self.sample_events.extend(rows)

        def fetchall(self):
            if self.description:
                return [(101, "SYLU-2026-03-001-SP-001", 11)]
            return []

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
    monkeypatch.setattr("app.services.mq_event_processor.get_connection", lambda: connection)

    run = MySQLMqEventRepository().start_run_for_context(
        {
            "task_no": "SYLU-2026-03-001",
            "experiment_no": "SYLU-2026-03-001-A",
            "schedule_no": "schedule-salt",
            "device_name": "盐雾试验室",
            "planned_hours": 3.5,
            "tray_nos": ["SYLU-2026-03-001-TP-001"],
            "sample_nos": ["SYLU-2026-03-001-SP-001"],
        },
        "2026-05-16 10:00:00",
    )

    assert run["run_status"] == "实验进行中"
    assert connection.committed is True
    assert connection.cursor_obj.sample_events


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


def test_mysql_find_current_context_filters_schedules_to_current_lab(monkeypatch):
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
            if columns == ["schedule_no", "task_no", "experiment_no", "device_name", "planned_hours", "schedule_end_time"]:
                if self.schedule_query_params and "冲击一室" in self.schedule_query_params:
                    return [
                        (
                            "schedule-impact",
                            "SYLU-2026-06-002",
                            "SYLU-2026-06-002-C",
                            "冲击一室",
                            3.5,
                            "2026-06-03 15:30:00",
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
                    ),
                    (
                        "schedule-impact",
                        "SYLU-2026-06-002",
                        "SYLU-2026-06-002-C",
                        "冲击一室",
                        3.5,
                        "2026-06-03 15:30:00",
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


def test_mysql_mark_run_ended_handles_tuple_cursor_tray_rows(monkeypatch):
    class TupleCursor:
        description = None

        def __init__(self):
            self.executed_sql = []

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def execute(self, sql, params=None):
            self.executed_sql.append(sql)
            if "SELECT task_no, experiment_no" in sql:
                self.description = (("task_no",), ("experiment_no",))
            elif "SELECT tray_no" in sql:
                self.description = (("tray_no",),)
            else:
                self.description = None

        def fetchone(self):
            columns = [column[0] for column in (self.description or [])]
            if columns == ["task_no", "experiment_no"]:
                return ("SYLU-2026-03-001", "SYLU-2026-03-001-A")
            return None

        def fetchall(self):
            columns = [column[0] for column in (self.description or [])]
            if columns == ["tray_no"]:
                return [("SYLU-2026-03-001-TP-001",)]
            return []

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
    monkeypatch.setattr("app.services.mq_event_processor.get_connection", lambda: connection)

    MySQLMqEventRepository().mark_run_ended("RUN-SALT-001", "2026-05-16 12:00:00")

    assert connection.committed is True
    assert any("UPDATE biz_tray" in sql for sql in connection.cursor_obj.executed_sql)


def test_process_experiment_started_rejects_lab_without_ready_context():
    repository = FakeMqEventRepository()
    repository.runs_by_lab = {}
    repository.contexts_by_lab = {}

    try:
        process_laboratory_event(
            "mes/v1/labs/LAB_SALT/events/experiment-started",
            {
                "lab_code": "LAB_SALT",
                "started_at": "2026-05-16 10:00:00",
            },
            repository=repository,
        )
    except ValueError as exc:
        assert "ready experiment context is required" in str(exc)
    else:
        raise AssertionError("expected ready context validation error")


def test_process_experiment_ended_marks_active_run_by_lab_code():
    repository = FakeMqEventRepository()

    ack = process_laboratory_event(
        "mes/v1/labs/LAB_SALT/events/experiment-ended",
        {
            "lab_code": "LAB_SALT",
            "ended_at": "2026-05-16 11:00:00",
        },
        repository=repository,
    )

    assert ack["status"] == "PROCESSED"
    assert repository.ended == [("RUN-SALT-001", "2026-05-16 11:00:00")]
    assert repository.events[0]["task_no"] == "SYLU-2026-03-001"
    assert repository.events[0]["experiment_no"] == "SYLU-2026-03-001-A"


def test_process_experiment_result_records_result_package():
    repository = FakeMqEventRepository()

    ack = process_laboratory_event(
        "mes/v1/labs/salt-spray-lab-01/events/experiment-result",
        {
            "lab_code": "LAB_SALT",
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
    assert repository.results[0]["conclusion"] == "PASS"
    assert repository.results[0]["summary"] == "合格"


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
