import pytest

from app.services.experiment_schedule_sequence import (
    ExperimentScheduleSequenceError,
    assert_common_next_scheduled_step,
    assert_expected_next_scheduled_step,
    resolve_next_scheduled_step,
)


def sequence_snapshot() -> dict:
    return {
        "schedules": [
            {
                "id": "SCH-A",
                "task_code": "TASK-1",
                "experiment_code": "EXP-A",
                "device": "盐雾试验间",
                "lab_code": "LAB-A",
                "start_at": "2099-03-01 09:00:00",
            },
            {
                "id": "SCH-B",
                "task_code": "TASK-1",
                "experiment_code": "EXP-B",
                "device": "霉菌试验间",
                "lab_code": "LAB-B",
                "start_at": "2099-03-01 10:00:00",
            },
            {
                "id": "SCH-C",
                "task_code": "TASK-1",
                "experiment_code": "EXP-C",
                "device": "冲击试验间",
                "lab_code": "LAB-C",
                "start_at": "2099-03-01 11:00:00",
            },
        ],
        "experiment_trays": [
            {"task_code": "TASK-1", "experiment_code": code, "tray_code": tray}
            for tray in ("TRAY-1", "TRAY-2")
            for code in ("EXP-A", "EXP-B", "EXP-C")
        ],
        "experiment_runs": [],
        "experiment_run_trays": [],
    }


def complete(snapshot: dict, schedule_id: str, experiment_code: str, tray_code: str) -> None:
    run_no = f"RUN-{schedule_id}-{tray_code}"
    snapshot["experiment_runs"].append(
        {
            "run_no": run_no,
            "schedule_id": schedule_id,
            "task_code": "TASK-1",
            "experiment_code": experiment_code,
        }
    )
    snapshot["experiment_run_trays"].append(
        {
            "run_no": run_no,
            "task_code": "TASK-1",
            "experiment_code": experiment_code,
            "tray_code": tray_code,
            "run_tray_status": "实验已完成",
        }
    )


def test_future_start_at_only_orders_steps_and_does_not_block_execution() -> None:
    snapshot = sequence_snapshot()

    step = assert_expected_next_scheduled_step(
        snapshot,
        task_code="TASK-1",
        tray_code="TRAY-1",
        schedule_id="SCH-A",
        experiment_code="EXP-A",
    )

    assert step["schedule_id"] == "SCH-A"
    assert step["start_at"] == "2099-03-01 09:00:00"


def test_only_immediate_next_schedule_is_allowed() -> None:
    snapshot = sequence_snapshot()

    with pytest.raises(ExperimentScheduleSequenceError, match="必须先执行排程 SCH-A"):
        assert_expected_next_scheduled_step(
            snapshot,
            task_code="TASK-1",
            tray_code="TRAY-1",
            schedule_id="SCH-C",
            experiment_code="EXP-C",
        )


def test_completed_a_advances_to_b_but_not_c() -> None:
    snapshot = sequence_snapshot()
    complete(snapshot, "SCH-A", "EXP-A", "TRAY-1")

    assert resolve_next_scheduled_step(snapshot, task_code="TASK-1", tray_code="TRAY-1")["schedule_id"] == "SCH-B"
    with pytest.raises(ExperimentScheduleSequenceError, match="必须先执行排程 SCH-B"):
        assert_expected_next_scheduled_step(
            snapshot,
            task_code="TASK-1",
            tray_code="TRAY-1",
            schedule_id="SCH-C",
        )


def test_each_tray_advances_independently_and_mixed_steps_are_rejected() -> None:
    snapshot = sequence_snapshot()
    complete(snapshot, "SCH-A", "EXP-A", "TRAY-1")

    with pytest.raises(ExperimentScheduleSequenceError, match="下一排程不一致"):
        assert_common_next_scheduled_step(
            snapshot,
            task_code="TASK-1",
            tray_codes=["TRAY-1", "TRAY-2"],
        )


def test_out_of_order_completion_requires_task_data_reset() -> None:
    snapshot = sequence_snapshot()
    complete(snapshot, "SCH-B", "EXP-B", "TRAY-1")

    with pytest.raises(ExperimentScheduleSequenceError, match="重置任务数据"):
        resolve_next_scheduled_step(snapshot, task_code="TASK-1", tray_code="TRAY-1")


def test_completion_without_schedule_identity_does_not_advance() -> None:
    snapshot = sequence_snapshot()
    snapshot["experiment_runs"].append(
        {"run_no": "RUN-LEGACY", "task_code": "TASK-1", "experiment_code": "EXP-A"}
    )
    snapshot["experiment_run_trays"].append(
        {
            "run_no": "RUN-LEGACY",
            "task_code": "TASK-1",
            "experiment_code": "EXP-A",
            "tray_code": "TRAY-1",
            "run_tray_status": "实验已完成",
        }
    )

    assert resolve_next_scheduled_step(snapshot, task_code="TASK-1", tray_code="TRAY-1")["schedule_id"] == "SCH-A"


def test_equal_start_at_uses_schedule_identity_as_stable_second_key() -> None:
    snapshot = sequence_snapshot()
    snapshot["schedules"][0]["start_at"] = "2099-03-01 09:00:00"
    snapshot["schedules"][1]["start_at"] = "2099-03-01 09:00:00"
    snapshot["schedules"][0]["id"] = "SCH-002"
    snapshot["schedules"][1]["id"] = "SCH-001"

    step = resolve_next_scheduled_step(snapshot, task_code="TASK-1", tray_code="TRAY-1")

    assert step["schedule_id"] == "SCH-001"
    assert step["experiment_code"] == "EXP-B"


def test_same_experiment_multiple_schedules_advance_by_exact_schedule_identity() -> None:
    snapshot = {
        "schedules": [
            {"id": "SCH-SEG-1", "task_code": "TASK-SEG", "experiment_code": "EXP-SEG", "sub_experiment_code": "SEG-1", "device": "冲击一室", "start_at": "2099-01-01 09:00:00"},
            {"id": "SCH-SEG-2", "task_code": "TASK-SEG", "experiment_code": "EXP-SEG", "sub_experiment_code": "SEG-2", "device": "冲击一室", "start_at": "2099-01-01 10:00:00"},
        ],
        "experiment_trays": [
            {"task_code": "TASK-SEG", "experiment_code": "EXP-SEG", "tray_code": "TRAY-SEG"}
        ],
        "experiment_runs": [
            {"run_no": "RUN-SEG-1", "schedule_id": "SCH-SEG-1", "task_code": "TASK-SEG", "experiment_code": "EXP-SEG", "sub_experiment_code": "SEG-1"}
        ],
        "experiment_run_trays": [
            {"run_no": "RUN-SEG-1", "task_code": "TASK-SEG", "experiment_code": "EXP-SEG", "sub_experiment_code": "SEG-1", "tray_code": "TRAY-SEG", "run_tray_status": "实验已完成"}
        ],
    }

    step = resolve_next_scheduled_step(snapshot, task_code="TASK-SEG", tray_code="TRAY-SEG")

    assert step["schedule_id"] == "SCH-SEG-2"
    assert step["sub_experiment_code"] == "SEG-2"
