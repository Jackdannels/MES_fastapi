import asyncio
import json
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

from app.services.lims_communication_store import digest, wire_event
from tools.lims_simulator import app as module
from tools.lims_simulator.communication import CommunicationStore


@pytest.fixture
def simulator(monkeypatch, tmp_path):
    monkeypatch.setenv("LIMS_HTTP_TOKEN", "")
    current = module.LimsSimulator(sequence_path=tmp_path / "sequence.db", inbox_path=tmp_path / "inbox.db")
    current.rabbit = type("Rabbit", (), {"publish_envelope": AsyncMock(), "publish_probe": AsyncMock(),
                                         "state": lambda _: {"connected": True}})()
    monkeypatch.setattr(module, "simulator", current)
    return current


def event():
    return wire_event({"event_id": "E1", "schema_version": 1, "type": "mes.test.v1", "occurred_at": "now", "payload": {"code": "T1"}})


def test_offline_dispatch_is_durable_and_retry_keeps_exact_message(simulator, monkeypatch):
    clock = [100]
    monkeypatch.setattr("tools.lims_simulator.communication.time.time", lambda: clock[0])
    simulator.rabbit.publish_envelope.side_effect = ConnectionError
    payload = simulator.random_task()
    response = asyncio.run(simulator.send(payload))
    assert response["publish_status"] == "queued"
    original = simulator.rabbit.publish_envelope.call_args.args[0]
    replacement = CommunicationStore(simulator.communication.path)
    assert replacement.summary()["pending"] == 1
    simulator.communication = replacement
    simulator.rabbit.publish_envelope.side_effect = None
    clock[0] = 109
    assert not asyncio.run(simulator.publish_pending(response["message_id"]))
    clock[0] = 110
    assert asyncio.run(simulator.publish_pending(response["message_id"]))
    assert simulator.rabbit.publish_envelope.call_args.args[0] == original
    assert replacement.summary()["items"][0]["attempts"] == 2
    with pytest.raises(ValueError): replacement.enqueue({**payload, "name": "changed"})


def test_probes_do_not_create_business_records_and_observe_faults(simulator):
    client = TestClient(module.app, client=("127.0.0.1", 12345))
    payload = {"check_id": "C1", "schema_version": 1, "reply_routing_key": "lims.communication.probe." + "a" * 32}
    assert client.post("/api/mes/communication/probe", json=payload).json()["rabbit_sent"]
    assert simulator.inbox.list()["total"] == 0
    simulator.communication.set_faults({"rabbit_blocked": True})
    assert not client.post("/api/mes/communication/probe", json=payload).json()["rabbit_sent"]
    simulator.communication.set_faults({"http_503": True})
    assert client.post("/api/mes/communication/probe", json=payload).status_code == 503


def test_lost_ack_is_idempotent_and_omitted_event_is_detected_and_replayed(simulator):
    client = TestClient(module.app, client=("127.0.0.1", 12345))
    simulator.communication.set_faults({"drop_ack": True})
    assert client.post("/api/mes/events", json=event()).status_code == 503
    assert simulator.inbox.list()["total"] == 1
    assert client.post("/api/mes/events", json=event()).json()["duplicate"]
    missing = {**event(), "event_id": "E2"}
    simulator.communication.set_faults({"omit_next_event": True})
    assert client.post("/api/mes/events", json=missing).status_code == 200
    assert simulator.inbox.list()["total"] == 1
    manifest = {"check_id": "C1", "schema_version": 1, "events": [{"id": "E2", "digest": digest(missing)}], "dispatch_after": 0}
    result = client.post("/api/mes/communication/reconcile", json=manifest)
    assert result.json()["events"] == [{"id": "E2", "status": "missing"}]
    assert client.post("/api/mes/events", json=missing).status_code == 200
    assert client.post("/api/mes/communication/reconcile", json=manifest).json()["events"][0]["status"] == "matched"


def test_probe_auth_and_fault_controls_reject_remote_or_cross_origin_requests(simulator, monkeypatch):
    remote = TestClient(module.app, client=("192.0.2.1", 12345))
    payload = {"check_id": "C1", "schema_version": 1, "reply_routing_key": "lims.communication.probe." + "a" * 32}
    assert remote.post("/api/mes/communication/probe", json=payload).status_code == 403
    monkeypatch.setenv("LIMS_HTTP_TOKEN", "test-token")
    assert remote.post("/api/mes/communication/probe", json=payload).status_code == 401
    assert remote.post("/api/mes/communication/probe", json=payload, headers={"Authorization": "Bearer test-token"}).status_code == 200
    assert remote.post("/api/communication/faults", json={"http_503": True}).status_code == 403
    local = TestClient(module.app, client=("127.0.0.1", 12345))
    assert local.post("/api/communication/faults", json={}, headers={"Origin": "http://evil.invalid"}).status_code == 403
    assert local.post("/api/communication/faults", json={"http_503": True}).status_code == 200
    assert CommunicationStore(simulator.communication.path).faults()["http_503"]
    assert local.post("/api/communication/faults", json={}).status_code == 200
    assert not simulator.communication.faults()["http_503"]


def test_dispatch_manifests_are_paged_and_confirmations_validate_hash(simulator):
    first = simulator.communication.enqueue(simulator.random_task())
    second = simulator.communication.enqueue(simulator.random_task())
    manifest = simulator.communication.manifest(limit=1)
    assert manifest["dispatch_more"] and len(manifest["dispatch"]) == 1
    next_page = simulator.communication.manifest(after=manifest["dispatch"][0]["sequence"], limit=1)
    assert next_page["dispatch"][0]["id"] == second["message_id"]
    with pytest.raises(ValueError): simulator.communication.confirm([{"id": first["message_id"], "digest": "bad", "outcome": "received"}])
    simulator.communication.confirm([{"id": first["message_id"], "digest": digest(first), "outcome": "received"}])
    assert simulator.communication.summary()["pending"] == 1


def test_new_page_has_operable_status_and_fault_controls(simulator):
    client = TestClient(module.app)
    page = client.get("/").text
    for value in ('href="#communication"', 'id="communicationCountdown"', 'id="communicationHistory"', 'id="communicationFaults"'):
        assert value in page
    assert "10 秒" in page and "第三次失败升级" in page
