from __future__ import annotations

from typing import Any


def _setting(source: Any, upper_name: str, lower_name: str, default: Any = None) -> Any:
    if hasattr(source, upper_name):
        return getattr(source, upper_name)
    return getattr(source, lower_name, default)


def mysql_tls_connect_options(source: Any) -> dict[str, Any]:
    """Return one canonical set of PyMySQL TLS options for every connection path."""
    ca = _setting(source, "MYSQL_SSL_CA", "ssl_ca")
    cert = _setting(source, "MYSQL_SSL_CERT", "ssl_cert")
    key = _setting(source, "MYSQL_SSL_KEY", "ssl_key")
    verify_cert = bool(_setting(source, "MYSQL_SSL_VERIFY_CERT", "ssl_verify_cert", False))
    verify_identity = bool(_setting(source, "MYSQL_SSL_VERIFY_IDENTITY", "ssl_verify_identity", False))

    if bool(cert) != bool(key):
        raise RuntimeError("MYSQL_SSL_CERT and MYSQL_SSL_KEY must be configured together.")
    if verify_identity:
        verify_cert = True

    options: dict[str, Any] = {}
    if ca:
        options["ssl_ca"] = str(ca)
    if cert:
        options["ssl_cert"] = str(cert)
        options["ssl_key"] = str(key)
    if ca or cert or verify_cert or verify_identity:
        options["ssl_verify_cert"] = verify_cert
        options["ssl_verify_identity"] = verify_identity
    return options
