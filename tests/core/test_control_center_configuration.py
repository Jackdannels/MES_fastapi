import ast
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import subprocess

from dotenv import dotenv_values
import pytest

ROOT = Path(__file__).resolve().parents[2]
PS = shutil.which("powershell.exe")
DOCKER = shutil.which("docker")


@pytest.fixture(scope="module")
def configuration_editor(tmp_path_factory):
    if not PS:
        pytest.skip("Windows PowerShell required")
    temporary = tmp_path_factory.mktemp("control-center-configuration")
    executable = temporary / "MESControlCenter.exe"
    result = subprocess.run(
        [PS, "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(ROOT / "scripts/build_control_center.ps1"),
         "-OutputPath", str(executable), "-IconPath", str(temporary / "icon.ico"), "-NoAdminManifest"],
        capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=30,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    data = temporary / "test data with spaces"
    result = subprocess.run(
        [PS, "-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-File",
         str(ROOT / "tests/control_center/Test-ControlCenterConfiguration.ps1"),
         "-Executable", str(executable), "-TestDirectory", str(data)],
        capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=20,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    return executable, data


def test_configuration_editor_preserves_real_dotenv_values_and_native_structure(configuration_editor):
    _, data = configuration_editor
    expected = json.loads((data / "native.json").read_text(encoding="utf-8"))["environment"]["MYSQL_PASSWORD"]
    parsed = dotenv_values(data / "roundtrip.env")
    assert parsed["MYSQL_PASSWORD"] == expected
    assert parsed["MYSQL_HOST"] == "db.example"
    assert parsed["UNKNOWN_MULTILINE"] == "first\nMYSQL_PORT=not-an-assignment\nlast"
    assert not list(data.glob("*.tmp.*"))


def test_configuration_catalogue_covers_backend_settings_and_is_reproducible(tmp_path, monkeypatch):
    schema = ROOT / "tools/control-center/MESConfigurationSchema.json"
    fields = json.loads(schema.read_text(encoding="utf-8"))
    settings = next(node for node in ast.parse((ROOT / "app/core/config.py").read_text(encoding="utf-8")).body
                    if isinstance(node, ast.ClassDef) and node.name == "Settings")
    keys = {node.target.id for node in settings.body if isinstance(node, ast.AnnAssign) and node.target.id.isupper()}
    assert {field["Key"] for field in fields if not field["DockerOnly"]} == keys
    assert len(fields) == len({field["Key"] for field in fields})
    important = [field for field in fields if field["Important"]]
    assert len(important) < 40
    for field in important:
        assert re.search(r"[\u4e00-\u9fff]", field["Label"]), field["Key"]
        assert len(field["Description"]) >= 15 and re.search(r"[\u4e00-\u9fff]", field["Description"]), field["Key"]
    assert {field["Key"] for field in fields if field["DockerOnly"]} == {
        "MYSQL_API_USER", "MYSQL_API_PASSWORD", "RABBITMQ_USER", "RABBITMQ_PASSWORD",
        "MES_LOGIN_USER", "MES_LOGIN_PASSWORD", "MES_FRONTEND_ORIGINS",
    }
    for field in fields:
        if re.search("PASSWORD|TOKEN|SECRET|DSN|RABBITMQ_URL", field["Key"]):
            assert field["Secret"], field["Key"]
    spec = importlib.util.spec_from_file_location("configuration_schema", ROOT / "scripts/generate_control_center_schema.py")
    generator = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(generator)
    for relative in ("app/core/config.py", "compose.portable.yml", "compose.portable.simulators.yml"):
        target = tmp_path / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ROOT / relative, target)
    (tmp_path / "tools/control-center").mkdir(parents=True)
    monkeypatch.setattr(generator, "ROOT", tmp_path)
    generator.generate()
    assert (tmp_path / "tools/control-center/MESConfigurationSchema.json").read_bytes() == schema.read_bytes()


@pytest.mark.skipif(not DOCKER, reason="Docker Compose required for configuration rendering")
@pytest.mark.parametrize("custom", [False, True])
def test_docker_configured_interfaces_reach_api_and_simulators(configuration_editor, custom):
    _, data = configuration_editor
    required = {key: "test-only-value" for key in (
        "MYSQL_ROOT_PASSWORD", "MYSQL_API_PASSWORD", "MYSQL_MIGRATION_PASSWORD", "RABBITMQ_PASSWORD",
        "SESSION_SECRET_KEY", "MES_LOGIN_PASSWORD", "LIMS_HTTP_TOKEN")}
    required.update(MES_RELEASE_VERSION="configuration-test")
    environment = data / ("custom.env" if custom else "defaults.env")
    environment.write_text("\n".join(f"{key}={value}" for key, value in required.items()) + "\n"
                           + ((data / "docker.env").read_text(encoding="utf-8") if custom else "")
                           + ("MYSQL_HOST=db.example\nMYSQL_PORT=3307\nMYSQL_USER=remote_api\n"
                              "MQTT_HOST=mqtt.example\nMQTT_PORT=2883\nMQTT_TOPIC_PREFIX=custom/v2\n"
                              "RABBITMQ_COMMAND_EXCHANGE=custom.commands\nRABBITMQ_INTAKE_ROUTING_KEY=custom.intake\n"
                              if custom else ""), encoding="utf-8")
    # Rendering must be independent of the developer's real process credentials.
    env = {key: value for key, value in os.environ.items()
           if not re.match(r"MYSQL_|MQTT_|RABBITMQ_|LIMS_|MES_|SESSION_|COMPOSE_", key)}
    result = subprocess.run([DOCKER, "compose", "--env-file", str(environment),
                             "-f", str(ROOT / "compose.portable.yml"),
                             "-f", str(ROOT / "compose.portable.simulators.yml"),
                             "--profile", "simulators", "config", "--format", "json"],
                            capture_output=True, text=True, encoding="utf-8", errors="replace", env=env, timeout=20)
    assert result.returncode == 0, result.stderr
    # Compose v5.3.1 escapes dollars when rendering the canonical file, after
    # resolving its model (cmd/compose/config.go: runConfig/escapeDollarSign).
    services = json.loads(result.stdout.replace("$$", "$"))["services"]
    api = services["api"]["environment"]
    lims = services["lims-simulator"]["environment"]
    upper = services["upper-simulator"]["environment"]
    if custom:
        expected = json.loads((data / "native.json").read_text(encoding="utf-8"))["environment"]["MYSQL_PASSWORD"]
        assert api["MYSQL_PASSWORD"] == expected
        assert api["MYSQL_HOST"] == "db.example" and api["MYSQL_PORT"] == "3307"
        assert api["MYSQL_USER"] == "remote_api"
        assert api["LIMS_HTTP_CALLBACK_URL"] == "https://lims.example/events?q=1"
        assert api["RABBITMQ_URL"] == lims["RABBITMQ_URL"] == "amqp://user:p%40ss@broker.example:5673/vhost"
        assert api["RABBITMQ_COMMAND_EXCHANGE"] == lims["RABBITMQ_COMMAND_EXCHANGE"] == "custom.commands"
        assert api["RABBITMQ_INTAKE_ROUTING_KEY"] == lims["RABBITMQ_INTAKE_ROUTING_KEY"] == "custom.intake"
        assert api["MQTT_HOST"] == upper["MQTT_HOST"] == "mqtt.example"
        assert api["MQTT_PORT"] == upper["MQTT_PORT"] == "2883"
        assert api["MQTT_TOPIC_PREFIX"] == upper["MQTT_TOPIC_PREFIX"] == "custom/v2"
        assert api["MQTT_PASSWORD"] == upper["MQTT_PASSWORD"] == "${LITERAL}"
    else:
        assert api["MYSQL_HOST"] == "mysql" and api["MYSQL_PORT"] == "3306"
        assert api["RABBITMQ_URL"] == lims["RABBITMQ_URL"] == "amqp://mes_app:test-only-value@rabbitmq:5672/"
        assert api["MQTT_HOST"] == upper["MQTT_HOST"] == "rabbitmq"
        assert api["LIMS_HTTP_CALLBACK_URL"] == "http://lims-simulator:8900/api/mes/events"
    assert api["MQTT_ENABLED"] == api["RABBITMQ_ENABLED"] == "true"
    assert api["UPPER_COMPUTER_SIMULATOR_AUTO_ENABLE"] == "false"


def test_local_simulator_uses_saved_connections_without_copying_other_file_secrets():
    from scripts.run_lims_simulator import connection_environment

    base = {"PATH": "retained", "RABBITMQ_URL": "amqp://old", "LIMS_HTTP_TOKEN": "old"}
    values = {"RABBITMQ_URL": "amqp://new", "LIMS_HTTP_TOKEN": "new",
              "RABBITMQ_COMMAND_EXCHANGE": "custom.commands", "RABBITMQ_INTAKE_ROUTING_KEY": "custom.intake",
              "LIMS_MES_BASE_URL": "https://mes.example", "MYSQL_PASSWORD": "private", "DEMO_PASSWORD": "private"}
    result = connection_environment(base, values)
    assert result == {**base, **{key: value for key, value in values.items()
                               if key not in {"MYSQL_PASSWORD", "DEMO_PASSWORD"}}}
