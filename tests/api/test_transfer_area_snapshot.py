from __future__ import annotations

from app.api.routes.transfer_area_snapshot import (
    TRANSFER_BOOTSTRAP_READ_FIELDS,
    TRANSFER_SNAPSHOT_STORAGE_KEYS,
    TRANSFER_WORKSPACE_READ_FIELDS,
    hydrate_transfer_snapshot_for_write,
    read_transfer_snapshot,
)


def build_payloads() -> dict[str, list[dict[str, str]]]:
    return {
        storage_key: [{"id": field, "value": f"payload-{field}"}]
        for field, storage_key in TRANSFER_SNAPSHOT_STORAGE_KEYS.items()
    }


class TrackingStorage:
    def __init__(self, payloads=None, *, supports_read_many=True):
        self.payloads = payloads or build_payloads()
        self.read_all_calls = 0
        self.read_many_calls = []
        if not supports_read_many:
            self.read_many = None

    def read_all(self):
        self.read_all_calls += 1
        return {key: list(value) for key, value in self.payloads.items()}

    def read_many(self, keys):
        requested_keys = list(keys)
        self.read_many_calls.append(requested_keys)
        return {key: list(self.payloads.get(key, [])) for key in requested_keys}


def test_bootstrap_snapshot_reads_status_dependencies_instead_of_the_full_transfer_snapshot() -> None:
    storage = TrackingStorage()

    snapshot = read_transfer_snapshot(storage, TRANSFER_BOOTSTRAP_READ_FIELDS)

    assert tuple(snapshot) == TRANSFER_BOOTSTRAP_READ_FIELDS
    assert storage.read_many_calls == [[
        "mes.tasks",
        "mes.samples",
        "mes.schedules",
        "mes.experiments",
        "mes.experiment_run_trays",
        "mes.experiment_trays",
        "mes.staging_events",
    ]]
    assert storage.read_all_calls == 0
    assert len(storage.read_many_calls[0]) == 7
    assert len(TRANSFER_SNAPSHOT_STORAGE_KEYS) == 11


def test_workspace_snapshot_reads_eight_keys_and_preserves_selected_payload_contract() -> None:
    storage = TrackingStorage()

    snapshot = read_transfer_snapshot(storage, TRANSFER_WORKSPACE_READ_FIELDS)

    assert tuple(snapshot) == TRANSFER_WORKSPACE_READ_FIELDS
    assert storage.read_many_calls == [[
        "mes.tasks",
        "mes.samples",
        "mes.schedules",
        "mes.experiments",
        "mes.experiment_run_trays",
        "mes.experiment_trays",
        "mes.experiment_samples",
        "mes.staging_events",
    ]]
    for field in TRANSFER_WORKSPACE_READ_FIELDS:
        assert snapshot[field] == [{"id": field, "value": f"payload-{field}"}]


def test_snapshot_reader_falls_back_to_one_full_read_for_legacy_storage_backends() -> None:
    storage = TrackingStorage(supports_read_many=False)

    snapshot = read_transfer_snapshot(storage, TRANSFER_BOOTSTRAP_READ_FIELDS)

    assert tuple(snapshot) == TRANSFER_BOOTSTRAP_READ_FIELDS
    assert storage.read_all_calls == 1


def test_snapshot_reader_uses_task_scope_when_requested() -> None:
    class TaskScopedStorage(TrackingStorage):
        def __init__(self):
            super().__init__()
            self.scope_reads = []

        def read_task_scope(self, task_codes, keys):
            requested_keys = list(keys)
            self.scope_reads.append((set(task_codes), requested_keys))
            return {key: list(self.payloads.get(key, [])) for key in requested_keys}

    storage = TaskScopedStorage()

    snapshot = read_transfer_snapshot(
        storage,
        TRANSFER_WORKSPACE_READ_FIELDS,
        task_codes={"TASK-SCOPED"},
    )

    assert tuple(snapshot) == TRANSFER_WORKSPACE_READ_FIELDS
    assert storage.scope_reads == [
        ({"TASK-SCOPED"}, [TRANSFER_SNAPSHOT_STORAGE_KEYS[field] for field in TRANSFER_WORKSPACE_READ_FIELDS])
    ]
    assert storage.read_many_calls == []
    assert storage.read_all_calls == 0


def test_hydration_reads_only_missing_fields_and_keeps_mutated_rows() -> None:
    storage = TrackingStorage()
    partial_snapshot = read_transfer_snapshot(storage, TRANSFER_BOOTSTRAP_READ_FIELDS)
    partial_snapshot["tasks"][0]["value"] = "mutated-task"
    storage.read_many_calls.clear()

    hydrated = hydrate_transfer_snapshot_for_write(storage, partial_snapshot)

    assert tuple(hydrated) == (
        "experiment_runs",
        "experiment_run_steps",
        "experiment_samples",
        "devices",
        "tasks",
        "samples",
        "schedules",
        "experiments",
        "experiment_run_trays",
        "experiment_trays",
        "staging_events",
    )
    assert hydrated["tasks"][0]["value"] == "mutated-task"
    assert storage.read_many_calls == [[
        "mes.experiment_runs",
        "mes.experiment_run_steps",
        "mes.experiment_samples",
        "mes.devices",
    ]]


def test_partial_snapshot_matches_full_normalization_for_manufacturer_return_state() -> None:
    payloads = build_payloads()
    payloads.update({
        "mes.tasks": [{"code": "TASK-RETURN", "status": "实验进行中"}],
        "mes.samples": [{
            "code": "SAMPLE-RETURN",
            "task_code": "TASK-RETURN",
            "status": "实验进行中",
            "trays": [{"tray_code": "TRAY-RETURN", "status": "实验进行中"}],
        }],
        "mes.schedules": [{
            "id": "SCHEDULE-RETURN",
            "task_code": "TASK-RETURN",
            "experiment_code": "EXP-RETURN",
        }],
        "mes.experiments": [{
            "task_code": "TASK-RETURN",
            "experiment_code": "EXP-RETURN",
            "status": "实验进行中",
        }],
        "mes.experiment_run_trays": [{
            "task_code": "TASK-RETURN",
            "experiment_code": "EXP-RETURN",
            "tray_code": "TRAY-RETURN",
            "status": "实验进行中",
        }],
        "mes.experiment_trays": [{
            "task_code": "TASK-RETURN",
            "experiment_code": "EXP-RETURN",
            "tray_code": "TRAY-RETURN",
        }],
        "mes.staging_events": [{
            "action": "manufacturer_return",
            "event_time": "2026-07-24 12:00:00",
            "task_code": "TASK-RETURN",
            "tray_code": "TRAY-RETURN",
        }],
    })
    storage = TrackingStorage(payloads)

    full_snapshot = read_transfer_snapshot(storage)
    partial_snapshot = read_transfer_snapshot(storage, TRANSFER_BOOTSTRAP_READ_FIELDS)

    assert partial_snapshot == {
        field: full_snapshot[field]
        for field in TRANSFER_BOOTSTRAP_READ_FIELDS
    }
    assert partial_snapshot["tasks"][0]["status"] == "厂家收回"
    assert partial_snapshot["samples"][0]["status"] == "厂家收回"
