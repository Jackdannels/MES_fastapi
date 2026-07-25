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
