"""Pure mapping between storage keys and laboratory workflow snapshots."""

from typing import Any


SNAPSHOT_KEYS = {
    "tasks": "mes.tasks",
    "samples": "mes.samples",
    "schedules": "mes.schedules",
    "experiments": "mes.experiments",
    "experiment_runs": "mes.experiment_runs",
    "experiment_run_trays": "mes.experiment_run_trays",
    "experiment_run_steps": "mes.experiment_run_steps",
    "experiment_trays": "mes.experiment_trays",
    "experiment_samples": "mes.experiment_samples",
    "staging_events": "mes.staging_events",
}


def snapshot_from_storage_payload(payload: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    return {
        name: [dict(item) for item in value if isinstance(item, dict)]
        for name, key in SNAPSHOT_KEYS.items()
        for value in [payload.get(key) if isinstance(payload.get(key), list) else []]
    }


def completion_updates(result: dict[str, Any]) -> dict[str, Any]:
    payload = {
        "mes.samples": result["samples"],
        "mes.experiments": result["experiments"],
        "mes.schedules": result["schedules"],
        "mes.experiment_runs": result["experimentRuns"],
        "mes.experiment_run_trays": result["experimentRunTrays"],
    }
    if "experimentRunSteps" in result:
        payload["mes.experiment_run_steps"] = result["experimentRunSteps"]
    return payload


def start_updates(
    original_snapshot: dict[str, list[dict[str, Any]]],
    result: dict[str, Any],
    *,
    merged_samples: list[dict[str, Any]],
) -> dict[str, Any]:
    payload = {
        "mes.tasks": result["tasks"],
        "mes.samples": merged_samples,
        "mes.experiments": result["experiments"],
        "mes.schedules": result["schedules"],
        "mes.experiment_runs": result["experimentRuns"],
        "mes.experiment_run_trays": result["experimentRunTrays"],
    }
    if "experimentRunSteps" in result:
        payload["mes.experiment_run_steps"] = result["experimentRunSteps"]
    return payload
