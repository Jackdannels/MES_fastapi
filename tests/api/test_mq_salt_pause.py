from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest

from app.api.routes import mq as mq_route
from app.services.attendance_service import AttendanceService, InMemoryAttendanceRepository
from app.services.mq_event_processor import MySQLMqEventRepository, process_laboratory_event


class FakeStorage:
    def read(self, key):
        assert key == "mes.experiment_run_trays"
        return [
            {"run_no": "RUN-1", "tray_code": "TP-2"},
            {"run_no": "RUN-1", "tray_code": "TP-1"},
            {"run_no": "RUN-OTHER", "tray_code": "TP-OTHER"},
        ]


class FakeRepository:
    def find_run_by_no(self, run_no):
        return {
            "run_no": run_no,
            "task_no": "TASK-1",
            "experiment_no": "EXP-1",
            "lab_code": "LAB_SALT",
            "run_status": "实验进行中",
        }


@pytest.mark.parametrize("client_tray_payload", [{}, {"inspection_tray_codes": ["TP-1"]}])
def test_pause_request_uses_every_run_tray_with_or_without_partial_client_selection(monkeypatch, client_tray_payload):
    published = []
    monkeypatch.setattr(mq_route, "MySQLMqEventRepository", FakeRepository)
    monkeypatch.setattr(mq_route, "get_storage_backend", lambda: FakeStorage())
    monkeypatch.setattr(mq_route, "publish_laboratory_command", lambda command, payload: published.append((command, payload)) or {"published": True})
    app = FastAPI()
    app.include_router(mq_route.router)

    response = TestClient(app).post("/api/mq/laboratory/pause-request", json={
        "task_code": "TASK-1", "lab_code": "LAB_SALT", "experiment_code": "EXP-1", "run_no": "RUN-1",
        "pause_reason": "外观检查", **client_tray_payload,
    })

    assert response.status_code == 200
    command, payload = published[0]
    assert command == "PAUSE_REQUEST"
    assert payload["inspection_tray_codes"] == ["TP-1", "TP-2"]
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
        return {"run_no": run_no, "task_no": "TASK-1", "experiment_no": "EXP-1", "lab_code": "LAB_SALT", "device_name": "盐雾试验室", "run_status": "实验进行中"}
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


def test_pause_and_resume_confirmation_stop_and_restart_employee_work_time(monkeypatch):
    calls = []
    attendance = type("Attendance", (), {
        "finish_work_interval": lambda _self, **kwargs: calls.append(("finish", kwargs)),
        "start_work_interval": lambda _self, **kwargs: calls.append(("start", kwargs)),
    })()
    repository = EventRepository({"inspection_tray_codes": ["TP-AUTH"], "pause_reason": "检查"})
    monkeypatch.setattr("app.services.mq_event_processor.get_attendance_service", lambda: attendance)
    monkeypatch.setattr("app.services.mq_event_processor.publish_realtime_update", lambda: None)

    process_laboratory_event(
        "mes/v1/labs/LAB_SALT/events/experiment-paused",
        {"message_id": "MSG-PAUSED-WORK", "lab_code": "LAB_SALT", "run_no": "RUN-1", "pause_no": "PAUSE-1"},
        repository=repository,
        received_at="2026-08-12 10:00:00",
    )
    process_laboratory_event(
        "mes/v1/labs/LAB_SALT/events/experiment-resumed",
        {"message_id": "MSG-RESUMED-WORK", "lab_code": "LAB_SALT", "run_no": "RUN-1", "pause_no": "PAUSE-1"},
        repository=repository,
        received_at="2026-08-12 10:20:00",
    )

    assert calls == [
        ("finish", {"run_no": "RUN-1", "lab_code": "LAB_SALT", "ended_at": "2026-08-12 10:00:00"}),
        ("start", {
            "lab_code": "LAB_SALT", "lab_name": "盐雾试验室", "run_no": "RUN-1",
            "task_code": "TASK-1", "experiment_code": "EXP-1", "source": "mqtt",
            "started_at": "2026-08-12 10:20:00",
        }),
    ]


def test_pause_duration_is_excluded_from_accumulated_employee_work_time(monkeypatch):
    attendance = AttendanceService(repository=InMemoryAttendanceRepository())
    attendance.create_user(
        username="salt-worker", password="pw123", employee_name="盐雾员工", role_name="试验员", active=True,
    )
    attendance.login_lab("盐雾试验室", username="salt-worker", password="pw123", lab_code="LAB_SALT")
    attendance.start_work_interval(
        "盐雾试验室", lab_code="LAB_SALT", run_no="RUN-1", task_code="TASK-1",
        experiment_code="EXP-1", source="mqtt", started_at="2026-08-12 10:00:00",
    )
    repository = EventRepository({"inspection_tray_codes": ["TP-AUTH"], "pause_reason": "检查"})
    monkeypatch.setattr("app.services.mq_event_processor.get_attendance_service", lambda: attendance)
    monkeypatch.setattr("app.services.mq_event_processor.publish_realtime_update", lambda: None)

    process_laboratory_event(
        "mes/v1/labs/LAB_SALT/events/experiment-paused",
        {"message_id": "MSG-PAUSED-TOTAL", "lab_code": "LAB_SALT", "run_no": "RUN-1", "pause_no": "PAUSE-1"},
        repository=repository,
        received_at="2026-08-12 10:20:00",
    )
    process_laboratory_event(
        "mes/v1/labs/LAB_SALT/events/experiment-resumed",
        {"message_id": "MSG-RESUMED-TOTAL", "lab_code": "LAB_SALT", "run_no": "RUN-1", "pause_no": "PAUSE-1"},
        repository=repository,
        received_at="2026-08-12 10:40:00",
    )
    attendance.finish_work_interval(run_no="RUN-1", lab_code="LAB_SALT", ended_at="2026-08-12 11:00:00")

    worker = next(row for row in attendance.list_work_times("2026-08-12") if row["username"] == "salt-worker")
    assert worker["todaySeconds"] == 40 * 60


def test_stopped_event_keeps_abnormal_separate_from_normal_completion(monkeypatch):
    monkeypatch.setattr("app.services.mq_event_processor.publish_realtime_update", lambda: None)
    monkeypatch.setattr("app.services.mq_event_processor.get_attendance_service", lambda: type("Attendance", (), {"finish_work_interval": lambda *args, **kwargs: None})())
    abnormal = EventRepository({"termination_type": "abnormal", "termination_reason": "设备故障"})
    process_laboratory_event("mes/v1/labs/LAB_SALT/events/experiment-stopped", {"message_id": "STOP-A", "lab_code": "LAB_SALT", "run_no": "RUN-1", "pause_no": "P-1"}, repository=abnormal)
    assert abnormal.ended == []
    normal = EventRepository({"termination_type": "completion_criteria", "termination_reason": "达到终止条件"})
    process_laboratory_event("mes/v1/labs/LAB_SALT/events/experiment-stopped", {"message_id": "STOP-N", "lab_code": "LAB_SALT", "run_no": "RUN-1", "pause_no": "P-1"}, repository=normal)
    assert normal.ended == ["RUN-1"]


def test_mysql_abnormal_stop_closes_the_task_scoped_storage_workflow(monkeypatch):
    class TaskScopedStorage:
        def __init__(self):
            self.writes = []
            self.payload = {
                "mes.tasks": [{"code": "TASK-1", "status": "任务进行中"}],
                "mes.samples": [
                    {
                        "code": "SP-1",
                        "task_code": "TASK-1",
                        "status": "等待恢复实验",
                        "flow_status": "等待恢复实验",
                        "location": "盐雾试验室",
                        "trays": [{"tray_code": "TP-1", "status": "等待恢复实验"}],
                        "history": [],
                    }
                ],
                "mes.schedules": [
                    {
                        "id": "SCH-1",
                        "task_code": "TASK-1",
                        "experiment_code": "EXP-1",
                        "status": "实验进行中",
                    }
                ],
                "mes.experiments": [
                    {
                        "task_code": "TASK-1",
                        "experiment_code": "EXP-1",
                        "experiment_name": "盐雾试验",
                        "status": "实验进行中",
                    }
                ],
                "mes.experiment_runs": [
                    {
                        "run_no": "RUN-1",
                        "schedule_id": "SCH-1",
                        "task_code": "TASK-1",
                        "experiment_code": "EXP-1",
                        "status": "实验异常终止",
                    }
                ],
                "mes.experiment_run_trays": [
                    {
                        "run_no": "RUN-1",
                        "task_code": "TASK-1",
                        "experiment_code": "EXP-1",
                        "tray_code": "TP-1",
                        "run_tray_status": "实验进行中",
                    }
                ],
                "mes.experiment_run_steps": [],
                "mes.experiment_trays": [
                    {"task_code": "TASK-1", "experiment_code": "EXP-1", "tray_code": "TP-1"}
                ],
                "mes.experiment_samples": [
                    {"task_code": "TASK-1", "experiment_code": "EXP-1", "sample_code": "SP-1"}
                ],
                "mes.staging_events": [],
            }

        def read_task_scope(self, task_codes, _keys):
            assert set(task_codes) == {"TASK-1"}
            return self.payload

        def write_task_scope(self, updates, *, task_codes):
            self.writes.append((dict(updates), set(task_codes)))

    storage = TaskScopedStorage()
    repository = MySQLMqEventRepository()
    monkeypatch.setattr("app.services.mq_event_processor.get_storage_backend", lambda: storage)
    monkeypatch.setattr(
        repository,
        "find_run_by_no",
        lambda run_no: {
            "run_no": run_no,
            "task_no": "TASK-1",
            "experiment_no": "EXP-1",
        },
    )
    cascades = []
    monkeypatch.setattr(
        "app.services.mq_event_processor.apply_run_schedule_cascade",
        lambda _storage, run, **kwargs: cascades.append((run, kwargs)),
    )

    repository._mark_storage_run_abnormally_stopped(
        run_no="RUN-1",
        occurred_at="2026-08-31 20:11:52",
        reason="设备故障",
    )

    updates, task_codes = storage.writes[0]
    assert task_codes == {"TASK-1"}
    assert updates["mes.experiment_runs"][0]["status"] == "实验异常终止"
    assert updates["mes.experiment_run_trays"][0]["run_tray_status"] == "实验异常终止"
    assert updates["mes.samples"][0]["status"] == "实验异常终止"
    assert updates["mes.samples"][0]["trays"][0]["status"] == "实验异常终止"
    assert updates["mes.experiments"][0]["status"] == "实验异常终止"
    assert updates["mes.schedules"][0]["status"] == "实验异常终止"
    assert cascades[0][1]["reason"] == "盐雾实验异常停止"


def test_mysql_normal_stop_persists_appearance_phase_transition_event(monkeypatch):
    class TaskScopedStorage:
        def __init__(self):
            self.writes = []
            self.payload = {
                "mes.tasks": [],
                "mes.samples": [
                    {
                        "code": "SP-1",
                        "task_code": "TASK-1",
                        "status": "中途外观检查中",
                        "flow_status": "中途外观检查中",
                        "location": "外观检测间",
                        "trays": [{"tray_code": "TP-1", "status": "中途外观检查中"}],
                        "history": [],
                    }
                ],
                "mes.schedules": [],
                "mes.experiments": [],
                "mes.experiment_runs": [
                    {
                        "run_no": "RUN-1",
                        "task_code": "TASK-1",
                        "experiment_code": "EXP-1",
                        "status": "实验暂停",
                    }
                ],
                "mes.experiment_run_pauses": [],
                "mes.experiment_run_trays": [
                    {
                        "run_no": "RUN-1",
                        "task_code": "TASK-1",
                        "experiment_code": "EXP-1",
                        "tray_code": "TP-1",
                        "run_tray_status": "实验暂停",
                    }
                ],
                "mes.experiment_run_steps": [],
                "mes.experiment_trays": [],
                "mes.experiment_samples": [],
                "mes.staging_events": [],
            }

        def read_task_scope(self, task_codes, _keys):
            assert set(task_codes) == {"TASK-1"}
            return self.payload

        def write_task_scope(self, updates, *, task_codes):
            self.writes.append((dict(updates), set(task_codes)))

    storage = TaskScopedStorage()
    repository = MySQLMqEventRepository()
    monkeypatch.setattr("app.services.mq_event_processor.get_storage_backend", lambda: storage)
    monkeypatch.setattr(
        repository,
        "find_run_by_no",
        lambda run_no: {"run_no": run_no, "task_no": "TASK-1", "experiment_no": "EXP-1"},
    )
    monkeypatch.setattr(
        "app.services.mq_event_processor.complete_storage_laboratory_experiment",
        lambda *_args, **_kwargs: {
            "samples": storage.payload["mes.samples"],
            "experiments": [],
            "schedules": [],
            "experimentRuns": storage.payload["mes.experiment_runs"],
            "experimentRunTrays": storage.payload["mes.experiment_run_trays"],
            "stagingEvents": [
                {
                    "tray_code": "TP-1",
                    "room": "appearance",
                    "action": "stock_in",
                    "appearance_phase": "post_experiment",
                    "source": "experiment_completion",
                }
            ],
        },
    )
    monkeypatch.setattr("app.services.mq_event_processor.apply_mqtt_schedule_cascade", lambda *_args, **_kwargs: None)
    monkeypatch.setattr("app.services.mq_event_processor.archive_completion_reports", lambda **_kwargs: None)

    repository.mark_run_ended("RUN-1", "2026-08-31 10:10:00")

    updates, task_codes = storage.writes[0]
    assert task_codes == {"TASK-1"}
    assert updates["mes.staging_events"] == [
        {
            "tray_code": "TP-1",
            "room": "appearance",
            "action": "stock_in",
            "appearance_phase": "post_experiment",
            "source": "experiment_completion",
        }
    ]


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
