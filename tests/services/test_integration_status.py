from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from app.services import integration_status as status
from app.services.laboratory_telemetry import LaboratoryTelemetryStore
from app.core.config import Settings


def state(*, url="http://lims/api/state", rabbit=True, mqtt=True):
    return SimpleNamespace(
        settings=SimpleNamespace(LIMS_HEALTH_URL=url),
        lims_rabbit_runtime=SimpleNamespace(status=lambda: {"connected": rabbit}),
        mq_runtime=SimpleNamespace(status=lambda: {"mqtt_enabled": True, "subscriber_running": mqtt}),
    )


@pytest.mark.parametrize("url", ["file:///tmp/state", "http://user:password@lims/state", "http://lims/state#fragment"])
def test_peer_status_configuration_rejects_unsafe_urls(url):
    with pytest.raises(ValueError):
        Settings(_env_file=None, LIMS_HEALTH_URL=url)


def test_broker_connected_is_not_sufficient_evidence_of_peer_connection(monkeypatch):
    probe = Mock(return_value=True)
    monkeypatch.setattr(status, "probe_lims_peer", probe)
    monkeypatch.setattr(status, "laboratory_telemetry_store", LaboratoryTelemetryStore())
    assert status.lims_connection_status(state(url=""))["state"] == "unknown"
    assert status.upper_computer_connection_status(state())["state"] == "unknown"
    probe.assert_not_called()


@pytest.mark.parametrize("alarm", ["critical", "warning", "none"])
def test_sidebar_exposes_machine_readable_alarm_severity(alarm):
    app_state = state()
    app_state.lims_communication_runtime = SimpleNamespace(enabled=True, status=lambda: {
        "running": True, "stale": False, "runtime_error": "", "phase": "offline",
        "detail": "通信异常", "alarm": alarm, "retry_count": 3,
    })
    result = status.lims_connection_status(app_state)
    if alarm == "none":
        assert "alert_severity" not in result
    else:
        assert result["alert_severity"] == alarm


def test_alarm_details_are_whitelisted_and_history_is_bounded():
    app_state = state()
    app_state.lims_communication_runtime = SimpleNamespace(enabled=True, status=lambda: {
        "running": True, "stale": False, "runtime_error": "", "phase": "offline",
        "detail": "通信异常", "alarm": "critical", "retry_count": 3, "fault_since": 100,
        "server_time": 145, "http": "offline", "rabbitmq": "online", "token": "private-token",
        "history": [{"at": 140, "kind": "critical", "detail": "三次失败", "secret": "private"}] * 20,
    })
    result = status.lims_connection_status(app_state)
    assert result["alert_details"]["fault_since"] == 100
    assert len(result["alert_details"]["history"]) == 10
    assert "private" not in str(result)


@pytest.mark.parametrize("peer,rabbit,expected", [(True, True, "online"), (False, True, "offline"), (True, False, "offline")])
def test_lims_requires_peer_and_local_connection(monkeypatch, peer, rabbit, expected):
    monkeypatch.setattr(status, "probe_lims_peer", lambda _: peer)
    assert status.lims_connection_status(state(rabbit=rabbit))["state"] == expected


@pytest.mark.parametrize("error,expected", [(TimeoutError("secret-url"), "offline"), (ValueError("secret-token"), "unknown")])
def test_failed_peer_probe_never_reuses_online_or_leaks_details(monkeypatch, error, expected):
    monkeypatch.setattr(status, "probe_lims_peer", Mock(side_effect=error))
    result = status.lims_connection_status(state())
    assert result["state"] == expected
    assert "secret" not in result["detail"]


def test_upper_status_uses_actual_telemetry_age_and_partial_connections(monkeypatch):
    store = LaboratoryTelemetryStore()
    monkeypatch.setattr(status, "laboratory_telemetry_store", store)
    monkeypatch.setattr("app.services.laboratory_telemetry.time.monotonic", lambda: 100)
    store.update("mes/v1/labs/A/telemetry", {}, received_monotonic=100)
    assert status.upper_computer_connection_status(state())["state"] == "online"
    store.update("mes/v1/labs/B/telemetry", {}, received_monotonic=80)
    assert status.upper_computer_connection_status(state())["state"] == "partial"
    monkeypatch.setattr("app.services.laboratory_telemetry.time.monotonic", lambda: 106)
    assert status.upper_computer_connection_status(state())["state"] == "unknown"
    monkeypatch.setattr("app.services.laboratory_telemetry.time.monotonic", lambda: 116)
    assert status.upper_computer_connection_status(state())["state"] == "offline"
    assert status.upper_computer_connection_status(state(mqtt=False))["state"] == "offline"


@pytest.mark.parametrize("body,expected", [(b'{"connected": true}', True), (b'{"connected": false}', False)])
def test_peer_probe_is_read_only_bounded_and_does_not_send_credentials(monkeypatch, body, expected):
    response = Mock(status=200)
    response.read.return_value = body
    context = Mock()
    context.__enter__ = Mock(return_value=response)
    context.__exit__ = Mock(return_value=False)
    opener = Mock()
    opener.open.return_value = context
    monkeypatch.setattr(status.request, "build_opener", lambda _: opener)
    assert status.probe_lims_peer("http://lims/api/state") is expected
    req = opener.open.call_args.args[0]
    assert req.get_method() == "GET"
    assert not req.has_header("Authorization")
    assert opener.open.call_args.kwargs["timeout"] == 3
    response.read.assert_called_once_with(65537)


@pytest.mark.parametrize("body", [b'{}', b'{"connected":"true"}', b'[]', b'not-json'])
def test_invalid_peer_response_is_not_online(monkeypatch, body):
    response = Mock(status=200)
    response.read.return_value = body
    context = Mock(__enter__=Mock(return_value=response), __exit__=Mock(return_value=False))
    monkeypatch.setattr(status.request, "build_opener", lambda _: Mock(open=Mock(return_value=context)))
    with pytest.raises(ValueError):
        status.probe_lims_peer("http://lims/api/state")
