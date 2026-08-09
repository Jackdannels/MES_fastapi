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
    assert "scripts/sql/V006__long_running_query_indexes.sql" in api
    assert "scripts/sql/V007__bounded_event_retention_indexes.sql" in api
    assert "scripts/sql/V008__fixture_install_schedule_identity.sql" in api
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
    assert "MQTT_CONNECT_TIMEOUT_SECONDS" in compose
    assert "MQTT_PUBLISH_TIMEOUT_SECONDS" in compose
    assert "MQTT_PUBLISH_SLOW_MS" in compose
    assert "CAPACITY_WARN_POOL_UTILIZATION" in compose
    assert "CAPACITY_WARN_STAGING_EVENT_ITEMS" in compose
    assert "CAPACITY_WARN_STAGING_EVENT_BYTES" in compose
    assert "CAPACITY_WARN_MQ_MESSAGE_ROWS" in compose
    assert "CAPACITY_WARN_EXPERIMENT_EVENT_ROWS" in compose
    assert "RETENTION_ENABLED" in compose
    assert "RETENTION_BATCH_SIZE" in compose
    assert "MQ_MESSAGE_LOG_RETENTION_DAYS" in compose
    assert "EXPERIMENT_EVENT_RETENTION_DAYS" in compose
    assert "STAGING_EVENT_RETENTION_DAYS" in compose
    assert 'UPPER_COMPUTER_SIMULATOR_AUTO_ENABLE: "false"' in compose
    assert 'UPPER_COMPUTER_SIMULATOR_AUTO_START: "false"' in compose


def test_compose_services_use_bounded_json_file_logging() -> None:
    packaging = (REPO_ROOT / "compose.packaging.yml").read_text(encoding="utf-8")
    production = (REPO_ROOT / "compose.production.yml").read_text(encoding="utf-8")

    for compose, service_count in ((packaging, 5), (production, 3)):
        assert "x-json-logging: &json-logging" in compose
        assert "driver: json-file" in compose
        assert 'max-size: "${DOCKER_LOG_MAX_SIZE:-10m}"' in compose
        assert 'max-file: "${DOCKER_LOG_MAX_FILE:-5}"' in compose
        assert compose.count("logging: *json-logging") == service_count


def test_deployment_environment_examples_expose_capacity_and_log_limits() -> None:
    for relative_path in ("deploy/.env.compose.example", "deploy/.env.production.example"):
        example = (REPO_ROOT / relative_path).read_text(encoding="utf-8")
        for setting in (
            "CAPACITY_WARN_POOL_UTILIZATION=0.8",
            "CAPACITY_WARN_STAGING_EVENT_ITEMS=20000",
            "CAPACITY_WARN_STAGING_EVENT_BYTES=16777216",
            "CAPACITY_WARN_MQ_MESSAGE_ROWS=500000",
            "CAPACITY_WARN_EXPERIMENT_EVENT_ROWS=500000",
            "DOCKER_LOG_MAX_SIZE=10m",
            "DOCKER_LOG_MAX_FILE=5",
        ):
            assert setting in example
    production_example = (REPO_ROOT / "deploy/.env.production.example").read_text(encoding="utf-8")
    assert "MES_REPORTS_VOLUME_NAME=mes-production-reports" in production_example


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
    assert 'MQTT_HTTP_EVENT_INGRESS_ENABLED: "false"' in compose
    assert "MQTT_CONNECT_TIMEOUT_SECONDS" in compose
    assert "MQTT_PUBLISH_TIMEOUT_SECONDS" in compose
    assert "MQTT_PUBLISH_SLOW_MS" in compose
    assert "CAPACITY_WARN_POOL_UTILIZATION" in compose
    assert "CAPACITY_WARN_STAGING_EVENT_ITEMS" in compose
    assert "CAPACITY_WARN_STAGING_EVENT_BYTES" in compose
    assert "CAPACITY_WARN_MQ_MESSAGE_ROWS" in compose
    assert "CAPACITY_WARN_EXPERIMENT_EVENT_ROWS" in compose
    assert "RETENTION_ENABLED" in compose
    assert "RETENTION_BATCH_SIZE" in compose
    assert "MQ_MESSAGE_LOG_RETENTION_DAYS" in compose
    assert "EXPERIMENT_EVENT_RETENTION_DAYS" in compose
    assert "STAGING_EVENT_RETENTION_DAYS" in compose
    assert 'SESSION_COOKIE_SECURE: "true"' in compose
    assert 'FRONTEND_ORIGINS: https://${MES_DOMAIN' in compose
    assert "profiles: [migration]" in compose
    assert "name: ${MES_REPORTS_VOLUME_NAME:?MES_REPORTS_VOLUME_NAME is required}" in compose
    assert "depends_on:" not in compose.split("  api:", 1)[1].split("  web:", 1)[0]


def test_production_https_proxy_uses_secret_certificate_and_secure_headers() -> None:
    nginx = (REPO_ROOT / "deploy" / "nginx" / "production-https.conf").read_text(encoding="utf-8")

    assert "listen 8443 ssl" in nginx
    assert "/run/secrets/tls_certificate.pem" in nginx
    assert "/run/secrets/tls_private_key.pem" in nginx
    assert "Strict-Transport-Security" in nginx
    assert "proxy_pass http://api:8000" in nginx


def test_web_access_log_keeps_upstream_timing_and_request_correlation() -> None:
    nginx = (REPO_ROOT / "deploy" / "nginx" / "nginx.conf").read_text(encoding="utf-8")
    stage4_env = (REPO_ROOT / "deploy" / ".env.stage4.example").read_text(encoding="utf-8")

    assert "request_time=$request_time" in nginx
    assert "upstream_response_time=$upstream_response_time" in nginx
    assert "request_id=$upstream_http_x_request_id" in nginx
    assert "DOCKER_LOG_MAX_SIZE=50m" in stage4_env
    assert "DOCKER_LOG_MAX_FILE=10" in stage4_env


def test_compose_exposes_bounded_stale_while_refresh_cache_settings() -> None:
    production = (REPO_ROOT / "compose.production.yml").read_text(encoding="utf-8")
    packaging = (REPO_ROOT / "compose.packaging.yml").read_text(encoding="utf-8")
    local_env = (REPO_ROOT / ".env.example").read_text(encoding="utf-8")
    compose_env = (REPO_ROOT / "deploy" / ".env.compose.example").read_text(encoding="utf-8")
    production_env = (REPO_ROOT / "deploy" / ".env.production.example").read_text(encoding="utf-8")
    stage4_env = (REPO_ROOT / "deploy" / ".env.stage4.example").read_text(encoding="utf-8")

    for compose in (production, packaging):
        assert "READ_SNAPSHOT_CACHE_TTL_SECONDS:-5.0" in compose
        assert "READ_SNAPSHOT_CACHE_STALE_SECONDS:-30.0" in compose

    for env_example in (local_env, compose_env, production_env, stage4_env):
        assert "READ_SNAPSHOT_CACHE_TTL_SECONDS=5.0" in env_example
        assert "READ_SNAPSHOT_CACHE_STALE_SECONDS=30.0" in env_example


def test_offline_release_tools_verify_checksums_and_never_start_services() -> None:
    export_script = (REPO_ROOT / "scripts" / "deploy" / "Export-MesRelease.ps1").read_text(encoding="utf-8")
    import_script = (REPO_ROOT / "scripts" / "deploy" / "Import-MesRelease.ps1").read_text(encoding="utf-8")
    operation_script = (REPO_ROOT / "scripts" / "deploy" / "New-MesDeploymentOperation.ps1").read_text(encoding="utf-8")

    assert "docker save" in export_script
    assert "MySqlClientImage" in export_script
    assert "RabbitMqImage" in export_script
    assert "ReportsToolImage" in export_script
    assert 'format = "mes-offline-release"' in export_script
    assert "format_version = 3" in export_script
    assert "$relativePaths.Sort([System.StringComparer]::Ordinal)" in export_script
    assert "image_id" in export_script + import_script
    assert "Assert-ArchiveImageContract" in export_script + import_script
    assert 'tar -xOf $ArchivePath index.json' in export_script + import_script
    assert "io.containerd.image.name" in export_script + import_script
    assert "org.opencontainers.image.ref.name" in export_script + import_script
    assert "Get-ArchiveReference" in export_script + import_script
    assert "& docker save --output $archive @archiveReferences" in export_script
    assert "docker save --output $archive @references" not in export_script
    assert "Loaded image tag reference is unavailable or conflicting" in import_script
    assert "Get-Sha256" in export_script
    assert "System.Security.Cryptography.SHA256" in export_script
    assert "System.Security.Cryptography.SHA256" in import_script
    assert "Get-FileHash" not in export_script + import_script
    assert "GetRelativePath" not in export_script
    assert "Release file escaped the output directory" in export_script
    assert "Release path escaped the release directory" in import_script
    assert "Release paths must not contain reparse points" in import_script
    assert "Release package contains missing or untracked extra files" in import_script
    assert "Only the current release manifest v3 format is supported" in import_script
    assert "AllowLegacyV1" not in import_script
    assert "VerifyOnly" in import_script
    assert "docker load" in import_script
    assert "Checksum mismatch" in import_script
    assert "docker compose up" not in export_script + import_script
    for required in (
        "Backup-MesDatabase.ps1",
        "Restore-MesRehearsal.ps1",
        "mysql-backup-restore.sh",
        "Backup-MesReports.ps1",
        "Restore-MesReportsRehearsal.ps1",
        "reports-backup-restore.py",
        "New-MesDeploymentOperation.ps1",
        "Invoke-Stage4Acceptance.ps1",
        "stage4_soak_probe.py",
        "generate_p0_capacity_fixture.py",
        "stage4-new-host-codex-handoff.md",
        "init-users.sh",
        "compose.stage4.yml",
    ):
        assert required in export_script

    assert 'format = "mes-deployment-operation"' in operation_script
    assert "live_best_effort" in operation_script
    assert "Database backup client image does not match" in operation_script
    assert "Reports backup tool image does not match" in operation_script


def test_backup_and_restore_rehearsal_scripts_are_fail_closed() -> None:
    backup = (REPO_ROOT / "scripts" / "deploy" / "Backup-MesDatabase.ps1").read_text(encoding="utf-8")
    restore = (REPO_ROOT / "scripts" / "deploy" / "Restore-MesRehearsal.ps1").read_text(encoding="utf-8")
    helper = (REPO_ROOT / "scripts" / "deploy" / "mysql-backup-restore.sh").read_text(encoding="utf-8")

    assert "--single-transaction" in helper
    for option in ("--quick", "--routines", "--triggers", "--events", "--hex-blob", "--set-gtid-purged=OFF", "--no-tablespaces"):
        assert option in helper
    assert "ClientImage must use an immutable @sha256 digest" in backup
    assert "mysql-backup-restore.sh,readonly" in backup + restore
    assert "sh /opt/mes/mysql-backup-restore.sh backup" in backup
    assert "sh /opt/mes/mysql-backup-restore.sh prepare" in restore
    assert "sh /opt/mes/mysql-backup-restore.sh restore" in restore
    assert "sh -ec" not in backup + restore
    assert "TargetDatabase must be an isolated name ending in _restore_test" in restore
    assert "Target database is not empty" in restore
    assert "Backup checksum mismatch" in restore
    assert "Backup dump file must be a single file name" in restore
    assert "type=bind,source=$dumpPath,target=/backup/database.sql,readonly" in restore
    assert "python scripts/init_mysql_storage.py" in restore
    assert "set -eu" in helper
    assert "MYSQL_PWD=\"$(cat /run/secrets/mysql_password)\"" in helper
    assert "*_restore_test" in helper
    assert "DROP DATABASE" not in backup + restore + helper


def test_report_volume_backup_and_restore_tools_are_isolated_and_fail_closed() -> None:
    backup = (REPO_ROOT / "scripts" / "deploy" / "Backup-MesReports.ps1").read_text(encoding="utf-8")
    restore = (REPO_ROOT / "scripts" / "deploy" / "Restore-MesReportsRehearsal.ps1").read_text(encoding="utf-8")
    helper = (REPO_ROOT / "scripts" / "deploy" / "reports-backup-restore.py").read_text(encoding="utf-8")

    assert "ToolImage must use an immutable @sha256 digest" in backup + restore
    assert "Source Docker volume does not exist; refusing to create it implicitly" in backup
    assert '"--network", "none"' in backup + restore
    assert "readonly,volume-nocopy" in backup
    assert "target=/restore,volume-nocopy" in restore
    assert "Target volume already exists; restore rehearsal requires a brand-new volume" in restore
    assert "-restore-test" in restore
    assert "io.mes.purpose=reports-restore-rehearsal" in restore
    assert "reports-backup-restore.py,readonly" in backup + restore
    assert "sh -c" not in backup + restore
    assert "Invoke-Expression" not in backup + restore

    assert 'FORMAT_NAME = "mes-reports-backup"' in helper
    assert "validate_relative_path" in helper
    assert "Duplicate archive member" in helper
    assert "Archive links and special members are not allowed" in helper
    assert "Hard-linked report file is not supported" in helper
    assert "Target report volume is not empty" in helper
    assert "Report archive contents do not match the manifest" in helper
    assert "Restored report volume does not match the manifest" in helper


def test_stage4_compose_override_uses_fixed_images_resource_limits_and_no_restart() -> None:
    override = (REPO_ROOT / "compose.stage4.yml").read_text(encoding="utf-8")
    env_example = (REPO_ROOT / "deploy" / ".env.stage4.example").read_text(encoding="utf-8")

    assert "MES_API_IMAGE:?" in override
    assert "MES_WEB_IMAGE:?" in override
    assert "MYSQL_IMAGE:?" in override
    assert "RABBITMQ_IMAGE:?" in override
    assert override.count("pull_policy: never") == 5
    assert override.count('restart: "no"') == 4
    assert override.count("cpus:") == 5
    assert override.count("mem_limit:") == 5
    assert override.count("pids_limit:") == 5

    assert "COMPOSE_PROJECT_NAME=mes-stage4-r3-20260804" in env_example
    assert "2026.08.04-r3@sha256:<replace-with-r3-api-digest>" in env_example
    assert "2026.08.04-r3@sha256:<replace-with-r3-web-digest>" in env_example
    assert "rc2" not in env_example.lower()
    assert "MYSQL_DATABASE=mes_stage4_test" in env_example
    for port in ("MES_WEB_PORT=25173", "MES_API_PORT=28000", "MES_MYSQL_PORT=23306", "MES_MQTT_PORT=21883"):
        assert port in env_example
    assert env_example.count("@sha256:") == 4


def test_stage4_runner_requires_new_labeled_project_and_exact_cleanup() -> None:
    runner = (REPO_ROOT / "scripts" / "deploy" / "Invoke-Stage4Acceptance.ps1").read_text(encoding="utf-8")

    assert "-stage4-soak" in runner
    assert "_stage4_test" in runner
    assert '"--no-build", "--pull", "never"' not in runner  # native arguments remain explicit tokens
    assert "up -d --no-build --pull never" in runner
    assert "com.docker.compose.project" in runner
    assert "Assert-ProjectLabels" in runner
    assert "Test-Stage4SteadyState" in runner
    assert "Test-Stage4BootstrapState" in runner
    assert "LoadP0CapacityFixture" in runner
    assert '"--expected-host", "mysql"' in runner
    assert '"--expected-port", "3306"' in runner
    assert "REPLACE_CAPACITY_DATABASE" in runner
    assert "stage4-evidence-manifest.json" in runner
    assert runner.index("up -d --no-build --pull never mysql rabbitmq migrate") < runner.index("up -d --no-build --pull never api web")
    assert "migrateState" in runner
    assert "down --volumes --remove-orphans" in runner
    assert "Protected local port" in runner
    assert "docker system prune" not in runner
    assert "docker volume prune" not in runner
