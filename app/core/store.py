from itertools import count
from threading import Lock
from typing import Dict, List, Optional


class InMemoryStore:
    """Simple dev-only storage. Replace with database persistence."""

    def __init__(self) -> None:
        self._items: Dict[int, dict] = {}
        self._counter = count(1)
        self._lock = Lock()

    def list(self) -> List[dict]:
        return list(self._items.values())

    def get(self, item_id: int) -> Optional[dict]:
        return self._items.get(item_id)

    def create(self, data: dict) -> dict:
        with self._lock:
            item_id = next(self._counter)
            item = {"id": item_id, **data}
            self._items[item_id] = item
        return item

    def update(self, item_id: int, data: dict) -> Optional[dict]:
        with self._lock:
            if item_id not in self._items:
                return None
            item = {**self._items[item_id], **data}
            self._items[item_id] = item
        return item
    def delete(self, item_id: int) -> bool:
        with self._lock:
            return self._items.pop(item_id, None) is not None
