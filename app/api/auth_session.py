import base64
import hashlib
import hmac
import json
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, Request, Response

from app.core.config import settings

SIGNING_SALT = "auth-session"


def require_session_secret() -> str:
    secret = settings.SESSION_SECRET_KEY
    if not secret:
        raise HTTPException(status_code=503, detail="Auth session secret is not configured")
    return secret


def current_utc() -> datetime:
    return datetime.now(timezone.utc)


def use_secure_session_cookie() -> bool:
    if settings.SESSION_COOKIE_SECURE is not None:
        return settings.SESSION_COOKIE_SECURE
    return not settings.DEBUG


def format_utc(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def parse_utc(value: str) -> datetime:
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).astimezone(timezone.utc)
    except ValueError as exc:
        raise HTTPException(status_code=401, detail="Invalid session") from exc


def build_auth_session(*, username: str, module: str, now: datetime | None = None) -> dict:
    issued_at = (now or current_utc()).astimezone(timezone.utc)
    expires_at = issued_at + timedelta(hours=settings.SESSION_MAX_AGE_HOURS)
    return {
        "username": username,
        "module": module,
        "logged_at": format_utc(issued_at),
        "last_seen_at": format_utc(issued_at),
        "expires_at": format_utc(expires_at),
    }


def refresh_auth_session(session: dict, *, now: datetime | None = None) -> dict:
    current_time = (now or current_utc()).astimezone(timezone.utc)
    logged_at = parse_utc(str(session.get("logged_at", "")))
    last_seen_at = parse_utc(str(session.get("last_seen_at", "")))
    expires_at = parse_utc(str(session.get("expires_at", "")))
    idle_deadline = last_seen_at + timedelta(minutes=settings.SESSION_IDLE_TIMEOUT_MINUTES)
    if current_time > idle_deadline or current_time > expires_at:
        raise HTTPException(status_code=401, detail="Session expired")
    return {
        **session,
        "last_seen_at": format_utc(current_time),
        "logged_at": format_utc(logged_at),
        "expires_at": format_utc(expires_at),
    }


def dump_auth_session(session: dict) -> str:
    payload = json.dumps(session, separators=(",", ":"), sort_keys=True).encode("utf-8")
    payload_token = base64.urlsafe_b64encode(payload).decode("ascii")
    signature = _sign_payload(payload_token)
    return f"{payload_token}.{signature}"


def load_auth_session(token: str) -> dict:
    require_session_secret()
    try:
        payload_token, signature = token.rsplit(".", 1)
    except ValueError as exc:
        raise HTTPException(status_code=401, detail="Invalid session") from exc
    expected_signature = _sign_payload(payload_token)
    if not hmac.compare_digest(signature, expected_signature):
        raise HTTPException(status_code=401, detail="Invalid session")
    try:
        payload = json.loads(base64.urlsafe_b64decode(payload_token.encode("ascii")))
    except (ValueError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=401, detail="Invalid session") from exc
    if not isinstance(payload, dict):
        raise HTTPException(status_code=401, detail="Invalid session")
    return payload


def set_auth_cookie(response: Response, session: dict) -> None:
    require_session_secret()
    expires_at = parse_utc(str(session.get("expires_at", "")))
    remaining_seconds = max(0, int((expires_at - current_utc()).total_seconds()))
    response.set_cookie(
        key=settings.SESSION_COOKIE_NAME,
        value=dump_auth_session(session),
        httponly=True,
        secure=use_secure_session_cookie(),
        samesite="lax",
        path="/",
        max_age=remaining_seconds,
    )


def clear_auth_cookie(response: Response) -> None:
    response.delete_cookie(settings.SESSION_COOKIE_NAME, path="/")


def require_auth_session(request: Request) -> dict:
    token = request.cookies.get(settings.SESSION_COOKIE_NAME)
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return load_auth_session(token)


def _sign_payload(payload_token: str) -> str:
    message = f"{SIGNING_SALT}:{payload_token}".encode("utf-8")
    secret = require_session_secret().encode("utf-8")
    digest = hmac.new(secret, message, hashlib.sha256).digest()
    return base64.urlsafe_b64encode(digest).decode("ascii").rstrip("=")
