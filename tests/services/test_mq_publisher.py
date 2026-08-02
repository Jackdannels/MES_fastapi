import json
import logging
import threading

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.core.performance import PerformanceMiddleware
from app.services import mq_publisher


def test_persistent_publisher_retries_once_after_automatic_reconnect(monkeypatch):
    calls = []

    class PublishResult:
        def __init__(self, rc):
            self.rc = rc

        def wait_for_publish(self, timeout=None):
            calls.append(("wait", timeout))

        def is_published(self):
            return self.rc == 0

    class FakeClient:
        def __init__(self):
            self.on_connect = None
            self.on_disconnect = None
            self.publish_count = 0

        def username_pw_set(self, _username, _password):
            pass

        def reconnect_delay_set(self, min_delay=1, max_delay=120):
            calls.append(("reconnect_delay", min_delay, max_delay))

        def connect(self, _host, _port, keepalive=60):
            return 0

        def loop_start(self):
            self.on_connect(self, None, None, 0)

        def publish(self, _topic, _payload, qos=0, retain=False):
            self.publish_count += 1
            calls.append(("publish", self.publish_count, qos, retain))
            if self.publish_count == 1:
                self.on_disconnect(self, None, None, 1)
                threading.Timer(0.01, lambda: self.on_connect(self, None, None, 0)).start()
                return PublishResult(4)
            return PublishResult(0)

        def disconnect(self):
            pass

        def loop_stop(self):
            pass

    publisher = mq_publisher.MqttPublisher(
        Settings(MQTT_ENABLED=True, MQTT_CONNECT_TIMEOUT_SECONDS=0.5),
    )

    def build_client():
        client = FakeClient()
        client.on_connect = lambda *_args: publisher._connected.set()
        client.on_disconnect = lambda *_args: publisher._connected.clear()
        return client

    monkeypatch.setattr(publisher, "_build_client", build_client)
    try:
        result = publisher.publish_json("mes/v1/labs/LAB_SALT/commands/experiment-ready", {"cmd": "READY"})
    finally:
        publisher.shutdown()

    assert result["published"] is True
    assert [call for call in calls if call[0] == "publish"] == [
        ("publish", 1, 1, False),
        ("publish", 2, 1, False),
    ]


def test_disabled_publish_keeps_existing_result_and_does_not_start_client(monkeypatch):
    monkeypatch.setattr(
        mq_publisher,
        "start_mqtt_publisher",
        lambda _settings: (_ for _ in ()).throw(AssertionError("must not start")),
    )

    result = mq_publisher.publish_mqtt_json(
        "mes/v1/labs/LAB_SALT/commands/experiment-ready",
        {"cmd": "READY"},
        Settings(MQTT_ENABLED=False),
    )

    assert result == {
        "published": False,
        "reason": "disabled",
        "topic": "mes/v1/labs/LAB_SALT/commands/experiment-ready",
    }


def test_publish_adds_server_timing_and_structured_slow_log(monkeypatch, caplog):
    class FakePublisher:
        def publish_json(self, topic, _payload):
            return {"published": True, "reason": "", "topic": topic}

    monkeypatch.setattr(mq_publisher, "start_mqtt_publisher", lambda _settings: FakePublisher())
    app_settings = Settings(MQTT_ENABLED=True, MQTT_PUBLISH_SLOW_MS=0)
    app = FastAPI()
    app.add_middleware(PerformanceMiddleware, enabled=True, log_all_requests=False, slow_request_ms=10_000)

    @app.post("/publish")
    def publish():
        return mq_publisher.publish_mqtt_json(
            "mes/v1/labs/LAB_SALT/commands/experiment-ready",
            {"cmd": "READY"},
            app_settings,
        )

    with caplog.at_level(logging.INFO, logger="mes.mqtt.publisher"):
        response = TestClient(app).post("/publish")

    assert response.status_code == 200
    assert "mqtt.publish" in response.headers["server-timing"]
    payload = json.loads(next(record.message for record in caplog.records if "mqtt_publish_performance" in record.message))
    assert payload["published"] is True
    assert payload["qos"] == 1
    assert isinstance(payload["durationMs"], float)
    assert payload["durationMs"] >= 0


def test_failed_publish_is_counted_and_logged_without_payload(monkeypatch, caplog):
    class FakePublisher:
        def publish_json(self, _topic, _payload):
            raise ConnectionError("broker unavailable")

    monkeypatch.setattr(mq_publisher, "start_mqtt_publisher", lambda _settings: FakePublisher())
    secret_payload = {"token": "must-not-be-logged"}

    with caplog.at_level(logging.WARNING, logger="mes.mqtt.publisher"):
        try:
            mq_publisher.publish_mqtt_json(
                "mes/v1/labs/LAB_SALT/commands/experiment-ready",
                secret_payload,
                Settings(MQTT_ENABLED=True),
            )
        except RuntimeError:
            pass
        else:
            raise AssertionError("publish failure should remain an exception")

    record = next(record for record in caplog.records if "mqtt_publish_performance" in record.message)
    payload = json.loads(record.message)
    assert payload["published"] is False
    assert payload["reason"] == "broker unavailable"
    assert "must-not-be-logged" not in record.message
