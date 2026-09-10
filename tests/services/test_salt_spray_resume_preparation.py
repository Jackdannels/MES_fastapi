import pytest

import app.services.fixture_installations as fixture_installations
from app.services.salt_spray_resume_preparation import (
    RESUME_PREPARATION_FIXTURE_READY,
    RESUME_PREPARATION_READY,
    apply_salt_resume_confirmation,
    apply_salt_resume_preparation_operation,
    validate_salt_early_stop_allowed,
    validate_salt_resume_preparation_ready,
)


def _snapshot():
    return {
        "experiment_runs": [{
            "run_no": "RUN-SALT-1", "task_code": "TASK-1", "experiment_code": "EXP-SALT-1",
            "device": "盐雾试验室", "status": "实验暂停",
        }],
        "experiment_run_pauses": [{
            "pause_no": "PAUSE-1", "run_no": "RUN-SALT-1", "task_code": "TASK-1",
            "experiment_code": "EXP-SALT-1", "lab_code": "LAB_SALT", "status": "实验暂停",
            "inspection_tray_codes": ["TP-1"],
        }],
        "samples": [{
            "code": "SP-1", "task_code": "TASK-1", "location": "盐雾试验室",
            "status": "等待恢复实验", "flow_status": "等待恢复实验", "history": [],
            "trays": [{"tray_code": "TP-1", "status": "等待恢复实验"}],
        }],
        "staging_events": [{
            "id": "appearance-out-1", "action": "stock_out", "appearance_phase": "mid_experiment",
            "pause_no": "PAUSE-1", "room": "appearance", "run_no": "RUN-SALT-1",
            "target_lab": "盐雾试验室", "target_lab_code": "LAB_SALT", "tray_code": "TP-1",
            "time": "2026-09-03 10:00:00",
        }],
    }


def _apply(snapshot, operation, *, fixture_install_id=""):
    result = apply_salt_resume_preparation_operation(
        snapshot,
        operation_type=operation,
        task_code="TASK-1",
        experiment_code="EXP-SALT-1",
        run_no="RUN-SALT-1",
        pause_no="PAUSE-1",
        lab_code="LAB_SALT",
        tray_codes=["TP-1"],
        occurred_at="2026-09-03 10:01:00",
        fixture_install_id=fixture_install_id,
    )
    return {**snapshot, "samples": result["samples"], "staging_events": result["stagingEvents"]}, result


def test_resume_preparation_is_ordered_idempotent_and_keeps_original_run():
    snapshot, started = _apply(_snapshot(), "start")
    assert started["resumePreparationAction"] == "resume_preparation_started"

    with pytest.raises(ValueError, match="步骤顺序"):
        _apply(snapshot, "install")

    snapshot, compared = _apply(snapshot, "compare")
    snapshot, installed = _apply(snapshot, "install", fixture_install_id="FIX-RESUME-1")
    snapshot, fixture_ready = _apply(snapshot, "fixtureReady", fixture_install_id="FIX-RESUME-1")
    snapshot, ready = _apply(snapshot, "ready")

    assert fixture_ready["resumePreparationAction"] == RESUME_PREPARATION_FIXTURE_READY
    assert ready["resumePreparationAction"] == RESUME_PREPARATION_READY
    assert snapshot["experiment_runs"][0]["run_no"] == "RUN-SALT-1"
    assert snapshot["samples"][0]["history"][0]["action"] == "继续实验准备确认"
    validate_salt_resume_preparation_ready(snapshot, snapshot["experiment_run_pauses"][0])

    same_snapshot, duplicate = _apply(snapshot, "ready")
    assert duplicate["affectedSampleCount"] == 0
    assert len(same_snapshot["staging_events"]) == len(snapshot["staging_events"])


def test_resume_is_rejected_until_ready_evidence_exists_for_every_pause_tray():
    snapshot, _ = _apply(_snapshot(), "start")
    with pytest.raises(ValueError, match="尚未完成重新比对"):
        validate_salt_resume_preparation_ready(snapshot, snapshot["experiment_run_pauses"][0])


def test_early_stop_is_rejected_once_resume_comparison_is_complete():
    snapshot, _ = _apply(_snapshot(), "start")
    validate_salt_early_stop_allowed(snapshot, snapshot["experiment_run_pauses"][0])

    snapshot, _ = _apply(snapshot, "compare")

    with pytest.raises(ValueError, match="不能再提前结束"):
        validate_salt_early_stop_allowed(snapshot, snapshot["experiment_run_pauses"][0])


def test_resume_preparation_rejects_a_non_salt_run_even_when_pause_payload_claims_salt():
    snapshot = _snapshot()
    snapshot["experiment_runs"][0]["device"] = "霉菌试验室"

    with pytest.raises(ValueError, match="不处于可继续准备"):
        _apply(snapshot, "start")


def test_fixture_ready_ack_persists_current_pause_fixture_evidence(monkeypatch):
    snapshot, _ = _apply(_snapshot(), "start")
    snapshot, _ = _apply(snapshot, "compare")
    snapshot, _ = _apply(snapshot, "install", fixture_install_id="FIX-RESUME-1")
    captured = {}

    def run_atomic(**kwargs):
        result = kwargs["operation"](snapshot)
        captured.update(result)
        return result

    monkeypatch.setattr(fixture_installations, "run_atomic_laboratory_operation", run_atomic)
    monkeypatch.setattr(fixture_installations, "get_storage_backend", lambda: object())

    fixture_installations.apply_pending_fixture_ready({
        "fixture_install_id": "FIX-RESUME-1",
        "task_code": "TASK-1",
        "experiment_code": "EXP-SALT-1",
        "schedule_id": "SCHEDULE-1",
        "lab_code": "LAB_SALT",
        "tray_codes": ["TP-1"],
    }, "2026-09-03 10:02:00")

    assert captured["resumePreparationAction"] == RESUME_PREPARATION_FIXTURE_READY
    assert captured["samples"][0]["trays"][0]["fixture_ready"] is True


def test_resume_confirmation_returns_prepared_samples_to_running_without_replacing_history():
    snapshot = _snapshot()
    snapshot["samples"].append({
        "code": "SP-OTHER",
        "task_code": "TASK-OTHER",
        "location": "其他试验室",
        "status": "实验已完成",
        "flow_status": "实验已完成",
        "history": [],
        "trays": [{"tray_code": "TP-1", "status": "实验已完成"}],
    })
    for operation in ("start", "compare", "install", "fixtureReady", "ready"):
        snapshot, _ = _apply(snapshot, operation, fixture_install_id="FIX-RESUME-1")
    original_history_count = len(snapshot["samples"][0]["history"])

    result = apply_salt_resume_confirmation(
        snapshot,
        pause=snapshot["experiment_run_pauses"][0],
        occurred_at="2026-09-03 10:10:00",
    )

    sample = result["samples"][0]
    assert sample["status"] == "实验进行中"
    assert sample["flow_status"] == "实验进行中"
    assert sample["trays"][0]["status"] == "实验进行中"
    assert sample["history"][0]["action"] == "继续实验"
    assert len(sample["history"]) == original_history_count + 1
    assert result["samples"][1]["status"] == "实验已完成"
    assert result["samples"][1]["trays"][0]["status"] == "实验已完成"
