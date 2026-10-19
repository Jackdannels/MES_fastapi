from unittest.mock import Mock

from fastapi.testclient import TestClient
import pytest

from tools.upper_computer_simulator import runtime
from tools.lims_simulator import app as lims


def test_container_operator_requires_explicit_exact_origin(monkeypatch):
    client = TestClient(lims.app, client=("172.18.0.1", 12345))
    endpoint = "/api/communication/faults"
    origin = "http://testserver"
    monkeypatch.delenv("LIMS_OPERATOR_ORIGINS", raising=False)
    assert client.post(endpoint, json={}, headers={"Origin": origin}).status_code == 403
    monkeypatch.setenv("LIMS_OPERATOR_ORIGINS", origin)
    fake = Mock()
    monkeypatch.setattr(lims.simulator, "communication", fake)
    assert client.post(endpoint, json={}).status_code == 403
    assert client.post(endpoint, json={}, headers={"Origin": "http://evil.invalid"}).status_code == 403
    assert client.post(endpoint, json={}, headers={"X-Forwarded-For": "127.0.0.1"}).status_code == 403
    assert client.post(endpoint, json={}, headers={"Origin": origin}).status_code == 200
    fake.set_faults.assert_called_once()


def test_upper_container_connects_from_environment_and_disconnects(monkeypatch):
    monkeypatch.setenv("SIMULATOR_AUTO_CONNECT", "true")
    monkeypatch.setenv("MQTT_HOST", "test-broker")
    monkeypatch.setenv("MQTT_PORT", "11883")
    monkeypatch.setenv("MQTT_USERNAME", "test-user")
    monkeypatch.setenv("MQTT_PASSWORD", "test-secret")
    fake = Mock()
    fake.connect.return_value = {"connected": True}
    monkeypatch.setattr(runtime, "simulator", fake)
    with TestClient(runtime.app):
        config = fake.connect.call_args.args[0]
        assert (config.host, config.port, config.username, config.password, config.auto_mode) == (
            "test-broker", 11883, "test-user", "test-secret", True)
    fake.disconnect.assert_called_once_with(silent=True)


def test_upper_native_mode_does_not_connect_automatically(monkeypatch):
    monkeypatch.delenv("SIMULATOR_AUTO_CONNECT", raising=False)
    fake = Mock()
    monkeypatch.setattr(runtime, "simulator", fake)
    with TestClient(runtime.app):
        fake.connect.assert_not_called()
    fake.disconnect.assert_not_called()


def test_upper_failed_connection_fails_startup_and_cleans_up(monkeypatch):
    monkeypatch.setenv("SIMULATOR_AUTO_CONNECT", "true")
    fake = Mock()
    fake.connect.return_value = {"connected": False}
    monkeypatch.setattr(runtime, "simulator", fake)
    with pytest.raises(RuntimeError, match="MQTT connection failed"):
        with TestClient(runtime.app):
            pass
    fake.disconnect.assert_called_once_with(silent=True)
