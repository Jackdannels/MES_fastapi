"""Legacy STAB-SALT-03 data stays read-only after the abnormal branch was retired."""
from copy import deepcopy

import pytest

from app.services.laboratory_completion import complete_storage_laboratory_experiment
from app.services.mq_event_processor import MySQLMqEventRepository, process_laboratory_event
from tests.api.test_mq import FakeMqEventRepository
from tests.api.test_storage import FakeStorage


TOPIC = "mes/v1/labs/LAB_SALT/events/experiment-ended"
STOP_TIME = "2026-11-09 08:47:49"
END_TIME = "2026-11-09 08:47:53"
ERROR = "异常终止.*不能改为正常完成"


def paused_snapshot():
    return {
        "tasks": [{"code": "T", "status": "任务进行中", "test_type": "盐雾试验"}],
        "experiments": [{"task_code": "T", "experiment_code": "E", "experiment_name": "盐雾试验", "required_device": "盐雾试验", "axis_codes": [], "status": "实验进行中"}],
        "schedules": [{"id": "S", "task_code": "T", "experiment_code": "E", "device": "盐雾试验室", "status": "实验进行中"}],
        "experiment_runs": [{"run_no": "OLD", "task_code": "T", "experiment_code": "E", "schedule_id": "S", "lab_code": "LAB_SALT", "device": "盐雾试验室", "status": "实验暂停", "started_at": "2026-11-09 07:00:00"}],
        "experiment_run_pauses": [{"pause_no": "P", "run_no": "OLD", "task_code": "T", "experiment_code": "E", "lab_code": "LAB_SALT", "status": "实验暂停", "inspection_tray_codes": ["TP"], "paused_at": "2026-11-09 08:00:00"}],
        "experiment_run_trays": [{"run_no": "OLD", "task_code": "T", "experiment_code": "E", "tray_code": "TP", "run_tray_status": "实验进行中"}],
        "experiment_trays": [{"task_code": "T", "experiment_code": "E", "tray_code": "TP"}],
        "experiment_samples": [{"task_code": "T", "experiment_code": "E", "sample_code": "SP"}],
        "samples": [{"code": "SP", "task_code": "T", "status": "中途外观检查中", "flow_status": "中途外观检查中", "location": "外观检测间", "history": [], "trays": [{"tray_code": "TP", "quantity": 1, "status": "中途外观检查中"}]}],
        "staging_events": [{"task_code": "T", "tray_code": "TP", "room": "appearance", "action": "stock_in", "appearance_phase": "mid_experiment", "run_no": "OLD", "pause_no": "P", "time": "2026-11-09 08:40:00"}],
    }


def terminated_snapshot(phase="stopped"):
    snapshot = paused_snapshot()
    # Historical database fixture only: the active API/service can no longer
    # create this state, but old results must never become normal completion.
    for key in ("experiments", "schedules", "experiment_runs", "experiment_run_trays"):
        for row in snapshot[key]:
            row["status"] = "实验异常终止"
            if key == "experiment_run_trays":
                row["run_tray_status"] = "实验异常终止"
            if key in {"experiment_runs", "experiment_run_trays"}:
                row["ended_at"] = STOP_TIME
    sample = snapshot["samples"][0]
    sample["status"] = sample["flow_status"] = sample["trays"][0]["status"] = "实验异常终止"
    sample["history"] = [{"action": "异常终止实验", "status": "实验异常终止",
                          "detail": "T / 盐雾试验 / 实验异常终止", "location": "外观检测间", "time": STOP_TIME}]
    snapshot["experiment_run_pauses"][0].update(status="实验已停止", stopped_at=STOP_TIME, termination_type="abnormal")
    if phase in {"rescheduled", "new_run"}:
        snapshot["experiments"][0]["status"] = "待排程" if phase == "rescheduled" else "实验进行中"
        snapshot["schedules"].append({**paused_snapshot()["schedules"][0], "id": "S2", "status": "已排程"})
    if phase == "new_run":
        snapshot["experiment_runs"].append({**paused_snapshot()["experiment_runs"][0], "run_no": "NEW", "schedule_id": "S2", "status": "实验进行中"})
        snapshot["experiment_run_trays"].append({**paused_snapshot()["experiment_run_trays"][0], "run_no": "NEW"})
        snapshot["samples"][0].update(status="实验进行中", flow_status="实验进行中", location="盐雾试验室")
        snapshot["samples"][0]["trays"][0].update(status="实验进行中", target_schedule_id="S2")
    return snapshot


class SnapshotRepository(FakeMqEventRepository):
    def __init__(self, snapshot, status_field="run_status"):
        super().__init__()
        self.snapshot = deepcopy(snapshot)
        self.status_field = status_field

    def find_run_by_no(self, run_no):
        run = next((row for row in self.snapshot["experiment_runs"] if row["run_no"] == run_no), None)
        if not run:
            return None
        context = {**run, "task_no": run["task_code"], "experiment_no": run["experiment_code"]}
        context[self.status_field] = context.pop("status")
        return context


@pytest.mark.parametrize("phase", ["stopped", "rescheduled", "new_run"])
@pytest.mark.parametrize("status_field", ["status", "run_status"])
@pytest.mark.parametrize("message_id", ["LATE-NEW-ID", ""])
def test_salt03_late_ended_cannot_overwrite_abnormal_terminal_or_new_run(phase, status_field, message_id):
    repository = SnapshotRepository(terminated_snapshot(phase), status_field)
    before = deepcopy(repository.snapshot)
    payload = {"lab_code": "LAB_SALT", "run_no": "OLD"}
    if message_id:
        payload["message_id"] = message_id
    with pytest.raises(ValueError, match=ERROR):
        process_laboratory_event(TOPIC, payload, repository=repository, received_at=END_TIME)
    assert repository.snapshot == before
    assert repository.messages == repository.events == repository.ended == repository.results == []
    assert repository.existing_message_ids == set()


@pytest.mark.parametrize("phase", ["stopped", "rescheduled", "new_run"])
def test_salt03_shared_completion_rejects_abnormal_run_without_side_effects(phase):
    snapshot = terminated_snapshot(phase)
    before = deepcopy(snapshot)
    with pytest.raises(ValueError, match=ERROR):
        complete_storage_laboratory_experiment(snapshot, task_code="T", experiment_code="E", run_no="OLD", completed_at=END_TIME)
    assert snapshot == before


@pytest.mark.parametrize("axis_code", ["", "x"])
def test_salt03_commit_rechecks_terminal_after_ingress_read_paused_state(monkeypatch, axis_code):
    snapshot = terminated_snapshot("new_run")
    storage = FakeStorage({f"mes.{key}": value for key, value in snapshot.items()})
    before = storage.read_all()
    monkeypatch.setattr("app.services.mq_event_processor.get_storage_backend", lambda: storage)
    monkeypatch.setattr(MySQLMqEventRepository, "_storage_snapshot_for_run", lambda self, backend, run_no: (deepcopy(snapshot), "T"))
    side_effects = []
    for name in ("prepare_completion_updates", "write_laboratory_updates", "apply_mqtt_schedule_cascade", "archive_completion_reports", "publish_realtime_update"):
        monkeypatch.setattr("app.services.mq_event_processor."+name, lambda *args, **kwargs: side_effects.append((args, kwargs)))

    class RacingRepository(SnapshotRepository):
        def find_run_by_no(self, run_no):
            return {**super().find_run_by_no(run_no), "run_status": "实验暂停"}

        def mark_run_ended(self, *args):
            MySQLMqEventRepository().mark_run_ended(*args)

    repository = RacingRepository(snapshot)
    with pytest.raises(ValueError, match=ERROR):
        process_laboratory_event(TOPIC, {"message_id": "STALE-END", "lab_code": "LAB_SALT", "run_no": "OLD", "axis_code": axis_code}, repository=repository)
    assert storage.read_all() == before
    assert side_effects == []
    assert repository.messages == repository.events == []


def test_salt03_processed_message_replay_remains_duplicate():
    repository = SnapshotRepository(terminated_snapshot())
    repository.existing_message_ids.add("ALREADY-SEEN")
    before = deepcopy(repository.snapshot)
    ack = process_laboratory_event(TOPIC, {"message_id": "ALREADY-SEEN", "lab_code": "LAB_SALT", "run_no": "OLD"}, repository=repository)
    assert ack["status"] == "DUPLICATE"
    assert repository.snapshot == before
    assert not repository.messages and not repository.events


def test_salt03_new_run_still_completes_after_old_abnormal_stop():
    snapshot = terminated_snapshot("new_run")
    result = complete_storage_laboratory_experiment(snapshot, task_code="T", experiment_code="E", run_no="NEW", completed_at=END_TIME)
    runs = {run["run_no"]: run for run in result["experimentRuns"]}
    assert runs["OLD"]["status"] == "实验异常终止"
    assert runs["NEW"]["status"] == "实验已完成"
    assert result["samples"][0]["status"] == "实验已完成"
    assert snapshot["experiment_run_pauses"][0]["termination_type"] == "abnormal"


def test_salt03_normal_early_completion_from_paused_run_still_succeeds():
    snapshot = paused_snapshot()
    snapshot["experiment_run_pauses"][0].update(status="实验已停止", termination_type="completion_criteria")
    result = complete_storage_laboratory_experiment(snapshot, task_code="T", experiment_code="E", run_no="OLD", completed_at=END_TIME)
    assert result["experimentRuns"][0]["status"] == "实验已完成"
    assert result["samples"][0]["status"] == "实验后外观检测间存放"
    assert result["samples"][0]["location"] == "外观检测间"


