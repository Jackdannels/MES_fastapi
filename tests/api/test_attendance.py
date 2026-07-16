from datetime import datetime, timezone

import app.api.routes.attendance as attendance_route
import app.api.routes.laboratory as laboratory_route
from app.services.attendance_service import (
    AttendanceService,
    InMemoryAttendanceRepository,
    MySQLAttendanceRepository,
    set_attendance_service_for_tests,
)


def test_mysql_attendance_repository_accepts_dict_cursor_rows_and_scalar_results():
    class DictCursor:
        description = (("id",), ("username",), ("employee_name",))

        @staticmethod
        def fetchall():
            return [{"id": 1, "username": "zhangsan", "employee_name": "张三"}]

    repository = MySQLAttendanceRepository()

    assert repository._rows(DictCursor()) == [
        {"id": 1, "username": "zhangsan", "employee_name": "张三"}
    ]
    assert repository._first_value({"COUNT(*)": 6}, 0) == 6
    assert repository._first_value({"lab_name": "冲击一室"}, "") == "冲击一室"


def test_attendance_login_opens_active_lab_session(client):
    response = client.post(
        "/api/attendance/labs/%E5%86%B2%E5%87%BB%E4%B8%80%E5%AE%A4/login",
        json={"username": "zhangsan", "password": "123"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["active"] is True
    assert payload["labName"] == "冲击一室"
    assert payload["username"] == "zhangsan"
    assert payload["employeeName"] == "张三"
    assert payload["loggedInAt"]

    session_response = client.get("/api/attendance/labs/%E5%86%B2%E5%87%BB%E4%B8%80%E5%AE%A4/session")
    assert session_response.status_code == 200
    assert session_response.json()["username"] == "zhangsan"


def test_attendance_operation_logs_are_recorded_from_the_active_lab_session_and_admin_only(client):
    login_response = client.post(
        "/api/attendance/labs/%E7%9B%90%E9%9B%BE%E8%AF%95%E9%AA%8C%E5%AE%A4/login",
        json={"username": "zhangsan", "password": "123"},
    )
    assert login_response.status_code == 200

    work_response = client.post(
        "/api/attendance/labs/%E7%9B%90%E9%9B%BE%E8%AF%95%E9%AA%8C%E5%AE%A4/work/start",
        json={},
    )
    assert work_response.status_code == 200

    denied = client.post("/api/attendance/operation-logs/query", json={"adminUsername": "worker", "adminPassword": "bad"})
    assert denied.status_code == 401

    response = client.post(
        "/api/attendance/operation-logs/query",
        json={"adminUsername": "admin", "adminPassword": "123", "labName": "盐雾试验室"},
    )

    assert response.status_code == 200
    logs = response.json()
    assert [log["action"] for log in logs] == ["开始工作", "试验间登录"]
    assert {log["username"] for log in logs} == {"zhangsan"}
    assert {log["employeeName"] for log in logs} == {"张三"}
    assert {log["labName"] for log in logs} == {"盐雾试验室"}

    multi_select_response = client.post(
        "/api/attendance/operation-logs/query",
        json={
            "adminUsername": "admin",
            "adminPassword": "123",
            "employeeNames": ["张三", "李四"],
            "labNames": ["盐雾试验室", "冲击一室"],
        },
    )

    assert multi_select_response.status_code == 200
    assert {log["employeeName"] for log in multi_select_response.json()} == {"张三"}
    assert {log["labName"] for log in multi_select_response.json()} == {"盐雾试验室"}


def test_attendance_login_rejects_wrong_password(client):
    response = client.post(
        "/api/attendance/labs/%E5%86%B2%E5%87%BB%E4%B8%80%E5%AE%A4/login",
        json={"username": "zhangsan", "password": "bad"},
    )

    assert response.status_code == 401
    assert response.json() == {"detail": "Invalid employee credentials"}


def test_attendance_login_allows_employee_in_any_laboratory(client):
    response = client.post(
        "/api/attendance/labs/%E9%9C%89%E8%8F%8C%E8%AF%95%E9%AA%8C%E5%AE%A4/login",
        json={"username": "zhangsan", "password": "123"},
    )

    assert response.status_code == 200
    assert response.json()["labName"] == "霉菌试验室"
    assert response.json()["username"] == "zhangsan"


def test_attendance_lists_active_lab_sessions(client):
    first = client.post(
        "/api/attendance/labs/%E5%9B%9B%E7%BB%BC%E5%90%88%E5%AE%9E%E9%AA%8C%E5%AE%A4/login",
        json={"username": "zhangsan", "password": "123"},
    )
    second = client.post(
        "/api/attendance/labs/%E7%9B%90%E9%9B%BE%E8%AF%95%E9%AA%8C%E5%AE%A4/login",
        json={"username": "lisi", "password": "123"},
    )
    assert first.status_code == 200
    assert second.status_code == 200

    response = client.get("/api/attendance/lab-sessions")

    assert response.status_code == 200
    sessions = response.json()
    assert sessions == [
        {
            **first.json(),
            "lastSeenAt": sessions[0]["lastSeenAt"],
        },
        {
            **second.json(),
            "lastSeenAt": sessions[1]["lastSeenAt"],
        },
    ]
    assert [session["labName"] for session in sessions] == ["四综合实验室", "盐雾试验室"]
    assert [session["employeeName"] for session in sessions] == ["张三", "李四"]


def test_attendance_logout_closes_active_session_and_work_time_lists_employee(client):
    login_response = client.post(
        "/api/attendance/labs/%E5%86%B2%E5%87%BB%E4%BA%8C%E5%AE%A4/login",
        json={"username": "zhangsan", "password": "123"},
    )
    assert login_response.status_code == 200

    logout_response = client.post(
        "/api/attendance/labs/%E5%86%B2%E5%87%BB%E4%BA%8C%E5%AE%A4/logout",
        json={"reason": "manual"},
    )

    assert logout_response.status_code == 200
    assert logout_response.json()["active"] is False
    assert logout_response.json()["loggedOutAt"]

    session_response = client.get("/api/attendance/labs/%E5%86%B2%E5%87%BB%E4%BA%8C%E5%AE%A4/session")
    assert session_response.status_code == 200
    assert session_response.json()["active"] is False

    work_time_response = client.get("/api/attendance/work-times")
    assert work_time_response.status_code == 200
    rows = work_time_response.json()
    zhangsan = next(row for row in rows if row["username"] == "zhangsan")
    assert zhangsan["employeeName"] == "张三"
    assert zhangsan["roleName"] == "试验员"
    assert zhangsan["allowedLabs"] == ["*"]
    assert isinstance(zhangsan["todaySeconds"], int)


def test_attendance_creates_employee_account_for_role_information_maintenance(client):
    created = client.post(
        "/api/attendance/users",
        json={
            "username": "worker-unique",
            "password": "pw123",
            "employeeName": "新增员工",
            "roleName": "试验组长",
            "active": True,
        },
    )

    assert created.status_code == 201
    payload = created.json()
    assert payload["username"] == "worker-unique"
    assert payload["employeeName"] == "新增员工"
    assert payload["roleName"] == "试验组长"
    assert payload["allowedLabs"] == ["*"]
    assert "password" not in payload

    login_response = client.post(
        "/api/attendance/labs/%E9%AB%98%E4%BD%8E%E6%B8%A9%E6%B9%BF%E7%83%AD%E4%BA%8C%E5%AE%A4/login",
        json={"username": "worker-unique", "password": "pw123"},
    )
    assert login_response.status_code == 200
    assert login_response.json()["employeeName"] == "新增员工"


def test_attendance_qr_token_login_opens_lab_session_and_reset_invalidates_old_token(client):
    created = client.post(
        "/api/attendance/users",
        json={
            "username": "qr-worker",
            "password": "pw123",
            "employeeName": "扫码员工",
            "roleName": "试验员",
            "active": True,
        },
    )
    assert created.status_code == 201
    user_id = created.json()["id"]

    reset = client.post(
        f"/api/attendance/users/{user_id}/qr-token/reset",
        json={},
    )
    assert reset.status_code == 200
    first_payload = reset.json()["qrPayload"]
    assert first_payload.startswith("MES-ATTENDANCE:QR:")
    assert reset.json()["qrToken"]
    assert reset.json()["user"]["hasQrToken"] is True

    read_existing = client.get(f"/api/attendance/users/{user_id}/qr-token")
    assert read_existing.status_code == 200
    assert read_existing.json()["qrPayload"] == first_payload
    assert read_existing.json()["user"]["username"] == "qr-worker"

    login_response = client.post(
        "/api/attendance/labs/%E5%86%B2%E5%87%BB%E4%B8%80%E5%AE%A4/login/qr",
        json={"qrPayload": first_payload},
    )
    assert login_response.status_code == 200
    assert login_response.json()["username"] == "qr-worker"
    assert login_response.json()["employeeName"] == "扫码员工"
    assert login_response.json()["labName"] == "冲击一室"

    second_reset = client.post(
        f"/api/attendance/users/{user_id}/qr-token/reset",
        json={},
    )
    assert second_reset.status_code == 200
    assert second_reset.json()["qrPayload"] != first_payload

    old_login = client.post(
        "/api/attendance/labs/%E5%86%B2%E5%87%BB%E4%B8%80%E5%AE%A4/login/qr",
        json={"qrPayload": first_payload},
    )
    assert old_login.status_code == 401
    assert old_login.json() == {"detail": "Invalid employee QR code"}


def test_attendance_read_qr_token_rejects_employee_without_generated_code(client):
    created = client.post(
        "/api/attendance/users",
        json={
            "username": "no-qr-worker",
            "password": "pw123",
            "employeeName": "无码员工",
            "roleName": "试验员",
            "active": True,
        },
    )
    assert created.status_code == 201

    response = client.get(f"/api/attendance/users/{created.json()['id']}/qr-token")

    assert response.status_code == 404
    assert response.json() == {"detail": "Employee QR code not generated"}


def test_attendance_qr_login_rejects_inactive_employee(client):
    created = client.post(
        "/api/attendance/users",
        json={
            "username": "inactive-qr-worker",
            "password": "pw123",
            "employeeName": "停用扫码员工",
            "roleName": "试验员",
            "active": False,
        },
    )
    assert created.status_code == 201

    reset = client.post(
        f"/api/attendance/users/{created.json()['id']}/qr-token/reset",
        json={},
    )
    assert reset.status_code == 200

    response = client.post(
        "/api/attendance/labs/%E5%86%B2%E5%87%BB%E4%B8%80%E5%AE%A4/login/qr",
        json={"qrPayload": reset.json()["qrPayload"]},
    )

    assert response.status_code == 401
    assert response.json() == {"detail": "Invalid employee QR code"}


def test_attendance_work_time_date_filter_is_accepted(client):
    today = datetime.now(timezone.utc).date().isoformat()

    response = client.get(f"/api/attendance/work-times?date={today}")

    assert response.status_code == 200
    assert isinstance(response.json(), list)


def test_attendance_work_time_starts_when_laboratory_step_begins(client, monkeypatch):
    current_time = {"value": datetime(2026, 7, 2, 8, 0, 0, tzinfo=timezone.utc)}
    set_attendance_service_for_tests(
        AttendanceService(
            repository=InMemoryAttendanceRepository(),
            now=lambda: current_time["value"],
        )
    )

    created = client.post(
        "/api/attendance/users",
        json={
            "username": "timer-worker",
            "password": "pw123",
            "employeeName": "计时员工",
            "roleName": "试验员",
            "active": True,
        },
    )
    assert created.status_code == 201

    login_response = client.post(
        "/api/attendance/labs/%E7%9B%90%E9%9B%BE%E8%AF%95%E9%AA%8C%E5%AE%A4/login",
        json={"username": "timer-worker", "password": "pw123"},
    )
    assert login_response.status_code == 200
    assert login_response.json()["workStartedAt"] is None

    current_time["value"] = datetime(2026, 7, 2, 8, 5, 0, tzinfo=timezone.utc)
    idle_rows = client.get("/api/attendance/work-times?date=2026-07-02").json()
    assert next(row for row in idle_rows if row["username"] == "timer-worker")["todaySeconds"] == 0

    start_response = client.post("/api/attendance/labs/%E7%9B%90%E9%9B%BE%E8%AF%95%E9%AA%8C%E5%AE%A4/work/start")
    assert start_response.status_code == 200
    assert start_response.json()["workStartedAt"] == "2026-07-02T16:05:00+08:00"

    current_time["value"] = datetime(2026, 7, 2, 8, 5, 42, tzinfo=timezone.utc)
    active_rows = client.get("/api/attendance/work-times?date=2026-07-02").json()
    active_worker = next(row for row in active_rows if row["username"] == "timer-worker")
    assert active_worker["todaySeconds"] == 42
    assert active_worker["activeWorkIntervalCount"] == 1
    assert active_worker["calculatedAt"] == "2026-07-02T16:05:42+08:00"


def test_attendance_admin_can_reset_password_and_delete_employee(client):
    created = client.post(
        "/api/attendance/users",
        json={
            "username": "managed-worker",
            "password": "old-pw",
            "employeeName": "受管员工",
            "roleName": "试验员",
            "active": True,
        },
    )
    assert created.status_code == 201
    user_id = created.json()["id"]

    rejected = client.post(
        f"/api/attendance/users/{user_id}/password/reset",
        json={"adminUsername": "admin", "adminPassword": "bad", "newPassword": "new-pw"},
    )
    assert rejected.status_code == 401

    reset = client.post(
        f"/api/attendance/users/{user_id}/password/reset",
        json={"adminUsername": "admin", "adminPassword": "123", "newPassword": "new-pw"},
    )
    assert reset.status_code == 200

    login_response = client.post(
        "/api/attendance/labs/%E5%86%B2%E5%87%BB%E4%B8%80%E5%AE%A4/login",
        json={"username": "managed-worker", "password": "new-pw"},
    )
    assert login_response.status_code == 200

    delete_rejected = client.request(
        "DELETE",
        f"/api/attendance/users/{user_id}",
        json={"adminUsername": "admin", "adminPassword": "bad"},
    )
    assert delete_rejected.status_code == 401

    deleted = client.request(
        "DELETE",
        f"/api/attendance/users/{user_id}",
        json={"adminUsername": "admin", "adminPassword": "123"},
    )
    assert deleted.status_code == 200
    assert deleted.json()["deleted"] is True

    users = client.get("/api/attendance/users").json()
    assert all(row["username"] != "managed-worker" for row in users)


def test_attendance_user_persists_across_service_reinitialization():
    repository = InMemoryAttendanceRepository()
    first_service = AttendanceService(repository=repository, now=lambda: datetime(2026, 7, 3, 8, 0, 0, tzinfo=timezone.utc))

    created = first_service.create_user(
        username="persistent-worker",
        password="pw123",
        employee_name="持久化员工",
        role_name="试验员",
        active=True,
    )

    second_service = AttendanceService(repository=repository, now=lambda: datetime(2026, 7, 3, 8, 1, 0, tzinfo=timezone.utc))
    login = second_service.login_lab("冲击一室", username="persistent-worker", password="pw123")

    assert created["username"] == "persistent-worker"
    assert login["employeeName"] == "持久化员工"


def test_attendance_concurrent_same_employee_lab_work_is_additive():
    current_time = {"value": datetime(2026, 7, 3, 8, 0, 0, tzinfo=timezone.utc)}
    service = AttendanceService(
        repository=InMemoryAttendanceRepository(),
        now=lambda: current_time["value"],
    )
    service.create_user(
        username="parallel-worker",
        password="pw123",
        employee_name="并行员工",
        role_name="试验员",
        active=True,
    )
    service.login_lab("冲击一室", username="parallel-worker", password="pw123")
    service.login_lab("盐雾试验室", username="parallel-worker", password="pw123")

    service.start_work_interval("冲击一室", run_no="RUN-1", task_code="TASK-1", experiment_code="EXP-1", source="api")
    service.start_work_interval("盐雾试验室", run_no="RUN-2", task_code="TASK-2", experiment_code="EXP-2", source="api")
    current_time["value"] = datetime(2026, 7, 3, 8, 5, 0, tzinfo=timezone.utc)
    service.finish_work_interval(run_no="RUN-1", lab_name="冲击一室")
    service.finish_work_interval(run_no="RUN-2", lab_name="盐雾试验室")

    rows = service.list_work_times("2026-07-03")
    worker = next(row for row in rows if row["username"] == "parallel-worker")

    assert worker["todaySeconds"] == 600
    assert worker["currentLabNames"] == ["冲击一室", "盐雾试验室"]


def test_attendance_finishing_work_interval_clears_active_session_timer():
    current_time = {"value": datetime(2026, 7, 3, 8, 0, 0, tzinfo=timezone.utc)}
    service = AttendanceService(
        repository=InMemoryAttendanceRepository(),
        now=lambda: current_time["value"],
    )
    service.create_user(
        username="axis-worker",
        password="pw123",
        employee_name="轴向员工",
        role_name="试验员",
        active=True,
    )
    service.login_lab("冲击一室", username="axis-worker", password="pw123")
    service.start_lab_work("冲击一室")

    current_time["value"] = datetime(2026, 7, 3, 8, 5, 0, tzinfo=timezone.utc)
    service.finish_work_interval(lab_name="冲击一室")
    session = service.read_lab_session("冲击一室")
    worker = next(row for row in service.list_work_times("2026-07-03") if row["username"] == "axis-worker")

    assert session["active"] is True
    assert session["workStartedAt"] is None
    assert worker["todaySeconds"] == 300


def test_attendance_switching_employee_splits_running_work_time():
    current_time = {"value": datetime(2026, 7, 3, 8, 0, 0, tzinfo=timezone.utc)}
    service = AttendanceService(
        repository=InMemoryAttendanceRepository(),
        now=lambda: current_time["value"],
    )
    service.create_user(
        username="first-worker",
        password="pw123",
        employee_name="前一人员",
        role_name="试验员",
        active=True,
    )
    service.create_user(
        username="second-worker",
        password="pw123",
        employee_name="后一人员",
        role_name="试验员",
        active=True,
    )

    service.login_lab("冲击一室", username="first-worker", password="pw123")
    service.start_work_interval("冲击一室", run_no="RUN-SWITCH", task_code="TASK-SWITCH", experiment_code="EXP-SWITCH", source="api")

    current_time["value"] = datetime(2026, 7, 3, 8, 5, 0, tzinfo=timezone.utc)
    switched_session = service.login_lab("冲击一室", username="second-worker", password="pw123")

    current_time["value"] = datetime(2026, 7, 3, 8, 8, 0, tzinfo=timezone.utc)
    rows = service.list_work_times("2026-07-03")
    first = next(row for row in rows if row["username"] == "first-worker")
    second = next(row for row in rows if row["username"] == "second-worker")

    assert switched_session["username"] == "second-worker"
    assert switched_session["workStartedAt"] == "2026-07-03T16:05:00+08:00"
    assert first["todaySeconds"] == 300
    assert first["online"] is False
    assert second["todaySeconds"] == 180
    assert second["currentLabNames"] == ["冲击一室"]


def test_attendance_clear_all_sessions_preserves_personnel_accounts():
    current_time = {"value": datetime(2026, 7, 3, 8, 0, 0, tzinfo=timezone.utc)}
    service = AttendanceService(
        repository=InMemoryAttendanceRepository(),
        now=lambda: current_time["value"],
    )
    service.create_user(
        username="reset-worker",
        password="pw123",
        employee_name="重置员工",
        role_name="试验员",
        active=True,
    )
    service.login_lab("冲击二室", username="reset-worker", password="pw123")
    service.start_lab_work("冲击二室")
    current_time["value"] = datetime(2026, 7, 3, 8, 5, 0, tzinfo=timezone.utc)
    service.finish_work_interval(lab_name="冲击二室")
    assert next(row for row in service.list_work_times("2026-07-03") if row["username"] == "reset-worker")["todaySeconds"] == 300
    assert service.list_operation_logs(raw_date="2026-07-03")

    result = service.clear_all_sessions(reason="task-reset")
    session = service.read_lab_session("冲击二室")
    users = service.list_users()
    worker = next(row for row in service.list_work_times("2026-07-03") if row["username"] == "reset-worker")

    assert result["closedSessions"] == 1
    assert result["clearedIntervals"] == 1
    assert result["clearedOperationLogs"] == 3
    assert session["active"] is False
    assert any(user["username"] == "reset-worker" for user in users)
    assert worker["todaySeconds"] == 0
    assert service.list_operation_logs(raw_date="2026-07-03") == []


def test_api_experiment_start_and_complete_updates_attendance_work_interval(monkeypatch):
    business_times = iter(["2026-07-03 09:00:00", "2026-07-03 09:05:00"])
    monkeypatch.setattr(laboratory_route, "now_business_text", lambda: next(business_times))
    current_time = {"value": datetime(2026, 7, 3, 9, 0, 0, tzinfo=timezone.utc)}
    service = AttendanceService(
        repository=InMemoryAttendanceRepository(),
        now=lambda: current_time["value"],
    )
    set_attendance_service_for_tests(service)
    service.create_user(
        username="api-worker",
        password="pw123",
        employee_name="API员工",
        role_name="试验员",
        active=True,
    )
    service.login_lab("盐雾试验室", username="api-worker", password="pw123")
    snapshot = {
        "tasks": [{"code": "TASK-API"}],
        "samples": [],
        "schedules": [],
        "experiments": [{"task_code": "TASK-API", "experiment_code": "EXP-API", "experiment_name": "盐雾试验"}],
        "experiment_runs": [],
        "experiment_run_trays": [],
        "experiment_run_steps": [],
        "experiment_trays": [],
        "experiment_samples": [],
        "staging_events": [],
    }
    monkeypatch.setattr(laboratory_route, "read_snapshot", lambda: snapshot)
    monkeypatch.setattr(laboratory_route, "start_lab_name", lambda *_args, **_kwargs: "盐雾试验室")
    monkeypatch.setattr(laboratory_route, "scope_snapshot_samples_for_experiment", lambda scoped_snapshot, **_kwargs: scoped_snapshot)
    monkeypatch.setattr(
        laboratory_route,
        "start_storage_laboratory_experiment",
        lambda *_args, **_kwargs: {
            "tasks": [],
            "samples": [],
            "schedules": [],
            "experiments": [],
            "experimentRuns": [],
            "experimentRunTrays": [],
            "experimentRunSteps": [],
            "startedAt": "2026-07-03 09:00:00",
        },
    )
    monkeypatch.setattr(laboratory_route, "write_start_snapshot", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(
        laboratory_route,
        "complete_storage_laboratory_experiment",
        lambda *_args, **_kwargs: {
            "samples": [],
            "schedules": [],
            "experiments": [],
            "experimentRuns": [],
            "experimentRunTrays": [],
            "experimentRunSteps": [],
        },
    )
    monkeypatch.setattr(laboratory_route, "write_completion_snapshot", lambda *_args, **_kwargs: None)

    start_response = laboratory_route.start_current_experiment(
        "TASK-API",
        "EXP-API",
        laboratory_route.LaboratoryStartRequest(
            labName="盐雾试验室",
            runNo="RUN-API",
            startedAt="2026-07-03 09:00:00",
        ),
    )
    active_session = service.read_lab_session("盐雾试验室")
    current_time["value"] = datetime(2026, 7, 3, 9, 5, 0, tzinfo=timezone.utc)
    complete_response = laboratory_route.complete_current_experiment(
        "TASK-API",
        "EXP-API",
        laboratory_route.LaboratoryCompleteRequest(
            completedAt="2026-07-03 09:05:00",
            runNo="RUN-API",
        ),
    )
    current_time["value"] = datetime(2026, 7, 3, 9, 10, 0, tzinfo=timezone.utc)
    worker = next(row for row in service.list_work_times("2026-07-03") if row["username"] == "api-worker")

    assert start_response["ok"] is True
    assert start_response["attendanceSession"]["workStartedAt"] == "2026-07-03T09:00:00+08:00"
    assert active_session["workStartedAt"] == "2026-07-03T09:00:00+08:00"
    assert complete_response["ok"] is True
    assert worker["todaySeconds"] == 300


def test_api_experiment_start_uses_storage_started_at_for_attendance_when_request_is_empty(monkeypatch):
    service = AttendanceService(repository=InMemoryAttendanceRepository())
    set_attendance_service_for_tests(service)
    service.create_user(
        username="api-empty-start-worker",
        password="pw123",
        employee_name="空开始时间员工",
        role_name="试验员",
        active=True,
    )
    service.login_lab("盐雾试验室", username="api-empty-start-worker", password="pw123")
    snapshot = {
        "tasks": [{"code": "TASK-API-EMPTY"}],
        "samples": [],
        "schedules": [],
        "experiments": [{"task_code": "TASK-API-EMPTY", "experiment_code": "EXP-API-EMPTY", "experiment_name": "盐雾试验"}],
        "experiment_runs": [],
        "experiment_run_trays": [],
        "experiment_run_steps": [],
        "experiment_trays": [],
        "experiment_samples": [],
        "staging_events": [],
    }
    monkeypatch.setattr(laboratory_route, "read_snapshot", lambda: snapshot)
    monkeypatch.setattr(laboratory_route, "start_lab_name", lambda *_args, **_kwargs: "盐雾试验室")
    monkeypatch.setattr(laboratory_route, "scope_snapshot_samples_for_experiment", lambda scoped_snapshot, **_kwargs: scoped_snapshot)
    monkeypatch.setattr(
        laboratory_route,
        "start_storage_laboratory_experiment",
        lambda *_args, **_kwargs: {
            "tasks": [],
            "samples": [],
            "schedules": [],
            "experiments": [],
            "experimentRuns": [],
            "experimentRunTrays": [],
            "experimentRunSteps": [],
            "startedAt": "2026-07-03 09:00:00",
        },
    )
    monkeypatch.setattr(laboratory_route, "write_start_snapshot", lambda *_args, **_kwargs: None)

    response = laboratory_route.start_current_experiment(
        "TASK-API-EMPTY",
        "EXP-API-EMPTY",
        laboratory_route.LaboratoryStartRequest(
            labName="盐雾试验室",
            runNo="RUN-API-EMPTY",
        ),
    )

    assert response["attendanceSession"]["workStartedAt"] == "2026-07-03T09:00:00+08:00"


def test_attendance_work_start_treats_naive_started_at_as_business_local_time():
    current_time = {"value": datetime(2026, 7, 3, 7, 5, 0, tzinfo=timezone.utc)}
    service = AttendanceService(
        repository=InMemoryAttendanceRepository(),
        now=lambda: current_time["value"],
    )
    set_attendance_service_for_tests(service)
    service.create_user(
        username="local-time-worker",
        password="pw123",
        employee_name="本地时间员工",
        role_name="试验员",
        active=True,
    )
    service.login_lab("温度冲击二室", username="local-time-worker", password="pw123")

    service.start_work_interval(
        "温度冲击二室",
        run_no="RUN-LOCAL-TIME",
        task_code="TASK-LOCAL-TIME",
        experiment_code="EXP-LOCAL-TIME",
        source="mqtt",
        started_at="2026-07-03 15:02:59",
    )

    assert service.read_lab_session("温度冲击二室")["workStartedAt"] == "2026-07-03T15:02:59+08:00"


def test_api_axis_continuation_does_not_finish_attendance_work_interval(monkeypatch):
    service = AttendanceService(repository=InMemoryAttendanceRepository())
    set_attendance_service_for_tests(service)
    finish_calls = []
    monkeypatch.setattr(service, "finish_work_interval", lambda **kwargs: finish_calls.append(kwargs))
    snapshot = {
        "tasks": [{"code": "TASK-AXIS"}],
        "samples": [],
        "schedules": [],
        "experiments": [{"task_code": "TASK-AXIS", "experiment_code": "EXP-VIB", "experiment_name": "振动试验"}],
        "experiment_runs": [],
        "experiment_run_trays": [],
        "experiment_run_steps": [],
        "experiment_trays": [],
        "experiment_samples": [],
        "staging_events": [],
    }
    monkeypatch.setattr(laboratory_route, "read_snapshot", lambda: snapshot)
    monkeypatch.setattr(
        laboratory_route,
        "complete_storage_laboratory_axis_step",
        lambda *_args, **_kwargs: {
            "samples": [],
            "schedules": [],
            "experiments": [{"task_code": "TASK-AXIS", "experiment_code": "EXP-VIB", "status": "实验进行中"}],
            "experimentRuns": [{"run_no": "RUN-AXIS", "task_code": "TASK-AXIS", "experiment_code": "EXP-VIB", "status": "实验进行中"}],
            "experimentRunTrays": [],
            "experimentRunSteps": [
                {"run_no": "RUN-AXIS", "axis_code": "x+", "status": "实验已完成"},
                {"run_no": "RUN-AXIS", "axis_code": "y+", "status": "实验进行中"},
            ],
        },
    )
    monkeypatch.setattr(laboratory_route, "write_completion_snapshot", lambda *_args, **_kwargs: None)

    response = laboratory_route.complete_current_experiment(
        "TASK-AXIS",
        "EXP-VIB",
        laboratory_route.LaboratoryCompleteRequest(
            axisCode="x+",
            completedAt="2026-07-03T09:05:00Z",
            nextAxisCode="y+",
            runNo="RUN-AXIS",
            subExperimentCode="SEG-AXIS",
        ),
    )

    assert response["ok"] is True
    assert finish_calls == []
