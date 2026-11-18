from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import hashlib
import secrets
import uuid

import pytest

from app.core.config import settings
from app.services.fixed_terminal_auth import FixedTerminalAuthService, InMemoryFixedTerminalRepository, set_fixed_terminal_auth_service_for_tests
from app.services.terminal_control import InMemoryTerminalControlRepository, TerminalControlService, set_terminal_control_service_for_tests
from app.services.terminal_enrollment import (InMemoryEnrollmentRepository, TerminalEnrollmentService,
    set_terminal_enrollment_service_for_tests, stations)

BASE = "/api/terminal-control/enrollment"


@pytest.fixture(autouse=True)
def enrollment(tmp_path):
    auth = InMemoryFixedTerminalRepository()
    runtime = InMemoryTerminalControlRepository()
    auth_service = FixedTerminalAuthService(auth)
    control = TerminalControlService(runtime, auth_service)
    repository = InMemoryEnrollmentRepository(auth, runtime)
    service = TerminalEnrollmentService(repository, tmp_path)
    for station in stations():
        (tmp_path / (station["id"] + ".zip")).write_bytes(b"test-only-package")
    set_fixed_terminal_auth_service_for_tests(auth_service)
    set_terminal_control_service_for_tests(control)
    set_terminal_enrollment_service_for_tests(service)
    yield service, auth_service, control
    set_terminal_enrollment_service_for_tests(None)
    set_terminal_control_service_for_tests(None)
    set_fixed_terminal_auth_service_for_tests(None)


def create(client, station="LAB_SALT", device=None):
    payload = dict(requestId=uuid.uuid4().hex, token=secrets.token_hex(32), deviceId=device or uuid.uuid4().hex,
                   machineName="申请电脑", stationId=station)
    response = client.post(BASE + "/requests", json=payload)
    assert response.status_code == 200, response.text
    assert "tokenHash" not in response.json() and "token" not in response.json()
    return payload


def login(client):
    assert client.post("/auth/login", json=dict(username=settings.DEMO_USER, password=settings.DEMO_PASSWORD, module="central")).status_code == 200


def claim(client, payload):
    login(client)
    result = client.post(BASE + "/requests/" + payload["requestId"] + "/review", json=dict(approve=True, stationId=payload["stationId"]))
    assert result.status_code == 200, result.text
    result = client.post(BASE + "/requests/" + payload["requestId"] + "/poll", json=dict(token=payload["token"]))
    assert result.status_code == 200
    return result.json()


def sign_in(client, binding):
    ticket = client.post("/auth/terminal/ticket", json=dict(terminal_id=binding["terminalId"], terminal_secret=binding["terminalSecret"]))
    assert ticket.status_code == 200
    response = client.get("/auth/terminal/consume", params=dict(ticket=ticket.json()["ticket"]), follow_redirects=False)
    assert response.status_code == 302


def test_pending_cannot_download_or_enter_business_and_does_not_create_terminal(client, enrollment):
    payload = create(client)
    path = BASE + "/requests/" + payload["requestId"]
    poll = client.post(path + "/poll", json=dict(token=payload["token"])).json()
    assert poll["status"] == "pending" and "binding" not in poll
    assert client.post(path + "/package", json=dict(token=payload["token"])).status_code == 403
    assert client.get(BASE + "/requests").status_code == 401
    assert client.post(path + "/review", json=dict(approve=True, stationId="LAB_SALT")).status_code == 401
    assert enrollment[1].list_active_terminals() == []


def test_approval_claim_is_idempotent_and_package_is_bound_to_request(client):
    payload = create(client)
    result = claim(client, payload)
    assert result["status"] == "issued" and result["station"]["id"] == "LAB_SALT"
    assert result["packageSha256"] == hashlib.sha256(b"test-only-package").hexdigest()
    path = BASE + "/requests/" + payload["requestId"]
    again = client.post(path + "/poll", json=dict(token=payload["token"])).json()
    assert again["binding"] == result["binding"]
    assert client.post(path + "/package", json=dict(token=payload["token"])).content == b"test-only-package"
    assert client.post(path + "/poll", json=dict(token=secrets.token_hex(32))).status_code == 403
    listing = client.get(BASE + "/requests").json()["items"]
    assert all("tokenHash" not in row and "binding" not in row for row in listing)


def test_reset_invalidates_old_credentials_session_ticket_and_package(client):
    payload = create(client)
    result = claim(client, payload)
    binding = result["binding"]
    ticket = client.post("/auth/terminal/ticket", json=dict(terminal_id=binding["terminalId"], terminal_secret=binding["terminalSecret"])).json()["ticket"]
    sign_in(client, binding)
    old_cookie = client.cookies.get(settings.SESSION_COOKIE_NAME)
    assert client.get("/auth/session").status_code == 200
    login(client)
    assert client.post(BASE + "/terminals/" + binding["terminalId"] + "/reset").status_code == 200
    assert client.post("/auth/terminal/ticket", json=dict(terminal_id=binding["terminalId"], terminal_secret=binding["terminalSecret"])).status_code == 401
    assert client.get("/auth/terminal/consume", params=dict(ticket=ticket), follow_redirects=False).status_code == 401
    client.cookies.clear()
    client.cookies.set(settings.SESSION_COOKIE_NAME, old_cookie)
    assert client.get("/auth/session").status_code == 401
    path = BASE + "/requests/" + payload["requestId"]
    assert client.post(path + "/poll", json=dict(token=payload["token"])).json()["status"] == "reset"
    assert client.post(path + "/package", json=dict(token=payload["token"])).status_code == 403


def test_manager_may_assign_a_different_precompiled_workstation(client):
    payload = create(client, "LAB_SALT")
    login(client)
    assert client.post(BASE + "/requests/" + payload["requestId"] + "/review", json=dict(approve=True, stationId="LAB_IMPACT_1")).status_code == 200
    result = client.post(BASE + "/requests/" + payload["requestId"] + "/poll", json=dict(token=payload["token"])).json()
    assert result["station"]["id"] == "LAB_IMPACT_1"
    assert result["binding"]["target"] == "/laboratory?lab=LAB_IMPACT_1"


def test_rejection_and_expiry_cannot_be_claimed_or_reapproved(client, enrollment):
    payload = create(client)
    login(client)
    path = BASE + "/requests/" + payload["requestId"]
    assert client.post(path + "/review", json=dict(approve=False)).status_code == 200
    assert client.post(path + "/poll", json=dict(token=payload["token"])).json()["status"] == "denied"
    assert client.post(path + "/review", json=dict(approve=True, stationId="LAB_SALT")).status_code == 409
    another = create(client)
    enrollment[0].clock = lambda: datetime.now(timezone.utc) + timedelta(hours=25)
    assert client.post(BASE + "/requests/" + another["requestId"] + "/poll", json=dict(token=another["token"])).json()["status"] == "expired"


def test_legacy_cleanup_uses_preview_and_protects_new_or_online_bindings(client, enrollment):
    service, auth, control = enrollment
    for identifier in ("legacy-offline", "legacy-online"):
        terminal = auth.register_terminal(terminal_id=identifier, terminal_name=identifier, module="staging")
        if identifier.endswith("online"):
            control.heartbeat(terminal_id=identifier, terminal_secret=terminal["terminal_secret"], ip_address="127.0.0.1",
                              reported_ip="", machine_name="online", configured_path="", agent_version="test", allow_reload=True, allow_power=False)
    payload = create(client)
    claimed = claim(client, payload)
    preview = client.get(BASE + "/legacy-preview").json()["items"]
    assert [row["terminalId"] for row in preview] == ["legacy-offline"]
    for identifier in ("legacy-online", claimed["binding"]["terminalId"]):
        assert client.post(BASE + "/legacy-cleanup", json=dict(terminalIds=[identifier])).status_code == 409
    assert client.post(BASE + "/legacy-cleanup", json=dict(terminalIds=["legacy-offline"])).json()["removedCount"] == 1
    assert auth.repository.find_terminal("legacy-offline") is None


def test_parallel_claims_issue_one_stable_credential_and_reset_cannot_be_replayed(client, enrollment):
    payload = create(client)
    service = enrollment[0]
    service.review(payload["requestId"], True, "LAB_SALT", "manager")
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(lambda _: service.poll(payload["requestId"], payload["token"]), range(12)))
    assert len({row["binding"]["terminalSecret"] for row in results}) == 1
    assert len(enrollment[1].list_active_terminals()) == 1
    service.reset(results[0]["terminalId"], "manager")
    assert service.poll(payload["requestId"], payload["token"])["status"] == "reset"


def test_rebinding_allows_changed_ip_and_requires_another_approval(client, enrollment):
    payload = create(client)
    old = claim(client, payload)
    enrollment[0].reset(old["terminalId"], "manager")
    other = create(client, "LAB_IMPACT_2", payload["deviceId"])
    assert enrollment[0].poll(other["requestId"], other["token"], "192.0.2.200")["status"] == "pending"
    new = claim(client, other)
    assert new["terminalId"] != old["terminalId"]
    assert new["binding"]["labName"] == "冲击二室"


def test_approved_but_unclaimed_request_expires(client, enrollment):
    payload = create(client)
    service = enrollment[0]
    service.review(payload['requestId'], True, 'LAB_SALT', 'manager')
    service.clock = lambda: datetime.now(timezone.utc) + timedelta(hours=25)
    assert service.poll(payload['requestId'], payload['token'])['status'] == 'expired'
    assert enrollment[1].list_active_terminals() == []
