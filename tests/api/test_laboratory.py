from copy import deepcopy
import threading
import time

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest

from app.services.laboratory_operations import apply_laboratory_task_operation, run_atomic_laboratory_operation
from app.services.laboratory_start import start_storage_laboratory_experiment


class FakeLaboratoryStorage:
    def __init__(self, payloads=None):
        self.payloads = {
            "mes.tasks": [],
            "mes.samples": [],
            "mes.schedules": [],
            "mes.experiments": [],
            "mes.experiment_runs": [],
            "mes.experiment_run_trays": [],
            "mes.experiment_trays": [],
            "mes.experiment_samples": [],
            "mes.staging_events": [],
            "mes.devices": [],
            "mes.streams": [],
            "mes.conflicts": [],
        }
        if isinstance(payloads, dict):
            self.payloads.update({key: list(value) for key, value in payloads.items()})

    def read(self, key):
        return list(self.payloads.get(key, []))

    def read_all(self):
        return {key: list(value) for key, value in self.payloads.items()}

    def write(self, key, value):
        self.payloads[key] = list(value)

    def write_many(self, updates):
        for key, value in dict(updates).items():
            self.payloads[key] = list(value)


def build_client(monkeypatch, payloads):
    from app.api.routes import laboratory as laboratory_route

    storage = FakeLaboratoryStorage(payloads)
    monkeypatch.setattr(laboratory_route, "get_storage_backend", lambda: storage)

    app = FastAPI()
    app.include_router(laboratory_route.router)
    return TestClient(app), storage


def base_payloads(samples, experiment_trays=None, staging_events=None):
    tray_rows = experiment_trays or [{"task_code": "TASK-501", "experiment_code": "EXP-B", "tray_code": "TP-501"}]
    sample_by_tray = {}
    for sample in samples:
        sample_code = sample.get("code")
        for tray in sample.get("trays", []):
            tray_code = tray.get("tray_code")
            if sample_code and tray_code:
                sample_by_tray[tray_code] = sample_code
    return {
        "mes.tasks": [{"id": "task-501", "code": "TASK-501", "name": "多实验任务"}],
        "mes.experiments": [
            {"task_code": "TASK-501", "experiment_code": "EXP-A", "experiment_name": "盐雾试验"},
            {"task_code": "TASK-501", "experiment_code": "EXP-B", "experiment_name": "霉菌试验"},
            {"task_code": "TASK-501", "experiment_code": "EXP-C", "experiment_name": "振动试验"},
        ],
        "mes.schedules": [
            {"task_code": "TASK-501", "experiment_code": "EXP-A", "device": "盐雾试验室"},
            {"task_code": "TASK-501", "experiment_code": "EXP-B", "device": "霉菌试验室"},
            {"task_code": "TASK-501", "experiment_code": "EXP-C", "device": "振动一室"},
        ],
        "mes.experiment_runs": [],
        "mes.experiment_trays": tray_rows,
        "mes.experiment_samples": [
            {
                "task_code": row["task_code"],
                "experiment_code": row["experiment_code"],
                "sample_code": sample_by_tray[row["tray_code"]],
            }
            for row in tray_rows
            if row.get("tray_code") in sample_by_tray
        ],
        "mes.samples": samples,
        "mes.staging_events": staging_events or [],
    }


def sample_with_history(status, location, history, tray_code="TP-501"):
    return {
        "id": "sample-501",
        "code": "SP-501",
        "task_code": "TASK-501",
        "status": status,
        "flow_status": status,
        "location": location,
        "trays": [{"tray_code": tray_code, "quantity": 1, "status": status, "fixture_ready": True, "fixtureReady": True}],
        "history": history,
    }


def test_laboratory_complete_experiment_updates_storage_through_common_endpoint(monkeypatch):
    sample = sample_with_history(
        "实验进行中",
        "盐雾试验室",
        [{"action": "开始实验", "detail": "TASK-501 / 盐雾试验 / 实验进行中", "status": "实验进行中", "time": "2026-05-19T09:00:00"}],
    )
    payloads = base_payloads(
        [sample],
        experiment_trays=[{"task_code": "TASK-501", "experiment_code": "EXP-A", "tray_code": "TP-501"}],
    )
    payloads["mes.experiment_runs"] = [
        {
            "run_no": "RUN-501",
            "task_code": "TASK-501",
            "experiment_code": "EXP-A",
            "tray_codes": ["TP-501"],
            "status": "实验进行中",
        }
    ]
    client, storage = build_client(monkeypatch, payloads)

    response = client.post(
        "/api/laboratory/tasks/TASK-501/experiments/EXP-A/complete",
        json={"runNo": "RUN-501", "trayCodes": ["TP-501"], "completedAt": "2026-05-19T10:00:00"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["affectedTrayCodes"] == ["TP-501"]
    updated_sample = storage.read("mes.samples")[0]
    assert updated_sample["location"] == "外观检测间"
    assert updated_sample["status"] == "送至外观检测间"
    assert updated_sample["flow_status"] == "送至外观检测间"
    assert updated_sample["trays"][0]["status"] == "送至外观检测间"
    assert updated_sample["history"][0] == {
        "action": "实验完成",
        "detail": "TASK-501 / 盐雾试验 / 实验已完成",
        "location": "盐雾试验室",
        "owner": "",
        "status": "实验已完成",
        "time": "2026-05-19 10:00:00",
        "tray_code": "TP-501",
    }
    assert storage.read("mes.experiments")[0]["status"] == "实验已完成"
    assert storage.read("mes.schedules")[0]["status"] == "实验已完成"
    assert storage.read("mes.experiment_runs")[0]["status"] == "实验已完成"
    assert storage.read("mes.experiment_run_trays") == [
        {
            "run_no": "RUN-501",
            "task_code": "TASK-501",
            "experiment_code": "EXP-A",
            "tray_code": "TP-501",
            "status": "实验已完成",
            "run_tray_status": "实验已完成",
            "started_at": "",
            "ended_at": "2026-05-19 10:00:00",
            "created_at": "2026-05-19 10:00:00",
            "updated_at": "2026-05-19 10:00:00",
        }
    ]


def test_laboratory_complete_experiment_clears_stale_tray_target(monkeypatch):
    sample = sample_with_history(
        "实验进行中",
        "振动一室",
        [{"action": "开始实验", "detail": "TASK-501 / 振动试验 / 实验进行中", "status": "实验进行中", "time": "2026-05-19T09:00:00"}],
    )
    sample["trays"][0]["target_lab"] = "振动一室"
    sample["trays"][0]["target_experiment_code"] = "EXP-C"
    payloads = base_payloads(
        [sample],
        experiment_trays=[
            {"task_code": "TASK-501", "experiment_code": "EXP-C", "tray_code": "TP-501"},
            {"task_code": "TASK-501", "experiment_code": "EXP-A", "tray_code": "TP-501"},
        ],
    )
    payloads["mes.experiment_runs"] = [
        {
            "run_no": "RUN-VIB-501",
            "task_code": "TASK-501",
            "experiment_code": "EXP-C",
            "tray_codes": ["TP-501"],
            "status": "实验进行中",
        }
    ]
    client, storage = build_client(monkeypatch, payloads)

    response = client.post(
        "/api/laboratory/tasks/TASK-501/experiments/EXP-C/complete",
        json={"runNo": "RUN-VIB-501", "trayCodes": ["TP-501"], "completedAt": "2026-05-19T10:00:00"},
    )

    assert response.status_code == 200
    completed_tray = storage.read("mes.samples")[0]["trays"][0]
    assert completed_tray["status"] == "实验已完成"
    assert "target_lab" not in completed_tray
    assert "target_experiment_code" not in completed_tray


def test_laboratory_complete_experiment_keeps_schedule_running_until_all_trays_finish(monkeypatch):
    payloads = base_payloads(
        [
            sample_with_history("实验进行中", "盐雾试验室", [], tray_code="TP-501"),
            sample_with_history("实验准备就绪", "盐雾试验室", [], tray_code="TP-502"),
        ],
        experiment_trays=[
            {"task_code": "TASK-501", "experiment_code": "EXP-A", "tray_code": "TP-501"},
            {"task_code": "TASK-501", "experiment_code": "EXP-A", "tray_code": "TP-502"},
        ],
    )
    payloads["mes.experiment_runs"] = [
        {
            "run_no": "RUN-501-A",
            "task_code": "TASK-501",
            "experiment_code": "EXP-A",
            "tray_codes": ["TP-501"],
            "status": "实验进行中",
        },
        {
            "run_no": "RUN-501-B",
            "task_code": "TASK-501",
            "experiment_code": "EXP-A",
            "tray_codes": ["TP-502"],
            "status": "实验准备就绪",
        },
    ]
    client, storage = build_client(monkeypatch, payloads)

    response = client.post(
        "/api/laboratory/tasks/TASK-501/experiments/EXP-A/complete",
        json={"runNo": "RUN-501-A", "trayCodes": ["TP-501"], "completedAt": "2026-05-19T10:00:00"},
    )

    assert response.status_code == 200
    assert storage.read("mes.samples")[0]["trays"][0]["status"] == "送至外观检测间"
    assert storage.read("mes.samples")[1]["trays"][0]["status"] == "实验准备就绪"
    assert storage.read("mes.experiments")[0]["status"] == "实验进行中"
    assert storage.read("mes.schedules")[0]["status"] == "实验进行中"
    assert storage.read("mes.experiment_runs")[0]["status"] == "实验已完成"
    assert storage.read("mes.experiment_runs")[1]["status"] == "实验准备就绪"


def test_laboratory_complete_experiment_infers_batch_trays_from_run_tray_relations_when_tray_codes_omitted(monkeypatch):
    payloads = base_payloads(
        [
            sample_with_history("实验进行中", "盐雾试验室", [], tray_code="TP-501"),
            sample_with_history("实验准备就绪", "盐雾试验室", [], tray_code="TP-502"),
        ],
        experiment_trays=[
            {"task_code": "TASK-501", "experiment_code": "EXP-A", "tray_code": "TP-501"},
            {"task_code": "TASK-501", "experiment_code": "EXP-A", "tray_code": "TP-502"},
        ],
    )
    payloads["mes.experiment_runs"] = [
        {
            "run_no": "RUN-501-A",
            "task_code": "TASK-501",
            "experiment_code": "EXP-A",
            "status": "实验进行中",
        },
        {
            "run_no": "RUN-501-B",
            "task_code": "TASK-501",
            "experiment_code": "EXP-A",
            "status": "实验准备就绪",
        },
    ]
    payloads["mes.experiment_run_trays"] = [
        {
            "run_no": "RUN-501-A",
            "task_code": "TASK-501",
            "experiment_code": "EXP-A",
            "tray_code": "TP-501",
            "status": "实验进行中",
            "run_tray_status": "实验进行中",
        },
        {
            "run_no": "RUN-501-B",
            "task_code": "TASK-501",
            "experiment_code": "EXP-A",
            "tray_code": "TP-502",
            "status": "实验准备就绪",
            "run_tray_status": "实验准备就绪",
        },
    ]
    payloads["mes.experiment_samples"] = [
        {"task_code": "TASK-501", "experiment_code": "EXP-A", "sample_code": "SP-501"},
    ]
    client, storage = build_client(monkeypatch, payloads)

    response = client.post(
        "/api/laboratory/tasks/TASK-501/experiments/EXP-A/complete",
        json={"runNo": "RUN-501-A", "completedAt": "2026-05-19T10:00:00"},
    )

    assert response.status_code == 200
    assert response.json()["affectedTrayCodes"] == ["TP-501"]
    assert storage.read("mes.samples")[0]["trays"][0]["status"] == "送至外观检测间"
    assert storage.read("mes.samples")[1]["trays"][0]["status"] == "实验准备就绪"
    assert storage.read("mes.experiments")[0]["status"] == "实验进行中"
    assert storage.read("mes.schedules")[0]["status"] == "实验进行中"
    assert storage.read("mes.experiment_run_trays") == [
        {
            "run_no": "RUN-501-A",
            "task_code": "TASK-501",
            "experiment_code": "EXP-A",
            "tray_code": "TP-501",
            "status": "实验已完成",
            "run_tray_status": "实验已完成",
            "ended_at": "2026-05-19 10:00:00",
            "updated_at": "2026-05-19 10:00:00",
        },
        {
            "run_no": "RUN-501-B",
            "task_code": "TASK-501",
            "experiment_code": "EXP-A",
            "tray_code": "TP-502",
            "status": "实验准备就绪",
            "run_tray_status": "实验准备就绪",
        },
    ]


def test_laboratory_complete_experiment_rejects_run_tray_codes_fallback_when_tray_codes_omitted(monkeypatch):
    payloads = base_payloads(
        [sample_with_history("实验进行中", "盐雾试验室", [], tray_code="TP-501")],
        experiment_trays=[{"task_code": "TASK-501", "experiment_code": "EXP-A", "tray_code": "TP-501"}],
    )
    payloads["mes.experiment_runs"] = [
        {
            "run_no": "RUN-501-A",
            "task_code": "TASK-501",
            "experiment_code": "EXP-A",
            "tray_codes": ["TP-501"],
            "status": "实验进行中",
        }
    ]
    client, storage = build_client(monkeypatch, payloads)

    response = client.post(
        "/api/laboratory/tasks/TASK-501/experiments/EXP-A/complete",
        json={"runNo": "RUN-501-A", "completedAt": "2026-05-19T10:00:00"},
    )

    assert response.status_code == 400
    assert "experiment_run_trays" in response.json()["detail"]
    assert storage.read("mes.samples")[0]["trays"][0]["status"] == "实验进行中"


def test_laboratory_complete_experiment_rejects_ambiguous_multi_tray_completion(monkeypatch):
    payloads = base_payloads(
        [
            sample_with_history("实验进行中", "盐雾试验室", [], tray_code="TP-501"),
            sample_with_history("实验准备就绪", "盐雾试验室", [], tray_code="TP-502"),
        ],
        experiment_trays=[
            {"task_code": "TASK-501", "experiment_code": "EXP-A", "tray_code": "TP-501"},
            {"task_code": "TASK-501", "experiment_code": "EXP-A", "tray_code": "TP-502"},
        ],
    )
    client, storage = build_client(monkeypatch, payloads)

    response = client.post(
        "/api/laboratory/tasks/TASK-501/experiments/EXP-A/complete",
        json={"completedAt": "2026-05-19T10:00:00"},
    )

    assert response.status_code == 400
    assert "trayCodes" in response.json()["detail"]
    assert storage.read("mes.samples")[0]["trays"][0]["status"] == "实验进行中"
    assert storage.read("mes.samples")[1]["trays"][0]["status"] == "实验准备就绪"


def test_laboratory_complete_experiment_ignores_other_experiment_completion_when_checking_remaining_trays(monkeypatch):
    salt_running = sample_with_history("实验进行中", "盐雾试验室", [], tray_code="TP-501")
    mold_completed = sample_with_history(
        "实验已完成",
        "霉菌试验室",
        [
            {
                "action": "实验完成",
                "detail": "TASK-501 / 霉菌试验 / 实验已完成",
                "location": "霉菌试验室",
                "status": "实验已完成",
                "time": "2026-05-19T09:30:00",
            },
        ],
        tray_code="TP-502",
    )
    payloads = base_payloads(
        [salt_running, mold_completed],
        experiment_trays=[
            {"task_code": "TASK-501", "experiment_code": "EXP-A", "tray_code": "TP-501"},
            {"task_code": "TASK-501", "experiment_code": "EXP-A", "tray_code": "TP-502"},
            {"task_code": "TASK-501", "experiment_code": "EXP-B", "tray_code": "TP-502"},
        ],
    )
    payloads["mes.experiment_runs"] = [
        {
            "run_no": "RUN-SALT-501",
            "task_code": "TASK-501",
            "experiment_code": "EXP-A",
            "tray_codes": ["TP-501"],
            "status": "实验进行中",
        },
        {
            "run_no": "RUN-MOLD-502",
            "task_code": "TASK-501",
            "experiment_code": "EXP-B",
            "tray_codes": ["TP-502"],
            "status": "实验已完成",
        },
    ]
    client, storage = build_client(monkeypatch, payloads)

    response = client.post(
        "/api/laboratory/tasks/TASK-501/experiments/EXP-A/complete",
        json={"runNo": "RUN-SALT-501", "trayCodes": ["TP-501"], "completedAt": "2026-05-19T10:00:00"},
    )

    assert response.status_code == 200
    assert storage.read("mes.samples")[0]["trays"][0]["status"] == "送至外观检测间"
    assert storage.read("mes.samples")[1]["trays"][0]["status"] == "实验已完成"
    assert storage.read("mes.experiments")[0]["status"] == "实验进行中"
    assert storage.read("mes.schedules")[0]["status"] == "实验进行中"


def test_laboratory_start_does_not_treat_multi_tray_sample_returned_status_as_all_trays_returned():
    task_code = "TASK-501"
    sample = {
        "id": "sample-501",
        "code": "SP-501",
        "task_code": task_code,
        "status": "厂家收回",
        "flow_status": "厂家收回",
        "location": "厂家收回",
        "trays": [
            {"tray_code": "TP-501-A", "quantity": 1, "status": "厂家收回"},
            {"tray_code": "TP-501-B", "quantity": 1, "status": "实验准备就绪"},
        ],
        "history": [],
    }
    snapshot = {
        "tasks": [{"id": task_code, "code": task_code, "status": "任务进行中"}],
        "samples": [sample],
        "schedules": [{"task_code": task_code, "experiment_code": "EXP-B", "device": "霉菌试验室"}],
        "experiments": [{"task_code": task_code, "experiment_code": "EXP-B", "experiment_name": "霉菌试验"}],
        "experiment_runs": [],
        "experiment_run_trays": [],
        "experiment_trays": [
            {"task_code": task_code, "experiment_code": "EXP-B", "tray_code": "TP-501-B"},
        ],
        "experiment_samples": [{"task_code": task_code, "experiment_code": "EXP-B", "sample_code": "SP-501"}],
    }

    result = start_storage_laboratory_experiment(
        snapshot,
        task_code=task_code,
        experiment_code="EXP-B",
        run_no="RUN-B",
        lab_name="霉菌试验室",
        tray_codes=["TP-501-B"],
        started_at="2026-06-06 15:00:00",
    )

    updated_trays = result["samples"][0]["trays"]
    assert updated_trays[0]["status"] == "厂家收回"
    assert updated_trays[1]["status"] == "实验进行中"
    assert result["affectedTrayCodes"] == ["TP-501-B"]


def test_laboratory_start_rejects_target_tray_returned_status_without_run_tray_record():
    task_code = "TASK-501"
    snapshot = {
        "tasks": [{"id": task_code, "code": task_code, "status": "任务进行中"}],
        "samples": [
            {
                "id": "sample-501",
                "code": "SP-501",
                "task_code": task_code,
                "status": "厂家收回",
                "flow_status": "厂家收回",
                "location": "厂家收回",
                "trays": [{"tray_code": "TP-501-A", "quantity": 1, "status": "厂家收回"}],
                "history": [],
            }
        ],
        "schedules": [{"task_code": task_code, "experiment_code": "EXP-B", "device": "霉菌试验室"}],
        "experiments": [{"task_code": task_code, "experiment_code": "EXP-B", "experiment_name": "霉菌试验"}],
        "experiment_runs": [],
        "experiment_run_trays": [],
        "experiment_trays": [
            {"task_code": task_code, "experiment_code": "EXP-B", "tray_code": "TP-501-A"},
        ],
        "experiment_samples": [{"task_code": task_code, "experiment_code": "EXP-B", "sample_code": "SP-501"}],
    }

    with pytest.raises(ValueError, match="current experiment has no matching active tray samples"):
        start_storage_laboratory_experiment(
            snapshot,
            task_code=task_code,
            experiment_code="EXP-B",
            run_no="RUN-B",
            lab_name="霉菌试验室",
            tray_codes=["TP-501-A"],
            started_at="2026-06-06 15:00:00",
        )

    assert snapshot["samples"][0]["trays"][0]["status"] == "厂家收回"


def test_laboratory_complete_does_not_promote_multi_tray_sample_status_from_one_completed_tray(monkeypatch):
    task_code = "TASK-501"
    sample = {
        "id": "sample-501",
        "code": "SP-501",
        "task_code": task_code,
        "status": "实验进行中",
        "flow_status": "实验进行中",
        "location": "盐雾试验室",
        "trays": [
            {"tray_code": "TP-501-A", "quantity": 1, "status": "实验进行中"},
            {"tray_code": "TP-501-B", "quantity": 1, "status": "实验准备就绪"},
        ],
        "history": [],
    }
    payloads = base_payloads(
        [sample],
        experiment_trays=[
            {"task_code": task_code, "experiment_code": "EXP-A", "tray_code": "TP-501-A"},
            {"task_code": task_code, "experiment_code": "EXP-A", "tray_code": "TP-501-B"},
        ],
    )
    payloads["mes.experiment_runs"] = [
        {
            "run_no": "RUN-A",
            "task_code": task_code,
            "experiment_code": "EXP-A",
            "tray_codes": ["TP-501-A"],
            "status": "实验进行中",
        }
    ]
    client, storage = build_client(monkeypatch, payloads)

    response = client.post(
        f"/api/laboratory/tasks/{task_code}/experiments/EXP-A/complete",
        json={"runNo": "RUN-A", "trayCodes": ["TP-501-A"], "completedAt": "2026-06-06 15:20:00"},
    )

    assert response.status_code == 200
    updated_sample = storage.read("mes.samples")[0]
    assert updated_sample["status"] == "实验进行中"
    assert updated_sample["flow_status"] == "实验进行中"
    assert updated_sample["trays"][0]["status"] == "送至外观检测间"
    assert updated_sample["trays"][1]["status"] == "实验准备就绪"


def test_laboratory_withdraw_current_does_not_overwrite_sample_status_when_other_tray_still_running(monkeypatch):
    client, storage = build_client(
        monkeypatch,
        base_payloads(
            [
                {
                    "id": "sample-501",
                    "code": "SP-501",
                    "task_code": "TASK-501",
                    "status": "实验进行中",
                    "flow_status": "实验进行中",
                    "location": "霉菌试验室",
                    "trays": [
                        {"tray_code": "TP-501-A", "quantity": 1, "status": "工装夹具安装", "fixture_ready": True},
                        {"tray_code": "TP-501-B", "quantity": 1, "status": "实验进行中"},
                    ],
                    "history": [
                        {"action": "送至实验室", "status": "送至实验室", "location": "霉菌试验室", "time": "2026-05-19T10:00:00"},
                        {"action": "任务比对", "status": "已到达实验室", "location": "霉菌试验室", "time": "2026-05-19T10:10:00"},
                        {"action": "样品安装", "status": "工装夹具安装", "location": "霉菌试验室", "time": "2026-05-19T10:20:00"},
                    ],
                }
            ],
            experiment_trays=[
                {"task_code": "TASK-501", "experiment_code": "EXP-B", "tray_code": "TP-501-A"},
            ],
        ),
    )

    response = client.post("/api/laboratory/tasks/TASK-501/experiments/EXP-B/withdraw-current", json={"reason": "复核撤回"})

    assert response.status_code == 200
    updated = storage.read("mes.samples")[0]
    assert updated["status"] == "实验进行中"
    assert updated["flow_status"] == "实验进行中"
    assert updated["location"] == "霉菌试验室"
    assert updated["trays"][0]["status"] == "到货"
    assert updated["trays"][1]["status"] == "实验进行中"


def test_laboratory_withdraw_current_restores_handover_origin_to_arrived(monkeypatch):
    client, storage = build_client(
        monkeypatch,
        base_payloads(
            [
                sample_with_history(
                    "工装夹具安装",
                    "霉菌试验室",
                    [
                        {"action": "样品安装", "status": "工装夹具安装", "location": "霉菌试验室", "time": "2026-05-19T10:20:00"},
                        {"action": "任务比对", "status": "已到达实验室", "location": "霉菌试验室", "time": "2026-05-19T10:10:00"},
                        {"action": "送至实验室", "status": "送至实验室", "location": "霉菌试验室", "time": "2026-05-19T10:00:00"},
                        {"action": "任务样品入库", "status": "到货", "location": "接驳区", "time": "2026-05-19T09:00:00"},
                    ],
                )
            ]
        ),
    )

    immutable_before = {
        key: deepcopy(storage.read(key))
        for key in ["mes.tasks", "mes.experiments", "mes.experiment_trays", "mes.experiment_samples", "mes.schedules"]
    }
    response = client.post("/api/laboratory/tasks/TASK-501/experiments/EXP-B/withdraw-current", json={"reason": "试验间选择错误"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["restoredStatus"] == "到货"
    updated = storage.read("mes.samples")[0]
    assert updated["status"] == "到货"
    assert updated["flow_status"] == "到货"
    assert updated["location"] == "接驳区"
    assert updated["trays"][0]["status"] == "到货"
    assert "fixture_ready" not in updated["trays"][0]
    assert "fixtureReady" not in updated["trays"][0]
    assert updated["history"][0]["action"] == "实验任务撤回"
    assert "撤回至到货" in updated["history"][0]["detail"]
    for key, before in immutable_before.items():
        assert storage.read(key) == before


def test_laboratory_withdraw_current_publishes_storage_updates(monkeypatch):
    from app.api.routes import laboratory as laboratory_route

    published_updates = []
    monkeypatch.setattr(laboratory_route, "publish_storage_update", lambda keys: published_updates.append(list(keys)), raising=False)
    client, _storage = build_client(
        monkeypatch,
        base_payloads(
            [
                sample_with_history(
                    "工装夹具安装",
                    "霉菌试验室",
                    [
                        {"action": "样品安装", "status": "工装夹具安装", "location": "霉菌试验室", "time": "2026-05-19T10:20:00"},
                        {"action": "任务比对", "status": "已到达实验室", "location": "霉菌试验室", "time": "2026-05-19T10:10:00"},
                        {"action": "送至实验室", "status": "送至实验室", "location": "霉菌试验室", "time": "2026-05-19T10:00:00"},
                        {"action": "任务样品入库", "status": "到货", "location": "接驳区", "time": "2026-05-19T09:00:00"},
                    ],
                )
            ]
        ),
    )

    response = client.post("/api/laboratory/tasks/TASK-501/experiments/EXP-B/withdraw-current", json={"reason": "试验间选择错误"})

    assert response.status_code == 200
    assert published_updates == [["mes.samples", "mes.staging_events"]]


def test_laboratory_operation_preserves_other_lab_tray_state(monkeypatch):
    from app.api.routes import laboratory as laboratory_route

    published_updates = []
    monkeypatch.setattr(laboratory_route, "publish_storage_update", lambda keys: published_updates.append(list(keys)), raising=False)
    client, storage = build_client(
        monkeypatch,
        {
            "mes.tasks": [{"id": "task-parallel", "code": "TASK-PARALLEL", "name": "并行实验任务"}],
            "mes.experiments": [
                {"task_code": "TASK-PARALLEL", "experiment_code": "EXP-A", "experiment_name": "冲击试验"},
                {"task_code": "TASK-PARALLEL", "experiment_code": "EXP-B", "experiment_name": "霉菌试验"},
            ],
            "mes.schedules": [
                {"task_code": "TASK-PARALLEL", "experiment_code": "EXP-A", "device": "冲击一室"},
                {"task_code": "TASK-PARALLEL", "experiment_code": "EXP-B", "device": "霉菌试验室"},
            ],
            "mes.experiment_trays": [
                {"task_code": "TASK-PARALLEL", "experiment_code": "EXP-A", "tray_code": "TP-A"},
                {"task_code": "TASK-PARALLEL", "experiment_code": "EXP-B", "tray_code": "TP-B"},
            ],
            "mes.experiment_samples": [
                {"task_code": "TASK-PARALLEL", "experiment_code": "EXP-A", "sample_code": "SP-A"},
                {"task_code": "TASK-PARALLEL", "experiment_code": "EXP-B", "sample_code": "SP-B"},
            ],
            "mes.samples": [
                {
                    "id": "sample-a",
                    "code": "SP-A",
                    "task_code": "TASK-PARALLEL",
                    "status": "已到达实验室",
                    "flow_status": "已到达实验室",
                    "location": "冲击一室",
                    "trays": [{"tray_code": "TP-A", "quantity": 1, "status": "已到达实验室"}],
                    "history": [{"action": "任务比对", "status": "已到达实验室", "location": "冲击一室", "time": "2026-06-11 10:00:00"}],
                },
                {
                    "id": "sample-b",
                    "code": "SP-B",
                    "task_code": "TASK-PARALLEL",
                    "status": "已到达实验室",
                    "flow_status": "已到达实验室",
                    "location": "霉菌试验室",
                    "trays": [{"tray_code": "TP-B", "quantity": 1, "status": "已到达实验室"}],
                    "history": [{"action": "任务比对", "status": "已到达实验室", "location": "霉菌试验室", "time": "2026-06-11 10:01:00"}],
                },
            ],
        },
    )

    response = client.post(
        "/api/laboratory/operations",
        json={
            "operationType": "install",
            "taskCode": "TASK-PARALLEL",
            "experimentCode": "EXP-B",
            "labName": "霉菌试验室",
            "trayCodes": ["TP-B"],
            "occurredAt": "2026-06-11 10:02:00",
        },
    )

    assert response.status_code == 200
    assert response.json()["affectedTrayCodes"] == ["TP-B"]
    samples = {sample["code"]: sample for sample in storage.read("mes.samples")}
    assert samples["SP-A"]["status"] == "已到达实验室"
    assert samples["SP-A"]["location"] == "冲击一室"
    assert samples["SP-A"]["trays"][0]["status"] == "已到达实验室"
    assert samples["SP-A"]["history"] == [{"action": "任务比对", "status": "已到达实验室", "location": "冲击一室", "time": "2026-06-11 10:00:00"}]
    assert samples["SP-B"]["status"] == "工装夹具安装"
    assert samples["SP-B"]["location"] == "霉菌试验室"
    assert samples["SP-B"]["trays"][0]["status"] == "工装夹具安装"
    assert samples["SP-B"]["history"][0]["action"] == "样品安装"
    assert samples["SP-B"]["history"][0]["detail"] == "TASK-PARALLEL / 霉菌试验 / 工装夹具安装"
    assert published_updates == [["mes.samples"]]


def test_laboratory_compare_operation_clears_stale_fixture_ready(monkeypatch):
    client, storage = build_client(
        monkeypatch,
        {
            "mes.tasks": [{"id": "task-fixture", "code": "TASK-FIXTURE", "name": "夹具标记清理任务"}],
            "mes.experiments": [
                {"task_code": "TASK-FIXTURE", "experiment_code": "EXP-VIB", "experiment_name": "振动试验"},
            ],
            "mes.schedules": [
                {"task_code": "TASK-FIXTURE", "experiment_code": "EXP-VIB", "device": "振动一室"},
            ],
            "mes.experiment_trays": [
                {"task_code": "TASK-FIXTURE", "experiment_code": "EXP-VIB", "tray_code": "TP-FIXTURE"},
            ],
            "mes.samples": [
                {
                    "id": "sample-fixture",
                    "code": "SP-FIXTURE",
                    "task_code": "TASK-FIXTURE",
                    "status": "送至实验室",
                    "flow_status": "送至实验室",
                    "location": "振动一室",
                    "trays": [
                        {
                            "fixtureReady": True,
                            "fixture_ready": True,
                            "quantity": 1,
                            "status": "送至实验室",
                            "target_experiment_code": "EXP-VIB",
                            "target_lab": "振动一室",
                            "tray_code": "TP-FIXTURE",
                        }
                    ],
                    "history": [],
                },
            ],
        },
    )

    response = client.post(
        "/api/laboratory/operations",
        json={
            "operationType": "compare",
            "taskCode": "TASK-FIXTURE",
            "experimentCode": "EXP-VIB",
            "labName": "振动一室",
            "trayCodes": ["TP-FIXTURE"],
            "occurredAt": "2026-06-11 10:02:00",
        },
    )

    assert response.status_code == 200
    tray = storage.read("mes.samples")[0]["trays"][0]
    assert tray["status"] == "已到达实验室"
    assert "fixtureReady" not in tray
    assert "fixture_ready" not in tray


def test_laboratory_compare_operation_rewrites_stale_tray_target(monkeypatch):
    client, storage = build_client(
        monkeypatch,
        {
            "mes.tasks": [{"id": "task-stale-target", "code": "TASK-STALE", "name": "旧目标字段任务"}],
            "mes.experiments": [
                {"task_code": "TASK-STALE", "experiment_code": "EXP-HUMID", "experiment_name": "高低温湿热试验"},
                {"task_code": "TASK-STALE", "experiment_code": "EXP-TEMP", "experiment_name": "温度冲击试验"},
            ],
            "mes.schedules": [
                {"task_code": "TASK-STALE", "experiment_code": "EXP-HUMID", "device": "高低温湿热一室"},
            ],
            "mes.experiment_trays": [
                {"task_code": "TASK-STALE", "experiment_code": "EXP-HUMID", "tray_code": "TP-STALE"},
                {"task_code": "TASK-STALE", "experiment_code": "EXP-TEMP", "tray_code": "TP-STALE"},
            ],
            "mes.experiment_samples": [
                {"task_code": "TASK-STALE", "experiment_code": "EXP-HUMID", "sample_code": "SP-STALE"},
            ],
            "mes.samples": [
                {
                    "id": "sample-stale-target",
                    "code": "SP-STALE",
                    "task_code": "TASK-STALE",
                    "status": "已到达实验室",
                    "flow_status": "已到达实验室",
                    "location": "高低温湿热一室",
                    "trays": [
                        {
                            "quantity": 1,
                            "status": "已到达实验室",
                            "target_experiment_code": "EXP-TEMP",
                            "target_lab": "温度冲击一室",
                            "tray_code": "TP-STALE",
                        }
                    ],
                    "history": [],
                },
            ],
        },
    )

    response = client.post(
        "/api/laboratory/operations",
        json={
            "operationType": "compare",
            "taskCode": "TASK-STALE",
            "experimentCode": "EXP-HUMID",
            "labName": "高低温湿热一室",
            "trayCodes": ["TP-STALE"],
            "occurredAt": "2026-06-12 13:50:58",
        },
    )

    assert response.status_code == 200
    tray = storage.read("mes.samples")[0]["trays"][0]
    assert tray["status"] == "已到达实验室"
    assert tray["target_experiment_code"] == "EXP-HUMID"
    assert tray["target_lab"] == "高低温湿热一室"


def test_laboratory_operations_merge_against_latest_snapshot_when_parallel_labs_commit():
    class DelayedFirstWriteStorage(FakeLaboratoryStorage):
        def __init__(self, payloads):
            super().__init__(payloads)
            self.first_write_waiting = threading.Event()
            self.release_first_write = threading.Event()
            self._lock = threading.Lock()
            self._write_count = 0

        def read_all(self):
            with self._lock:
                return deepcopy(self.payloads)

        def write_many(self, updates):
            with self._lock:
                self._write_count += 1
                write_count = self._write_count
            if write_count == 1:
                self.first_write_waiting.set()
                assert self.release_first_write.wait(2)
            with self._lock:
                for key, value in dict(updates).items():
                    self.payloads[key] = deepcopy(value)

    storage = DelayedFirstWriteStorage(
        {
            "mes.tasks": [{"id": "task-parallel", "code": "TASK-PARALLEL", "name": "并行实验任务"}],
            "mes.experiments": [
                {"task_code": "TASK-PARALLEL", "experiment_code": "EXP-A", "experiment_name": "冲击试验"},
                {"task_code": "TASK-PARALLEL", "experiment_code": "EXP-B", "experiment_name": "霉菌试验"},
            ],
            "mes.schedules": [
                {"task_code": "TASK-PARALLEL", "experiment_code": "EXP-A", "device": "冲击一室"},
                {"task_code": "TASK-PARALLEL", "experiment_code": "EXP-B", "device": "霉菌试验室"},
            ],
            "mes.experiment_trays": [
                {"task_code": "TASK-PARALLEL", "experiment_code": "EXP-A", "tray_code": "TP-A"},
                {"task_code": "TASK-PARALLEL", "experiment_code": "EXP-B", "tray_code": "TP-B"},
            ],
            "mes.experiment_samples": [
                {"task_code": "TASK-PARALLEL", "experiment_code": "EXP-A", "sample_code": "SP-A"},
                {"task_code": "TASK-PARALLEL", "experiment_code": "EXP-B", "sample_code": "SP-B"},
            ],
            "mes.samples": [
                {
                    "id": "sample-a",
                    "code": "SP-A",
                    "task_code": "TASK-PARALLEL",
                    "status": "已到达实验室",
                    "flow_status": "已到达实验室",
                    "location": "冲击一室",
                    "trays": [{"tray_code": "TP-A", "quantity": 1, "status": "已到达实验室"}],
                    "history": [],
                },
                {
                    "id": "sample-b",
                    "code": "SP-B",
                    "task_code": "TASK-PARALLEL",
                    "status": "已到达实验室",
                    "flow_status": "已到达实验室",
                    "location": "霉菌试验室",
                    "trays": [{"tray_code": "TP-B", "quantity": 1, "status": "已到达实验室"}],
                    "history": [],
                },
            ],
        }
    )
    errors = []

    def run_operation(experiment_code, lab_name, tray_code):
        try:
            run_atomic_laboratory_operation(
                operation=lambda snapshot: apply_laboratory_task_operation(
                    snapshot,
                    operation_type="install",
                    task_code="TASK-PARALLEL",
                    experiment_code=experiment_code,
                    lab_name=lab_name,
                    tray_codes=[tray_code],
                    occurred_at="2026-06-11 10:02:00",
                ),
                publish_storage_update=None,
                resource_keys=[f"lab:{lab_name}", f"tray:{tray_code}"],
                storage=storage,
            )
        except Exception as exc:  # pragma: no cover - surfaced below for thread failures
            errors.append(exc)

    first_thread = threading.Thread(target=run_operation, args=("EXP-A", "冲击一室", "TP-A"))
    first_thread.start()
    assert storage.first_write_waiting.wait(2)

    second_thread = threading.Thread(target=run_operation, args=("EXP-B", "霉菌试验室", "TP-B"))
    second_thread.start()
    time.sleep(0.05)
    storage.release_first_write.set()
    first_thread.join(2)
    second_thread.join(2)

    assert errors == []
    samples = {sample["code"]: sample for sample in storage.read("mes.samples")}
    assert samples["SP-A"]["trays"][0]["status"] == "工装夹具安装"
    assert samples["SP-B"]["trays"][0]["status"] == "工装夹具安装"


def test_laboratory_withdraw_current_ignores_stale_staging_history_after_prior_withdraw(monkeypatch):
    client, storage = build_client(
        monkeypatch,
        base_payloads(
            [
                sample_with_history(
                    "工装夹具安装",
                    "霉菌试验室",
                    [
                        {"action": "样品安装", "status": "工装夹具安装", "location": "霉菌试验室", "time": "2026-05-19T10:20:00"},
                        {"action": "送至实验室", "status": "送至实验室", "location": "霉菌试验室", "time": "2026-05-19T10:00:00"},
                        {"action": "撤回出库", "status": "已到达暂存间", "location": "恒温恒湿间（暂存间）", "time": "2026-05-18T10:10:00"},
                        {"action": "暂存间扫码出库", "status": "送至实验室", "location": "错误试验室", "time": "2026-05-18T10:00:00"},
                        {"action": "暂存间扫码入库", "status": "已到达暂存间", "location": "恒温恒湿间（暂存间）", "time": "2026-05-18T09:00:00"},
                    ],
                )
            ],
            staging_events=[
                {"id": "event-out-old", "tray_code": "TP-501", "task_code": "TASK-501", "action": "stock_out", "time": "2026-05-18T10:00:00"},
                {"id": "event-withdraw-old", "tray_code": "TP-501", "task_code": "TASK-501", "action": "stock_out_withdraw", "time": "2026-05-18T10:10:00"},
            ],
        ),
    )

    response = client.post("/api/laboratory/tasks/TASK-501/experiments/EXP-B/withdraw-current", json={})

    assert response.status_code == 200
    assert response.json()["restoredStatus"] == "到货"
    updated = storage.read("mes.samples")[0]
    assert updated["status"] == "到货"
    assert updated["location"] == "接驳区"
    assert storage.read("mes.staging_events")[-1]["action"] == "stock_out_withdraw"


def test_laboratory_withdraw_current_restores_staging_when_dispatch_history_is_newer_than_prior_withdraw(monkeypatch):
    client, storage = build_client(
        monkeypatch,
        base_payloads(
            [
                sample_with_history(
                    "工装夹具安装",
                    "盐雾试验室",
                    [
                        {"action": "样品安装", "status": "工装夹具安装", "location": "盐雾试验室", "time": "2026-05-19T11:20:00"},
                        {"action": "任务比对", "status": "已到达实验室", "location": "盐雾试验室", "time": "2026-05-19T11:10:00"},
                        {"action": "暂存间扫码出库", "status": "送至实验室", "location": "盐雾试验室", "time": "2026-05-19T11:00:00"},
                        {"action": "实验任务撤回", "status": "已到达暂存间", "location": "恒温恒湿间（暂存间）", "time": "2026-05-19T10:10:00"},
                        {"action": "暂存间扫码出库", "status": "送至实验室", "location": "盐雾试验室", "time": "2026-05-19T10:00:00"},
                    ],
                )
            ],
            staging_events=[
                {"id": "event-out-old", "tray_code": "TP-501", "task_code": "TASK-501", "action": "stock_out", "time": "2026-05-19T10:00:00"},
                {"id": "event-withdraw-old", "tray_code": "TP-501", "task_code": "TASK-501", "action": "stock_out_withdraw", "time": "2026-05-19T10:10:00"},
                {
                    "id": "event-out-new",
                    "tray_code": "TP-501",
                    "task_code": "TASK-501",
                    "action": "stock_out",
                    "target_lab": "盐雾试验室",
                    "target_experiment_code": "EXP-B",
                    "time": "2026-05-19T11:00:00",
                },
            ],
        ),
    )

    response = client.post("/api/laboratory/tasks/TASK-501/experiments/EXP-B/withdraw-current", json={})

    assert response.status_code == 200
    assert response.json()["restoredStatus"] == "已到达暂存间"
    updated = storage.read("mes.samples")[0]
    assert updated["status"] == "已到达暂存间"
    assert updated["flow_status"] == "已到达暂存间"
    assert updated["location"] == "恒温恒湿间（暂存间）"
    assert updated["trays"][0]["status"] == "已到达暂存间"
    staging_events = storage.read("mes.staging_events")
    assert staging_events[-1]["action"] == "stock_out_withdraw"
    assert staging_events[-1]["target_experiment_code"] == "EXP-B"


def test_laboratory_withdraw_current_infers_staging_origin_from_generic_lab_dispatch_history(monkeypatch):
    client, storage = build_client(
        monkeypatch,
        base_payloads(
            [
                sample_with_history(
                    "已到达实验室",
                    "盐雾试验室",
                    [
                        {"action": "任务比对", "status": "已到达实验室", "location": "盐雾试验室", "time": "2026-05-20T16:41:03"},
                        {"action": "送至实验室", "status": "送至实验室", "location": "盐雾试验室", "time": "2026-05-20T16:40:50"},
                        {"action": "暂存间扫码入库", "status": "已到达暂存间", "location": "恒温恒湿间（暂存间）", "time": "2026-05-20T16:40:19"},
                        {"action": "送至暂存间", "status": "送至暂存间", "location": "恒温恒湿间（暂存间）", "time": "2026-05-20T16:39:11"},
                        {"action": "任务样品入库", "status": "到货", "location": "接驳区", "time": "2026-05-20T16:38:59"},
                    ],
                )
            ]
        ),
    )

    response = client.post("/api/laboratory/tasks/TASK-501/experiments/EXP-B/withdraw-current", json={})

    assert response.status_code == 200
    assert response.json()["restoredStatus"] == "已到达暂存间"
    updated = storage.read("mes.samples")[0]
    assert updated["status"] == "已到达暂存间"
    assert updated["flow_status"] == "已到达暂存间"
    assert updated["location"] == "恒温恒湿间（暂存间）"
    assert updated["trays"][0]["status"] == "已到达暂存间"


def test_laboratory_withdraw_current_restores_staging_origin_and_compensates_event(monkeypatch):
    client, storage = build_client(
        monkeypatch,
        base_payloads(
            [
                sample_with_history(
                    "实验准备就绪",
                    "霉菌试验室",
                    [
                        {"action": "实验确认", "status": "实验准备就绪", "location": "霉菌试验室", "time": "2026-05-19T10:30:00"},
                        {"action": "样品安装", "status": "工装夹具安装", "location": "霉菌试验室", "time": "2026-05-19T10:20:00"},
                        {"action": "暂存间扫码出库", "status": "送至实验室", "location": "霉菌试验室", "time": "2026-05-19T10:00:00"},
                        {"action": "暂存间扫码入库", "status": "已到达暂存间", "location": "恒温恒湿间（暂存间）", "time": "2026-05-19T09:00:00"},
                    ],
                )
            ],
            staging_events=[
                {"id": "event-in", "tray_code": "TP-501", "task_code": "TASK-501", "action": "stock_in", "time": "2026-05-19T09:00:00"},
                {
                    "id": "event-out",
                    "tray_code": "TP-501",
                    "task_code": "TASK-501",
                    "action": "stock_out",
                    "target_lab": "霉菌试验室",
                    "target_experiment_code": "EXP-B",
                    "time": "2026-05-19T10:00:00",
                },
            ],
        ),
    )

    response = client.post("/api/laboratory/tasks/TASK-501/experiments/EXP-B/withdraw-current", json={})

    assert response.status_code == 200
    assert response.json()["restoredStatus"] == "已到达暂存间"
    updated = storage.read("mes.samples")[0]
    assert updated["status"] == "已到达暂存间"
    assert updated["location"] == "恒温恒湿间（暂存间）"
    staging_events = storage.read("mes.staging_events")
    assert staging_events[-1]["action"] == "stock_out_withdraw"
    assert staging_events[-1]["target_experiment_code"] == "EXP-B"


def test_laboratory_withdraw_current_restores_newer_staging_arrival_over_previous_completed_experiment(monkeypatch):
    payloads = base_payloads(
        [
            sample_with_history(
                "已到达实验室",
                "振动一室",
                [
                    {"action": "任务比对", "detail": "TASK-501 / 振动试验 / 已到达实验室", "status": "已到达实验室", "location": "振动一室", "time": "2026-05-19T11:35:00"},
                    {"action": "暂存间扫码出库", "detail": "TP-501 送至 振动一室", "status": "送至实验室", "location": "振动一室", "time": "2026-05-19T11:20:00"},
                    {"action": "暂存间扫码入库", "detail": "TP-501 已到达暂存间", "status": "已到达暂存间", "location": "恒温恒湿间（暂存间）", "time": "2026-05-19T11:10:00"},
                    {"action": "实验完成", "detail": "TASK-501 / 霉菌试验 / 实验已完成", "status": "实验已完成", "location": "霉菌试验室", "time": "2026-05-19T10:30:00"},
                ],
            )
        ],
        experiment_trays=[
            {"task_code": "TASK-501", "experiment_code": "EXP-B", "tray_code": "TP-501"},
            {"task_code": "TASK-501", "experiment_code": "EXP-C", "tray_code": "TP-501"},
        ],
        staging_events=[
            {"id": "event-in", "tray_code": "TP-501", "task_code": "TASK-501", "action": "stock_in", "time": "2026-05-19T11:10:00"},
            {
                "id": "event-out",
                "tray_code": "TP-501",
                "task_code": "TASK-501",
                "action": "stock_out",
                "target_lab": "振动一室",
                "target_experiment_code": "EXP-C",
                "time": "2026-05-19T11:20:00",
            },
        ],
    )
    client, storage = build_client(monkeypatch, payloads)

    response = client.post("/api/laboratory/tasks/TASK-501/experiments/EXP-C/withdraw-current", json={})

    assert response.status_code == 200
    payload = response.json()
    assert payload["restoredStatus"] == "已到达暂存间"
    assert payload["restoredExperimentName"] == ""
    updated = storage.read("mes.samples")[0]
    assert updated["status"] == "已到达暂存间"
    assert updated["flow_status"] == "已到达暂存间"
    assert updated["location"] == "恒温恒湿间（暂存间）"
    assert updated["trays"][0]["status"] == "已到达暂存间"
    assert "撤回至已到达暂存间" in updated["history"][0]["detail"]
    staging_events = storage.read("mes.staging_events")
    assert staging_events[-1]["action"] == "stock_out_withdraw"
    assert staging_events[-1]["target_experiment_code"] == "EXP-C"


def test_laboratory_withdraw_current_restores_appearance_storage_before_current_lab_dispatch(monkeypatch):
    payloads = base_payloads(
        [
            sample_with_history(
                "已到达实验室",
                "高低温湿热一室",
                [
                    {"action": "任务比对", "detail": "TASK-501 / 高低温湿热试验 / 已到达实验室", "status": "已到达实验室", "location": "高低温湿热一室", "time": "2026-06-06T22:00:00"},
                    {"action": "外观检测间扫码出库", "detail": "TP-501 送至 高低温湿热一室", "status": "送至实验室", "location": "高低温湿热一室", "time": "2026-06-06T21:50:00"},
                    {"action": "外观检测间扫码入库", "detail": "TP-501 外观检测间存放", "status": "外观检测间存放", "location": "外观检测间", "time": "2026-06-06T21:40:00"},
                    {"action": "实验完成", "detail": "TASK-501 / 霉菌试验 / 实验已完成", "status": "实验已完成", "location": "霉菌试验室", "time": "2026-06-06T21:30:00"},
                ],
            )
        ],
        experiment_trays=[
            {"task_code": "TASK-501", "experiment_code": "EXP-B", "tray_code": "TP-501"},
            {"task_code": "TASK-501", "experiment_code": "EXP-D", "tray_code": "TP-501"},
        ],
        staging_events=[
            {"id": "appearance-in", "tray_code": "TP-501", "task_code": "TASK-501", "room": "appearance", "action": "stock_in", "time": "2026-06-06T21:40:00"},
            {
                "id": "appearance-out",
                "tray_code": "TP-501",
                "task_code": "TASK-501",
                "room": "appearance",
                "action": "stock_out",
                "target_lab": "高低温湿热一室",
                "target_experiment_code": "EXP-D",
                "time": "2026-06-06T21:50:00",
            },
        ],
    )
    client, storage = build_client(monkeypatch, payloads)

    response = client.post("/api/laboratory/tasks/TASK-501/experiments/EXP-D/withdraw-current", json={})

    assert response.status_code == 200
    payload = response.json()
    assert payload["restoredStatus"] == "外观检测间存放"
    assert payload["restoredExperimentName"] == ""
    updated = storage.read("mes.samples")[0]
    assert updated["status"] == "外观检测间存放"
    assert updated["flow_status"] == "外观检测间存放"
    assert updated["location"] == "外观检测间"
    assert updated["trays"][0]["status"] == "外观检测间存放"
    assert "撤回至外观检测间存放" in updated["history"][0]["detail"]
    staging_events = storage.read("mes.staging_events")
    assert staging_events[-1]["action"] == "stock_out_withdraw"
    assert staging_events[-1]["room"] == "appearance"
    assert staging_events[-1]["target_experiment_code"] == "EXP-D"


def test_laboratory_withdraw_current_restores_pre_experiment_appearance_storage(monkeypatch):
    payloads = base_payloads(
        [
            sample_with_history(
                "已到达实验室",
                "盐雾试验室",
                [
                    {"action": "任务比对", "detail": "TASK-501 / 盐雾试验 / 已到达实验室", "status": "已到达实验室", "location": "盐雾试验室", "time": "2026-06-06T22:00:00"},
                    {"action": "外观检测间扫码出库", "detail": "TP-501 送至 盐雾试验室", "status": "送至实验室", "location": "盐雾试验室", "time": "2026-06-06T21:50:00"},
                    {"action": "外观检测间扫码入库", "detail": "TP-501 实验前外观检测存放", "status": "实验前外观检测存放", "location": "外观检测间", "time": "2026-06-06T21:40:00"},
                ],
            )
        ],
        experiment_trays=[
            {"task_code": "TASK-501", "experiment_code": "EXP-B", "tray_code": "TP-501"},
        ],
        staging_events=[
            {"id": "pre-appearance-in", "tray_code": "TP-501", "task_code": "TASK-501", "room": "appearance", "action": "stock_in", "time": "2026-06-06T21:40:00"},
            {
                "id": "pre-appearance-out",
                "tray_code": "TP-501",
                "task_code": "TASK-501",
                "room": "appearance",
                "action": "stock_out",
                "target_lab": "盐雾试验室",
                "target_experiment_code": "EXP-B",
                "time": "2026-06-06T21:50:00",
            },
        ],
    )
    client, storage = build_client(monkeypatch, payloads)

    response = client.post("/api/laboratory/tasks/TASK-501/experiments/EXP-B/withdraw-current", json={})

    assert response.status_code == 200
    payload = response.json()
    assert payload["restoredStatus"] == "实验前外观检测存放"
    updated = storage.read("mes.samples")[0]
    assert updated["status"] == "实验前外观检测存放"
    assert updated["flow_status"] == "实验前外观检测存放"
    assert updated["location"] == "外观检测间"
    assert updated["trays"][0]["status"] == "实验前外观检测存放"
    assert "撤回至实验前外观检测存放" in updated["history"][0]["detail"]


def test_laboratory_withdraw_current_restores_previous_completed_experiment(monkeypatch):
    client, storage = build_client(
        monkeypatch,
        base_payloads(
            [
                sample_with_history(
                    "工装夹具安装",
                    "霉菌试验室",
                    [
                        {"action": "样品安装", "status": "工装夹具安装", "location": "霉菌试验室", "time": "2026-05-19T11:10:00"},
                        {"action": "任务比对", "status": "已到达实验室", "location": "霉菌试验室", "time": "2026-05-19T11:00:00"},
                        {"action": "实验完成", "detail": "TASK-501 / 盐雾试验 / 实验已完成", "status": "实验已完成", "location": "盐雾试验室", "time": "2026-05-19T10:00:00"},
                    ],
                )
            ],
            experiment_trays=[
                {"task_code": "TASK-501", "experiment_code": "EXP-A", "tray_code": "TP-501"},
                {"task_code": "TASK-501", "experiment_code": "EXP-B", "tray_code": "TP-501"},
                {"task_code": "TASK-501", "experiment_code": "EXP-C", "tray_code": "TP-501"},
            ],
        ),
    )

    response = client.post("/api/laboratory/tasks/TASK-501/experiments/EXP-B/withdraw-current", json={})

    assert response.status_code == 200
    payload = response.json()
    assert payload["restoredStatus"] == "实验已完成"
    assert payload["restoredExperimentName"] == "盐雾试验"
    updated = storage.read("mes.samples")[0]
    assert updated["status"] == "实验已完成"
    assert updated["location"] == "盐雾试验室"
    assert updated["trays"][0]["status"] == "实验已完成"
    assert "盐雾试验已完成" in updated["history"][0]["detail"]


def test_laboratory_withdraw_current_restores_completed_experiment_from_same_tray_history(monkeypatch):
    previous_completed = sample_with_history(
        "实验已完成",
        "盐雾试验室",
        [
            {
                "action": "实验完成",
                "detail": "TASK-501 / 盐雾试验 / 实验已完成",
                "status": "实验已完成",
                "location": "盐雾试验室",
                "time": "2026-05-19T10:00:00",
            },
        ],
    )
    previous_completed["id"] = "sample-501-salt"
    previous_completed["code"] = "SP-501-SALT"
    current_next_lab = sample_with_history(
        "已到达实验室",
        "温度冲击一室",
        [
            {
                "action": "任务比对",
                "detail": "TASK-501 / 温度冲击试验 / 已到达实验室",
                "status": "已到达实验室",
                "location": "温度冲击一室",
                "time": "2026-05-19T11:00:00",
            },
        ],
    )
    current_next_lab["id"] = "sample-501-thermal"
    current_next_lab["code"] = "SP-501-THERMAL"
    payloads = base_payloads(
        [previous_completed, current_next_lab],
        experiment_trays=[
            {"task_code": "TASK-501", "experiment_code": "EXP-A", "tray_code": "TP-501"},
            {"task_code": "TASK-501", "experiment_code": "EXP-B", "tray_code": "TP-501"},
        ],
    )
    payloads["mes.experiments"][1]["experiment_name"] = "温度冲击试验"
    payloads["mes.schedules"][1]["device"] = "温度冲击一室"
    client, storage = build_client(monkeypatch, payloads)

    response = client.post("/api/laboratory/tasks/TASK-501/experiments/EXP-B/withdraw-current", json={})

    assert response.status_code == 200
    payload = response.json()
    assert payload["restoredStatus"] == "实验已完成"
    assert payload["restoredExperimentName"] == "盐雾试验"
    completed_previous, withdrawn_current = storage.read("mes.samples")
    assert completed_previous["status"] == "实验已完成"
    assert withdrawn_current["status"] == "实验已完成"
    assert withdrawn_current["flow_status"] == "实验已完成"
    assert withdrawn_current["location"] == "盐雾试验室"
    assert withdrawn_current["trays"][0]["status"] == "实验已完成"
    assert "撤回至盐雾试验已完成" in withdrawn_current["history"][0]["detail"]


def test_laboratory_withdraw_current_only_withdraws_current_batch_trays(monkeypatch):
    client, storage = build_client(
        monkeypatch,
        base_payloads(
            [
                sample_with_history(
                    "实验已完成",
                    "盐雾试验室",
                    [
                        {"action": "实验完成", "detail": "TASK-501 / 盐雾试验 / 实验已完成", "status": "实验已完成", "location": "盐雾试验室", "time": "2026-05-19T10:00:00"},
                    ],
                    tray_code="TP-501-A",
                ),
                sample_with_history(
                    "已到达实验室",
                    "霉菌试验室",
                    [
                        {"action": "任务比对", "status": "已到达实验室", "location": "霉菌试验室", "time": "2026-05-19T11:00:00"},
                        {"action": "实验完成", "detail": "TASK-501 / 盐雾试验 / 实验已完成", "status": "实验已完成", "location": "盐雾试验室", "time": "2026-05-19T10:00:00"},
                    ],
                    tray_code="TP-501-B",
                ),
            ],
            experiment_trays=[
                {"task_code": "TASK-501", "experiment_code": "EXP-A", "tray_code": "TP-501-A"},
                {"task_code": "TASK-501", "experiment_code": "EXP-B", "tray_code": "TP-501-A"},
                {"task_code": "TASK-501", "experiment_code": "EXP-B", "tray_code": "TP-501-B"},
            ],
        ),
    )

    response = client.post("/api/laboratory/tasks/TASK-501/experiments/EXP-B/withdraw-current", json={})

    assert response.status_code == 200
    payload = response.json()
    assert payload["affectedTrayCodes"] == ["TP-501-B"]
    assert payload["affectedSampleCount"] == 1
    completed_previous, withdrawn_current = storage.read("mes.samples")
    assert completed_previous["status"] == "实验已完成"
    assert completed_previous["trays"][0]["status"] == "实验已完成"
    assert withdrawn_current["status"] == "实验已完成"
    assert withdrawn_current["location"] == "盐雾试验室"
    assert withdrawn_current["trays"][0]["status"] == "实验已完成"
    assert withdrawn_current["history"][0]["action"] == "实验任务撤回"


def test_laboratory_withdraw_current_scopes_samples_by_current_experiment(monkeypatch):
    previous_experiment_sample = sample_with_history(
        "已到达实验室",
        "盐雾试验室",
        [
            {
                "action": "任务比对",
                "detail": "TASK-501 / 盐雾试验 / 已到达实验室",
                "status": "已到达实验室",
                "location": "盐雾试验室",
                "time": "2026-05-19T10:00:00",
            }
        ],
    )
    previous_experiment_sample["id"] = "sample-501-a"
    previous_experiment_sample["code"] = "SP-501-A"

    current_experiment_sample = sample_with_history(
        "已到达实验室",
        "霉菌试验室",
        [
            {
                "action": "任务比对",
                "detail": "TASK-501 / 霉菌试验 / 已到达实验室",
                "status": "已到达实验室",
                "location": "霉菌试验室",
                "time": "2026-05-19T11:00:00",
            }
        ],
    )
    current_experiment_sample["id"] = "sample-501-b"
    current_experiment_sample["code"] = "SP-501-B"

    payloads = base_payloads(
        [previous_experiment_sample, current_experiment_sample],
        experiment_trays=[
            {"task_code": "TASK-501", "experiment_code": "EXP-A", "tray_code": "TP-501"},
            {"task_code": "TASK-501", "experiment_code": "EXP-B", "tray_code": "TP-501"},
        ],
    )
    payloads["mes.experiment_samples"] = [
        {"task_code": "TASK-501", "experiment_code": "EXP-A", "sample_code": "SP-501-A"},
        {"task_code": "TASK-501", "experiment_code": "EXP-B", "sample_code": "SP-501-B"},
    ]
    client, storage = build_client(monkeypatch, payloads)

    response = client.post("/api/laboratory/tasks/TASK-501/experiments/EXP-B/withdraw-current", json={})

    assert response.status_code == 200
    assert response.json()["affectedSampleCount"] == 1
    previous_sample, current_sample = storage.read("mes.samples")
    assert previous_sample["status"] == "已到达实验室"
    assert previous_sample["history"][0]["action"] == "任务比对"
    assert current_sample["status"] == "到货"
    assert current_sample["history"][0]["action"] == "实验任务撤回"


def test_laboratory_withdraw_current_rejects_blocked_tray_even_when_sample_status_lags(monkeypatch):
    sample = sample_with_history(
        "已到达实验室",
        "霉菌试验室",
        [
            {
                "action": "任务比对",
                "detail": "TASK-501 / 霉菌试验 / 已到达实验室",
                "status": "已到达实验室",
                "location": "霉菌试验室",
                "time": "2026-05-19T11:00:00",
            }
        ],
    )
    sample["trays"][0]["status"] = "实验进行中"
    client, storage = build_client(monkeypatch, base_payloads([sample]))

    response = client.post("/api/laboratory/tasks/TASK-501/experiments/EXP-B/withdraw-current", json={})

    assert response.status_code == 400
    assert storage.read("mes.samples")[0]["trays"][0]["status"] == "实验进行中"


def test_laboratory_withdraw_current_uses_sample_status_when_tray_status_lags(monkeypatch):
    sample = sample_with_history(
        "已到达实验室",
        "霉菌试验室",
        [
            {"action": "任务比对", "status": "已到达实验室", "location": "霉菌试验室", "time": "2026-05-19T11:00:00"},
            {"action": "实验完成", "detail": "TASK-501 / 盐雾试验 / 实验已完成", "status": "实验已完成", "location": "盐雾试验室", "time": "2026-05-19T10:00:00"},
        ],
    )
    sample["trays"][0]["status"] = "送至实验室"
    client, storage = build_client(monkeypatch, base_payloads([sample]))

    response = client.post("/api/laboratory/tasks/TASK-501/experiments/EXP-B/withdraw-current", json={})

    assert response.status_code == 200
    updated = storage.read("mes.samples")[0]
    assert updated["status"] == "实验已完成"
    assert updated["trays"][0]["status"] == "实验已完成"


def test_laboratory_withdraw_current_rejects_running_or_finished_states(monkeypatch):
    for blocked_status in ["实验进行中", "实验已完成", "实验后暂存间存放", "厂家收回"]:
        client, storage = build_client(
            monkeypatch,
            base_payloads([sample_with_history(blocked_status, "霉菌试验室", [])]),
        )

        response = client.post("/api/laboratory/tasks/TASK-501/experiments/EXP-B/withdraw-current", json={})

        assert response.status_code == 400
        assert storage.read("mes.samples")[0]["status"] == blocked_status
