"""SHARED-RESET: withdrawing an already restored tray must not replay old preparation."""
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy

import pytest

from tests.api.test_laboratory import build_client


TASK = "RESET-T"
EXPERIMENT = "RESET-E"
LAB = "盐雾试验室"
TRAY = "RESET-TP"
WITHDRAW = f"/api/laboratory/tasks/{TASK}/experiments/{EXPERIMENT}/withdraw-current"
ORIGINS = {
    "handover": ("到货", "接驳区", "接驳区扫码出库"),
    "staging": ("已到达暂存间", "恒温恒湿间（暂存间）", "暂存间扫码出库"),
    "appearance": ("实验前外观检测间存放", "外观检测间", "外观检测间扫码出库"),
}


def reset_case(monkeypatch, origin="staging", tray_codes=(TRAY,)):
    from app.api.routes import laboratory

    status, location, dispatch_action = ORIGINS[origin]
    sample = {
        "code": "RESET-SP", "task_code": TASK,
        "status": "送至实验室", "flow_status": "送至实验室", "location": LAB,
        "trays": [{
            "tray_code": tray, "quantity": 1, "status": "送至实验室",
            "target_experiment_code": EXPERIMENT, "target_schedule_id": "RESET-S", "target_lab": LAB,
        } for tray in tray_codes],
        "history": [
            {"action": dispatch_action, "status": "送至实验室", "location": LAB, "time": "2026-11-09 11:00:00"},
            {"action": "扫码入库" if origin == "staging" else "外观检测间扫码入库" if origin == "appearance" else "样品到货",
             "status": status, "location": location, "time": "2026-11-09 10:00:00"},
        ],
    }
    events = []
    if origin != "handover":
        for tray in tray_codes:
            for action, time in [("stock_in", "10:00:00"), ("stock_out", "11:00:00")]:
                events.append({
                    "id": tray+action, "task_code": TASK, "tray_code": tray,
                    "room": origin, "action": action, "time": "2026-11-09 "+time,
                    "status": status, "target_lab": LAB, "target_experiment_code": EXPERIMENT,
                })
    client, storage = build_client(monkeypatch, {
        "mes.tasks": [{"code": TASK, "test_type": "盐雾试验", "test_types": ["盐雾试验"]}],
        "mes.experiments": [{"task_code": TASK, "experiment_code": EXPERIMENT, "experiment_name": "盐雾试验", "required_device": "盐雾试验", "axis_codes": []}],
        "mes.schedules": [{"id": "RESET-S", "task_code": TASK, "experiment_code": EXPERIMENT, "device": LAB, "status": "已排程"}],
        "mes.samples": [sample],
        "mes.experiment_trays": [{"task_code": TASK, "experiment_code": EXPERIMENT, "tray_code": tray} for tray in tray_codes],
        "mes.experiment_samples": [{"task_code": TASK, "experiment_code": EXPERIMENT, "sample_code": "RESET-SP"}],
        "mes.staging_events": events,
    })
    publications = []
    monkeypatch.setattr(laboratory, "publish_storage_update", lambda *args, **kwargs: publications.append((args, kwargs)))
    clock = ["2026-11-09 12:00:01"]
    monkeypatch.setattr(laboratory, "now_business_text", lambda: clock[0])
    return client, storage, clock, publications


def prepare(client, clock, tray_codes=(TRAY,), *, time="12:00:01"):
    clock[0] = "2026-11-09 "+time
    for operation in ["compare", "install"]:
        response = client.post("/api/laboratory/operations", json={
            "operationType": operation, "taskCode": TASK, "experimentCode": EXPERIMENT,
            "labName": LAB, "trayCodes": list(tray_codes),
        })
        assert response.status_code == 200, response.text


@pytest.mark.parametrize("origin", ORIGINS)
@pytest.mark.parametrize("replay_time", ["12:00:03", "12:00:04"])
def test_shared_reset_repeated_request_preserves_restored_state_and_history(monkeypatch, origin, replay_time):
    client, storage, clock, publications = reset_case(monkeypatch, origin)
    prepare(client, clock)
    clock[0] = "2026-11-09 12:00:03"
    first = client.post(WITHDRAW, json={"trayCodes": [TRAY]})
    assert first.status_code == 200, first.text
    assert (first.json()["restoredStatus"], first.json()["restoredLocation"]) == ORIGINS[origin][:2]
    before = deepcopy(storage.payloads)
    before_publications = len(publications)

    clock[0] = "2026-11-09 "+replay_time
    for _ in range(2):
        repeated = client.post(WITHDRAW, json={"trayCodes": [TRAY]})
        assert repeated.status_code == 400, repeated.text
        assert "没有可撤回" in repeated.json()["detail"]
        assert storage.payloads == before
        assert len(publications) == before_publications


@pytest.mark.parametrize("origin", ["staging", "appearance"])
def test_shared_reset_partial_withdraw_does_not_replay_or_block_sibling(monkeypatch, origin):
    sibling = TRAY+"-B"
    client, storage, clock, _ = reset_case(monkeypatch, origin=origin, tray_codes=(TRAY, sibling))
    prepare(client, clock, (TRAY, sibling))
    clock[0] = "2026-11-09 12:00:03"
    assert client.post(WITHDRAW, json={"trayCodes": [TRAY]}).status_code == 200
    before = deepcopy(storage.payloads)
    assert before["mes.samples"][0]["status"] == "工装夹具安装"
    repeated = client.post(WITHDRAW, json={"trayCodes": [TRAY]})
    assert repeated.status_code == 400, repeated.text
    assert storage.payloads == before

    clock[0] = "2026-11-09 12:00:04"
    other = client.post(WITHDRAW, json={"trayCodes": [sibling]})
    assert other.status_code == 200, other.text
    assert other.json()["affectedTrayCodes"] == [sibling]
    assert other.json()["restoredStatus"] == ORIGINS[origin][0]
    assert all(tray["status"] == ORIGINS[origin][0] for tray in storage.read("mes.samples")[0]["trays"])


@pytest.mark.parametrize("origin", ["staging", "appearance"])
def test_shared_reset_new_comparison_reopens_only_the_prepared_tray(monkeypatch, origin):
    sibling = TRAY+"-B"
    tray_codes = (TRAY, sibling) if origin == "staging" else (TRAY,)
    client, storage, clock, _ = reset_case(monkeypatch, origin=origin, tray_codes=tray_codes)
    prepare(client, clock, tray_codes)
    clock[0] = "2026-11-09 12:00:03"
    assert client.post(WITHDRAW, json={"trayCodes": list(tray_codes)}).status_code == 200

    # Replay a real dispatch followed by preparation; no completed-axis history exists.
    from app.api.routes import storage as storage_route
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    monkeypatch.setattr(storage_route, "get_storage_backend", lambda: storage)
    monkeypatch.setattr(storage_route, "publish_storage_update", lambda *_args, **_kwargs: None)
    app = FastAPI()
    app.include_router(storage_route.router)
    monkeypatch.setattr(storage_route, "now_business_text", lambda: "2026-11-09 12:00:04")
    dispatch = TestClient(app).post(f"/api/storage/rooms/{origin}/trays/{TRAY}/stock-out", json={
        "targetLab": LAB, "targetExperimentCode": EXPERIMENT, "scheduleId": "RESET-S", "targetType": "lab",
    })
    assert dispatch.status_code == 200, dispatch.text
    # Dispatch alone must not revive comparison from the preceding attempt.
    before = deepcopy(storage.payloads)
    assert client.post(WITHDRAW, json={"trayCodes": [TRAY]}).status_code == 400
    assert storage.payloads == before

    prepare(client, clock, (TRAY,), time="12:00:05")
    if sibling in tray_codes:
        before = deepcopy(storage.payloads)
        assert client.post(WITHDRAW, json={"trayCodes": [sibling]}).status_code == 400
        assert storage.payloads == before
    response = client.post(WITHDRAW, json={"trayCodes": [TRAY]})
    assert response.status_code == 200, response.text
    assert response.json()["affectedTrayCodes"] == [TRAY]
    assert response.json()["restoredStatus"] == ORIGINS[origin][0]


def test_shared_reset_concurrent_requests_apply_only_one_withdrawal(monkeypatch):
    client, storage, clock, _ = reset_case(monkeypatch)
    prepare(client, clock)
    clock[0] = "2026-11-09 12:00:03"
    with ThreadPoolExecutor(max_workers=2) as executor:
        responses = list(executor.map(lambda _: client.post(WITHDRAW, json={"trayCodes": [TRAY]}), range(2)))
    assert sorted(response.status_code for response in responses) == [200, 400]
    sample = storage.read("mes.samples")[0]
    assert sample["status"] == "已到达暂存间"
    assert sample["location"] == ORIGINS["staging"][1]
    assert sum(entry["action"] == "实验任务撤回" for entry in sample["history"]) == 1
    assert sum(event["action"] == "stock_out_withdraw" for event in storage.read("mes.staging_events")) == 1


@pytest.mark.parametrize("origin", ORIGINS)
def test_shared_reset_equal_time_history_read_order_cannot_revive_preparation(monkeypatch, origin):
    client, storage, clock, _ = reset_case(monkeypatch, origin)
    prepare(client, clock, time="12:00:03")
    assert client.post(WITHDRAW, json={"trayCodes": [TRAY]}).status_code == 200
    sample = storage.payloads["mes.samples"][0]
    # SQL reads tied event times by event_id; replacing history may reverse a
    # tied batch. The restored tray state must remain authoritative either way.
    tied = [event for event in sample["history"] if event["time"] == clock[0]]
    older = [event for event in sample["history"] if event["time"] != clock[0]]
    sample["history"] = list(reversed(tied))+older
    before = deepcopy(storage.payloads)
    assert client.post(WITHDRAW, json={"trayCodes": [TRAY]}).status_code == 400
    assert storage.payloads == before


def test_shared_reset_legacy_unscoped_withdrawal_blocks_dispatch_only_replay(monkeypatch):
    client, storage, clock, _ = reset_case(monkeypatch)
    prepare(client, clock)
    clock[0] = "2026-11-09 12:00:03"
    assert client.post(WITHDRAW, json={"trayCodes": [TRAY]}).status_code == 200
    sample = storage.payloads["mes.samples"][0]
    sample["history"][0]["detail"] = f"{TASK} / 盐雾试验 / 撤回至已到达暂存间"
    sample["status"] = sample["flow_status"] = sample["trays"][0]["status"] = "送至实验室"
    sample["location"] = LAB
    before = deepcopy(storage.payloads)
    # A legacy withdrawal with no tray suffix must still close old comparison.
    assert client.post(WITHDRAW, json={"trayCodes": [TRAY]}).status_code == 400
    assert storage.payloads == before
