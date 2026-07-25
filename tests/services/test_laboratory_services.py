import pytest

from app.core.legacy_fallback import reset_legacy_fallback_hits
from app.services import mq_event_processor
from app.services.laboratory_completion import (
    complete_storage_laboratory_experiment,
    tray_assigned_experiments_are_completed,
)
from app.services.laboratory_axis_steps import complete_storage_laboratory_axis_step
from app.services.laboratory_operations import apply_laboratory_task_operation
from app.services.laboratory_start import start_storage_laboratory_experiment


@pytest.fixture(autouse=True)
def _reset_legacy_fallback_hits():
    reset_legacy_fallback_hits()
    yield
    reset_legacy_fallback_hits()


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
        "experiment_samples": [{"task_code": "TASK-1", "experiment_code": "EXP-A", "sample_code": "SP-1"}],
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
        "experiment_samples": [{"task_code": "TASK-1", "experiment_code": "EXP-A", "sample_code": "SP-ACTIVE"}],
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


def test_laboratory_operation_records_tray_code_in_comparison_history():
    snapshot = {
        "tasks": [{"code": "TASK-1", "status": "任务进行中"}],
        "experiments": [{"task_code": "TASK-1", "experiment_code": "EXP-VIB", "experiment_name": "振动试验"}],
        "schedules": [{"id": "SCH-VIB", "task_code": "TASK-1", "experiment_code": "EXP-VIB", "device": "振动一室"}],
        "experiment_runs": [],
        "experiment_run_trays": [],
        "experiment_trays": [{"task_code": "TASK-1", "experiment_code": "EXP-VIB", "tray_code": "TP-1"}],
        "experiment_samples": [{"task_code": "TASK-1", "experiment_code": "EXP-VIB", "sample_code": "SP-1"}],
        "staging_events": [],
        "samples": [_sample("SP-1", "TASK-1", "TP-1", "冲击试验部分完成 3/6轴", "冲击一室")],
    }

    result = apply_laboratory_task_operation(
        snapshot,
        operation_type="compare",
        task_code="TASK-1",
        experiment_code="EXP-VIB",
        lab_name="振动一室",
        tray_codes=["TP-1"],
        occurred_at="2026-06-29 13:18:22",
    )

    history = result["samples"][0]["history"][0]
    assert history["action"] == "任务比对"
    assert history["location"] == "振动一室"
    assert "TP-1" in history["detail"]
    assert "振动试验" in history["detail"]


def test_laboratory_compare_rejects_tray_still_stocked_in_appearance_room():
    snapshot = {
        "tasks": [{"code": "TASK-1", "status": "任务进行中"}],
        "experiments": [
            {"task_code": "TASK-1", "experiment_code": "EXP-IMPACT", "experiment_name": "冲击试验"},
            {"task_code": "TASK-1", "experiment_code": "EXP-SALT", "experiment_name": "盐雾试验"},
        ],
        "schedules": [{"id": "SCH-SALT", "task_code": "TASK-1", "experiment_code": "EXP-SALT", "device": "盐雾试验室"}],
        "experiment_runs": [],
        "experiment_run_trays": [
            {
                "run_no": "RUN-IMPACT",
                "task_code": "TASK-1",
                "experiment_code": "EXP-IMPACT",
                "tray_code": "TP-1",
                "run_tray_status": "实验已完成",
            }
        ],
        "experiment_trays": [
            {"task_code": "TASK-1", "experiment_code": "EXP-IMPACT", "tray_code": "TP-1"},
            {"task_code": "TASK-1", "experiment_code": "EXP-SALT", "tray_code": "TP-1"},
        ],
        "experiment_samples": [{"task_code": "TASK-1", "experiment_code": "EXP-SALT", "sample_code": "SP-1"}],
        "staging_events": [],
        "samples": [_sample("SP-1", "TASK-1", "TP-1", "实验前外观检测间存放", "外观检测间")],
    }

    with pytest.raises(ValueError, match="托盘 TP-1 仍位于外观检测间"):
        apply_laboratory_task_operation(
            snapshot,
            operation_type="compare",
            task_code="TASK-1",
            experiment_code="EXP-SALT",
            lab_name="盐雾试验室",
            tray_codes=["TP-1"],
            occurred_at="2026-07-24 15:04:17",
        )

    assert snapshot["samples"][0]["status"] == "实验前外观检测间存放"
    assert snapshot["samples"][0]["location"] == "外观检测间"


def test_laboratory_compare_rejects_partial_axis_tray_targeted_to_another_experiment():
    task_code = "SYLU-2026-07-027"
    tray_code = f"{task_code}-TP-001"
    impact_experiment_code = f"{task_code}-B"
    mold_experiment_code = f"{task_code}-A"
    sample = _sample(f"{task_code}-SP-001", task_code, tray_code, "冲击试验部分完成 5/6轴", "冲击一室")
    sample["trays"][0]["target_experiment_code"] = mold_experiment_code
    sample["trays"][0]["target_lab"] = "霉菌试验室"
    sample["history"] = [
        {
            "action": "实验任务撤回",
            "detail": f"{task_code} / 霉菌试验 / 撤回至冲击试验部分完成（试验间内撤回当前实验任务）",
            "location": "冲击一室",
            "status": "冲击试验部分完成 5/6轴",
            "time": "2026-07-01 17:39:21",
        },
        {
            "action": "任务比对",
            "detail": f"{task_code} / 冲击试验 / 已到达实验室 / 托盘：{tray_code}",
            "location": "冲击一室",
            "status": "已到达实验室",
            "time": "2026-07-01 17:37:25",
        },
    ]
    snapshot = {
        "tasks": [{"code": task_code, "status": "任务进行中"}],
        "experiments": [
            {"task_code": task_code, "experiment_code": mold_experiment_code, "experiment_name": "霉菌试验"},
            {
                "axis_codes": ["x+", "x-", "y+", "y-", "z+", "z-"],
                "task_code": task_code,
                "experiment_code": impact_experiment_code,
                "experiment_name": "冲击试验",
            },
        ],
        "schedules": [
            {"id": "SCH-IMPACT-REMAINING", "task_code": task_code, "experiment_code": impact_experiment_code, "device": "冲击一室"},
            {"id": "SCH-MOLD", "task_code": task_code, "experiment_code": mold_experiment_code, "device": "霉菌试验室"},
        ],
        "experiment_runs": [],
        "experiment_run_trays": [
            {
                "run_no": "RUN-IMPACT-5",
                "task_code": task_code,
                "experiment_code": impact_experiment_code,
                "tray_code": tray_code,
                "run_tray_status": "实验已完成",
            }
        ],
        "experiment_trays": [
            {"task_code": task_code, "experiment_code": mold_experiment_code, "tray_code": tray_code},
            {"task_code": task_code, "experiment_code": impact_experiment_code, "tray_code": tray_code},
        ],
        "experiment_samples": [
            {"task_code": task_code, "experiment_code": mold_experiment_code, "sample_code": sample["code"]},
            {"task_code": task_code, "experiment_code": impact_experiment_code, "sample_code": sample["code"]},
        ],
        "samples": [sample],
    }

    with pytest.raises(ValueError, match="current experiment has no matching active tray samples"):
        apply_laboratory_task_operation(
            snapshot,
            operation_type="compare",
            task_code=task_code,
            experiment_code=impact_experiment_code,
            lab_name="冲击一室",
            tray_codes=[tray_code],
            occurred_at="2026-07-01 17:40:00",
        )

    assert snapshot["samples"][0]["trays"][0]["target_experiment_code"] == mold_experiment_code
    assert snapshot["samples"][0]["trays"][0]["target_lab"] == "霉菌试验室"


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
        "experiment_samples": [{"task_code": "TASK-1", "experiment_code": "EXP-A", "sample_code": "SP-A"}],
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


def test_start_ignores_requested_trays_not_ready_in_current_laboratory():
    snapshot = {
        "tasks": [{"code": "TASK-1", "status": "任务进行中"}],
        "experiments": [{"task_code": "TASK-1", "experiment_code": "EXP-A", "experiment_name": "冲击试验"}],
        "schedules": [{"id": "SCH-A", "task_code": "TASK-1", "experiment_code": "EXP-A", "device": "冲击一室"}],
        "experiment_runs": [],
        "experiment_run_trays": [],
        "experiment_trays": [
            {"task_code": "TASK-1", "experiment_code": "EXP-A", "tray_code": "TP-READY"},
            {"task_code": "TASK-1", "experiment_code": "EXP-A", "tray_code": "TP-ARRIVED"},
        ],
        "experiment_samples": [
            {"task_code": "TASK-1", "experiment_code": "EXP-A", "sample_code": "SP-READY"},
            {"task_code": "TASK-1", "experiment_code": "EXP-A", "sample_code": "SP-ARRIVED"},
        ],
        "samples": [
            _sample("SP-READY", "TASK-1", "TP-READY", "实验准备就绪", "冲击一室"),
            _sample("SP-ARRIVED", "TASK-1", "TP-ARRIVED", "到货", "接驳区"),
        ],
    }

    result = start_storage_laboratory_experiment(
        snapshot,
        task_code="TASK-1",
        experiment_code="EXP-A",
        run_no="RUN-A",
        lab_name="冲击一室",
        schedule_id="SCH-A",
        tray_codes=["TP-READY", "TP-ARRIVED"],
        started_at="2026-06-06 09:00:00",
    )

    assert result["affectedTrayCodes"] == ["TP-READY"]
    assert result["samples"][0]["trays"][0]["status"] == "实验进行中"
    assert result["samples"][1]["trays"][0]["status"] == "到货"
    assert [item["tray_code"] for item in result["experimentRunTrays"]] == ["TP-READY"]


def test_start_clears_stale_fixture_ready_marker():
    sample = _sample("SP-A", "TASK-1", "TP-A", "实验准备就绪", "盐雾试验室")
    sample["trays"][0]["fixture_ready"] = True
    sample["trays"][0]["fixtureReady"] = True
    snapshot = {
        "tasks": [{"code": "TASK-1", "status": "任务进行中"}],
        "experiments": [{"task_code": "TASK-1", "experiment_code": "EXP-A", "experiment_name": "盐雾试验"}],
        "schedules": [{"id": "SCH-A", "task_code": "TASK-1", "experiment_code": "EXP-A", "device": "盐雾试验室"}],
        "experiment_runs": [],
        "experiment_run_trays": [],
        "experiment_trays": [{"task_code": "TASK-1", "experiment_code": "EXP-A", "tray_code": "TP-A"}],
        "experiment_samples": [{"task_code": "TASK-1", "experiment_code": "EXP-A", "sample_code": "SP-A"}],
        "samples": [sample],
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

    tray = result["samples"][0]["trays"][0]
    assert tray["status"] == "实验进行中"
    assert "fixture_ready" not in tray
    assert "fixtureReady" not in tray


def test_ready_clears_fixture_ready_marker_after_countdown():
    sample = _sample("SP-A", "TASK-1", "TP-A", "工装夹具安装", "盐雾试验室")
    sample["trays"][0]["fixture_ready"] = True
    sample["trays"][0]["fixtureReady"] = True
    snapshot = {
        "tasks": [{"code": "TASK-1", "status": "任务进行中"}],
        "experiments": [{"task_code": "TASK-1", "experiment_code": "EXP-A", "experiment_name": "盐雾试验"}],
        "schedules": [{"id": "SCH-A", "task_code": "TASK-1", "experiment_code": "EXP-A", "device": "盐雾试验室"}],
        "experiment_runs": [],
        "experiment_run_trays": [],
        "experiment_trays": [{"task_code": "TASK-1", "experiment_code": "EXP-A", "tray_code": "TP-A"}],
        "experiment_samples": [{"task_code": "TASK-1", "experiment_code": "EXP-A", "sample_code": "SP-A"}],
        "samples": [sample],
    }

    result = apply_laboratory_task_operation(
        snapshot,
        operation_type="ready",
        task_code="TASK-1",
        experiment_code="EXP-A",
        lab_name="盐雾试验室",
        tray_codes=["TP-A"],
        occurred_at="2026-06-06 09:00:00",
    )

    tray = result["samples"][0]["trays"][0]
    assert tray["status"] == "实验准备就绪"
    assert "fixture_ready" not in tray
    assert "fixtureReady" not in tray


def test_ready_operation_does_not_reopen_completed_axis_schedules():
    completed_axes = ["x+", "x-", "y+"]
    remaining_axes = ["y-", "z+", "z-"]
    snapshot = {
        "tasks": [{"code": "SYLU-2026-07-001", "status": "任务已完成"}],
        "experiments": [
            {
                "task_code": "SYLU-2026-07-001",
                "experiment_code": "SYLU-2026-07-001-A",
                "experiment_name": "冲击试验",
                "status": "实验已完成",
                "axis_codes": [*completed_axes, *remaining_axes],
            }
        ],
        "schedules": [
            {
                "id": "SCH-AXIS-DONE",
                "task_code": "SYLU-2026-07-001",
                "experiment_code": "SYLU-2026-07-001-A",
                "device": "冲击一室",
                "status": "实验已完成",
                "axis_codes": completed_axes,
            },
            {
                "id": "SCH-AXIS-REMAINING",
                "task_code": "SYLU-2026-07-001",
                "experiment_code": "SYLU-2026-07-001-A",
                "device": "冲击一室",
                "status": "实验已完成",
                "axis_codes": remaining_axes,
            },
        ],
        "experiment_runs": [
            {
                "run_no": "RUN-AXIS-DONE",
                "schedule_id": "SCH-AXIS-DONE",
                "task_code": "SYLU-2026-07-001",
                "experiment_code": "SYLU-2026-07-001-A",
                "status": "实验已完成",
                "axis_codes": completed_axes,
            }
        ],
        "experiment_run_steps": [
            {
                "run_no": "RUN-AXIS-DONE",
                "task_code": "SYLU-2026-07-001",
                "experiment_code": "SYLU-2026-07-001-A",
                "axis_code": axis_code,
                "status": "实验已完成",
            }
            for axis_code in completed_axes
        ],
        "experiment_run_trays": [
            {
                "run_no": "RUN-AXIS-DONE",
                "task_code": "SYLU-2026-07-001",
                "experiment_code": "SYLU-2026-07-001-A",
                "tray_code": "SYLU-2026-07-001-TP-001",
                "status": "实验已完成",
                "run_tray_status": "实验已完成",
            }
        ],
        "experiment_trays": [
            {
                "task_code": "SYLU-2026-07-001",
                "experiment_code": "SYLU-2026-07-001-A",
                "tray_code": "SYLU-2026-07-001-TP-001",
            }
        ],
        "experiment_samples": [
            {
                "task_code": "SYLU-2026-07-001",
                "experiment_code": "SYLU-2026-07-001-A",
                "sample_code": "SYLU-2026-07-001-SP-001",
            }
        ],
        "samples": [
            _sample(
                "SYLU-2026-07-001-SP-001",
                "SYLU-2026-07-001",
                "SYLU-2026-07-001-TP-001",
                "工装夹具安装",
                "冲击一室",
            )
        ],
    }

    result = apply_laboratory_task_operation(
        snapshot,
        operation_type="ready",
        task_code="SYLU-2026-07-001",
        experiment_code="SYLU-2026-07-001-A",
        lab_name="冲击一室",
        tray_codes=["SYLU-2026-07-001-TP-001"],
        occurred_at="2026-06-25 20:57:17",
    )

    assert "schedules" not in result
    assert "experiments" not in result
    assert "tasks" not in result
    schedules = {schedule["id"]: schedule for schedule in snapshot["schedules"]}
    assert schedules["SCH-AXIS-DONE"]["status"] == "实验已完成"
    assert schedules["SCH-AXIS-REMAINING"]["status"] == "实验已完成"
    assert snapshot["experiments"][0]["status"] == "实验已完成"
    assert snapshot["tasks"][0]["status"] == "任务已完成"


def test_install_after_current_recompare_overwrites_stale_experiment_target():
    current_sample = _sample("SP-CURRENT", "TASK-1", "TP-1", "已到达实验室", "振动一室")
    current_sample["trays"][0]["target_experiment_code"] = "EXP-SALT"
    current_sample["trays"][0]["target_lab"] = "盐雾试验室"
    returned_sample = _sample("SP-SALT", "TASK-1", "TP-1", "厂家收回", "厂家收回")
    snapshot = {
        "tasks": [{"code": "TASK-1", "status": "任务进行中"}],
        "experiments": [
            {"task_code": "TASK-1", "experiment_code": "EXP-SALT", "experiment_name": "盐雾试验"},
            {"task_code": "TASK-1", "experiment_code": "EXP-VIB", "experiment_name": "振动试验"},
        ],
        "schedules": [{"id": "SCH-VIB", "task_code": "TASK-1", "experiment_code": "EXP-VIB", "device": "振动一室"}],
        "experiment_runs": [],
        "experiment_run_trays": [
            {
                "run_no": "RUN-SALT",
                "task_code": "TASK-1",
                "experiment_code": "EXP-SALT",
                "tray_code": "TP-1",
                "run_tray_status": "厂家收回",
            }
        ],
        "experiment_trays": [
            {"task_code": "TASK-1", "experiment_code": "EXP-SALT", "tray_code": "TP-1"},
            {"task_code": "TASK-1", "experiment_code": "EXP-VIB", "tray_code": "TP-1"},
        ],
        "experiment_samples": [
            {"task_code": "TASK-1", "experiment_code": "EXP-SALT", "sample_code": "SP-SALT"},
            {"task_code": "TASK-1", "experiment_code": "EXP-VIB", "sample_code": "SP-CURRENT"},
        ],
        "samples": [returned_sample, current_sample],
    }

    result = apply_laboratory_task_operation(
        snapshot,
        operation_type="install",
        task_code="TASK-1",
        experiment_code="EXP-VIB",
        lab_name="振动一室",
        tray_codes=["TP-1"],
        occurred_at="2026-06-12 14:20:00",
    )

    returned, current = result["samples"]
    assert returned["status"] == "厂家收回"
    assert returned["trays"][0]["status"] == "厂家收回"
    assert current["status"] == "工装夹具安装"
    assert current["trays"][0]["status"] == "工装夹具安装"
    assert current["trays"][0]["target_experiment_code"] == "EXP-VIB"
    assert current["trays"][0]["target_lab"] == "振动一室"


def test_pre_experiment_appearance_routing_requires_appearance_target_and_handover_or_staging_origin():
    from app.services.appearance_inspection import should_route_pre_experiment_appearance

    experiments = [
        {"task_code": "TASK-1", "experiment_code": "EXP-SALT", "experiment_name": "盐雾试验"},
        {"task_code": "TASK-1", "experiment_code": "EXP-HOT-HUMID", "experiment_name": "高低温湿热试验"},
        {"task_code": "TASK-1", "experiment_code": "EXP-VIB", "experiment_name": "振动试验"},
    ]

    assert should_route_pre_experiment_appearance(
        source_location="接驳区",
        source_status="到货",
        target_lab="振动一室",
        target_experiment_code="EXP-SALT",
        experiments=experiments,
    )
    assert should_route_pre_experiment_appearance(
        source_location="恒温恒湿间（暂存间）",
        source_status="已到达暂存间",
        target_lab="霉菌试验室",
        target_experiment_code="EXP-MISSING",
        experiments=experiments,
    )
    assert should_route_pre_experiment_appearance(
        source_location="接驳区",
        source_status="到货",
        target_lab="高低温湿热一室",
        target_experiment_code="EXP-MISSING",
        experiments=experiments,
    )
    assert should_route_pre_experiment_appearance(
        source_location="接驳区",
        source_status="到货",
        target_lab="振动一室",
        target_experiment_code="EXP-HOT-HUMID",
        experiments=experiments,
    )
    assert should_route_pre_experiment_appearance(
        source_location="恒温恒湿间（暂存间）",
        source_status="已到达暂存间",
        target_lab="高低温湿热二室",
        target_experiment_code="EXP-HOT-HUMID",
        experiments=experiments,
    )
    assert not should_route_pre_experiment_appearance(
        source_location="",
        source_status="已入库",
        target_lab="盐雾试验室",
        target_experiment_code="EXP-SALT",
        experiments=experiments,
    )
    assert not should_route_pre_experiment_appearance(
        source_location="外观检测间",
        source_status="实验前外观检测间存放",
        target_lab="盐雾试验室",
        target_experiment_code="EXP-SALT",
        experiments=experiments,
    )
    assert not should_route_pre_experiment_appearance(
        source_location="接驳区",
        source_status="到货",
        target_lab="振动一室",
        target_experiment_code="EXP-VIB",
        experiments=experiments,
    )


def test_staging_arrival_does_not_complete_assigned_experiment_for_post_staging_rules():
    experiment_trays = [
        {"task_code": "TASK-1", "experiment_code": "EXP-A", "tray_code": "TP-1"},
        {"task_code": "TASK-1", "experiment_code": "EXP-B", "tray_code": "TP-1"},
    ]
    experiment_run_trays = [
        {
            "task_code": "TASK-1",
            "experiment_code": "EXP-A",
            "tray_code": "TP-1",
            "run_tray_status": "实验已完成",
        },
        {
            "task_code": "TASK-1",
            "experiment_code": "EXP-B",
            "tray_code": "TP-1",
            "run_tray_status": "已到达暂存间",
        },
    ]

    assert not tray_assigned_experiments_are_completed(
        task_code="TASK-1",
        tray_code="TP-1",
        experiment_trays=experiment_trays,
        experiment_run_trays=experiment_run_trays,
    )


def test_pre_experiment_appearance_dispatch_marker_blocks_repeat_until_withdrawn():
    from app.services.appearance_inspection import pre_experiment_appearance_already_dispatched

    sample = {
        "task_code": "TASK-1",
        "location": "盐雾试验室",
        "status": "送至实验室",
        "flow_status": "送至实验室",
        "trays": [
            {
                "tray_code": "TP-1",
                "status": "送至实验室",
                "target_lab": "盐雾试验室",
                "target_experiment_code": "EXP-SALT",
            }
        ],
    }
    tray = sample["trays"][0]
    staging_events = [
        {
            "tray_code": "TP-1",
            "task_code": "TASK-1",
            "room": "appearance",
            "action": "stock_in",
            "appearance_phase": "pre_experiment",
            "target_experiment_code": "EXP-SALT",
            "time": "2026-06-06T21:40:00",
        },
        {
            "tray_code": "TP-1",
            "task_code": "TASK-1",
            "room": "appearance",
            "action": "stock_out",
            "appearance_phase": "pre_experiment",
            "target_lab": "盐雾试验室",
            "target_experiment_code": "EXP-SALT",
            "time": "2026-06-06T21:50:00",
        },
    ]

    assert pre_experiment_appearance_already_dispatched(sample, tray, staging_events)

    tray["target_lab"] = "高低温湿热一室"
    tray["target_experiment_code"] = "EXP-HOT-HUMID"
    assert not pre_experiment_appearance_already_dispatched(sample, tray, staging_events)

    tray["target_lab"] = "盐雾试验室"
    tray["target_experiment_code"] = "EXP-SALT"

    unscoped_events = [
        {
            "tray_code": "TP-1",
            "task_code": "TASK-1",
            "room": "appearance",
            "action": "stock_in",
            "time": "2026-06-06T21:40:00",
        },
        {
            "tray_code": "TP-1",
            "task_code": "TASK-1",
            "room": "appearance",
            "action": "stock_out",
            "target_experiment_code": "EXP-SALT",
            "time": "2026-06-06T21:50:00",
        },
    ]
    assert not pre_experiment_appearance_already_dispatched(sample, tray, unscoped_events)

    withdrawn_events = [
        *staging_events,
        {
            "tray_code": "TP-1",
            "task_code": "TASK-1",
                "room": "appearance",
                "action": "stock_out_withdraw",
                "target_experiment_code": "EXP-SALT",
                "time": "2026-06-06T21:55:00",
        },
    ]
    assert not pre_experiment_appearance_already_dispatched(sample, tray, withdrawn_events)


def _axis_snapshot():
    sub_experiment_code = "EXP-IMPACT-AXIS-001"
    return {
        "tasks": [{"code": "TASK-AXIS", "status": "任务进行中"}],
        "experiments": [{"task_code": "TASK-AXIS", "experiment_code": "EXP-IMPACT", "experiment_name": "冲击试验", "status": "实验进行中"}],
        "schedules": [
            {
                "id": "SCH-AXIS-1",
                "task_code": "TASK-AXIS",
                "experiment_code": "EXP-IMPACT",
                "sub_experiment_code": sub_experiment_code,
                "device": "冲击一室",
                "status": "实验进行中",
                "axis_codes": ["z-", "y+"],
                "start_at": "2026-06-24 09:00:00",
                "end_at": "2026-06-24 10:00:00",
            },
            {
                "id": "SCH-AXIS-2",
                "task_code": "TASK-AXIS",
                "experiment_code": "EXP-IMPACT",
                "sub_experiment_code": sub_experiment_code,
                "device": "冲击一室",
                "status": "已排程",
                "axis_codes": ["x-", "x+"],
                "start_at": "2026-06-24 10:00:00",
                "end_at": "2026-06-24 11:00:00",
            },
        ],
        "experiment_runs": [
            {
                "run_no": "RUN-AXIS",
                "task_code": "TASK-AXIS",
                "experiment_code": "EXP-IMPACT",
                "sub_experiment_code": sub_experiment_code,
                "schedule_id": "SCH-AXIS-1",
                "device": "冲击一室",
                "status": "实验进行中",
                "axis_codes": ["z-", "y+", "x-", "x+"],
            }
        ],
        "experiment_run_trays": [
            {
                "run_no": "RUN-AXIS",
                "task_code": "TASK-AXIS",
                "experiment_code": "EXP-IMPACT",
                "sub_experiment_code": sub_experiment_code,
                "tray_code": "TP-AXIS",
                "status": "实验进行中",
                "run_tray_status": "实验进行中",
            }
        ],
        "experiment_run_steps": [
            {"run_no": "RUN-AXIS", "task_code": "TASK-AXIS", "experiment_code": "EXP-IMPACT", "sub_experiment_code": sub_experiment_code, "axis_code": "z-", "step_no": 1, "status": "实验已完成"},
            {"run_no": "RUN-AXIS", "task_code": "TASK-AXIS", "experiment_code": "EXP-IMPACT", "sub_experiment_code": sub_experiment_code, "axis_code": "y+", "step_no": 2, "status": "实验进行中"},
            {"run_no": "RUN-AXIS", "task_code": "TASK-AXIS", "experiment_code": "EXP-IMPACT", "sub_experiment_code": sub_experiment_code, "axis_code": "x-", "step_no": 3, "status": "待执行"},
            {"run_no": "RUN-AXIS", "task_code": "TASK-AXIS", "experiment_code": "EXP-IMPACT", "sub_experiment_code": sub_experiment_code, "axis_code": "x+", "step_no": 4, "status": "待执行"},
        ],
        "experiment_trays": [{"task_code": "TASK-AXIS", "experiment_code": "EXP-IMPACT", "tray_code": "TP-AXIS"}],
        "experiment_samples": [{"task_code": "TASK-AXIS", "experiment_code": "EXP-IMPACT", "sample_code": "SP-AXIS"}],
        "samples": [_sample("SP-AXIS", "TASK-AXIS", "TP-AXIS", "实验进行中", "冲击一室")],
    }


def test_start_axis_run_uses_current_schedule_axes_when_axis_codes_are_omitted():
    snapshot = _axis_snapshot()
    snapshot["experiments"][0]["axis_codes"] = ["z-", "y+", "x-", "x+"]
    snapshot["experiment_runs"] = []
    snapshot["experiment_run_trays"] = []
    snapshot["experiment_run_steps"] = []
    snapshot["schedules"][0]["status"] = "已排程"

    result = start_storage_laboratory_experiment(
        snapshot,
        task_code="TASK-AXIS",
        experiment_code="EXP-IMPACT",
        run_no="RUN-AXIS-SCH-1",
        lab_name="冲击一室",
        schedule_id="SCH-AXIS-1",
        tray_codes=["TP-AXIS"],
        started_at="2026-06-24 09:00:00",
    )

    assert result["experimentRuns"][0]["axis_codes"] == ["y+", "z-"]
    assert [step["axis_code"] for step in result["experimentRunSteps"]] == ["y+", "z-"]
    assert result["schedules"][0]["status"] == "实验进行中"
    assert result["schedules"][1]["status"] == "已排程"


def test_start_axis_run_orders_axes_by_standard_sequence():
    snapshot = _axis_snapshot()
    snapshot["experiment_runs"] = []
    snapshot["experiment_run_trays"] = []
    snapshot["experiment_run_steps"] = []
    snapshot["experiments"][0]["axis_codes"] = ["z-", "x+", "y-"]
    snapshot["schedules"] = [snapshot["schedules"][0]]
    snapshot["schedules"][0]["axis_codes"] = ["z-", "x+", "y-"]
    snapshot["schedules"][0]["status"] = "已排程"

    result = start_storage_laboratory_experiment(
        snapshot,
        task_code="TASK-AXIS",
        experiment_code="EXP-IMPACT",
        run_no="RUN-AXIS-ORDERED",
        lab_name="冲击一室",
        schedule_id="SCH-AXIS-1",
        tray_codes=["TP-AXIS"],
        started_at="2026-06-24 09:00:00",
    )

    assert result["experimentRuns"][0]["axis_codes"] == ["x+", "y-", "z-"]
    assert [step["axis_code"] for step in result["experimentRunSteps"]] == ["x+", "y-", "z-"]
    assert [step["step_no"] for step in result["experimentRunSteps"]] == [1, 2, 3]


def test_start_axis_run_closes_superseded_running_run_for_same_tray_scope():
    snapshot = _axis_snapshot()
    sub_experiment_code = snapshot["schedules"][0]["sub_experiment_code"]
    snapshot["experiments"][0]["axis_codes"] = ["z-", "y+"]
    snapshot["schedules"] = [snapshot["schedules"][0]]
    snapshot["schedules"][0]["axis_codes"] = ["z-", "y+"]
    snapshot["schedules"][0]["status"] = "已排程"
    snapshot["experiment_runs"] = [
        {
            **snapshot["experiment_runs"][0],
            "run_no": "RUN-AXIS-OLD",
            "id": "RUN-AXIS-OLD",
            "status": "实验进行中",
            "axis_codes": ["z-", "y+"],
        }
    ]
    snapshot["experiment_run_trays"] = [
        {
            **snapshot["experiment_run_trays"][0],
            "run_no": "RUN-AXIS-OLD",
            "status": "实验进行中",
            "run_tray_status": "实验进行中",
        }
    ]
    snapshot["experiment_run_steps"] = [
        {
            "run_no": "RUN-AXIS-OLD",
            "task_code": "TASK-AXIS",
            "experiment_code": "EXP-IMPACT",
            "sub_experiment_code": sub_experiment_code,
            "axis_code": "z-",
            "step_no": 1,
            "status": "实验进行中",
        },
        {
            "run_no": "RUN-AXIS-OLD",
            "task_code": "TASK-AXIS",
            "experiment_code": "EXP-IMPACT",
            "sub_experiment_code": sub_experiment_code,
            "axis_code": "y+",
            "step_no": 2,
            "status": "待执行",
        },
    ]

    result = start_storage_laboratory_experiment(
        snapshot,
        task_code="TASK-AXIS",
        experiment_code="EXP-IMPACT",
        run_no="RUN-AXIS-NEW",
        lab_name="冲击一室",
        schedule_id="SCH-AXIS-1",
        tray_codes=["TP-AXIS"],
        started_at="2026-06-24 09:30:00",
    )

    runs = {run["run_no"]: run for run in result["experimentRuns"]}
    relations = {relation["run_no"]: relation for relation in result["experimentRunTrays"]}
    assert runs["RUN-AXIS-OLD"]["status"] == "实验已完成"
    assert runs["RUN-AXIS-OLD"]["ended_at"] == "2026-06-24 09:30:00"
    assert relations["RUN-AXIS-OLD"]["run_tray_status"] == "实验已完成"
    assert relations["RUN-AXIS-OLD"]["ended_at"] == "2026-06-24 09:30:00"
    assert runs["RUN-AXIS-NEW"]["status"] == "实验进行中"
    assert relations["RUN-AXIS-NEW"]["run_tray_status"] == "实验进行中"


def test_start_axis_run_rejects_axis_batch_without_sub_experiment_code():
    snapshot = _axis_snapshot()
    for schedule in snapshot["schedules"]:
        schedule.pop("sub_experiment_code", None)
        schedule["axis_batch_no"] = "001"
    snapshot["experiment_runs"] = []
    snapshot["experiment_run_trays"] = []
    snapshot["experiment_run_steps"] = []
    snapshot["schedules"][0]["status"] = "已排程"

    with pytest.raises(ValueError, match="sub_experiment_code is required"):
        start_storage_laboratory_experiment(
            snapshot,
            task_code="TASK-AXIS",
            experiment_code="EXP-IMPACT",
            run_no="RUN-AXIS-SCH-1",
            lab_name="冲击一室",
            schedule_id="SCH-AXIS-1",
            tray_codes=["TP-AXIS"],
            started_at="2026-06-24 09:00:00",
        )


def test_axis_step_completion_keeps_experiment_running_until_all_planned_axes_finish():
    snapshot = _axis_snapshot()
    sub_experiment_code = snapshot["schedules"][0]["sub_experiment_code"]
    snapshot["experiments"][0]["axis_codes"] = ["x+", "x-", "y+"]
    snapshot["schedules"] = [snapshot["schedules"][0]]
    snapshot["schedules"][0]["axis_codes"] = ["x+", "x-", "y+"]
    snapshot["experiment_runs"][0]["axis_codes"] = ["x+", "x-", "y+"]
    snapshot["experiment_run_steps"] = [
        {"run_no": "RUN-AXIS", "task_code": "TASK-AXIS", "experiment_code": "EXP-IMPACT", "sub_experiment_code": sub_experiment_code, "axis_code": "x+", "step_no": 1, "status": "实验进行中"},
        {"run_no": "RUN-AXIS", "task_code": "TASK-AXIS", "experiment_code": "EXP-IMPACT", "sub_experiment_code": sub_experiment_code, "axis_code": "x-", "step_no": 2, "status": "待执行"},
        {"run_no": "RUN-AXIS", "task_code": "TASK-AXIS", "experiment_code": "EXP-IMPACT", "sub_experiment_code": sub_experiment_code, "axis_code": "y+", "step_no": 3, "status": "待执行"},
    ]

    result = complete_storage_laboratory_axis_step(
        snapshot,
        task_code="TASK-AXIS",
        experiment_code="EXP-IMPACT",
        run_no="RUN-AXIS",
        axis_code="x+",
        completed_at="2026-06-24 10:00:00",
    )

    steps = {step["axis_code"]: step["status"] for step in result["experimentRunSteps"]}
    assert steps["x+"] == "实验已完成"
    assert steps["x-"] == "实验进行中"
    assert result["samples"][0]["trays"][0]["status"] == "实验进行中"
    assert result["experiments"][0]["status"] == "实验进行中"
    assert result["schedules"][0]["status"] == "实验进行中"


def test_axis_step_completion_uses_standard_next_axis_sequence():
    snapshot = _axis_snapshot()
    snapshot["experiments"][0]["axis_codes"] = ["z-", "x+", "x-"]
    snapshot["schedules"] = [snapshot["schedules"][0]]
    snapshot["schedules"][0]["axis_codes"] = ["z-", "x+", "x-"]
    snapshot["experiment_runs"][0]["axis_codes"] = ["z-", "x+", "x-"]
    sub_experiment_code = snapshot["schedules"][0]["sub_experiment_code"]
    snapshot["experiment_run_steps"] = [
        {"run_no": "RUN-AXIS", "task_code": "TASK-AXIS", "experiment_code": "EXP-IMPACT", "sub_experiment_code": sub_experiment_code, "axis_code": "x+", "step_no": 1, "status": "实验进行中"},
        {"run_no": "RUN-AXIS", "task_code": "TASK-AXIS", "experiment_code": "EXP-IMPACT", "sub_experiment_code": sub_experiment_code, "axis_code": "x-", "step_no": 2, "status": "待执行"},
        {"run_no": "RUN-AXIS", "task_code": "TASK-AXIS", "experiment_code": "EXP-IMPACT", "sub_experiment_code": sub_experiment_code, "axis_code": "z-", "step_no": 3, "status": "待执行"},
    ]

    result = complete_storage_laboratory_axis_step(
        snapshot,
        task_code="TASK-AXIS",
        experiment_code="EXP-IMPACT",
        run_no="RUN-AXIS",
        axis_code="x+",
        next_axis_code="z-",
        completed_at="2026-06-24 10:00:00",
    )

    steps = {step["axis_code"]: step["status"] for step in result["experimentRunSteps"]}
    assert steps["x+"] == "实验已完成"
    assert steps["x-"] == "实验进行中"
    assert steps["z-"] == "待执行"


def test_axis_step_completion_uses_scheduled_axes_when_current_run_is_partial():
    snapshot = _axis_snapshot()
    snapshot["experiments"][0]["axis_codes"] = ["z-", "y+", "x-", "x+"]
    snapshot["experiment_runs"][0]["axis_codes"] = ["z-", "y+"]
    snapshot["experiment_run_steps"] = [
        step for step in snapshot["experiment_run_steps"] if step["axis_code"] in {"z-", "y+"}
    ]

    result = complete_storage_laboratory_axis_step(
        snapshot,
        task_code="TASK-AXIS",
        experiment_code="EXP-IMPACT",
        run_no="RUN-AXIS",
        axis_code="y+",
        completed_at="2026-06-24 10:00:00",
    )

    steps = {step["axis_code"]: step["status"] for step in result["experimentRunSteps"]}
    assert steps["y+"] == "实验已完成"
    assert set(steps) == {"z-", "y+"}
    assert result["experimentRuns"][0]["status"] == "实验已完成"
    assert result["samples"][0]["status"] == "冲击试验部分完成 2/4轴"
    assert result["samples"][0]["flow_status"] == "冲击试验部分完成 2/4轴"
    assert result["samples"][0]["trays"][0]["status"] == "冲击试验部分完成 2/4轴"
    assert not any(
        entry.get("detail") == "TASK-AXIS / 冲击试验 / 实验已完成"
        for entry in result["samples"][0]["history"]
    )
    assert result["experiments"][0]["status"] == "实验进行中"
    assert result["schedules"][0]["status"] == "实验已完成"
    assert result["schedules"][1]["status"] == "已排程"


def test_axis_step_completion_closes_superseded_running_run_for_same_tray_scope():
    snapshot = _axis_snapshot()
    sub_experiment_code = snapshot["schedules"][0]["sub_experiment_code"]
    snapshot["experiments"][0]["axis_codes"] = ["z-", "y+"]
    snapshot["schedules"] = [snapshot["schedules"][0]]
    snapshot["schedules"][0]["axis_codes"] = ["z-", "y+"]
    snapshot["experiment_runs"] = [
        {
            **snapshot["experiment_runs"][0],
            "run_no": "RUN-AXIS-OLD",
            "id": "RUN-AXIS-OLD",
            "status": "实验进行中",
            "axis_codes": ["z-", "y+"],
        },
        {
            **snapshot["experiment_runs"][0],
            "run_no": "RUN-AXIS",
            "id": "RUN-AXIS",
            "status": "实验进行中",
            "axis_codes": ["z-", "y+"],
        },
    ]
    snapshot["experiment_run_trays"] = [
        {
            **snapshot["experiment_run_trays"][0],
            "run_no": "RUN-AXIS-OLD",
            "status": "实验进行中",
            "run_tray_status": "实验进行中",
        },
        {
            **snapshot["experiment_run_trays"][0],
            "run_no": "RUN-AXIS",
            "status": "实验进行中",
            "run_tray_status": "实验进行中",
        },
    ]
    snapshot["experiment_run_steps"] = [
        {
            "run_no": "RUN-AXIS-OLD",
            "task_code": "TASK-AXIS",
            "experiment_code": "EXP-IMPACT",
            "sub_experiment_code": sub_experiment_code,
            "axis_code": "z-",
            "step_no": 1,
            "status": "实验进行中",
        },
        {
            "run_no": "RUN-AXIS-OLD",
            "task_code": "TASK-AXIS",
            "experiment_code": "EXP-IMPACT",
            "sub_experiment_code": sub_experiment_code,
            "axis_code": "y+",
            "step_no": 2,
            "status": "待执行",
        },
        {
            "run_no": "RUN-AXIS",
            "task_code": "TASK-AXIS",
            "experiment_code": "EXP-IMPACT",
            "sub_experiment_code": sub_experiment_code,
            "axis_code": "z-",
            "step_no": 1,
            "status": "实验已完成",
        },
        {
            "run_no": "RUN-AXIS",
            "task_code": "TASK-AXIS",
            "experiment_code": "EXP-IMPACT",
            "sub_experiment_code": sub_experiment_code,
            "axis_code": "y+",
            "step_no": 2,
            "status": "实验进行中",
        },
    ]

    result = complete_storage_laboratory_axis_step(
        snapshot,
        task_code="TASK-AXIS",
        experiment_code="EXP-IMPACT",
        run_no="RUN-AXIS",
        axis_code="y+",
        completed_at="2026-06-24 10:00:00",
    )

    runs = {run["run_no"]: run for run in result["experimentRuns"]}
    relations = {relation["run_no"]: relation for relation in result["experimentRunTrays"]}
    assert runs["RUN-AXIS-OLD"]["status"] == "实验已完成"
    assert runs["RUN-AXIS-OLD"]["ended_at"] == "2026-06-24 10:00:00"
    assert relations["RUN-AXIS-OLD"]["run_tray_status"] == "实验已完成"
    assert relations["RUN-AXIS-OLD"]["ended_at"] == "2026-06-24 10:00:00"
    assert runs["RUN-AXIS"]["status"] == "实验已完成"
    assert relations["RUN-AXIS"]["run_tray_status"] == "实验已完成"


def test_axis_step_completion_does_not_count_axes_from_another_tray():
    snapshot = _axis_snapshot()
    sub_experiment_code = snapshot["schedules"][0]["sub_experiment_code"]
    axis_codes = ["y-", "z+", "z-"]
    snapshot["experiments"][0]["axis_codes"] = axis_codes
    snapshot["schedules"] = [
        {
            **snapshot["schedules"][0],
            "axis_codes": axis_codes,
            "status": "实验进行中",
        }
    ]
    snapshot["experiment_runs"] = [
        {
            **snapshot["experiment_runs"][0],
            "run_no": "RUN-AXIS-TP1",
            "id": "RUN-AXIS-TP1",
            "status": "实验已完成",
            "axis_codes": axis_codes,
        },
        {
            **snapshot["experiment_runs"][0],
            "run_no": "RUN-AXIS-TP2",
            "id": "RUN-AXIS-TP2",
            "status": "实验进行中",
            "axis_codes": axis_codes,
        },
    ]
    snapshot["experiment_run_trays"] = [
        {
            **snapshot["experiment_run_trays"][0],
            "run_no": "RUN-AXIS-TP1",
            "tray_code": "TP-AXIS-1",
            "status": "实验已完成",
            "run_tray_status": "实验已完成",
        },
        {
            **snapshot["experiment_run_trays"][0],
            "run_no": "RUN-AXIS-TP2",
            "tray_code": "TP-AXIS-2",
            "status": "实验进行中",
            "run_tray_status": "实验进行中",
        },
    ]
    snapshot["experiment_run_steps"] = [
        {
            "run_no": "RUN-AXIS-TP1",
            "task_code": "TASK-AXIS",
            "experiment_code": "EXP-IMPACT",
            "sub_experiment_code": sub_experiment_code,
            "axis_code": axis_code,
            "step_no": index,
            "status": "实验已完成",
        }
        for index, axis_code in enumerate(axis_codes, start=1)
    ] + [
        {
            "run_no": "RUN-AXIS-TP2",
            "task_code": "TASK-AXIS",
            "experiment_code": "EXP-IMPACT",
            "sub_experiment_code": sub_experiment_code,
            "axis_code": "y-",
            "step_no": 1,
            "status": "实验进行中",
        },
        {
            "run_no": "RUN-AXIS-TP2",
            "task_code": "TASK-AXIS",
            "experiment_code": "EXP-IMPACT",
            "sub_experiment_code": sub_experiment_code,
            "axis_code": "z+",
            "step_no": 2,
            "status": "待执行",
        },
        {
            "run_no": "RUN-AXIS-TP2",
            "task_code": "TASK-AXIS",
            "experiment_code": "EXP-IMPACT",
            "sub_experiment_code": sub_experiment_code,
            "axis_code": "z-",
            "step_no": 3,
            "status": "待执行",
        },
    ]
    snapshot["experiment_trays"] = [
        {"task_code": "TASK-AXIS", "experiment_code": "EXP-IMPACT", "tray_code": "TP-AXIS-1"},
        {"task_code": "TASK-AXIS", "experiment_code": "EXP-IMPACT", "tray_code": "TP-AXIS-2"},
    ]
    snapshot["experiment_samples"] = [
        {"task_code": "TASK-AXIS", "experiment_code": "EXP-IMPACT", "sample_code": "SP-AXIS-1"},
        {"task_code": "TASK-AXIS", "experiment_code": "EXP-IMPACT", "sample_code": "SP-AXIS-2"},
    ]
    snapshot["samples"] = [
        _sample("SP-AXIS-1", "TASK-AXIS", "TP-AXIS-1", "实验已完成", "冲击一室"),
        _sample("SP-AXIS-2", "TASK-AXIS", "TP-AXIS-2", "实验进行中", "冲击一室"),
    ]

    result = complete_storage_laboratory_axis_step(
        snapshot,
        task_code="TASK-AXIS",
        experiment_code="EXP-IMPACT",
        run_no="RUN-AXIS-TP2",
        axis_code="y-",
        next_axis_code="z+",
        completed_at="2026-06-24 10:00:00",
    )

    current_steps = {
        step["axis_code"]: step["status"]
        for step in result["experimentRunSteps"]
        if step["run_no"] == "RUN-AXIS-TP2"
    }
    current_run = next(run for run in result["experimentRuns"] if run["run_no"] == "RUN-AXIS-TP2")
    current_relation = next(relation for relation in result["experimentRunTrays"] if relation["run_no"] == "RUN-AXIS-TP2")

    assert current_steps == {"y-": "实验已完成", "z+": "实验进行中", "z-": "待执行"}
    assert current_run["status"] == "实验进行中"
    assert current_relation["run_tray_status"] == "实验进行中"
    assert result["experiments"][0]["status"] == "实验进行中"
    assert result["schedules"][0]["status"] == "实验进行中"


def test_axis_step_completion_keeps_second_tray_running_when_first_tray_finished_all_axes():
    snapshot = _axis_snapshot()
    sub_experiment_code = snapshot["schedules"][0]["sub_experiment_code"]
    axis_codes = ["x+", "x-", "y+", "y-", "z+", "z-"]
    snapshot["experiments"][0]["axis_codes"] = axis_codes
    snapshot["schedules"] = [
        {
            **snapshot["schedules"][0],
            "axis_codes": axis_codes,
            "status": "实验进行中",
        }
    ]
    snapshot["experiment_runs"] = [
        {
            **snapshot["experiment_runs"][0],
            "run_no": "RUN-AXIS-TP1",
            "id": "RUN-AXIS-TP1",
            "status": "实验已完成",
            "axis_codes": axis_codes,
        },
        {
            **snapshot["experiment_runs"][0],
            "run_no": "RUN-AXIS-TP2",
            "id": "RUN-AXIS-TP2",
            "status": "实验进行中",
            "axis_codes": axis_codes,
        },
    ]
    snapshot["experiment_run_trays"] = [
        {
            **snapshot["experiment_run_trays"][0],
            "run_no": "RUN-AXIS-TP1",
            "tray_code": "TP-AXIS-1",
            "status": "实验已完成",
            "run_tray_status": "实验已完成",
        },
        {
            **snapshot["experiment_run_trays"][0],
            "run_no": "RUN-AXIS-TP2",
            "tray_code": "TP-AXIS-2",
            "status": "实验进行中",
            "run_tray_status": "实验进行中",
        },
    ]
    snapshot["experiment_run_steps"] = [
        {
            "run_no": "RUN-AXIS-TP1",
            "task_code": "TASK-AXIS",
            "experiment_code": "EXP-IMPACT",
            "sub_experiment_code": sub_experiment_code,
            "axis_code": axis_code,
            "step_no": index,
            "status": "实验已完成",
        }
        for index, axis_code in enumerate(axis_codes, start=1)
    ] + [
        {
            "run_no": "RUN-AXIS-TP2",
            "task_code": "TASK-AXIS",
            "experiment_code": "EXP-IMPACT",
            "sub_experiment_code": sub_experiment_code,
            "axis_code": axis_code,
            "step_no": index,
            "status": "实验进行中" if index == 1 else "待执行",
        }
        for index, axis_code in enumerate(axis_codes, start=1)
    ]
    snapshot["experiment_trays"] = [
        {"task_code": "TASK-AXIS", "experiment_code": "EXP-IMPACT", "tray_code": "TP-AXIS-1"},
        {"task_code": "TASK-AXIS", "experiment_code": "EXP-IMPACT", "tray_code": "TP-AXIS-2"},
    ]
    snapshot["experiment_samples"] = [
        {"task_code": "TASK-AXIS", "experiment_code": "EXP-IMPACT", "sample_code": "SP-AXIS-1"},
        {"task_code": "TASK-AXIS", "experiment_code": "EXP-IMPACT", "sample_code": "SP-AXIS-2"},
    ]
    snapshot["samples"] = [
        _sample("SP-AXIS-1", "TASK-AXIS", "TP-AXIS-1", "实验已完成", "冲击一室"),
        _sample("SP-AXIS-2", "TASK-AXIS", "TP-AXIS-2", "实验进行中", "冲击一室"),
    ]

    result = complete_storage_laboratory_axis_step(
        snapshot,
        task_code="TASK-AXIS",
        experiment_code="EXP-IMPACT",
        run_no="RUN-AXIS-TP2",
        axis_code="x+",
        next_axis_code="x-",
        completed_at="2026-06-24 10:00:00",
    )

    current_steps = {
        step["axis_code"]: step["status"]
        for step in result["experimentRunSteps"]
        if step["run_no"] == "RUN-AXIS-TP2"
    }
    current_run = next(run for run in result["experimentRuns"] if run["run_no"] == "RUN-AXIS-TP2")
    current_relation = next(relation for relation in result["experimentRunTrays"] if relation["run_no"] == "RUN-AXIS-TP2")

    assert current_steps["x+"] == "实验已完成"
    assert current_steps["x-"] == "实验进行中"
    assert all(status == "待执行" for axis, status in current_steps.items() if axis not in {"x+", "x-"})
    assert current_run["status"] == "实验进行中"
    assert current_relation["run_tray_status"] == "实验进行中"
    assert result["schedules"][0]["status"] == "实验进行中"


def test_axis_run_completion_without_axis_code_keeps_experiment_running_when_axes_remain():
    snapshot = _axis_snapshot()
    snapshot["experiments"][0]["axis_codes"] = ["z-", "y+", "x-", "x+"]
    snapshot["experiment_runs"][0]["axis_codes"] = ["z-", "y+"]
    snapshot["experiment_run_steps"] = [
        step for step in snapshot["experiment_run_steps"] if step["axis_code"] in {"z-", "y+"}
    ]

    result = complete_storage_laboratory_experiment(
        snapshot,
        task_code="TASK-AXIS",
        experiment_code="EXP-IMPACT",
        run_no="RUN-AXIS",
        completed_at="2026-06-24 10:00:00",
    )

    assert result["samples"][0]["status"] == "冲击试验部分完成 2/4轴"
    assert result["samples"][0]["trays"][0]["status"] == "冲击试验部分完成 2/4轴"
    assert not any(
        entry.get("detail") == "TASK-AXIS / 冲击试验 / 实验已完成"
        for entry in result["samples"][0]["history"]
    )
    assert result["experimentRuns"][0]["status"] == "实验已完成"
    assert result["experimentRunTrays"][0]["run_tray_status"] == "实验已完成"
    assert result["experiments"][0]["status"] == "实验进行中"
    assert result["schedules"][0]["status"] == "实验已完成"
    assert result["schedules"][1]["status"] == "已排程"


def test_axis_run_completion_without_axis_code_does_not_count_axes_from_another_tray():
    snapshot = _axis_snapshot()
    sub_experiment_code = snapshot["schedules"][0]["sub_experiment_code"]
    axis_codes = ["x+", "x-", "y+", "y-", "z+", "z-"]
    current_run_axes = ["x+", "x-"]
    snapshot["experiments"][0]["axis_codes"] = axis_codes
    snapshot["schedules"] = [
        {
            **snapshot["schedules"][0],
            "axis_codes": current_run_axes,
            "status": "实验进行中",
        }
    ]
    snapshot["experiment_runs"] = [
        {
            **snapshot["experiment_runs"][0],
            "run_no": "RUN-AXIS-TP1",
            "id": "RUN-AXIS-TP1",
            "status": "实验已完成",
            "axis_codes": axis_codes,
        },
        {
            **snapshot["experiment_runs"][0],
            "run_no": "RUN-AXIS-TP2",
            "id": "RUN-AXIS-TP2",
            "status": "实验进行中",
            "axis_codes": current_run_axes,
        },
    ]
    snapshot["experiment_run_trays"] = [
        {
            **snapshot["experiment_run_trays"][0],
            "run_no": "RUN-AXIS-TP1",
            "tray_code": "TP-AXIS-1",
            "status": "实验已完成",
            "run_tray_status": "实验已完成",
        },
        {
            **snapshot["experiment_run_trays"][0],
            "run_no": "RUN-AXIS-TP2",
            "tray_code": "TP-AXIS-2",
            "status": "实验进行中",
            "run_tray_status": "实验进行中",
        },
    ]
    snapshot["experiment_run_steps"] = [
        {
            "run_no": "RUN-AXIS-TP1",
            "task_code": "TASK-AXIS",
            "experiment_code": "EXP-IMPACT",
            "sub_experiment_code": sub_experiment_code,
            "axis_code": axis_code,
            "step_no": index,
            "status": "实验已完成",
        }
        for index, axis_code in enumerate(axis_codes, start=1)
    ] + [
        {
            "run_no": "RUN-AXIS-TP2",
            "task_code": "TASK-AXIS",
            "experiment_code": "EXP-IMPACT",
            "sub_experiment_code": sub_experiment_code,
            "axis_code": axis_code,
            "step_no": index,
            "status": "实验已完成",
        }
        for index, axis_code in enumerate(current_run_axes, start=1)
    ]
    snapshot["experiment_trays"] = [
        {"task_code": "TASK-AXIS", "experiment_code": "EXP-IMPACT", "tray_code": "TP-AXIS-1"},
        {"task_code": "TASK-AXIS", "experiment_code": "EXP-IMPACT", "tray_code": "TP-AXIS-2"},
    ]
    snapshot["experiment_samples"] = [
        {"task_code": "TASK-AXIS", "experiment_code": "EXP-IMPACT", "sample_code": "SP-AXIS-1"},
        {"task_code": "TASK-AXIS", "experiment_code": "EXP-IMPACT", "sample_code": "SP-AXIS-2"},
    ]
    snapshot["samples"] = [
        _sample("SP-AXIS-1", "TASK-AXIS", "TP-AXIS-1", "实验已完成", "冲击一室"),
        _sample("SP-AXIS-2", "TASK-AXIS", "TP-AXIS-2", "实验进行中", "冲击一室"),
    ]

    result = complete_storage_laboratory_experiment(
        snapshot,
        task_code="TASK-AXIS",
        experiment_code="EXP-IMPACT",
        sub_experiment_code=sub_experiment_code,
        run_no="RUN-AXIS-TP2",
        completed_at="2026-06-24 10:00:00",
    )

    current_sample = next(sample for sample in result["samples"] if sample["code"] == "SP-AXIS-2")
    current_run = next(run for run in result["experimentRuns"] if run["run_no"] == "RUN-AXIS-TP2")
    current_relation = next(relation for relation in result["experimentRunTrays"] if relation["run_no"] == "RUN-AXIS-TP2")

    assert current_sample["status"] == "冲击试验部分完成 2/6轴"
    assert current_sample["trays"][0]["status"] == "冲击试验部分完成 2/6轴"
    assert current_run["status"] == "实验已完成"
    assert current_relation["run_tray_status"] == "实验已完成"
    assert result["experiments"][0]["status"] == "实验进行中"
    assert result["schedules"][0]["status"] == "实验已完成"


def test_split_axis_completion_marks_current_tray_completed_even_when_other_trays_remain():
    snapshot = _axis_snapshot()
    axis_codes = ["x+", "x-", "y+", "y-", "z+", "z-"]
    first_sub_code = "EXP-IMPACT-AXIS-001"
    second_sub_code = "EXP-IMPACT-AXIS-002"
    snapshot["experiments"][0]["axis_codes"] = axis_codes
    snapshot["schedules"] = [
        {
            **snapshot["schedules"][0],
            "id": "SCH-AXIS-1",
            "sub_experiment_code": first_sub_code,
            "axis_codes": ["x+", "x-", "y+"],
            "status": "实验已完成",
        },
        {
            **snapshot["schedules"][1],
            "id": "SCH-AXIS-2",
            "sub_experiment_code": second_sub_code,
            "axis_codes": ["y-", "z+", "z-"],
            "status": "实验进行中",
        },
    ]
    snapshot["experiment_runs"] = [
        {
            **snapshot["experiment_runs"][0],
            "run_no": "RUN-TP1-A",
            "id": "RUN-TP1-A",
            "schedule_id": "SCH-AXIS-1",
            "sub_experiment_code": first_sub_code,
            "status": "实验已完成",
            "axis_codes": ["x+", "x-", "y+"],
        },
        {
            **snapshot["experiment_runs"][0],
            "run_no": "RUN-TP1-B",
            "id": "RUN-TP1-B",
            "schedule_id": "SCH-AXIS-2",
            "sub_experiment_code": second_sub_code,
            "status": "实验进行中",
            "axis_codes": ["y-", "z+", "z-"],
        },
        {
            **snapshot["experiment_runs"][0],
            "run_no": "RUN-TP2-A",
            "id": "RUN-TP2-A",
            "schedule_id": "SCH-AXIS-1",
            "sub_experiment_code": first_sub_code,
            "status": "实验已完成",
            "axis_codes": ["x+", "x-", "y+"],
        },
    ]
    snapshot["experiment_run_trays"] = [
        {
            **snapshot["experiment_run_trays"][0],
            "run_no": "RUN-TP1-A",
            "sub_experiment_code": first_sub_code,
            "tray_code": "TP-AXIS-1",
            "status": "实验已完成",
            "run_tray_status": "实验已完成",
        },
        {
            **snapshot["experiment_run_trays"][0],
            "run_no": "RUN-TP1-B",
            "sub_experiment_code": second_sub_code,
            "tray_code": "TP-AXIS-1",
            "status": "实验进行中",
            "run_tray_status": "实验进行中",
        },
        {
            **snapshot["experiment_run_trays"][0],
            "run_no": "RUN-TP2-A",
            "sub_experiment_code": first_sub_code,
            "tray_code": "TP-AXIS-2",
            "status": "实验已完成",
            "run_tray_status": "实验已完成",
        },
    ]
    snapshot["experiment_run_steps"] = [
        {
            "run_no": "RUN-TP1-A",
            "task_code": "TASK-AXIS",
            "experiment_code": "EXP-IMPACT",
            "sub_experiment_code": first_sub_code,
            "axis_code": axis_code,
            "step_no": index,
            "status": "实验已完成",
        }
        for index, axis_code in enumerate(["x+", "x-", "y+"], start=1)
    ] + [
        {
            "run_no": "RUN-TP1-B",
            "task_code": "TASK-AXIS",
            "experiment_code": "EXP-IMPACT",
            "sub_experiment_code": second_sub_code,
            "axis_code": axis_code,
            "step_no": index,
            "status": "实验已完成",
        }
        for index, axis_code in enumerate(["y-", "z+", "z-"], start=1)
    ] + [
        {
            "run_no": "RUN-TP2-A",
            "task_code": "TASK-AXIS",
            "experiment_code": "EXP-IMPACT",
            "sub_experiment_code": first_sub_code,
            "axis_code": axis_code,
            "step_no": index,
            "status": "实验已完成",
        }
        for index, axis_code in enumerate(["x+", "x-", "y+"], start=1)
    ]
    snapshot["experiment_trays"] = [
        {"task_code": "TASK-AXIS", "experiment_code": "EXP-IMPACT", "tray_code": "TP-AXIS-1"},
        {"task_code": "TASK-AXIS", "experiment_code": "EXP-IMPACT", "tray_code": "TP-AXIS-2"},
    ]
    snapshot["experiment_samples"] = [
        {"task_code": "TASK-AXIS", "experiment_code": "EXP-IMPACT", "sample_code": "SP-AXIS-1"},
        {"task_code": "TASK-AXIS", "experiment_code": "EXP-IMPACT", "sample_code": "SP-AXIS-2"},
    ]
    snapshot["samples"] = [
        _sample("SP-AXIS-1", "TASK-AXIS", "TP-AXIS-1", "实验进行中", "冲击一室"),
        _sample("SP-AXIS-2", "TASK-AXIS", "TP-AXIS-2", "冲击试验部分完成 3/6轴", "冲击一室"),
    ]

    result = complete_storage_laboratory_experiment(
        snapshot,
        task_code="TASK-AXIS",
        experiment_code="EXP-IMPACT",
        run_no="RUN-TP1-B",
        completed_at="2026-06-24 11:00:00",
    )

    completed_sample = next(sample for sample in result["samples"] if sample["code"] == "SP-AXIS-1")
    remaining_sample = next(sample for sample in result["samples"] if sample["code"] == "SP-AXIS-2")

    assert completed_sample["status"] == "实验已完成"
    assert completed_sample["flow_status"] == "实验已完成"
    assert completed_sample["trays"][0]["status"] == "实验已完成"
    assert "target_lab" not in completed_sample["trays"][0]
    assert any(
        entry.get("detail") == "TASK-AXIS / 冲击试验 / 实验已完成"
        for entry in completed_sample["history"]
    )
    assert remaining_sample["status"] == "冲击试验部分完成 3/6轴"
    assert result["experiments"][0]["status"] == "实验进行中"


def test_axis_batch_completion_keeps_schedule_open_until_all_assigned_trays_finish():
    snapshot = _axis_snapshot()
    snapshot["experiments"][0]["axis_codes"] = ["z-", "y+"]
    snapshot["schedules"] = [snapshot["schedules"][0]]
    snapshot["experiment_runs"][0]["axis_codes"] = ["z-", "y+"]
    snapshot["experiment_run_steps"] = [
        step for step in snapshot["experiment_run_steps"] if step["axis_code"] in {"z-", "y+"}
    ]
    snapshot["experiment_run_steps"][0]["status"] = "实验已完成"
    snapshot["experiment_run_steps"][1]["status"] = "实验进行中"
    snapshot["experiment_trays"].append(
        {"task_code": "TASK-AXIS", "experiment_code": "EXP-IMPACT", "tray_code": "TP-AXIS-2"}
    )
    snapshot["experiment_samples"].append(
        {"task_code": "TASK-AXIS", "experiment_code": "EXP-IMPACT", "sample_code": "SP-AXIS-2"}
    )
    snapshot["samples"].append(_sample("SP-AXIS-2", "TASK-AXIS", "TP-AXIS-2", "实验准备就绪", "冲击一室"))

    result = complete_storage_laboratory_axis_step(
        snapshot,
        task_code="TASK-AXIS",
        experiment_code="EXP-IMPACT",
        run_no="RUN-AXIS",
        axis_code="y+",
        completed_at="2026-06-24 10:00:00",
    )

    assert result["experimentRuns"][0]["status"] == "实验已完成"
    assert result["experimentRunTrays"][0]["run_tray_status"] == "实验已完成"
    assert result["experiments"][0]["status"] == "实验进行中"
    assert result["schedules"][0]["status"] == "实验进行中"
    assert result["samples"][1]["trays"][0]["status"] == "实验准备就绪"


def test_axis_batches_use_sub_experiment_code_for_independent_run_lifecycle():
    snapshot = _axis_snapshot()
    first_sub_code = "EXP-IMPACT-AXIS-001"
    second_sub_code = "EXP-IMPACT-AXIS-002"
    snapshot["experiments"][0]["axis_codes"] = ["z-", "y+", "x-", "x+"]
    snapshot["schedules"][0]["sub_experiment_code"] = first_sub_code
    snapshot["schedules"][0]["axis_batch_no"] = "001"
    snapshot["schedules"][1]["sub_experiment_code"] = second_sub_code
    snapshot["schedules"][1]["axis_batch_no"] = "002"
    snapshot["experiment_runs"][0]["sub_experiment_code"] = first_sub_code
    snapshot["experiment_runs"][0]["axis_codes"] = ["z-", "y+"]
    snapshot["experiment_run_trays"][0]["sub_experiment_code"] = first_sub_code
    snapshot["experiment_run_steps"] = [
        {**step, "sub_experiment_code": first_sub_code}
        for step in snapshot["experiment_run_steps"]
        if step["axis_code"] in {"z-", "y+"}
    ]
    snapshot["experiment_run_steps"][0]["status"] = "实验已完成"
    snapshot["experiment_run_steps"][1]["status"] = "实验进行中"

    first_done = complete_storage_laboratory_axis_step(
        snapshot,
        task_code="TASK-AXIS",
        experiment_code="EXP-IMPACT",
        sub_experiment_code=first_sub_code,
        run_no="RUN-AXIS",
        axis_code="y+",
        completed_at="2026-06-24 10:00:00",
    )

    assert first_done["experiments"][0]["status"] == "实验进行中"
    assert first_done["schedules"][0]["status"] == "实验已完成"
    assert first_done["schedules"][1]["status"] == "已排程"
    assert first_done["samples"][0]["status"] == "冲击试验部分完成 2/4轴"
    assert first_done["samples"][0]["flow_status"] == "冲击试验部分完成 2/4轴"
    assert first_done["samples"][0]["trays"][0]["status"] == "冲击试验部分完成 2/4轴"
    assert not any(
        entry.get("detail") == "TASK-AXIS / 冲击试验 / 实验已完成"
        for entry in first_done["samples"][0]["history"]
    )

    second_started = start_storage_laboratory_experiment(
        {
            **snapshot,
            "experiments": first_done["experiments"],
            "experiment_runs": first_done["experimentRuns"],
            "experiment_run_trays": first_done["experimentRunTrays"],
            "experiment_run_steps": first_done["experimentRunSteps"],
            "samples": first_done["samples"],
            "schedules": first_done["schedules"],
        },
        task_code="TASK-AXIS",
        experiment_code="EXP-IMPACT",
        sub_experiment_code=second_sub_code,
        run_no="RUN-AXIS-2",
        lab_name="冲击一室",
        schedule_id="SCH-AXIS-2",
        tray_codes=["TP-AXIS"],
        started_at="2026-06-24 10:00:00",
    )

    runs = {run["run_no"]: run for run in second_started["experimentRuns"]}
    assert runs["RUN-AXIS"]["sub_experiment_code"] == first_sub_code
    assert runs["RUN-AXIS"]["status"] == "实验已完成"
    assert runs["RUN-AXIS-2"]["sub_experiment_code"] == second_sub_code
    assert runs["RUN-AXIS-2"]["axis_codes"] == ["x+", "x-"]
    assert {
        step["axis_code"]
        for step in second_started["experimentRunSteps"]
        if step["run_no"] == "RUN-AXIS-2"
    } == {"x-", "x+"}
    assert second_started["experiments"][0]["status"] == "实验进行中"
    assert second_started["schedules"][1]["status"] == "实验进行中"


def test_final_axis_step_completion_completes_the_experiment():
    snapshot = _axis_snapshot()
    for step in snapshot["experiment_run_steps"]:
        step["status"] = "实验已完成" if step["axis_code"] != "x+" else "实验进行中"

    result = complete_storage_laboratory_axis_step(
        snapshot,
        task_code="TASK-AXIS",
        experiment_code="EXP-IMPACT",
        run_no="RUN-AXIS",
        axis_code="x+",
        completed_at="2026-06-24 11:00:00",
    )

    assert all(step["status"] == "实验已完成" for step in result["experimentRunSteps"])
    assert result["samples"][0]["trays"][0]["status"] == "实验已完成"
    assert result["experiments"][0]["status"] == "实验已完成"
    assert result["schedules"][0]["status"] == "实验已完成"


def test_final_axis_step_completion_can_finish_axes_across_split_runs():
    snapshot = _axis_snapshot()
    snapshot["experiments"][0]["axis_codes"] = ["z-", "y+", "x-", "x+"]
    snapshot["experiment_runs"] = [
        {
            **snapshot["experiment_runs"][0],
            "run_no": "RUN-AXIS-OLD",
            "id": "RUN-AXIS-OLD",
            "schedule_id": "SCH-AXIS-1",
            "status": "实验已完成",
            "axis_codes": ["z-", "y+"],
        },
        {
            **snapshot["experiment_runs"][0],
            "run_no": "RUN-AXIS",
            "id": "RUN-AXIS",
            "schedule_id": "SCH-AXIS-2",
            "status": "实验进行中",
            "axis_codes": ["x-", "x+"],
        },
    ]
    snapshot["experiment_run_trays"] = [
        {
            **snapshot["experiment_run_trays"][0],
            "run_no": "RUN-AXIS-OLD",
            "status": "实验已完成",
            "run_tray_status": "实验已完成",
        },
        {
            **snapshot["experiment_run_trays"][0],
            "run_no": "RUN-AXIS",
            "status": "实验进行中",
            "run_tray_status": "实验进行中",
        },
    ]
    sub_experiment_code = snapshot["schedules"][0]["sub_experiment_code"]
    snapshot["experiment_run_steps"] = [
        {"run_no": "RUN-AXIS-OLD", "task_code": "TASK-AXIS", "experiment_code": "EXP-IMPACT", "sub_experiment_code": sub_experiment_code, "axis_code": "z-", "step_no": 1, "status": "实验已完成"},
        {"run_no": "RUN-AXIS-OLD", "task_code": "TASK-AXIS", "experiment_code": "EXP-IMPACT", "sub_experiment_code": sub_experiment_code, "axis_code": "y+", "step_no": 2, "status": "实验已完成"},
        {"run_no": "RUN-AXIS", "task_code": "TASK-AXIS", "experiment_code": "EXP-IMPACT", "sub_experiment_code": sub_experiment_code, "axis_code": "x-", "step_no": 1, "status": "实验已完成"},
        {"run_no": "RUN-AXIS", "task_code": "TASK-AXIS", "experiment_code": "EXP-IMPACT", "sub_experiment_code": sub_experiment_code, "axis_code": "x+", "step_no": 2, "status": "实验进行中"},
    ]

    result = complete_storage_laboratory_axis_step(
        snapshot,
        task_code="TASK-AXIS",
        experiment_code="EXP-IMPACT",
        run_no="RUN-AXIS",
        axis_code="x+",
        completed_at="2026-06-24 11:00:00",
    )

    assert result["samples"][0]["trays"][0]["status"] == "实验已完成"
    assert result["experiments"][0]["status"] == "实验已完成"
    assert all(schedule["status"] == "实验已完成" for schedule in result["schedules"])


def test_mqtt_sample_scope_delegates_to_shared_laboratory_scope(monkeypatch):
    calls = []
    snapshot = {"samples": []}
    scoped = {"samples": [{"code": "SP-1"}]}

    def fake_scope(snapshot_arg, *, task_code, experiment_code, tray_codes):
        calls.append(
            {
                "snapshot": snapshot_arg,
                "task_code": task_code,
                "experiment_code": experiment_code,
                "tray_codes": tray_codes,
            }
        )
        return scoped

    monkeypatch.setattr(mq_event_processor, "scope_laboratory_samples_for_experiment", fake_scope)

    result = mq_event_processor.scope_snapshot_samples_for_experiment(
        snapshot,
        task_code="TASK-1",
        experiment_code="EXP-VIB",
        tray_codes=["TP-1"],
    )

    assert result is scoped
    assert calls == [
        {
            "snapshot": snapshot,
            "task_code": "TASK-1",
            "experiment_code": "EXP-VIB",
            "tray_codes": ["TP-1"],
        }
    ]


def test_start_rejects_missing_sample_relation_and_target_without_legacy_tray_fallback():
    snapshot = {
        "tasks": [{"code": "TASK-1", "status": "任务进行中"}],
        "experiments": [{"task_code": "TASK-1", "experiment_code": "EXP-A", "experiment_name": "盐雾试验"}],
        "schedules": [{"id": "SCH-A", "task_code": "TASK-1", "experiment_code": "EXP-A", "device": "盐雾试验室"}],
        "experiment_runs": [],
        "experiment_run_trays": [],
        "experiment_trays": [{"task_code": "TASK-1", "experiment_code": "EXP-A", "tray_code": "TP-A"}],
        "experiment_samples": [],
        "samples": [
            _sample("SP-A", "TASK-1", "TP-A", "实验准备就绪", "盐雾试验室"),
            _sample("SP-B", "TASK-1", "TP-B", "实验准备就绪", "霉菌试验室"),
        ],
    }

    with pytest.raises(ValueError, match="current experiment has no matching"):
        start_storage_laboratory_experiment(
            snapshot,
            task_code="TASK-1",
            experiment_code="EXP-A",
            run_no="RUN-A",
            lab_name="盐雾试验室",
            schedule_id="SCH-A",
            tray_codes=["TP-A"],
            started_at="2026-06-06 09:00:00",
        )


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


def test_complete_removes_schedule_when_other_assigned_tray_was_returned_earlier():
    snapshot = {
        "experiments": [
            {
                "task_code": "TASK-MIXED-TERMINAL",
                "experiment_code": "EXP-A",
                "experiment_name": "四综合试验",
                "status": "实验进行中",
            }
        ],
        "schedules": [
            {
                "id": "SCH-A",
                "task_code": "TASK-MIXED-TERMINAL",
                "experiment_code": "EXP-A",
                "device": "四综合实验室",
                "status": "实验进行中",
            }
        ],
        "experiment_runs": [
            {
                "run_no": "RUN-A",
                "task_code": "TASK-MIXED-TERMINAL",
                "experiment_code": "EXP-A",
                "tray_codes": ["TP-COMPLETING"],
                "status": "实验进行中",
            }
        ],
        "experiment_run_trays": [
            {
                "run_no": "RUN-A",
                "task_code": "TASK-MIXED-TERMINAL",
                "experiment_code": "EXP-A",
                "tray_code": "TP-COMPLETING",
                "run_tray_status": "实验进行中",
            },
            {
                "run_no": "RETURNED-EXP-A",
                "task_code": "TASK-MIXED-TERMINAL",
                "experiment_code": "EXP-A",
                "tray_code": "TP-RETURNED",
                "run_tray_status": "厂家收回",
            },
        ],
        "experiment_trays": [
            {"task_code": "TASK-MIXED-TERMINAL", "experiment_code": "EXP-A", "tray_code": "TP-COMPLETING"},
            {"task_code": "TASK-MIXED-TERMINAL", "experiment_code": "EXP-A", "tray_code": "TP-RETURNED"},
        ],
        "experiment_samples": [
            {"task_code": "TASK-MIXED-TERMINAL", "experiment_code": "EXP-A", "sample_code": "SP-COMPLETING"},
            {"task_code": "TASK-MIXED-TERMINAL", "experiment_code": "EXP-A", "sample_code": "SP-RETURNED"},
        ],
        "staging_events": [
            {
                "action": "manufacturer_return",
                "task_code": "TASK-MIXED-TERMINAL",
                "tray_code": "TP-RETURNED",
                "time": "2026-07-25 09:00:00",
            }
        ],
        "samples": [
            _sample("SP-COMPLETING", "TASK-MIXED-TERMINAL", "TP-COMPLETING", "实验进行中", "四综合实验室"),
            _sample("SP-RETURNED", "TASK-MIXED-TERMINAL", "TP-RETURNED", "厂家收回", "厂家收回"),
        ],
    }

    result = complete_storage_laboratory_experiment(
        snapshot,
        task_code="TASK-MIXED-TERMINAL",
        experiment_code="EXP-A",
        run_no="RUN-A",
        tray_codes=["TP-COMPLETING"],
        completed_at="2026-07-25 10:00:00",
    )

    assert result["schedules"] == []
    assert result["experiments"][0]["status"] == "实验已完成"
    assert {
        relation["tray_code"]: relation["run_tray_status"]
        for relation in result["experimentRunTrays"]
    } == {
        "TP-COMPLETING": "实验已完成",
        "TP-RETURNED": "厂家收回",
    }


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
        "experiment_samples": [{"task_code": "TASK-1", "experiment_code": "EXP-A", "sample_code": "SP-A"}],
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
    assert result["samples"][0]["location"] == "盐雾试验室"
    assert result["samples"][0]["status"] == "实验已完成"
    assert result["samples"][0]["trays"][0]["status"] == "实验已完成"
    assert result["samples"][1]["trays"][0]["status"] == "实验进行中"
    assert result["experimentRunTrays"][0]["tray_code"] == "TP-A"


def test_complete_ignores_requested_trays_not_bound_to_current_run():
    snapshot = {
        "experiments": [{"task_code": "TASK-1", "experiment_code": "EXP-A", "experiment_name": "冲击试验"}],
        "schedules": [{"id": "SCH-A", "task_code": "TASK-1", "experiment_code": "EXP-A", "device": "冲击一室"}],
        "experiment_runs": [
            {
                "run_no": "RUN-A",
                "task_code": "TASK-1",
                "experiment_code": "EXP-A",
                "tray_codes": ["TP-RUNNING"],
                "status": "实验进行中",
            }
        ],
        "experiment_run_trays": [
            {
                "run_no": "RUN-A",
                "task_code": "TASK-1",
                "experiment_code": "EXP-A",
                "tray_code": "TP-RUNNING",
                "run_tray_status": "实验进行中",
            }
        ],
        "experiment_trays": [
            {"task_code": "TASK-1", "experiment_code": "EXP-A", "tray_code": "TP-RUNNING"},
            {"task_code": "TASK-1", "experiment_code": "EXP-A", "tray_code": "TP-ARRIVED"},
        ],
        "experiment_samples": [
            {"task_code": "TASK-1", "experiment_code": "EXP-A", "sample_code": "SP-RUNNING"},
            {"task_code": "TASK-1", "experiment_code": "EXP-A", "sample_code": "SP-ARRIVED"},
        ],
        "samples": [
            _sample("SP-RUNNING", "TASK-1", "TP-RUNNING", "实验进行中", "冲击一室"),
            _sample("SP-ARRIVED", "TASK-1", "TP-ARRIVED", "到货", "接驳区"),
        ],
    }

    result = complete_storage_laboratory_experiment(
        snapshot,
        task_code="TASK-1",
        experiment_code="EXP-A",
        run_no="RUN-A",
        tray_codes=["TP-RUNNING", "TP-ARRIVED"],
        completed_at="2026-06-06 10:00:00",
    )

    assert result["affectedTrayCodes"] == ["TP-RUNNING"]
    assert result["samples"][0]["trays"][0]["status"] == "实验已完成"
    assert result["samples"][1]["trays"][0]["status"] == "到货"
    assert [item["tray_code"] for item in result["experimentRunTrays"]] == ["TP-RUNNING"]


def test_complete_clears_stale_fixture_ready_marker():
    sample = _sample("SP-A", "TASK-1", "TP-A", "实验进行中", "盐雾试验室")
    sample["trays"][0]["fixture_ready"] = True
    sample["trays"][0]["fixtureReady"] = True
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
        "experiment_run_trays": [],
        "experiment_trays": [{"task_code": "TASK-1", "experiment_code": "EXP-A", "tray_code": "TP-A"}],
        "experiment_samples": [{"task_code": "TASK-1", "experiment_code": "EXP-A", "sample_code": "SP-A"}],
        "samples": [sample],
    }

    result = complete_storage_laboratory_experiment(
        snapshot,
        task_code="TASK-1",
        experiment_code="EXP-A",
        run_no="RUN-A",
        tray_codes=["TP-A"],
        completed_at="2026-06-06 10:00:00",
    )

    tray = result["samples"][0]["trays"][0]
    assert tray["status"] == "实验已完成"
    assert "fixture_ready" not in tray
    assert "fixtureReady" not in tray


def test_complete_rejects_missing_sample_relation_and_target_without_legacy_tray_fallback():
    snapshot = {
        "experiments": [{"task_code": "TASK-1", "experiment_code": "EXP-A", "experiment_name": "振动试验"}],
        "schedules": [{"id": "SCH-A", "task_code": "TASK-1", "experiment_code": "EXP-A", "device": "振动一室"}],
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
        "experiment_trays": [{"task_code": "TASK-1", "experiment_code": "EXP-A", "tray_code": "TP-A"}],
        "experiment_samples": [],
        "samples": [
            _sample("SP-A", "TASK-1", "TP-A", "实验进行中", "振动一室"),
            _sample("SP-B", "TASK-1", "TP-B", "实验进行中", "霉菌试验室"),
        ],
    }

    with pytest.raises(ValueError, match="current experiment has no matching tray samples"):
        complete_storage_laboratory_experiment(
            snapshot,
            task_code="TASK-1",
            experiment_code="EXP-A",
            run_no="RUN-A",
            tray_codes=["TP-A"],
            completed_at="2026-06-06 10:00:00",
        )


def test_complete_keeps_mold_and_salt_trays_at_neutral_completed_status():
    for experiment_name, lab_name in (("盐雾试验", "盐雾试验室"), ("霉菌试验", "霉菌试验室")):
        snapshot = {
            "experiments": [{"task_code": "TASK-APPEAR", "experiment_code": "EXP-A", "experiment_name": experiment_name}],
            "schedules": [{"id": "SCH-A", "task_code": "TASK-APPEAR", "experiment_code": "EXP-A", "device": lab_name}],
            "experiment_runs": [
                {
                    "run_no": "RUN-A",
                    "task_code": "TASK-APPEAR",
                    "experiment_code": "EXP-A",
                    "tray_codes": ["TP-A"],
                    "status": "实验进行中",
                }
            ],
            "experiment_run_trays": [],
            "experiment_trays": [{"task_code": "TASK-APPEAR", "experiment_code": "EXP-A", "tray_code": "TP-A"}],
            "experiment_samples": [{"task_code": "TASK-APPEAR", "experiment_code": "EXP-A", "sample_code": "SP-A"}],
            "samples": [_sample("SP-A", "TASK-APPEAR", "TP-A", "实验进行中", lab_name)],
        }

        result = complete_storage_laboratory_experiment(
            snapshot,
            task_code="TASK-APPEAR",
            experiment_code="EXP-A",
            run_no="RUN-A",
            tray_codes=["TP-A"],
            completed_at="2026-06-06 10:00:00",
        )

        assert result["samples"][0]["location"] == lab_name
        assert result["samples"][0]["status"] == "实验已完成"
        assert result["samples"][0]["flow_status"] == "实验已完成"
        assert result["samples"][0]["trays"][0]["status"] == "实验已完成"
        assert result["experimentRunTrays"][-1]["run_tray_status"] == "实验已完成"


def test_complete_writes_tray_code_to_experiment_history_entry():
    snapshot = {
        "experiments": [{"task_code": "TASK-HISTORY", "experiment_code": "EXP-A", "experiment_name": "冲击试验"}],
        "schedules": [{"id": "SCH-A", "task_code": "TASK-HISTORY", "experiment_code": "EXP-A", "device": "冲击一室"}],
        "experiment_runs": [],
        "experiment_run_trays": [],
        "experiment_trays": [{"task_code": "TASK-HISTORY", "experiment_code": "EXP-A", "tray_code": "TP-A"}],
        "experiment_samples": [{"task_code": "TASK-HISTORY", "experiment_code": "EXP-A", "sample_code": "SP-A"}],
        "samples": [_sample("SP-A", "TASK-HISTORY", "TP-A", "实验进行中", "冲击一室")],
    }

    result = complete_storage_laboratory_experiment(
        snapshot,
        task_code="TASK-HISTORY",
        experiment_code="EXP-A",
        tray_codes=["TP-A"],
        completed_at="2026-06-06 10:00:00",
    )

    assert result["samples"][0]["history"][0]["tray_code"] == "TP-A"


def test_complete_does_not_route_other_experiments_to_appearance_inspection_room():
    snapshot = {
        "experiments": [{"task_code": "TASK-VIB", "experiment_code": "EXP-VIB", "experiment_name": "振动试验"}],
        "schedules": [{"id": "SCH-VIB", "task_code": "TASK-VIB", "experiment_code": "EXP-VIB", "device": "振动一室"}],
        "experiment_runs": [],
        "experiment_run_trays": [],
        "experiment_trays": [{"task_code": "TASK-VIB", "experiment_code": "EXP-VIB", "tray_code": "TP-VIB"}],
        "experiment_samples": [{"task_code": "TASK-VIB", "experiment_code": "EXP-VIB", "sample_code": "SP-VIB"}],
        "samples": [_sample("SP-VIB", "TASK-VIB", "TP-VIB", "实验进行中", "振动一室")],
    }

    result = complete_storage_laboratory_experiment(
        snapshot,
        task_code="TASK-VIB",
        experiment_code="EXP-VIB",
        tray_codes=["TP-VIB"],
        completed_at="2026-06-06 10:00:00",
    )

    assert result["samples"][0]["location"] == "振动一室"
    assert result["samples"][0]["status"] == "实验已完成"
    assert result["samples"][0]["trays"][0]["status"] == "实验已完成"


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


def test_complete_rejects_single_tray_auto_completion_without_tray_codes_or_run_relation():
    snapshot = {
        "experiments": [{"task_code": "TASK-1", "experiment_code": "EXP-A", "experiment_name": "振动试验"}],
        "schedules": [{"task_code": "TASK-1", "experiment_code": "EXP-A", "device": "振动一室"}],
        "experiment_runs": [],
        "experiment_run_trays": [],
        "experiment_trays": [{"task_code": "TASK-1", "experiment_code": "EXP-A", "tray_code": "TP-A"}],
        "experiment_samples": [{"task_code": "TASK-1", "experiment_code": "EXP-A", "sample_code": "SP-A"}],
        "samples": [_sample("SP-A", "TASK-1", "TP-A", "实验进行中", "振动一室")],
    }

    with pytest.raises(ValueError, match="trayCodes"):
        complete_storage_laboratory_experiment(
            snapshot,
            task_code="TASK-1",
            experiment_code="EXP-A",
            completed_at="2026-06-06 10:00:00",
        )

    assert snapshot["samples"][0]["trays"][0]["status"] == "实验进行中"


def test_complete_rejects_run_tray_codes_fallback_without_structured_run_relation():
    snapshot = {
        "experiments": [{"task_code": "TASK-1", "experiment_code": "EXP-A", "experiment_name": "振动试验"}],
        "schedules": [{"task_code": "TASK-1", "experiment_code": "EXP-A", "device": "振动一室"}],
        "experiment_runs": [
            {
                "run_no": "RUN-A",
                "task_code": "TASK-1",
                "experiment_code": "EXP-A",
                "tray_codes": ["TP-A"],
                "status": "实验进行中",
            }
        ],
        "experiment_run_trays": [],
        "experiment_trays": [{"task_code": "TASK-1", "experiment_code": "EXP-A", "tray_code": "TP-A"}],
        "experiment_samples": [{"task_code": "TASK-1", "experiment_code": "EXP-A", "sample_code": "SP-A"}],
        "samples": [_sample("SP-A", "TASK-1", "TP-A", "实验进行中", "振动一室")],
    }

    with pytest.raises(ValueError, match="experiment_run_trays"):
        complete_storage_laboratory_experiment(
            snapshot,
            task_code="TASK-1",
            experiment_code="EXP-A",
            run_no="RUN-A",
            completed_at="2026-06-06 10:00:00",
        )

    assert snapshot["samples"][0]["trays"][0]["status"] == "实验进行中"


def test_complete_does_not_mark_run_completed_from_run_tray_codes_without_structured_relation():
    snapshot = {
        "experiments": [{"task_code": "TASK-1", "experiment_code": "EXP-A", "experiment_name": "振动试验"}],
        "schedules": [{"task_code": "TASK-1", "experiment_code": "EXP-A", "device": "振动一室"}],
        "experiment_runs": [
            {
                "run_no": "RUN-A",
                "task_code": "TASK-1",
                "experiment_code": "EXP-A",
                "tray_codes": ["TP-A"],
                "status": "实验进行中",
            }
        ],
        "experiment_run_trays": [],
        "experiment_trays": [{"task_code": "TASK-1", "experiment_code": "EXP-A", "tray_code": "TP-A"}],
        "experiment_samples": [{"task_code": "TASK-1", "experiment_code": "EXP-A", "sample_code": "SP-A"}],
        "samples": [_sample("SP-A", "TASK-1", "TP-A", "实验进行中", "振动一室")],
    }

    result = complete_storage_laboratory_experiment(
        snapshot,
        task_code="TASK-1",
        experiment_code="EXP-A",
        tray_codes=["TP-A"],
        completed_at="2026-06-06 10:00:00",
    )

    assert result["affectedTrayCodes"] == ["TP-A"]
    assert result["experimentRuns"][0]["status"] == "实验进行中"
