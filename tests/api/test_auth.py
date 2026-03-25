from datetime import datetime, timedelta, timezone

import app.api.auth_session as auth_session
from app.core.config import settings


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
    assert response.json()["expires_at"]
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


def test_session_refreshes_idle_deadline_before_timeout(client, monkeypatch):
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
