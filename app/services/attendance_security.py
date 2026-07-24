"""Password and QR identity primitives for attendance authentication."""

from __future__ import annotations

import hashlib
import hmac
import secrets
from typing import Any

from app.services.attendance_time import normalize_text


ATTENDANCE_QR_PREFIX = "MES-ATTENDANCE:QR:"


def hash_password(password: str, *, salt: str | None = None) -> str:
    effective_salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", str(password).encode("utf-8"), effective_salt.encode("utf-8"), 120_000)
    return f"pbkdf2_sha256${effective_salt}${digest.hex()}"


def verify_password(password: str, password_hash: str) -> bool:
    try:
        scheme, salt, _digest = password_hash.split("$", 2)
    except ValueError:
        return False
    if scheme != "pbkdf2_sha256":
        return False
    return hmac.compare_digest(hash_password(password, salt=salt), password_hash)


def generate_qr_token() -> str:
    return secrets.token_urlsafe(32)


def normalize_qr_token(value: Any) -> str:
    normalized = normalize_text(value)
    if normalized.startswith(ATTENDANCE_QR_PREFIX):
        return normalize_text(normalized[len(ATTENDANCE_QR_PREFIX) :])
    return normalized


def hash_qr_token(token: str) -> str:
    normalized = normalize_qr_token(token)
    if not normalized:
        return ""
    return hashlib.sha256(f"attendance-qr:{normalized}".encode("utf-8")).hexdigest()


def build_qr_payload(token: str) -> str:
    return f"{ATTENDANCE_QR_PREFIX}{normalize_qr_token(token)}"
