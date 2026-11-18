"""Real HTTP + native ZIP provisioning/DPAPI import/heartbeat/revocation."""
import json
from pathlib import Path
import shutil
import socket
import subprocess
import threading
import time
import uuid

from fastapi import FastAPI
from fastapi.responses import HTMLResponse
import pytest
import httpx
import uvicorn

from app.api.routes.auth import router as auth_router
from app.api.routes.terminal_control import router as terminal_router
from app.core.config import settings
from app.services.fixed_terminal_auth import FixedTerminalAuthService, InMemoryFixedTerminalRepository, set_fixed_terminal_auth_service_for_tests
from app.services.terminal_control import InMemoryTerminalControlRepository, TerminalControlService, set_terminal_control_service_for_tests
from app.services.terminal_enrollment import InMemoryEnrollmentRepository, TerminalEnrollmentService, set_terminal_enrollment_service_for_tests
from scripts.build_terminal_packages import build

ROOT = Path(__file__).resolve().parents[2]
PS = shutil.which('powershell.exe')
pytestmark = pytest.mark.skipif(not PS, reason='Windows native client required')
BASE = '/api/terminal-control/enrollment'


def powershell(script, *args):
    result = subprocess.run([PS, '-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', str(ROOT / script), *map(str, args)],
                            capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=60)
    assert result.returncode == 0, result.stdout + result.stderr
    return result


@pytest.fixture(scope='module')
def native_packages(tmp_path_factory):
    temporary = tmp_path_factory.mktemp('terminal-enrollment-native')
    clients = temporary / 'clients'
    powershell('scripts/build_workstation_clients.ps1', '-OutputDirectory', clients, '-Offline')
    enrollment = temporary / 'access'
    powershell('scripts/build_desktop_client.ps1', '-OutputDirectory', enrollment, '-Module', 'enrollment', '-Offline')
    packages = temporary / 'packages'
    result = build(clients, packages)
    assert len(result) == 15 and {row['version'] for row in result} == {'1.8.0'}
    return enrollment / 'MES终端接入.exe', packages, clients


@pytest.fixture
def site(native_packages):
    auth_repository = InMemoryFixedTerminalRepository()
    runtime = InMemoryTerminalControlRepository()
    service = TerminalEnrollmentService(InMemoryEnrollmentRepository(auth_repository, runtime), native_packages[1])
    set_fixed_terminal_auth_service_for_tests(FixedTerminalAuthService(auth_repository))
    set_terminal_control_service_for_tests(TerminalControlService(runtime, FixedTerminalAuthService(auth_repository)))
    set_terminal_enrollment_service_for_tests(service)
    app = FastAPI()
    app.include_router(auth_router); app.include_router(terminal_router)

    @app.get('/laboratory')
    def page():
        return HTMLResponse('<html><head><title>Approved workstation fixture</title></head><body>Approved native workstation</body></html>')

    @app.get('/health/ready')
    def ready():
        return {'status': 'ready'}

    sock = socket.socket(); sock.bind(('127.0.0.1', 0)); port = sock.getsockname()[1]
    server = uvicorn.Server(uvicorn.Config(app, host='127.0.0.1', port=port, log_level='error', lifespan='off'))
    thread = threading.Thread(target=lambda: server.run(sockets=[sock]), daemon=True); thread.start()
    deadline = time.monotonic() + 10
    while not server.started:
        assert time.monotonic() < deadline
        time.sleep(.05)
    yield f'http://127.0.0.1:{port}', service
    server.should_exit = True; thread.join(timeout=10); sock.close()
    set_fixed_terminal_auth_service_for_tests(None)
    set_terminal_control_service_for_tests(None)
    set_terminal_enrollment_service_for_tests(None)


def status(executable):
    result = subprocess.run([str(executable), '--status'], capture_output=True, text=True, encoding='utf-8', timeout=15)
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)


def wait(predicate):
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        result = predicate()
        if result:
            return result
        time.sleep(.15)
    raise AssertionError('Native enrollment acceptance condition did not complete')


def test_approved_native_download_starts_with_own_binding_and_reset_requires_reapproval(native_packages, site, tmp_path):
    origin, service = site
    manager = httpx.Client()
    assert manager.post(origin + '/auth/login', json=dict(username=settings.DEMO_USER, password=settings.DEMO_PASSWORD, module='central')).status_code == 200
    request = dict(requestId=uuid.uuid4().hex, token=uuid.uuid4().hex + uuid.uuid4().hex, deviceId=uuid.uuid4().hex,
                   machineName='Native acceptance PC', stationId='LAB_SALT', oldDirectory='')
    assert manager.post(origin + BASE + '/requests', json=request).status_code == 200
    assert manager.post(origin + BASE + '/requests/' + request['requestId'] + '/package', json=dict(token=request['token'])).status_code == 403
    assert manager.post(origin + BASE + '/requests/' + request['requestId'] + '/review', json=dict(approve=True, stationId='LAB_SALT')).status_code == 200
    source = tmp_path / 'request.json'; source.write_text(json.dumps(request), encoding='utf-8')
    result_path = tmp_path / 'generated.txt'
    powershell('tests/control_center/Test-TerminalProvisioning.ps1', '-Executable', native_packages[0], '-Origin', origin,
               '-RequestFile', source, '-DesktopDirectory', tmp_path / '桌面 with spaces', '-ResultFile', result_path)
    executable = Path(result_path.read_text(encoding='utf-8'))
    assert executable.name == 'MES盐雾试验室.exe' and executable.exists()
    assert (executable.parent / '.enrollment.bin').exists()
    process = subprocess.Popen([str(executable), '--test-hidden'], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
        wait(lambda: not (executable.parent / '.enrollment.bin').exists())
        wait(lambda: manager.get(origin + '/api/terminal-control/terminals').json()['items'][0]['online'])
        row = manager.get(origin + '/api/terminal-control/terminals').json()['items'][0]
        assert row['agentVersion'] == '1.8.0' and row['allowReload'] and not row['allowPower']
        assert status(executable)['labName'] == '盐雾试验室'
        terminal_id = row['terminalId']
        assert manager.post(origin + BASE + '/terminals/' + terminal_id + '/reset').status_code == 200
        wait(lambda: '重新申请' in status(executable).get('message', '') or status(executable).get('state') in {'binding-revoked', 'error'})
        assert manager.post(origin + BASE + '/requests/' + request['requestId'] + '/poll', json=dict(token=request['token'])).json()['status'] == 'reset'
        another = {**request, 'requestId': uuid.uuid4().hex, 'token': uuid.uuid4().hex + uuid.uuid4().hex,
                   'stationId': 'LAB_IMPACT_1', 'oldDirectory': str(executable.parent)}
        assert manager.post(origin + BASE + '/requests', json=another).json()['status'] == 'pending'
        assert manager.post(origin + BASE + '/requests/' + another['requestId'] + '/review', json=dict(approve=True, stationId='LAB_IMPACT_1')).status_code == 200
        source.write_text(json.dumps(another), encoding='utf-8')
        powershell('tests/control_center/Test-TerminalProvisioning.ps1', '-Executable', native_packages[0], '-Origin', origin,
                   '-RequestFile', source, '-DesktopDirectory', tmp_path / '桌面 with spaces', '-ResultFile', result_path)
        replacement = Path(result_path.read_text(encoding='utf-8'))
        assert replacement.name == 'MES冲击一室.exe' and replacement.parent != executable.parent
        assert (executable.parent / '已停用说明.txt').exists()
    finally:
        subprocess.run([str(executable), '--close'], capture_output=True, timeout=20)
        try: process.wait(timeout=15)
        except subprocess.TimeoutExpired: process.kill(); process.wait(timeout=5)


def test_preinstalled_client_activates_in_place_and_rebinding_creates_a_new_folder(native_packages, site, tmp_path):
    origin, _ = site
    folder = tmp_path / '预置盐雾工位'
    shutil.copytree(native_packages[2] / '盐雾试验室', folder)
    executable = folder / 'MES盐雾试验室.exe'
    config = folder / 'mes-client.json'
    settings_json = json.loads(config.read_text(encoding='utf-8-sig'))
    settings_json['serverUrl'] = origin
    config.write_text(json.dumps(settings_json), encoding='utf-8')
    # Update the declared configuration hash after choosing an isolated server.
    from hashlib import sha256
    manifest_path = folder / 'client-manifest.json'
    manifest = json.loads(manifest_path.read_text(encoding='utf-8-sig'))
    for item in manifest['files']:
        data = (folder / item['path']).read_bytes()
        item.update(bytes=len(data), sha256=sha256(data).hexdigest())
    manifest_path.write_text(json.dumps(manifest), encoding='utf-8')
    powershell('tests/desktop-client/Test-PreinstalledTerminal.ps1', '-Executable', executable, '-Origin', origin, '-Inspect')
    manager = httpx.Client()
    assert manager.post(origin + '/auth/login', json=dict(username=settings.DEMO_USER, password=settings.DEMO_PASSWORD, module='central')).status_code == 200
    request = dict(requestId=uuid.uuid4().hex, token=uuid.uuid4().hex + uuid.uuid4().hex, deviceId=uuid.uuid4().hex,
                   machineName='Preinstalled PC', stationId='LAB_SALT', oldDirectory=str(folder), useLocalPackage=True)
    def approve(value, station):
        assert manager.post(origin + BASE + '/requests', json=value).status_code == 200
        assert manager.post(origin + BASE + '/requests/' + value['requestId'] + '/review', json=dict(approve=True, stationId=station)).status_code == 200
    source=tmp_path/'local-request.json'; result=tmp_path/'local-result.txt'
    approve(request, 'LAB_SALT')
    source.write_text(json.dumps(request), encoding='utf-8')
    powershell('tests/desktop-client/Test-PreinstalledTerminal.ps1', '-Executable', executable, '-Origin', origin, '-RequestFile', source, '-ResultFile', result)
    assert Path(result.read_text(encoding='utf-8')) == executable
    assert (folder/'.enrollment.bin').exists()
    process=subprocess.Popen([str(executable),'--test-hidden'], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
        wait(lambda: not (folder/'.enrollment.bin').exists())
        wait(lambda: manager.get(origin+'/api/terminal-control/terminals').json()['items'])
        terminal=manager.get(origin+'/api/terminal-control/terminals').json()['items'][0]
        assert manager.post(origin+BASE+'/terminals/'+terminal['terminalId']+'/reset').status_code == 200
        replacement={**request,'requestId':uuid.uuid4().hex,'token':uuid.uuid4().hex+uuid.uuid4().hex}
        approve(replacement,'LAB_SALT');source.write_text(json.dumps(replacement),encoding='utf-8')
        powershell('tests/desktop-client/Test-PreinstalledTerminal.ps1','-Executable',executable,'-Origin',origin,'-RequestFile',source,'-ResultFile',result)
        assert not result.read_text(encoding='utf-8'), 'A revoked installation was activated in place'
        powershell('tests/control_center/Test-TerminalProvisioning.ps1','-Executable',native_packages[0],'-Origin',origin,
                   '-RequestFile',source,'-DesktopDirectory',tmp_path/'桌面','-ResultFile',result)
        assert Path(result.read_text(encoding='utf-8')).parent != folder
        assert (folder/'已停用说明.txt').exists()
    finally:
        subprocess.run([str(executable),'--close'],capture_output=True,timeout=20)
        process.wait(timeout=20)
        manager.close()


def test_dedicated_enrollment_launcher_opens_its_own_locked_workstation(native_packages, site, tmp_path):
    import os
    folder=tmp_path/'copyable-workstation'
    shutil.copytree(native_packages[2]/'盐雾试验室',folder)
    config=folder/'mes-client.json';value=json.loads(config.read_text(encoding='utf-8-sig'));value['serverUrl']=site[0]
    config.write_text(json.dumps(value),encoding='utf-8')
    executable=folder/'MES盐雾试验室.exe'
    env={**os.environ,'MES_DESKTOP_TEST_HIDDEN':'1'}
    result=subprocess.run([str(folder/'MES终端接入.exe')],env=env,capture_output=True,timeout=15)
    assert result.returncode == 0
    try:
        def state():
            result=subprocess.run([str(executable),'--request-binding','--status'],capture_output=True,text=True,encoding='utf-8',timeout=15)
            return json.loads(result.stdout)
        found=wait(lambda: (value if (value:=state()).get('state') == 'enrollment' else None))
        assert found['stationId'] == 'LAB_SALT' and found['stationLocked'] is True
    finally:
        subprocess.run([str(executable),'--request-binding','--close'],capture_output=True,timeout=20)


def test_access_client_repeated_launch_activates_existing_window(native_packages, site, tmp_path):
    executable = native_packages[0]
    config = tmp_path / 'access.json'
    config.write_text(json.dumps(dict(serverUrl=site[0], module='enrollment')), encoding='utf-8')
    arguments = [str(executable), '--config', str(config)]
    process = subprocess.Popen(arguments + ['--test-hidden'], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
        def state():
            result = subprocess.run(arguments + ['--status'], capture_output=True, text=True, encoding='utf-8', timeout=15)
            return json.loads(result.stdout) if result.returncode == 0 and result.stdout.strip() else {}
        first = wait(lambda: value if (value := state()).get('pid') == process.pid else None)
        assert first['state'] == 'enrollment'
        repeated = subprocess.run(arguments + ['--test-hidden'], capture_output=True, timeout=15)
        assert repeated.returncode == 0, repeated.stderr
        assert state()['pid'] == process.pid
    finally:
        subprocess.run(arguments + ['--close'], capture_output=True, timeout=20)
        try: process.wait(timeout=15)
        except subprocess.TimeoutExpired: process.kill(); process.wait(timeout=5)
