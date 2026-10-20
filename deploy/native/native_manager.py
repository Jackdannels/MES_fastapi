"""MES native installation, service lifecycle and data migration. No Docker runtime dependency."""
from __future__ import annotations

import argparse
from contextlib import closing
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import socket
import sqlite3
import subprocess
import sys
import time
import urllib.error
import urllib.request
from xml.etree import ElementTree as ET

PROGRAM = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROGRAM))
PYTHON = PROGRAM / "runtime/python/python.exe"
RUNTIME = PROGRAM / "runtime"
SERVICE_ROLES = ("mysql", "rabbitmq", "lims", "upper", "api", "web")
NAMES = {"mysql": "MySQL", "rabbitmq": "RabbitMQ", "api": "API", "web": "Web", "lims": "LIMS-Simulator", "upper": "Upper-Simulator"}
DEFAULT_PORTS = dict(mysql=13306, amqp=5672, mqtt=11883, management=15673, api=18000,
                     web=15173, lims=18900, upper=18899, epmd=14369, distribution=25673)


def write_json(path, value):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    temporary = Path(str(path) + ".tmp")
    temporary.write_text(json.dumps(value, indent=2, ensure_ascii=False), encoding="utf-8")
    temporary.replace(path)


def load(path):
    return json.loads(Path(path).read_text(encoding="utf-8-sig"))


def run(command, *, env=None, input=None, timeout=180):
    result = subprocess.run([str(part) for part in command], env=env, input=input,
                            capture_output=True, encoding="utf-8", errors="replace", timeout=timeout,
                            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    if result.returncode:
        # Caller commands never contain passwords; tool output may, so retain
        # only a bounded diagnostic with configured secrets removed.
        detail = (result.stderr or result.stdout)[-2500:]
        if env:
            for key, value in env.items():
                if any(word in key for word in ("PASSWORD", "PWD", "TOKEN", "SECRET", "COOKIE")) and value:
                    detail = detail.replace(value, "[redacted]")
        raise RuntimeError(f"{Path(command[0]).name} failed (exit {result.returncode}): {detail}")
    return result.stdout.strip()


def ensure_windows_admin():
    import ctypes
    if os.name != "nt" or not ctypes.windll.shell32.IsUserAnAdmin():
        raise RuntimeError("Run the native installer/service action as Windows Administrator")


def validate_root(root):
    root = Path(root).resolve()
    if not root.is_absolute() or root.parent == root or any(not part.isascii() for part in root.parts):
        raise ValueError("Native runtime paths must be absolute, non-root ASCII paths")
    if " " in str(root):
        raise ValueError("Choose a native installation/data path without spaces for Erlang/RabbitMQ")
    if not re.fullmatch(r"[A-Za-z]:[\\/][A-Za-z0-9_./\\-]+", str(root)):
        raise ValueError("Use only letters, digits, underscores, dots and hyphens in native runtime paths")
    return root


def verify_release(root):
    root = Path(root).resolve()
    manifest = load(root / "native-manifest.json")
    if manifest.get("format") != "mes-native-payload" or manifest.get("format_version") != 1:
        raise ValueError("Unsupported native release manifest")
    seen = set()
    for entry in manifest["files"]:
        name = entry["path"]
        path = root / name
        if (not name or "\\" in name or ":" in name or Path(name).is_absolute()
                or ".." in Path(name).parts or name.casefold() in seen):
            raise ValueError("Unsafe or duplicate release path")
        seen.add(name.casefold())
        if not path.resolve().is_relative_to(root) or path.is_symlink() or not path.is_file():
            raise ValueError(f"Missing or linked release file: {name}")
        for parent in path.parents:
            if parent == root:
                break
            if parent.is_symlink() or (hasattr(parent, "is_junction") and parent.is_junction()):
                raise ValueError("Release path crosses a reparse point")
        with path.open("rb") as stream:
            value = hashlib.file_digest(stream, "sha256").hexdigest()
        if path.stat().st_size != entry["bytes"] or value != entry["sha256"]:
            raise ValueError(f"Release checksum mismatch: {name}")
    return manifest


def environment(config, migration=False):
    result = {**os.environ, **{k: str(v) for k, v in config["environment"].items()}}
    result["PYTHONUTF8"] = "1"
    if not migration:
        result.pop("MYSQL_MIGRATION_USER", None)
        result.pop("MYSQL_MIGRATION_PASSWORD", None)
    return result


def service_name(config, role):
    return config["instance"] + "-" + NAMES[role]


def wrapper(config, role):
    return Path(config["data_root"]) / "services" / (service_name(config, role) + ".exe")


def service_exists(name):
    return subprocess.run(["sc.exe", "query", name], capture_output=True,
                          creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0)).returncode == 0


def assert_owned_service(config, role):
    name = service_name(config, role)
    if not service_exists(name):
        raise ValueError(f"Service is not installed: {name}")
    import winreg
    with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, "SYSTEM\\CurrentControlSet\\Services\\" + name) as key:
        binary = winreg.QueryValueEx(key, "ImagePath")[0]
    expected = str(wrapper(config, role))
    if binary.strip().strip('"').casefold() != expected.casefold():
        raise ValueError(f"Refused to control a service owned by another installation: {name}")


def service(config, role, action):
    assert_owned_service(config, role)
    if action == "start" and service_state(service_name(config, role)) == 3:
        wait_service_state(config, role, 1)
    result = run([wrapper(config, role), action], timeout=180)
    if action in ("start", "stop"):
        wait_service_state(config, role, 4 if action == "start" else 1)
    return result


def service_state(name):
    import ctypes
    from ctypes import wintypes
    class Status(ctypes.Structure):
        _fields_ = [(key, wintypes.DWORD) for key in ("kind", "state", "controls", "exit", "specific", "checkpoint", "hint")]
    api = ctypes.WinDLL("advapi32", use_last_error=True)
    api.OpenSCManagerW.argtypes = [wintypes.LPCWSTR, wintypes.LPCWSTR, wintypes.DWORD]
    api.OpenSCManagerW.restype = wintypes.HANDLE
    api.OpenServiceW.argtypes = [wintypes.HANDLE, wintypes.LPCWSTR, wintypes.DWORD]
    api.OpenServiceW.restype = wintypes.HANDLE
    api.QueryServiceStatus.argtypes = [wintypes.HANDLE, ctypes.POINTER(Status)]
    api.CloseServiceHandle.argtypes = [wintypes.HANDLE]
    scm, handle = api.OpenSCManagerW(None, None, 1), None
    try:
        handle = api.OpenServiceW(scm, name, 4)
        status = Status()
        if not handle or not api.QueryServiceStatus(handle, ctypes.byref(status)):
            raise OSError(ctypes.get_last_error(), "Cannot query the native service state")
        return status.state
    finally:
        if handle:
            api.CloseServiceHandle(handle)
        if scm:
            api.CloseServiceHandle(scm)


def wait_service_state(config, role, wanted):
    deadline = time.monotonic() + 120
    while service_state(service_name(config, role)) != wanted:
        if time.monotonic() > deadline:
            raise RuntimeError(f"Windows service did not reach state {wanted}: {role}")
        time.sleep(.5)


def connect(config, migration=False):
    import pymysql
    values = config["environment"]
    return pymysql.connect(host="127.0.0.1", port=config["ports"]["mysql"],
                           user=values["MYSQL_MIGRATION_USER" if migration else "MYSQL_USER"],
                           password=values["MYSQL_MIGRATION_PASSWORD" if migration else "MYSQL_PASSWORD"],
                           database=values["MYSQL_DATABASE"], charset="utf8mb4", connect_timeout=5, read_timeout=60)


def wait_database(config):
    deadline = time.monotonic() + 120
    while True:
        try:
            with socket.create_connection(("127.0.0.1", config["ports"]["mysql"]), timeout=2):
                return
        except OSError:
            if time.monotonic() > deadline:
                raise RuntimeError("MySQL did not become ready; inspect the native service logs")
            time.sleep(1)


def http_json(url, *, data=None, headers=None):
    req = urllib.request.Request(url, data=json.dumps(data).encode() if data is not None else None,
                                 headers={"Content-Type": "application/json", **(headers or {})})
    with urllib.request.urlopen(req, timeout=8) as response:
        raw = response.read()
        return json.loads(raw) if raw and "json" in response.headers.get("Content-Type", "") else {"http": response.status}


def wait_url(url, predicate=lambda result: True, seconds=120):
    deadline = time.monotonic() + seconds
    while True:
        try:
            result = http_json(url)
            if predicate(result):
                return result
        except (OSError, ValueError):
            pass
        if time.monotonic() > deadline:
            raise RuntimeError(f"Service did not become ready: {url}")
        time.sleep(1)


def make_config(root, instance, ports, public_url, simulators):
    if not re.fullmatch(r"MES[A-Za-z0-9-]{0,35}", instance):
        raise ValueError("Instance name must begin with MES and contain only letters, digits or hyphens")
    if len(set(ports.values())) != len(ports) or any(not 1024 <= int(p) <= 65535 for p in ports.values()):
        raise ValueError("Ports must be distinct integers between 1024 and 65535")
    from urllib.parse import urlsplit
    parsed = urlsplit(public_url)
    if parsed.scheme != "http" or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in ("", "/"):
        raise ValueError("This offline release accepts an explicit LAN/local HTTP root URL")
    if parsed.port != ports["web"]:
        raise ValueError("Public URL port must match the configured Web port")
    token = lambda: secrets.token_hex(32)
    values = dict(APP_ENV="prod", DEBUG="false", SERVE_WEB_APP="false", STORAGE_BACKEND="mysql",
                  MYSQL_HOST="127.0.0.1", MYSQL_PORT=str(ports["mysql"]), MYSQL_DATABASE="mes_native",
                  MYSQL_USER="mes_api", MYSQL_PASSWORD=token(), MYSQL_MIGRATION_USER="mes_migrator",
                  MYSQL_MIGRATION_PASSWORD=token(), MYSQL_AUTO_INIT_SCHEMA="false", MYSQL_AUTO_SEED_DEMO="false",
                  DEMO_USER="admin", DEMO_PASSWORD=token(), SESSION_SECRET_KEY=token(), SESSION_COOKIE_SECURE="false",
                  FRONTEND_ORIGINS=','.join(dict.fromkeys([public_url.rstrip('/'),f"http://127.0.0.1:{ports['web']}",f"http://localhost:{ports['web']}"])),
                  RABBITMQ_ENABLED="true", RABBITMQ_REQUIRED="true", MQTT_ENABLED="true", MQTT_HOST="127.0.0.1",
                  MQTT_PORT=str(ports["mqtt"]), MQTT_USERNAME="mes_app", MQTT_PASSWORD=token(), MQTT_TOPIC_PREFIX="mes/v1",
                  UPPER_COMPUTER_SIMULATOR_AUTO_ENABLE="false", UPPER_COMPUTER_SIMULATOR_AUTO_START="false",
                  TEST_DATA_SAVE_PATH=str(root / "reports"), TEST_DATA_BACKUP_STATE_PATH=str(root / "runtime/test-data-backup.sqlite3"),
                  TEST_DATA_PUBLIC_BASE_URL=public_url.rstrip('/'), TEST_DATA_BACKUP_PATH="", LIMS_HTTP_TOKEN=token(),
                  LIMS_MES_BASE_URL=f"http://127.0.0.1:{ports['api']}", LIMS_DATA_PUBLIC_BASE_URL=public_url.rstrip('/'),
                  LIMS_SEQUENCE_PATH=str(root / "lims/task-sequence.sqlite3"), LIMS_INBOX_PATH=str(root / "lims/interactions.sqlite3"),
                  MES_REPORT_FONT=str(PROGRAM / "fonts/NotoSansSC.ttf"), SIMULATOR_AUTO_CONNECT="true")
    values["RABBITMQ_URL"] = f"amqp://mes_app:{values['MQTT_PASSWORD']}@127.0.0.1:{ports['amqp']}/"
    values["LIMS_HTTP_CALLBACK_URL"] = f"http://127.0.0.1:{ports['lims']}/api/mes/events" if simulators else ""
    values["LIMS_HEALTH_URL"] = f"http://127.0.0.1:{ports['lims']}/api/state" if simulators else ""
    values["LIMS_COMMUNICATION_URL"] = f"http://127.0.0.1:{ports['lims']}/api/mes/communication" if simulators else ""
    return dict(format="mes-native-installation", format_version=1, version="2026.10.20-native.1", instance=instance,
                program_root=str(PROGRAM), data_root=str(root), ports=ports, public_url=public_url.rstrip('/'),
                simulators=simulators, environment=values, mysql_root_password=token(), rabbit_cookie=secrets.token_hex(20), installed_services=[], phase="prepared")


def secure_data(root):
    # SIDs avoid localized Windows account-name assumptions. The installer is
    # elevated; service processes use LocalService, not the logged-in user.
    run(["icacls.exe", root, "/inheritance:r", "/grant:r", "*S-1-5-18:(OI)(CI)F",
         "*S-1-5-32-544:(OI)(CI)F", "*S-1-5-19:(OI)(CI)M"], timeout=60)


def configure_services(config, config_path):
    root, ports = Path(config["data_root"]), config["ports"]
    values = config["environment"]
    mysql_ini = root / "config/my.ini"
    mysql_ini.write_text("[mysqld]\n" + f"basedir={str(RUNTIME / 'mysql').replace(chr(92),'/')}\n"
                         f"datadir={str(root / 'mysql').replace(chr(92),'/')}\nport={ports['mysql']}\nbind-address=127.0.0.1\n"
                         "character-set-server=utf8mb4\ncollation-server=utf8mb4_unicode_ci\nmysqlx=OFF\n"
                         f"log-error={str(root / 'logs/mysql-error.log').replace(chr(92),'/')}\n", encoding="utf-8")
    rabbit_root = root / "rabbitmq"
    rabbit_config = root / "config/rabbitmq.conf"
    rabbit_config.write_text(f"listeners.tcp.1 = 127.0.0.1:{ports['amqp']}\nmanagement.tcp.ip = 127.0.0.1\nmanagement.tcp.port = {ports['management']}\n"
                             f"mqtt.listeners.tcp.1 = 127.0.0.1:{ports['mqtt']}\nmqtt.allow_anonymous = false\n"
                             f"default_user = mes_app\ndefault_pass = {values['MQTT_PASSWORD']}\n"
                             f"distribution.listener.port_range.min = {ports['distribution']}\ndistribution.listener.port_range.max = {ports['distribution']}\n", encoding="utf-8")
    (root / "config/enabled_plugins").write_text("[rabbitmq_management,rabbitmq_mqtt].\n", encoding="ascii")
    (rabbit_root / ".erlang.cookie").write_text(config["rabbit_cookie"], encoding="ascii")
    (root / "config/erlang.args").write_text("-setcookie " + config["rabbit_cookie"] + "\n", encoding="ascii")
    caddy = root / "config/Caddyfile"
    webroot = str(PROGRAM / "frontend/dist").replace('\\', '/')
    caddy.write_text("{\n auto_https off\n admin off\n}\n" + f":{ports['web']} {{\n"
                     f" @backend path /api /api/* /auth /auth/* /health /health/*\n handle @backend {{\n reverse_proxy 127.0.0.1:{ports['api']}\n }}\n"
                     f' handle {{\n root * "{webroot}"\n try_files {{path}} /index.html\n file_server\n }}\n'
                     "}\n", encoding="utf-8")
    rabbit_env = dict(ERLANG_HOME=str(RUNTIME / "erlang"), RABBITMQ_BASE=str(rabbit_root),
                      RABBITMQ_CONFIG_FILE=str(rabbit_config.with_suffix("")), RABBITMQ_ENABLED_PLUGINS_FILE=str(root / "config/enabled_plugins"),
                      RABBITMQ_MNESIA_BASE=str(rabbit_root / "mnesia"), RABBITMQ_LOG_BASE=str(root / "logs/rabbitmq"),
                      RABBITMQ_NODENAME=config["instance"].lower()+"@localhost", RABBITMQ_NODE_IP_ADDRESS="127.0.0.1",
                      RABBITMQ_DIST_PORT=str(ports["distribution"]), ERL_EPMD_PORT=str(ports["epmd"]),
                      HOMEDRIVE=root.drive, HOMEPATH=str(rabbit_root)[len(root.drive):], USERPROFILE=str(rabbit_root),
                      APPDATA=str(rabbit_root), RABBITMQ_SERVER_ADDITIONAL_ERL_ARGS="+S 2:2 -args_file " + str(root / "config/erlang.args"))
    config["rabbit_environment"] = rabbit_env
    commands = {
        "mysql": (RUNTIME / "mysql/bin/mysqld.exe", [f"--defaults-file={mysql_ini}", "--console"]),
        "rabbitmq": (Path(os.environ.get("COMSPEC", r"C:\Windows\System32\cmd.exe")),
                     ["/d", "/s", "/c", '""' + str(RUNTIME / "rabbitmq/sbin/rabbitmq-server.bat") + '""']),
        "web": (RUNTIME / "caddy/caddy.exe", ["run", "--config", str(caddy), "--adapter", "caddyfile"]),
    }
    for role in ("api", "lims", "upper"):
        commands[role] = (PYTHON, ["-I", "-X", "utf8", str(PROGRAM / "native/service_entry.py"), "--config", str(config_path), "--service", role])
    roles = SERVICE_ROLES if config["simulators"] else ("mysql", "rabbitmq", "api", "web")
    for role in roles:
        name = service_name(config, role)
        xml = ET.Element("service")
        for key, text in (("id", name), ("name", name), ("description", "MES native dedicated " + role),
                          ("executable", str(commands[role][0])), ("workingdirectory", str(PROGRAM)),
                          ("startmode", "Manual"), ("stoptimeout", "45sec"), ("logpath", str(root / "logs"))):
            ET.SubElement(xml, key).text = text
        ET.SubElement(xml, "arguments").text = commands[role][1][3] if role == "rabbitmq" else subprocess.list2cmdline(commands[role][1])
        if role == "rabbitmq":
            xml.find("arguments").text = '/d /s /c ""' + str(RUNTIME / "rabbitmq/sbin/rabbitmq-server.bat") + '""'
        if role in ("mysql", "rabbitmq"):
            xml.find("arguments").tag = "startarguments"
            ET.SubElement(xml, "stopexecutable").text = str(PYTHON)
            ET.SubElement(xml, "stoparguments").text = subprocess.list2cmdline(["-I", "-X", "utf8", str(PROGRAM / "native/native_manager.py"),
                "shutdown-child", "--config", str(config_path), "--role", role])
        for dependency in (() if role in ("mysql", "rabbitmq") else ("api",) if role == "web" else ("mysql", "rabbitmq")):
            ET.SubElement(xml, "depend").text = service_name(config, dependency)
        account = ET.SubElement(xml, "serviceaccount")
        ET.SubElement(account, "domain").text = "NT AUTHORITY"
        ET.SubElement(account, "user").text = "LocalService"
        ET.SubElement(account, "password").text = ""
        ET.SubElement(account, "allowservicelogon").text = "true"
        ET.SubElement(xml, "onfailure", {"action": "restart", "delay": "10 sec"})
        log = ET.SubElement(xml, "log", {"mode": "roll-by-size"})
        ET.SubElement(log, "sizeThreshold").text = "10240"
        ET.SubElement(log, "keepFiles").text = "5"
        for key, value in {"TEMP": str(root / "temp"), "TMP": str(root / "temp"), **(rabbit_env if role == "rabbitmq" else {})}.items():
            ET.SubElement(xml, "env", {"name": key, "value": value})
        executable = wrapper(config, role)
        shutil.copy2(RUNTIME / "WinSW.exe", executable)
        ET.ElementTree(xml).write(executable.with_suffix(".xml"), encoding="utf-8", xml_declaration=True)
    write_json(config_path, config)


def mysql_client(config, sql=None, *, infile=None, user="root", password=None, database=None):
    env = {**os.environ, "MYSQL_PWD": password if password is not None else config["mysql_root_password"]}
    cmd = [RUNTIME / "mysql/bin/mysql.exe", "--no-defaults", "--protocol=tcp", "--host=127.0.0.1",
           f"--port={config['ports']['mysql']}", f"--user={user}", "--default-character-set=utf8mb4"]
    if database:
        cmd.append(database)
    if infile:
        with Path(infile).open("rb") as stream:
            result = subprocess.run([str(p) for p in cmd], stdin=stream, env=env, capture_output=True,
                                    creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        if result.returncode:
            raise RuntimeError("Database import failed; original Docker/source database was not modified")
    else:
        return run(cmd, env=env, input=sql, timeout=180)


def shutdown_child(config_path, role):
    config = load(config_path)
    if Path(config["program_root"]).resolve() != PROGRAM or role not in config["installed_services"]:
        raise ValueError("Service shutdown installation identity mismatch")
    if role == "mysql":
        run([RUNTIME / "mysql/bin/mysqladmin.exe", "--no-defaults", "--protocol=tcp", "--host=127.0.0.1",
             f"--port={config['ports']['mysql']}", "--user=root", "shutdown"],
            env={**os.environ, "MYSQL_PWD": config["mysql_root_password"]}, timeout=40)
    else:
        run([os.environ.get("COMSPEC", r"C:\Windows\System32\cmd.exe"), "/d", "/c", RUNTIME / "rabbitmq/sbin/rabbitmqctl.bat",
             "-n", config["rabbit_environment"]["RABBITMQ_NODENAME"], "stop"],
            env={**os.environ, **config["rabbit_environment"], "RABBITMQ_CTL_ERL_ARGS": "+S 2:2 -args_file " + str(Path(config["data_root"]) / "config/erlang.args")}, timeout=40)


def bootstrap_database(config):
    root = Path(config["data_root"])
    run([RUNTIME / "mysql/bin/mysqld.exe", f"--defaults-file={root / 'config/my.ini'}", "--initialize-insecure", "--console"], timeout=180)
    service(config, "mysql", "start")
    wait_database(config)
    values = config["environment"]
    # All generated passwords are hex; accounts/database names are controlled.
    sql = f"ALTER USER 'root'@'localhost' IDENTIFIED BY '{config['mysql_root_password']}';\n"
    sql += "CREATE DATABASE mes_native CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;\n"
    sql += f"CREATE USER 'mes_api'@'127.0.0.1' IDENTIFIED BY '{values['MYSQL_PASSWORD']}';\n"
    sql += "GRANT SELECT,INSERT,UPDATE,DELETE ON mes_native.* TO 'mes_api'@'127.0.0.1';\n"
    sql += f"CREATE USER 'mes_migrator'@'127.0.0.1' IDENTIFIED BY '{values['MYSQL_MIGRATION_PASSWORD']}';\n"
    sql += "GRANT SELECT,INSERT,UPDATE,DELETE,CREATE,ALTER,DROP,INDEX,REFERENCES,CREATE ROUTINE,ALTER ROUTINE,EXECUTE ON mes_native.* TO 'mes_migrator'@'127.0.0.1';\n"
    mysql_client(config, sql, password="")


def rebase_reports(config):
    from scripts.deploy.portable_data import rebase_export
    target = Path(config["data_root"]) / "reports"
    with connect(config, migration=True) as connection:
        with connection.cursor() as cursor:
            cursor.execute("SELECT export_key,payload_json FROM biz_test_data_export")
            for key, payload in cursor.fetchall():
                record = rebase_export(json.loads(payload), target)
                cursor.execute("UPDATE biz_test_data_export SET file_path=%s,relative_path=%s,payload_json=%s WHERE export_key=%s",
                               (record.get("filePath"), record.get("relativePath"), json.dumps(record, ensure_ascii=False), key))
            cursor.execute("SELECT payload_json FROM app_storage_snapshot WHERE storage_key=%s", ("mes.test_data_exports",))
            row = cursor.fetchone()
            if row:
                records = [rebase_export(record, target) for record in json.loads(row[0])]
                cursor.execute("UPDATE app_storage_snapshot SET payload_json=%s WHERE storage_key=%s", (json.dumps(records, ensure_ascii=False), "mes.test_data_exports"))
            cursor.execute("INSERT INTO app_storage_snapshot(storage_key,payload_json) VALUES(%s,%s) ON DUPLICATE KEY UPDATE payload_json=VALUES(payload_json)",
                           ("mes.test_data_settings", json.dumps([{"savePath": str(target)}])))
        connection.commit()


def restore_backup(config, directory):
    from scripts.deploy.portable_data import verify
    source = Path(directory).resolve()
    manifest = verify(source)
    with connect(config, migration=True) as connection:
        with connection.cursor() as cursor:
            cursor.execute("SHOW TABLES")
            if cursor.fetchall():
                raise ValueError("Restore requires a completely empty target database")
    root = Path(config["data_root"])
    for folder in ("reports", "lims"):
        if any((root / folder).iterdir()):
            raise ValueError(f"Restore requires an empty target {folder} directory")
    mysql_client(config, infile=source / "database.sql", database="mes_native")
    for folder in ("reports", "lims"):
        if (source / folder).exists():
            shutil.copytree(source / folder, root / folder, dirs_exist_ok=True)
    with connect(config, migration=True) as connection:
        with connection.cursor() as cursor:
            for table, expected in manifest.get("source_table_counts", {}).items():
                if not re.fullmatch(r"[A-Za-z0-9_]+", table):
                    raise ValueError("Invalid table name in backup")
                cursor.execute(f"SELECT COUNT(*) FROM `{table}`")
                if manifest["consistency"] == "quiesced" and cursor.fetchone()[0] != expected:
                    raise ValueError(f"Restored row count mismatch: {table}")
    rebase_reports(config)
    write_json(root / "restore-report.json", dict(source=str(source), consistency=manifest["consistency"], tables_verified=len(manifest.get("source_table_counts", {}))))


def make_desktop_config(config, config_path):
    root = Path(config["data_root"])
    public = dict(deploymentMode="windows-service", nativeConfig=str(config_path), programRoot=config["program_root"],
                  simulatorsEnabled=config["simulators"],
                  instance=config["instance"], serverUrl=config["public_url"], apiUrl=f"http://127.0.0.1:{config['ports']['api']}",
                  limsUrl=f"http://127.0.0.1:{config['ports']['lims']}", upperComputerUrl=f"http://127.0.0.1:{config['ports']['upper']}")
    # Writable public per-machine configuration lives outside versioned code.
    write_json(root / "desktop/mes-desktop-tools.json", public)
    source = PROGRAM / "desktop-tools"
    if not source.exists():
        return
    for path in source.rglob("*"):
        if path.is_file() and path.name not in ("mes-desktop-tools.json", "desktop-tools-manifest.json"):
            target = root / "desktop" / path.relative_to(source)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, target)
    run(["icacls.exe", root / "desktop", "/grant", "*S-1-5-32-545:(OI)(CI)RX", "/T", "/Q"])


def prepare_installation(args, *, check_ports=True):
    """Validate the target without creating files or changing any services."""
    ensure_windows_admin()
    validate_root(PROGRAM)
    root = validate_root(args.data_root)
    if root.is_relative_to(PROGRAM) or PROGRAM.is_relative_to(root):
        raise ValueError("Program and persistent data directories must be separate")
    if root.exists() and any(root.iterdir()):
        raise ValueError("Data directory is not empty. Existing installations are never overwritten by fresh Install")
    migration_output = getattr(args, "migration_output", None)
    if migration_output:
        destination = migration_output.resolve()
        if destination.exists() or Path(str(destination) + ".log").exists():
            raise ValueError("Migration backup and log must use new paths")
        for protected in (root, PROGRAM):
            if destination.is_relative_to(protected) or protected.is_relative_to(destination):
                raise ValueError("Migration backup must be separate from native program and data directories")
    verify_release(PROGRAM)
    ports = dict(DEFAULT_PORTS)
    if args.port_offset:
        ports = {key: value + args.port_offset for key, value in ports.items()}
        # Avoid the existing RabbitMQ management default 15672 during preview.
        ports["amqp"] = DEFAULT_PORTS["amqp"] + args.port_offset * 3
    if args.ports:
        ports.update(load(args.ports))
    public = args.public_url or f"http://127.0.0.1:{ports['web']}"
    config = make_config(root, args.instance, ports, public, not args.no_simulators)
    if args.admin_user:
        config["environment"]["DEMO_USER"] = args.admin_user
    if args.admin_password_file:
        password = args.admin_password_file.read_text(encoding="utf-8-sig").rstrip("\r\n")
        if len(password) < 8:
            raise ValueError("Choose an MES login password of at least eight characters")
        config["environment"]["DEMO_PASSWORD"] = password
    roles = SERVICE_ROLES if config["simulators"] else ("mysql", "rabbitmq", "api", "web")
    for role in roles:
        if service_exists(service_name(config, role)):
            raise ValueError(f"A service with the selected instance name already exists: {role}")
    if check_ports:
        for port in ports.values():
            with socket.socket() as probe:
                probe.settimeout(.3)
                if probe.connect_ex(("127.0.0.1", port)) == 0:
                    raise ValueError(f"Port is already in use: {port}; choose isolation ports or stop the intended old deployment")
    if args.backup:
        from scripts.deploy.portable_data import verify
        verify(args.backup)
    return root, config, roles


def install(args):
    root, config, roles = prepare_installation(args)
    public = config["public_url"]
    ports = config["ports"]
    root.mkdir(parents=True, exist_ok=True)
    for name in ("config", "mysql", "rabbitmq", "lims", "reports", "runtime", "logs", "services", "temp", "backups"):
        (root / name).mkdir()
    secure_data(root)
    config_path = root / "config/native.json"
    write_json(config_path, config)
    try:
        configure_services(config, config_path)
        for role in roles:
            run([wrapper(config, role), "install"], timeout=60)
            config["installed_services"].append(role)
            write_json(config_path, config)
        bootstrap_database(config)
        if args.backup:
            restore_backup(config, args.backup)
        run([PYTHON, "-I", "-X", "utf8", PROGRAM / "scripts/init_mysql_storage.py"], env=environment(config, migration=True))
        service(config, "rabbitmq", "start")
        import base64
        auth = base64.b64encode(("mes_app:" + config["environment"]["MQTT_PASSWORD"]).encode()).decode()
        deadline = time.monotonic() + 120
        while True:
            try:
                http_json(f"http://127.0.0.1:{ports['management']}/api/overview", headers={"Authorization": "Basic " + auth})
                break
            except (OSError, ValueError):
                if time.monotonic() > deadline:
                    raise RuntimeError("RabbitMQ did not become ready")
                time.sleep(1)
        for role in roles:
            if role not in ("mysql", "rabbitmq"):
                service(config, role, "start")
        make_desktop_config(config, config_path)
        test(config)
        for role in roles:
            run(["sc.exe", "config", service_name(config, role), "start=", "auto"])
        from urllib.parse import urlsplit
        if urlsplit(public).hostname not in ("127.0.0.1", "localhost"):
            run(["netsh.exe", "advfirewall", "firewall", "add", "rule", f"name={config['instance']}-Web",
                 "dir=in", "action=allow", "protocol=TCP", f"localport={ports['web']}", "profile=private", "remoteip=localsubnet",
                 f"program={RUNTIME / 'caddy/caddy.exe'}"])
            config["firewall_created"] = True
        config["phase"] = "installed"
        write_json(config_path, config)
        write_json(root / "installation-report.json", dict(version=config["version"], program_root=str(PROGRAM), data_root=str(root),
            instance=config["instance"], ports=ports, simulators=config["simulators"], phase="installed", installed_at=datetime.now(timezone.utc).isoformat()))
        # The full config stays ACL-protected. Credentials are never printed.
        print(json.dumps(dict(status="installed", url=public, config=str(config_path)), ensure_ascii=False))
    except Exception as exc:
        config["phase"] = "failed"
        config["failure"] = str(exc)
        write_json(config_path, config)
        for role in reversed(config["installed_services"]):
            try:
                service(config, role, "stop")
            except Exception:
                pass
        raise


def test(config):
    ports = config["ports"]
    wait_url(f"http://127.0.0.1:{ports['api']}/health/ready", lambda r: r.get("status") == "ready")
    wait_url(f"http://127.0.0.1:{ports['web']}/")
    result = http_json(f"http://127.0.0.1:{ports['web']}/auth/login", data=dict(username=config["environment"]["DEMO_USER"], password=config["environment"]["DEMO_PASSWORD"], module="central"))
    if result.get("module") != "central":
        raise RuntimeError("MES login verification failed")
    if config["simulators"]:
        for role in ("lims", "upper"):
            wait_url(f"http://127.0.0.1:{ports[role]}/api/state", lambda r: r.get("connected") is True)
    print("MES native readiness, login and simulator connections passed")


def control(config_path, action):
    ensure_windows_admin()
    config = load(config_path)
    if config.get("format") != "mes-native-installation" or Path(config["program_root"]).resolve() != PROGRAM:
        raise ValueError("Native installation identity mismatch")
    if action == "uninstall" and config.get("phase") == "uninstalled":
        print("Native services already removed; persistent data retained")
        return
    roles = config["installed_services"]
    if action in ("stop", "restart", "uninstall"):
        for role in reversed(roles):
            service(config, role, "stop")
    if action in ("start", "restart"):
        if config["phase"] != "installed":
            raise ValueError("Installation is incomplete; inspect the installation report before starting")
        for role in roles:
            service(config, role, "start")
        test(config)
    if action == "uninstall":
        for role in reversed(roles):
            assert_owned_service(config, role)
            run([wrapper(config, role), "uninstall"])
        if config.get("firewall_created"):
            run(["netsh.exe", "advfirewall", "firewall", "delete", "rule", f"name={config['instance']}-Web"])
        epmd = next((RUNTIME / "erlang").glob("erts-*/bin/epmd.exe"))
        with socket.socket() as probe:
            probe.settimeout(.5)
            if probe.connect_ex(("127.0.0.1", config["ports"]["epmd"])) == 0:
                # A private daemon with living nodes refuses -kill; never force
                # terminate an unrelated/system-wide Erlang discovery daemon.
                run([epmd, "-port", str(config["ports"]["epmd"]), "-kill"])
        config["phase"] = "uninstalled"
        write_json(config_path, config)
        print("Native services removed. All database/report/LIMS data retained")


def backup_native(config_path, output):
    ensure_windows_admin()
    from scripts.deploy.portable_data import inventory, verify, sqlite_snapshot, regular_files, copy_stable
    config = load(config_path)
    if Path(config["program_root"]).resolve() != PROGRAM or config["phase"] != "installed":
        raise ValueError("Select the installed native instance before taking a backup")
    output = Path(output).resolve()
    root = Path(config["data_root"]).resolve()
    if output.exists() or output.is_relative_to(root / "reports") or output.is_relative_to(root / "lims"):
        raise ValueError("Backup must use a new directory outside live data directories")
    business = [role for role in config["installed_services"] if role not in ("mysql", "rabbitmq")]
    originally_running = [role for role in business if service_state(service_name(config, role)) == 4]
    try:
        for role in reversed(originally_running):
            service(config, role, "stop")
        output.mkdir(parents=True)
        with connect(config, migration=True) as connection:
            with connection.cursor() as cursor:
                cursor.execute("SHOW TABLES")
                tables = [row[0] for row in cursor.fetchall()]
                counts = {}
                for table in tables:
                    if not re.fullmatch(r"[A-Za-z0-9_]+", table):
                        raise ValueError("Unexpected table name")
                    cursor.execute(f"SELECT COUNT(*) FROM `{table}`")
                    counts[table] = cursor.fetchone()[0]
                cursor.execute("SELECT version,checksum,success FROM schema_migrations ORDER BY version")
                migrations = cursor.fetchall()
        env = {**os.environ, "MYSQL_PWD": config["mysql_root_password"]}
        run([RUNTIME / "mysql/bin/mysqldump.exe", "--no-defaults", "--host=127.0.0.1", f"--port={config['ports']['mysql']}",
             "--user=root", "--single-transaction", "--quick", "--routines", "--triggers", "--events", "--hex-blob",
             "--set-gtid-purged=OFF", "--no-tablespaces", f"--result-file={output / 'database.sql'}", "mes_native"], env=env)
        for source in regular_files(root / "reports"):
            copy_stable(source, output / "reports" / source.relative_to(root / "reports"))
        if config["simulators"]:
            for name in ("task-sequence.sqlite3", "interactions.sqlite3", "communication.sqlite3"):
                sqlite_snapshot(root / "lims" / name, output / "lims" / name)
        else:
            # A business-only installation still exports a complete empty LIMS
            # store set, compatible with the common data-backup contract.
            from tools.lims_simulator.task_numbers import TaskNumberSequence
            from tools.lims_simulator.interactions import InteractionStore
            from tools.lims_simulator.communication import CommunicationStore
            TaskNumberSequence(output / "lims/task-sequence.sqlite3")
            InteractionStore(output / "lims/interactions.sqlite3")
            CommunicationStore(output / "lims/communication.sqlite3")
        state = root / "runtime/test-data-backup.sqlite3"
        if state.exists():
            sqlite_snapshot(state, output / "runtime-source/test-data-backup.sqlite3")
        write_json(output / "data-manifest.json", dict(format="mes-portable-data", format_version=1,
            consistency="quiesced", created_at_utc=datetime.now(timezone.utc).isoformat(), source_database="mes_native",
            source_report_path=str(root / "reports"), source_table_counts=counts, schema_migrations=migrations, files=inventory(output)))
        verify(output)
        print("Native data backup checksums and SQLite integrity verified")
    finally:
        for role in originally_running:
            service(config, role, "start")


def update_native(config_path, backup_directory):
    """Explicit compatible-runtime update; SQL failure never silently downgrades."""
    ensure_windows_admin()
    validate_root(PROGRAM)
    verify_release(PROGRAM)
    from scripts.deploy.portable_data import verify
    backup = verify(backup_directory)
    if backup["consistency"] != "quiesced":
        raise ValueError("Update requires a verified quiesced backup")
    config = load(config_path)
    old_program = Path(config["program_root"]).resolve()
    if old_program == PROGRAM:
        raise ValueError("Install the new release in a separate version directory before Update")
    # Database/broker runtime upgrades need their own acceptance boundary.
    old_manifest, new_manifest = load(old_program / "native-manifest.json"), load(PROGRAM / "native-manifest.json")
    prefixes = ("runtime/mysql/", "runtime/erlang/", "runtime/rabbitmq/")
    foundation = lambda manifest: {e["path"]: e["sha256"] for e in manifest["files"] if e["path"].startswith(prefixes)}
    if foundation(old_manifest) != foundation(new_manifest):
        raise ValueError("This update changes a foundational runtime; use an isolated migration and acceptance procedure")
    # Invoke the old, trusted manager to verify service ownership and stop.
    run([old_program / "runtime/python/python.exe", "-I", "-X", "utf8", old_program / "native/native_manager.py", "stop", "--config", config_path])
    # Start only MySQL for comparison, while business processes remain stopped.
    run([wrapper(config, "mysql"), "start"])
    wait_database(config)
    with connect(config, migration=True) as connection:
        with connection.cursor() as cursor:
            for table, expected in backup["source_table_counts"].items():
                if not re.fullmatch(r"[A-Za-z0-9_]+", table):
                    raise ValueError("Invalid backup table name")
                cursor.execute(f"SELECT COUNT(*) FROM `{table}`")
                if cursor.fetchone()[0] != expected:
                    raise ValueError("Stopped database differs from the selected backup")
    run([wrapper(config, "mysql"), "stop"])
    saved = Path(config["data_root"]) / "backups" / ("config-before-update-" + datetime.now().strftime("%Y%m%d%H%M%S") + ".json")
    shutil.copy2(config_path, saved)
    config["program_root"] = str(PROGRAM)
    config["environment"]["MES_REPORT_FONT"] = str(PROGRAM / "fonts/NotoSansSC.ttf")
    config["phase"] = "updating"
    write_json(config_path, config)
    configure_services(config, config_path)
    run([wrapper(config, "mysql"), "start"])
    wait_database(config)
    run([PYTHON, "-I", "-X", "utf8", PROGRAM / "scripts/init_mysql_storage.py"], env=environment(config, migration=True))
    config["phase"] = "installed"
    write_json(config_path, config)
    make_desktop_config(config, config_path)
    control(config_path, "start")
    for role in config["installed_services"]:
        run(["sc.exe", "config", service_name(config, role), "start=", "auto"])
    print("Native application update completed; previous program and verified data backup retained")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="action", required=True)
    sub.add_parser("verify")
    for action in ("install", "preflight"):
        p = sub.add_parser(action)
        p.add_argument("--data-root", type=Path, required=True)
        p.add_argument("--instance", default="MESNative")
        p.add_argument("--ports", type=Path)
        p.add_argument("--port-offset", type=int, default=0)
        p.add_argument("--public-url")
        p.add_argument("--admin-user")
        p.add_argument("--admin-password-file", type=Path)
        p.add_argument("--no-simulators", action="store_true")
        p.add_argument("--backup", type=Path)
        if action == "preflight":
            p.add_argument("--skip-port-check", action="store_true", help="Validate a migration target before stopping the source Docker ports")
            p.add_argument("--migration-output", type=Path, help="Validate a new external Docker backup directory")
    for name in ("start", "stop", "restart", "uninstall", "test"):
        p = sub.add_parser(name)
        p.add_argument("--config", type=Path, required=True)
    p = sub.add_parser("backup")
    p.add_argument("--config", type=Path, required=True)
    p.add_argument("--output", type=Path, required=True)
    p = sub.add_parser("update")
    p.add_argument("--config", type=Path, required=True)
    p.add_argument("--backup", type=Path, required=True)
    p = sub.add_parser("shutdown-child")
    p.add_argument("--config", type=Path, required=True)
    p.add_argument("--role", choices=("mysql", "rabbitmq"), required=True)
    args = parser.parse_args()
    if args.action == "verify":
        verify_release(PROGRAM)
        print("Native release file checksums verified")
    elif args.action == "install":
        install(args)
    elif args.action == "preflight":
        prepare_installation(args, check_ports=not args.skip_port_check)
        print("Native target preflight passed; no files or services changed")
    elif args.action == "test":
        test(load(args.config))
    elif args.action == "backup":
        backup_native(args.config, args.output)
    elif args.action == "update":
        update_native(args.config, args.backup)
    elif args.action == "shutdown-child":
        shutdown_child(args.config, args.role)
    else:
        control(args.config, args.action)


if __name__ == "__main__":
    main()
