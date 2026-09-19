import pytest

from app.services.attendance_service import AttendanceService, InMemoryAttendanceRepository, set_attendance_service_for_tests


EMPLOYEE = {"username": "new-worker", "password": "worker-password", "employeeName": "新员工", "roleName": "试验员"}


@pytest.mark.parametrize("credentials,status", [
    ({}, 422),
    ({"adminUsername": "admin"}, 422),
    ({"adminPassword": "123"}, 422),
    ({"adminUsername": "", "adminPassword": ""}, 401),
    ({"adminUsername": "admin", "adminPassword": "wrong"}, 401),
    ({"adminUsername": "worker", "adminPassword": "123"}, 401),
])
def test_create_employee_requires_admin_before_any_user_is_written(client, credentials, status):
    repository = InMemoryAttendanceRepository()
    set_attendance_service_for_tests(AttendanceService(repository=repository))
    response = client.post("/api/attendance/users", json={**EMPLOYEE, **credentials})
    assert response.status_code == status
    if status == 401:
        assert response.json()["detail"] == "管理员账号或密码错误"
    assert repository.users == {}


def test_create_employee_with_admin_preserves_employee_password_and_hides_credentials(client):
    response = client.post("/api/attendance/users", json={
        **EMPLOYEE, "adminUsername": "admin", "adminPassword": "123",
    })
    assert response.status_code == 201
    assert response.json()["username"] == "new-worker"
    assert not {"password", "password_hash", "adminUsername", "adminPassword"} & response.json().keys()
    login = client.post("/api/attendance/labs/冲击一室/login", json={
        "username": "new-worker", "password": "worker-password",
    })
    assert login.status_code == 200
    assert login.json()["employeeName"] == "新员工"
