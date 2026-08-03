from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]


def test_env_example_documents_mqtt_and_upper_computer_settings():
    env_example = (REPO_ROOT / ".env.example").read_text(encoding="utf-8")

    assert "MQTT_ENABLED=false" in env_example
    assert "MQTT_TOPIC_PREFIX=mes/v1" in env_example
    assert "UPPER_COMPUTER_SIMULATOR_AUTO_ENABLE=false" in env_example
    assert "UPPER_COMPUTER_SIMULATOR_URL=http://127.0.0.1:8899" in env_example
    assert "C:\\Users\\12051" not in env_example


def test_readme_avoids_machine_specific_desktop_paths():
    readme = (REPO_ROOT / "README.md").read_text(encoding="utf-8")

    assert "C:\\Users\\12051" not in readme
    assert "start-dev.bat" in readme
    assert "npm run serve:public" in readme
    assert "lab_code" in readme
    assert "run_no" in readme


def test_production_deployment_documents_report_volume_backup_and_restore():
    deployment = (REPO_ROOT / "docs" / "production-deployment.md").read_text(encoding="utf-8")

    assert "MES_REPORTS_VOLUME_NAME" in deployment
    assert "Backup-MesReports.ps1" in deployment
    assert "Restore-MesReportsRehearsal.ps1" in deployment
    assert "reports-manifest.json" in deployment
    assert "禁止使用全局 volume prune" in deployment


def test_production_deployment_documents_v3_offline_release_and_operation_manifest():
    deployment = (REPO_ROOT / "docs" / "production-deployment.md").read_text(encoding="utf-8")

    assert "MySqlClientImage" in deployment
    assert "RabbitMqImage" in deployment
    assert "ReportsToolImage" in deployment
    assert "-VerifyOnly" in deployment
    assert "只接受当前 v3 格式" in deployment
    assert "New-MesDeploymentOperation.ps1" in deployment
    assert "operation-manifest.json" in deployment
    assert "离线签名" in deployment


def test_stage4_docs_require_isolated_ports_resource_limits_and_independent_long_run():
    stage4 = (REPO_ROOT / "docs" / "stage4-long-running-acceptance.md").read_text(encoding="utf-8")

    assert "独立Docker主机或虚拟机" in stage4
    assert "Invoke-Stage4Acceptance.ps1" in stage4
    assert "compose.stage4.yml" in stage4
    assert "--no-build --pull never" in stage4
    assert "http://127.0.0.1:28000" in stage4
    assert "--base-url http://127.0.0.1:8000" not in stage4
    assert "72万条" in stage4
    assert "LoadP0CapacityFixture" in stage4
    assert "stage4-evidence-manifest.json" in stage4


def test_new_host_codex_handoff_is_fail_closed_and_v3_only():
    handoff = (REPO_ROOT / "docs" / "stage4-new-host-codex-handoff.md").read_text(encoding="utf-8")

    assert "不是生产环境切换" in handoff
    assert "旧 v1/v2 包不得使用" in handoff
    assert "-VerifyOnly" in handoff
    assert "-LoadP0CapacityFixture" in handoff
    assert "-RequireRetentionRun" in handoff
    assert "-KeepResourcesOnFailure" in handoff
    assert "DurationSeconds 28800" in handoff
    assert "MinRequestsPerEndpoint 100" in handoff
    assert "不得使用 `-SkipProtectedServiceCheck`" in handoff
    assert "docker system prune" in handoff
    assert "禁止回传未脱敏环境文件" in handoff
