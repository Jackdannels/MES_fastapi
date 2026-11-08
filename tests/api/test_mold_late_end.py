"""MOLD-001: cancellation stays terminal at ingress and at storage commit."""
from copy import deepcopy

import pytest

from app.services.laboratory_completion import complete_storage_laboratory_experiment
from app.services.laboratory_termination import cancel_storage_mold_experiment
from app.services.mq_event_processor import MySQLMqEventRepository, process_laboratory_event
from app.services.storage_tray_actions import build_stock_in_updates
from test_mq import FakeMqEventRepository
from test_storage import FakeStorage


def running_snapshot():
    return {
        "tasks": [{"code": "T", "status": "任务进行中"}],
        "experiments": [{"task_code": "T", "experiment_code": "E", "experiment_name": "霉菌试验", "status": "实验进行中"}],
        "schedules": [{"id": "S", "task_code": "T", "experiment_code": "E", "device": "霉菌试验室", "status": "实验进行中"}],
        "experiment_runs": [{"run_no": "OLD", "task_code": "T", "experiment_code": "E", "schedule_id": "S", "lab_code": "LAB_MOLD", "device": "霉菌试验室", "status": "实验进行中", "started_at": "2026-11-08 09:00:00"}],
        "experiment_run_trays": [{"run_no": "OLD", "task_code": "T", "experiment_code": "E", "tray_code": "TP", "run_tray_status": "实验进行中"}],
        "experiment_trays": [{"task_code": "T", "experiment_code": "E", "tray_code": "TP"}],
        "experiment_samples": [{"task_code": "T", "experiment_code": "E", "sample_code": "SP"}],
        "samples": [{"code": "SP", "task_code": "T", "status": "实验进行中", "flow_status": "实验进行中", "location": "霉菌试验室", "history": [], "trays": [{"tray_code": "TP", "quantity": 1, "status": "实验进行中", "target_lab": "霉菌试验室", "target_experiment_code": "E", "target_schedule_id": "S"}]}],
        "staging_events": [],
    }


def canceled_snapshot_for_phase(phase):
    snapshot = running_snapshot()
    canceled = cancel_storage_mold_experiment(snapshot, task_code="T", experiment_code="E", run_no="OLD", canceled_at="2026-11-08 10:00:00", cancel_reason="培养异常")
    for key in ["tasks", "experiments", "schedules", "samples"]:
        snapshot[key] = canceled[key]
    snapshot["experiment_runs"] = canceled["experimentRuns"]
    snapshot["experiment_run_trays"] = canceled["experimentRunTrays"]
    if phase == "recovery":
        updates = build_stock_in_updates({f"mes.{key}": value for key, value in snapshot.items()}, room="appearance", tray_code="TP", payload={}, now="2026-11-08 10:10:00")
        snapshot.update({key.removeprefix("mes."): value for key, value in updates.items()})
    elif phase == "new_run":
        snapshot["experiments"][0]["status"] = "实验进行中"
        snapshot["schedules"].append({**running_snapshot()["schedules"][0], "id": "S2"})
        snapshot["experiment_runs"].append({**running_snapshot()["experiment_runs"][0], "run_no": "NEW", "schedule_id": "S2"})
        snapshot["experiment_run_trays"].append({**running_snapshot()["experiment_run_trays"][0], "run_no": "NEW"})
        snapshot["samples"][0].update(status="实验进行中", flow_status="实验进行中")
        snapshot["samples"][0]["trays"][0].update(status="实验进行中", target_schedule_id="S2", target_experiment_code="E", target_lab="霉菌试验室")
    return snapshot


@pytest.fixture(params=["canceled", "recovery", "new_run"])
def canceled_snapshot(request):
    return canceled_snapshot_for_phase(request.param)


class SnapshotRepository(FakeMqEventRepository):
    def __init__(self, snapshot, *, status_field="run_status"):
        super().__init__()
        self.snapshot = deepcopy(snapshot)
        self.status_field = status_field

    def find_run_by_no(self, run_no):
        run = next((run for run in self.snapshot["experiment_runs"] if run["run_no"] == run_no), None)
        if run is None:
            return None
        context = {**run, "task_no": run["task_code"], "experiment_no": run["experiment_code"]}
        context[self.status_field] = context.pop("status")
        return context


@pytest.mark.parametrize("status_field", ["status", "run_status"])
@pytest.mark.parametrize("message_id", ["LATE-END-NEW-ID", ""])
def test_canceled_mold_rejects_late_end_before_consuming_message(canceled_snapshot, status_field, message_id):
    repository = SnapshotRepository(canceled_snapshot, status_field=status_field)
    before = deepcopy(repository.snapshot)
    payload = {"lab_code": "LAB_MOLD", "run_no": "OLD"}
    if message_id:
        payload["message_id"] = message_id

    with pytest.raises(ValueError, match="已取消.*不能改为正常完成"):
        process_laboratory_event("mes/v1/labs/LAB_MOLD/events/experiment-ended", payload, repository=repository, received_at="2026-11-08 12:00:00")

    assert repository.snapshot == before
    assert repository.ended == []
    assert repository.messages == []
    assert repository.events == []
    assert repository.existing_message_ids == set()


def test_shared_completion_preserves_canceled_mold_and_new_run(canceled_snapshot):
    before = deepcopy(canceled_snapshot)

    with pytest.raises(ValueError, match="已取消.*不能改为正常完成"):
        complete_storage_laboratory_experiment(canceled_snapshot, task_code="T", experiment_code="E", run_no="OLD", completed_at="2026-11-08 12:00:00")

    assert canceled_snapshot == before


def test_storage_cancel_wins_over_stale_mqtt_running_context(monkeypatch, canceled_snapshot):
    storage = FakeStorage({f"mes.{key}": value for key, value in canceled_snapshot.items()})
    before = storage.read_all()
    monkeypatch.setattr("app.services.mq_event_processor.get_storage_backend", lambda: storage)
    monkeypatch.setattr(MySQLMqEventRepository, "_storage_snapshot_for_run", lambda self, backend, run_no: (deepcopy(canceled_snapshot), "T"))
    monkeypatch.setattr("app.services.mq_event_processor.prepare_completion_updates", lambda *args, **kwargs: {})
    monkeypatch.setattr("app.services.mq_event_processor.apply_mqtt_schedule_cascade", lambda *args, **kwargs: None)
    monkeypatch.setattr("app.services.mq_event_processor.archive_completion_reports", lambda **kwargs: {})
    monkeypatch.setattr("app.services.mq_event_processor.publish_realtime_update", lambda: None)

    class RacingRepository(SnapshotRepository):
        def find_run_by_no(self, run_no):
            return {**super().find_run_by_no(run_no), "run_status": "实验进行中"}

        def mark_run_ended(self, *args):
            MySQLMqEventRepository().mark_run_ended(*args)

    repository = RacingRepository(canceled_snapshot)
    with pytest.raises(ValueError, match="已取消.*不能改为正常完成"):
        process_laboratory_event("mes/v1/labs/LAB_MOLD/events/experiment-ended", {"message_id": "STALE-END", "lab_code": "LAB_MOLD", "run_no": "OLD"}, repository=repository)

    assert storage.read_all() == before
    assert repository.messages == []
    assert repository.events == []


def test_new_mold_run_can_complete_after_previous_run_was_canceled():
    canceled_snapshot = canceled_snapshot_for_phase("new_run")
    result = complete_storage_laboratory_experiment(canceled_snapshot, task_code="T", experiment_code="E", run_no="NEW", completed_at="2026-11-08 12:00:00")

    assert next(run for run in result["experimentRuns"] if run["run_no"] == "OLD")["status"] == "实验已取消"
    assert next(run for run in result["experimentRuns"] if run["run_no"] == "NEW")["status"] == "实验已完成"
    assert result["experiments"][0]["status"] == "实验已完成"
