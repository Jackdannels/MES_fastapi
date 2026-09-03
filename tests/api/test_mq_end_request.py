from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.routes import mq as mq_route
from app.services.mq_publisher import build_laboratory_topic


def build_client(monkeypatch, *, repository=None, storage=None):
    published = []

    def fake_publish(command, payload):
        published.append({"command": command, "payload": dict(payload)})
        return {"published": True, "reason": "", "topic": "test-topic"}

    monkeypatch.setattr(mq_route, "publish_laboratory_command", fake_publish)
    if repository is not None:
        monkeypatch.setattr(mq_route, "MySQLMqEventRepository", lambda: repository)
    if storage is not None:
        monkeypatch.setattr(mq_route, "get_storage_backend", lambda: storage)
    app = FastAPI()
    app.include_router(mq_route.router)
    return TestClient(app), published


def test_experiment_end_request_publishes_current_run_context(monkeypatch):
    client, published = build_client(monkeypatch)

    response = client.post(
        "/api/mq/laboratory/end-request",
        json={
            "task_code": "SYLU-2026-07-001",
            "lab_code": "LAB_SALT",
            "experiment_code": "SYLU-2026-07-001-B",
            "subExperimentCode": "SYLU-2026-07-001-B-SALT",
            "runNo": "RUN-SALT-001",
            "axisCode": "x+",
            "nextAxisCode": "x-",
        },
    )

    assert response.status_code == 200
    assert response.json()["ok"] is True
    assert published == [
        {
            "command": "END_REQUEST",
            "payload": {
                "task_code": "SYLU-2026-07-001",
                "lab_code": "LAB_SALT",
                "experiment_code": "SYLU-2026-07-001-B",
                "sub_experiment_code": "SYLU-2026-07-001-B-SALT",
                "run_no": "RUN-SALT-001",
                "axis_code": "x+",
                "next_axis_code": "x-",
            },
        }
    ]


def test_experiment_end_request_allows_hot_humid_laboratory_two(monkeypatch):
    client, published = build_client(monkeypatch)

    response = client.post(
        "/api/mq/laboratory/end-request",
        json={
            "task_code": "TASK-HH2",
            "lab_code": "LAB_HOT_HUMID_2",
            "experiment_code": "EXP-HH2",
            "run_no": "RUN-HH2",
        },
    )

    assert response.status_code == 200
    assert published == [
        {
            "command": "END_REQUEST",
            "payload": {
                "task_code": "TASK-HH2",
                "lab_code": "LAB_HOT_HUMID_2",
                "experiment_code": "EXP-HH2",
                "run_no": "RUN-HH2",
            },
        }
    ]


def test_end_request_command_uses_dedicated_mqtt_topic():
    assert build_laboratory_topic("END_REQUEST", "LAB_SALT").endswith(
        "/labs/LAB_SALT/commands/experiment-end-request"
    )


class MoldCancelRepository:
    def __init__(self, *, lab_code="LAB_MOLD", run_status="实验进行中", pending=False):
        self.run = {
            "run_no": "RUN-MOLD-001",
            "task_no": "TASK-MOLD",
            "experiment_no": "EXP-MOLD",
            "schedule_no": "SCH-MOLD",
            "device_name": "霉菌试验室",
            "lab_code": lab_code,
            "run_status": run_status,
        }
        self.pending = pending

    def find_run_by_no(self, run_no):
        return self.run if run_no == self.run["run_no"] else None

    def find_pending_mold_cancel(self, _run_no):
        return {"end_mode": "cancel"} if self.pending else {}


class MoldCancelStorage:
    def read_task_scope(self, _task_codes, _keys):
        return {
            "mes.experiments": [
                {
                    "task_code": "TASK-MOLD",
                    "experiment_code": "EXP-MOLD",
                    "experiment_name": "霉菌试验",
                }
            ],
            "mes.experiment_run_trays": [
                {
                    "run_no": "RUN-MOLD-001",
                    "task_code": "TASK-MOLD",
                    "experiment_code": "EXP-MOLD",
                    "tray_code": tray_code,
                    "run_tray_status": "实验进行中",
                }
                for tray_code in ("TP-1", "TP-2")
            ],
        }


def test_mold_cancel_request_publishes_end_request_with_cancel_identity(monkeypatch):
    client, published = build_client(
        monkeypatch,
        repository=MoldCancelRepository(),
        storage=MoldCancelStorage(),
    )
    monkeypatch.setattr(mq_route, "uuid4", lambda: type("Uuid", (), {"hex": "cancel-identity"})())

    response = client.post(
        "/api/mq/laboratory/cancel-request",
        json={
            "task_code": "TASK-MOLD",
            "lab_code": "LAB_MOLD",
            "experiment_code": "EXP-MOLD",
            "runNo": "RUN-MOLD-001",
            "cancelReason": "霉菌未按预期繁殖",
        },
    )

    assert response.status_code == 200
    assert response.json()["cancelRequestId"] == "cancel-cancel-identity"
    assert published == [
        {
            "command": "END_REQUEST",
            "payload": {
                "task_code": "TASK-MOLD",
                "lab_code": "LAB_MOLD",
                "experiment_code": "EXP-MOLD",
                "run_no": "RUN-MOLD-001",
                "end_mode": "cancel",
                "cancel_reason": "霉菌未按预期繁殖",
                "cancel_request_id": "cancel-cancel-identity",
            },
        }
    ]


def test_mold_cancel_request_rejects_other_laboratory_without_publish(monkeypatch):
    client, published = build_client(monkeypatch)

    response = client.post(
        "/api/mq/laboratory/cancel-request",
        json={
            "task_code": "TASK-MOLD",
            "lab_code": "LAB_SALT",
            "experiment_code": "EXP-MOLD",
            "run_no": "RUN-MOLD-001",
            "cancel_reason": "取消",
        },
    )

    assert response.status_code == 422
    assert published == []
