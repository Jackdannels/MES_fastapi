from contextlib import contextmanager
import json

import pytest

from app.services import terminal_enrollment as module


class Cursor:
    def __init__(self):
        self.calls = []
        self.result = None

    def __enter__(self):
        return self

    def __exit__(self, *_):
        pass

    def execute(self, sql, args=()):
        self.calls.append((sql, args))
        if sql.startswith('SELECT payload_json'):
            self.result = (json.dumps(dict(requests={}, audit=[])),)

    def fetchone(self):
        return self.result


class Connection:
    def __init__(self):
        self.value = Cursor()
        self.commits = 0
        self.rollbacks = 0

    def cursor(self):
        return self.value

    def commit(self):
        self.commits += 1

    def rollback(self):
        self.rollbacks += 1


def connection_factory(monkeypatch):
    connection = Connection()

    @contextmanager
    def acquire():
        yield connection

    monkeypatch.setattr(module, 'get_connection', acquire)
    return connection


def test_enrollment_document_and_credential_write_share_a_transaction(monkeypatch):
    connection = connection_factory(monkeypatch)
    with module.MySQLEnrollmentRepository().transaction() as unit:
        unit.state['audit'].append(dict(operation='claim'))
        unit.write(dict(terminal_id='test', terminal_name='test', secret_hash='hashed', module='staging', lab_name=''))
    assert connection.commits == 1 and connection.rollbacks == 0
    calls = connection.value.calls
    assert any('FOR UPDATE' in sql for sql, _ in calls)
    assert any('INSERT INTO sys_fixed_terminal' in sql for sql, _ in calls)
    assert calls[-1][0].startswith('UPDATE app_storage_snapshot')
    assert calls[-1][1][1] == module.STORAGE_KEY
    assert not any(sql.strip().startswith(('CREATE', 'ALTER', 'DROP', 'TRUNCATE')) for sql, _ in calls)


def test_interrupted_approval_rolls_back_without_updating_snapshot(monkeypatch):
    connection = connection_factory(monkeypatch)
    with pytest.raises(RuntimeError):
        with module.MySQLEnrollmentRepository().transaction() as unit:
            unit.state['audit'].append(dict(operation='reset'))
            unit.revoke('test')
            raise RuntimeError('intentional abort')
    assert connection.rollbacks == 1 and connection.commits == 0
    assert not any(sql.startswith('UPDATE app_storage_snapshot') for sql, _ in connection.value.calls)


def test_private_enrollment_snapshot_is_not_a_public_business_storage_key():
    from app.core.storage_contract import STORAGE_KEYS
    assert module.STORAGE_KEY not in STORAGE_KEYS
