from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.routes import mq as mq_route
from app.services.mq_publisher import build_laboratory_topic


def build_client(monkeypatch):
    published = []

    def fake_publish(command, payload):
        published.append({"command": command, "payload": dict(payload)})
        return {"published": True, "reason": "", "topic": "test-topic"}

    monkeypatch.setattr(mq_route, "publish_laboratory_command", fake_publish)
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
