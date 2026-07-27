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


def build_client(monkeypatch, payloads, *, bypass_completion_interface_guard=True):
    from app.api.routes import laboratory as laboratory_route

    storage = FakeLaboratoryStorage(payloads)
    monkeypatch.setattr(laboratory_route, "get_storage_backend", lambda: storage)
    monkeypatch.setattr(
        laboratory_route,
        "archive_completion_reports",
        lambda **_kwargs: {
            "ok": True,
            "attempted": 0,
            "succeeded": 0,
            "skipped": 0,
            "failed": 0,
            "items": [],
            "error": "",
        },
    )
    if bypass_completion_interface_guard:
        monkeypatch.setattr(laboratory_route, "require_hostless_completion_laboratory", lambda **_kwargs: None)

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
    from app.api.routes import laboratory as laboratory_route

    monkeypatch.setattr(laboratory_route, "now_business_text", lambda: "2026-05-19 10:00:00")
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
        json={"runNo": "RUN-501", "trayCodes": ["TP-501"], "completedAt": "2000-01-01T00:00:00"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["affectedTrayCodes"] == ["TP-501"]
    updated_sample = storage.read("mes.samples")[0]
    assert updated_sample["location"] == "盐雾试验室"
    assert updated_sample["status"] == "实验已完成"
    assert updated_sample["flow_status"] == "实验已完成"
    assert updated_sample["trays"][0]["status"] == "实验已完成"
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
            "sub_experiment_code": "",
            "tray_code": "TP-501",
            "status": "实验已完成",
            "run_tray_status": "实验已完成",
            "started_at": "",
            "ended_at": "2026-05-19 10:00:00",
            "created_at": "2026-05-19 10:00:00",
            "updated_at": "2026-05-19 10:00:00",
        }
    ]


def test_laboratory_completion_archives_after_storage_commit_and_returns_status(monkeypatch):
    from app.api.routes import laboratory as laboratory_route

    monkeypatch.setattr(laboratory_route, "now_business_text", lambda: "2026-07-27 10:00:00")
    sample = sample_with_history("实验进行中", "盐雾试验室", [])
    payloads = base_payloads(
        [sample],
        experiment_trays=[{"task_code": "TASK-501", "experiment_code": "EXP-A", "tray_code": "TP-501"}],
    )
    payloads["mes.experiment_runs"] = [
        {
            "run_no": "RUN-501",
            "task_code": "TASK-501",
            "experiment_code": "EXP-A",
            "status": "实验进行中",
            "started_at": "2026-07-27 09:40:00",
        }
    ]
    client, storage = build_client(monkeypatch, payloads)
    archive_calls = []

    def fake_archive(**kwargs):
        assert storage.read("mes.experiment_runs")[0]["status"] == "实验已完成"
        archive_calls.append(kwargs)
        return {
            "ok": True,
            "attempted": 1,
            "succeeded": 1,
            "skipped": 0,
            "failed": 0,
            "items": [],
            "error": "",
        }

    monkeypatch.setattr(laboratory_route, "archive_completion_reports", fake_archive)

    response = client.post(
        "/api/laboratory/tasks/TASK-501/experiments/EXP-A/complete",
        json={"runNo": "RUN-501", "trayCodes": ["TP-501"]},
    )

    assert response.status_code == 200
    assert response.json()["reportArchive"] == {
        "ok": True,
        "attempted": 1,
        "succeeded": 1,
        "skipped": 0,
        "failed": 0,
        "items": [],
        "error": "",
    }
    assert len(archive_calls) == 1
    assert archive_calls[0]["snapshot"]["experiment_runs"][0]["status"] == "实验进行中"
    assert archive_calls[0]["task_code"] == "TASK-501"
    assert archive_calls[0]["experiment_code"] == "EXP-A"
    assert archive_calls[0]["run_no"] == "RUN-501"
    assert archive_calls[0]["axis_code"] == ""
    assert archive_calls[0]["completed_at"] == "2026-07-27 10:00:00"


def test_laboratory_completion_report_failure_does_not_roll_back_completion(monkeypatch):
    from app.api.routes import laboratory as laboratory_route

    sample = sample_with_history("实验进行中", "盐雾试验室", [])
    payloads = base_payloads(
        [sample],
        experiment_trays=[{"task_code": "TASK-501", "experiment_code": "EXP-A", "tray_code": "TP-501"}],
    )
    payloads["mes.experiment_runs"] = [
        {
            "run_no": "RUN-501",
            "task_code": "TASK-501",
            "experiment_code": "EXP-A",
            "status": "实验进行中",
        }
    ]
    client, storage = build_client(monkeypatch, payloads)
    monkeypatch.setattr(
        laboratory_route,
        "archive_completion_reports",
        lambda **_kwargs: (_ for _ in ()).throw(OSError("disk full")),
    )

    response = client.post(
        "/api/laboratory/tasks/TASK-501/experiments/EXP-A/complete",
        json={"runNo": "RUN-501", "trayCodes": ["TP-501"]},
    )

    assert response.status_code == 200
    assert response.json()["reportArchive"] == {
        "ok": False,
        "attempted": 0,
        "succeeded": 0,
        "skipped": 0,
        "failed": 1,
        "items": [],
        "error": "disk full",
    }
    assert storage.read("mes.experiment_runs")[0]["status"] == "实验已完成"


def test_laboratory_axis_complete_passes_sub_experiment_code_to_shared_service(monkeypatch):
    from app.api.routes import laboratory as laboratory_route

    sample = sample_with_history("实验进行中", "冲击一室", [], tray_code="TP-AXIS-501")
    payloads = base_payloads(
        [sample],
        experiment_trays=[{"task_code": "TASK-501", "experiment_code": "EXP-C", "tray_code": "TP-AXIS-501"}],
    )
    payloads["mes.experiment_runs"] = [
        {
            "run_no": "RUN-AXIS-501",
            "task_code": "TASK-501",
            "experiment_code": "EXP-C",
            "status": "实验进行中",
        }
    ]
    client, storage = build_client(monkeypatch, payloads)
    captured = {}
    archive_calls = []

    def fake_complete_axis(snapshot, **kwargs):
        captured.update(kwargs)
        return {
            "samples": snapshot["samples"],
            "experiments": snapshot["experiments"],
            "schedules": snapshot["schedules"],
            "experimentRuns": snapshot["experiment_runs"],
            "experimentRunTrays": snapshot["experiment_run_trays"],
            "experimentRunSteps": snapshot.get("experiment_run_steps", []),
            "allAxesCompleted": True,
        }

    monkeypatch.setattr(laboratory_route, "complete_storage_laboratory_axis_step", fake_complete_axis)

    def fake_archive(**kwargs):
        archive_calls.append(kwargs)
        return {
            "ok": True,
            "attempted": 1,
            "succeeded": 1,
            "skipped": 0,
            "failed": 0,
            "items": [],
            "error": "",
        }

    monkeypatch.setattr(
        laboratory_route,
        "archive_completion_reports",
        fake_archive,
    )

    response = client.post(
        "/api/laboratory/tasks/TASK-501/experiments/EXP-C/complete",
        json={
            "runNo": "RUN-AXIS-501",
            "axisCode": "z+",
            "subExperimentCode": "EXP-C-AXIS-Z",
            "completedAt": "2026-06-24T10:00:00",
        },
    )

    assert response.status_code == 200
    assert captured["sub_experiment_code"] == "EXP-C-AXIS-Z"
    assert captured["axis_code"] == "z+"
    assert len(archive_calls) == 1
    assert archive_calls[0]["axis_code"] == "z+"
    assert response.json()["reportArchive"]["ok"] is True
    assert storage.read("mes.samples")[0]["trays"][0]["status"] == "实验进行中"


def test_laboratory_start_experiment_updates_ready_hot_humid_second_lab_through_common_endpoint(monkeypatch):
    from app.api.routes import laboratory as laboratory_route

    monkeypatch.setattr(laboratory_route, "now_business_text", lambda: "2026-06-06 15:00:00")
    sample = sample_with_history("实验准备就绪", "高低温湿热二室", [], tray_code="TP-HH2-501")
    sample["trays"][0]["target_lab"] = "高低温湿热二室"
    sample["trays"][0]["target_experiment_code"] = "EXP-D"
    payloads = base_payloads(
        [sample],
        experiment_trays=[{"task_code": "TASK-501", "experiment_code": "EXP-D", "tray_code": "TP-HH2-501"}],
    )
    payloads["mes.experiments"].append(
        {"task_code": "TASK-501", "experiment_code": "EXP-D", "experiment_name": "高低温湿热试验", "status": "实验准备就绪"}
    )
    payloads["mes.schedules"].extend(
        [
            {"id": "SCH-HH1-501", "task_code": "TASK-501", "experiment_code": "EXP-D", "device": "高低温湿热一室", "status": "实验准备就绪"},
            {"id": "SCH-HH2-501", "task_code": "TASK-501", "experiment_code": "EXP-D", "device": "高低温湿热二室", "status": "实验准备就绪"},
        ]
    )
    client, storage = build_client(monkeypatch, payloads)

    response = client.post(
        "/api/laboratory/tasks/TASK-501/experiments/EXP-D/start",
        json={
            "runNo": "RUN-HH2-501",
            "scheduleId": "SCH-HH2-501",
            "trayCodes": ["TP-HH2-501"],
            "subExperimentCode": "EXP-D-AXIS-X",
            "startedAt": "2026-06-06T15:00:00",
            "plannedHours": 2,
            "plannedEndAt": "2026-06-06 17:00:00",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["affectedTrayCodes"] == ["TP-HH2-501"]
    assert payload["startedAt"] == "2026-06-06 15:00:00"
    updated_sample = storage.read("mes.samples")[0]
    assert updated_sample["location"] == "高低温湿热二室"
    assert updated_sample["status"] == "实验进行中"
    assert updated_sample["flow_status"] == "实验进行中"
    updated_tray = updated_sample["trays"][0]
    assert updated_tray["status"] == "实验进行中"
    assert "fixture_ready" not in updated_tray
    assert "fixtureReady" not in updated_tray
    assert "target_lab" not in updated_tray
    assert "target_experiment_code" not in updated_tray
    assert updated_sample["history"][0] == {
        "action": "开始实验",
        "detail": "TASK-501 / 高低温湿热试验 / 实验进行中 / 托盘：TP-HH2-501",
        "location": "高低温湿热二室",
        "owner": "",
        "status": "实验进行中",
        "time": "2026-06-06 15:00:00",
    }


    assert storage.read("mes.tasks")[0]["status"] == "任务进行中"
    assert storage.read("mes.experiments")[-1]["status"] == "实验进行中"
    assert storage.read("mes.schedules")[-2]["status"] == "实验准备就绪"
    assert storage.read("mes.schedules")[-1]["status"] == "实验进行中"
    assert storage.read("mes.experiment_runs") == [
        {
            "id": "RUN-HH2-501",
            "run_no": "RUN-HH2-501",
            "schedule_id": "SCH-HH2-501",
            "task_code": "TASK-501",
            "experiment_code": "EXP-D",
            "sub_experiment_code": "EXP-D-AXIS-X",
            "device": "高低温湿热二室",
            "device_name": "高低温湿热二室",
            "tray_codes": ["TP-HH2-501"],
            "status": "实验进行中",
            "started_at": "2026-06-06 15:00:00",
            "planned_hours": 2,
            "planned_end_at": "2026-06-06 17:00:00",
            "ended_at": "",
            "created_at": "2026-06-06 15:00:00",
            "updated_at": "2026-06-06 15:00:00",
        }
    ]
    assert storage.read("mes.experiment_run_trays") == [
        {
            "id": "RUN-HH2-501:TP-HH2-501",
            "run_no": "RUN-HH2-501",
            "task_code": "TASK-501",
            "experiment_code": "EXP-D",
            "sub_experiment_code": "EXP-D-AXIS-X",
            "tray_code": "TP-HH2-501",
            "status": "实验进行中",
            "run_tray_status": "实验进行中",
            "started_at": "2026-06-06 15:00:00",
            "ended_at": "",
            "created_at": "2026-06-06 15:00:00",
            "updated_at": "2026-06-06 15:00:00",
        }
    ]


def test_laboratory_complete_rejects_mqtt_laboratory_hostless_endpoint(monkeypatch):
    sample = sample_with_history("实验进行中", "盐雾试验室", [], tray_code="TP-501")
    payloads = base_payloads(
        [sample],
        experiment_trays=[{"task_code": "TASK-501", "experiment_code": "EXP-A", "tray_code": "TP-501"}],
    )
    client, storage = build_client(monkeypatch, payloads, bypass_completion_interface_guard=False)
    before = deepcopy(storage.read_all())

    response = client.post(
        "/api/laboratory/tasks/TASK-501/experiments/EXP-A/complete",
        json={"runNo": "RUN-501", "trayCodes": ["TP-501"], "completedAt": "2026-05-19T10:00:00"},
    )

    assert response.status_code == 422
    assert response.json() == {"detail": "盐雾试验室 仅支持 mqtt 接口，不允许使用 hostless 接口"}
    assert storage.read_all() == before


def test_fixture_ready_operation_rejects_non_hostless_laboratory(monkeypatch):
    client, _storage = build_client(monkeypatch, base_payloads([]))

    response = client.post(
        "/api/laboratory/operations",
        json={
            "operationType": "fixtureReady",
            "taskCode": "TASK-501",
            "experimentCode": "EXP-A",
            "labCode": "LAB_SALT",
            "labName": "盐雾试验室",
            "trayCodes": ["TP-501"],
        },
    )

    assert response.status_code == 422
    assert "仅支持 mqtt 接口" in response.json()["detail"]


def test_hostless_fixture_ready_operation_still_calls_shared_service(monkeypatch):
    from app.api.routes import laboratory as laboratory_route

    calls = []
    monkeypatch.setattr(
        laboratory_route,
        "apply_laboratory_task_operation",
        lambda snapshot, **kwargs: calls.append(kwargs) or {"samples": snapshot.get("samples", [])},
    )
    monkeypatch.setattr(
        laboratory_route,
        "run_atomic_laboratory_operation",
        lambda operation, **_kwargs: operation({"tasks": [{"code": "TASK-501"}], "samples": []}),
    )
    client, _storage = build_client(monkeypatch, base_payloads([]))

    response = client.post(
        "/api/laboratory/operations",
        json={
            "operationType": "fixtureReady",
            "taskCode": "TASK-501",
            "experimentCode": "EXP-D",
            "labCode": "LAB_HOT_HUMID_2",
            "labName": "高低温湿热二室",
            "trayCodes": ["TP-HH2-501"],
        },
    )

    assert response.status_code == 200
    assert len(calls) == 1
    assert calls[0]["operation_type"] == "fixtureReady"
    assert calls[0]["lab_name"] == "高低温湿热二室"
    assert calls[0]["tray_codes"] == ["TP-HH2-501"]


@pytest.mark.parametrize("lab_name", ["冲击一室", "高低温湿热二室"])
def test_task_comparison_locks_the_exact_axis_schedule_for_all_laboratory_interfaces(monkeypatch, lab_name):
    from app.api.routes import laboratory as laboratory_route
    from app.api.routes import storage as storage_route

    task_code = "TASK-COMPARE-LOCK"
    experiment_code = "EXP-COMPARE-LOCK"
    sub_experiment_code = f"{experiment_code}-AXIS-001"
    schedules = [{
        "id": "schedule-compare-lock",
        "task_code": task_code,
        "experiment_code": experiment_code,
        "sub_experiment_code": sub_experiment_code,
        "axis_codes": ["x+", "x-", "y+", "y-"],
        "device": lab_name,
        "status": "已排程",
    }]
    storage = FakeLaboratoryStorage({
        "mes.tasks": [{"id": task_code, "code": task_code}],
        "mes.experiments": [{
            "task_code": task_code,
            "experiment_code": experiment_code,
            "experiment_name": "冲击试验",
        }],
        "mes.schedules": schedules,
        "mes.experiment_trays": [
            {"task_code": task_code, "experiment_code": experiment_code, "tray_code": "TP-COMPARE-LOCK"}
        ],
        "mes.experiment_samples": [
            {"task_code": task_code, "experiment_code": experiment_code, "sample_code": "SP-COMPARE-LOCK"}
        ],
        "mes.samples": [{
            "code": "SP-COMPARE-LOCK",
            "task_code": task_code,
            "status": "送至实验室",
            "flow_status": "送至实验室",
            "trays": [{"tray_code": "TP-COMPARE-LOCK", "status": "送至实验室", "quantity": 1}],
            "history": [],
        }],
    })
    monkeypatch.setattr(laboratory_route, "get_storage_backend", lambda: storage)
    monkeypatch.setattr(storage_route, "get_storage_backend", lambda: storage)
    app = FastAPI()
    app.include_router(laboratory_route.router)
    app.include_router(storage_route.router)
    client = TestClient(app)

    compare_response = client.post(
        "/api/laboratory/operations",
        json={
            "operationType": "compare",
            "taskCode": task_code,
            "experimentCode": experiment_code,
            "subExperimentCode": sub_experiment_code,
            "labName": lab_name,
            "trayCodes": ["TP-COMPARE-LOCK"],
        },
    )
    assert compare_response.status_code == 200
    compared_sample = storage.read("mes.samples")[0]
    assert compared_sample["trays"][0]["target_sub_experiment_code"] == sub_experiment_code

    delete_response = client.post(
        "/api/storage/schedules/patch",
        json={"deletes": {"mes.schedules": ["schedule-compare-lock"]}},
    )

    assert delete_response.status_code == 400
    assert delete_response.json()["detail"] == "完成任务比对后排程不可删除或重新排程。"
    assert storage.read("mes.schedules") == schedules
    assert storage.read("mes.samples")[0]["history"][0]["action"] == "任务比对"


def test_start_endpoint_rejects_non_hostless_laboratory_before_shared_service(monkeypatch):
    from app.api.routes import laboratory as laboratory_route

    calls = []
    monkeypatch.setattr(laboratory_route, "start_storage_laboratory_experiment", lambda *args, **kwargs: calls.append((args, kwargs)))
    client, _storage = build_client(monkeypatch, base_payloads([]))

    response = client.post(
        "/api/laboratory/tasks/TASK-501/experiments/EXP-A/start",
        json={"labCode": "LAB_SALT", "labName": "盐雾试验室"},
    )

    assert response.status_code == 422
    assert "仅支持 mqtt 接口" in response.json()["detail"]
    assert calls == []


def test_hostless_axis_adjustment_ready_then_delayed_start_preserves_completed_axis(monkeypatch):
    from app.api.routes import laboratory as laboratory_route

    payloads = base_payloads([])
    payloads["mes.schedules"][2]["device"] = "高低温湿热二室"
    payloads["mes.experiment_runs"] = [
        {
            "run_no": "RUN-HOSTLESS-AXIS",
            "task_code": "TASK-501",
            "experiment_code": "EXP-C",
            "sub_experiment_code": "EXP-C#AXIS-001",
            "axis_codes": ["x+", "x-", "y+"],
            "device": "高低温湿热二室",
            "status": "实验进行中",
        }
    ]
    payloads["mes.experiment_run_steps"] = [
        {"run_no": "RUN-HOSTLESS-AXIS", "task_code": "TASK-501", "experiment_code": "EXP-C", "sub_experiment_code": "EXP-C#AXIS-001", "axis_code": "x+", "step_no": 1, "status": "实验已完成", "ended_at": "2026-07-27 10:00:00"},
        {"run_no": "RUN-HOSTLESS-AXIS", "task_code": "TASK-501", "experiment_code": "EXP-C", "sub_experiment_code": "EXP-C#AXIS-001", "axis_code": "x-", "step_no": 2, "status": "轴向调整中"},
        {"run_no": "RUN-HOSTLESS-AXIS", "task_code": "TASK-501", "experiment_code": "EXP-C", "sub_experiment_code": "EXP-C#AXIS-001", "axis_code": "y+", "step_no": 3, "status": "待执行"},
    ]
    monkeypatch.setattr(laboratory_route, "publish_storage_update", lambda _keys: None)
    client, storage = build_client(monkeypatch, payloads)

    ready_response = client.post(
        "/api/laboratory/tasks/TASK-501/experiments/EXP-C/axis-adjustment-ready",
        json={"runNo": "RUN-HOSTLESS-AXIS", "axisCode": "x-", "labName": "高低温湿热二室"},
    )
    start_response = client.post(
        "/api/laboratory/tasks/TASK-501/experiments/EXP-C/start",
        json={
            "runNo": "RUN-HOSTLESS-AXIS",
            "currentAxisCode": "x-",
            "labName": "高低温湿热二室",
        },
    )

    assert ready_response.status_code == 200
    assert start_response.status_code == 200
    steps = {step["axis_code"]: step for step in storage.read("mes.experiment_run_steps")}
    assert steps["x+"]["status"] == "实验已完成"
    assert steps["x+"]["ended_at"] == "2026-07-27 10:00:00"
    assert steps["x-"]["status"] == "实验进行中"
    assert steps["y+"]["status"] == "待执行"


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
    assert storage.read("mes.samples")[0]["trays"][0]["status"] == "实验已完成"
    assert storage.read("mes.samples")[1]["trays"][0]["status"] == "实验准备就绪"
    assert storage.read("mes.experiments")[0]["status"] == "实验进行中"
    assert storage.read("mes.schedules")[0]["status"] == "实验进行中"
    assert storage.read("mes.experiment_runs")[0]["status"] == "实验已完成"
    assert storage.read("mes.experiment_runs")[1]["status"] == "实验准备就绪"


def test_laboratory_complete_experiment_infers_batch_trays_from_run_tray_relations_when_tray_codes_omitted(monkeypatch):
    from app.api.routes import laboratory as laboratory_route

    monkeypatch.setattr(laboratory_route, "now_business_text", lambda: "2026-05-19 10:00:00")
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
    assert storage.read("mes.samples")[0]["trays"][0]["status"] == "实验已完成"
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
    assert storage.read("mes.samples")[0]["trays"][0]["status"] == "实验已完成"
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
    assert updated_sample["trays"][0]["status"] == "实验已完成"
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


def test_laboratory_withdraw_current_ignores_trays_targeting_other_labs(monkeypatch):
    client, storage = build_client(
        monkeypatch,
        base_payloads(
            [
                {
                    "id": "sample-501",
                    "code": "SP-501",
                    "task_code": "TASK-501",
                    "status": "已到达实验室",
                    "flow_status": "已到达实验室",
                    "location": "霉菌试验室",
                    "trays": [
                        {
                            "tray_code": "TP-501-A",
                            "quantity": 1,
                            "status": "已到达实验室",
                            "target_lab": "霉菌试验室",
                            "target_experiment_code": "EXP-B",
                        },
                        {
                            "tray_code": "TP-501-C",
                            "quantity": 1,
                            "status": "送至实验室",
                            "target_lab": "振动一室",
                            "target_experiment_code": "EXP-C",
                        },
                    ],
                    "history": [
                        {
                            "action": "任务比对",
                            "detail": "TASK-501 / 霉菌试验 / 已到达实验室",
                            "status": "已到达实验室",
                            "location": "霉菌试验室",
                            "time": "2026-05-19T10:20:00",
                        },
                        {
                            "action": "送至实验室",
                            "detail": "TASK-501 / 振动试验 / 送至实验室",
                            "status": "送至实验室",
                            "location": "振动一室",
                            "time": "2026-05-19T10:10:00",
                        },
                    ],
                }
            ],
            experiment_trays=[
                {"task_code": "TASK-501", "experiment_code": "EXP-B", "tray_code": "TP-501-A"},
                {"task_code": "TASK-501", "experiment_code": "EXP-B", "tray_code": "TP-501-C"},
                {"task_code": "TASK-501", "experiment_code": "EXP-C", "tray_code": "TP-501-A"},
                {"task_code": "TASK-501", "experiment_code": "EXP-C", "tray_code": "TP-501-C"},
            ],
        ),
    )

    response = client.post("/api/laboratory/tasks/TASK-501/experiments/EXP-B/withdraw-current", json={"reason": "复核撤回"})

    assert response.status_code == 200
    assert response.json()["affectedTrayCodes"] == ["TP-501-A"]
    updated = storage.read("mes.samples")[0]
    assert updated["status"] == "已到达实验室"
    assert updated["flow_status"] == "已到达实验室"
    assert updated["location"] == "霉菌试验室"
    assert updated["trays"][0]["status"] == "到货"
    assert updated["trays"][1]["status"] == "送至实验室"


def test_laboratory_withdraw_current_scopes_explicit_tray_codes_when_experiment_trays_are_wide(monkeypatch):
    client, storage = build_client(
        monkeypatch,
        base_payloads(
            [
                {
                    "id": "sample-501",
                    "code": "SP-501",
                    "task_code": "TASK-501",
                    "status": "已到达实验室",
                    "flow_status": "已到达实验室",
                    "location": "霉菌试验室",
                    "trays": [
                        {
                            "tray_code": "TP-501-A",
                            "quantity": 1,
                            "status": "已到达实验室",
                            "target_lab": "霉菌试验室",
                            "target_experiment_code": "EXP-B",
                        },
                        {
                            "tray_code": "TP-501-B",
                            "quantity": 1,
                            "status": "送至实验室",
                            "target_lab": "振动一室",
                            "target_experiment_code": "EXP-B",
                        },
                    ],
                    "history": [
                        {
                            "action": "任务比对",
                            "detail": "TASK-501 / 霉菌试验 / 已到达实验室",
                            "status": "已到达实验室",
                            "location": "霉菌试验室",
                            "time": "2026-05-19T10:20:00",
                        },
                        {
                            "action": "送至实验室",
                            "detail": "TASK-501 / 霉菌试验 / 送至实验室",
                            "status": "送至实验室",
                            "location": "振动一室",
                            "time": "2026-05-19T10:10:00",
                        },
                    ],
                }
            ],
            experiment_trays=[
                {"task_code": "TASK-501", "experiment_code": "EXP-B", "tray_code": "TP-501-A"},
                {"task_code": "TASK-501", "experiment_code": "EXP-B", "tray_code": "TP-501-B"},
            ],
        ),
    )

    response = client.post(
        "/api/laboratory/tasks/TASK-501/experiments/EXP-B/withdraw-current",
        json={"reason": "复核撤回", "trayCodes": ["TP-501-A"]},
    )

    assert response.status_code == 200
    assert response.json()["affectedTrayCodes"] == ["TP-501-A"]
    assert response.json()["affectedSampleCount"] == 1
    updated = storage.read("mes.samples")[0]
    assert updated["status"] == "已到达实验室"
    assert updated["flow_status"] == "已到达实验室"
    assert updated["location"] == "霉菌试验室"
    assert updated["trays"][0]["status"] == "到货"
    assert updated["trays"][1]["status"] == "送至实验室"


def test_laboratory_withdraw_current_allows_single_tray_with_stale_previous_target(monkeypatch):
    client, storage = build_client(
        monkeypatch,
        base_payloads(
            [
                {
                    "id": "sample-501",
                    "code": "SP-501",
                    "task_code": "TASK-501",
                    "status": "已到达实验室",
                    "flow_status": "已到达实验室",
                    "location": "霉菌试验室",
                    "trays": [
                        {
                            "tray_code": "TP-501-A",
                            "quantity": 1,
                            "status": "已到达实验室",
                            "target_lab": "盐雾试验室",
                            "target_experiment_code": "EXP-A",
                        },
                    ],
                    "history": [
                        {
                            "action": "任务比对",
                            "detail": "TASK-501 / 霉菌试验 / 已到达实验室",
                            "status": "已到达实验室",
                            "location": "霉菌试验室",
                            "time": "2026-05-19T10:20:00",
                        },
                        {
                            "action": "实验完成",
                            "detail": "TASK-501 / 盐雾试验 / 实验已完成",
                            "status": "实验已完成",
                            "location": "盐雾试验室",
                            "time": "2026-05-19T10:10:00",
                        },
                    ],
                }
            ],
            experiment_trays=[
                {"task_code": "TASK-501", "experiment_code": "EXP-B", "tray_code": "TP-501-A"},
                {"task_code": "TASK-501", "experiment_code": "EXP-A", "tray_code": "TP-501-A"},
            ],
        ),
    )

    response = client.post(
        "/api/laboratory/tasks/TASK-501/experiments/EXP-B/withdraw-current",
        json={"reason": "复核撤回", "trayCodes": ["TP-501-A"]},
    )

    assert response.status_code == 200
    assert response.json()["affectedTrayCodes"] == ["TP-501-A"]
    updated = storage.read("mes.samples")[0]
    assert updated["status"] == "实验已完成"
    assert updated["location"] == "盐雾试验室"
    assert updated["trays"][0]["status"] == "实验已完成"


def test_laboratory_withdraw_current_allows_stale_target_when_current_history_is_installing(monkeypatch):
    sample = sample_with_history(
        "冲击试验部分完成 3/6轴",
        "振动一室",
        [
            {
                "action": "样品安装",
                "detail": "TASK-501 / 振动试验 / 工装夹具安装 / 托盘：TP-501",
                "status": "工装夹具安装",
                "location": "振动一室",
                "time": "2026-07-01T16:32:24",
            },
            {
                "action": "任务比对",
                "detail": "TASK-501 / 振动试验 / 已到达实验室 / 托盘：TP-501",
                "status": "已到达实验室",
                "location": "振动一室",
                "time": "2026-07-01T16:16:05",
            },
            {
                "action": "实验完成",
                "detail": "TASK-501 / 冲击试验 / 冲击试验部分完成 3/6轴",
                "status": "冲击试验部分完成 3/6轴",
                "location": "冲击一室",
                "time": "2026-07-01T16:04:18",
            },
        ],
    )
    sample["trays"][0]["target_experiment_code"] = "EXP-A"
    sample["trays"][0]["target_lab"] = "振动一室"
    payloads = base_payloads(
        [sample],
        experiment_trays=[
            {"task_code": "TASK-501", "experiment_code": "EXP-A", "tray_code": "TP-501"},
            {"task_code": "TASK-501", "experiment_code": "EXP-C", "tray_code": "TP-501"},
        ],
    )
    payloads["mes.experiments"][0] = {
        "task_code": "TASK-501",
        "experiment_code": "EXP-A",
        "experiment_name": "冲击试验",
        "axis_codes": ["x+", "x-", "y+", "y-", "z+", "z-"],
    }
    payloads["mes.experiments"][2] = {
        "task_code": "TASK-501",
        "experiment_code": "EXP-C",
        "experiment_name": "振动试验",
        "axis_codes": ["x+", "x-", "y+", "y-", "z+", "z-"],
    }
    payloads["mes.experiment_runs"] = [
        {
            "run_no": "RUN-IMPACT-AXIS-001",
            "task_code": "TASK-501",
            "experiment_code": "EXP-A",
            "status": "实验已完成",
            "axis_codes": ["x+", "x-", "y+"],
            "ended_at": "2026-07-01T16:04:18",
        }
    ]
    payloads["mes.experiment_run_trays"] = [
        {
            "run_no": "RUN-IMPACT-AXIS-001",
            "task_code": "TASK-501",
            "experiment_code": "EXP-A",
            "tray_code": "TP-501",
            "status": "实验已完成",
            "run_tray_status": "实验已完成",
            "ended_at": "2026-07-01T16:04:18",
        }
    ]
    payloads["mes.experiment_run_steps"] = [
        {
            "run_no": "RUN-IMPACT-AXIS-001",
            "task_code": "TASK-501",
            "experiment_code": "EXP-A",
            "axis_code": axis_code,
            "status": "实验已完成",
            "ended_at": "2026-07-01T16:04:18",
        }
        for axis_code in ["x+", "x-", "y+"]
    ]
    client, storage = build_client(monkeypatch, payloads)

    response = client.post("/api/laboratory/tasks/TASK-501/experiments/EXP-C/withdraw-current", json={"trayCodes": ["TP-501"]})

    assert response.status_code == 200
    updated = storage.read("mes.samples")[0]
    assert updated["status"] == "冲击试验部分完成 3/6轴"
    assert updated["trays"][0]["status"] == "冲击试验部分完成 3/6轴"
    assert updated["trays"][0]["target_experiment_code"] == "EXP-A"
    assert updated["trays"][0]["target_lab"] == "冲击一室"


def test_laboratory_withdraw_current_rejects_partial_axis_even_with_a_newer_restore_point(monkeypatch):
    sample = sample_with_history(
        "已到达实验室",
        "冲击一室",
        [
            {
                "action": "任务比对",
                "detail": "TASK-501 / 冲击试验 / 已到达实验室 / 托盘：TP-501",
                "status": "已到达实验室",
                "location": "冲击一室",
                "time": "2026-07-02T15:41:31",
            },
            {
                "action": "实验完成",
                "detail": "TASK-501 / 四综合试验 / 实验已完成",
                "status": "实验已完成",
                "location": "四综合实验室",
                "time": "2026-07-02T15:41:13",
            },
            {
                "action": "实验完成",
                "detail": "TASK-501 / 冲击试验 / 冲击试验部分完成 3/6轴",
                "status": "冲击试验部分完成 3/6轴",
                "location": "冲击一室",
                "time": "2026-07-02T15:40:49",
            },
        ],
    )
    sample["trays"][0]["target_experiment_code"] = "EXP-A"
    sample["trays"][0]["target_lab"] = "冲击一室"
    payloads = base_payloads(
        [sample],
        experiment_trays=[
            {"task_code": "TASK-501", "experiment_code": "EXP-A", "tray_code": "TP-501"},
            {"task_code": "TASK-501", "experiment_code": "EXP-B", "tray_code": "TP-501"},
        ],
    )
    payloads["mes.experiments"] = [
        {
            "task_code": "TASK-501",
            "experiment_code": "EXP-A",
            "experiment_name": "冲击试验",
            "axis_codes": ["x+", "x-", "y+", "y-", "z+", "z-"],
        },
        {
            "task_code": "TASK-501",
            "experiment_code": "EXP-B",
            "experiment_name": "四综合试验",
        },
    ]
    payloads["mes.schedules"] = [
        {
            "id": "SCH-IMPACT-FIRST",
            "task_code": "TASK-501",
            "experiment_code": "EXP-A",
            "device": "冲击一室",
            "status": "实验已完成",
            "sub_experiment_code": "EXP-A-AXIS-001",
            "axis_codes": ["x+", "x-", "y+"],
        },
        {
            "id": "SCH-COMPREHENSIVE",
            "task_code": "TASK-501",
            "experiment_code": "EXP-B",
            "device": "四综合实验室",
            "status": "实验已完成",
        },
        {
            "id": "SCH-IMPACT-REMAINING",
            "task_code": "TASK-501",
            "experiment_code": "EXP-A",
            "device": "冲击一室",
            "status": "已排程",
            "sub_experiment_code": "EXP-A-AXIS-002",
            "axis_codes": ["y-", "z+", "z-"],
        },
    ]
    payloads["mes.experiment_runs"] = [
        {
            "run_no": "RUN-IMPACT-AXIS-001",
            "schedule_id": "SCH-IMPACT-FIRST",
            "task_code": "TASK-501",
            "experiment_code": "EXP-A",
            "device": "冲击一室",
            "status": "实验已完成",
            "sub_experiment_code": "EXP-A-AXIS-001",
            "axis_codes": ["x+", "x-", "y+"],
            "ended_at": "2026-07-02T15:40:49",
        },
        {
            "run_no": "RUN-COMPREHENSIVE",
            "schedule_id": "SCH-COMPREHENSIVE",
            "task_code": "TASK-501",
            "experiment_code": "EXP-B",
            "device": "四综合实验室",
            "status": "实验已完成",
            "ended_at": "2026-07-02T15:41:13",
        },
    ]
    payloads["mes.experiment_run_trays"] = [
        {
            "run_no": "RUN-IMPACT-AXIS-001",
            "task_code": "TASK-501",
            "experiment_code": "EXP-A",
            "tray_code": "TP-501",
            "status": "实验已完成",
            "run_tray_status": "实验已完成",
            "sub_experiment_code": "EXP-A-AXIS-001",
            "ended_at": "2026-07-02T15:40:49",
        },
        {
            "run_no": "RUN-COMPREHENSIVE",
            "task_code": "TASK-501",
            "experiment_code": "EXP-B",
            "tray_code": "TP-501",
            "status": "实验已完成",
            "run_tray_status": "实验已完成",
            "ended_at": "2026-07-02T15:41:13",
        },
    ]
    payloads["mes.experiment_run_steps"] = [
        {
            "run_no": "RUN-IMPACT-AXIS-001",
            "task_code": "TASK-501",
            "experiment_code": "EXP-A",
            "axis_code": axis_code,
            "status": "实验已完成",
            "ended_at": "2026-07-02T15:40:49",
            "sub_experiment_code": "EXP-A-AXIS-001",
        }
        for axis_code in ["x+", "x-", "y+"]
    ]
    client, storage = build_client(monkeypatch, payloads)

    response = client.post("/api/laboratory/tasks/TASK-501/experiments/EXP-A/withdraw-current", json={"trayCodes": ["TP-501"]})

    assert response.status_code == 409
    assert "已有完成轴向" in response.json()["detail"]
    updated = storage.read("mes.samples")[0]
    assert updated["status"] == "已到达实验室"
    assert updated["location"] == "冲击一室"
    assert updated["trays"][0]["status"] == "已到达实验室"


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
    assert samples["SP-B"]["history"][0]["detail"] == "TASK-PARALLEL / 霉菌试验 / 工装夹具安装 / 托盘：TP-B"
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


def test_atomic_laboratory_operation_uses_scoped_sample_persistence_when_available():
    class ScopedStorage(FakeLaboratoryStorage):
        def __init__(self, payloads):
            super().__init__(payloads)
            self.scoped_sample_codes = []

        def write_many_scoped(self, updates):
            sample_patch = list(updates.get("mes.samples", []))
            self.scoped_sample_codes.append([sample["code"] for sample in sample_patch])
            existing_samples = {sample["code"]: sample for sample in self.payloads["mes.samples"]}
            existing_samples.update({sample["code"]: sample for sample in sample_patch})
            self.payloads["mes.samples"] = list(existing_samples.values())
            for key, value in updates.items():
                if key != "mes.samples":
                    self.payloads[key] = list(value)

    storage = ScopedStorage(
        {
            "mes.tasks": [{"code": "TASK-SCOPED"}],
            "mes.experiments": [
                {"task_code": "TASK-SCOPED", "experiment_code": "EXP-A", "experiment_name": "冲击试验"},
                {"task_code": "TASK-SCOPED", "experiment_code": "EXP-B", "experiment_name": "霉菌试验"},
            ],
            "mes.experiment_trays": [
                {"task_code": "TASK-SCOPED", "experiment_code": "EXP-A", "tray_code": "TP-A"},
                {"task_code": "TASK-SCOPED", "experiment_code": "EXP-B", "tray_code": "TP-B"},
            ],
            "mes.experiment_samples": [
                {"task_code": "TASK-SCOPED", "experiment_code": "EXP-A", "sample_code": "SP-A"},
                {"task_code": "TASK-SCOPED", "experiment_code": "EXP-B", "sample_code": "SP-B"},
            ],
            "mes.samples": [
                {
                    "code": "SP-A",
                    "task_code": "TASK-SCOPED",
                    "status": "工装夹具安装",
                    "flow_status": "工装夹具安装",
                    "location": "冲击一室",
                    "trays": [{"tray_code": "TP-A", "quantity": 1, "status": "工装夹具安装"}],
                    "history": [],
                },
                {
                    "code": "SP-B",
                    "task_code": "TASK-SCOPED",
                    "status": "工装夹具安装",
                    "flow_status": "工装夹具安装",
                    "location": "霉菌试验室",
                    "trays": [{"tray_code": "TP-B", "quantity": 1, "status": "工装夹具安装"}],
                    "history": [],
                },
                {
                    "code": "SP-A-PEER",
                    "task_code": "TASK-SCOPED",
                    "status": "工装夹具安装",
                    "flow_status": "工装夹具安装",
                    "location": "冲击一室",
                    "trays": [{"tray_code": "TP-A", "quantity": 1, "status": "工装夹具安装"}],
                    "history": [],
                },
            ],
        }
    )

    run_atomic_laboratory_operation(
        operation=lambda snapshot: apply_laboratory_task_operation(
            snapshot,
            operation_type="fixtureReady",
            task_code="TASK-SCOPED",
            experiment_code="EXP-A",
            lab_name="冲击一室",
            tray_codes=["TP-A"],
            occurred_at="2026-07-22 15:00:00",
        ),
        publish_storage_update=None,
        resource_keys=["lab:冲击一室", "tray:TP-A"],
        storage=storage,
    )

    assert storage.scoped_sample_codes == [["SP-A", "SP-A-PEER"]]
    samples = {sample["code"]: sample for sample in storage.payloads["mes.samples"]}
    assert samples["SP-A"]["trays"][0]["fixture_ready"] is True
    assert "fixture_ready" not in samples["SP-A-PEER"]["trays"][0]
    assert "fixture_ready" not in samples["SP-B"]["trays"][0]


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
                    {"action": "外观检测间扫码入库", "detail": "TP-501 实验后外观检测间存放", "status": "实验后外观检测间存放", "location": "外观检测间", "time": "2026-06-06T21:40:00"},
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
    assert payload["restoredStatus"] == "实验后外观检测间存放"
    assert payload["restoredExperimentName"] == ""
    updated = storage.read("mes.samples")[0]
    assert updated["status"] == "实验后外观检测间存放"
    assert updated["flow_status"] == "实验后外观检测间存放"
    assert updated["location"] == "外观检测间"
    assert updated["trays"][0]["status"] == "实验后外观检测间存放"
    assert "撤回至实验后外观检测间存放" in updated["history"][0]["detail"]
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
                    {"action": "外观检测间扫码入库", "detail": "TP-501 实验前外观检测间存放", "status": "实验前外观检测间存放", "location": "外观检测间", "time": "2026-06-06T21:40:00"},
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
    assert payload["restoredStatus"] == "实验前外观检测间存放"
    updated = storage.read("mes.samples")[0]
    assert updated["status"] == "实验前外观检测间存放"
    assert updated["flow_status"] == "实验前外观检测间存放"
    assert updated["location"] == "外观检测间"
    assert updated["trays"][0]["status"] == "实验前外观检测间存放"
    assert "撤回至实验前外观检测间存放" in updated["history"][0]["detail"]


def test_laboratory_withdraw_current_keeps_pre_appearance_after_repeated_appearance_dispatch(monkeypatch):
    payloads = base_payloads(
        [
            sample_with_history(
                "已到达实验室",
                "盐雾试验室",
                [
                    {"action": "任务比对", "detail": "TASK-501 / 盐雾试验 / 已到达实验室", "status": "已到达实验室", "location": "盐雾试验室", "time": "2026-06-06T22:20:00"},
                    {"action": "外观检测间扫码出库", "detail": "TP-501 送至 盐雾试验室", "status": "送至实验室", "location": "盐雾试验室", "time": "2026-06-06T22:10:00"},
                    {"action": "实验任务撤回", "detail": "TASK-501 / 霉菌试验 / 撤回至实验前外观检测间存放", "status": "实验前外观检测间存放", "location": "外观检测间", "time": "2026-06-06T22:00:00"},
                    {"action": "外观检测间扫码出库", "detail": "TP-501 送至 霉菌试验室", "status": "送至实验室", "location": "霉菌试验室", "time": "2026-06-06T21:50:00"},
                    {"action": "外观检测间扫码入库", "detail": "TP-501 实验前外观检测间存放", "status": "实验前外观检测间存放", "location": "外观检测间", "time": "2026-06-06T21:40:00"},
                ],
            )
        ],
        experiment_trays=[
            {"task_code": "TASK-501", "experiment_code": "EXP-B", "tray_code": "TP-501"},
            {"task_code": "TASK-501", "experiment_code": "EXP-A", "tray_code": "TP-501"},
        ],
        staging_events=[
            {"id": "pre-appearance-in", "tray_code": "TP-501", "task_code": "TASK-501", "room": "appearance", "action": "stock_in", "time": "2026-06-06T21:40:00"},
            {
                "id": "pre-appearance-out-mold",
                "tray_code": "TP-501",
                "task_code": "TASK-501",
                "room": "appearance",
                "action": "stock_out",
                "target_lab": "霉菌试验室",
                "target_experiment_code": "EXP-B",
                "time": "2026-06-06T21:50:00",
            },
            {
                "id": "pre-appearance-withdraw-mold",
                "tray_code": "TP-501",
                "task_code": "TASK-501",
                "room": "appearance",
                "action": "stock_out_withdraw",
                "target_lab": "霉菌试验室",
                "target_experiment_code": "EXP-B",
                "time": "2026-06-06T22:00:00",
            },
            {
                "id": "pre-appearance-out-salt",
                "tray_code": "TP-501",
                "task_code": "TASK-501",
                "room": "appearance",
                "action": "stock_out",
                "target_lab": "盐雾试验室",
                "target_experiment_code": "EXP-A",
                "time": "2026-06-06T22:10:00",
            },
        ],
    )
    client, storage = build_client(monkeypatch, payloads)

    response = client.post("/api/laboratory/tasks/TASK-501/experiments/EXP-A/withdraw-current", json={})

    assert response.status_code == 200
    payload = response.json()
    assert payload["restoredStatus"] == "实验前外观检测间存放"
    updated = storage.read("mes.samples")[0]
    assert updated["status"] == "实验前外观检测间存放"
    assert updated["flow_status"] == "实验前外观检测间存放"
    assert updated["location"] == "外观检测间"
    assert updated["trays"][0]["status"] == "实验前外观检测间存放"
    assert "撤回至实验前外观检测间存放" in updated["history"][0]["detail"]


def test_laboratory_withdraw_current_restores_pre_appearance_for_all_samples_on_same_tray(monkeypatch):
    def make_sample(code):
        sample = sample_with_history(
            "已到达实验室",
            "霉菌试验室",
            [
                {"action": "任务比对", "detail": "TASK-501 / 霉菌试验 / 已到达实验室", "status": "已到达实验室", "location": "霉菌试验室", "time": "2026-06-06T22:10:00"},
                {"action": "外观检测间扫码出库", "detail": "TP-501 送至 霉菌试验室", "status": "送至实验室", "location": "霉菌试验室", "time": "2026-06-06T22:00:00"},
                {"action": "外观检测间扫码入库", "detail": "TP-501 实验前外观检测间存放", "status": "实验前外观检测间存放", "location": "外观检测间", "time": "2026-06-06T21:40:00"},
                {"action": "暂存间扫码出库", "detail": "TP-501 送至 霉菌试验室", "status": "送至实验室", "location": "霉菌试验室", "time": "2026-06-06T21:30:00"},
                {"action": "实验完成", "detail": "TASK-501 / 四综合试验 / 实验已完成", "status": "实验已完成", "location": "四综合实验室", "time": "2026-06-06T21:00:00"},
            ],
        )
        sample["id"] = code
        sample["code"] = code
        return sample

    payloads = base_payloads(
        [make_sample("SP-501-A"), make_sample("SP-501-B")],
        experiment_trays=[{"task_code": "TASK-501", "experiment_code": "EXP-B", "tray_code": "TP-501"}],
        staging_events=[
            {"id": "appearance-in", "tray_code": "TP-501", "task_code": "TASK-501", "room": "appearance", "action": "stock_in", "time": "2026-06-06T21:40:00"},
            {
                "id": "appearance-out",
                "tray_code": "TP-501",
                "task_code": "TASK-501",
                "room": "appearance",
                "action": "stock_out",
                "target_lab": "霉菌试验室",
                "target_experiment_code": "EXP-B",
                "time": "2026-06-06T22:00:00",
            },
        ],
    )
    payloads["mes.experiments"].append({"task_code": "TASK-501", "experiment_code": "EXP-D", "experiment_name": "四综合试验"})
    payloads["mes.experiment_samples"] = [
        {"task_code": "TASK-501", "experiment_code": "EXP-B", "sample_code": "SP-501-A"},
        {"task_code": "TASK-501", "experiment_code": "EXP-B", "sample_code": "SP-501-B"},
    ]
    client, storage = build_client(monkeypatch, payloads)

    response = client.post("/api/laboratory/tasks/TASK-501/experiments/EXP-B/withdraw-current", json={})

    assert response.status_code == 200
    assert response.json()["restoredStatus"] == "实验前外观检测间存放"
    updated_samples = storage.read("mes.samples")
    assert [sample["status"] for sample in updated_samples] == ["实验前外观检测间存放", "实验前外观检测间存放"]
    assert [sample["trays"][0]["status"] for sample in updated_samples] == ["实验前外观检测间存放", "实验前外观检测间存放"]
    assert all("撤回至实验前外观检测间存放" in sample["history"][0]["detail"] for sample in updated_samples)


def partial_axis_return_payloads():
    sample = sample_with_history(
        "已到达实验室",
        "冲击二室",
        [
            {
                "action": "任务比对",
                "detail": "TASK-501 / 冲击试验 / 已到达实验室 / 托盘：TP-501",
                "status": "已到达实验室",
                "location": "冲击二室",
                "time": "2026-07-16T12:00:00",
            },
            {
                "action": "实验完成",
                "detail": "TASK-501 / 四综合试验 / 实验已完成",
                "status": "实验已完成",
                "location": "四综合实验室",
                "time": "2026-07-16T11:30:00",
            },
            {
                "action": "实验完成",
                "detail": "TASK-501 / 冲击试验 / 冲击试验部分完成 3/6轴",
                "status": "冲击试验部分完成 3/6轴",
                "location": "冲击二室",
                "time": "2026-07-16T11:00:00",
            },
        ],
    )
    sample["trays"][0]["target_experiment_code"] = "EXP-A"
    sample["trays"][0]["target_lab"] = "冲击二室"
    payloads = base_payloads(
        [sample],
        experiment_trays=[
            {"task_code": "TASK-501", "experiment_code": "EXP-A", "tray_code": "TP-501"},
            {"task_code": "TASK-501", "experiment_code": "EXP-B", "tray_code": "TP-501"},
        ],
    )
    payloads["mes.experiments"][0] = {
        "task_code": "TASK-501",
        "experiment_code": "EXP-A",
        "experiment_name": "冲击试验",
        "status": "实验进行中",
        "axis_codes": ["x+", "x-", "y+", "y-", "z+", "z-"],
    }
    payloads["mes.experiments"][1] = {
        "task_code": "TASK-501",
        "experiment_code": "EXP-B",
        "experiment_name": "四综合试验",
        "status": "实验已完成",
    }
    payloads["mes.schedules"] = [
        {
            "id": "schedule-impact-axis-001",
            "task_code": "TASK-501",
            "experiment_code": "EXP-A",
            "sub_experiment_code": "EXP-A-AXIS-001",
            "axis_batch_no": "001",
            "device": "冲击二室",
            "status": "实验已完成",
            "axis_codes": ["x+", "x-", "y+"],
        },
        {
            "id": "schedule-combined",
            "task_code": "TASK-501",
            "experiment_code": "EXP-B",
            "device": "四综合实验室",
            "status": "实验已完成",
        },
        {
            "id": "schedule-impact-axis-002",
            "task_code": "TASK-501",
            "experiment_code": "EXP-A",
            "sub_experiment_code": "EXP-A-AXIS-002",
            "axis_batch_no": "002",
            "device": "冲击二室",
            "status": "实验进行中",
            "axis_codes": ["y-", "z+", "z-"],
        },
    ]
    payloads["mes.experiment_runs"] = [
        {
            "run_no": "RUN-IMPACT-AXIS-001",
            "schedule_id": "schedule-impact-axis-001",
            "task_code": "TASK-501",
            "experiment_code": "EXP-A",
            "sub_experiment_code": "EXP-A-AXIS-001",
            "axis_batch_no": "001",
            "status": "实验已完成",
            "axis_codes": ["x+", "x-", "y+"],
            "ended_at": "2026-07-16T11:00:00",
        },
        {
            "run_no": "RUN-COMBINED",
            "schedule_id": "schedule-combined",
            "task_code": "TASK-501",
            "experiment_code": "EXP-B",
            "status": "实验已完成",
            "ended_at": "2026-07-16T11:30:00",
        },
    ]
    payloads["mes.experiment_run_trays"] = [
        {
            "run_no": "RUN-IMPACT-AXIS-001",
            "task_code": "TASK-501",
            "experiment_code": "EXP-A",
            "sub_experiment_code": "EXP-A-AXIS-001",
            "tray_code": "TP-501",
            "status": "实验已完成",
            "run_tray_status": "实验已完成",
            "ended_at": "2026-07-16T11:00:00",
        },
        {
            "run_no": "RUN-COMBINED",
            "task_code": "TASK-501",
            "experiment_code": "EXP-B",
            "tray_code": "TP-501",
            "status": "实验已完成",
            "run_tray_status": "实验已完成",
            "ended_at": "2026-07-16T11:30:00",
        },
    ]
    payloads["mes.experiment_run_steps"] = [
        {
            "run_no": "RUN-IMPACT-AXIS-001",
            "task_code": "TASK-501",
            "experiment_code": "EXP-A",
            "sub_experiment_code": "EXP-A-AXIS-001",
            "axis_code": axis_code,
            "status": "实验已完成",
            "ended_at": "2026-07-16T11:00:00",
        }
        for axis_code in ["x+", "x-", "y+"]
    ]
    return payloads


def test_laboratory_withdraw_current_allows_new_axis_batch_after_previous_batch_completed(monkeypatch):
    payloads = partial_axis_return_payloads()
    original_runs = deepcopy(payloads["mes.experiment_runs"])
    client, storage = build_client(monkeypatch, payloads)

    response = client.post(
        "/api/laboratory/tasks/TASK-501/experiments/EXP-A/withdraw-current",
        json={
            "trayCodes": ["TP-501"],
            "scheduleId": "schedule-impact-axis-002",
            "subExperimentCode": "EXP-A-AXIS-002",
            "axisBatchNo": "002",
        },
    )

    assert response.status_code == 200
    assert response.json()["restoredExperimentName"] == "四综合试验"
    updated = storage.read("mes.samples")[0]
    assert updated["status"] == "实验已完成"
    assert updated["flow_status"] == "实验已完成"
    assert updated["location"] == "四综合实验室"
    assert updated["trays"][0]["status"] == "实验已完成"
    assert storage.read("mes.experiment_runs") == original_runs


def test_laboratory_withdraw_current_rejects_completed_axis_in_requested_batch(monkeypatch):
    payloads = partial_axis_return_payloads()
    payloads["mes.experiment_runs"].append(
        {
            "run_no": "RUN-IMPACT-AXIS-002",
            "schedule_id": "schedule-impact-axis-002",
            "task_code": "TASK-501",
            "experiment_code": "EXP-A",
            "sub_experiment_code": "EXP-A-AXIS-002",
            "axis_batch_no": "002",
            "status": "实验已完成",
            "axis_codes": ["y-"],
        }
    )
    payloads["mes.experiment_run_trays"].append(
        {
            "run_no": "RUN-IMPACT-AXIS-002",
            "task_code": "TASK-501",
            "experiment_code": "EXP-A",
            "sub_experiment_code": "EXP-A-AXIS-002",
            "tray_code": "TP-501",
            "status": "实验已完成",
            "run_tray_status": "实验已完成",
        }
    )
    payloads["mes.experiment_run_steps"].append(
        {
            "run_no": "RUN-IMPACT-AXIS-002",
            "task_code": "TASK-501",
            "experiment_code": "EXP-A",
            "sub_experiment_code": "EXP-A-AXIS-002",
            "axis_code": "y-",
            "status": "实验已完成",
        }
    )
    client, storage = build_client(monkeypatch, payloads)

    response = client.post(
        "/api/laboratory/tasks/TASK-501/experiments/EXP-A/withdraw-current",
        json={
            "trayCodes": ["TP-501"],
            "scheduleId": "schedule-impact-axis-002",
            "subExperimentCode": "EXP-A-AXIS-002",
            "axisBatchNo": "002",
        },
    )

    assert response.status_code == 409
    assert "已有完成轴向" in response.json()["detail"]
    assert storage.read("mes.samples")[0]["status"] == "已到达实验室"


def test_laboratory_withdraw_current_rejects_completed_axis_run(monkeypatch):
    sample = sample_with_history(
        "已到达实验室",
        "冲击二室",
        [
            {"action": "任务比对", "detail": "TASK-501 / 冲击试验 / 已到达实验室", "status": "已到达实验室", "location": "冲击二室", "time": "2026-06-27T14:34:34"},
        ],
    )
    payloads = base_payloads(
        [sample],
        experiment_trays=[{"task_code": "TASK-501", "experiment_code": "EXP-A", "tray_code": "TP-501"}],
    )
    payloads["mes.experiments"][0] = {
        "task_code": "TASK-501",
        "experiment_code": "EXP-A",
        "experiment_name": "冲击试验",
        "status": "实验进行中",
        "axis_codes": ["x+", "x-", "y+", "y-", "z+", "z-"],
    }
    payloads["mes.schedules"] = [
        {
            "id": "schedule-impact-axis-001",
            "task_code": "TASK-501",
            "experiment_code": "EXP-A",
            "device": "冲击一室",
            "status": "实验已完成",
            "axis_codes": ["x+", "x-", "y+"],
        },
        {
            "id": "schedule-impact-axis-002",
            "task_code": "TASK-501",
            "experiment_code": "EXP-A",
            "device": "冲击二室",
            "status": "已排程",
            "axis_codes": ["y-", "z+", "z-"],
        },
    ]
    payloads["mes.experiment_runs"] = [
        {
            "run_no": "RUN-IMPACT-AXIS-001",
            "task_code": "TASK-501",
            "experiment_code": "EXP-A",
            "schedule_id": "schedule-impact-axis-001",
            "status": "实验已完成",
            "axis_codes": ["x+", "x-", "y+"],
            "ended_at": "2026-06-27T14:30:01",
        }
    ]
    payloads["mes.experiment_run_trays"] = [
        {
            "run_no": "RUN-IMPACT-AXIS-001",
            "task_code": "TASK-501",
            "experiment_code": "EXP-A",
            "tray_code": "TP-501",
            "status": "实验已完成",
            "run_tray_status": "实验已完成",
            "ended_at": "2026-06-27T14:30:01",
        }
    ]
    payloads["mes.experiment_run_steps"] = [
        {
            "run_no": "RUN-IMPACT-AXIS-001",
            "task_code": "TASK-501",
            "experiment_code": "EXP-A",
            "axis_code": axis_code,
            "status": "实验已完成",
            "ended_at": "2026-06-27T14:30:01",
        }
        for axis_code in ["x+", "x-", "y+"]
    ]
    client, storage = build_client(monkeypatch, payloads)

    response = client.post("/api/laboratory/tasks/TASK-501/experiments/EXP-A/withdraw-current", json={"trayCodes": ["TP-501"]})

    assert response.status_code == 409
    assert "已有完成轴向" in response.json()["detail"]
    updated = storage.read("mes.samples")[0]
    assert updated["status"] == "已到达实验室"
    assert updated["flow_status"] == "已到达实验室"
    assert updated["location"] == "冲击二室"
    assert updated["trays"][0]["status"] == "已到达实验室"


def test_laboratory_withdraw_current_rejects_completed_axis_run_even_when_staging_has_newer_events(monkeypatch):
    sample = sample_with_history(
        "已到达实验室",
        "冲击二室",
        [
            {"action": "任务比对", "detail": "TASK-501 / 冲击试验 / 已到达实验室", "status": "已到达实验室", "location": "冲击二室", "time": "2026-06-27T14:34:34"},
            {"action": "暂存间扫码出库", "detail": "TP-501 送至 冲击二室", "status": "送至实验室", "location": "冲击二室", "time": "2026-06-27T14:33:00"},
            {"action": "暂存间扫码入库", "detail": "TP-501 已到达暂存间", "status": "已到达暂存间", "location": "恒温恒湿间（暂存间）", "time": "2026-06-27T14:32:00"},
        ],
    )
    payloads = base_payloads(
        [sample],
        experiment_trays=[{"task_code": "TASK-501", "experiment_code": "EXP-A", "tray_code": "TP-501"}],
        staging_events=[
            {"id": "staging-in-after-impact", "tray_code": "TP-501", "task_code": "TASK-501", "action": "stock_in", "time": "2026-06-27T14:32:00"},
            {
                "id": "staging-out-to-vibration",
                "tray_code": "TP-501",
                "task_code": "TASK-501",
                "action": "stock_out",
                "target_lab": "冲击二室",
                "target_experiment_code": "EXP-A",
                "time": "2026-06-27T14:33:00",
            },
        ],
    )
    payloads["mes.experiments"][0] = {
        "task_code": "TASK-501",
        "experiment_code": "EXP-A",
        "experiment_name": "冲击试验",
        "status": "实验进行中",
        "axis_codes": ["x+", "x-", "y+", "y-", "z+", "z-"],
    }
    payloads["mes.schedules"] = [
        {
            "id": "schedule-impact-axis-001",
            "task_code": "TASK-501",
            "experiment_code": "EXP-A",
            "device": "冲击一室",
            "status": "实验已完成",
            "axis_codes": ["x+", "x-", "y+"],
        },
        {
            "id": "schedule-impact-axis-002",
            "task_code": "TASK-501",
            "experiment_code": "EXP-A",
            "device": "冲击二室",
            "status": "已排程",
            "axis_codes": ["y-", "z+", "z-"],
        },
    ]
    payloads["mes.experiment_runs"] = [
        {
            "run_no": "RUN-IMPACT-AXIS-001",
            "task_code": "TASK-501",
            "experiment_code": "EXP-A",
            "schedule_id": "schedule-impact-axis-001",
            "status": "实验已完成",
            "axis_codes": ["x+", "x-", "y+"],
            "ended_at": "2026-06-27T14:30:01",
        }
    ]
    payloads["mes.experiment_run_trays"] = [
        {
            "run_no": "RUN-IMPACT-AXIS-001",
            "task_code": "TASK-501",
            "experiment_code": "EXP-A",
            "tray_code": "TP-501",
            "status": "实验已完成",
            "run_tray_status": "实验已完成",
            "ended_at": "2026-06-27T14:30:01",
        }
    ]
    payloads["mes.experiment_run_steps"] = [
        {
            "run_no": "RUN-IMPACT-AXIS-001",
            "task_code": "TASK-501",
            "experiment_code": "EXP-A",
            "axis_code": axis_code,
            "status": "实验已完成",
            "ended_at": "2026-06-27T14:30:01",
        }
        for axis_code in ["x+", "x-", "y+"]
    ]
    client, storage = build_client(monkeypatch, payloads)

    response = client.post("/api/laboratory/tasks/TASK-501/experiments/EXP-A/withdraw-current", json={"trayCodes": ["TP-501"]})

    assert response.status_code == 409
    assert "已有完成轴向" in response.json()["detail"]
    updated = storage.read("mes.samples")[0]
    assert updated["status"] == "已到达实验室"
    assert updated["location"] == "冲击二室"
    assert updated["trays"][0]["status"] == "已到达实验室"


def test_laboratory_withdraw_current_rejects_current_partial_axis_even_after_another_experiment_completes(monkeypatch):
    sample = sample_with_history(
        "已到达实验室",
        "振动二室",
        [
            {"action": "任务比对", "detail": "TASK-501 / 振动试验 / 已到达实验室", "status": "已到达实验室", "location": "振动二室", "time": "2026-06-27T11:30:00"},
            {"action": "实验完成", "detail": "TASK-501 / 冲击试验 / 实验已完成", "status": "实验已完成", "location": "冲击一室", "time": "2026-06-27T11:00:00"},
            {"action": "实验完成", "detail": "TASK-501 / 振动试验 / 振动试验部分完成 3/6轴", "status": "振动试验部分完成 3/6轴", "location": "振动二室", "time": "2026-06-27T10:00:00"},
        ],
    )
    payloads = base_payloads(
        [sample],
        experiment_trays=[
            {"task_code": "TASK-501", "experiment_code": "EXP-B", "tray_code": "TP-501"},
            {"task_code": "TASK-501", "experiment_code": "EXP-C", "tray_code": "TP-501"},
        ],
    )
    payloads["mes.experiments"][1] = {
        "task_code": "TASK-501",
        "experiment_code": "EXP-B",
        "experiment_name": "冲击试验",
        "status": "实验已完成",
        "axis_codes": ["x+", "x-", "y+", "y-", "z+", "z-"],
    }
    payloads["mes.experiments"][2] = {
        "task_code": "TASK-501",
        "experiment_code": "EXP-C",
        "experiment_name": "振动试验",
        "status": "实验进行中",
        "axis_codes": ["x+", "x-", "y+", "y-", "z+", "z-"],
    }
    payloads["mes.schedules"] = [
        {
            "id": "schedule-impact-axis-001",
            "task_code": "TASK-501",
            "experiment_code": "EXP-B",
            "device": "冲击一室",
            "status": "实验已完成",
            "axis_codes": ["x+", "x-", "y+"],
        },
        {
            "id": "schedule-vibration-axis-001",
            "task_code": "TASK-501",
            "experiment_code": "EXP-C",
            "device": "振动二室",
            "status": "实验已完成",
            "axis_codes": ["x+", "x-", "y+"],
        },
        {
            "id": "schedule-impact-axis-002",
            "task_code": "TASK-501",
            "experiment_code": "EXP-B",
            "device": "冲击一室",
            "status": "实验已完成",
            "axis_codes": ["y-", "z+", "z-"],
        },
        {
            "id": "schedule-vibration-axis-002",
            "task_code": "TASK-501",
            "experiment_code": "EXP-C",
            "device": "振动二室",
            "status": "实验进行中",
            "axis_codes": ["y-", "z+", "z-"],
        },
    ]
    payloads["mes.experiment_runs"] = [
        {
            "run_no": "RUN-IMPACT-AXIS-001",
            "task_code": "TASK-501",
            "experiment_code": "EXP-B",
            "schedule_id": "schedule-impact-axis-001",
            "status": "实验已完成",
            "axis_codes": ["x+", "x-", "y+"],
            "ended_at": "2026-06-27T09:00:00",
        },
        {
            "run_no": "RUN-VIBRATION-AXIS-001",
            "task_code": "TASK-501",
            "experiment_code": "EXP-C",
            "schedule_id": "schedule-vibration-axis-001",
            "status": "实验已完成",
            "axis_codes": ["x+", "x-", "y+"],
            "ended_at": "2026-06-27T10:00:00",
        },
        {
            "run_no": "RUN-IMPACT-AXIS-002",
            "task_code": "TASK-501",
            "experiment_code": "EXP-B",
            "schedule_id": "schedule-impact-axis-002",
            "status": "实验已完成",
            "axis_codes": ["y-", "z+", "z-"],
            "ended_at": "2026-06-27T11:00:00",
        },
    ]
    payloads["mes.experiment_run_trays"] = [
        {
            "run_no": "RUN-IMPACT-AXIS-001",
            "task_code": "TASK-501",
            "experiment_code": "EXP-B",
            "tray_code": "TP-501",
            "status": "实验已完成",
            "run_tray_status": "实验已完成",
            "ended_at": "2026-06-27T09:00:00",
        },
        {
            "run_no": "RUN-VIBRATION-AXIS-001",
            "task_code": "TASK-501",
            "experiment_code": "EXP-C",
            "tray_code": "TP-501",
            "status": "实验已完成",
            "run_tray_status": "实验已完成",
            "ended_at": "2026-06-27T10:00:00",
        },
        {
            "run_no": "RUN-IMPACT-AXIS-002",
            "task_code": "TASK-501",
            "experiment_code": "EXP-B",
            "tray_code": "TP-501",
            "status": "实验已完成",
            "run_tray_status": "实验已完成",
            "ended_at": "2026-06-27T11:00:00",
        },
    ]
    payloads["mes.experiment_run_steps"] = [
        *[
            {
                "run_no": "RUN-IMPACT-AXIS-001",
                "task_code": "TASK-501",
                "experiment_code": "EXP-B",
                "axis_code": axis_code,
                "status": "实验已完成",
                "ended_at": "2026-06-27T09:00:00",
            }
            for axis_code in ["x+", "x-", "y+"]
        ],
        *[
            {
                "run_no": "RUN-VIBRATION-AXIS-001",
                "task_code": "TASK-501",
                "experiment_code": "EXP-C",
                "axis_code": axis_code,
                "status": "实验已完成",
                "ended_at": "2026-06-27T10:00:00",
            }
            for axis_code in ["x+", "x-", "y+"]
        ],
        *[
            {
                "run_no": "RUN-IMPACT-AXIS-002",
                "task_code": "TASK-501",
                "experiment_code": "EXP-B",
                "axis_code": axis_code,
                "status": "实验已完成",
                "ended_at": "2026-06-27T11:00:00",
            }
            for axis_code in ["y-", "z+", "z-"]
        ],
    ]
    client, storage = build_client(monkeypatch, payloads)

    response = client.post("/api/laboratory/tasks/TASK-501/experiments/EXP-C/withdraw-current", json={"trayCodes": ["TP-501"]})

    assert response.status_code == 409
    assert "已有完成轴向" in response.json()["detail"]
    updated = storage.read("mes.samples")[0]
    assert updated["status"] == "已到达实验室"
    assert updated["location"] == "振动二室"
    assert updated["trays"][0]["status"] == "已到达实验室"


def test_laboratory_withdraw_current_rejects_current_partial_axis_status(monkeypatch):
    sample = sample_with_history(
        "振动试验部分完成 3/6轴",
        "振动一室",
        [
            {"action": "实验完成", "detail": "TASK-501 / 振动试验 / 振动试验部分完成 3/6轴", "status": "振动试验部分完成 3/6轴", "location": "振动一室", "time": "2026-07-01T16:38:35"},
            {"action": "实验完成", "detail": "TASK-501 / 冲击试验 / 冲击试验部分完成 3/6轴", "status": "冲击试验部分完成 3/6轴", "location": "冲击一室", "time": "2026-07-01T16:04:18"},
        ],
    )
    sample["trays"][0]["status"] = "振动试验部分完成 3/6轴"
    sample["trays"][0]["target_experiment_code"] = "EXP-A"
    sample["trays"][0]["target_lab"] = "振动一室"
    payloads = base_payloads(
        [sample],
        experiment_trays=[
            {"task_code": "TASK-501", "experiment_code": "EXP-A", "tray_code": "TP-501"},
            {"task_code": "TASK-501", "experiment_code": "EXP-C", "tray_code": "TP-501"},
        ],
    )
    payloads["mes.experiments"][0] = {
        "task_code": "TASK-501",
        "experiment_code": "EXP-A",
        "experiment_name": "冲击试验",
        "axis_codes": ["x+", "x-", "y+", "y-", "z+", "z-"],
    }
    payloads["mes.experiments"][2] = {
        "task_code": "TASK-501",
        "experiment_code": "EXP-C",
        "experiment_name": "振动试验",
        "status": "实验进行中",
        "axis_codes": ["x+", "x-", "y+", "y-", "z+", "z-"],
    }
    payloads["mes.experiment_runs"] = [
        {
            "run_no": "RUN-IMPACT-AXIS-001",
            "task_code": "TASK-501",
            "experiment_code": "EXP-A",
            "status": "实验已完成",
            "axis_codes": ["x+", "x-", "y+"],
            "ended_at": "2026-07-01T16:04:18",
        },
        {
            "run_no": "RUN-VIBRATION-AXIS-001",
            "task_code": "TASK-501",
            "experiment_code": "EXP-C",
            "status": "实验已完成",
            "axis_codes": ["x+", "x-", "y+"],
            "ended_at": "2026-07-01T16:38:35",
        },
    ]
    payloads["mes.experiment_run_trays"] = [
        {
            "run_no": "RUN-IMPACT-AXIS-001",
            "task_code": "TASK-501",
            "experiment_code": "EXP-A",
            "tray_code": "TP-501",
            "status": "实验已完成",
            "run_tray_status": "实验已完成",
            "ended_at": "2026-07-01T16:04:18",
        },
        {
            "run_no": "RUN-VIBRATION-AXIS-001",
            "task_code": "TASK-501",
            "experiment_code": "EXP-C",
            "tray_code": "TP-501",
            "status": "实验已完成",
            "run_tray_status": "实验已完成",
            "ended_at": "2026-07-01T16:38:35",
        },
    ]
    payloads["mes.experiment_run_steps"] = [
        *[
            {
                "run_no": "RUN-IMPACT-AXIS-001",
                "task_code": "TASK-501",
                "experiment_code": "EXP-A",
                "axis_code": axis_code,
                "status": "实验已完成",
                "ended_at": "2026-07-01T16:04:18",
            }
            for axis_code in ["x+", "x-", "y+"]
        ],
        *[
            {
                "run_no": "RUN-VIBRATION-AXIS-001",
                "task_code": "TASK-501",
                "experiment_code": "EXP-C",
                "axis_code": axis_code,
                "status": "实验已完成",
                "ended_at": "2026-07-01T16:38:35",
            }
            for axis_code in ["x+", "x-", "y+"]
        ],
    ]
    client, storage = build_client(monkeypatch, payloads)

    response = client.post("/api/laboratory/tasks/TASK-501/experiments/EXP-C/withdraw-current", json={"trayCodes": ["TP-501"]})

    assert response.status_code == 409
    assert "已有完成轴向" in response.json()["detail"]
    updated = storage.read("mes.samples")[0]
    assert updated["status"] == "振动试验部分完成 3/6轴"
    assert updated["trays"][0]["status"] == "振动试验部分完成 3/6轴"
    assert updated["trays"][0]["target_experiment_code"] == "EXP-A"
    assert updated["trays"][0]["target_lab"] == "振动一室"


def test_laboratory_withdraw_current_prefers_staging_origin_over_previous_experiment_partial_axis(monkeypatch):
    sample = sample_with_history(
        "已到达实验室",
        "盐雾试验室",
        [
            {"action": "任务比对", "detail": "TASK-501 / 盐雾试验 / 已到达实验室", "status": "已到达实验室", "location": "盐雾试验室", "time": "2026-06-27T10:35:00"},
            {"action": "暂存间扫码出库", "detail": "TP-501 送至 盐雾试验室", "status": "送至实验室", "location": "盐雾试验室", "time": "2026-06-27T10:30:00"},
            {"action": "暂存间扫码入库", "detail": "TP-501 已到达暂存间", "status": "已到达暂存间", "location": "恒温恒湿间（暂存间）", "time": "2026-06-27T10:20:00"},
            {"action": "实验完成", "detail": "TASK-501 / 振动试验 / 实验已完成", "status": "实验已完成", "location": "振动一室", "time": "2026-06-27T10:00:00"},
        ],
    )
    payloads = base_payloads(
        [sample],
        experiment_trays=[
            {"task_code": "TASK-501", "experiment_code": "EXP-A", "tray_code": "TP-501"},
            {"task_code": "TASK-501", "experiment_code": "EXP-C", "tray_code": "TP-501"},
        ],
        staging_events=[
            {"id": "staging-in-after-vibration", "tray_code": "TP-501", "task_code": "TASK-501", "action": "stock_in", "time": "2026-06-27T10:20:00"},
            {
                "id": "staging-out-to-salt",
                "tray_code": "TP-501",
                "task_code": "TASK-501",
                "action": "stock_out",
                "target_lab": "盐雾试验室",
                "target_experiment_code": "EXP-A",
                "time": "2026-06-27T10:30:00",
            },
        ],
    )
    payloads["mes.experiments"][2] = {
        "task_code": "TASK-501",
        "experiment_code": "EXP-C",
        "experiment_name": "振动试验",
        "status": "实验已完成",
        "axis_codes": ["x+", "x-", "y+", "y-", "z+", "z-"],
    }
    payloads["mes.schedules"] = [
        {"task_code": "TASK-501", "experiment_code": "EXP-A", "device": "盐雾试验室"},
        {
            "id": "schedule-vibration-axis-001",
            "task_code": "TASK-501",
            "experiment_code": "EXP-C",
            "device": "振动一室",
            "status": "实验已完成",
            "axis_codes": ["x+", "x-"],
        },
    ]
    payloads["mes.experiment_runs"] = [
        {
            "run_no": "RUN-VIBRATION-AXIS-001",
            "task_code": "TASK-501",
            "experiment_code": "EXP-C",
            "schedule_id": "schedule-vibration-axis-001",
            "status": "实验已完成",
            "axis_codes": ["x+", "x-"],
            "ended_at": "2026-06-27T10:00:00",
        }
    ]
    payloads["mes.experiment_run_trays"] = [
        {
            "run_no": "RUN-VIBRATION-AXIS-001",
            "task_code": "TASK-501",
            "experiment_code": "EXP-C",
            "tray_code": "TP-501",
            "status": "实验已完成",
            "run_tray_status": "实验已完成",
            "ended_at": "2026-06-27T10:00:00",
        }
    ]
    payloads["mes.experiment_run_steps"] = [
        {
            "run_no": "RUN-VIBRATION-AXIS-001",
            "task_code": "TASK-501",
            "experiment_code": "EXP-C",
            "axis_code": axis_code,
            "status": "实验已完成",
            "ended_at": "2026-06-27T10:00:00",
        }
        for axis_code in ["x+", "x-"]
    ]
    client, storage = build_client(monkeypatch, payloads)

    response = client.post("/api/laboratory/tasks/TASK-501/experiments/EXP-A/withdraw-current", json={"trayCodes": ["TP-501"]})

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


def test_laboratory_withdraw_endpoint_serializes_concurrent_requests(monkeypatch):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Lock
    from time import sleep

    from app.api.routes import laboratory as laboratory_route

    counter_lock = Lock()
    active_calls = 0
    max_active_calls = 0

    def fake_withdraw(task_code, experiment_code, request):
        nonlocal active_calls, max_active_calls
        with counter_lock:
            active_calls += 1
            max_active_calls = max(max_active_calls, active_calls)
        sleep(0.02)
        with counter_lock:
            active_calls -= 1
        return {"ok": True, "taskCode": task_code, "experimentCode": experiment_code}

    monkeypatch.setattr(laboratory_route, "_withdraw_current_experiment", fake_withdraw)
    request = laboratory_route.LaboratoryWithdrawRequest()

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(
            lambda _: laboratory_route.withdraw_current_experiment("TASK-LOCK", "EXP-LOCK", request),
            range(2),
        ))

    assert max_active_calls == 1
    assert results == [
        {"ok": True, "taskCode": "TASK-LOCK", "experimentCode": "EXP-LOCK"},
        {"ok": True, "taskCode": "TASK-LOCK", "experimentCode": "EXP-LOCK"},
    ]


def test_laboratory_withdraw_current_rejects_running_or_finished_states(monkeypatch):
    for blocked_status in ["实验进行中", "实验已完成", "实验后暂存间存放", "厂家收回"]:
        client, storage = build_client(
            monkeypatch,
            base_payloads([sample_with_history(blocked_status, "霉菌试验室", [])]),
        )

        response = client.post("/api/laboratory/tasks/TASK-501/experiments/EXP-B/withdraw-current", json={})

        assert response.status_code == 400
        assert storage.read("mes.samples")[0]["status"] == blocked_status
