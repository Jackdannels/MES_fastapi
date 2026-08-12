from copy import deepcopy

from app.services.schedule_cascade_runtime import (
    apply_run_schedule_cascade,
    apply_same_lab_schedule_cascade,
    run_forecast_end_at,
)


class CascadeStorage:
    def __init__(self, payload):
        self.payload = deepcopy(payload)
        self.patched_schedules = []

    def read_many(self, keys):
        return {key: deepcopy(self.payload.get(key, [])) for key in keys}

    def patch_schedules(self, schedules):
        self.patched_schedules.extend(deepcopy(schedules))
        updates = {item["id"]: item for item in schedules}
        self.payload["mes.schedules"] = [
            deepcopy(updates.get(item["id"], item))
            for item in self.payload["mes.schedules"]
        ]

    def write(self, key, value):
        self.payload[key] = deepcopy(value)


def payload(*, next_status="已排程"):
    return {
        "mes.schedules": [
            {
                "id": "SCH-A",
                "task_code": "TASK-A",
                "experiment_code": "EXP-A",
                "device": "盐雾试验室",
                "start_at": "2026-08-10 01:30:00",
                "end_at": "2026-08-10 02:30:00",
                "status": "实验进行中",
            },
            {
                "id": "SCH-B",
                "task_code": "TASK-B",
                "experiment_code": "EXP-B",
                "device": "盐雾试验室",
                "start_at": "2026-08-10 02:40:00",
                "end_at": "2026-08-10 03:40:00",
                "status": next_status,
            },
        ],
        "mes.devices": [],
        "mes.samples": [],
        "mes.experiment_trays": [],
        "mes.experiment_runs": [],
        "mes.experiment_run_trays": [],
        "mes.experiment_run_steps": [],
        "mes.conflicts": [],
    }


def test_runtime_persists_event_driven_schedule_delay() -> None:
    storage = CascadeStorage(payload())

    result = apply_run_schedule_cascade(
        storage,
        {
            "run_no": "RUN-A",
            "schedule_id": "SCH-A",
            "planned_end_at": "2026-08-10 03:20:00",
        },
        new_end_at="2026-08-10 03:20:00",
        reason="实验实际开始时间变化",
    )

    assert result["changed"] is True
    assert [(item["id"], item["start_at"], item["end_at"]) for item in storage.patched_schedules] == [
        ("SCH-B", "2026-08-10 03:30:00", "2026-08-10 04:30:00")
    ]
    assert storage.patched_schedules[0]["source_run_no"] == "RUN-A"


def test_runtime_persists_one_structured_conflict_when_following_schedule_is_locked() -> None:
    storage = CascadeStorage(payload(next_status="已到达实验室"))

    result = apply_same_lab_schedule_cascade(
        storage,
        current_schedule_id="SCH-A",
        new_end_at="2026-08-10 03:20:00",
        reason="实验超时",
        source_run_no="RUN-A",
    )

    assert result["updates"] == []
    assert result["changed"] is True
    assert len(storage.payload["mes.conflicts"]) == 1
    assert storage.payload["mes.conflicts"][0]["type"] == "schedule_delay_cascade_conflict"
    assert storage.payload["mes.conflicts"][0]["source_run_no"] == "RUN-A"


def test_successful_cascade_resolves_waiting_active_run_conflict() -> None:
    initial = payload()
    initial["mes.conflicts"] = [
        {
            "id": "waiting",
            "type": "schedule_delayed_by_active_run",
            "source_run_no": "RUN-A",
            "status": "pending",
        }
    ]
    storage = CascadeStorage(initial)

    result = apply_same_lab_schedule_cascade(
        storage,
        current_schedule_id="SCH-A",
        new_end_at="2026-08-10 03:20:00",
        reason="实验实际结束时间变化",
        source_run_no="RUN-A",
    )

    assert result["changed"] is True
    assert result["resolved_conflicts"][0]["status"] == "resolved"
    assert storage.payload["mes.conflicts"][0]["status"] == "resolved"


def test_run_forecast_uses_start_and_planned_duration_without_wall_clock_updates() -> None:
    assert run_forecast_end_at(
        {
            "started_at": "2026-08-10 02:20:00",
            "planned_hours": 1,
        }
    ) == "2026-08-10 03:20:00"

