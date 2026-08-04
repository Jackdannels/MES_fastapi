from __future__ import annotations

import threading
import time
from collections.abc import Callable, Hashable
from dataclasses import dataclass
from typing import Generic, TypeVar

from app.core.config import settings


T = TypeVar("T")


@dataclass
class _CacheEntry(Generic[T]):
    expires_at: float
    stale_until: float
    value: T
    version: int


class CoordinatedReadCache:
    """Short-lived process-local cache with write-version invalidation and single-flight loads."""

    def __init__(self, ttl_seconds: float = 1.0, stale_while_revalidate_seconds: float = 0.0) -> None:
        self._ttl_seconds = max(float(ttl_seconds), 0.0)
        self._stale_seconds = max(float(stale_while_revalidate_seconds), 0.0)
        self._condition = threading.Condition()
        self._entries: dict[Hashable, _CacheEntry[object]] = {}
        self._loading: dict[Hashable, int] = {}
        self._version = 0

    @property
    def version(self) -> int:
        with self._condition:
            return self._version

    def invalidate(self) -> int:
        with self._condition:
            self._version += 1
            self._entries.clear()
            self._condition.notify_all()
            return self._version

    def clear(self) -> None:
        with self._condition:
            self._version += 1
            self._entries.clear()
            self._condition.notify_all()

    def get_or_load(self, key: Hashable, loader: Callable[[], T]) -> tuple[T, str]:
        if self._ttl_seconds <= 0:
            return loader(), "disabled"

        waited = False
        while True:
            with self._condition:
                now = time.monotonic()
                entry = self._entries.get(key)
                if entry is not None and entry.version == self._version and entry.expires_at > now:
                    return entry.value, "coalesced" if waited else "hit"  # type: ignore[return-value]
                if entry is not None and entry.version == self._version and entry.stale_until > now:
                    if self._loading.get(key) != self._version:
                        load_version = self._version
                        self._loading[key] = load_version
                        try:
                            threading.Thread(
                                target=self._refresh,
                                args=(key, loader, load_version),
                                name="mes-read-cache-refresh",
                                daemon=True,
                            ).start()
                        except Exception:
                            if self._loading.get(key) == load_version:
                                self._loading.pop(key, None)
                            self._condition.notify_all()
                    return entry.value, "stale"  # type: ignore[return-value]
                if entry is not None:
                    self._entries.pop(key, None)
                if self._loading.get(key) != self._version:
                    load_version = self._version
                    self._loading[key] = load_version
                    break
                waited = True
                self._condition.wait()

        try:
            value = loader()
        except BaseException:
            with self._condition:
                if self._loading.get(key) == load_version:
                    self._loading.pop(key, None)
                self._condition.notify_all()
            raise

        with self._condition:
            if load_version == self._version:
                self._entries[key] = _CacheEntry(
                    expires_at=time.monotonic() + self._ttl_seconds,
                    stale_until=time.monotonic() + self._ttl_seconds + self._stale_seconds,
                    value=value,
                    version=load_version,
                )
            if self._loading.get(key) == load_version:
                self._loading.pop(key, None)
            self._condition.notify_all()
        return value, "miss"

    def _refresh(self, key: Hashable, loader: Callable[[], T], load_version: int) -> None:
        try:
            value = loader()
        except BaseException:
            with self._condition:
                if self._loading.get(key) == load_version:
                    self._loading.pop(key, None)
                self._condition.notify_all()
            return

        refreshed_at = time.monotonic()
        with self._condition:
            if load_version == self._version:
                self._entries[key] = _CacheEntry(
                    expires_at=refreshed_at + self._ttl_seconds,
                    stale_until=refreshed_at + self._ttl_seconds + self._stale_seconds,
                    value=value,
                    version=load_version,
                )
            if self._loading.get(key) == load_version:
                self._loading.pop(key, None)
            self._condition.notify_all()


def storage_cache_identity(storage: object) -> object:
    try:
        hash(storage)
    except TypeError:
        return id(storage)
    return storage


read_snapshot_cache = CoordinatedReadCache(
    settings.READ_SNAPSHOT_CACHE_TTL_SECONDS,
    settings.READ_SNAPSHOT_CACHE_STALE_SECONDS,
)


__all__ = ["CoordinatedReadCache", "read_snapshot_cache", "storage_cache_identity"]
