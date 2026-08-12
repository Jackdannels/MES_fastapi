from copy import deepcopy
from datetime import datetime

from app.core.mysql_storage_loaders import load_schedules
from app.core.mysql_storage_mappers import build_schedule_insert_row, build_storage_schedule_item
from app.services.schedule_cascade import (
    LOCKED_CONFLICT,
    MAINTENANCE_CONFLICT,
    plan_same_lab_schedule_cascade,
)


def schedule_snapshot() -> dict:
    return {
        "schedules": [
            {
                "id": "SCH-A",
                "task_code": "TASK-A",
                "experiment_code": "EXP-A",
                "lab_code": "LAB-SALT",
                "device": "盐雾试验室",
                "start_at": "2026-08-10 01:30:00",
                "end_at": "2026-08-10 02:30:00",
                "status": "实验进行中",
            },
            {
                "id": "SCH-B",
                "task_code": "TASK-B",
                "experiment_code": "EXP-B",
                "lab_code": "LAB-SALT",
                "device": "盐雾试验室",
                "start_at": "2026-08-10 02:40:00",
                "end_at": "2026-08-10 03:40:00",
                "status": "已排程",
            },
            {
                "id": "SCH-C",
                "task_code": "TASK-C",
                "experiment_code": "EXP-C",
                "lab_code": "LAB-SALT",
                "device": "盐雾试验室",
                "start_at": "2026-08-10 04:00:00",
                "end_at": "2026-08-10 05:30:00",
                "status": "已排程",
            },
            {
                "id": "SCH-OTHER",
                "task_code": "TASK-D",
                "experiment_code": "EXP-D",
                "lab_code": "LAB-MOLD",
                "device": "霉菌试验室",
                "start_at": "2026-08-10 02:35:00",
                "end_at": "2026-08-10 03:35:00",
                "status": "已排程",
            },
        ],
        "devices": [],
        "samples": [],
        "experiment_trays": [],
        "experiment_runs": [],
        "experiment_run_trays": [],
        "experiment_run_steps": [],
    }


def apply_updates(snapshot: dict, updates: list[dict]) -> None:
    updates_by_id = {item["id"]: item for item in updates}
    snapshot["schedules"] = [deepcopy(updates_by_id.get(item["id"], item)) for item in snapshot["schedules"]]


def test_delay_cascades_only_same_lab_and_preserves_original_gaps_and_durations() -> None:
    result = plan_same_lab_schedule_cascade(
        schedule_snapshot(),
        current_schedule_id="SCH-A",
        new_end_at="2026-08-10 03:20:00",
        reason="当前实验超时",
        source_run_no="RUN-A",
    )

    assert result["conflicts"] == []
    updates = {item["id"]: item for item in result["updates"]}
    assert set(updates) == {"SCH-B", "SCH-C"}
    assert (updates["SCH-B"]["start_at"], updates["SCH-B"]["end_at"]) == (
        "2026-08-10 03:30:00",
        "2026-08-10 04:30:00",
    )
    assert (updates["SCH-C"]["start_at"], updates["SCH-C"]["end_at"]) == (
        "2026-08-10 04:50:00",
        "2026-08-10 06:20:00",
    )
    assert updates["SCH-B"]["original_start_at"] == "2026-08-10 02:40:00"
    assert updates["SCH-B"]["original_end_at"] == "2026-08-10 03:40:00"
    assert updates["SCH-B"]["delay_minutes"] == 50
    assert updates["SCH-B"]["delay_reason"] == "当前实验超时"
    assert updates["SCH-B"]["source_run_no"] == "RUN-A"


def test_recalculation_uses_original_gap_without_accumulating_it() -> None:
    snapshot = schedule_snapshot()
    first = plan_same_lab_schedule_cascade(
        snapshot,
        current_schedule_id="SCH-A",
        new_end_at="2026-08-10 03:20:00",
        reason="预计超时",
    )
    apply_updates(snapshot, first["updates"])

    second = plan_same_lab_schedule_cascade(
        snapshot,
        current_schedule_id="SCH-A",
        new_end_at="2026-08-10 03:30:00",
        reason="预计超时更新",
    )

    updates = {item["id"]: item for item in second["updates"]}
    assert updates["SCH-B"]["start_at"] == "2026-08-10 03:40:00"
    assert updates["SCH-C"]["start_at"] == "2026-08-10 05:00:00"
    assert updates["SCH-B"]["delay_minutes"] == 60


def test_earlier_forecast_does_not_pull_already_delayed_schedules_forward() -> None:
    snapshot = schedule_snapshot()
    first = plan_same_lab_schedule_cascade(
        snapshot,
        current_schedule_id="SCH-A",
        new_end_at="2026-08-10 03:20:00",
        reason="预计超时",
    )
    apply_updates(snapshot, first["updates"])

    second = plan_same_lab_schedule_cascade(
        snapshot,
        current_schedule_id="SCH-A",
        new_end_at="2026-08-10 03:00:00",
        reason="预计结束提前",
    )

    assert second["conflicts"] == []
    assert second["updates"] == []


def test_locked_following_schedule_returns_conflict_without_persistable_updates() -> None:
    snapshot = schedule_snapshot()
    snapshot["schedules"][1]["status"] = "已到达实验室"

    result = plan_same_lab_schedule_cascade(
        snapshot,
        current_schedule_id="SCH-A",
        new_end_at="2026-08-10 03:20:00",
        reason="当前实验超时",
    )

    assert result["updates"] == []
    assert result["conflicts"][0]["code"] == LOCKED_CONFLICT
    assert result["conflicts"][0]["schedule_id"] == "SCH-B"


def test_task_comparison_evidence_locks_schedule_even_when_schedule_status_is_still_planned() -> None:
    snapshot = schedule_snapshot()
    snapshot["experiment_trays"] = [
        {"task_code": "TASK-B", "experiment_code": "EXP-B", "tray_code": "TRAY-B"}
    ]
    snapshot["samples"] = [
        {
            "task_code": "TASK-B",
            "status": "已到达实验室",
            "trays": [{"tray_code": "TRAY-B", "status": "已到达实验室"}],
        }
    ]

    result = plan_same_lab_schedule_cascade(
        snapshot,
        current_schedule_id="SCH-A",
        new_end_at="2026-08-10 03:20:00",
        reason="当前实验超时",
    )

    assert result["updates"] == []
    assert result["conflicts"][0]["code"] == LOCKED_CONFLICT
    assert result["conflicts"][0]["schedule_id"] == "SCH-B"


def test_maintenance_overlap_returns_conflict_without_persistable_updates() -> None:
    snapshot = schedule_snapshot()
    snapshot["devices"] = [
        {
            "id": "9",
            "code": "LAB-SALT",
            "name": "盐雾试验室",
            "status": "计划维修",
            "maintenance_start_at": "2026-08-10 04:00:00",
            "maintenance_end_at": "2026-08-10 05:00:00",
        }
    ]

    result = plan_same_lab_schedule_cascade(
        snapshot,
        current_schedule_id="SCH-A",
        new_end_at="2026-08-10 03:20:00",
        reason="当前实验超时",
    )

    assert result["updates"] == []
    assert result["conflicts"][0]["code"] == MAINTENANCE_CONFLICT
    assert result["conflicts"][0]["schedule_id"] == "SCH-B"


def test_no_delay_produces_no_updates() -> None:
    result = plan_same_lab_schedule_cascade(
        schedule_snapshot(),
        current_schedule_id="SCH-A",
        new_end_at="2026-08-10 02:30:00",
        reason="实验按时结束",
    )

    assert result == {"updates": [], "proposed_updates": [], "conflicts": []}


def test_delay_metadata_round_trips_through_schedule_remark() -> None:
    schedule = schedule_snapshot()["schedules"][1]
    schedule.update(
        {
            "start_at": "2026-08-10 03:30:00",
            "end_at": "2026-08-10 04:30:00",
            "original_start_at": "2026-08-10 02:40:00",
            "original_end_at": "2026-08-10 03:40:00",
            "delay_minutes": 50,
            "delay_reason": "当前实验超时",
            "source_run_no": "RUN-A",
            "remark": "客户要求优先",
        }
    )

    insert_row = build_schedule_insert_row(schedule)
    restored = build_storage_schedule_item(insert_row)

    assert insert_row["remark"].startswith("MES_SCHEDULE_DELAY_V1:")
    assert restored["original_start_at"] == "2026-08-10 02:40:00"
    assert restored["original_end_at"] == "2026-08-10 03:40:00"
    assert restored["delay_minutes"] == 50
    assert restored["delay_reason"] == "当前实验超时"
    assert restored["source_run_no"] == "RUN-A"
    assert restored["remark"] == "客户要求优先"


def test_mysql_schedule_loader_selects_remark_and_restores_delay_metadata() -> None:
    delayed = build_schedule_insert_row(
        {
            **schedule_snapshot()["schedules"][1],
            "original_start_at": "2026-08-10 02:40:00",
            "original_end_at": "2026-08-10 03:40:00",
            "delay_minutes": 50,
            "delay_reason": "当前实验超时",
            "source_run_no": "RUN-A",
        }
    )

    class Cursor:
        def __init__(self) -> None:
            self.sql = ""

        def execute(self, sql, _params) -> None:
            self.sql = " ".join(str(sql).split())

        def fetchall(self) -> list[dict]:
            return [
                {
                    **delayed,
                    "schedule_start_time": datetime(2026, 8, 10, 3, 30),
                    "schedule_end_time": datetime(2026, 8, 10, 4, 30),
                }
            ]

    cursor = Cursor()
    restored = load_schedules(cursor)

    assert "s.remark" in cursor.sql
    assert restored[0]["original_start_at"] == "2026-08-10 02:40:00"
    assert restored[0]["delay_minutes"] == 50
