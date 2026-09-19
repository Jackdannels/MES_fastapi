from datetime import datetime, timedelta, timezone

import pytest

from app.services.attendance_service import AttendanceService, InMemoryAttendanceRepository, set_attendance_service_for_tests


ADMIN = {"adminUsername": "admin", "adminPassword": "123"}


def test_employee_update_requires_admin_and_preserves_login_history_and_work_time(client):
    now = datetime(2026, 9, 19, 8, tzinfo=timezone.utc)
    repository = InMemoryAttendanceRepository()
    service = AttendanceService(repository=repository, now=lambda: now)
    set_attendance_service_for_tests(service)
    user = service.create_user(username="before", password="secret", employee_name="原姓名", role_name="试验员")
    qr = service.reset_qr_token(user["id"])
    service.login_lab("冲击一室", username="before", password="secret")
    service.start_work_interval("冲击一室", run_no="RUN-EDIT", source="api")
    now += timedelta(minutes=10)
    url = f"/api/attendance/users/{user['id']}"
    changes = {"username": "after", "employeeName": "新姓名", "roleName": "试验组长"}
    assert client.put(url, json=changes).status_code == 422
    denied = client.put(url, json={**changes, **ADMIN, "adminPassword": "wrong"})
    assert denied.status_code == 401
    assert denied.json()["detail"] == "管理员账号或密码错误"
    assert service.list_users()[0]["username"] == "before"
    response = client.put(url, json={**changes, **ADMIN})
    assert response.status_code == 200
    assert all(response.json()[key] == value for key, value in changes.items())
    row = service.list_work_times()[0]
    assert row["todaySeconds"] == 600
    assert row["online"] is True
    assert row["activeWorkIntervalCount"] == 1
    session = service.read_lab_session("冲击一室")
    assert session["username"] == "after"
    assert session["employeeName"] == "新姓名"
    assert all(log["username"] == "after" for log in repository.operation_logs)
    # 历史操作保留当时的姓名，身份账号关联不丢失。
    assert repository.operation_logs[0]["employee_name"] == "原姓名"
    service.finish_work_interval(run_no="RUN-EDIT", ended_at=now)
    assert service.list_work_times()[0]["todaySeconds"] == 600
    assert client.post("/api/attendance/labs/冲击一室/login", json={"username": "before", "password": "secret"}).status_code == 401
    assert service.login_lab("冲击一室", username="after", password="secret")["employeeName"] == "新姓名"
    assert service.login_lab_by_qr("盐雾试验室", qr_payload=qr["qrPayload"])["username"] == "after"


@pytest.mark.parametrize("changes,expected", [
    ({"username": "lisi"}, "员工账号已存在"),
    ({"username": "  "}, "请输入员工账号"),
    ({"employeeName": " "}, "请输入员工姓名"),
    ({"roleName": "管理员"}, "请选择有效的员工角色"),
])
def test_invalid_employee_edits_are_not_persisted(client, changes, expected):
    user = client.get("/api/attendance/users").json()[0]
    response = client.put(f"/api/attendance/users/{user['id']}", json={**ADMIN, **changes})
    assert response.status_code in {400, 409}
    assert response.json()["detail"] == expected
    assert client.get("/api/attendance/users").json()[0] == user


def test_password_and_log_errors_are_chinese(client):
    user = client.get("/api/attendance/users").json()[0]
    response = client.post(f"/api/attendance/users/{user['id']}/password/reset", json={**ADMIN, "newPassword": ""})
    assert response.status_code == 400
    assert response.json()["detail"] == "请输入新密码"
    response = client.post("/api/attendance/operation-logs/query", json={**ADMIN, "adminPassword": "wrong"})
    assert response.status_code == 401
    assert response.json()["detail"] == "管理员账号或密码错误"


def test_role_only_update_and_missing_employee(client):
    user = client.get("/api/attendance/users").json()[0]
    response = client.put(f"/api/attendance/users/{user['id']}", json={**ADMIN, "roleName": "试验组长"})
    assert response.status_code == 200
    assert response.json()["username"] == user["username"]
    assert response.json()["roleName"] == "试验组长"
    missing = client.put("/api/attendance/users/9999", json={**ADMIN, "roleName": "试验组长"})
    assert missing.status_code == 404
    assert missing.json()["detail"] == "员工账号不存在"
