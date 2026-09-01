from app.services.laboratory_occupancy import (
    LABORATORY_OCCUPANCY_RUNS_KEY,
    LABORATORY_OCCUPANCY_RUN_TRAYS_KEY,
    LABORATORY_OCCUPANCY_SAMPLES_KEY,
    find_laboratory_occupancy,
    find_laboratory_occupancy_in_snapshot,
)


def sample(tray_code: str, *, location: str, status: str, **tray_fields):
    return {
        "task_code": "TASK-RUN",
        "location": location,
        "status": status,
        "trays": [{"tray_code": tray_code, "status": status, **tray_fields}],
    }


def run(*, status: str, started_at: str = "2026-08-30 09:00:00"):
    return {
        "run_no": "RUN-1",
        "task_code": "TASK-RUN",
        "experiment_code": "EXP-1",
        "schedule_id": "SCHEDULE-1",
        "device": "冲击一室",
        "status": status,
        "started_at": started_at,
    }


def relation(*, status: str):
    return {
        "run_no": "RUN-1",
        "task_code": "TASK-RUN",
        "experiment_code": "EXP-1",
        "tray_code": "TRAY-RUN",
        "run_tray_status": status,
    }


def find(*, run_status: str, tray_status: str, location: str = "冲击一室", started_at: str = "2026-08-30 09:00:00"):
    return find_laboratory_occupancy(
        target_lab_name="冲击一室",
        samples=[sample("TRAY-RUN", location=location, status=tray_status)],
        experiment_runs=[run(status=run_status, started_at=started_at)],
        experiment_run_trays=[relation(status=run_status)],
    )


def test_running_experiment_occupies_laboratory_while_its_tray_remains_inside():
    occupancy = find(run_status="实验进行中", tray_status="实验进行中")

    assert occupancy is not None
    assert occupancy.task_code == "TASK-RUN"
    assert occupancy.run_no == "RUN-1"
    assert occupancy.tray_code == "TRAY-RUN"


def test_completed_experiment_still_occupies_laboratory_until_tray_leaves():
    occupancy = find(run_status="实验已完成", tray_status="实验已完成")

    assert occupancy is not None
    assert occupancy.run_status == "实验已完成"


def test_started_run_blocks_even_when_sample_state_update_still_says_ready():
    occupancy = find(run_status="实验进行中", tray_status="实验准备就绪")

    assert occupancy is not None


def test_pre_start_run_allows_multiple_trays_to_enter_laboratory():
    occupancy = find(run_status="实验准备就绪", tray_status="实验准备就绪", started_at="")

    assert occupancy is None


def test_started_run_releases_laboratory_after_tray_moves_to_next_location():
    occupancy = find(
        run_status="实验已完成",
        tray_status="已到达暂存间",
        location="恒温恒湿间（暂存间）",
    )

    assert occupancy is None


def test_historical_target_lab_does_not_keep_completed_tray_locked_after_push_out():
    pushed_out_sample = sample(
        "TRAY-RUN",
        location="恒温恒湿间（暂存间）",
        status="实验后暂存间存放",
        target_lab="冲击一室",
    )

    occupancy = find_laboratory_occupancy(
        target_lab_name="冲击一室",
        samples=[pushed_out_sample],
        experiment_runs=[run(status="实验已完成")],
        experiment_run_trays=[relation(status="实验已完成")],
    )

    assert occupancy is None


def test_historical_run_does_not_lock_tray_that_reentered_same_lab_for_a_new_schedule():
    current_sample = sample(
        "TRAY-RUN",
        location="冲击一室",
        status="实验准备就绪",
        target_experiment_code="EXP-2",
        target_schedule_id="SCHEDULE-2",
    )

    occupancy = find_laboratory_occupancy(
        target_lab_name="冲击一室",
        samples=[current_sample],
        experiment_runs=[run(status="实验已完成")],
        experiment_run_trays=[relation(status="实验已完成")],
    )

    assert occupancy is None


def test_snapshot_lookup_prefers_global_occupancy_aliases_over_scoped_rows():
    snapshot = {
        "mes.samples": [],
        "mes.experiment_runs": [],
        "mes.experiment_run_trays": [],
        LABORATORY_OCCUPANCY_SAMPLES_KEY: [
            sample("TRAY-RUN", location="冲击一室", status="实验已完成")
        ],
        LABORATORY_OCCUPANCY_RUNS_KEY: [run(status="实验已完成")],
        LABORATORY_OCCUPANCY_RUN_TRAYS_KEY: [relation(status="实验已完成")],
    }

    occupancy = find_laboratory_occupancy_in_snapshot(
        snapshot,
        target_lab_name="冲击一室",
    )

    assert occupancy is not None
    assert occupancy.task_code == "TASK-RUN"


def test_incoming_tray_can_be_excluded_for_mid_experiment_return():
    occupancy = find_laboratory_occupancy(
        target_lab_name="冲击一室",
        samples=[sample("TRAY-RUN", location="冲击一室", status="实验暂停")],
        experiment_runs=[run(status="实验暂停")],
        experiment_run_trays=[relation(status="实验暂停")],
        excluded_tray_code="TRAY-RUN",
    )

    assert occupancy is None
