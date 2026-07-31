from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]


def test_runtime_images_exclude_tests_backups_and_local_secrets() -> None:
    dockerignore = (REPO_ROOT / ".dockerignore").read_text(encoding="utf-8").splitlines()

    for entry in ("tests", "artifacts", ".env", ".tmp", "frontend/node_modules"):
        assert entry in dockerignore


def test_api_and_web_images_run_as_non_root_users() -> None:
    api = (REPO_ROOT / "deploy" / "docker" / "Dockerfile.api").read_text(encoding="utf-8")
    web = (REPO_ROOT / "deploy" / "docker" / "Dockerfile.web").read_text(encoding="utf-8")

    assert "USER mes" in api
    assert '"--workers", "1"' in api
    assert "USER nginx" in web


def test_api_image_only_copies_migration_runtime_scripts() -> None:
    api = (REPO_ROOT / "deploy" / "docker" / "Dockerfile.api").read_text(encoding="utf-8")

    assert "COPY --chown=mes:mes scripts /app/scripts" not in api
    assert "scripts/init_mysql_storage.py" in api
    assert "scripts/sql/V005__terminal_collation_alignment.sql" in api
    for excluded in ("trial_run.py", "reset_demo_data.py", "run_p0_baselines.py"):
        assert excluded not in api


def test_production_python_requirements_exclude_test_and_inactive_database_drivers() -> None:
    requirements = (REPO_ROOT / "requirements-prod.txt").read_text(encoding="utf-8").lower()

    assert "pytest" not in requirements
    assert "dmpython" not in requirements
    assert "pymysql==" in requirements
    assert "aio-pika==" in requirements


def test_compose_isolated_stack_migrates_before_api_and_preserves_hostless_exception() -> None:
    compose = (REPO_ROOT / "compose.packaging.yml").read_text(encoding="utf-8")

    assert "MYSQL_DATABASE:-mes_packaging_test" in compose
    assert '"127.0.0.1:${MES_API_PORT:-18000}:8000"' in compose
    assert '"127.0.0.1:${MES_WEB_PORT:-15173}:8080"' in compose
    assert "condition: service_completed_successfully" in compose
    assert 'MQTT_ENABLED: "true"' in compose
    assert 'UPPER_COMPUTER_SIMULATOR_AUTO_ENABLE: "false"' in compose
    assert 'UPPER_COMPUTER_SIMULATOR_AUTO_START: "false"' in compose


def test_mysql_bootstrap_restricts_runtime_account_to_dml() -> None:
    script = (REPO_ROOT / "deploy" / "mysql" / "init-users.sh").read_text(encoding="utf-8")

    assert "REVOKE ALL PRIVILEGES, GRANT OPTION" in script
    assert "GRANT SELECT, INSERT, UPDATE, DELETE" in script
    assert "CREATE ROUTINE, ALTER ROUTINE, EXECUTE" in script


def test_production_compose_uses_external_database_file_secrets_and_immutable_images() -> None:
    compose = (REPO_ROOT / "compose.production.yml").read_text(encoding="utf-8")

    assert "MES_API_IMAGE:?" in compose
    assert "MES_WEB_IMAGE:?" in compose
    assert "build:" not in compose
    assert "mysql:" not in compose
    assert "MYSQL_HOST:?" in compose
    assert "target: MYSQL_PASSWORD" in compose
    assert "target: MYSQL_MIGRATION_PASSWORD" in compose
    assert "target: mysql_ca.pem" in compose
    assert 'MYSQL_SSL_VERIFY_IDENTITY: "true"' in compose
    assert 'SESSION_COOKIE_SECURE: "true"' in compose
    assert 'FRONTEND_ORIGINS: https://${MES_DOMAIN' in compose
    assert "profiles: [migration]" in compose
    assert "depends_on:" not in compose.split("  api:", 1)[1].split("  web:", 1)[0]


def test_production_https_proxy_uses_secret_certificate_and_secure_headers() -> None:
    nginx = (REPO_ROOT / "deploy" / "nginx" / "production-https.conf").read_text(encoding="utf-8")

    assert "listen 8443 ssl" in nginx
    assert "/run/secrets/tls_certificate.pem" in nginx
    assert "/run/secrets/tls_private_key.pem" in nginx
    assert "Strict-Transport-Security" in nginx
    assert "proxy_pass http://api:8000" in nginx


def test_offline_release_tools_verify_checksums_and_never_start_services() -> None:
    export_script = (REPO_ROOT / "scripts" / "deploy" / "Export-MesRelease.ps1").read_text(encoding="utf-8")
    import_script = (REPO_ROOT / "scripts" / "deploy" / "Import-MesRelease.ps1").read_text(encoding="utf-8")

    assert "docker save" in export_script
    assert "Get-FileHash -Algorithm SHA256" in export_script
    assert "docker load" in import_script
    assert "Checksum mismatch" in import_script
    assert "docker compose up" not in export_script + import_script
