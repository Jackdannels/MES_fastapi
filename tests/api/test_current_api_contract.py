"""The current terminal contract excludes retired APIs and unrestricted workflow writes."""
from copy import deepcopy
import pytest

from app.services.mq_event_processor import process_laboratory_event
from tests.api.test_mq import FakeMqEventRepository
from tests.api.test_storage import build_client


@pytest.mark.parametrize("event", ["experiment-started", "experiment-ended"])
def test_run_events_require_explicit_run_identity_without_selecting_current_lab(event):
    repository = FakeMqEventRepository()
    with pytest.raises(ValueError, match="run_no is required"):
        process_laboratory_event(f"mes/v1/labs/LAB_SALT/events/{event}", {"lab_code": "LAB_SALT"}, repository=repository)
    assert repository.messages == repository.events == repository.ended == repository.started_contexts == []


@pytest.mark.parametrize("field", ["message_type", "event"])
def test_payload_cannot_change_result_topic_into_completion(field):
    repository = FakeMqEventRepository()
    with pytest.raises(ValueError, match="does not match MQTT topic"):
        process_laboratory_event("mes/v1/labs/LAB_SALT/events/experiment-result", {
            "lab_code": "LAB_SALT", "run_no": "RUN-SALT-001", field: "EXPERIMENT_ENDED",
        }, repository=repository)
    assert repository.messages == repository.events == repository.ended == []


@pytest.mark.parametrize("prefix", ["/device", "/permissions", "/workflows", "/yt_object"])
def test_placeholder_api_is_not_registered(client, prefix):
    assert client.post(prefix, json={"name": "old-placeholder"}).status_code == 404


@pytest.mark.parametrize("operation", ["start", "complete", "axis-adjustment-ready"])
def test_local_experiment_write_api_is_retired(client, operation):
    assert client.post(f"/api/laboratory/tasks/T/experiments/E/{operation}", json={}).status_code == 404


@pytest.mark.parametrize("key", ["mes.lims_inbox", "mes.lims_outbox", "mes.lims_completions", "mes.experiment_run_pauses"])
@pytest.mark.parametrize("bulk", [False, True])
def test_private_storage_cannot_be_overwritten_or_cleared(monkeypatch, key, bulk):
    client, storage = build_client(monkeypatch, {key: [{"id": "SERVER-FACT"}]})
    before = storage.read_all()
    response = client.put("/api/storage" if bulk else f"/api/storage/{key}", json={key: []} if bulk else [])
    assert response.status_code == 409
    assert storage.read_all() == before


@pytest.mark.parametrize("status", ["已到达实验室", "工装夹具安装", "实验准备就绪", "实验进行中", "实验暂停", "等待恢复实验", "实验已完成", "实验已取消", "设备故障试验取消"])
def test_generic_storage_cannot_apply_experiment_state(monkeypatch, status):
    sample = {"code": "SP", "task_code": "T", "status": "到货", "flow_status": "到货", "location": "接驳区",
              "trays": [{"tray_code": "TP", "status": "到货"}], "history": []}
    client, storage = build_client(monkeypatch, {"mes.samples": [sample]})
    attempted = deepcopy(sample)
    attempted["status"] = attempted["flow_status"] = attempted["trays"][0]["status"] = status
    response = client.put("/api/storage", json={"mes.samples": [attempted]})
    assert response.status_code == 409
    assert storage.read("mes.samples") == [sample]


def test_generic_storage_still_allows_sample_remark_and_device_config(monkeypatch):
    sample = {"code": "SP", "task_code": "T", "status": "实验进行中", "flow_status": "实验进行中", "location": "盐雾试验室",
              "trays": [{"tray_code": "TP", "status": "实验进行中"}], "history": []}
    client, storage = build_client(monkeypatch, {"mes.samples": [sample]})
    attempted = deepcopy(sample)
    attempted["remark"] = "补充样品备注"
    response = client.put("/api/storage", json={"mes.samples": [attempted], "mes.devices": [{"code": "D", "name": "设备备注"}]})
    assert response.status_code == 200, response.text
    assert storage.read("mes.samples")[0]["remark"] == "补充样品备注"
    assert storage.read("mes.devices")[0]["name"] == "设备备注"


def test_normal_editor_can_echo_server_workflow_snapshot_while_updating_remarks(monkeypatch):
    sample = {"code": "SP", "task_code": "T", "status": "实验进行中", "flow_status": "实验进行中",
              "trays": [{"tray_code": "TP", "status": "实验进行中", "fixture_ready": True}],
              "history": [{"action": "开始实验", "status": "实验进行中", "time": "2026-11-09 09:00:00"}]}
    payload = {
        "mes.samples": [sample],
        "mes.experiment_runs": [{"run_no": "R", "task_code": "T", "experiment_code": "E", "status": "实验进行中"}],
        "mes.experiment_run_trays": [{"run_no": "R", "task_code": "T", "experiment_code": "E", "tray_code": "TP", "status": "实验进行中"}],
        "mes.experiment_run_steps": [{"run_no": "R", "task_code": "T", "experiment_code": "E", "axis_code": "x", "status": "实验进行中"}],
    }
    client, storage = build_client(monkeypatch, payload)
    incoming = deepcopy(payload)
    incoming["mes.samples"][0]["remark"] = "运行期间补充备注"
    response = client.put("/api/storage", json=incoming)
    assert response.status_code == 200, response.text
    assert storage.read("mes.samples")[0]["remark"] == "运行期间补充备注"
    for key in ("mes.experiment_runs", "mes.experiment_run_trays", "mes.experiment_run_steps"):
        assert storage.read(key) == payload[key]


def test_mixed_public_and_private_storage_batch_is_rejected_atomically(monkeypatch):
    client, storage = build_client(monkeypatch, {"mes.devices": [{"code": "D", "remark": "原备注"}]})
    before = storage.read_all()
    response = client.put("/api/storage", json={
        "mes.devices": [{"code": "D", "remark": "新备注"}],
        "mes.experiment_run_pauses": [],
    })
    assert response.status_code == 409
    assert storage.read_all() == before


@pytest.mark.parametrize("key,record", [
    ("mes.experiment_runs", {"run_no": "R", "task_code": "T", "experiment_code": "E", "status": "实验已完成"}),
    ("mes.experiment_run_trays", {"run_no": "R", "task_code": "T", "experiment_code": "E", "tray_code": "TP", "status": "实验已完成"}),
    ("mes.experiment_run_steps", {"run_no": "R", "task_code": "T", "experiment_code": "E", "axis_code": "x", "status": "实验已完成"}),
])
def test_generic_storage_cannot_forge_or_remove_run_facts(monkeypatch, key, record):
    client, storage = build_client(monkeypatch)
    assert client.put("/api/storage", json={key: [record]}).status_code == 409
    assert storage.read(key) == []
    storage.write(key, [record])
    assert client.put("/api/storage", json={key: []}).status_code == 409
    assert storage.read(key) == [record]
