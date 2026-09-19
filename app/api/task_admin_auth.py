"""Administrator verification at the manual task-mutation HTTP boundary."""

from hmac import compare_digest
from urllib.parse import unquote

from fastapi import HTTPException, Request


def require_task_admin(request: Request) -> None:
    username = unquote(request.headers.get("X-Admin-Username", "")).strip()
    password = unquote(request.headers.get("X-Admin-Password", "")).strip()
    if not username or not password:
        raise HTTPException(status_code=401, detail="请输入管理员账号和密码")
    if not (compare_digest(username.encode(), b"admin") and compare_digest(password.encode(), b"123")):
        raise HTTPException(status_code=401, detail="管理员账号或密码错误")
