import json
import os
from pathlib import Path
import shutil
import subprocess
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import threading

import pytest

ROOT = Path(__file__).resolve().parents[2]
PS = shutil.which("powershell.exe") or shutil.which("powershell")
SCRIPT = ROOT / "scripts/client/docker-service-control.ps1"
pytestmark = pytest.mark.skipif(not PS, reason="Windows PowerShell required")


def invoke(*args, env=None):
    config = Path(args[args.index("-ConfigurationFile") + 1])
    controller = config.parent / "tool/scripts/docker-service-control.ps1"
    controller.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(SCRIPT, controller)
    return subprocess.run([PS, "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(controller), '-NoOpen', *map(str, args)],
                          cwd=ROOT, capture_output=True, text=True, encoding="utf-8", errors="replace", env=env, check=False)


@pytest.fixture
def deployment(tmp_path):
    release = tmp_path / "release with spaces"
    (release / "scripts/deploy").mkdir(parents=True)
    (release / "portable.env").write_text("COMPOSE_PROJECT_NAME=test-only\n", encoding="utf-8")
    (release / "compose.portable.yml").write_text("services: {}\n", encoding="utf-8")
    entry = release / "scripts/deploy/Mes-Portable.ps1"
    entry.write_text(
        'param([string]$Action,[string]$EnvFile,[string]$Mode)\n'
        'if (-not (Test-Path -LiteralPath $EnvFile)) { exit 5 }\n'
        'Add-Content -LiteralPath $env:MES_DESKTOP_TEST_LOG -Value ($Action + ":" + $Mode)\n'
        'if ($env:MES_DESKTOP_TEST_PROGRESS -eq "true") { [Console]::Error.WriteLine(" Container mes-rabbitmq-1 Starting ") }\n'
        'if ($env:MES_DESKTOP_TEST_FAIL -eq "true") { exit 4 }\n', encoding="utf-8-sig")
    configuration = tmp_path / "desktop.json"
    configuration.write_text(json.dumps({"deploymentDirectory": str(release), "environmentFile": "portable.env",
                                         "mode": "demo", "serverUrl": "http://127.0.0.1:15173",
                                         "apiUrl": "http://127.0.0.1:18000", "limsUrl": "http://127.0.0.1:18900",
                                         "upperComputerUrl": "http://127.0.0.1:18899"}), encoding="utf-8")
    log = tmp_path / "actions.txt"
    env = {**os.environ, "MES_DESKTOP_TEST_LOG": str(log)}
    return configuration, log, env


@pytest.mark.parametrize("action,expected", [("Start", ["Start:demo"]), ("Stop", ["Stop:demo"]),
                                             ("Restart", ["Stop:demo", "Start:demo"])])
def test_desktop_control_uses_selected_deployment_without_restore(deployment, tmp_path, action, expected):
    configuration, log, env = deployment
    result_file = tmp_path / "result.json"
    result = invoke("-Action", action, "-ConfigurationFile", configuration, "-ResultFile", result_file, env=env)
    assert result.returncode == 0, result.stderr
    assert log.read_text().splitlines() == expected
    assert json.loads(result_file.read_text(encoding="utf-8"))["status"] in {"started", "stopped", "restarted"}


def test_desktop_validation_never_runs_service_actions(deployment, tmp_path):
    configuration, log, env = deployment
    result_file = tmp_path / "result.json"
    result = invoke("-Action", "Restart", "-ValidateOnly", "-ConfigurationFile", configuration,
                    "-ResultFile", result_file, env=env)
    assert result.returncode == 0, result.stderr
    assert not log.exists()
    assert json.loads(result_file.read_text(encoding="utf-8"))["status"] == "validated"


def test_failed_stop_does_not_proceed_to_start(deployment, tmp_path):
    configuration, log, env = deployment
    env["MES_DESKTOP_TEST_FAIL"] = "true"
    result_file = tmp_path / "result.json"
    result = invoke("-Action", "Restart", "-ConfigurationFile", configuration, "-ResultFile", result_file, env=env)
    assert result.returncode != 0
    assert log.read_text().splitlines() == ["Stop:demo"]
    assert json.loads(result_file.read_text(encoding="utf-8"))["status"] == "error"


@pytest.mark.parametrize("action,expected", [("Start", ["Start:demo"]), ("Stop", ["Stop:demo"]),
    ("Restart", ["Stop:demo", "Start:demo"])])
def test_normal_docker_progress_on_stderr_does_not_fail_service_actions(deployment, tmp_path, action, expected):
    configuration, log, env = deployment
    env['MES_DESKTOP_TEST_PROGRESS'] = 'true'
    result_file = tmp_path / 'result.json'
    result = invoke('-Action', action, '-ConfigurationFile', configuration, '-ResultFile', result_file, env=env)
    assert result.returncode == 0, result.stdout + result.stderr
    assert log.read_text().splitlines() == expected
    assert json.loads(result_file.read_text(encoding='utf-8'))['status'] in {'started','stopped','restarted'}


def test_real_failure_with_stderr_progress_still_aborts_restart(deployment, tmp_path):
    configuration, log, env = deployment
    env['MES_DESKTOP_TEST_PROGRESS'] = env['MES_DESKTOP_TEST_FAIL'] = 'true'
    result_file = tmp_path / 'result.json'
    result = invoke('-Action','Restart','-ConfigurationFile',configuration,'-ResultFile',result_file,env=env)
    assert result.returncode != 0
    assert log.read_text().splitlines() == ['Stop:demo']
    message = json.loads(result_file.read_text(encoding='utf-8'))['message']
    assert 'Starting' not in message
    assert '.log' in message


@pytest.mark.parametrize('action,mode,no_open,fail,expected',[
    ('Start','demo',False,False,['http://192.0.2.40:32173/','http://127.0.0.1:18900/','http://127.0.0.1:18899/']),
    ('Restart','demo',False,False,['http://192.0.2.40:32173/','http://127.0.0.1:18900/','http://127.0.0.1:18899/']),
    ('Start','mes',False,False,['http://192.0.2.40:32173/']),
    ('Stop','demo',False,False,[]),
    ('Start','demo',True,False,[]),
    ('Start','demo',False,True,[]),
])
def test_docker_control_opens_pages_only_after_successful_start_or_restart(deployment,tmp_path,action,mode,no_open,fail,expected):
    configuration,_,env=deployment
    settings=json.loads(configuration.read_text(encoding='utf-8'))
    settings['mode']=mode
    configuration.write_text(json.dumps(settings),encoding='utf-8')
    environment=Path(settings['deploymentDirectory'])/'portable.env'
    environment.write_text('COMPOSE_PROJECT_NAME=test-only\nMES_PUBLIC_URL=http://192.0.2.40:32173\n',encoding='utf-8')
    env['MES_DESKTOP_TEST_FAIL']='true' if fail else 'false'
    opened=tmp_path/'opened.txt';env['MES_BROWSER_TEST_LOG']=str(opened)
    wrapper=tmp_path/'browser-test.ps1'
    wrapper.write_text('''param([string]$Controller,[string]$Config,[string]$Action,[string]$Result,[switch]$SkipOpen)
$ErrorActionPreference='Stop'
function global:Start-Process {
    param([string]$FilePath,[string]$ArgumentList,[string]$WindowStyle,[switch]$PassThru,[string]$RedirectStandardOutput,[string]$RedirectStandardError)
    if($FilePath -match '^https?://') { Add-Content -LiteralPath $env:MES_BROWSER_TEST_LOG -Value $FilePath; return }
    Microsoft.PowerShell.Management\\Start-Process @PSBoundParameters
}
& $Controller -Action $Action -ConfigurationFile $Config -ResultFile $Result -NoOpen:$SkipOpen
exit $LASTEXITCODE
''',encoding='utf-8-sig')
    result_file=tmp_path/'browser-result.json'
    controller=tmp_path/'tool/scripts/docker-service-control.ps1'
    controller.parent.mkdir(parents=True,exist_ok=True)
    shutil.copy2(SCRIPT,controller)
    args=[PS,'-NoProfile','-ExecutionPolicy','Bypass','-File',str(wrapper),'-Controller',str(controller),'-Config',str(configuration),
        '-Action',action,'-Result',str(result_file)]
    if no_open:args+=['-SkipOpen']
    result=subprocess.run(args,env=env,capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=20)
    assert (result.returncode!=0) is fail,result.stdout+result.stderr
    assert (opened.read_text().splitlines() if opened.exists() else [])==expected
    payload = json.loads(result_file.read_text(encoding='utf-8'))
    if action in {'Start', 'Restart'} and not fail:
        pages = ['http://192.0.2.40:32173']
        if mode == 'demo':
            pages.extend(['http://127.0.0.1:18900', 'http://127.0.0.1:18899'])
        assert payload['pageUrls'] == pages
    else:
        assert 'pageUrls' not in payload


@pytest.mark.parametrize("deployment_mode", ["docker", "windows-service"])
def test_compiled_workstation_registration_uses_entered_docker_credentials(tmp_path, deployment_mode):
    output = tmp_path / "desktop-tools"
    build = subprocess.run([PS, "-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
                            str(ROOT / "scripts/build_desktop_tools.ps1"), "-OutputDirectory", str(output)],
                           capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=30)
    assert build.returncode == 0, build.stdout + build.stderr
    if deployment_mode == "windows-service":
        configuration = output / "mes-desktop-tools.json"
        values = json.loads(configuration.read_text(encoding="utf-8-sig"))
        values["deploymentMode"] = deployment_mode
        configuration.write_text(json.dumps(values), encoding="utf-8")
    requests = []

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            requests.append((self.path, json.loads(self.rfile.read(int(self.headers["Content-Length"])))))
            payload = json.dumps({"terminalSecret": "test-terminal-secret-only"}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def log_message(self, *_args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    script = tmp_path / "registration.ps1"
    script.write_text('''param([string]$Executable,[string]$Url)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
$assembly=[Reflection.Assembly]::LoadFrom($Executable)
$flags=[Reflection.BindingFlags]'Static,NonPublic'
$fields=[Reflection.BindingFlags]'Instance,NonPublic,Public'
$type=$assembly.GetType('MESWorkstationConfigurator.LauncherRuntime',$true)
$configType=$assembly.GetType('MESWorkstationConfigurator.LauncherConfig',$true)
$config=[Activator]::CreateInstance($configType)
$config.ServerUrl=$Url
$timer=New-Object System.Windows.Forms.Timer
$timer.Interval=100
$timer.Add_Tick({
    foreach($form in [System.Windows.Forms.Application]::OpenForms) {
        if($form.GetType().Name -eq 'RegistrationLoginForm') {
            $timer.Stop()
            $form.GetType().GetField('Username',$fields).GetValue($form).Text='docker-admin'
            $form.GetType().GetField('Password',$fields).GetValue($form).Text='entered-docker-password'
            $form.DialogResult=[System.Windows.Forms.DialogResult]::OK
            break
        }
    }
})
$timer.Start()
try {
    $type.GetMethod('EnsureTerminalRegistration',$flags).Invoke($null,@($config))
    if(-not $config.ProtectedTerminalSecret) { throw 'Registration did not save a terminal secret in memory' }
} finally { $timer.Dispose() }
''', encoding="utf-8-sig")
    try:
        result = subprocess.run([PS, "-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-File", str(script),
                                 "-Executable", str(output / "MES工作台设置_Docker版.exe"),
                                 "-Url", f"http://127.0.0.1:{server.server_port}"],
                                capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=20)
        assert result.returncode == 0, result.stdout + result.stderr
        assert len(requests) == 1
        path, payload = requests[0]
        assert path == "/auth/terminal/register"
        assert payload["username"] == "docker-admin"
        assert payload["password"] == "entered-docker-password"
        assert payload["module"] == "handover"
    finally:
        server.shutdown()
        server.server_close()


@pytest.mark.parametrize("running,host_ip,expected_port", [(True, "127.0.0.1", 15173),
    (True, "0.0.0.0", 32173), (False, "0.0.0.0", 15173)])
def test_docker_about_reads_live_binding_without_changing_services(deployment, tmp_path, running, host_ip, expected_port):
    configuration, action_log, env = deployment
    environment = configuration.parent / 'network-fixture.json'
    environment.write_text(json.dumps({"running": running, "hostIp": host_ip, "port": expected_port}), encoding="utf-8")
    env["MES_NETWORK_FIXTURE"] = str(environment)
    wrapper = tmp_path / 'network.ps1'
    result_file = tmp_path / 'network-result.json'
    wrapper.write_text('''param([string]$Controller,[string]$Config,[string]$Result)
$ErrorActionPreference='Stop'
function global:docker {
    $fixture=Get-Content -Raw -LiteralPath $env:MES_NETWORK_FIXTURE | ConvertFrom-Json
    $global:LASTEXITCODE=0
    if($args -contains 'config') { return '{"services":{"web":{"ports":[{"target":8080,"published":"15173","host_ip":"127.0.0.1"}]}}}' }
    if($args -contains 'ps') { if($fixture.running){return 'fixture-web-container'}; return }
    if($args -contains 'inspect') { return (@{'8080/tcp'=@(@{HostIp=$fixture.hostIp;HostPort=[string]$fixture.port})} | ConvertTo-Json -Depth 5 -Compress) }
    throw ('Unexpected Docker mutation: '+($args -join ' '))
}
& $Controller -Action NetworkInfo -ConfigurationFile $Config -ResultFile $Result
''', encoding="utf-8-sig")
    result = subprocess.run([PS, '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', str(wrapper),
        '-Controller', str(SCRIPT), '-Config', str(configuration), '-Result', str(result_file)],
        env=env, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=15)
    assert result.returncode == 0, result.stdout + result.stderr
    data = json.loads(result_file.read_text(encoding='utf-8'))
    assert data['status'] == 'network_info'
    assert data['running'] is running
    assert data['engineAvailable'] is True
    assert data['webPort'] == expected_port
    assert data['bindings'] == ([{'hostIp': host_ip, 'port': expected_port}] if running else [])
    assert data['configuredBindings'] == [{'hostIp': '127.0.0.1', 'port': 15173}]
    assert not action_log.exists()


def test_compiled_control_center_about_and_offline_startup(tmp_path):
    output = tmp_path / 'desktop'
    result = subprocess.run([PS, '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
        str(ROOT / 'scripts/build_desktop_tools.ps1'), '-OutputDirectory', str(output)],
        capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=30)
    assert result.returncode == 0, result.stdout + result.stderr
    manifest = json.loads((output / 'desktop-tools-manifest.json').read_text(encoding='utf-8-sig'))
    assert manifest['controlCenterVersion'] == '2.7.2'
    assert (output / 'control-center-v2.7.2.md').is_file()
    result = subprocess.run([PS, '-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File',
        str(ROOT / 'tests/control_center/Test-ControlCenterAbout.ps1'),
        '-Executable', str(output / 'MES控制中心_Docker版.exe')],
        capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=15)
    assert result.returncode == 0, result.stdout + result.stderr


@pytest.mark.parametrize('native', [False, True])
def test_control_center_upgrade_keeps_connection_settings_and_other_programs(tmp_path, native):
    import hashlib
    package = tmp_path / 'update package'
    target = tmp_path / 'installed desktop'
    package.mkdir()
    target.mkdir()
    script = package / 'Update-ControlCenter.ps1'
    shutil.copy2(ROOT / 'scripts/client/Update-ControlCenter.ps1', script)
    variant = '原生版' if native else 'Docker版'
    name = f'MES控制中心_{variant}.exe'
    release = tmp_path / 'existing-release'
    (release / 'scripts/deploy').mkdir(parents=True)
    (release / 'compose.portable.yml').write_text('services: {}')
    (release / 'manifest.json').write_text('{"files":[]}', encoding='utf-8')
    configuration = b'{"deploymentMode":"windows-service","serverUrl":"http://192.0.2.9:25173"}' if native else json.dumps({'deploymentDirectory': str(release), 'serverUrl': 'http://192.0.2.9:15173'}).encode()
    (target / 'mes-desktop-tools.json').write_bytes(configuration)
    (target / name).write_bytes(b'old-control')
    (target / 'workstation.exe').write_bytes(b'preserve-workstation')
    (target / 'desktop-tools-manifest.json').write_text('{}')
    paths = [name] if native else [name, 'scripts/docker-service-control.ps1']
    inventory = []
    for relative in paths:
        path = package / variant / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b'updated-control-file')
        inventory.append({'path': f'{variant}/{relative}', 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()})
        if relative.startswith('scripts/'):
            installed = target / relative
            installed.parent.mkdir()
            installed.write_bytes(b'old-controller')
    if not native:
        for helper_name in ('Mes-Portable.ps1', 'Mes-PortableHost.ps1'):
            relative = f'部署更新/scripts/deploy/{helper_name}'
            payload = package / relative
            payload.parent.mkdir(parents=True, exist_ok=True)
            payload.write_bytes(b'new-deployment-helper')
            inventory.append({'path': relative, 'sha256': hashlib.sha256(payload.read_bytes()).hexdigest()})
        (release / 'scripts/deploy/Mes-Portable.ps1').write_bytes(b'old-deployment-helper')
    (package / 'update-manifest.json').write_text(json.dumps({'files': inventory}), encoding='utf-8')
    result = subprocess.run([PS, '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', str(script),
        '-DesktopToolsDirectory', str(target), '-NoShortcut'], capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=15)
    assert result.returncode == 0, result.stdout + result.stderr
    assert 'v2.7.2' in result.stdout
    assert '桌面已提供' not in result.stdout
    assert (target / name).read_bytes() == b'updated-control-file'
    assert (target / 'mes-desktop-tools.json').read_bytes() == configuration
    assert (target / 'workstation.exe').read_bytes() == b'preserve-workstation'
    backups = list(target.glob('control-center-backup-*'))
    assert len(backups) == 1
    assert (backups[0] / name).read_bytes() == b'old-control'
    assert (backups[0] / 'desktop-tools-manifest.json').is_file()
    if not native:
        assert json.loads((release / 'manifest.json').read_text(encoding='utf-8'))['control_center_update'] == '2.7.2'
        assert (release / 'scripts/deploy/Mes-Portable.ps1').read_bytes() == b'new-deployment-helper'
        assert (backups[0] / 'release/scripts/deploy/Mes-Portable.ps1').read_bytes() == b'old-deployment-helper'


def test_control_center_upgrade_rejects_corrupt_file_before_replacing_existing_executable(tmp_path):
    package = tmp_path / 'update'
    source = package / 'Docker版'
    source.mkdir(parents=True)
    target = tmp_path / 'installed'
    target.mkdir()
    shutil.copy2(ROOT / 'scripts/client/Update-ControlCenter.ps1', package / 'Update-ControlCenter.ps1')
    release = tmp_path / 'release'
    release.mkdir()
    (release / 'compose.portable.yml').write_text('services: {}')
    (target / 'mes-desktop-tools.json').write_text(json.dumps({'deploymentDirectory': str(release)}))
    name = 'MES控制中心_Docker版.exe'
    (target / name).write_bytes(b'preserve-old-file')
    (source / name).write_bytes(b'corrupt-new-file')
    (package / 'update-manifest.json').write_text(json.dumps({'files': [{'path': f'Docker版/{name}', 'sha256': '0' * 64}]}), encoding='utf-8')
    result = subprocess.run([PS, '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', str(package / 'Update-ControlCenter.ps1'),
        '-DesktopToolsDirectory', str(target)], capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=15)
    assert result.returncode != 0
    assert (target / name).read_bytes() == b'preserve-old-file'
    assert not list(target.glob('control-center-backup-*'))


def test_control_center_update_package_contains_v272_binaries_and_valid_inventory(tmp_path):
    import hashlib
    output = tmp_path / 'update package'
    result = subprocess.run([PS, '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
        str(ROOT / 'scripts/build_control_center_update.ps1'), '-OutputDirectory', str(output)],
        capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=45)
    assert result.returncode == 0, result.stdout + result.stderr
    manifest = json.loads((output / 'update-manifest.json').read_text(encoding='utf-8'))
    assert manifest['format'] == 'mes-control-center-update'
    assert manifest['version'] == '2.7.2'
    names = {entry['path'] for entry in manifest['files']}
    assert {'Docker版/MES控制中心_Docker版.exe', '原生版/MES控制中心_原生版.exe',
            'Docker版/scripts/docker-service-control.ps1', 'Update-ControlCenter.ps1', '使用说明.md'} <= names
    for entry in manifest['files']:
        path = output / entry['path']
        assert path.stat().st_size == entry['bytes']
        assert hashlib.sha256(path.read_bytes()).hexdigest() == entry['sha256']
    assert (output / '使用说明.md').read_text(encoding='utf-8').startswith('# MES 控制中心 v2.7.2')
    probe = subprocess.run([PS, '-NoProfile', '-Command',
        "Get-ChildItem -LiteralPath $env:MES_VERSION_PACKAGE -Filter '*.exe' -Recurse | "
        "ForEach-Object { $_.VersionInfo.FileVersion } | ConvertTo-Json -Compress"],
        env={**os.environ, 'MES_VERSION_PACKAGE': str(output)},
        capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=10)
    assert probe.returncode == 0, probe.stdout + probe.stderr
    assert json.loads(probe.stdout) == ['2.7.2.0', '2.7.2.0']
