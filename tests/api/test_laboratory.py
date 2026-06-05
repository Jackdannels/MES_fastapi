from copy import deepcopy

from fastapi import FastAPI
from fastapi.testclient import TestClient


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
        "mes.experiment_trays": experiment_trays
        or [{"task_code": "TASK-501", "experiment_code": "EXP-B", "tray_code": "TP-501"}],
        "mes.experiment_samples": [],
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
    assert storage.read("mes.samples")[0]["trays"][0]["status"] == "实验已完成"
    assert storage.read("mes.samples")[1]["trays"][0]["status"] == "实验准备就绪"
    assert storage.read("mes.experiments")[0]["status"] == "实验进行中"
    assert storage.read("mes.schedules")[0]["status"] == "实验进行中"
    assert storage.read("mes.experiment_runs")[0]["status"] == "实验已完成"
    assert storage.read("mes.experiment_runs")[1]["status"] == "实验准备就绪"


def test_laboratory_complete_experiment_infers_batch_trays_from_run_when_tray_codes_omitted(monkeypatch):
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
            "started_at": "",
            "ended_at": "2026-05-19 10:00:00",
            "created_at": "2026-05-19 10:00:00",
            "updated_at": "2026-05-19 10:00:00",
        }
    ]


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
    for blocked_status in ["实验进行中", "实验已完成", "放置实验后暂存间", "厂家收回"]:
        client, storage = build_client(
            monkeypatch,
            base_payloads([sample_with_history(blocked_status, "霉菌试验室", [])]),
        )

        response = client.post("/api/laboratory/tasks/TASK-501/experiments/EXP-B/withdraw-current", json={})

        assert response.status_code == 400
        assert storage.read("mes.samples")[0]["status"] == blocked_status
