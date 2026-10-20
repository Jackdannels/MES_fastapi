import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from xml.etree import ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("native_manager", ROOT / "deploy/native/native_manager.py")
manager = importlib.util.module_from_spec(spec)
spec.loader.exec_module(manager)
entry_spec = importlib.util.spec_from_file_location("native_entry", ROOT / "deploy/native/service_entry.py")
entry = importlib.util.module_from_spec(entry_spec)
entry_spec.loader.exec_module(entry)


def test_native_configuration_uses_private_paths_shared_protocols_and_distinct_passwords(tmp_path):
    config = manager.make_config(tmp_path, "MESUnitTest", manager.DEFAULT_PORTS, "http://127.0.0.1:15173", True)
    values = config["environment"]
    assert values["UPPER_COMPUTER_SIMULATOR_AUTO_ENABLE"] == "false"
    assert values["MQTT_ENABLED"] == values["RABBITMQ_ENABLED"] == "true"
    assert values["MQTT_HOST"] == "127.0.0.1"
    assert "rabbitmq:" not in values["RABBITMQ_URL"]
    assert Path(values["LIMS_SEQUENCE_PATH"]).parent == tmp_path / "lims"
    assert Path(values["TEST_DATA_BACKUP_STATE_PATH"]).parent == tmp_path / "runtime"
    assert len({values["MYSQL_PASSWORD"], values["MYSQL_MIGRATION_PASSWORD"], values["DEMO_PASSWORD"],
                values["SESSION_SECRET_KEY"], values["LIMS_HTTP_TOKEN"], values["MQTT_PASSWORD"]}) == 6


@pytest.mark.parametrize("ports,url,instance", [
    ({**manager.DEFAULT_PORTS, "mysql": 15173}, "http://127.0.0.1:15173", "MESUnit"),
    (manager.DEFAULT_PORTS, "http://user:pass@localhost:15173", "MESUnit"),
    (manager.DEFAULT_PORTS, "http://127.0.0.1:5173", "MESUnit"),
    (manager.DEFAULT_PORTS, "http://127.0.0.1:15173", "OtherService"),
])
def test_native_preflight_rejects_ambiguous_or_unsafe_installation(tmp_path, ports, url, instance):
    with pytest.raises(ValueError):
        manager.make_config(tmp_path, instance, ports, url, True)


def test_simulator_entry_only_injects_its_own_credentials(tmp_path, monkeypatch):
    config = manager.make_config(tmp_path, "MESUnitTest", manager.DEFAULT_PORTS, "http://127.0.0.1:15173", True)
    path = tmp_path / "config.json"
    path.write_text(json.dumps(config))
    for key in config["environment"]:
        monkeypatch.delenv(key, raising=False)
    entry.configure(path, "lims")
    import os
    assert os.environ["LIMS_HTTP_TOKEN"] == config["environment"]["LIMS_HTTP_TOKEN"]
    assert "MYSQL_PASSWORD" not in os.environ
    assert "DEMO_PASSWORD" not in os.environ
    assert "MYSQL_MIGRATION_PASSWORD" not in os.environ


def test_native_restore_rejects_nonempty_database_before_import_or_copy(tmp_path, monkeypatch):
    import scripts.deploy.portable_data as data
    monkeypatch.setattr(data, "verify", lambda _path: {"consistency": "quiesced"})
    cursor = Mock()
    cursor.fetchall.return_value = [("existing_business_table",)]
    connection = Mock()
    connection.__enter__ = Mock(return_value=connection)
    connection.__exit__ = Mock(return_value=False)
    connection.cursor.return_value.__enter__ = Mock(return_value=cursor)
    connection.cursor.return_value.__exit__ = Mock(return_value=False)
    monkeypatch.setattr(manager, "connect", lambda *_a, **_k: connection)
    importer = Mock()
    monkeypatch.setattr(manager, "mysql_client", importer)
    with pytest.raises(ValueError, match="empty target"):
        manager.restore_backup({}, tmp_path)
    importer.assert_not_called()


def test_native_manifest_detects_corruption_and_path_escape(tmp_path):
    import hashlib
    source = tmp_path / "program.txt"
    source.write_bytes(b"native-runtime")
    manifest = {"format": "mes-native-payload", "format_version": 1,
                "files": [{"path": "program.txt", "bytes": source.stat().st_size,
                           "sha256": hashlib.sha256(source.read_bytes()).hexdigest()}]}
    path = tmp_path / "native-manifest.json"
    path.write_text(json.dumps(manifest))
    manager.verify_release(tmp_path)
    source.write_bytes(b"changed-runtime")
    with pytest.raises(ValueError, match="checksum"):
        manager.verify_release(tmp_path)
    manifest["files"][0]["path"] = "../outside.txt"
    path.write_text(json.dumps(manifest))
    with pytest.raises(ValueError, match="Unsafe"):
        manager.verify_release(tmp_path)


def test_winsw_v2_uses_explicit_localservice_and_graceful_start_stop_arguments(tmp_path, monkeypatch):
    root = tmp_path / "data"
    for name in ("config", "rabbitmq", "services", "logs"):
        (root / name).mkdir(parents=True)
    runtime = tmp_path / "runtime"
    runtime.mkdir()
    (runtime / "WinSW.exe").write_bytes(b"test-wrapper")
    monkeypatch.setattr(manager, "RUNTIME", runtime)
    config = manager.make_config(root, "MESUnitTest", manager.DEFAULT_PORTS, "http://127.0.0.1:15173", True)
    manager.configure_services(config, root / "config/native.json")
    for role in manager.SERVICE_ROLES:
        xml = ET.parse(manager.wrapper(config, role).with_suffix(".xml")).getroot()
        assert xml.findtext("serviceaccount/user") == "LocalService"
        assert xml.findtext("serviceaccount/domain") == "NT AUTHORITY"
        assert xml.find("serviceaccount/username") is None
        assert xml.findtext("startmode") == "Manual"
        if role in ("mysql", "rabbitmq"):
            assert xml.find("arguments") is None
            assert "shutdown-child" in xml.findtext("stoparguments")
            assert xml.findtext("startarguments")
    assert "-args_file" in config["rabbit_environment"]["RABBITMQ_SERVER_ADDITIONAL_ERL_ARGS"]
    assert config["rabbit_cookie"] not in config["rabbit_environment"]["RABBITMQ_SERVER_ADDITIONAL_ERL_ARGS"]


def test_service_restart_waits_for_stop_pending_before_start(monkeypatch):
    monkeypatch.setattr(manager, "assert_owned_service", lambda *_a: None)
    monkeypatch.setattr(manager, "service_state", lambda *_a: 3)
    sequence = []
    monkeypatch.setattr(manager, "wait_service_state", lambda _c, role, state: sequence.append((role, state)))
    monkeypatch.setattr(manager, "run", lambda *_a, **_k: sequence.append("start-command"))
    monkeypatch.setattr(manager, "wrapper", lambda *_a: Path("test-wrapper.exe"))
    manager.service({"instance": "MESUnitTest"}, "rabbitmq", "start")
    assert sequence == [("rabbitmq", 1), "start-command", ("rabbitmq", 4)]


def test_docker_export_blocks_canonical_chinese_active_states():
    export_spec = importlib.util.spec_from_file_location("native_docker_export", ROOT / "deploy/native/export_docker_data.py")
    exporter = importlib.util.module_from_spec(export_spec)
    export_spec.loader.exec_module(exporter)
    cursor = Mock()
    cursor.fetchone.return_value = (1,)
    with pytest.raises(ValueError, match="active/paused/prepared"):
        exporter.assert_no_active_runs(cursor)
    statuses = cursor.execute.call_args.args[1]
    assert {"实验进行中", "实验中", "实验暂停", "实验准备就绪"}.issubset(statuses)


@pytest.fixture
def docker_export_fixture(tmp_path, monkeypatch):
    """Use real SQLite snapshots/checksums while isolating Docker and MySQL."""
    import pymysql
    import sqlite3
    export_spec = importlib.util.spec_from_file_location("native_export_test", ROOT / "deploy/native/export_docker_data.py")
    exporter = importlib.util.module_from_spec(export_spec)
    export_spec.loader.exec_module(exporter)
    source = tmp_path / "old deployment"
    source.mkdir()
    for name in ("compose.portable.yml", "compose.portable.simulators.yml", "portable.env"):
        (source / name).touch()
    output = tmp_path / "verified-backup"
    calls = []
    config = {"name": "mes-test-source", "services": {
        "rabbitmq": {"environment": {"RABBITMQ_DEFAULT_USER": "test", "RABBITMQ_DEFAULT_PASS": "test"},
                     "ports": [{"published": "15673", "target": 15672}]},
        "mysql": {"environment": {"MYSQL_DATABASE": "test_db", "MYSQL_ROOT_PASSWORD": "test-secret"},
                  "ports": [{"published": "13306", "target": 3306}]},
    }}
    running = {"api", "web", "lims-simulator", "upper-simulator", "mysql", "rabbitmq"}

    def docker(arguments, **_kwargs):
        calls.append(arguments)
        if arguments[-3:] == ["config", "--format", "json"]:
            return json.dumps(config)
        if arguments[-4:] == ["ps", "--status", "running", "--services"]:
            return "\n".join(sorted(running))
        if "ps" in arguments:
            return "test-container"
        if arguments[0] == "cp":
            destination = Path(arguments[-1])
            if destination.name == "lims-source":
                for name in ("task-sequence.sqlite3", "interactions.sqlite3", "communication.sqlite3"):
                    with sqlite3.connect(destination / name) as connection:
                        connection.execute("CREATE TABLE preserved_data(value TEXT)")
                        connection.execute("INSERT INTO preserved_data VALUES ('迁移数据')")
                    connection.close()
        return ""

    cursor = Mock()
    cursor.fetchone.return_value = (0,)
    cursor.fetchall.side_effect = lambda: [("biz_task",)] if "information_schema" in cursor.execute.call_args.args[0] else [(1, "checksum", 1)]
    connection = Mock()
    connection.__enter__ = Mock(return_value=connection)
    connection.__exit__ = Mock(return_value=False)
    connection.cursor.return_value.__enter__ = Mock(return_value=cursor)
    connection.cursor.return_value.__exit__ = Mock(return_value=False)

    def dump(arguments, **_kwargs):
        result = next(item for item in arguments if item.startswith("--result-file="))
        Path(result.split("=", 1)[1]).write_text("-- verified fixture SQL", encoding="utf-8")
        return SimpleNamespace(returncode=0, stderr="")

    monkeypatch.setattr(exporter, "docker", docker)
    monkeypatch.setattr(exporter, "assert_empty_queues", lambda _req: None)
    monkeypatch.setattr(pymysql, "connect", lambda **_kwargs: connection)
    monkeypatch.setattr(exporter.subprocess, "run", dump)
    return SimpleNamespace(exporter=exporter, source=source, output=output, calls=calls, docker=docker, running=running)


def test_integrated_docker_cutover_verifies_backup_before_stopping_infrastructure(docker_export_fixture, monkeypatch):
    from scripts.deploy.portable_data import verify
    fixture = docker_export_fixture

    def docker(arguments, **kwargs):
        if arguments[-1] == "stop":
            # This must succeed before infrastructure is allowed to stop.
            assert verify(fixture.output)["source_table_counts"] == {"biz_task": 0}
        return fixture.docker(arguments, **kwargs)

    monkeypatch.setattr(fixture.exporter, "docker", docker)
    fixture.exporter.export(fixture.source, fixture.source / "portable.env", fixture.output,
                            leave_stopped=True, stop_deployment=True)
    assert fixture.calls[-1][-1] == "stop"
    assert not any("up" in call or "down" in call or "rm" in call for call in fixture.calls)


def test_integrated_docker_failed_export_restores_source_even_with_leave_stopped(docker_export_fixture, monkeypatch):
    fixture = docker_export_fixture
    monkeypatch.setattr(fixture.exporter.subprocess, "run", lambda *_a, **_k: SimpleNamespace(returncode=1, stderr="dump failed"))
    with pytest.raises(RuntimeError, match="MySQL data export failed"):
        fixture.exporter.export(fixture.source, fixture.source / "portable.env", fixture.output,
                                leave_stopped=True, stop_deployment=True)
    assert "up" in fixture.calls[-1]
    assert set(fixture.calls[-1][-6:]) == fixture.running
    assert not (fixture.output / "data-manifest.json").exists()
    assert not any(call[-1] == "stop" for call in fixture.calls)


def test_partial_docker_stop_failure_also_restores_source(docker_export_fixture, monkeypatch):
    fixture = docker_export_fixture

    def docker(arguments, **kwargs):
        if "stop" in arguments:
            fixture.calls.append(arguments)
            raise RuntimeError("partial stop failed")
        return fixture.docker(arguments, **kwargs)

    monkeypatch.setattr(fixture.exporter, "docker", docker)
    with pytest.raises(RuntimeError, match="partial stop failed"):
        fixture.exporter.export(fixture.source, fixture.source / "portable.env", fixture.output, True, True)
    assert "up" in fixture.calls[-1]
    assert not fixture.output.exists()


def test_docker_export_rechecks_queues_after_stopping_and_resumes_if_not_empty(docker_export_fixture, monkeypatch):
    fixture = docker_export_fixture
    monkeypatch.setattr(fixture.exporter, "assert_empty_queues", Mock(side_effect=[None, ValueError("queues not empty")]))
    with pytest.raises(ValueError, match="queues not empty"):
        fixture.exporter.export(fixture.source, fixture.source / "portable.env", fixture.output, True, True)
    assert "up" in fixture.calls[-1]
    assert not fixture.output.exists()


def test_docker_export_preview_restores_source_after_verified_backup(docker_export_fixture):
    fixture = docker_export_fixture
    fixture.exporter.export(fixture.source, fixture.source / "portable.env", fixture.output)
    assert (fixture.output / "data-manifest.json").is_file()
    assert "up" in fixture.calls[-1]
    assert not any(call[-1] == "stop" for call in fixture.calls)


def test_failed_final_docker_stop_retains_verified_backup_and_keeps_business_stopped(docker_export_fixture, monkeypatch):
    from scripts.deploy.portable_data import verify
    fixture = docker_export_fixture

    def docker(arguments, **kwargs):
        if arguments[-1] == "stop":
            fixture.calls.append(arguments)
            raise RuntimeError("infrastructure stop failed")
        return fixture.docker(arguments, **kwargs)

    monkeypatch.setattr(fixture.exporter, "docker", docker)
    with pytest.raises(RuntimeError, match="infrastructure stop failed"):
        fixture.exporter.export(fixture.source, fixture.source / "portable.env", fixture.output, True, True)
    verify(fixture.output)
    assert not any("up" in call for call in fixture.calls)


def test_native_preflight_rejects_nonempty_target_before_touching_services(tmp_path, monkeypatch):
    program = tmp_path / "program"
    root = tmp_path / "data"
    root.mkdir()
    (root / "existing-business-data").touch()
    monkeypatch.setattr(manager, "PROGRAM", program)
    monkeypatch.setattr(manager, "ensure_windows_admin", lambda: None)
    monkeypatch.setattr(manager, "validate_root", lambda value: Path(value))
    verify = Mock()
    monkeypatch.setattr(manager, "verify_release", verify)
    with pytest.raises(ValueError, match="Data directory is not empty"):
        manager.prepare_installation(SimpleNamespace(data_root=root), check_ports=False)
    verify.assert_not_called()


def test_native_preflight_rejects_backup_inside_target_before_docker_export(tmp_path, monkeypatch):
    root = tmp_path / "data"
    monkeypatch.setattr(manager, "PROGRAM", tmp_path / "program")
    monkeypatch.setattr(manager, "ensure_windows_admin", lambda: None)
    monkeypatch.setattr(manager, "validate_root", lambda value: Path(value))
    with pytest.raises(ValueError, match="Migration backup must be separate"):
        manager.prepare_installation(SimpleNamespace(data_root=root, migration_output=root / "backup"), check_ports=False)
    assert not root.exists()
