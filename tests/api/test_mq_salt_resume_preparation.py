from copy import deepcopy

from fastapi import HTTPException
import pytest

import app.api.routes.mq as mq_route
from app.services.salt_spray_resume_preparation import apply_salt_resume_preparation_operation
from tests.services.test_salt_spray_resume_preparation import _snapshot
from tests.api.test_laboratory import build_client
from tests.api.test_mq import FakeMqEventRepository
from app.services.mq_event_processor import process_laboratory_event
from app.services.fixture_installations import PENDING


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


def _preparation_payload(operation, **extra):
    return {
        "operation_type": operation, "task_code": "TASK-1", "experiment_code": "EXP-SALT-1",
        "run_no": "RUN-SALT-1", "pause_no": "PAUSE-1", "lab_code": "LAB_SALT",
        "tray_codes": ["TP-1"], "fixture_install_id": "FIX-RESUME-1", **extra,
    }


@pytest.fixture
def installed_resume_preparation(monkeypatch):
    snapshot = _snapshot()
    snapshot.update({
        "tasks": [{"code": "TASK-1", "status": "任务进行中"}],
        "experiments": [{"task_code": "TASK-1", "experiment_code": "EXP-SALT-1", "experiment_name": "盐雾试验", "status": "实验进行中"}],
        "schedules": [{"id": "SCHEDULE-1", "task_code": "TASK-1", "experiment_code": "EXP-SALT-1", "device": "盐雾试验室", "status": "实验进行中"}],
        "experiment_trays": [{"task_code": "TASK-1", "experiment_code": "EXP-SALT-1", "tray_code": "TP-1"}],
        "experiment_run_trays": [{"run_no": "RUN-SALT-1", "task_code": "TASK-1", "experiment_code": "EXP-SALT-1", "tray_code": "TP-1", "run_tray_status": "实验暂停"}],
    })
    client, storage = build_client(monkeypatch, {f"mes.{key}": value for key, value in snapshot.items()})
    for operation in ["start", "compare", "install"]:
        response = client.post("/api/laboratory/salt-resume-preparation", json=_preparation_payload(operation))
        assert response.status_code == 200, response.json()
    return client, storage


@pytest.mark.parametrize("operation", ["fixtureReady", "fixture_ready", " fixtureReady "])
@pytest.mark.parametrize("field", ["operation_type", "operationType"])
def test_resume_http_cannot_forge_fixture_confirmation(monkeypatch, installed_resume_preparation, operation, field):
    client, storage = installed_resume_preparation
    before = deepcopy(storage.read_all())
    published = []
    monkeypatch.setattr("app.api.routes.laboratory.publish_storage_update", lambda *args, **kwargs: published.append(args))
    payload = _preparation_payload(operation, source="mqtt")
    payload[field] = payload.pop("operation_type")

    response = client.post("/api/laboratory/salt-resume-preparation", json=payload)

    assert response.status_code == 409
    assert "MQTT" in response.json()["detail"]
    assert storage.read_all() == before
    assert published == []


def test_rejected_http_fixture_confirmation_does_not_unlock_resume(monkeypatch, installed_resume_preparation):
    client, storage = installed_resume_preparation
    before = deepcopy(storage.read_all())

    response = client.post("/api/laboratory/salt-resume-preparation", json=_preparation_payload("fixtureReady"))
    assert response.status_code == 409
    ready = client.post("/api/laboratory/salt-resume-preparation", json=_preparation_payload("ready"))
    assert ready.status_code == 409
    assert storage.read_all() == before

    published = []
    monkeypatch.setattr(mq_route, "MySQLMqEventRepository", _Repository)
    monkeypatch.setattr(mq_route, "get_storage_backend", lambda: storage)
    monkeypatch.setattr(mq_route, "publish_laboratory_command", lambda command, payload: published.append((command, payload)) or {"published": True})
    request = mq_route.SaltResumeRequest(task_code="TASK-1", experiment_code="EXP-SALT-1", lab_code="LAB_SALT", run_no="RUN-SALT-1", pause_no="PAUSE-1")

    with pytest.raises(HTTPException, match="尚未完成重新比对"):
        mq_route.publish_salt_resume_request(request)
    assert published == []
    assert storage.read_all() == before


def test_matching_mqtt_fixture_confirmation_still_unlocks_prepared_resume(monkeypatch, installed_resume_preparation):
    client, storage = installed_resume_preparation
    repository = FakeMqEventRepository()
    installation = {
        "fixture_install_id": "FIX-RESUME-1", "task_code": "TASK-1", "experiment_code": "EXP-SALT-1",
        "schedule_id": "SCHEDULE-1", "sub_experiment_code": "", "lab_code": "LAB_SALT", "tray_codes": ["TP-1"], "status": PENDING,
    }
    monkeypatch.setattr("app.services.mq_event_processor.find_fixture_installation", lambda fixture_id: installation if fixture_id == installation["fixture_install_id"] else None)
    monkeypatch.setattr("app.services.fixture_installations.get_storage_backend", lambda: storage)
    marked_ready = []
    monkeypatch.setattr("app.services.mq_event_processor.mark_fixture_installation_ready", lambda fixture_id: marked_ready.append(fixture_id) or True)
    monkeypatch.setattr("app.services.mq_event_processor.publish_realtime_update", lambda: None)
    payload = {"message_id": "VALID-RESUME-FIXTURE", "lab_code": "LAB_SALT", "fixture_install_id": "FIX-RESUME-1"}

    ack = process_laboratory_event("mes/v1/labs/LAB_SALT/events/fixture-ready", payload, repository=repository)

    assert ack["status"] == "PROCESSED"
    assert marked_ready == ["FIX-RESUME-1"]
    assert storage.read("mes.samples")[0]["trays"][0]["fixture_ready"] is True
    evidence = [event for event in storage.read("mes.staging_events") if event.get("action") == "resume_preparation_fixture_ready"]
    assert len(evidence) == 1
    assert evidence[0]["pause_no"] == "PAUSE-1"
    assert evidence[0]["fixture_install_id"] == "FIX-RESUME-1"

    before_duplicate = deepcopy(storage.read_all())
    duplicate = process_laboratory_event("mes/v1/labs/LAB_SALT/events/fixture-ready", payload, repository=repository)
    assert duplicate["status"] == "DUPLICATE"
    assert storage.read_all() == before_duplicate

    ready = client.post("/api/laboratory/salt-resume-preparation", json=_preparation_payload("ready"))
    assert ready.status_code == 200, ready.json()
    assert storage.read("mes.experiment_runs")[0]["status"] == "实验暂停"

    published = []
    monkeypatch.setattr(mq_route, "MySQLMqEventRepository", _Repository)
    monkeypatch.setattr(mq_route, "get_storage_backend", lambda: storage)
    monkeypatch.setattr(mq_route, "publish_laboratory_command", lambda command, payload: published.append((command, payload)) or {"published": True})
    request = mq_route.SaltResumeRequest(task_code="TASK-1", experiment_code="EXP-SALT-1", lab_code="LAB_SALT", run_no="RUN-SALT-1", pause_no="PAUSE-1")
    assert mq_route.publish_salt_resume_request(request)["published"] is True
    assert published[0][0] == "RESUME_REQUEST"
