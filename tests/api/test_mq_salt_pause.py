from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest

from app.api.routes import mq as mq_route
from app.services.mq_event_processor import MySQLMqEventRepository, process_laboratory_event


class FakeStorage:
    def read(self, key):
        assert key == "mes.experiment_run_trays"
        return [{"run_no": "RUN-1", "tray_code": "TP-1"}]


class FakeRepository:
    def find_run_by_no(self, run_no):
        return {
            "run_no": run_no,
            "task_no": "TASK-1",
            "experiment_no": "EXP-1",
            "lab_code": "LAB_SALT",
            "run_status": "实验进行中",
        }


def test_pause_request_carries_authoritative_inspection_tray_list(monkeypatch):
    published = []
    monkeypatch.setattr(mq_route, "MySQLMqEventRepository", FakeRepository)
    monkeypatch.setattr(mq_route, "get_storage_backend", lambda: FakeStorage())
    monkeypatch.setattr(mq_route, "publish_laboratory_command", lambda command, payload: published.append((command, payload)) or {"published": True})
    app = FastAPI()
    app.include_router(mq_route.router)

    response = TestClient(app).post("/api/mq/laboratory/pause-request", json={
        "task_code": "TASK-1", "lab_code": "LAB_SALT", "experiment_code": "EXP-1", "run_no": "RUN-1",
        "inspection_tray_codes": ["TP-1"], "pause_reason": "外观检查",
    })

    assert response.status_code == 200
    command, payload = published[0]
    assert command == "PAUSE_REQUEST"
    assert payload["inspection_tray_codes"] == ["TP-1"]
    assert payload["pause_no"].startswith("pause-")


def test_pause_request_rejects_non_salt_lab_without_publishing(monkeypatch):
    published = []
    monkeypatch.setattr(mq_route, "publish_laboratory_command", lambda *args: published.append(args))
    app = FastAPI()
    app.include_router(mq_route.router)
    response = TestClient(app).post("/api/mq/laboratory/pause-request", json={
        "task_code": "TASK-1", "lab_code": "LAB_VIBRATION", "experiment_code": "EXP-1", "run_no": "RUN-1",
        "inspection_tray_codes": ["TP-1"], "pause_reason": "外观检查",
    })
    assert response.status_code == 422
    assert published == []


class EventRepository:
    def __init__(self, command_payload):
        self.command_payload = command_payload
        self.messages = []
        self.events = []
        self.paused = []
        self.resumed = []
        self.stopped = []
        self.ended = []
        self.ids = set()

    def message_exists(self, message_id): return message_id in self.ids
    def record_message(self, message): self.ids.add(message["message_id"]); self.messages.append(message); return len(self.messages)
    def record_event(self, event): self.events.append(event)
    def find_run_by_no(self, run_no):
        return {"run_no": run_no, "task_no": "TASK-1", "experiment_no": "EXP-1", "lab_code": "LAB_SALT", "run_status": "实验进行中"}
    def find_active_run_by_lab(self, lab_code): return self.find_run_by_no("RUN-1") if lab_code == "LAB_SALT" else None
    def find_salt_command_payload(self, command, run_no, pause_no): return dict(self.command_payload)
    def mark_salt_run_paused(self, run_no, pause_no, occurred_at, payload): self.paused.append((run_no, pause_no, payload))
    def mark_salt_run_resumed(self, run_no, pause_no, occurred_at): self.resumed.append((run_no, pause_no, occurred_at))
    def mark_salt_run_stopped(self, run_no, pause_no, occurred_at, termination_type, reason): self.stopped.append((termination_type, reason))
    def mark_run_ended(self, run_no, occurred_at, axis_code="", next_axis_code="", sub_experiment_code=""): self.ended.append(run_no)


def test_paused_event_uses_command_tray_list_and_duplicate_is_idempotent(monkeypatch):
    repository = EventRepository({"inspection_tray_codes": ["TP-AUTH"], "pause_reason": "检查"})
    payload = {"message_id": "MSG-PAUSED-1", "lab_code": "LAB_SALT", "run_no": "RUN-1", "pause_no": "PAUSE-1", "inspection_tray_codes": ["TP-UNTRUSTED"]}
    monkeypatch.setattr("app.services.mq_event_processor.publish_realtime_update", lambda: None)
    first = process_laboratory_event("mes/v1/labs/LAB_SALT/events/experiment-paused", payload, repository=repository, received_at="2026-08-12 10:00:00")
    duplicate = process_laboratory_event("mes/v1/labs/LAB_SALT/events/experiment-paused", payload, repository=repository, received_at="2026-08-12 10:01:00")
    assert first["status"] == "PROCESSED"
    assert duplicate["status"] == "DUPLICATE"
    assert repository.paused == [("RUN-1", "PAUSE-1", {"inspection_tray_codes": ["TP-AUTH"], "pause_reason": "检查"})]


def test_stopped_event_keeps_abnormal_separate_from_normal_completion(monkeypatch):
    monkeypatch.setattr("app.services.mq_event_processor.publish_realtime_update", lambda: None)
    monkeypatch.setattr("app.services.mq_event_processor.get_attendance_service", lambda: type("Attendance", (), {"finish_work_interval": lambda *args, **kwargs: None})())
    abnormal = EventRepository({"termination_type": "abnormal", "termination_reason": "设备故障"})
    process_laboratory_event("mes/v1/labs/LAB_SALT/events/experiment-stopped", {"message_id": "STOP-A", "lab_code": "LAB_SALT", "run_no": "RUN-1", "pause_no": "P-1"}, repository=abnormal)
    assert abnormal.ended == []
    normal = EventRepository({"termination_type": "completion_criteria", "termination_reason": "达到终止条件"})
    process_laboratory_event("mes/v1/labs/LAB_SALT/events/experiment-stopped", {"message_id": "STOP-N", "lab_code": "LAB_SALT", "run_no": "RUN-1", "pause_no": "P-1"}, repository=normal)
    assert normal.ended == ["RUN-1"]


def test_pause_event_rejects_other_laboratory_before_transition():
    repository = EventRepository({"inspection_tray_codes": ["TP-1"]})
    with pytest.raises(ValueError, match="仅支持 LAB_SALT"):
        process_laboratory_event("mes/v1/labs/LAB_VIBRATION/events/experiment-paused", {"message_id": "BAD-1", "lab_code": "LAB_VIBRATION", "run_no": "RUN-1", "pause_no": "P-1"}, repository=repository)
    assert repository.paused == []


class PendingCommandCursor:
    def __init__(self, row):
        self.row = row
        self.executions = []
        self.description = None

    def __enter__(self): return self
    def __exit__(self, *args): return False
    def execute(self, sql, params=None):
        self.executions.append((" ".join(sql.split()), params))
        if sql.lstrip().startswith("SELECT"):
            self.description = tuple((key,) for key in (self.row or {}).keys())
        else:
            self.description = None
    def fetchone(self): return self.row


class PendingCommandConnection:
    def __init__(self, row):
        self.cursor_obj = PendingCommandCursor(row)
        self.commits = 0
    def __enter__(self): return self
    def __exit__(self, *args): return False
    def cursor(self): return self.cursor_obj
    def commit(self): self.commits += 1


def test_unexpired_salt_command_still_blocks_retry(monkeypatch):
    connection = PendingCommandConnection({
        "message_log_id": 10, "message_type": "PAUSE_REQUEST",
        "payload_json": '{"run_no":"RUN-1","pause_no":"P-1"}', "pending_seconds": 14,
    })
    monkeypatch.setattr("app.services.mq_event_processor.get_connection", lambda: connection)
    pending = MySQLMqEventRepository().find_pending_salt_command("RUN-1")
    assert pending["command"] == "PAUSE_REQUEST"
    assert connection.commits == 0
    assert len(connection.cursor_obj.executions) == 1


def test_timed_out_salt_command_is_audited_failed_and_allows_retry(monkeypatch):
    connection = PendingCommandConnection({
        "message_log_id": 11, "message_type": "PAUSE_REQUEST",
        "payload_json": '{"run_no":"RUN-1","pause_no":"P-1"}', "pending_seconds": 15,
    })
    monkeypatch.setattr("app.services.mq_event_processor.get_connection", lambda: connection)
    assert MySQLMqEventRepository().find_pending_salt_command("RUN-1") == {}
    update_sql, params = connection.cursor_obj.executions[1]
    assert "process_status='FAILED'" in update_sql
    assert "error_code='CONFIRMATION_TIMEOUT'" in update_sql
    assert params == ("上位机确认超时（15秒）", 11)
    assert connection.commits == 1


def test_confirmed_salt_command_is_not_pending(monkeypatch):
    connection = PendingCommandConnection(None)
    monkeypatch.setattr("app.services.mq_event_processor.get_connection", lambda: connection)
    assert MySQLMqEventRepository().find_pending_salt_command("RUN-1") == {}
    query_sql = connection.cursor_obj.executions[0][0]
    assert "NOT EXISTS" in query_sql
    assert "biz_experiment_event" in query_sql
    assert connection.commits == 0
