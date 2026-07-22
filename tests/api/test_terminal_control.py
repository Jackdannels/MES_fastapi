from datetime import datetime, timezone

import pytest

from app.core.config import settings
from app.services.fixed_terminal_auth import (
    FixedTerminalAuthService,
    InMemoryFixedTerminalRepository,
    set_fixed_terminal_auth_service_for_tests,
)
from app.services.terminal_control import (
    InMemoryTerminalControlRepository,
    TerminalControlService,
    set_terminal_control_service_for_tests,
)


NOW = datetime(2026, 7, 22, 8, 0, tzinfo=timezone.utc)


@pytest.fixture(autouse=True)
def _reset_terminal_services():
    auth_service = FixedTerminalAuthService(repository=InMemoryFixedTerminalRepository())
    set_fixed_terminal_auth_service_for_tests(auth_service)
    set_terminal_control_service_for_tests(
        TerminalControlService(
            repository=InMemoryTerminalControlRepository(),
            auth_service=auth_service,
            clock=lambda: NOW,
        )
    )
    yield
    set_terminal_control_service_for_tests(None)
    set_fixed_terminal_auth_service_for_tests(None)


def register_terminal(client, terminal_id="STAGING-PC-01", module="staging"):
    response = client.post(
        "/auth/terminal/register",
        json={
            "username": settings.DEMO_USER,
            "password": settings.DEMO_PASSWORD,
            "terminal_id": terminal_id,
            "terminal_name": "暂存间终端",
            "module": module,
            "lab_name": "",
        },
    )
    assert response.status_code == 200
    return response.json()


def central_login(client):
    response = client.post(
        "/auth/login",
        json={
            "username": settings.DEMO_USER,
            "password": settings.DEMO_PASSWORD,
            "module": "central",
        },
    )
    assert response.status_code == 200


def heartbeat(client, terminal, **overrides):
    payload = {
        "terminalId": terminal["terminalId"],
        "terminalSecret": terminal["terminalSecret"],
        "machineName": "STAGING-PC-01",
        "ipAddress": "192.168.110.21",
        "configuredPath": "/staging-management",
        "agentVersion": "v1.6",
        "allowReload": True,
        "allowPower": True,
    }
    payload.update(overrides)
    return client.post("/api/terminal-control/heartbeat", json=payload)


def test_heartbeat_exposes_online_ip_page_and_capabilities_to_central(client):
    terminal = register_terminal(client)

    response = heartbeat(client, terminal)

    assert response.status_code == 200
    assert response.json() == {"ok": True, "command": None}

    central_login(client)
    listing = client.get("/api/terminal-control/terminals")

    assert listing.status_code == 200
    assert listing.json() == {
        "items": [
            {
                "terminalId": "STAGING-PC-01",
                "terminalName": "暂存间终端",
                "machineName": "STAGING-PC-01",
                "ipAddress": "192.168.110.21",
                "module": "staging",
                "labName": "",
                "currentPath": "/staging-management",
                "currentTitle": "",
                "agentVersion": "v1.6",
                "allowReload": True,
                "allowPower": True,
                "online": True,
                "lastSeenAt": "2026-07-22T08:00:00Z",
                "lastCommand": None,
            }
        ]
    }


def test_fixed_terminal_browser_reports_the_exact_current_page(client):
    terminal = register_terminal(client)
    assert heartbeat(client, terminal).status_code == 200
    ticket = client.post(
        "/auth/terminal/ticket",
        json={"terminal_id": terminal["terminalId"], "terminal_secret": terminal["terminalSecret"]},
    ).json()["ticket"]
    consume = client.get("/auth/terminal/consume", params={"ticket": ticket}, follow_redirects=False)
    assert consume.status_code == 302

    page = client.post(
        "/api/terminal-control/page",
        json={"path": "/staging-management?room=after", "title": "实验后暂存间"},
    )

    assert page.status_code == 200
    central_login(client)
    item = client.get("/api/terminal-control/terminals").json()["items"][0]
    assert item["ipAddress"] == "192.168.110.21"
    assert item["currentPath"] == "/staging-management?room=after"
    assert item["currentTitle"] == "实验后暂存间"


def test_central_can_queue_reload_and_terminal_completes_it(client):
    terminal = register_terminal(client)
    assert heartbeat(client, terminal).status_code == 200
    central_login(client)

    queued = client.post(
        "/api/terminal-control/terminals/STAGING-PC-01/commands",
        json={"action": "reload"},
    )

    assert queued.status_code == 202
    assert queued.json()["action"] == "reload"
    command_id = queued.json()["commandId"]

    dispatched = heartbeat(client, terminal).json()["command"]
    assert dispatched == {"commandId": command_id, "action": "reload"}

    completed = client.post(
        f"/api/terminal-control/commands/{command_id}/complete",
        json={
            "terminalId": terminal["terminalId"],
            "terminalSecret": terminal["terminalSecret"],
            "success": True,
            "message": "Edge 已重新载入",
        },
    )
    assert completed.status_code == 200

    central_login(client)
    last_command = client.get("/api/terminal-control/terminals").json()["items"][0]["lastCommand"]
    assert last_command["status"] == "completed"
    assert last_command["message"] == "Edge 已重新载入"


def test_power_command_is_rejected_when_terminal_did_not_enable_permission(client):
    terminal = register_terminal(client)
    assert heartbeat(client, terminal, allowPower=False).status_code == 200
    central_login(client)

    response = client.post(
        "/api/terminal-control/terminals/STAGING-PC-01/commands",
        json={"action": "shutdown"},
    )

    assert response.status_code == 409
    assert response.json() == {"detail": "Terminal does not allow remote power control"}


def test_batch_restart_only_targets_online_terminals_with_power_permission(client):
    first = register_terminal(client, "PC-01")
    second = register_terminal(client, "PC-02")
    assert heartbeat(client, first, machineName="PC-01", allowPower=True).status_code == 200
    assert heartbeat(client, second, machineName="PC-02", allowPower=False).status_code == 200
    central_login(client)

    response = client.post("/api/terminal-control/commands/batch", json={"action": "restart"})

    assert response.status_code == 202
    assert response.json()["queuedCount"] == 1
    assert response.json()["terminalIds"] == ["PC-01"]


def test_terminal_management_requires_a_non_terminal_central_session(client):
    unauthenticated = client.get("/api/terminal-control/terminals")
    assert unauthenticated.status_code == 401

    terminal = register_terminal(client)
    ticket = client.post(
        "/auth/terminal/ticket",
        json={"terminal_id": terminal["terminalId"], "terminal_secret": terminal["terminalSecret"]},
    ).json()["ticket"]
    client.get("/auth/terminal/consume", params={"ticket": ticket}, follow_redirects=False)

    forbidden = client.get("/api/terminal-control/terminals")
    assert forbidden.status_code == 403
