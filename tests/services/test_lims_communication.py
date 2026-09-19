import asyncio
import copy
import threading
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.core.config import Settings
from app.services.lims_communication import LimsCommunicationRuntime, initial_state
from app.services.lims_communication_store import CommunicationRepository, STATE_KEY, SENT_KEY, RECEIVED_KEY, wire_event
from app.services.lims_http import LimsHttpRuntime
from app.services.lims_rabbitmq import LimsRabbitRuntime


class MemoryRepository(CommunicationRepository):
    def __init__(self):
        self.data = {}
        self.lock = threading.RLock()
        self.cycle = threading.Lock()

    def read(self, key, default=None):
        with self.lock:
            return copy.deepcopy(self.data.get(key, default))

    def update(self, key, change, default=None):
        with self.lock:
            self.data[key] = copy.deepcopy(change(self.read(key, default)))
            return self.read(key)

    def acquire_cycle(self):
        return self.cycle if self.cycle.acquire(False) else None

    def release_cycle(self, lease):
        lease.release()


def build(repository=None, clock=None):
    settings = Settings(_env_file=None, LIMS_HTTP_CALLBACK_URL="http://lims/api/mes/events", LIMS_HTTP_TIMEOUT_SECONDS=.01)
    http = SimpleNamespace(runner=None, pending_count=0, last_error="", deliver_once=AsyncMock())
    rabbit = LimsRabbitRuntime(settings)
    runtime = LimsCommunicationRuntime(settings, http, rabbit, repository=repository or MemoryRepository(), clock=clock or (lambda: 100))
    return runtime


def test_intentional_ten_second_retry_three_failures_escalate_and_survive_restart(monkeypatch):
    clock = [100.0]
    runtime = build(clock=lambda: clock[0])
    async def fail(*_):
        raise TimeoutError("private-token")
    monkeypatch.setattr(runtime, "_probe", fail)
    asyncio.run(runtime.tick())
    first = runtime.repository.read(STATE_KEY)
    assert first["alarm"] == "warning" and first["retry_count"] == 0
    assert first["next_check_at"] == 110
    assert "private" not in str(first)
    replacement = build(runtime.repository, lambda: clock[0])
    failed_probe = AsyncMock(side_effect=TimeoutError)
    monkeypatch.setattr(replacement, "_probe", failed_probe)
    for now in (101, 109):
        clock[0] = now
        asyncio.run(replacement.tick())
    failed_probe.assert_not_called()
    for attempt, now in enumerate((110, 120, 130), 1):
        clock[0] = now
        asyncio.run(replacement.tick())
        state = replacement.repository.read(STATE_KEY)
        assert state["retry_count"] == attempt
        assert state["alarm"] == ("critical" if attempt == 3 else "warning")
    clock[0] = 140
    asyncio.run(replacement.tick())
    assert failed_probe.await_count == 4
    assert [row["kind"] for row in replacement.repository.read(STATE_KEY)["history"]] == ["warning", "critical"]


def test_acknowledge_and_manual_check_do_not_clear_fault_or_advance_retry(monkeypatch):
    clock = [100]
    runtime = build(clock=lambda: clock[0])
    monkeypatch.setattr(runtime, "_probe", AsyncMock(side_effect=ConnectionError))
    asyncio.run(runtime.tick())
    runtime.repository.command("acknowledge")
    runtime.repository.command("check")
    clock[0] = 105
    asyncio.run(runtime.tick())
    state = runtime.repository.read(STATE_KEY)
    assert state["acknowledged"] and state["alarm"] == "warning"
    assert state["next_check_at"] == 110 and state["retry_count"] == 0
    assert runtime._probe.await_count == 1


def test_recovery_requires_complete_reconciliation_and_retains_history(monkeypatch):
    clock = [100]
    runtime = build(clock=lambda: clock[0])
    monkeypatch.setattr(runtime, "_probe", AsyncMock(side_effect=ConnectionError))
    asyncio.run(runtime.tick())
    monkeypatch.setattr(runtime, "_probe", AsyncMock())
    monkeypatch.setattr(runtime, "_reconcile", AsyncMock(return_value=False))
    clock[0] = 110
    asyncio.run(runtime.tick())
    assert runtime.repository.read(STATE_KEY)["phase"] == "syncing"
    assert runtime.repository.read(STATE_KEY)["alarm"] != "none"
    runtime._reconcile.return_value = True
    clock[0] = 120
    asyncio.run(runtime.tick())
    state = runtime.repository.read(STATE_KEY)
    assert state["phase"] == "online" and state["alarm"] == "none"
    assert state["retry_count"] == 0 and state["next_check_at"] == 180
    assert state["history"][-1]["kind"] == "recovered"


def test_multiple_workers_cannot_run_the_same_cycle(monkeypatch):
    repository = MemoryRepository()
    first, second = build(repository), build(repository)
    calls = []
    async def scenario():
        started = asyncio.Event()
        release = asyncio.Event()
        async def probe(*_):
            calls.append(1)
            started.set()
            await release.wait()
        monkeypatch.setattr(first, "_probe", probe)
        monkeypatch.setattr(second, "_probe", probe)
        monkeypatch.setattr(first, "_reconcile", AsyncMock(return_value=True))
        pending = asyncio.create_task(first.tick())
        await started.wait()
        await second.tick()
        release.set()
        await pending
    asyncio.run(scenario())
    assert len(calls) == 1


def test_probe_needs_correlated_rabbit_application_reply_not_http_alone(monkeypatch):
    runtime = build()
    monkeypatch.setattr(runtime, "_request", lambda path, payload: {"rabbit_sent": True})
    async def scenario():
        state = initial_state()
        with pytest.raises(TimeoutError):
            await runtime._probe(state, "lost")
        assert state["http"] == "online" and state["rabbitmq"] == "unknown"
        task = asyncio.create_task(runtime._probe(state, "expected"))
        await asyncio.sleep(0)
        wrong = AsyncMock(body=b'{"type":"lims.communication.probe.v1","schema_version":1,"check_id":"old"}')
        await runtime.rabbit._handle_communication_probe(wrong)
        assert not task.done()
        good = AsyncMock(body=b'{"type":"lims.communication.probe.v1","schema_version":1,"check_id":"expected"}')
        await runtime.rabbit._handle_communication_probe(good)
        await task
        assert state["rabbitmq"] == "online"
        assert not runtime.rabbit._communication_probes
    asyncio.run(scenario())


def test_stored_journal_rejects_same_id_different_content():
    repository = MemoryRepository()
    repository.record(RECEIVED_KEY, "M1", {"payload": "first"}, outcome="received")
    repository.record(RECEIVED_KEY, "M1", {"payload": "first"}, outcome="received")
    assert len(repository.read(RECEIVED_KEY)) == 1
    with pytest.raises(ValueError):
        repository.record(RECEIVED_KEY, "M1", {"payload": "changed"}, outcome="received")


def test_reconciliation_finds_middle_gaps_and_never_treats_content_conflict_as_synced(monkeypatch):
    runtime = build()
    for identity in ("first", "middle", "last"):
        runtime.repository.record(SENT_KEY, identity, {"event_id": identity})
    enqueued = []
    monkeypatch.setattr("app.services.lims_communication.enqueue_lims_event", lambda body: enqueued.append(body))
    mode = ["missing"]
    def request(path, payload):
        if path == "/resume": return {}
        return {"events": [{"id": item["id"], "status": mode[0] if item["id"] == "middle" else "matched"} for item in payload["events"]],
                "dispatch": [], "dispatch_more": False}
    monkeypatch.setattr(runtime, "_request", request)
    state = initial_state()
    assert not asyncio.run(runtime._reconcile(state, "C1"))
    assert enqueued == [{"event_id": "middle"}] and state["out_cursor"] == 0
    mode[0] = "conflict"
    with pytest.raises(ValueError): asyncio.run(runtime._reconcile(state, "C2"))
    mode[0] = "matched"
    assert asyncio.run(runtime._reconcile(state, "C3"))
    assert state["out_cursor"] == 3


def test_outbound_ack_is_journaled_before_removing_outbox(monkeypatch):
    from app.services import lims_http
    events = [{"event_id": "E1", "type": "mes.test.v1", "schema_version": 1, "occurred_at": "now", "payload": {}}]
    class Storage:
        def read(self, key): return copy.deepcopy(events)
        def write(self, key, value): events[:] = copy.deepcopy(value)
    monkeypatch.setattr(lims_http, "get_storage_backend", lambda: Storage())
    runtime = build()
    runtime.http = LimsHttpRuntime(runtime.settings)
    runtime.http.communication = runtime
    monkeypatch.setattr(runtime.http, "_post", lambda _: None)
    original = runtime.repository.record
    monkeypatch.setattr(runtime.repository, "record", lambda *args, **kwargs: (_ for _ in ()).throw(OSError()))
    with pytest.raises(OSError): asyncio.run(runtime.http.deliver_once())
    assert len(events) == 1
    monkeypatch.setattr(runtime.repository, "record", original)
    asyncio.run(runtime.http.deliver_once())
    assert not events
    assert runtime.repository.read(SENT_KEY)[0]["body"] == wire_event({"event_id": "E1", "type": "mes.test.v1", "schema_version": 1, "occurred_at": "now", "payload": {}})


def test_bidirectional_resume_through_simulator_http_and_rabbit_handlers(monkeypatch, tmp_path):
    """Real HTTP routing/SQLite with an in-process Rabbit wire, no live business data."""
    import json
    from fastapi.testclient import TestClient
    from tools.lims_simulator import app as simulator_module
    from app.services import lims_http
    monkeypatch.setenv("LIMS_HTTP_TOKEN", "")
    simulator = simulator_module.LimsSimulator(sequence_path=tmp_path / "sequence.db", inbox_path=tmp_path / "inbox.db")
    monkeypatch.setattr(simulator_module, "simulator", simulator)
    client = TestClient(simulator_module.app, client=("127.0.0.1", 12345))
    clock = [100]
    runtime = build(clock=lambda: clock[0])
    runtime.http = LimsHttpRuntime(runtime.settings)
    runtime.http.communication = runtime
    runtime.rabbit.communication_repository = runtime.repository
    outbox = []
    stored_tasks = []
    class Storage:
        def read(self, key): return copy.deepcopy(outbox)
        def write(self, key, value): outbox[:] = copy.deepcopy(value)
    monkeypatch.setattr(lims_http, "get_storage_backend", lambda: Storage())
    def store_intake(payload, *, message_id):
        stored_tasks.append(message_id)
        lims_http.enqueue_lims_event(wire_event({"event_id": "receipt-" + message_id, "type": "mes.external-intake.received.v1",
            "schema_version": 1, "occurred_at": "now", "payload": {"code": payload["code"]}, "correlation_id": payload["lims_request_id"]}))
    runtime.rabbit.store_intake = store_intake
    async def scenario():
        loop = asyncio.get_running_loop()
        class Wire:
            async def publish_probe(self, check_id, routing_key):
                message = AsyncMock(body=json.dumps({"type": "lims.communication.probe.v1", "schema_version": 1, "check_id": check_id}).encode())
                await asyncio.wrap_future(asyncio.run_coroutine_threadsafe(runtime.rabbit._handle_communication_probe(message), loop))
            async def publish_envelope(self, envelope):
                message = AsyncMock(body=json.dumps(envelope).encode())
                await asyncio.wrap_future(asyncio.run_coroutine_threadsafe(runtime.rabbit._handle_intake_message(message), loop))
        simulator.rabbit = Wire()
        def request(path, payload):
            response = client.post("/api/mes/communication" + path, json=payload)
            response.raise_for_status()
            return response.json()
        def post(event):
            response = client.post("/api/mes/events", json=wire_event(event))
            response.raise_for_status()
            assert response.json()["event_id"] == event["event_id"]
        monkeypatch.setattr(runtime, "_request", request)
        monkeypatch.setattr(runtime.http, "_post", post)
        # Persist while offline; no direct initial publication. Scheduler replays it.
        envelope = simulator.communication.enqueue(simulator.random_task())
        simulator.communication.set_faults({"drop_ack": True})
        await runtime.tick()
        assert runtime.repository.read(STATE_KEY)["alarm"] == "warning"
        assert len(stored_tasks) == 1
        assert len(outbox) == 1 and simulator.inbox.list()["total"] == 1
        clock[0] = 110
        await runtime.tick()
        clock[0] = 120
        await runtime.tick()
        assert runtime.repository.read(STATE_KEY)["phase"] == "online"
        assert not outbox and simulator.communication.summary()["pending"] == 0
        assert simulator.inbox.list()["total"] == 1
        # Redelivered broker message after journal confirmation cannot redo task effects.
        message = AsyncMock(body=json.dumps(envelope).encode())
        await runtime.rabbit._handle_intake_message(message)
        assert stored_tasks == [envelope["message_id"]]
        assert message.ack.await_count == 1
    asyncio.run(scenario())
