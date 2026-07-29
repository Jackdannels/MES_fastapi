from concurrent.futures import ThreadPoolExecutor
import threading

from app.services.read_through_cache import CoordinatedReadCache


def test_read_cache_hits_until_version_invalidation() -> None:
    cache = CoordinatedReadCache(ttl_seconds=60)
    calls = 0

    def load() -> dict[str, int]:
        nonlocal calls
        calls += 1
        return {"call": calls}

    first, first_status = cache.get_or_load(("storage", "mes.samples"), load)
    second, second_status = cache.get_or_load(("storage", "mes.samples"), load)
    cache.invalidate()
    third, third_status = cache.get_or_load(("storage", "mes.samples"), load)

    assert first == second == {"call": 1}
    assert third == {"call": 2}
    assert (first_status, second_status, third_status) == ("miss", "hit", "miss")


def test_read_cache_coalesces_concurrent_identical_loads() -> None:
    cache = CoordinatedReadCache(ttl_seconds=60)
    load_started = threading.Event()
    release_load = threading.Event()
    calls = 0
    calls_lock = threading.Lock()

    def load() -> list[str]:
        nonlocal calls
        with calls_lock:
            calls += 1
        load_started.set()
        assert release_load.wait(timeout=2)
        return ["snapshot"]

    with ThreadPoolExecutor(max_workers=6) as executor:
        first = executor.submit(cache.get_or_load, ("storage", "mes.samples"), load)
        assert load_started.wait(timeout=2)
        followers = [
            executor.submit(cache.get_or_load, ("storage", "mes.samples"), load)
            for _index in range(5)
        ]
        release_load.set()
        results = [first.result(timeout=2), *(future.result(timeout=2) for future in followers)]

    assert calls == 1
    assert [value for value, _status in results] == [["snapshot"]] * 6
    assert results[0][1] == "miss"
    assert all(status in {"hit", "coalesced"} for _value, status in results[1:])
