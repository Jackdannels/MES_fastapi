from __future__ import annotations

from app.services import storage_atomic


def test_merge_samples_preserves_first_seen_order_and_newer_payload() -> None:
    current = [
        {"code": "SAMPLE-A", "updated_at": "2026-07-24T08:00:00", "status": "current-a"},
        {"code": "SAMPLE-B", "updated_at": "2026-07-24T08:00:00", "status": "current-b"},
    ]
    incoming = [
        {"code": "SAMPLE-B", "updated_at": "2026-07-24T09:00:00", "status": "incoming-b"},
        {"code": "SAMPLE-C", "updated_at": "2026-07-24T09:00:00", "status": "incoming-c"},
    ]

    merged = storage_atomic.merge_samples(current, incoming)

    assert [sample["code"] for sample in merged] == ["SAMPLE-A", "SAMPLE-B", "SAMPLE-C"]
    assert [sample["status"] for sample in merged] == ["current-a", "incoming-b", "incoming-c"]


def test_merge_samples_deduplicates_order_keys_with_linear_equality_work(monkeypatch) -> None:
    class CountedKey:
        equality_calls = 0

        def __init__(self, value: str) -> None:
            self.value = value

        def __hash__(self) -> int:
            return hash(self.value)

        def __eq__(self, other: object) -> bool:
            type(self).equality_calls += 1
            return isinstance(other, CountedKey) and self.value == other.value

    current = [
        {"_key": CountedKey(f"SAMPLE-{index:03d}"), "updated_at": "2026-07-24T08:00:00"}
        for index in range(80)
    ]
    incoming = [
        {"_key": CountedKey(f"SAMPLE-{index:03d}"), "updated_at": "2026-07-24T09:00:00"}
        for index in range(80)
    ]
    monkeypatch.setattr(storage_atomic, "sample_key", lambda sample: sample["_key"])

    storage_atomic.merge_samples(current, incoming)

    assert CountedKey.equality_calls < 1_000


def test_merge_samples_task_scoped_replacement_drops_only_omitted_target_samples() -> None:
    current = [
        {"code": "TASK-A-SP-001", "task_code": "TASK-A", "updated_at": "2026-07-24T08:00:00"},
        {"code": "TASK-A-SP-002", "task_code": "TASK-A", "updated_at": "2026-07-24T08:00:00"},
        {"code": "TASK-B-SP-001", "task_code": "TASK-B", "updated_at": "2026-07-24T08:00:00"},
        {"code": "TASK-B-SP-002", "task_code": "TASK-B", "updated_at": "2026-07-24T10:00:00"},
    ]
    incoming = [
        {"code": "TASK-A-SP-001", "task_code": "TASK-A", "updated_at": "2026-07-24T09:00:00"},
        {"code": "TASK-B-SP-001", "task_code": "TASK-B", "updated_at": "2026-07-24T09:00:00"},
    ]

    merged = storage_atomic.merge_samples(current, incoming, replace_task_codes={"TASK-A"})

    assert [sample["code"] for sample in merged] == [
        "TASK-A-SP-001",
        "TASK-B-SP-001",
        "TASK-B-SP-002",
    ]


def test_merge_concurrent_storage_updates_forwards_task_scoped_sample_replacement() -> None:
    current = {
        "mes.samples": [
            {"code": "TASK-A-SP-001", "task_code": "TASK-A", "updated_at": "2026-07-24T08:00:00"},
            {"code": "TASK-A-SP-002", "task_code": "TASK-A", "updated_at": "2026-07-24T08:00:00"},
            {"code": "TASK-B-SP-001", "task_code": "TASK-B", "updated_at": "2026-07-24T10:00:00"},
        ],
    }
    updates = {
        "mes.samples": [
            {"code": "TASK-A-SP-001", "task_code": "TASK-A", "updated_at": "2026-07-24T09:00:00"},
        ],
    }

    merged = storage_atomic.merge_concurrent_storage_updates(
        current,
        updates,
        replace_task_codes={"TASK-A"},
    )

    assert [sample["code"] for sample in merged["mes.samples"]] == [
        "TASK-A-SP-001",
        "TASK-B-SP-001",
    ]


def test_generic_storage_merge_does_not_resurrect_renamed_samples_from_a_stale_snapshot() -> None:
    task_code = "SYLU-2026-07-001"
    current_codes = ["CUSTOM-A", "CUSTOM-B", *[f"{task_code}-SP-{index:03d}" for index in range(3, 13)]]
    stale_codes = [f"{task_code}-SP-{index:03d}" for index in range(1, 13)]
    current = {
        "mes.tasks": [{"code": task_code, "sample_count": 12}],
        "mes.samples": [
            {"code": code, "task_code": task_code, "updated_at": "2026-07-30T11:00:00"}
            for code in current_codes
        ],
    }
    stale_update = {
        "mes.samples": [
            {"code": code, "task_code": task_code, "updated_at": "2026-07-30T10:00:00"}
            for code in stale_codes
        ],
    }

    merged = storage_atomic.merge_concurrent_storage_updates(current, stale_update)

    assert [sample["code"] for sample in merged["mes.samples"]] == current_codes
    assert f"{task_code}-SP-001" not in {sample["code"] for sample in merged["mes.samples"]}
    assert f"{task_code}-SP-002" not in {sample["code"] for sample in merged["mes.samples"]}


def test_generic_storage_merge_allows_only_missing_samples_up_to_the_task_limit() -> None:
    task_code = "TASK-PARTIAL"
    current = {
        "mes.tasks": [{"code": task_code, "sample_count": 2}],
        "mes.samples": [
            {"code": "SAMPLE-1", "task_code": task_code, "updated_at": "2026-07-30T10:00:00"},
        ],
    }
    incoming = {
        "mes.samples": [
            {"code": "SAMPLE-1", "task_code": task_code, "updated_at": "2026-07-30T11:00:00"},
            {"code": "SAMPLE-2", "task_code": task_code, "updated_at": "2026-07-30T11:00:00"},
            {"code": "SAMPLE-3", "task_code": task_code, "updated_at": "2026-07-30T11:00:00"},
        ],
    }

    merged = storage_atomic.merge_concurrent_storage_updates(current, incoming)

    assert [sample["code"] for sample in merged["mes.samples"]] == ["SAMPLE-1", "SAMPLE-2"]


def test_task_scoped_replacement_can_rename_a_complete_sample_set() -> None:
    task_code = "TASK-SCOPED-RENAME"
    current = {
        "mes.tasks": [{"code": task_code, "sample_count": 2}],
        "mes.samples": [
            {"code": "OLD-1", "task_code": task_code, "updated_at": "2026-07-30T10:00:00"},
            {"code": "OLD-2", "task_code": task_code, "updated_at": "2026-07-30T10:00:00"},
        ],
    }
    renamed = {
        "mes.samples": [
            {"code": "NEW-1", "task_code": task_code, "updated_at": "2026-07-30T11:00:00"},
            {"code": "NEW-2", "task_code": task_code, "updated_at": "2026-07-30T11:00:00"},
        ],
    }

    merged = storage_atomic.merge_concurrent_storage_updates(
        current,
        renamed,
        replace_task_codes={task_code},
    )

    assert [sample["code"] for sample in merged["mes.samples"]] == ["NEW-1", "NEW-2"]
