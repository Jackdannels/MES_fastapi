from __future__ import annotations

from typing import Any
from urllib.parse import unquote

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from app.services.attendance_service import AttendanceError, get_attendance_service, normalize_text

router = APIRouter(prefix="/api/attendance", tags=["attendance"])


class AttendanceLoginRequest(BaseModel):
    username: str
    password: str


class AttendanceLogoutRequest(BaseModel):
    reason: str = "manual"


class AttendanceAdminRequest(BaseModel):
    admin_username: str = Field(alias="adminUsername")
    admin_password: str = Field(alias="adminPassword")


class AttendancePasswordResetRequest(AttendanceAdminRequest):
    new_password: str = Field(alias="newPassword")


class AttendanceUserCreate(BaseModel):
    username: str
    password: str
    employee_name: str = Field(alias="employeeName")
    role_name: str = Field(alias="roleName")
    active: bool = True


class AttendanceUserUpdate(BaseModel):
    password: str | None = None
    employee_name: str | None = Field(default=None, alias="employeeName")
    role_name: str | None = Field(default=None, alias="roleName")
    active: bool | None = None


def _normalize_lab_name(value: str) -> str:
    return unquote(normalize_text(value))


def _service_error(exc: AttendanceError) -> HTTPException:
    return HTTPException(status_code=exc.status_code, detail=exc.detail)


def _verify_admin_credentials(payload: AttendanceAdminRequest) -> None:
    if normalize_text(payload.admin_username) != "admin" or normalize_text(payload.admin_password) != "123":
        raise HTTPException(status_code=401, detail="Invalid administrator credentials")


@router.get("/users")
def list_users() -> list[dict[str, Any]]:
    try:
        return get_attendance_service().list_users()
    except AttendanceError as exc:
        raise _service_error(exc) from exc


@router.post("/users", status_code=status.HTTP_201_CREATED)
def create_user(payload: AttendanceUserCreate) -> dict[str, Any]:
    try:
        return get_attendance_service().create_user(
            active=payload.active,
            employee_name=payload.employee_name,
            password=payload.password,
            role_name=payload.role_name,
            username=payload.username,
        )
    except AttendanceError as exc:
        raise _service_error(exc) from exc


@router.put("/users/{user_id}")
def update_user(user_id: int, payload: AttendanceUserUpdate) -> dict[str, Any]:
    try:
        return get_attendance_service().update_user(
            user_id,
            active=payload.active,
            employee_name=payload.employee_name,
            password=payload.password,
            role_name=payload.role_name,
        )
    except AttendanceError as exc:
        raise _service_error(exc) from exc


@router.post("/users/{user_id}/password/reset")
def reset_user_password(user_id: int, payload: AttendancePasswordResetRequest) -> dict[str, Any]:
    _verify_admin_credentials(payload)
    try:
        return get_attendance_service().reset_password(user_id, payload.new_password)
    except AttendanceError as exc:
        raise _service_error(exc) from exc


@router.delete("/users/{user_id}")
def delete_user(user_id: int, payload: AttendanceAdminRequest) -> dict[str, Any]:
    _verify_admin_credentials(payload)
    try:
        return get_attendance_service().delete_user(user_id)
    except AttendanceError as exc:
        raise _service_error(exc) from exc


@router.get("/labs/{lab_name}/session")
def read_lab_session(lab_name: str) -> dict[str, Any]:
    normalized_lab_name = _normalize_lab_name(lab_name)
    return get_attendance_service().read_lab_session(normalized_lab_name)


@router.post("/labs/{lab_name}/login")
def login_lab(lab_name: str, payload: AttendanceLoginRequest) -> dict[str, Any]:
    normalized_lab_name = _normalize_lab_name(lab_name)
    try:
        return get_attendance_service().login_lab(
            normalized_lab_name,
            username=payload.username,
            password=payload.password,
        )
    except AttendanceError as exc:
        raise _service_error(exc) from exc


@router.post("/labs/{lab_name}/logout")
def logout_lab(lab_name: str, payload: AttendanceLogoutRequest) -> dict[str, Any]:
    normalized_lab_name = _normalize_lab_name(lab_name)
    return get_attendance_service().logout_lab(normalized_lab_name, reason=payload.reason)


@router.post("/labs/{lab_name}/work/start")
def start_lab_work(lab_name: str) -> dict[str, Any]:
    normalized_lab_name = _normalize_lab_name(lab_name)
    try:
        return get_attendance_service().start_lab_work(normalized_lab_name)
    except AttendanceError as exc:
        raise _service_error(exc) from exc


@router.get("/work-times")
def list_work_times(date: str | None = None) -> list[dict[str, Any]]:
    try:
        return get_attendance_service().list_work_times(date)
    except AttendanceError as exc:
        raise _service_error(exc) from exc
