import os

import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("APP_NAME", "MES Test")
os.environ["DEBUG"] = "true"
os.environ.setdefault("DEMO_USER", "test-admin")
os.environ.setdefault("DEMO_PASSWORD", "test-password")
os.environ.setdefault("SESSION_SECRET_KEY", "test-session-secret")
os.environ.setdefault("FRONTEND_ORIGINS", "http://127.0.0.1:5173,http://localhost:5173")
os.environ.setdefault("STORAGE_BACKEND", "mysql")
os.environ.setdefault("MYSQL_BOOTSTRAP_FROM_JSON", "false")

from app.main import app


def pytest_configure() -> None:
    app.state.testing = True


def pytest_unconfigure() -> None:
    app.state.testing = False


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)
