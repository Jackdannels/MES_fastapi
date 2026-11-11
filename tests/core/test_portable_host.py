import json
from pathlib import Path
import shutil
import subprocess

import pytest

ROOT = Path(__file__).resolve().parents[2]
PS = shutil.which('powershell.exe')
pytestmark = pytest.mark.skipif(not PS, reason='Windows PowerShell required')


def invoke(tmp_path, body, *args):
    script = tmp_path / 'test.ps1'
    script.write_text("$ErrorActionPreference='Stop'\n[Console]::OutputEncoding=New-Object Text.UTF8Encoding($false)\nSet-StrictMode -Version Latest\n. '" +
        str(ROOT / 'scripts/deploy/Mes-PortableHost.ps1') + "'\n" + body, encoding='utf-8-sig')
    return subprocess.run([PS, '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', str(script), *args],
        capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=20)


def test_auto_lan_replaces_loopback_preserves_secrets_and_is_idempotent(tmp_path):
    env = tmp_path / 'portable.env'
    original = 'COMPOSE_PROJECT_NAME=existing-name\nMYSQL_ROOT_PASSWORD=unchanged-$secret\nMES_WEB_PORT=32173\nMES_BIND_ADDRESS=127.0.0.1\nMES_PUBLIC_URL=http://127.0.0.1:32173\n'
    env.write_text(original, encoding='utf-8')
    result = invoke(tmp_path, '''function Get-MesLanInterfaces { @([pscustomobject]@{Address='192.168.110.22'},[pscustomobject]@{Address='10.9.8.7'}) }
$first=Update-MesPortableNetwork '%s'
$second=Update-MesPortableNetwork '%s'
@{first=$first;second=$second}|ConvertTo-Json -Depth 5 -Compress
''' % (env, env))
    assert result.returncode == 0, result.stdout + result.stderr
    report = json.loads(result.stdout)
    assert report['first']['PublicUrl'] == 'http://192.168.110.22:32173'
    assert report['first']['Changed'] and not report['second']['Changed']
    text = env.read_text(encoding='utf-8')
    assert 'MES_BIND_ADDRESS=0.0.0.0' in text
    assert 'MYSQL_ROOT_PASSWORD=unchanged-$secret' in text
    assert 'COMPOSE_PROJECT_NAME=existing-name' in text
    assert 'http://10.9.8.7:32173' in text
    backups = list(tmp_path.glob('portable.env.network-backup-*'))
    assert len(backups) == 1 and backups[0].read_text(encoding='utf-8') == original


def test_manual_network_and_invalid_preferred_ip_do_not_rewrite_environment(tmp_path):
    env = tmp_path / 'portable.env'
    original = 'MES_NETWORK_MODE=manual\nMES_BIND_ADDRESS=192.0.2.8\nMES_PUBLIC_URL=https://mes.example.test\n'
    env.write_text(original, encoding='utf-8')
    result = invoke(tmp_path, f"Update-MesPortableNetwork '{env}' | ConvertTo-Json -Compress")
    assert result.returncode == 0, result.stdout + result.stderr
    assert not json.loads(result.stdout)['Changed']
    assert env.read_text(encoding='utf-8') == original
    env.write_text('MES_NETWORK_MODE=auto\nMES_LAN_IP=203.0.113.200\n')
    result = invoke(tmp_path, "function Get-MesLanInterfaces { @() }\nUpdate-MesPortableNetwork '" + str(env) + "'")
    assert result.returncode != 0
    assert not list(tmp_path.glob('portable.env.network-backup-*'))


@pytest.mark.parametrize('fast', [True, False])
def test_startup_override_retains_steady_checks_and_excludes_sse_compression(tmp_path, fast):
    path = tmp_path / 'override.yml'
    result = invoke(tmp_path, f"Write-MesStartupOverride '{path}' ${str(fast).lower()}")
    assert result.returncode == 0, result.stdout + result.stderr
    text = path.read_text()
    assert 'start_interval: 1s' in text if fast else 'start_interval:' not in text
    assert 'interval: 10s' not in text  # Main Compose retains the steady interval.
    assert 'mes-performance.conf' in text
    assert 'check_protocol_listener amqp' in text and 'check_protocol_listener mqtt' in text
    gzip = (tmp_path / 'mes-portable-performance.conf').read_text()
    assert 'application/javascript' in gzip
    assert 'text/event-stream' not in gzip


def test_portable_stop_keeps_containers_and_network_for_next_start():
    source = (ROOT / 'scripts/deploy/Mes-Portable.ps1').read_text(encoding='utf-8-sig')
    assert "'Stop' { Invoke-Docker ($compose + @('stop')) }" in source
    assert 'Mes-PortableHost.ps1' in source
    assert '${MES_BIND_ADDRESS:-0.0.0.0}' in (ROOT / 'compose.portable.yml').read_text()


def test_desktop_discovery_supports_per_user_installation(tmp_path):
    executable = tmp_path / '用户目录/Programs/DockerDesktop/Docker Desktop.exe'
    executable.parent.mkdir(parents=True)
    executable.write_bytes(b'not executed')
    result = invoke(tmp_path, f"$env:LOCALAPPDATA='{tmp_path / '用户目录'}'\nResolve-MesDockerDesktop")
    assert result.returncode == 0, result.stdout + result.stderr
    assert str(executable) in result.stdout


def test_desktop_discovery_supports_custom_path_relative_to_cli(tmp_path):
    executable = tmp_path / '自定义 Docker 安装/Docker Desktop.exe'
    executable.parent.mkdir(parents=True)
    executable.write_bytes(b'not executed')
    cli = executable.parent / 'resources/bin/docker.exe'
    result = invoke(tmp_path, f'''$env:LOCALAPPDATA='{tmp_path / 'no-user'}'
$env:ProgramFiles='{tmp_path / 'no-machine'}'
function Get-Command {{ param($Name); [pscustomobject]@{{Source='{cli}'}} }}
Resolve-MesDockerDesktop
''')
    assert result.returncode == 0, result.stdout + result.stderr
    assert str(executable) in result.stdout


@pytest.mark.parametrize('os_type,success', [('linux', True), ('windows', False)])
def test_engine_preflight_requires_linux(tmp_path, os_type, success):
    result = invoke(tmp_path, f'''function Get-MesDockerEngineStatus {{ [pscustomobject]@{{Ready=$true;OsType='{os_type}';Reason=''}} }}
Wait-MesDockerEngine -TimeoutSeconds 0
''')
    assert (result.returncode == 0) is success
    if not success:
        assert 'Linux' in result.stderr


def test_missing_desktop_reports_original_engine_error_without_launching(tmp_path):
    result = invoke(tmp_path, '''function Get-MesDockerEngineStatus { [pscustomobject]@{Ready=$false;OsType='';Reason='engine-unavailable-marker'} }
function Resolve-MesDockerDesktop { '' }
function Start-Process { throw 'MUST-NOT-LAUNCH' }
Wait-MesDockerEngine -TimeoutSeconds 0
''')
    assert result.returncode != 0
    assert 'engine-unavailable-marker' in result.stderr
    assert 'MUST-NOT-LAUNCH' not in result.stderr


def test_custom_desktop_is_launched_hidden_and_waits_for_linux(tmp_path):
    executable = tmp_path / '指定安装目录/Docker Desktop.exe'
    result = invoke(tmp_path, f'''$script:attempt=0
function Get-MesDockerEngineStatus {{ $script:attempt++; [pscustomobject]@{{Ready=($script:attempt -ge 2);OsType='linux';Reason=''}} }}
function Resolve-MesDockerDesktop {{ '{executable}' }}
function Start-Process {{ param($FilePath,$WindowStyle); if($FilePath -ne '{executable}' -or $WindowStyle -ne 'Hidden'){{throw 'Invalid Docker launch'}} }}
Wait-MesDockerEngine -TimeoutSeconds 0
Write-Output 'LAUNCH-OK'
''')
    assert result.returncode == 0, result.stdout + result.stderr
    assert 'LAUNCH-OK' in result.stdout
