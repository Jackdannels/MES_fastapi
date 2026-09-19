import asyncio
import copy
import json
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from app.core.config import Settings
from app.services import lims_http as module
from app.services.lims_rabbitmq import LimsRabbitRuntime, INTAKE_MESSAGE_TYPE


class MemoryStore:
    def __init__(self):
        self.events = []

    def read(self, key):
        return copy.deepcopy(self.events)

    def write(self, key, events):
        self.events = copy.deepcopy(events)


def event(id="EV-1"):
    return {"event_id": id, "message_id": id, "type": "mes.external-intake.received.v1",
            "schema_version": 1, "source": "MES", "occurred_at": "now", "payload": {"code": "TASK-1"}}


@pytest.fixture
def storage(monkeypatch):
    store = MemoryStore()
    monkeypatch.setattr(module, "get_storage_backend", lambda: store)
    return store


def settings(**kwargs):
    return Settings(_env_file=None, LIMS_HTTP_CALLBACK_URL="http://127.0.0.1:8900/api/mes/events", **kwargs)


def test_failed_delivery_survives_runtime_restart_and_retries_same_event(storage, monkeypatch):
    module.enqueue_lims_event(event())
    clock = [100.0]
    monkeypatch.setattr(module.time, "time", lambda: clock[0])
    runtime = module.LimsHttpRuntime(settings())
    def offline(_):
        raise TimeoutError("private URL or token")
    monkeypatch.setattr(runtime, "_post", offline)
    asyncio.run(runtime.deliver_once())
    assert storage.events[0]["_delivery"]["attempts"] == 1
    assert "private" not in runtime.last_error
    replacement = module.LimsHttpRuntime(settings())
    sent = []
    monkeypatch.setattr(replacement, "_post", lambda e: sent.append(e))
    asyncio.run(replacement.deliver_once())
    assert sent == []
    clock[0] = 109.0
    asyncio.run(replacement.deliver_once())
    assert sent == []
    clock[0] = 110.0
    asyncio.run(replacement.deliver_once())
    assert sent[0]["event_id"] == "EV-1"
    assert storage.events == []


def test_failure_does_not_block_other_events_or_erase_concurrent_enqueue(storage, monkeypatch):
    module.enqueue_lims_event(event("bad"))
    module.enqueue_lims_event(event("good"))
    runtime = module.LimsHttpRuntime(settings())
    def send(item):
        if item["event_id"] == "bad":
            raise ValueError("bad ack")
        module.enqueue_lims_event(event("new"))
    monkeypatch.setattr(runtime, "_post", send)
    asyncio.run(runtime.deliver_once())
    assert [e["event_id"] for e in storage.events] == ["bad", "new"]


def test_http_serialization_auth_and_acknowledgement(storage, monkeypatch):
    runtime = module.LimsHttpRuntime(settings(LIMS_HTTP_TOKEN="test-token"))
    class Response:
        status = 200
        ack = {"ok": True, "event_id": "EV-1"}
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def read(self, size): return json.dumps(self.ack).encode()
    response = Response()
    class Opener:
        def open(self, req, timeout):
            assert req.get_header("Authorization") == "Bearer test-token"
            assert req.get_header("Idempotency-key") == "EV-1"
            assert "_delivery" not in json.loads(req.data)
            assert "routing_key" not in json.loads(req.data)
            return response
    monkeypatch.setattr(module.request, "build_opener", lambda *args: Opener())
    runtime._post({**event(), "_delivery": {}, "routing_key": "old"})
    response.ack = {"ok": True, "event_id": "other"}
    with pytest.raises(ValueError): runtime._post(event())
    assert module._NoRedirect().redirect_request(None, None, 302, None, None, "http://other") is None


def test_disabled_runtime_keeps_pending_and_http_runs_without_rabbit(storage):
    module.enqueue_lims_event(event())
    async def scenario():
        disabled = module.LimsHttpRuntime(Settings(_env_file=None, LIMS_HTTP_CALLBACK_URL=""))
        await disabled.start()
        assert disabled.runner is None
        enabled = module.LimsHttpRuntime(settings(RABBITMQ_ENABLED=False))
        await enabled.start()
        assert enabled.status()["running"]
        await enabled.stop()
    asyncio.run(scenario())
    assert len(storage.events) == 1


def test_rejected_intake_queues_http_receipt_before_rabbit_reject(storage, monkeypatch):
    def reject(*args, **kwargs):
        raise HTTPException(400, "invalid task")
    runtime = LimsRabbitRuntime(settings(), store_intake=reject)
    message = AsyncMock()
    message.body = json.dumps({"message_id": "M1", "type": INTAKE_MESSAGE_TYPE,
                               "schema_version": 1, "payload": {"code": "bad"}}).encode()
    asyncio.run(runtime._handle_intake_message(message))
    message.reject.assert_awaited_once_with(requeue=False)
    assert storage.events[0]["type"] == "mes.external-intake.failed.v1"
    def fail(*args): raise OSError("storage unavailable")
    monkeypatch.setattr(storage, "write", fail)
    message.reset_mock()
    asyncio.run(runtime._handle_intake_message(message))
    message.nack.assert_awaited_once_with(requeue=True)
    message.reject.assert_not_awaited()


def test_intake_is_acknowledged_after_durable_enqueue_without_http_connection(storage):
    def accept(*args, **kwargs):
        module.enqueue_lims_event(event())
    runtime = LimsRabbitRuntime(settings(), store_intake=accept)
    message = AsyncMock()
    message.body = json.dumps({"message_id": "M1", "type": INTAKE_MESSAGE_TYPE,
                               "schema_version": 1, "payload": {"code": "TASK-1"}}).encode()
    asyncio.run(runtime._handle_intake_message(message))
    message.ack.assert_awaited_once()
    message.nack.assert_not_awaited()
    assert storage.events[0]["event_id"] == "EV-1"
    assert not hasattr(runtime, "event_exchange")


@pytest.mark.parametrize("url", ["ftp://host/path", "https://user:secret@host/path", "https://host/path#fragment", "not-a-url"])
def test_callback_configuration_rejects_unsafe_or_invalid_urls(url):
    with pytest.raises(ValueError):
        Settings(_env_file=None, LIMS_HTTP_CALLBACK_URL=url)
