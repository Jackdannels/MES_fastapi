import os
from pathlib import Path
from tempfile import TemporaryDirectory

import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("APP_NAME", "MES Test")
os.environ["DEBUG"] = "true"
os.environ.setdefault("DEMO_USER", "test-admin")
os.environ.setdefault("DEMO_PASSWORD", "test-password")
os.environ.setdefault("SESSION_SECRET_KEY", "test-session-secret")
os.environ.setdefault("FRONTEND_ORIGINS", "http://127.0.0.1:5173,http://localhost:5173")
os.environ.setdefault("STORAGE_BACKEND", "mysql")
# Never start a real LAN backup worker from application lifespan tests.
os.environ["TEST_DATA_BACKUP_PATH"] = ""
_backup_test_directory = TemporaryDirectory(prefix="mes-test-backup-")
os.environ["TEST_DATA_BACKUP_STATE_PATH"] = str(Path(_backup_test_directory.name) / "state.sqlite3")

from app.main import app
from app.services.attendance_service import AttendanceService, InMemoryAttendanceRepository, set_attendance_service_for_tests


def pytest_configure() -> None:
    app.state.testing = True


def pytest_unconfigure() -> None:
    app.state.testing = False
    _backup_test_directory.cleanup()


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


@pytest.fixture(autouse=True)
def _reset_attendance_service():
    set_attendance_service_for_tests(AttendanceService(repository=InMemoryAttendanceRepository()))
    yield
    set_attendance_service_for_tests(None)
