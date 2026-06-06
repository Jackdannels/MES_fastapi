import pytest

from app.services.laboratory_completion import complete_storage_laboratory_experiment
from app.services.laboratory_start import start_storage_laboratory_experiment


def _sample(code, task_code, tray_code, status, location=""):
    return {
        "code": code,
        "task_code": task_code,
        "status": status,
        "flow_status": status,
        "location": location,
        "trays": [{"tray_code": tray_code, "status": status}],
        "history": [],
    }


def test_start_ignores_stale_sample_returned_status_when_current_experiment_tray_is_active():
    snapshot = {
        "tasks": [{"code": "TASK-1", "status": "任务进行中"}],
        "experiments": [{"task_code": "TASK-1", "experiment_code": "EXP-A", "experiment_name": "盐雾试验"}],
        "schedules": [{"id": "SCH-A", "task_code": "TASK-1", "experiment_code": "EXP-A", "device": "盐雾试验室"}],
        "experiment_runs": [],
        "experiment_run_trays": [
            {
                "run_no": "RUN-OLD-B",
                "task_code": "TASK-1",
                "experiment_code": "EXP-B",
                "tray_code": "TP-1",
                "run_tray_status": "厂家收回",
            }
        ],
        "experiment_trays": [{"task_code": "TASK-1", "experiment_code": "EXP-A", "tray_code": "TP-1"}],
        "samples": [_sample("SP-1", "TASK-1", "TP-1", "厂家收回", "厂家收回")],
    }
    snapshot["samples"][0]["trays"][0]["status"] = "实验准备就绪"

    result = start_storage_laboratory_experiment(
        snapshot,
        task_code="TASK-1",
        experiment_code="EXP-A",
        run_no="RUN-A",
        lab_name="盐雾试验室",
        schedule_id="SCH-A",
        tray_codes=["TP-1"],
        started_at="2026-06-06 09:00:00",
    )

    assert result["affectedTrayCodes"] == ["TP-1"]
    assert result["samples"][0]["status"] == "实验进行中"
    assert result["samples"][0]["trays"][0]["status"] == "实验进行中"
    assert result["experimentRunTrays"][-1]["experiment_code"] == "EXP-A"


def test_start_does_not_apply_returned_state_from_another_sample_to_requested_tray():
    returned_sample = {
        "code": "SP-RETURNED",
        "task_code": "TASK-1",
        "status": "厂家收回",
        "flow_status": "厂家收回",
        "location": "厂家收回",
        "trays": [
            {"tray_code": "TP-R1", "status": "厂家收回"},
            {"tray_code": "TP-R2", "status": "厂家收回"},
        ],
        "history": [],
    }
    active_sample = _sample("SP-ACTIVE", "TASK-1", "TP-A", "实验准备就绪", "盐雾试验室")
    snapshot = {
        "tasks": [{"code": "TASK-1", "status": "任务进行中"}],
        "experiments": [{"task_code": "TASK-1", "experiment_code": "EXP-A", "experiment_name": "盐雾试验"}],
        "schedules": [{"id": "SCH-A", "task_code": "TASK-1", "experiment_code": "EXP-A", "device": "盐雾试验室"}],
        "experiment_runs": [],
        "experiment_run_trays": [],
        "experiment_trays": [{"task_code": "TASK-1", "experiment_code": "EXP-A", "tray_code": "TP-A"}],
        "samples": [returned_sample, active_sample],
    }

    result = start_storage_laboratory_experiment(
        snapshot,
        task_code="TASK-1",
        experiment_code="EXP-A",
        run_no="RUN-A",
        lab_name="盐雾试验室",
        schedule_id="SCH-A",
        tray_codes=["TP-A"],
        started_at="2026-06-06 09:00:00",
    )

    assert result["affectedTrayCodes"] == ["TP-A"]
    assert result["samples"][1]["trays"][0]["status"] == "实验进行中"


def test_start_scopes_requested_trays_to_current_experiment_assignment():
    snapshot = {
        "tasks": [{"code": "TASK-1", "status": "任务进行中"}],
        "experiments": [{"task_code": "TASK-1", "experiment_code": "EXP-A", "experiment_name": "盐雾试验"}],
        "schedules": [{"id": "SCH-A", "task_code": "TASK-1", "experiment_code": "EXP-A", "device": "盐雾试验室"}],
        "experiment_runs": [],
        "experiment_run_trays": [],
        "experiment_trays": [
            {"task_code": "TASK-1", "experiment_code": "EXP-A", "tray_code": "TP-A"},
            {"task_code": "TASK-1", "experiment_code": "EXP-B", "tray_code": "TP-B"},
        ],
        "samples": [
            _sample("SP-A", "TASK-1", "TP-A", "实验准备就绪", "盐雾试验室"),
            _sample("SP-B", "TASK-1", "TP-B", "实验准备就绪", "霉菌试验室"),
        ],
    }

    result = start_storage_laboratory_experiment(
        snapshot,
        task_code="TASK-1",
        experiment_code="EXP-A",
        run_no="RUN-A",
        lab_name="盐雾试验室",
        schedule_id="SCH-A",
        tray_codes=["TP-A", "TP-B"],
        started_at="2026-06-06 09:00:00",
    )

    assert result["affectedTrayCodes"] == ["TP-A"]
    assert result["samples"][0]["trays"][0]["status"] == "实验进行中"
    assert result["samples"][1]["trays"][0]["status"] == "实验准备就绪"
    assert [item["tray_code"] for item in result["experimentRunTrays"]] == ["TP-A"]


def test_start_rejects_ambiguous_legacy_sample_without_experiment_sample_relation():
    snapshot = {
        "tasks": [{"code": "TASK-1", "status": "任务进行中"}],
        "experiments": [{"task_code": "TASK-1", "experiment_code": "EXP-A", "experiment_name": "盐雾试验"}],
        "schedules": [{"id": "SCH-A", "task_code": "TASK-1", "experiment_code": "EXP-A", "device": "盐雾试验室"}],
        "experiment_runs": [],
        "experiment_run_trays": [],
        "experiment_trays": [
            {"task_code": "TASK-1", "experiment_code": "EXP-A", "tray_code": "TP-1"},
            {"task_code": "TASK-1", "experiment_code": "EXP-B", "tray_code": "TP-1"},
        ],
        "experiment_samples": [],
        "samples": [_sample("SP-1", "TASK-1", "TP-1", "实验准备就绪", "盐雾试验室")],
    }

    with pytest.raises(ValueError, match="current experiment has no matching tray samples"):
        start_storage_laboratory_experiment(
            snapshot,
            task_code="TASK-1",
            experiment_code="EXP-A",
            run_no="RUN-A",
            lab_name="盐雾试验室",
            schedule_id="SCH-A",
            tray_codes=["TP-1"],
            started_at="2026-06-06 09:00:00",
        )


def test_complete_scopes_requested_trays_to_current_experiment_assignment():
    snapshot = {
        "experiments": [{"task_code": "TASK-1", "experiment_code": "EXP-A", "experiment_name": "盐雾试验"}],
        "schedules": [{"id": "SCH-A", "task_code": "TASK-1", "experiment_code": "EXP-A", "device": "盐雾试验室"}],
        "experiment_runs": [
            {
                "run_no": "RUN-A",
                "task_code": "TASK-1",
                "experiment_code": "EXP-A",
                "tray_codes": ["TP-A"],
                "status": "实验进行中",
            }
        ],
        "experiment_run_trays": [
            {
                "run_no": "RUN-A",
                "task_code": "TASK-1",
                "experiment_code": "EXP-A",
                "tray_code": "TP-A",
                "run_tray_status": "实验进行中",
            }
        ],
        "experiment_trays": [
            {"task_code": "TASK-1", "experiment_code": "EXP-A", "tray_code": "TP-A"},
            {"task_code": "TASK-1", "experiment_code": "EXP-B", "tray_code": "TP-B"},
        ],
        "samples": [
            _sample("SP-A", "TASK-1", "TP-A", "实验进行中", "盐雾试验室"),
            _sample("SP-B", "TASK-1", "TP-B", "实验进行中", "霉菌试验室"),
        ],
    }

    result = complete_storage_laboratory_experiment(
        snapshot,
        task_code="TASK-1",
        experiment_code="EXP-A",
        run_no="RUN-A",
        tray_codes=["TP-A", "TP-B"],
        completed_at="2026-06-06 10:00:00",
    )

    assert result["affectedTrayCodes"] == ["TP-A"]
    assert result["samples"][0]["trays"][0]["status"] == "实验已完成"
    assert result["samples"][1]["trays"][0]["status"] == "实验进行中"
    assert result["experimentRunTrays"][0]["tray_code"] == "TP-A"


def test_complete_rejects_ambiguous_legacy_sample_without_experiment_sample_relation():
    snapshot = {
        "experiments": [{"task_code": "TASK-1", "experiment_code": "EXP-A", "experiment_name": "盐雾试验"}],
        "schedules": [{"id": "SCH-A", "task_code": "TASK-1", "experiment_code": "EXP-A", "device": "盐雾试验室"}],
        "experiment_runs": [
            {
                "run_no": "RUN-A",
                "task_code": "TASK-1",
                "experiment_code": "EXP-A",
                "tray_codes": ["TP-1"],
                "status": "实验进行中",
            }
        ],
        "experiment_run_trays": [
            {
                "run_no": "RUN-A",
                "task_code": "TASK-1",
                "experiment_code": "EXP-A",
                "tray_code": "TP-1",
                "run_tray_status": "实验进行中",
            }
        ],
        "experiment_trays": [
            {"task_code": "TASK-1", "experiment_code": "EXP-A", "tray_code": "TP-1"},
            {"task_code": "TASK-1", "experiment_code": "EXP-B", "tray_code": "TP-1"},
        ],
        "experiment_samples": [],
        "samples": [_sample("SP-1", "TASK-1", "TP-1", "实验进行中", "盐雾试验室")],
    }

    with pytest.raises(ValueError, match="current experiment has no matching tray samples"):
        complete_storage_laboratory_experiment(
            snapshot,
            task_code="TASK-1",
            experiment_code="EXP-A",
            run_no="RUN-A",
            tray_codes=["TP-1"],
            completed_at="2026-06-06 10:00:00",
        )


def test_complete_rejects_trays_outside_current_experiment_assignment():
    snapshot = {
        "experiments": [{"task_code": "TASK-1", "experiment_code": "EXP-A", "experiment_name": "盐雾试验"}],
        "schedules": [],
        "experiment_runs": [],
        "experiment_run_trays": [],
        "experiment_trays": [
            {"task_code": "TASK-1", "experiment_code": "EXP-A", "tray_code": "TP-A"},
            {"task_code": "TASK-1", "experiment_code": "EXP-B", "tray_code": "TP-B"},
        ],
        "samples": [_sample("SP-B", "TASK-1", "TP-B", "实验进行中", "霉菌试验室")],
    }

    with pytest.raises(ValueError, match="current experiment has no matching tray samples"):
        complete_storage_laboratory_experiment(
            snapshot,
            task_code="TASK-1",
            experiment_code="EXP-A",
            tray_codes=["TP-B"],
            completed_at="2026-06-06 10:00:00",
        )
