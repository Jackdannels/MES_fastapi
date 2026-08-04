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


def test_expired_entry_is_served_while_one_background_refresh_runs(monkeypatch) -> None:
    from app.services import read_through_cache as cache_module

    now = [100.0]
    monkeypatch.setattr(cache_module.time, "monotonic", lambda: now[0])
    cache = CoordinatedReadCache(ttl_seconds=5, stale_while_revalidate_seconds=30)
    refresh_started = threading.Event()
    release_refresh = threading.Event()
    calls = 0

    def load() -> dict[str, int]:
        nonlocal calls
        calls += 1
        if calls == 2:
            refresh_started.set()
            assert release_refresh.wait(timeout=2)
        return {"call": calls}

    first, first_status = cache.get_or_load("snapshot", load)
    now[0] = 106.0
    stale, stale_status = cache.get_or_load("snapshot", load)
    assert refresh_started.wait(timeout=2)
    follower, follower_status = cache.get_or_load("snapshot", load)

    assert first == stale == follower == {"call": 1}
    assert (first_status, stale_status, follower_status) == ("miss", "stale", "stale")
    assert calls == 2

    release_refresh.set()
    with cache._condition:
        assert cache._condition.wait_for(lambda: not cache._loading, timeout=2)
    refreshed, refreshed_status = cache.get_or_load("snapshot", load)

    assert refreshed == {"call": 2}
    assert refreshed_status == "hit"


def test_invalidation_prevents_an_old_background_refresh_from_overwriting_new_data(monkeypatch) -> None:
    from app.services import read_through_cache as cache_module

    now = [100.0]
    monkeypatch.setattr(cache_module.time, "monotonic", lambda: now[0])
    cache = CoordinatedReadCache(ttl_seconds=5, stale_while_revalidate_seconds=30)
    refresh_started = threading.Event()
    release_refresh = threading.Event()
    calls = 0

    def load() -> dict[str, int]:
        nonlocal calls
        calls += 1
        call = calls
        if call == 2:
            refresh_started.set()
            assert release_refresh.wait(timeout=2)
        return {"call": call}

    cache.get_or_load("snapshot", load)
    now[0] = 106.0
    stale, stale_status = cache.get_or_load("snapshot", load)
    assert refresh_started.wait(timeout=2)

    cache.invalidate()
    current, current_status = cache.get_or_load("snapshot", load)
    release_refresh.set()
    for thread in threading.enumerate():
        if thread.name == "mes-read-cache-refresh":
            thread.join(timeout=2)

    final, final_status = cache.get_or_load("snapshot", load)

    assert stale == {"call": 1}
    assert stale_status == "stale"
    assert current == final == {"call": 3}
    assert current_status == "miss"
    assert final_status == "hit"


def test_hard_expiry_coalesces_waiters_behind_one_foreground_reload(monkeypatch) -> None:
    from app.services import read_through_cache as cache_module

    now = [100.0]
    monkeypatch.setattr(cache_module.time, "monotonic", lambda: now[0])
    cache = CoordinatedReadCache(ttl_seconds=5, stale_while_revalidate_seconds=30)
    reload_started = threading.Event()
    release_reload = threading.Event()
    calls = 0
    calls_lock = threading.Lock()

    def load() -> dict[str, int]:
        nonlocal calls
        with calls_lock:
            calls += 1
            call = calls
        if call == 2:
            reload_started.set()
            assert release_reload.wait(timeout=2)
        return {"call": call}

    cache.get_or_load("snapshot", load)
    now[0] = 136.0

    with ThreadPoolExecutor(max_workers=6) as executor:
        first = executor.submit(cache.get_or_load, "snapshot", load)
        assert reload_started.wait(timeout=2)
        followers = [executor.submit(cache.get_or_load, "snapshot", load) for _index in range(5)]
        release_reload.set()
        results = [first.result(timeout=2), *(future.result(timeout=2) for future in followers)]

    assert calls == 2
    assert [value for value, _status in results] == [{"call": 2}] * 6
    assert results[0][1] == "miss"
    assert all(status in {"hit", "coalesced"} for _value, status in results[1:])


def test_failed_background_refresh_keeps_stale_value_and_allows_retry(monkeypatch) -> None:
    from app.services import read_through_cache as cache_module

    now = [100.0]
    monkeypatch.setattr(cache_module.time, "monotonic", lambda: now[0])
    cache = CoordinatedReadCache(ttl_seconds=5, stale_while_revalidate_seconds=30)
    calls = 0

    def load() -> dict[str, int]:
        nonlocal calls
        calls += 1
        if calls == 2:
            raise RuntimeError("temporary refresh failure")
        return {"call": calls}

    first, _status = cache.get_or_load("snapshot", load)
    now[0] = 106.0
    stale_after_failure, failure_status = cache.get_or_load("snapshot", load)
    for thread in threading.enumerate():
        if thread.name == "mes-read-cache-refresh":
            thread.join(timeout=2)

    stale_during_retry, retry_status = cache.get_or_load("snapshot", load)
    for thread in threading.enumerate():
        if thread.name == "mes-read-cache-refresh":
            thread.join(timeout=2)
    refreshed, refreshed_status = cache.get_or_load("snapshot", load)

    assert first == stale_after_failure == stale_during_retry == {"call": 1}
    assert failure_status == retry_status == "stale"
    assert refreshed == {"call": 3}
    assert refreshed_status == "hit"


def test_clear_advances_version_so_an_inflight_load_cannot_repopulate_old_data() -> None:
    cache = CoordinatedReadCache(ttl_seconds=60)
    old_load_started = threading.Event()
    release_old_load = threading.Event()
    calls = 0

    def load() -> dict[str, int]:
        nonlocal calls
        calls += 1
        call = calls
        if call == 1:
            old_load_started.set()
            assert release_old_load.wait(timeout=2)
        return {"call": call}

    with ThreadPoolExecutor(max_workers=2) as executor:
        old = executor.submit(cache.get_or_load, "snapshot", load)
        assert old_load_started.wait(timeout=2)
        cache.clear()
        current = executor.submit(cache.get_or_load, "snapshot", load)
        assert current.result(timeout=2) == ({"call": 2}, "miss")
        release_old_load.set()
        assert old.result(timeout=2) == ({"call": 1}, "miss")

    final, final_status = cache.get_or_load("snapshot", load)
    assert final == {"call": 2}
    assert final_status == "hit"


def test_background_thread_start_failure_releases_loading_owner(monkeypatch) -> None:
    from app.services import read_through_cache as cache_module

    now = [100.0]
    monkeypatch.setattr(cache_module.time, "monotonic", lambda: now[0])
    cache = CoordinatedReadCache(ttl_seconds=5, stale_while_revalidate_seconds=30)
    calls = 0

    def load() -> dict[str, int]:
        nonlocal calls
        calls += 1
        return {"call": calls}

    cache.get_or_load("snapshot", load)
    now[0] = 106.0

    class FailingThread:
        def __init__(self, *args, **kwargs) -> None:
            pass

        def start(self) -> None:
            raise RuntimeError("thread unavailable")

    with monkeypatch.context() as context:
        context.setattr(cache_module.threading, "Thread", FailingThread)
        stale, stale_status = cache.get_or_load("snapshot", load)

    assert stale == {"call": 1}
    assert stale_status == "stale"
    assert cache._loading == {}

    retry, retry_status = cache.get_or_load("snapshot", load)
    for thread in threading.enumerate():
        if thread.name == "mes-read-cache-refresh":
            thread.join(timeout=2)
    refreshed, refreshed_status = cache.get_or_load("snapshot", load)

    assert retry == {"call": 1}
    assert retry_status == "stale"
    assert refreshed == {"call": 2}
    assert refreshed_status == "hit"
