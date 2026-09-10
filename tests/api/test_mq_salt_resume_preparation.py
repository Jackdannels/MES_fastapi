from fastapi import HTTPException
import pytest

import app.api.routes.mq as mq_route
from app.services.salt_spray_resume_preparation import apply_salt_resume_preparation_operation
from tests.services.test_salt_spray_resume_preparation import _snapshot


class _Repository:
    def find_run_by_no(self, _run_no):
        return {
            "run_no": "RUN-SALT-1", "task_no": "TASK-1", "experiment_no": "EXP-SALT-1",
            "lab_code": "LAB_SALT", "run_status": "实验暂停",
        }

    def find_pending_salt_command(self, _run_no):
        return None


class _Storage:
    def __init__(self, snapshot):
        self.snapshot = snapshot

    def read_all(self):
        return {
            "mes.experiment_runs": self.snapshot["experiment_runs"],
            "mes.experiment_run_pauses": self.snapshot["experiment_run_pauses"],
            "mes.samples": self.snapshot["samples"],
            "mes.staging_events": self.snapshot["staging_events"],
        }

    def read(self, key):
        return self.read_all().get(key, [])


def _advance(snapshot, operation):
    result = apply_salt_resume_preparation_operation(
        snapshot,
        operation_type=operation,
        task_code="TASK-1",
        experiment_code="EXP-SALT-1",
        run_no="RUN-SALT-1",
        pause_no="PAUSE-1",
        lab_code="LAB_SALT",
        tray_codes=["TP-1"],
    )
    return {**snapshot, "samples": result["samples"], "staging_events": result["stagingEvents"]}


def test_resume_request_requires_all_current_pause_preparation_evidence(monkeypatch):
    snapshot = _advance(_snapshot(), "start")
    storage = _Storage(snapshot)
    published = []
    monkeypatch.setattr(mq_route, "MySQLMqEventRepository", _Repository)
    monkeypatch.setattr(mq_route, "get_storage_backend", lambda: storage)
    monkeypatch.setattr(mq_route, "require_mqtt_laboratory", lambda *args, **kwargs: None)
    monkeypatch.setattr(mq_route, "publish_laboratory_command", lambda command, payload: published.append((command, payload)) or {"published": True})
    request = mq_route.SaltResumeRequest(
        task_code="TASK-1", experiment_code="EXP-SALT-1", lab_code="LAB_SALT",
        run_no="RUN-SALT-1", pause_no="PAUSE-1",
    )

    with pytest.raises(HTTPException, match="尚未完成重新比对"):
        mq_route.publish_salt_resume_request(request)
    assert published == []

    for operation in ("compare", "install", "fixtureReady", "ready"):
        snapshot = _advance(snapshot, operation)
    storage.snapshot = snapshot

    result = mq_route.publish_salt_resume_request(request)
    assert result["published"] is True
    assert published == [("RESUME_REQUEST", {
        "task_code": "TASK-1", "experiment_code": "EXP-SALT-1", "lab_code": "LAB_SALT",
        "run_no": "RUN-SALT-1", "pause_no": "PAUSE-1",
    })]


def test_stop_request_is_rejected_after_current_pause_resume_comparison(monkeypatch):
    snapshot = _advance(_snapshot(), "start")
    snapshot = _advance(snapshot, "compare")
    storage = _Storage(snapshot)
    published = []
    monkeypatch.setattr(mq_route, "MySQLMqEventRepository", _Repository)
    monkeypatch.setattr(mq_route, "get_storage_backend", lambda: storage)
    monkeypatch.setattr(mq_route, "require_mqtt_laboratory", lambda *args, **kwargs: None)
    monkeypatch.setattr(
        mq_route,
        "publish_laboratory_command",
        lambda command, payload: published.append((command, payload)) or {"published": True},
    )
    request = mq_route.SaltStopRequest(
        task_code="TASK-1",
        experiment_code="EXP-SALT-1",
        lab_code="LAB_SALT",
        run_no="RUN-SALT-1",
        pause_no="PAUSE-1",
        termination_type="completion_criteria",
        termination_reason="达到外观检查终止条件",
    )

    with pytest.raises(HTTPException, match="不能再提前结束") as error:
        mq_route.publish_salt_stop_request(request)

    assert error.value.status_code == 409
    assert published == []


def test_stop_request_still_publishes_before_resume_comparison(monkeypatch):
    snapshot = _advance(_snapshot(), "start")
    storage = _Storage(snapshot)
    published = []
    monkeypatch.setattr(mq_route, "MySQLMqEventRepository", _Repository)
    monkeypatch.setattr(mq_route, "get_storage_backend", lambda: storage)
    monkeypatch.setattr(mq_route, "require_mqtt_laboratory", lambda *args, **kwargs: None)
    monkeypatch.setattr(
        mq_route,
        "publish_laboratory_command",
        lambda command, payload: published.append((command, payload)) or {"published": True},
    )
    request = mq_route.SaltStopRequest(
        task_code="TASK-1",
        experiment_code="EXP-SALT-1",
        lab_code="LAB_SALT",
        run_no="RUN-SALT-1",
        pause_no="PAUSE-1",
        termination_type="completion_criteria",
        termination_reason="达到外观检查终止条件",
    )

    result = mq_route.publish_salt_stop_request(request)

    assert result["published"] is True
    assert published[0][0] == "STOP_REQUEST"
