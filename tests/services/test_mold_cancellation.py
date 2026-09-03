import pytest

from app.api.routes.storage import _run_trays_have_allowed_appearance_source
from app.services.experiment_schedule_sequence import resolve_next_scheduled_step
from app.services.laboratory_termination import cancel_storage_mold_experiment
from app.services.storage_tray_actions import StorageTrayActionError, build_stock_in_updates


def mold_snapshot():
    return {
        "tasks": [{"code": "TASK-MOLD", "status": "任务进行中"}],
        "experiments": [
            {
                "task_code": "TASK-MOLD",
                "experiment_code": "EXP-MOLD",
                "experiment_name": "霉菌试验",
                "status": "实验进行中",
                "unscheduled_since": "",
            },
            {
                "task_code": "TASK-MOLD",
                "experiment_code": "EXP-OTHER",
                "experiment_name": "冲击试验",
                "status": "已排程",
            },
        ],
        "schedules": [
            {
                "id": "SCH-MOLD",
                "task_code": "TASK-MOLD",
                "experiment_code": "EXP-MOLD",
                "device": "霉菌试验室",
                "status": "实验进行中",
            },
            {
                "id": "SCH-OTHER",
                "task_code": "TASK-MOLD",
                "experiment_code": "EXP-OTHER",
                "device": "冲击一室",
                "status": "已排程",
            },
        ],
        "experiment_runs": [
            {
                "run_no": "RUN-MOLD",
                "schedule_id": "SCH-MOLD",
                "task_code": "TASK-MOLD",
                "experiment_code": "EXP-MOLD",
                "device": "霉菌试验室",
                "status": "实验进行中",
            }
        ],
        "experiment_run_trays": [
            {
                "run_no": "RUN-MOLD",
                "task_code": "TASK-MOLD",
                "experiment_code": "EXP-MOLD",
                "tray_code": tray_code,
                "run_tray_status": "实验进行中",
            }
            for tray_code in ("TP-1", "TP-2")
        ],
        "experiment_trays": [
            {
                "task_code": "TASK-MOLD",
                "experiment_code": experiment_code,
                "tray_code": tray_code,
            }
            for experiment_code in ("EXP-MOLD", "EXP-OTHER")
            for tray_code in ("TP-1", "TP-2")
        ],
        "experiment_samples": [
            {
                "task_code": "TASK-MOLD",
                "experiment_code": "EXP-MOLD",
                "sample_code": sample_code,
            }
            for sample_code in ("SP-1", "SP-2")
        ],
        "samples": [
            {
                "code": sample_code,
                "task_code": "TASK-MOLD",
                "status": "实验进行中",
                "flow_status": "实验进行中",
                "location": "霉菌试验室",
                "history": [],
                "trays": [
                    {
                        "tray_code": tray_code,
                        "status": "实验进行中",
                        "target_lab": "霉菌试验室",
                        "target_experiment_code": "EXP-MOLD",
                        "fixture_ready": True,
                        "fixture_install_id": "FIXTURE-1",
                    }
                ],
            }
            for sample_code, tray_code in (("SP-1", "TP-1"), ("SP-2", "TP-2"))
        ],
    }


def canceled_mold_storage_snapshot():
    source = mold_snapshot()
    result = cancel_storage_mold_experiment(
        source,
        task_code="TASK-MOLD",
        experiment_code="EXP-MOLD",
        run_no="RUN-MOLD",
        canceled_at="2026-09-03 11:20:00",
        cancel_reason="霉菌未按预期繁殖",
    )
    return {
        "mes.samples": result["samples"],
        "mes.staging_events": [],
        "mes.experiments": result["experiments"],
        "mes.experiment_run_trays": result["experimentRunTrays"],
    }


def test_cancel_mold_run_recycles_schedule_without_completing_experiment_or_task():
    snapshot = mold_snapshot()
    result = cancel_storage_mold_experiment(
        snapshot,
        task_code="TASK-MOLD",
        experiment_code="EXP-MOLD",
        run_no="RUN-MOLD",
        canceled_at="2026-09-03 11:20:00",
        cancel_reason="霉菌未按预期繁殖",
    )

    assert result["canceledAt"] == "2026-09-03 11:20:00"
    assert result["tasks"][0]["status"] == "任务进行中"
    mold_experiment = next(item for item in result["experiments"] if item["experiment_code"] == "EXP-MOLD")
    assert mold_experiment["status"] == "待排程"
    assert mold_experiment["unscheduled_since"] == "2026-09-03 11:20:00"
    assert [item["id"] for item in result["schedules"]] == ["SCH-OTHER"]
    assert result["experimentRuns"][0]["status"] == "实验已取消"
    assert {item["run_tray_status"] for item in result["experimentRunTrays"]} == {"实验已取消"}
    assert {item["status"] for item in result["samples"]} == {"实验已取消"}
    assert resolve_next_scheduled_step(
        {**result, "experiment_trays": snapshot["experiment_trays"]},
        task_code="TASK-MOLD",
        tray_code="TP-1",
    )["experiment_code"] == "EXP-OTHER"
    for sample in result["samples"]:
        tray = sample["trays"][0]
        assert tray["status"] == "实验已取消"
        assert "target_lab" not in tray
        assert "target_experiment_code" not in tray
        assert "fixture_ready" not in tray
        assert "fixture_install_id" not in tray
        history = sample["history"][0]
        assert history["action"] == "取消本次霉菌实验"
        assert history["status"] == "实验已取消"
        assert "霉菌未按预期繁殖" in history["detail"]


def test_cancel_mold_run_rejects_non_mold_experiment():
    snapshot = mold_snapshot()
    snapshot["experiments"][0]["experiment_name"] = "盐雾试验"

    with pytest.raises(ValueError, match="仅支持霉菌试验"):
        cancel_storage_mold_experiment(
            snapshot,
            task_code="TASK-MOLD",
            experiment_code="EXP-MOLD",
            run_no="RUN-MOLD",
            cancel_reason="取消",
        )


def test_cancel_mold_run_rejects_inconsistent_partial_run_trays():
    snapshot = mold_snapshot()
    snapshot["experiment_run_trays"][1]["run_tray_status"] = "实验已完成"

    with pytest.raises(ValueError, match="全部托盘"):
        cancel_storage_mold_experiment(
            snapshot,
            task_code="TASK-MOLD",
            experiment_code="EXP-MOLD",
            run_no="RUN-MOLD",
            cancel_reason="取消",
        )


def test_canceled_mold_run_is_an_appearance_route_source_without_becoming_completed():
    sample = {"task_code": "TASK-MOLD"}
    tray = {"tray_code": "TP-1"}
    experiments = [
        {
            "task_code": "TASK-MOLD",
            "experiment_code": "EXP-MOLD",
            "experiment_name": "霉菌试验",
            "status": "待排程",
        }
    ]
    canceled_run_trays = [
        {
            "task_code": "TASK-MOLD",
            "experiment_code": "EXP-MOLD",
            "tray_code": "TP-1",
            "run_tray_status": "实验已取消",
        }
    ]

    assert _run_trays_have_allowed_appearance_source(
        sample,
        tray,
        experiments,
        canceled_run_trays,
    )
    assert experiments[0]["status"] == "待排程"


def test_canceled_mold_tray_can_stock_into_staging_with_normal_staging_semantics():
    updates = build_stock_in_updates(
        canceled_mold_storage_snapshot(),
        room="staging",
        tray_code="TP-1",
        payload={"status": "实验后暂存间存放", "location": "错误位置"},
        now="2026-09-03 11:30:00",
    )

    sample = updates["mes.samples"][0]
    assert sample["status"] == "已到达暂存间"
    assert sample["flow_status"] == "已到达暂存间"
    assert sample["location"] == "恒温恒湿间（暂存间）"
    assert sample["trays"][0]["status"] == "已到达暂存间"
    assert updates["mes.staging_events"][0]["status"] == "已到达暂存间"


def test_canceled_mold_tray_can_stock_into_appearance_with_post_experiment_semantics():
    updates = build_stock_in_updates(
        canceled_mold_storage_snapshot(),
        room="appearance",
        tray_code="TP-1",
        payload={"status": "实验前外观检测间存放", "location": "错误位置"},
        now="2026-09-03 11:30:00",
    )

    sample = updates["mes.samples"][0]
    assert sample["status"] == "实验后外观检测间存放"
    assert sample["flow_status"] == "实验后外观检测间存放"
    assert sample["location"] == "外观检测间"
    assert sample["trays"][0]["status"] == "实验后外观检测间存放"
    event = updates["mes.staging_events"][0]
    assert event["status"] == "实验后外观检测间存放"
    assert event["appearance_phase"] == "post_experiment"
    assert event["experiment_code"] == "EXP-MOLD"


@pytest.mark.parametrize(
    "mutate",
    [
        lambda snapshot: snapshot["mes.experiments"][0].update(experiment_name="盐雾试验"),
        lambda snapshot: snapshot["mes.experiment_run_trays"][0].update(task_code="TASK-OTHER"),
        lambda snapshot: snapshot["mes.experiment_run_trays"][0].update(tray_code="TP-OTHER"),
        lambda snapshot: snapshot["mes.experiment_run_trays"][0].update(experiment_code="EXP-OTHER"),
        lambda snapshot: snapshot["mes.experiment_run_trays"][0].update(run_tray_status="实验进行中"),
    ],
    ids=["non-mold", "wrong-task", "wrong-tray", "wrong-experiment", "updated-run-status"],
)
def test_canceled_status_does_not_unlock_storage_without_matching_canceled_mold_run(mutate):
    snapshot = canceled_mold_storage_snapshot()
    mutate(snapshot)

    with pytest.raises(StorageTrayActionError, match="不能暂存间入库"):
        build_stock_in_updates(
            snapshot,
            room="staging",
            tray_code="TP-1",
            payload={},
            now="2026-09-03 11:30:00",
        )


def test_canceled_mold_status_does_not_unlock_storage_after_a_newer_run_update():
    snapshot = canceled_mold_storage_snapshot()
    snapshot["mes.experiment_run_trays"].append(
        {
            "run_no": "RUN-MOLD-2",
            "task_code": "TASK-MOLD",
            "experiment_code": "EXP-MOLD",
            "tray_code": "TP-1",
            "run_tray_status": "实验进行中",
        }
    )

    with pytest.raises(StorageTrayActionError, match="不能外观检测间入库"):
        build_stock_in_updates(
            snapshot,
            room="appearance",
            tray_code="TP-1",
            payload={},
            now="2026-09-03 11:30:00",
        )
