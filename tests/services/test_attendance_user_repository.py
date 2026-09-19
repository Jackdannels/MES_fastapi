from contextlib import contextmanager
from unittest.mock import MagicMock

import pytest
from pymysql.err import IntegrityError

import app.services.attendance_service as attendance


@pytest.mark.parametrize("failure", [None, IntegrityError(1062, "duplicate"), RuntimeError("write failed")])
def test_mysql_account_rename_updates_associations_in_one_transaction(monkeypatch, failure):
    cursor = MagicMock()
    cursor.fetchone.return_value = {"username": "old"}
    if failure:
        def execute(sql, values):
            if sql.startswith("UPDATE sys_attendance_user"):
                raise failure
        cursor.execute.side_effect = execute
    connection = MagicMock()
    connection.cursor.return_value.__enter__.return_value = cursor

    @contextmanager
    def connect():
        yield connection

    monkeypatch.setattr(attendance, "get_connection", connect)
    repository = attendance.MySQLAttendanceRepository()
    monkeypatch.setattr(repository, "ensure_schema", lambda: None)
    monkeypatch.setattr(repository, "find_user_by_id", lambda _: {"id": 1, "username": "new"})
    if failure:
        expected = attendance.AttendanceError if isinstance(failure, IntegrityError) else RuntimeError
        with pytest.raises(expected):
            repository.update_user(1, {"username": "new", "employee_name": "新姓名"})
        connection.rollback.assert_called_once()
        connection.commit.assert_not_called()
    else:
        assert repository.update_user(1, {"username": "new", "employee_name": "新姓名"})["username"] == "new"
        connection.commit.assert_called_once()
        connection.rollback.assert_not_called()
        cursor.execute.assert_any_call("SELECT username FROM sys_attendance_user WHERE user_id = %s FOR UPDATE", (1,))
        for table in ("biz_lab_attendance_session", "biz_lab_work_interval", "biz_lab_operation_log"):
            cursor.execute.assert_any_call(f"UPDATE {table} SET username = %s WHERE username = %s", ("new", "old"))


def test_memory_account_rename_collision_does_not_change_associations():
    repository = attendance.InMemoryAttendanceRepository()
    first = repository.create_user({"username": "first"})
    repository.create_user({"username": "second"})
    repository.sessions.append({"username": "first", "active": True})
    with pytest.raises(attendance.AttendanceError, match="员工账号已存在"):
        repository.update_user(first["id"], {"username": "second"})
    assert repository.sessions[0]["username"] == "first"
    assert repository.find_user_by_id(first["id"])["username"] == "first"
