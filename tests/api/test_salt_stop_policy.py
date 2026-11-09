"""Only normal early completion remains in the salt stop lifecycle."""
from copy import deepcopy
from contextlib import contextmanager
import sqlite3

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest

from app.api.routes import mq
from app.services import mq_publisher, mq_event_processor
from app.services.laboratory_termination import terminate_storage_laboratory_experiment
from tests.api.test_mq_salt_pause import EventRepository


REQUEST = {"task_code": "TASK-1", "experiment_code": "EXP-1", "lab_code": "LAB_SALT",
           "run_no": "RUN-1", "pause_no": "P-1", "termination_reason": "达到外观终止条件"}


@pytest.mark.parametrize("field", ["termination_type", "terminationType"])
@pytest.mark.parametrize("value", ["abnormal", "", None, "unknown"])
def test_retired_stop_type_is_rejected_before_repository_or_publish(monkeypatch, field, value):
    calls = []
    monkeypatch.setattr(mq, "MySQLMqEventRepository", lambda: calls.append("repository"))
    monkeypatch.setattr(mq, "publish_laboratory_command", lambda *args: calls.append("publish"))
    app = FastAPI()
    app.include_router(mq.router)
    response = TestClient(app).post("/api/mq/laboratory/stop-request", json={**REQUEST, field: value})
    assert response.status_code == 422, response.text
    assert calls == []


@pytest.mark.parametrize("value", ["abnormal", "", None])
def test_publisher_cannot_bypass_normal_stop_policy(monkeypatch, value):
    calls = []
    monkeypatch.setattr(mq_publisher, "record_laboratory_command", lambda *args: calls.append("record"))
    monkeypatch.setattr(mq_publisher, "publish_mqtt_json", lambda *args: calls.append("publish"))
    with pytest.raises(ValueError, match="提前结束仅支持"):
        mq_publisher.publish_laboratory_command("STOP_REQUEST", {**REQUEST, "termination_type": value})
    assert calls == []


@pytest.mark.parametrize("source", ["stored-command", "event-payload"])
def test_stopped_confirmation_cannot_revive_retired_abnormal_branch(source):
    repository = EventRepository({"termination_type": "abnormal" if source == "stored-command" else "completion_criteria",
                                  "termination_reason": "旧客户端命令"})
    payload = {"message_id": "RETIRED-STOP", "lab_code": "LAB_SALT", "run_no": "RUN-1", "pause_no": "P-1"}
    if source == "event-payload":
        payload["termination_type"] = "abnormal"
    with pytest.raises(ValueError, match="提前结束仅支持"):
        mq_event_processor.process_laboratory_event("mes/v1/labs/LAB_SALT/events/experiment-stopped", payload, repository=repository)
    assert repository.stopped == repository.ended == repository.messages == repository.events == []
    assert repository.ids == set()


def test_direct_repository_rejects_abnormal_before_database_io(monkeypatch):
    calls = []
    monkeypatch.setattr(mq_event_processor, "get_connection", lambda: calls.append("database"))
    with pytest.raises(ValueError, match="提前结束仅支持"):
        mq_event_processor.MySQLMqEventRepository().mark_salt_run_stopped("RUN-1", "P-1", "2026-11-09 09:00:00", "abnormal", "旧调用")
    assert calls == []


def test_shared_cancellation_helper_cannot_create_retired_terminal():
    snapshot = {"samples": [], "experiment_runs": []}
    before = deepcopy(snapshot)
    with pytest.raises(ValueError, match="仅支持.*取消"):
        terminate_storage_laboratory_experiment(
            snapshot, task_code="TASK-1", experiment_code="EXP-1", run_no="RUN-1",
            terminal_status="实验异常终止", history_action="异常终止实验", next_experiment_status="实验异常终止",
        )
    assert snapshot == before


@pytest.fixture
def stop_database(monkeypatch):
    database = sqlite3.connect(":memory:")
    database.row_factory = sqlite3.Row
    database.executescript("""
        CREATE TABLE biz_experiment_run(run_no TEXT, schedule_no TEXT, run_status TEXT);
        CREATE TABLE biz_experiment_run_pause(pause_no TEXT, run_no TEXT, pause_status TEXT,
            paused_at TEXT, stopped_at TEXT, pause_seconds INTEGER,
            termination_type TEXT, termination_reason TEXT, updated_at TEXT);
        INSERT INTO biz_experiment_run VALUES ('RUN-1','SCH-1','实验暂停');
        INSERT INTO biz_experiment_run_pause(pause_no,run_no,pause_status,paused_at)
            VALUES ('P-1','RUN-1','实验暂停','2026-11-09 09:00:00');
    """)
    class Cursor:
        def __enter__(self):
            self.cursor = database.cursor()
            return self
        def __exit__(self, *args):
            self.cursor.close()
        def execute(self, sql, params):
            self.cursor.execute(sql.replace("%s", "?").replace("FOR UPDATE", ""), params)
        def fetchone(self):
            row = self.cursor.fetchone()
            return dict(row) if row else None
    class Connection:
        def cursor(self):
            return Cursor()
        def commit(self):
            database.commit()
    @contextmanager
    def connect():
        yield Connection()
    monkeypatch.setattr(mq_event_processor, "get_connection", connect)
    yield database
    database.close()


def test_normal_stop_updates_pause_once_without_creating_abnormal_run(stop_database):
    repository = mq_event_processor.MySQLMqEventRepository()
    repository.mark_salt_run_stopped("RUN-1", "P-1", "2026-11-09 09:30:00", "completion_criteria", "达到终止条件")
    first = dict(stop_database.execute("SELECT * FROM biz_experiment_run_pause").fetchone())
    assert first["pause_status"] == "实验已停止"
    assert first["termination_type"] == "completion_criteria"
    assert first["pause_seconds"] == 1800
    # Ordinary completion is committed by mark_run_ended after this step.
    assert stop_database.execute("SELECT run_status FROM biz_experiment_run").fetchone()[0] == "实验暂停"
    repository.mark_salt_run_stopped("RUN-1", "P-1", "2026-11-09 09:31:00", "completion_criteria", "重复确认")
    assert dict(stop_database.execute("SELECT * FROM biz_experiment_run_pause").fetchone()) == first


def test_old_abnormal_pause_cannot_be_reinterpreted_as_completion(stop_database):
    stop_database.execute("UPDATE biz_experiment_run_pause SET pause_status='实验已停止',termination_type='abnormal'")
    first = dict(stop_database.execute("SELECT * FROM biz_experiment_run_pause").fetchone())
    with pytest.raises(ValueError, match="提前结束仅支持"):
        mq_event_processor.MySQLMqEventRepository().mark_salt_run_stopped("RUN-1", "P-1", "2026-11-09 09:30:00", "completion_criteria", "旧客户端重试")
    assert dict(stop_database.execute("SELECT * FROM biz_experiment_run_pause").fetchone()) == first


def test_normal_early_end_still_follows_request_confirmation_and_shared_completion(monkeypatch, stop_database):
    from tests.api.test_salt_abnormal_late_end import paused_snapshot, SnapshotRepository
    from tests.api.test_storage import FakeStorage

    stop_database.execute("UPDATE biz_experiment_run SET run_no='OLD',schedule_no='S'")
    stop_database.execute("UPDATE biz_experiment_run_pause SET run_no='OLD',pause_no='P'")
    storage = FakeStorage({f"mes.{key}": value for key, value in paused_snapshot().items()})
    monkeypatch.setattr(mq, "get_storage_backend", lambda: storage)
    monkeypatch.setattr(mq_event_processor, "get_storage_backend", lambda: storage)
    monkeypatch.setattr(mq_event_processor, "prepare_completion_updates", lambda *args, **kwargs: {})
    monkeypatch.setattr(mq_event_processor, "apply_mqtt_schedule_cascade", lambda *args, **kwargs: None)
    monkeypatch.setattr(mq_event_processor, "archive_completion_reports", lambda *args, **kwargs: {})
    monkeypatch.setattr(mq_event_processor, "publish_realtime_update", lambda: None)
    commands = []
    class Repository(SnapshotRepository):
        def find_run_by_no(self, run_no):
            self.snapshot = {key.removeprefix("mes."): value for key, value in storage.read_all().items()}
            return super().find_run_by_no(run_no)
        def find_salt_command_payload(self, command, run_no, pause_no):
            return commands[-1][1] if commands and commands[-1][0] == command else {}
        def mark_salt_run_stopped(self, *args):
            mq_event_processor.MySQLMqEventRepository().mark_salt_run_stopped(*args)
            row = stop_database.execute("SELECT * FROM biz_experiment_run_pause").fetchone()
            pauses = storage.read("mes.experiment_run_pauses")
            pauses[0].update(status=row["pause_status"], stopped_at=row["stopped_at"], termination_type=row["termination_type"])
            storage.write("mes.experiment_run_pauses", pauses)
        def mark_run_ended(self, *args):
            mq_event_processor.MySQLMqEventRepository().mark_run_ended(*args)
    repository = Repository(paused_snapshot())
    monkeypatch.setattr(mq, "MySQLMqEventRepository", lambda: repository)
    monkeypatch.setattr(mq, "publish_laboratory_command", lambda command, payload: commands.append((command, payload)) or {"published": True})
    app = FastAPI()
    app.include_router(mq.router)
    response = TestClient(app).post("/api/mq/laboratory/stop-request", json={
        **REQUEST, "task_code": "T", "experiment_code": "E", "run_no": "OLD", "pause_no": "P", "termination_type": "completion_criteria",
    })
    assert response.status_code == 200, response.text
    assert storage.read("mes.experiment_runs")[0]["status"] == "实验暂停"
    payload = {"message_id": "NORMAL-STOP", "lab_code": "LAB_SALT", "run_no": "OLD", "pause_no": "P"}
    ack = mq_event_processor.process_laboratory_event("mes/v1/labs/LAB_SALT/events/experiment-stopped", payload, repository=repository, received_at="2026-11-09 09:30:00")
    assert ack["status"] == "PROCESSED"
    assert storage.read("mes.experiment_runs")[0]["status"] == "实验已完成"
    sample = storage.read("mes.samples")[0]
    assert sample["status"] == "实验后外观检测间存放" and sample["location"] == "外观检测间"
    assert all(entry.get("status") != "实验异常终止" for entry in sample["history"])
    before = storage.read_all()
    duplicate = mq_event_processor.process_laboratory_event("mes/v1/labs/LAB_SALT/events/experiment-stopped", payload, repository=repository)
    assert duplicate["status"] == "DUPLICATE" and storage.read_all() == before
    assert len(commands) == 1
