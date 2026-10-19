from tools.upper_computer_simulator import app as simulator_app
import pytest


BASE_DIR = simulator_app.BASE_DIR


class FakeTimer:
    created = []

    def __init__(self, delay, callback):
        self.delay = delay
        self.callback = callback
        self.cancelled = False
        self.daemon = False
        self.started = False
        self.__class__.created.append(self)

    def start(self):
        self.started = True

    def cancel(self):
        self.cancelled = True


class FakeMessage:
    def __init__(self, topic, payload):
        self.topic = topic
        self.payload = simulator_app.json.dumps(payload).encode("utf-8")


def build_auto_simulator(monkeypatch):
    FakeTimer.created = []
    monkeypatch.setattr(simulator_app.threading, "Timer", FakeTimer)
    simulator = simulator_app.MqttSimulator()
    simulator._config = simulator_app.MqttConfig(auto_mode=True)
    simulator._lab_contexts["LAB_SALT"] = {
        "task_code": "TASK-1",
        "experiment_code": "EXP-1",
        "run_no": "RUN-1",
    }
    published = []

    def fake_publish(event_name, payload, lab_code=None):
        published.append((event_name, dict(payload), lab_code))
        return {"ok": True, "payload": payload}

    monkeypatch.setattr(simulator, "publish", fake_publish)
    return simulator, published


def test_auto_mode_does_not_send_experiment_ended_after_started(monkeypatch):
    simulator, published = build_auto_simulator(monkeypatch)

    simulator._maybe_auto_reply(
        "experiment-ready",
        "mes/v1/labs/LAB_SALT/commands/experiment-ready",
        {"lab_code": "LAB_SALT", "run_no": "RUN-1"},
    )

    started_timer = FakeTimer.created[0]
    started_timer.callback()

    assert len(FakeTimer.created) == 1
    assert [event[0] for event in published] == ["experiment-started"]
    assert published[0][1]["run_no"] == "RUN-1"


def test_end_request_emits_experiment_end_after_started(monkeypatch):
    simulator, published = build_auto_simulator(monkeypatch)
    simulator._maybe_auto_reply(
        "experiment-ready",
        "mes/v1/labs/LAB_SALT/commands/experiment-ready",
        {"lab_code": "LAB_SALT", "run_no": "RUN-1"},
    )
    FakeTimer.created[0].callback()

    simulator._maybe_auto_reply(
        "experiment-end-request",
        "mes/v1/labs/LAB_SALT/commands/experiment-end-request",
        {"lab_code": "LAB_SALT", "run_no": "RUN-1"},
    )

    immediate_timer = FakeTimer.created[1]
    assert immediate_timer.delay == 0
    immediate_timer.callback()
    assert [event[0] for event in published] == ["experiment-started", "experiment-ended"]


def test_end_request_emits_each_axis_once_within_the_same_run(monkeypatch):
    simulator, published = build_auto_simulator(monkeypatch)
    topic = "mes/v1/labs/LAB_SALT/commands/experiment-end-request"

    simulator._maybe_auto_reply(
        "experiment-end-request",
        topic,
        {
            "lab_code": "LAB_SALT",
            "run_no": "RUN-1",
            "sub_experiment_code": "EXP-1-AXIS",
            "axis_code": "x+",
            "next_axis_code": "y-",
        },
    )
    FakeTimer.created[-1].callback()
    simulator._maybe_auto_reply(
        "experiment-end-request",
        topic,
        {
            "lab_code": "LAB_SALT",
            "run_no": "RUN-1",
            "sub_experiment_code": "EXP-1-AXIS",
            "axis_code": "y-",
        },
    )
    FakeTimer.created[-1].callback()
    simulator._maybe_auto_reply(
        "experiment-end-request",
        topic,
        {
            "lab_code": "LAB_SALT",
            "run_no": "RUN-1",
            "sub_experiment_code": "EXP-1-AXIS",
            "axis_code": "y-",
        },
    )
    FakeTimer.created[-1].callback()

    ended_payloads = [payload for event, payload, _lab_code in published if event == "experiment-ended"]
    assert [payload["axis_code"] for payload in ended_payloads] == ["x+", "y-"]


def test_final_axis_end_request_does_not_reuse_stale_next_axis(monkeypatch):
    simulator, published = build_auto_simulator(monkeypatch)
    simulator._lab_contexts["LAB_SALT"].update({
        "axis_codes": ["x+", "y-"],
        "current_axis_code": "x+",
        "next_axis_code": "y-",
        "sub_experiment_code": "EXP-1-AXIS",
    })

    simulator._maybe_auto_reply(
        "experiment-end-request",
        "mes/v1/labs/LAB_SALT/commands/experiment-end-request",
        {
            "lab_code": "LAB_SALT",
            "run_no": "RUN-1",
            "sub_experiment_code": "EXP-1-AXIS",
            "axis_code": "y-",
        },
    )
    FakeTimer.created[-1].callback()

    ended_payload = published[-1][1]
    assert ended_payload["axis_code"] == "y-"
    assert "next_axis_code" not in ended_payload


def test_repeated_ready_for_same_run_updates_axis_and_started_payload(monkeypatch):
    simulator, published = build_auto_simulator(monkeypatch)
    topic = "mes/v1/labs/LAB_SALT/commands/experiment-ready"
    simulator._lab_contexts["LAB_SALT"]["next_axis_code"] = "x+"

    simulator._on_message(
        None,
        None,
        FakeMessage(
            topic,
            {
                "lab_code": "LAB_SALT",
                "run_no": "RUN-1",
                "sub_experiment_code": "EXP-1-AXIS",
                "current_axis_code": "x+",
            },
        ),
    )
    first_started_timer = FakeTimer.created[-1]
    first_started_timer.callback()

    simulator._on_message(
        None,
        None,
        FakeMessage(
            topic,
            {
                "lab_code": "LAB_SALT",
                "run_no": "RUN-1",
                "sub_experiment_code": "EXP-1-AXIS",
                "current_axis_code": "x-",
            },
        ),
    )
    second_started_timer = FakeTimer.created[-1]
    second_started_timer.callback()

    started_payloads = [payload for event, payload, _lab_code in published if event == "experiment-started"]
    assert [payload["current_axis_code"] for payload in started_payloads] == ["x+", "x-"]
    assert all(payload["run_no"] == "RUN-1" for payload in started_payloads)
    assert all(payload["sub_experiment_code"] == "EXP-1-AXIS" for payload in started_payloads)
    assert all("next_axis_code" not in payload for payload in started_payloads)
    assert simulator._lab_contexts["LAB_SALT"]["current_axis_code"] == "x-"
    assert "next_axis_code" not in simulator._lab_contexts["LAB_SALT"]


def test_delayed_started_reply_keeps_the_ready_command_axis_snapshot(monkeypatch):
    simulator, published = build_auto_simulator(monkeypatch)
    topic = "mes/v1/labs/LAB_SALT/commands/experiment-ready"

    for axis_code in ("x+", "x-"):
        simulator._on_message(
            None,
            None,
            FakeMessage(
                topic,
                {
                    "lab_code": "LAB_SALT",
                    "run_no": "RUN-1",
                    "sub_experiment_code": "EXP-1-AXIS",
                    "current_axis_code": axis_code,
                },
            ),
        )

    first_started_timer, second_started_timer = FakeTimer.created
    first_started_timer.callback()
    second_started_timer.callback()

    started_payloads = [payload for event, payload, _lab_code in published if event == "experiment-started"]
    assert [payload["current_axis_code"] for payload in started_payloads] == ["x+", "x-"]


def test_auto_mode_acknowledges_salt_pause_with_exact_command_context(monkeypatch):
    simulator, published = build_auto_simulator(monkeypatch)
    command_payload = {
        "lab_code": "LAB_SALT",
        "task_code": "TASK-1",
        "experiment_code": "EXP-1",
        "run_no": "RUN-1",
        "pause_no": "PAUSE-1",
        "inspection_tray_codes": ["TP-1", "TP-2"],
        "pause_reason": "中途外观检查",
    }

    simulator._on_message(
        None,
        None,
        FakeMessage("mes/v1/labs/LAB_SALT/commands/experiment-pause-request", command_payload),
    )
    FakeTimer.created[-1].callback()

    event_name, payload, lab_code = published[-1]
    assert event_name == "experiment-paused"
    assert lab_code == "LAB_SALT"
    for field in ("lab_code", "task_code", "experiment_code", "run_no", "pause_no", "inspection_tray_codes"):
        assert payload[field] == command_payload[field]
    assert payload["paused_at"]
    assert payload["message_id"].startswith("HOST-EXPERIMENT-PAUSED-")
    assert simulator.state()["lastMessages"]["experiment-pause-request"]["payload"]["pause_no"] == "PAUSE-1"


def test_auto_mode_acknowledges_salt_resume_and_stop(monkeypatch):
    simulator, published = build_auto_simulator(monkeypatch)
    cases = (
        ("experiment-resume-request", "experiment-resumed", "resumed_at", {}),
        (
            "experiment-stop-request",
            "experiment-stopped",
            "stopped_at",
            {"termination_type": "abnormal", "termination_reason": "设备故障"},
        ),
    )

    for command, expected_event, event_time_field, extra in cases:
        simulator._on_message(
            None,
            None,
            FakeMessage(
                f"mes/v1/labs/LAB_SALT/commands/{command}",
                {
                    "lab_code": "LAB_SALT",
                    "task_code": "TASK-1",
                    "experiment_code": "EXP-1",
                    "run_no": "RUN-1",
                    "pause_no": "PAUSE-1",
                    **extra,
                },
            ),
        )
        FakeTimer.created[-1].callback()
        event_name, payload, lab_code = published[-1]
        assert event_name == expected_event
        assert lab_code == "LAB_SALT"
        assert payload["run_no"] == "RUN-1"
        assert payload["pause_no"] == "PAUSE-1"
        assert payload[event_time_field]
        for field, value in extra.items():
            assert payload[field] == value


def test_auto_mode_waits_for_resume_request_after_resume_preparation_ready(monkeypatch):
    simulator, published = build_auto_simulator(monkeypatch)
    context = {
        "lab_code": "LAB_SALT",
        "task_code": "TASK-1",
        "experiment_code": "EXP-1",
        "run_no": "RUN-1",
        "pause_no": "PAUSE-1",
    }

    simulator._maybe_auto_reply(
        "experiment-ready",
        "mes/v1/labs/LAB_SALT/commands/experiment-ready",
        {**context, "resume_preparation": True},
    )

    assert FakeTimer.created == []
    assert published == []
    assert "等待 MES 下发 experiment-resume-request" in simulator.logs()[0]["message"]

    simulator._maybe_auto_reply(
        "experiment-resume-request",
        "mes/v1/labs/LAB_SALT/commands/experiment-resume-request",
        context,
    )
    FakeTimer.created[-1].callback()

    event_name, payload, lab_code = published[-1]
    assert event_name == "experiment-resumed"
    assert lab_code == "LAB_SALT"
    assert payload["run_no"] == "RUN-1"
    assert payload["pause_no"] == "PAUSE-1"


def test_axis_end_request_keeps_explicit_next_axis_after_ready_switch(monkeypatch):
    simulator, published = build_auto_simulator(monkeypatch)
    ready_topic = "mes/v1/labs/LAB_SALT/commands/experiment-ready"
    end_topic = "mes/v1/labs/LAB_SALT/commands/experiment-end-request"

    simulator._on_message(
        None,
        None,
        FakeMessage(
            ready_topic,
            {
                "lab_code": "LAB_SALT",
                "run_no": "RUN-1",
                "sub_experiment_code": "EXP-1-AXIS",
                "current_axis_code": "x-",
            },
        ),
    )
    simulator._on_message(
        None,
        None,
        FakeMessage(
            end_topic,
            {
                "lab_code": "LAB_SALT",
                "run_no": "RUN-1",
                "sub_experiment_code": "EXP-1-AXIS",
                "axis_code": "x-",
                "next_axis_code": "y+",
            },
        ),
    )
    FakeTimer.created[-1].callback()

    ended_payloads = [payload for event, payload, _lab_code in published if event == "experiment-ended"]
    assert len(ended_payloads) == 1
    assert ended_payloads[0]["run_no"] == "RUN-1"
    assert ended_payloads[0]["sub_experiment_code"] == "EXP-1-AXIS"
    assert ended_payloads[0]["axis_code"] == "x-"
    assert ended_payloads[0]["next_axis_code"] == "y+"


def test_log_view_preserves_review_context_and_limits_initial_dom_size():
    app_script = (BASE_DIR / "static" / "app.js").read_text(encoding="utf-8")
    styles = (BASE_DIR / "static" / "styles.css").read_text(encoding="utf-8")
    page = (BASE_DIR / "static" / "index.html").read_text(encoding="utf-8")

    assert "const LOG_PAGE_SIZE = 100" in app_script
    assert "selectionIsInsideLogs()" in app_script
    assert "isReviewingOlderLogs()" in app_script
    assert "state.pendingLogs = logs" in app_script
    assert "state.visibleLogLimit += LOG_PAGE_SIZE" in app_script
    assert 'data-log-index="${index}"' in app_script
    assert "renderedLogSignature" in app_script
    assert "user-select: text" in styles
    assert ".log-row ::selection" in styles
    assert 'id="copyLogsBtn"' in page
    assert 'id="pauseLogsBtn"' in page
    assert 'id="logUpdateNotice"' in page


def test_telemetry_publishes_all_laboratories_with_hot_humid_two_without_carrier():
    simulator = simulator_app.MqttSimulator()

    class PublishResult:
        rc = 0

    class Client:
        def __init__(self):
            self.messages = []

        def publish(self, topic, payload, qos=0, retain=False):
            self.messages.append((topic, simulator_app.json.loads(payload), qos, retain))
            return PublishResult()

    client = Client()
    simulator._client = client
    simulator._connected = True
    simulator.publish_all_telemetry()

    assert len(client.messages) == 11
    assert all(message[2] == 1 for message in client.messages)
    hot_humid_two = next(message[1] for message in client.messages if message[1]["lab_code"] == "LAB_HOT_HUMID_2")
    assert hot_humid_two["carrier_device"]["configured"] is False
    assert hot_humid_two["environment"]["temperature_c"] is not None
    assert hot_humid_two["test_device"]["online"] is True


def test_telemetry_values_change_on_each_three_second_cycle(monkeypatch):
    simulator = simulator_app.MqttSimulator()

    class PublishResult:
        rc = 0

    class Client:
        def __init__(self):
            self.messages = []

        def publish(self, topic, payload, qos=0, retain=False):
            self.messages.append((topic, simulator_app.json.loads(payload)))
            return PublishResult()

    sin_calls = 0

    def fake_sin(_value):
        nonlocal sin_calls
        sin_calls += 1
        return 0.0 if sin_calls <= len(simulator_app.LABORATORIES) else 1.0

    monkeypatch.setattr(simulator_app.math, "sin", fake_sin)
    client = Client()
    simulator._client = client
    simulator._connected = True
    simulator.publish_all_telemetry()
    first = next(payload for _topic, payload in client.messages if payload["lab_code"] == "LAB_IMPACT_1")
    client.messages.clear()
    simulator.publish_all_telemetry()
    second = next(payload for _topic, payload in client.messages if payload["lab_code"] == "LAB_IMPACT_1")

    assert simulator_app.TELEMETRY_INTERVAL_SECONDS == 1
    assert second["sequence"] == first["sequence"] + 1
    assert second["environment"]["temperature_c"] != first["environment"]["temperature_c"]


def test_every_tenth_cycle_injects_one_visible_fault_for_three_cycles(monkeypatch):
    simulator = simulator_app.MqttSimulator()

    class PublishResult:
        rc = 0

    class Client:
        def __init__(self):
            self.messages = []

        def publish(self, topic, payload, qos=0, retain=False):
            self.messages.append((topic, simulator_app.json.loads(payload)))
            return PublishResult()

    monkeypatch.setattr(
        simulator,
        "_new_random_fault",
        lambda _codes: {
            "lab_code": "LAB_VIBRATION_1",
            "fault_type": "temperature_high",
            "value": 68.5,
            "message": "试验设备温度过高：68.5 °C（上限 60 °C）",
            "remaining_cycles": 3,
        },
    )
    client = Client()
    simulator._client = client
    simulator._connected = True
    simulator._telemetry_cycle = 9

    simulator.publish_all_telemetry()

    vibration = next(payload for _topic, payload in client.messages if payload["lab_code"] == "LAB_VIBRATION_1")
    normal_labs = [payload for _topic, payload in client.messages if payload["lab_code"] != "LAB_VIBRATION_1"]
    assert vibration["cycle"] == 10
    assert vibration["test_device"]["temperature_c"] == 68.5
    assert vibration["alarms"][0]["code"] == "TEST_DEVICE_TEMPERATURE_HIGH"
    assert all(not payload["alarms"] for payload in normal_labs)
    assert simulator.telemetry_meta()["active_fault"]["remaining_cycles"] == 2


def test_simulator_page_separates_telemetry_and_workflow_interfaces():
    page = (BASE_DIR / "static" / "index.html").read_text(encoding="utf-8")
    script = (BASE_DIR / "static" / "app.js").read_text(encoding="utf-8")

    assert 'id="telemetryPage"' in page
    assert 'id="workflowPage"' in page
    assert 'id="telemetryTab"' in page
    assert 'id="workflowTab"' in page
    assert "setWorkspacePage" in script
    assert "LAB_HOT_HUMID_2" in script


class TelemetryRecordingClient:
    def __init__(self):
        self.messages = []

    def publish(self, topic, payload, qos=0, retain=False):
        self.messages.append(simulator_app.json.loads(payload))
        return type("Result", (), {"rc": 0})()


@pytest.mark.parametrize("kind,duration", [("temperature_high", 3), ("voltage_low", 3), ("test_device_offline", 6), ("carrier_device_offline", 6), ("host_offline", 20), ("telemetry_delayed", 7)])
def test_random_event_pool_has_all_conditions_and_matching_durations(monkeypatch, kind, duration):
    choices = iter(["LAB_IMPACT_1", kind])
    monkeypatch.setattr(simulator_app.random, "choice", lambda options: next(choices))
    fault = simulator_app.MqttSimulator()._new_random_fault(["LAB_IMPACT_1"])
    assert fault["remaining_cycles"] == duration
    assert fault["fault_type"] == kind


def test_hot_humid_two_random_pool_excludes_nonexistent_carrier(monkeypatch):
    def choose(options):
        assert "carrier_device_offline" not in options
        return options[0]
    monkeypatch.setattr(simulator_app.random, "choice", choose)
    simulator_app.MqttSimulator()._new_random_fault(["LAB_HOT_HUMID_2"])


@pytest.mark.parametrize("kind,duration", [("host_offline", 20), ("telemetry_delayed", 7)])
def test_suppressed_lab_stops_publishing_and_returns_after_duration(monkeypatch, kind, duration):
    simulator = simulator_app.MqttSimulator()
    simulator._client = client = TelemetryRecordingClient()
    simulator._connected = True
    simulator.publish_all_telemetry()
    simulator._telemetry_faults["LAB_IMPACT_1"] = {"lab_code": "LAB_IMPACT_1", "fault_type": kind, "remaining_cycles": duration}
    monkeypatch.setattr(simulator, "_new_random_fault", lambda codes: None)
    for _ in range(duration):
        client.messages.clear()
        simulator.publish_all_telemetry()
        assert len(client.messages) == 10
        assert all(msg["lab_code"] != "LAB_IMPACT_1" for msg in client.messages)
    client.messages.clear()
    simulator.publish_all_telemetry()
    assert len(client.messages) == 11


@pytest.mark.parametrize("key", ["test_device", "carrier_device"])
def test_device_loss_reports_false_and_preserves_other_channels(key):
    simulator = simulator_app.MqttSimulator()
    simulator._client = client = TelemetryRecordingClient()
    simulator._connected = True
    simulator.publish_all_telemetry()
    simulator._telemetry_faults["LAB_IMPACT_1"] = {"lab_code": "LAB_IMPACT_1", "fault_type": key + "_offline", "remaining_cycles": 6}
    client.messages.clear()
    simulator.publish_all_telemetry()
    row = next(msg for msg in client.messages if msg["lab_code"] == "LAB_IMPACT_1")
    assert row[key]["online"] is False
    assert row[key]["temperature_c"] is None
    assert row["environment"]["quality"] == "good"
    assert row["carrier_device" if key == "test_device" else "test_device"]["online"] is True
    assert not row["alarms"]


def test_long_fault_survives_next_tenth_cycle_and_uses_another_lab(monkeypatch):
    simulator = simulator_app.MqttSimulator()
    simulator._client = TelemetryRecordingClient()
    simulator._connected = True
    simulator._telemetry_cycle = 19
    simulator._telemetry_faults["LAB_IMPACT_1"] = {"lab_code": "LAB_IMPACT_1", "fault_type": "host_offline", "remaining_cycles": 10}
    def new_fault(codes):
        assert "LAB_IMPACT_1" not in codes
        return {"lab_code": "LAB_IMPACT_2", "fault_type": "voltage_low", "value": 80, "message": "test", "remaining_cycles": 3}
    monkeypatch.setattr(simulator, "_new_random_fault", new_fault)
    simulator.publish_all_telemetry()
    assert simulator._telemetry_faults["LAB_IMPACT_1"]["remaining_cycles"] == 9
    assert simulator._telemetry_faults["LAB_IMPACT_2"]["remaining_cycles"] == 2
