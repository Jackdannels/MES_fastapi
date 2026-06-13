import pytest

from app.core.legacy_fallback import reset_legacy_fallback_hits
from app.services import mq_event_processor
from app.services.laboratory_completion import complete_storage_laboratory_experiment
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


def test_pre_experiment_appearance_routing_requires_salt_mold_target_and_handover_or_staging_origin():
    from app.services.appearance_inspection import should_route_pre_experiment_appearance

    experiments = [
        {"task_code": "TASK-1", "experiment_code": "EXP-SALT", "experiment_name": "盐雾试验"},
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
    assert not should_route_pre_experiment_appearance(
        source_location="",
        source_status="已入库",
        target_lab="盐雾试验室",
        target_experiment_code="EXP-SALT",
        experiments=experiments,
    )
    assert not should_route_pre_experiment_appearance(
        source_location="外观检测间",
        source_status="实验前外观检测存放",
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
    assert result["samples"][0]["location"] == "外观检测间"
    assert result["samples"][0]["status"] == "送至外观检测间"
    assert result["samples"][0]["trays"][0]["status"] == "送至外观检测间"
    assert result["samples"][1]["trays"][0]["status"] == "实验进行中"
    assert result["experimentRunTrays"][0]["tray_code"] == "TP-A"


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
    assert tray["status"] == "送至外观检测间"
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


def test_complete_routes_mold_and_salt_trays_to_appearance_inspection_room():
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

        assert result["samples"][0]["location"] == "外观检测间"
        assert result["samples"][0]["status"] == "送至外观检测间"
        assert result["samples"][0]["flow_status"] == "送至外观检测间"
        assert result["samples"][0]["trays"][0]["status"] == "送至外观检测间"
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
