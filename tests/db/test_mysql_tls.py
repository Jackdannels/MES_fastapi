from types import SimpleNamespace

import pytest

from app.db.mysql_pool import MySQLConnectionPool
from app.db.mysql_tls import mysql_tls_connect_options


def test_mysql_tls_options_enable_certificate_and_hostname_verification() -> None:
    settings = SimpleNamespace(
        MYSQL_SSL_CA="/run/secrets/mysql_ca.pem",
        MYSQL_SSL_CERT=None,
        MYSQL_SSL_KEY=None,
        MYSQL_SSL_VERIFY_CERT=True,
        MYSQL_SSL_VERIFY_IDENTITY=True,
    )

    assert mysql_tls_connect_options(settings) == {
        "ssl_ca": "/run/secrets/mysql_ca.pem",
        "ssl_verify_cert": True,
        "ssl_verify_identity": True,
    }


def test_mysql_tls_requires_client_certificate_and_key_together() -> None:
    settings = SimpleNamespace(
        MYSQL_SSL_CA=None,
        MYSQL_SSL_CERT="client.pem",
        MYSQL_SSL_KEY=None,
        MYSQL_SSL_VERIFY_CERT=False,
        MYSQL_SSL_VERIFY_IDENTITY=False,
    )

    with pytest.raises(RuntimeError, match="must be configured together"):
        mysql_tls_connect_options(settings)


def test_mysql_pool_passes_the_same_tls_options_to_pymysql(monkeypatch) -> None:
    calls = []
    fake_connection = object()
    monkeypatch.setattr("pymysql.connect", lambda **kwargs: calls.append(kwargs) or fake_connection)
    settings = SimpleNamespace(
        host="mysql.example.internal",
        port=3306,
        user="mes_api",
        password="secret",
        database="mes_single_branch",
        charset="utf8mb4",
        pool_size=1,
        pool_timeout_seconds=5.0,
        ssl_ca="/run/secrets/mysql_ca.pem",
        ssl_cert=None,
        ssl_key=None,
        ssl_verify_cert=True,
        ssl_verify_identity=True,
    )

    assert MySQLConnectionPool(settings)._create_connection() is fake_connection
    assert calls[0]["ssl_ca"] == "/run/secrets/mysql_ca.pem"
    assert calls[0]["ssl_verify_cert"] is True
    assert calls[0]["ssl_verify_identity"] is True
