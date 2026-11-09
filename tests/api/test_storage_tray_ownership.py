"""STAB-SALT-02: current ownership must be unique before any tray mutation."""
from copy import deepcopy

import pytest

from app.services.storage_tray_actions import (
    StorageTrayActionError,
    build_manufacturer_return_updates,
    build_stock_in_updates,
    build_stock_out_updates,
)
from tests.api.test_storage import (
    ScopedTrayActionStorage,
    _salt_mid_appearance_snapshot,
    build_client,
    build_client_with_storage,
)


TRAY = "TP-SALT-MID"
TASK = "TASK-SALT-MID"
NOW = "2026-11-09 10:00:00"


def foreign_sample(status="实验进行中", *, unbound=False):
    sample = {
        "code": "FOREIGN-SP", "task_code": "FOREIGN", "status": status,
        "flow_status": status, "location": "厂家收回" if status == "厂家收回" else "冲击一室",
        "trays": [{"tray_code": TRAY, "status": status}], "history": [],
    }
    if unbound:
        sample["trays"][0]["unbind_time"] = "2026-11-08 09:00:00"
    return sample


def case(action):
    snapshot = _salt_mid_appearance_snapshot()
    for sample in snapshot["mes.samples"]:
        sample["history"] = []
    room = "appearance"
    payload = {}
    if action == "stock-out":
        sample = snapshot["mes.samples"][0]
        sample.update(status="中途外观检查中", flow_status="中途外观检查中", location="外观检测间")
        sample["trays"][0]["status"] = "中途外观检查中"
        snapshot["mes.staging_events"] = [{
            "id": "current-in", "task_code": TASK, "tray_code": TRAY,
            "room": room, "action": "stock_in", "appearance_phase": "mid_experiment",
            "run_no": "RUN-SALT-MID", "pause_no": "PAUSE-SALT-MID-1", "time": "2026-11-09 09:00:00",
        }]
        payload = {"inspectionResult": "无新增变化"}
    elif action == "manufacturer-return":
        room = "staging"
        snapshot = {
            "mes.tasks": [{"code": TASK, "transfer_status": "到货"}],
            "mes.samples": [{
                "code": "SP-SALT-MID", "task_code": TASK, "status": "实验后暂存间存放",
                "flow_status": "实验后暂存间存放", "location": "恒温恒湿间（暂存间）",
                "trays": [{"tray_code": TRAY, "status": "实验后暂存间存放"}], "history": [],
            }],
            "mes.staging_events": [],
        }
    return snapshot, room, payload


BUILDERS = {"stock-in": build_stock_in_updates, "stock-out": build_stock_out_updates,
            "manufacturer-return": build_manufacturer_return_updates}


class BindingCheckedStorage(ScopedTrayActionStorage):
    def read_tray_bindings(self, tray_code):
        return [deepcopy(sample) for sample in self.payloads["mes.samples"]
                if any(tray["tray_code"] == tray_code for tray in sample.get("trays", []))]


@pytest.mark.parametrize("action", BUILDERS)
@pytest.mark.parametrize("reverse", [False, True])
def test_salt02_shared_service_rejects_two_current_tasks_without_mutation(action, reverse):
    snapshot, room, payload = case(action)
    snapshot["mes.samples"].append(foreign_sample())
    if reverse:
        snapshot["mes.samples"].reverse()
    before = deepcopy(snapshot)
    with pytest.raises(StorageTrayActionError, match="归属冲突") as rejected:
        BUILDERS[action](snapshot, room=room, tray_code=TRAY, payload=payload, now=NOW)
    assert rejected.value.status_code == 409
    assert snapshot == before


@pytest.mark.parametrize("action", BUILDERS)
@pytest.mark.parametrize("scoped", [False, True])
def test_salt02_api_conflict_writes_nothing_and_ignores_claimed_task(monkeypatch, action, scoped):
    from app.api.routes import storage as route

    snapshot, room, payload = case(action)
    snapshot["mes.samples"].append(foreign_sample())
    if scoped:
        storage = BindingCheckedStorage(snapshot, tray_task_codes={TRAY: TASK})
        client, _ = build_client_with_storage(monkeypatch, storage)
    else:
        client, storage = build_client(monkeypatch, snapshot)
    publications = []
    monkeypatch.setattr(route, "publish_storage_update", lambda *args, **kwargs: publications.append((args, kwargs)))
    before = deepcopy(storage.payloads)
    response = client.post(f"/api/storage/rooms/{room}/trays/{TRAY}/{action}", json={**payload, "taskCode": TASK})
    assert response.status_code == 409, response.text
    assert "归属冲突" in response.json()["detail"]
    assert storage.payloads == before
    assert not publications
    if scoped:
        assert storage.scope_writes == []


@pytest.mark.parametrize("action", BUILDERS)
@pytest.mark.parametrize("historical", ["returned", "unbound", "history-only"])
def test_salt02_same_task_samples_update_but_previous_task_history_stays_unchanged(action, historical):
    snapshot, room, payload = case(action)
    other_current = deepcopy(snapshot["mes.samples"][0])
    other_current["code"] += "-2"
    snapshot["mes.samples"].append(other_current)
    previous = foreign_sample("厂家收回" if historical == "returned" else "实验进行中", unbound=historical == "unbound")
    if historical == "history-only":
        previous["trays"] = []
        previous["history"] = [{"action": "样品分装托盘", "detail": TRAY, "time": "2026-11-08 09:00:00"}]
    # Historical row first: selection may not depend on array order.
    snapshot["mes.samples"].insert(0, previous)
    before = deepcopy(snapshot)
    updates = BUILDERS[action](snapshot, room=room, tray_code=TRAY, payload=payload, now=NOW)
    assert snapshot == before
    assert updates["mes.samples"][0] == previous
    current = [sample for sample in updates["mes.samples"] if sample["task_code"] == TASK]
    expected = {"stock-in": "中途外观检查中", "stock-out": "等待恢复实验", "manufacturer-return": "厂家收回"}[action]
    assert len(current) == 2
    assert all(sample["status"] == expected for sample in current)
    assert all(len(sample["history"]) == 1 for sample in current)
    assert updates["mes.staging_events"][-1]["task_code"] == TASK


@pytest.mark.parametrize("action", BUILDERS)
@pytest.mark.parametrize("scoped", [False, True])
def test_salt02_api_allows_reuse_and_summarizes_current_task(monkeypatch, action, scoped):
    snapshot, room, payload = case(action)
    previous = foreign_sample("厂家收回")
    snapshot["mes.samples"].insert(0, previous)
    if scoped:
        storage = BindingCheckedStorage(snapshot, tray_task_codes={TRAY: TASK})
        client, _ = build_client_with_storage(monkeypatch, storage)
    else:
        client, storage = build_client(monkeypatch, snapshot)
    response = client.post(f"/api/storage/rooms/{room}/trays/{TRAY}/{action}", json=payload)
    assert response.status_code == 200, response.text
    assert response.json()["row"]["taskCode"] == TASK
    assert response.json()["row"]["quantity"] == 1
    assert next(sample for sample in storage.read("mes.samples") if sample["task_code"] == "FOREIGN") == previous


def test_salt02_scoped_owner_mismatch_is_rejected(monkeypatch):
    snapshot, room, payload = case("stock-in")
    storage = BindingCheckedStorage(snapshot, tray_task_codes={TRAY: "STALE-OWNER"})
    client, _ = build_client_with_storage(monkeypatch, storage)
    before = deepcopy(storage.payloads)
    response = client.post(f"/api/storage/rooms/{room}/trays/{TRAY}/stock-in", json=payload)
    assert response.status_code == 409, response.text
    assert storage.payloads == before
    assert storage.scope_reads == storage.scope_writes == []


def test_salt02_missing_task_does_not_use_sample_number_as_task():
    snapshot, room, payload = case("stock-in")
    snapshot["mes.samples"][0].pop("task_code")
    before = deepcopy(snapshot)
    with pytest.raises(StorageTrayActionError, match="归属缺失"):
        build_stock_in_updates(snapshot, room=room, tray_code=TRAY, payload=payload, now=NOW)
    assert snapshot == before


def test_salt02_response_counts_only_current_load_even_after_manufacturer_return(monkeypatch):
    snapshot, room, payload = case("manufacturer-return")
    previous = foreign_sample("厂家收回")
    previous["task_code"] = TASK
    snapshot["mes.samples"].insert(0, previous)
    client, storage = build_client(monkeypatch, snapshot)
    response = client.post(f"/api/storage/rooms/{room}/trays/{TRAY}/manufacturer-return", json=payload)
    assert response.status_code == 200, response.text
    assert response.json()["row"]["quantity"] == 1
    assert storage.read("mes.samples")[0] == previous


@pytest.mark.parametrize("action", ["stock-in", "stock-out"])
def test_salt02_old_pause_and_events_do_not_authorize_or_block_reused_tray(action):
    snapshot, room, payload = case(action)
    old = _salt_mid_appearance_snapshot()
    for key in ("mes.experiment_runs", "mes.experiment_run_trays", "mes.experiment_run_pauses"):
        for row in old[key]:
            row["task_code"] = "FOREIGN"
            if "run_no" in row:
                row["run_no"] = "OLD-RUN"
            if "pause_no" in row:
                row["pause_no"] = "OLD-PAUSE"
        snapshot.setdefault(key, []).extend(old[key])
    snapshot["mes.samples"].insert(0, foreign_sample("厂家收回"))
    snapshot["mes.staging_events"].append({
        "task_code": "FOREIGN", "tray_code": TRAY, "run_no": "OLD-RUN", "pause_no": "OLD-PAUSE",
        "appearance_phase": "mid_experiment", "room": "appearance", "action": "stock_out", "time": "2026-11-08 10:00:00",
    })
    before = deepcopy(snapshot)
    updates = BUILDERS[action](snapshot, room=room, tray_code=TRAY, payload=payload, now=NOW)
    assert snapshot == before
    assert updates["mes.samples"][0] == snapshot["mes.samples"][0]
    assert updates["mes.staging_events"][-1]["task_code"] == TASK
    assert updates["mes.staging_events"][-1]["run_no"] == "RUN-SALT-MID"
