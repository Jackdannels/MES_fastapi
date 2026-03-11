import os

import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("APP_NAME", "MES Test")
os.environ["DEBUG"] = "true"
os.environ.setdefault("DEMO_USER", "test-admin")
os.environ.setdefault("DEMO_PASSWORD", "test-password")
os.environ.setdefault("SESSION_SECRET_KEY", "test-session-secret")

from app.main import app


def pytest_configure() -> None:
    app.state.testing = True


def pytest_unconfigure() -> None:
    app.state.testing = False


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)
