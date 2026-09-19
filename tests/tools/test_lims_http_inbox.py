from concurrent.futures import ThreadPoolExecutor

from fastapi.testclient import TestClient
import pytest

from tools.lims_simulator import app as module
from tools.lims_simulator.interactions import InteractionStore


def event(event_id="EV-1", status="received"):
    return {"event_id": event_id, "type": f"mes.external-intake.{status}.v1",
            "schema_version": 1, "source": "MES", "occurred_at": "2026-09-18T12:00:00+08:00",
            "correlation_id": "LIMS-1", "payload": {"code": "TASK-1", "acceptance_status": status}}


def completion(revision=1, completion_id="COMP-1", event_id=None):
    return {**event(event_id or f"{completion_id}-v{revision}"),
            "type": "mes.experiment.completion.v1",
            "payload": {"code": "TASK-1", "experiment_code": "EXP-1",
                        "completion_id": completion_id, "revision": revision,
                        "tray_codes": ["TP-1"], "data": {"status": "ready" if revision > 1 else "pending"}}}


@pytest.fixture
def receiver(monkeypatch, tmp_path):
    monkeypatch.setenv("LIMS_HTTP_TOKEN", "")
    simulator = module.LimsSimulator(sequence_path=tmp_path / "sequence.db", inbox_path=tmp_path / "inbox.db")
    monkeypatch.setattr(module, "simulator", simulator)
    return TestClient(module.app, client=("127.0.0.1", 12345))


def test_http_notifications_are_durable_idempotent_and_queryable(receiver, monkeypatch):
    first = receiver.post("/api/mes/events", json=event())
    assert first.json() == {"ok": True, "event_id": "EV-1", "duplicate": False}
    assert receiver.post("/api/mes/events", json=event()).json()["duplicate"] is True
    path = module.simulator.inbox.path
    monkeypatch.setattr(module.simulator, "inbox", InteractionStore(path))
    records = receiver.get("/api/interactions", params={"task_code": "TASK-1"}).json()
    assert records["total"] == 1
    assert records["items"][0]["event"]["payload"] == event()["payload"]
    assert receiver.get("/api/interactions", params={"task_code": "other"}).json()["total"] == 0
    assert receiver.post("/api/mes/events", json=event(status="accepted")).status_code == 409
    assert receiver.post("/api/mes/events", json=event(), headers={"Idempotency-Key": "other"}).status_code == 409


def test_receiver_auth_validation_and_remote_boundary(receiver, monkeypatch):
    remote = TestClient(module.app, client=("192.0.2.1", 12345))
    assert remote.post("/api/mes/events", json=event()).status_code == 403
    monkeypatch.setenv("LIMS_HTTP_TOKEN", "test-secret")
    assert receiver.post("/api/mes/events", json=event()).status_code == 401
    headers = {"Authorization": "Bearer test-secret"}
    assert remote.post("/api/mes/events", json=event(), headers=headers).status_code == 200
    assert receiver.post("/api/mes/events", json={**event(), "schema_version": 2}, headers=headers).status_code == 422
    assert receiver.post("/api/mes/events", json={**event(), "payload": []}, headers=headers).status_code == 422
    assert receiver.post("/api/mes/events", content=b"x" * (1024 * 1024 + 1), headers=headers).status_code == 413


def test_out_of_order_receipts_do_not_regress_accepted_status(receiver):
    receiver.post("/api/mes/events", json=event("EV-0", "failed"))
    receiver.post("/api/mes/events", json=event("EV-2", "accepted"))
    receiver.post("/api/mes/events", json=event())
    assert module.simulator._task_statuses["LIMS-1"] == "accepted"
    result = {**event("EV-3"), "type": "mes.experiment.result.v1", "payload": {"future_field": [1, 2]}}
    assert receiver.post("/api/mes/events", json=result).status_code == 200
    assert module.simulator._task_statuses["LIMS-1"] == "accepted"
    assert receiver.get("/api/interactions", params={"limit": 1, "offset": 1}).json()["items"][0]["event"]["event_id"] == "EV-1"


def test_parallel_duplicate_delivery_is_atomic(tmp_path):
    path = tmp_path / "inbox.db"
    with ThreadPoolExecutor(max_workers=4) as pool:
        duplicates = list(pool.map(lambda _: InteractionStore(path).receive(event(), "now"), range(12)))
    assert duplicates.count(False) == 1
    assert InteractionStore(path).list()["total"] == 1


def test_dual_pages_and_completion_scope(receiver):
    page = receiver.get("/").text
    assert 'href="#dispatch"' in page and 'href="#interactions"' in page
    assert 'id="interactionPage"' in page
    assert "至少一个托盘完成全部轴向及步骤后才回传" in page
    assert "预留接入" not in page


def test_completion_revisions_project_latest_without_losing_raw_events(receiver, monkeypatch):
    assert receiver.post("/api/mes/events", json=completion(2)).status_code == 200
    assert receiver.post("/api/mes/events", json=completion(1)).status_code == 200
    assert receiver.post("/api/mes/events", json=completion(2)).json()["duplicate"] is True
    assert receiver.post("/api/mes/events", json=event()).status_code == 200
    assert receiver.post("/api/mes/events", json=completion(1, "COMP-2")).status_code == 200
    monkeypatch.setattr(module.simulator, "inbox", InteractionStore(module.simulator.inbox.path))
    result = receiver.get("/api/interactions", params={"task_code": "TASK-1"}).json()
    assert result["total"] == 3
    assert result["raw_total"] == 4
    assert [item["event"]["event_id"] for item in result["items"]] == ["COMP-2-v1", "EV-1", "COMP-1-v2"]
    assert receiver.get("/api/state").json()["http_receiver"]["received_count"] == 4
    assert receiver.get("/api/interactions", params={"limit": 1, "offset": 2}).json()["items"][0]["event"]["payload"]["revision"] == 2
    assert receiver.post("/api/mes/events", json=completion(3)).status_code == 200
    newest = receiver.get("/api/interactions").json()
    assert newest["total"] == 3 and newest["raw_total"] == 5
    assert newest["items"][0]["event"]["payload"]["revision"] == 3


@pytest.mark.parametrize("field,value", [
    ("completion_id", None), ("completion_id", " "), ("experiment_code", None),
    ("code", []), ("revision", 0), ("revision", -1), ("revision", "2"), ("revision", True),
])
def test_completion_requires_valid_identity_and_revision(receiver, field, value):
    notification = completion()
    notification["payload"][field] = value
    assert receiver.post("/api/mes/events", json=notification).status_code == 422
    assert receiver.get("/api/interactions").json()["total"] == 0


def test_completion_accepts_task_code_alias_and_extensible_sections(receiver):
    notification = completion()
    notification["payload"]["task_code"] = notification["payload"].pop("code")
    notification["payload"]["future_field"] = {"v": 1}
    assert receiver.post("/api/mes/events", json=notification).status_code == 200
    assert receiver.get("/api/interactions", params={"task_code": "TASK-1"}).json()["total"] == 1


def test_completion_identity_and_revision_cannot_be_overwritten(receiver):
    receiver.post("/api/mes/events", json=completion())
    conflicting = completion(event_id="OTHER-EVENT")
    conflicting["payload"]["data"] = {"status": "ready"}
    assert receiver.post("/api/mes/events", json=conflicting).status_code == 409
    different_task = completion(2)
    different_task["payload"]["code"] = "TASK-OTHER"
    assert receiver.post("/api/mes/events", json=different_task).status_code == 409
    different_experiment = completion(2)
    different_experiment["payload"]["experiment_code"] = "EXP-OTHER"
    assert receiver.post("/api/mes/events", json=different_experiment).status_code == 409
    # A second event ID for identical business content does not add a completion.
    assert receiver.post("/api/mes/events", json=completion(event_id="SECOND-EVENT")).status_code == 200
    records = receiver.get("/api/interactions").json()
    assert records["total"] == 1 and records["raw_total"] == 2
