from copy import deepcopy

from app.services.storage_staging_policy import _post_staging_reentry_is_completed


def test_post_staging_reentry_uses_completed_axis_runs_after_schedules_are_cleaned() -> None:
    task_code = "SYLU-2026-07-022"
    tray_code = f"{task_code}-TP-002"
    axis_experiment_code = f"{task_code}-C"
    salt_experiment_code = f"{task_code}-B"
    axes_by_run = {
        "RUN-IMPACT-001": ["x+", "x-", "y+"],
        "RUN-IMPACT-002": ["y-", "z+", "z-"],
    }
    arguments = {
        "sample": {"task_code": task_code},
        "tray": {"tray_code": tray_code},
        "experiments": [
            {
                "task_code": task_code,
                "experiment_code": axis_experiment_code,
                "axis_codes": [axis for axes in axes_by_run.values() for axis in axes],
            },
            {"task_code": task_code, "experiment_code": salt_experiment_code},
        ],
        "experiment_runs": [
            {
                "run_no": run_no,
                "task_code": task_code,
                "experiment_code": axis_experiment_code,
                "axis_codes": axes,
                "status": "实验已完成",
            }
            for run_no, axes in axes_by_run.items()
        ],
        "experiment_run_steps": [],
        "experiment_trays": [
            {"task_code": task_code, "experiment_code": experiment_code, "tray_code": tray_code}
            for experiment_code in (axis_experiment_code, salt_experiment_code)
        ],
        "experiment_run_trays": [
            {
                "run_no": run_no,
                "task_code": task_code,
                "experiment_code": axis_experiment_code,
                "sub_experiment_code": f"{axis_experiment_code}#AXIS-{index:03d}",
                "tray_code": tray_code,
                "run_tray_status": "实验已完成",
            }
            for index, run_no in enumerate(axes_by_run, start=1)
        ]
        + [
            {
                "run_no": "RUN-SALT-001",
                "task_code": task_code,
                "experiment_code": salt_experiment_code,
                "tray_code": tray_code,
                "run_tray_status": "实验已完成",
            }
        ],
        "schedules": [],
    }

    assert _post_staging_reentry_is_completed(**arguments) is True

    unfinished = deepcopy(arguments)
    unfinished["experiment_run_trays"][1]["run_tray_status"] = "实验进行中"
    assert _post_staging_reentry_is_completed(**unfinished) is False
