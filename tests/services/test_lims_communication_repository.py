import json
from unittest.mock import Mock

import pytest

from app.services.lims_communication_store import CommunicationRepository, LOCK_NAME, STATE_KEY


class Cursor:
    def __init__(self, row):
        self.row = row
        self.calls = []

    def __enter__(self): return self
    def __exit__(self, *_): return False
    def execute(self, query, args): self.calls.append((query, args))
    def fetchone(self): return self.row


def connection(row):
    cursor = Cursor(row)
    conn = Mock()
    conn.cursor.return_value = cursor
    return conn, cursor


def test_state_update_locks_row_commits_then_closes_connection():
    conn, cursor = connection((json.dumps({"retry_count": 2}),))
    repository = CommunicationRepository(lambda: conn)
    result = repository.update(STATE_KEY, lambda state: {**state, "retry_count": 3}, {})
    assert result["retry_count"] == 3
    assert "INSERT IGNORE" in cursor.calls[0][0]
    assert "FOR UPDATE" in cursor.calls[1][0]
    assert json.loads(cursor.calls[2][1][0])["retry_count"] == 3
    assert all(STATE_KEY in args for _, args in cursor.calls)
    conn.commit.assert_called_once()
    conn.rollback.assert_not_called()
    conn.close.assert_called_once()


def test_failed_update_rolls_back_without_committing():
    conn, _ = connection(("{}",))
    repository = CommunicationRepository(lambda: conn)
    with pytest.raises(ValueError):
        repository.update(STATE_KEY, lambda _: (_ for _ in ()).throw(ValueError("conflict")), {})
    conn.rollback.assert_called_once()
    conn.commit.assert_not_called()
    conn.close.assert_called_once()


def test_busy_database_lock_is_not_held_or_released_by_losing_worker():
    conn, cursor = connection((0,))
    repository = CommunicationRepository(lambda: conn)
    assert repository.acquire_cycle() is None
    assert cursor.calls == [("SELECT GET_LOCK(%s, 0)", (LOCK_NAME,))]
    conn.close.assert_called_once()


def test_winning_worker_retains_connection_until_explicit_release():
    conn, cursor = connection((1,))
    repository = CommunicationRepository(lambda: conn)
    assert repository.acquire_cycle() is conn
    conn.close.assert_not_called()
    repository.release_cycle(conn)
    assert cursor.calls[-1] == ("SELECT RELEASE_LOCK(%s)", (LOCK_NAME,))
    conn.close.assert_called_once()


def test_failed_lock_release_discards_physical_pool_connection():
    conn, cursor = connection((1,))
    cursor.execute = Mock(side_effect=OSError("connection lost"))
    with pytest.raises(OSError): CommunicationRepository.release_cycle(conn)
    conn.close.assert_called_once_with(discard=True)
