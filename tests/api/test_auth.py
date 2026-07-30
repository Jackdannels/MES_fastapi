from datetime import datetime, timedelta, timezone

import app.api.auth_session as auth_session
import pytest
from app.core.config import settings
from app.services.fixed_terminal_auth import (
    FixedTerminalAuthService,
    InMemoryFixedTerminalRepository,
    set_fixed_terminal_auth_service_for_tests,
)


@pytest.fixture(autouse=True)
def _reset_fixed_terminal_auth_service():
    set_fixed_terminal_auth_service_for_tests(
        FixedTerminalAuthService(repository=InMemoryFixedTerminalRepository())
    )
    yield
    set_fixed_terminal_auth_service_for_tests(None)


def set_auth_time(monkeypatch, moment):
    monkeypatch.setattr(auth_session, "current_utc", lambda: moment)


def test_login_rejects_invalid_credentials(client):
    response = client.post(
        "/auth/login",
        json={"username": "bad", "password": "bad", "module": "central"},
    )

    assert response.status_code == 401
    assert response.json() == {"detail": "Invalid credentials"}


def test_login_returns_service_unavailable_when_demo_auth_is_not_configured(client, monkeypatch):
    monkeypatch.setattr(settings, "DEMO_USER", None)
    monkeypatch.setattr(settings, "DEMO_PASSWORD", None)

    response = client.post(
        "/auth/login",
        json={"username": "any", "password": "any", "module": "central"},
    )

    assert response.status_code == 503
    assert response.json() == {"detail": "Demo auth is not configured"}


def test_login_returns_service_unavailable_when_session_secret_is_not_configured(client, monkeypatch):
    monkeypatch.setattr(settings, "SESSION_SECRET_KEY", None)

    response = client.post(
        "/auth/login",
        json={"username": settings.DEMO_USER, "password": settings.DEMO_PASSWORD, "module": "central"},
    )

    assert response.status_code == 503
    assert response.json() == {"detail": "Auth session secret is not configured"}


def test_login_accepts_demo_credentials(client):
    response = client.post(
        "/auth/login",
        json={"username": settings.DEMO_USER, "password": settings.DEMO_PASSWORD, "module": "visual"},
    )

    assert response.status_code == 200
    assert response.json()["username"] == settings.DEMO_USER
    assert response.json()["module"] == "visual"
    assert isinstance(response.json()["logged_at"], str)
    assert response.json()["logged_at"]
    assert response.cookies.get("mes_session")
    assert response.headers["cache-control"] == "no-store"


def test_login_accepts_handover_module(client):
    response = client.post(
        "/auth/login",
        json={"username": settings.DEMO_USER, "password": settings.DEMO_PASSWORD, "module": "handover"},
    )

    assert response.status_code == 200
    assert response.json()["module"] == "handover"


def test_login_accepts_laboratory_module(client):
    response = client.post(
        "/auth/login",
        json={"username": settings.DEMO_USER, "password": settings.DEMO_PASSWORD, "module": "laboratory"},
    )

    assert response.status_code == 200
    assert response.json()["module"] == "laboratory"


def test_fixed_terminal_register_ticket_and_consume_enters_bound_staging_module(client):
    registration = client.post(
        "/auth/terminal/register",
        json={
            "username": settings.DEMO_USER,
            "password": settings.DEMO_PASSWORD,
            "terminal_id": "STAGING-PC-01",
            "terminal_name": "暂存间终端",
            "module": "staging",
            "lab_name": "",
        },
    )

    assert registration.status_code == 200
    registered = registration.json()
    assert registered["target"] == "/staging-management"
    assert registered["terminalSecret"]

    ticket_response = client.post(
        "/auth/terminal/ticket",
        json={
            "terminal_id": registered["terminalId"],
            "terminal_secret": registered["terminalSecret"],
        },
    )
    assert ticket_response.status_code == 200

    consume = client.get(
        "/auth/terminal/consume",
        params={"ticket": ticket_response.json()["ticket"]},
        follow_redirects=False,
    )
    assert consume.status_code == 302
    assert consume.headers["location"] == "/staging-management"
    assert consume.cookies.get("mes_session")

    session = client.get("/auth/session")
    assert session.status_code == 200
    assert session.json()["module"] == "staging"
    assert session.json()["terminal_auth"] is True
    assert session.json()["terminal_id"] == "STAGING-PC-01"

    switch = client.post("/auth/switch-module", json={"module": "central"})
    assert switch.status_code == 403
    assert switch.json() == {"detail": "Fixed terminal cannot switch module"}


def test_fixed_terminal_laboratory_ticket_redirects_to_bound_lab(client):
    registration = client.post(
        "/auth/terminal/register",
        json={
            "username": settings.DEMO_USER,
            "password": settings.DEMO_PASSWORD,
            "terminal_id": "IMPACT-PC-02",
            "terminal_name": "冲击二室终端",
            "module": "laboratory",
            "lab_name": "冲击二室",
        },
    )
    ticket_response = client.post(
        "/auth/terminal/ticket",
        json={
            "terminal_id": registration.json()["terminalId"],
            "terminal_secret": registration.json()["terminalSecret"],
        },
    )

    consume = client.get(
        "/auth/terminal/consume",
        params={"ticket": ticket_response.json()["ticket"]},
        follow_redirects=False,
    )

    assert consume.status_code == 302
    assert consume.headers["location"] == "/laboratory?lab=LAB_IMPACT_2"
    assert client.get("/auth/session").json()["lab_name"] == "冲击二室"


def test_fixed_terminal_registration_rejects_invalid_admin_credentials(client):
    response = client.post(
        "/auth/terminal/register",
        json={
            "username": "bad",
            "password": "bad",
            "terminal_id": "STAGING-PC-01",
            "terminal_name": "暂存间终端",
            "module": "staging",
        },
    )

    assert response.status_code == 401
    assert response.json() == {"detail": "Invalid credentials"}


def test_login_sets_secure_cookie_when_debug_is_disabled(client, monkeypatch):
    monkeypatch.setattr(settings, "DEBUG", False)
    monkeypatch.setattr(settings, "SESSION_COOKIE_SECURE", None, raising=False)

    response = client.post(
        "/auth/login",
        json={"username": settings.DEMO_USER, "password": settings.DEMO_PASSWORD, "module": "central"},
    )

    assert response.status_code == 200
    assert "Secure" in response.headers["set-cookie"]


def test_login_allows_overriding_secure_cookie_policy(client, monkeypatch):
    monkeypatch.setattr(settings, "DEBUG", True)
    monkeypatch.setattr(settings, "SESSION_COOKIE_SECURE", True, raising=False)

    response = client.post(
        "/auth/login",
        json={"username": settings.DEMO_USER, "password": settings.DEMO_PASSWORD, "module": "central"},
    )

    assert response.status_code == 200
    assert "Secure" in response.headers["set-cookie"]


def test_session_returns_user_from_cookie(client):
    client.post(
        "/auth/login",
        json={"username": settings.DEMO_USER, "password": settings.DEMO_PASSWORD, "module": "visual"},
    )

    response = client.get("/auth/session")

    assert response.status_code == 200
    assert response.json()["username"] == settings.DEMO_USER
    assert response.json()["module"] == "visual"
    assert response.json()["logged_at"]
    assert response.json()["last_seen_at"]
    assert response.json()["expires_at"] is None
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["vary"] == "Cookie"


def test_logout_clears_session_cookie(client):
    client.post(
        "/auth/login",
        json={"username": settings.DEMO_USER, "password": settings.DEMO_PASSWORD, "module": "central"},
    )

    response = client.post("/auth/logout")
    session_response = client.get("/auth/session")

    assert response.status_code == 204
    assert "mes_session=" in response.headers["set-cookie"]
    assert response.headers["cache-control"] == "no-store"
    assert session_response.status_code == 401


def test_switch_module_updates_the_current_auth_session(client):
    client.post(
        "/auth/login",
        json={"username": settings.DEMO_USER, "password": settings.DEMO_PASSWORD, "module": "central"},
    )

    response = client.post("/auth/switch-module", json={"module": "visual"})
    session_response = client.get("/auth/session")

    assert response.status_code == 200
    assert response.json()["username"] == settings.DEMO_USER
    assert response.json()["module"] == "visual"
    assert response.headers["cache-control"] == "no-store"
    assert session_response.status_code == 200
    assert session_response.json()["module"] == "visual"


def test_switch_module_accepts_laboratory(client):
    client.post(
        "/auth/login",
        json={"username": settings.DEMO_USER, "password": settings.DEMO_PASSWORD, "module": "central"},
    )

    response = client.post("/auth/switch-module", json={"module": "laboratory"})
    session_response = client.get("/auth/session")

    assert response.status_code == 200
    assert response.json()["module"] == "laboratory"
    assert session_response.status_code == 200
    assert session_response.json()["module"] == "laboratory"


def test_switch_module_requires_an_authenticated_session(client):
    response = client.post("/auth/switch-module", json={"module": "visual"})

    assert response.status_code == 401
    assert response.json() == {"detail": "Not authenticated"}


def test_switch_module_rejects_unknown_modules(client):
    client.post(
        "/auth/login",
        json={"username": settings.DEMO_USER, "password": settings.DEMO_PASSWORD, "module": "central"},
    )

    response = client.post("/auth/switch-module", json={"module": "unknown"})

    assert response.status_code == 400
    assert response.json() == {"detail": "Invalid module"}


def test_session_does_not_expire_by_default_after_long_inactivity(client, monkeypatch):
    monkeypatch.setattr(settings, "SESSION_IDLE_TIMEOUT_MINUTES", 0)
    monkeypatch.setattr(settings, "SESSION_MAX_AGE_HOURS", 0)
    start = datetime(2026, 3, 11, 9, 0, tzinfo=timezone.utc)
    set_auth_time(monkeypatch, start)
    client.post(
        "/auth/login",
        json={"username": settings.DEMO_USER, "password": settings.DEMO_PASSWORD, "module": "central"},
    )

    much_later = start + timedelta(days=30)
    set_auth_time(monkeypatch, much_later)
    response = client.get("/auth/session")

    assert response.status_code == 200
    assert response.json()["logged_at"] == "2026-03-11T09:00:00Z"
    assert response.json()["last_seen_at"] == "2026-04-10T09:00:00Z"
    assert response.json()["expires_at"] is None
    assert response.cookies.get("mes_session")


def test_session_refreshes_idle_deadline_before_timeout(client, monkeypatch):
    monkeypatch.setattr(settings, "SESSION_IDLE_TIMEOUT_MINUTES", 30)
    monkeypatch.setattr(settings, "SESSION_MAX_AGE_HOURS", 8)
    start = datetime(2026, 3, 11, 9, 0, tzinfo=timezone.utc)
    set_auth_time(monkeypatch, start)
    client.post(
        "/auth/login",
        json={"username": settings.DEMO_USER, "password": settings.DEMO_PASSWORD, "module": "central"},
    )

    refreshed_at = start + timedelta(minutes=29)
    set_auth_time(monkeypatch, refreshed_at)
    response = client.get("/auth/session")

    assert response.status_code == 200
    assert response.json()["logged_at"] == "2026-03-11T09:00:00Z"
    assert response.json()["last_seen_at"] == "2026-03-11T09:29:00Z"
    assert response.json()["expires_at"] == "2026-03-11T17:00:00Z"
    assert response.cookies.get("mes_session")


def test_session_expires_after_idle_timeout(client, monkeypatch):
    monkeypatch.setattr(settings, "SESSION_IDLE_TIMEOUT_MINUTES", 30)
    monkeypatch.setattr(settings, "SESSION_MAX_AGE_HOURS", 8)
    start = datetime(2026, 3, 11, 9, 0, tzinfo=timezone.utc)
    set_auth_time(monkeypatch, start)
    login_response = client.post(
        "/auth/login",
        json={"username": settings.DEMO_USER, "password": settings.DEMO_PASSWORD, "module": "central"},
    )
    assert login_response.cookies.get("mes_session")

    expired_at = start + timedelta(minutes=31)
    set_auth_time(monkeypatch, expired_at)
    response = client.get("/auth/session")

    assert response.status_code == 401
    assert response.json() == {"detail": "Session expired"}
    assert "mes_session=" in response.headers["set-cookie"]
    assert 'Max-Age=0' in response.headers["set-cookie"]


def test_session_expires_after_absolute_lifetime(client, monkeypatch):
    monkeypatch.setattr(settings, "SESSION_IDLE_TIMEOUT_MINUTES", 30)
    monkeypatch.setattr(settings, "SESSION_MAX_AGE_HOURS", 8)
    start = datetime(2026, 3, 11, 9, 0, tzinfo=timezone.utc)
    set_auth_time(monkeypatch, start)
    client.post(
        "/auth/login",
        json={"username": settings.DEMO_USER, "password": settings.DEMO_PASSWORD, "module": "visual"},
    )

    expired_at = start + timedelta(hours=8, seconds=1)
    set_auth_time(monkeypatch, expired_at)
    response = client.get("/auth/session")

    assert response.status_code == 401
    assert response.json() == {"detail": "Session expired"}
