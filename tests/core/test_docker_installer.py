import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess

import pytest

ROOT = Path(__file__).resolve().parents[2]
PS = shutil.which("powershell.exe")
spec = importlib.util.spec_from_file_location("docker_installer", ROOT / "scripts/build_docker_installer.py")
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")


@pytest.fixture
def delivery(tmp_path):
    package = tmp_path / "安装资源 with spaces"
    package.mkdir()
    catalog = [dict(folder="盐雾试验室", module="laboratory", labCode="LAB_SALT", labName="盐雾试验室"),
               dict(folder="暂存间系统", module="staging", labCode="", labName="")]
    write_json(package / "workstations.json", catalog)
    shutil.copy2(ROOT / "deploy/portable/Install-Delivery.ps1", package / "Install-Delivery.ps1")
    shutil.copy2(ROOT / "deploy/portable/Resume-Install.ps1", package / "Resume-Install.ps1")
    for station in catalog + [dict(folder="central-client", module="central", labCode="")]:
        central = station["module"] == "central"
        folder = package / ("desktop-tools" if central else "workstation-payload") / station["folder"]
        executable = "MES中控管理.exe" if central else "MES" + station["folder"] + ".exe"
        write_json(folder / "mes-client.json", dict(serverUrl="http://old:15173", module=station["module"],
                                                  labCode=station["labCode"], simulatorsEnabled=central))
        (folder / executable).write_bytes(b"fixture executable")
        files = [dict(path=path.name, bytes=path.stat().st_size, sha256=hashlib.sha256(path.read_bytes()).hexdigest())
                 for path in folder.iterdir()]
        write_json(folder / "client-manifest.json", dict(executable=executable, files=files))
    prerequisites = package / "prerequisites"
    prerequisites.mkdir()
    (prerequisites / "MicrosoftEdgeWebView2RuntimeInstallerX64.exe").write_bytes(b"never execute this fixture")
    files = [dict(path=path.relative_to(package).as_posix(), bytes=path.stat().st_size,
                  sha256=hashlib.sha256(path.read_bytes()).hexdigest()) for path in package.rglob("*") if path.is_file()]
    manifest = dict(format="mes-portable-click-deployment", format_version=1, version="2026.11.10-v1.2",
                    displayName=installer.NAME, releaseDirectory="release-test", backupDirectory="data-backup-test", files=files)
    write_json(package / "delivery-manifest.json", manifest)
    return package, catalog, manifest


def invoke(package, target, desktop, *arguments):
    if not PS:
        pytest.skip("Windows PowerShell required")
    return subprocess.run([PS, "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(package / "Install-Delivery.ps1"),
                           "-PackageRoot", str(package), "-InstallDirectory", str(target), "-Role", "client",
                           "-ServerUrl", "http://192.0.2.25:25173", "-DesktopDirectory", str(desktop),
                           "-SkipRuntimeInstallation", *arguments], capture_output=True, text=True, encoding="utf-8",
                          errors="replace", timeout=20)


def test_selected_workstations_install_to_independent_chinese_folders(delivery, tmp_path):
    package, _, _ = delivery
    target, desktop = tmp_path / "现场安装 with spaces", tmp_path / "fixture desktop"
    result = invoke(package, target, desktop, "-Workstations", "LAB_SALT", "-CentralClient")
    assert result.returncode == 0, result.stdout + result.stderr
    room = target / "工位客户端/盐雾试验室"
    assert (room / "MES盐雾试验室.exe").exists()
    assert not (target / "工位客户端/暂存间系统").exists()
    config = json.loads((room / "mes-client.json").read_text(encoding="utf-8"))
    assert config["serverUrl"] == "http://192.0.2.25:25173"
    central = target / "管理端/central-client"
    assert (central / "MES中控管理.exe").exists()
    assert json.loads((central / "mes-client.json").read_text(encoding="utf-8"))["simulatorsEnabled"] is False
    assert len(list(desktop.glob("*.lnk"))) == 2
    for folder in (room, central):
        for entry in json.loads((folder / "client-manifest.json").read_text(encoding="utf-8"))["files"]:
            assert hashlib.sha256((folder / entry["path"]).read_bytes()).hexdigest() == entry["sha256"]
    assert invoke(package, target, desktop, "-Workstations", "LAB_SALT").returncode != 0
    assert config == json.loads((room / "mes-client.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("arguments", [("-Workstations", "UNKNOWN"), ("-Workstations", "LAB_SALT,LAB_SALT"), ()])
def test_invalid_selections_make_no_target_changes(delivery, tmp_path, arguments):
    package, _, _ = delivery
    target = tmp_path / "must not exist"
    result = invoke(package, target, tmp_path / "desktop", *arguments)
    assert result.returncode != 0
    assert not target.exists()


def test_selected_file_corruption_is_rejected_before_copy(delivery, tmp_path):
    package, _, _ = delivery
    (package / "workstation-payload/盐雾试验室/mes-client.json").write_text("corrupt")
    target = tmp_path / "must not exist"
    result = invoke(package, target, tmp_path / "desktop", "-Workstations", "LAB_SALT")
    assert result.returncode != 0
    assert not target.exists()


def test_unselected_payload_may_be_omitted_by_installer(delivery, tmp_path):
    package, _, _ = delivery
    shutil.rmtree(package / "workstation-payload/暂存间系统")
    result = invoke(package, tmp_path / "install", tmp_path / "desktop", "-Workstations", "LAB_SALT", "-ValidateOnly")
    assert result.returncode == 0, result.stdout + result.stderr
    assert not (tmp_path / "install").exists()


def test_manifest_path_escape_is_rejected(delivery, tmp_path):
    package, _, manifest = delivery
    manifest["files"][0]["path"] = "../outside"
    write_json(package / "delivery-manifest.json", manifest)
    with pytest.raises(ValueError):
        installer.verify_delivery(package)


def test_installer_generated_components_match_catalog(delivery, tmp_path):
    _, catalog, _ = delivery
    components, files, selection = installer.includes(catalog, tmp_path)
    assert 'workstations\\lab_salt' in components.read_text(encoding="utf-8-sig")
    assert 'workstation-payload\\盐雾试验室' in files.read_text(encoding="utf-8-sig")
    assert "Result := Result + 'LAB_SALT'" in selection.read_text(encoding="utf-8-sig")


def test_failure_has_readable_log_and_completed_client_can_resume(delivery, tmp_path):
    package, _, _ = delivery
    target, desktop = tmp_path / '续装目标 with spaces', tmp_path / 'icons'
    rejected = invoke(package, target, desktop, '-Workstations', 'UNKNOWN')
    assert rejected.returncode != 0
    error = (package / '.local/logs/last-install-error.txt').read_text(encoding='utf-8-sig')
    assert '未知工位' in error and '安装步骤' in error and '日志' in error
    result = invoke(package, target, desktop, '-Workstations', 'LAB_SALT', '-CentralClient')
    assert result.returncode == 0, result.stdout + result.stderr
    assert (target / '继续完成安装.cmd').exists()
    before = (target / '管理端/central-client/mes-client.json').read_bytes()
    resumed = invoke(package, target, desktop, '-Workstations', 'LAB_SALT', '-CentralClient', '-Resume')
    assert resumed.returncode == 0, resumed.stdout + resumed.stderr
    assert (target / '管理端/central-client/mes-client.json').read_bytes() == before
    assert not (package / '.local/logs/last-install-error.txt').exists()


def test_resume_rejects_changed_server_without_overwriting_configuration(delivery, tmp_path):
    package, _, _ = delivery
    target, desktop = tmp_path / 'target', tmp_path / 'icons'
    result = invoke(package, target, desktop, '-Workstations', 'LAB_SALT')
    assert result.returncode == 0, result.stdout + result.stderr
    before = (target / '工位客户端/盐雾试验室/mes-client.json').read_bytes()
    options = json.loads((target / '安装选项.json').read_text(encoding='utf-8'))
    options['serverUrl'] = 'http://other.example:15173'
    write_json(target / '安装选项.json', options)
    resumed = invoke(package, target, desktop, '-Workstations', 'LAB_SALT', '-Resume')
    assert resumed.returncode != 0
    assert (target / '工位客户端/盐雾试验室/mes-client.json').read_bytes() == before


def test_host_retry_after_engine_and_deployment_failures_preserves_credentials(delivery, tmp_path):
    if not PS:
        pytest.skip('Windows PowerShell required')
    package, _, manifest = delivery
    scripts = package / 'release-test/scripts/deploy'
    scripts.mkdir(parents=True)
    helper = (ROOT / 'scripts/deploy/Mes-PortableHost.ps1').read_text(encoding='utf-8-sig')
    helper += '''
function Get-MesLanInterfaces { @([pscustomobject]@{Address='192.0.2.25'}) }
function Wait-MesDockerEngine { if(-not (Test-Path (Join-Path $PSScriptRoot 'engine-ready.flag'))){throw 'intentional-engine-unavailable'} }
function Set-MesWebFirewall { param($Project,$Port) }
'''
    (scripts / 'Mes-PortableHost.ps1').write_text(helper, encoding='utf-8-sig')
    (scripts / 'Mes-Portable.ps1').write_text('''param($Action,$EnvFile,$ReleaseVersion)
[IO.Directory]::CreateDirectory((Split-Path -Parent $EnvFile))|Out-Null
[IO.File]::WriteAllText($EnvFile,"MYSQL_PASSWORD=preserve-me`nMES_RELEASE_VERSION=$ReleaseVersion`n")
Add-Content -LiteralPath (Join-Path $PSScriptRoot 'initialized.log') -Value 'initialized'
''', encoding='utf-8-sig')
    (package / 'Deploy-MES.ps1').write_text('''param($Action,$EnvironmentFile,$DesktopToolsDirectory,[switch]$NoOpen,[switch]$SelectedComponentsOnly,$DesktopDirectory)
if(-not (Test-Path (Join-Path $PSScriptRoot 'deployment-ready.flag'))){
 [IO.File]::WriteAllText((Join-Path $PSScriptRoot '.local/logs/deploy-fixture.log'),'DEPLOYMENT FAILED: intentional-deployment-failure')
 exit 1
}
[IO.Directory]::CreateDirectory($DesktopToolsDirectory)|Out-Null
if(-not (Test-Path (Join-Path $DesktopToolsDirectory 'central-client'))){Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'desktop-tools/central-client') -Destination (Join-Path $DesktopToolsDirectory 'central-client') -Recurse}
exit 0
''', encoding='utf-8-sig')
    manifest['files'] = [dict(path=p.relative_to(package).as_posix(), bytes=p.stat().st_size,
                              sha256=hashlib.sha256(p.read_bytes()).hexdigest())
                         for p in package.rglob('*') if p.is_file() and p.name != 'delivery-manifest.json']
    write_json(package / 'delivery-manifest.json', manifest)
    target = tmp_path / '主机自定义目录 with spaces'
    arguments = [PS, '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', str(package / 'Install-Delivery.ps1'),
                 '-PackageRoot', str(package), '-InstallDirectory', str(target), '-Role', 'server',
                 '-ServerUrl', 'http://192.0.2.25:25173', '-Workstations', 'LAB_SALT', '-SkipRuntimeInstallation',
                 '-DesktopDirectory', str(tmp_path / 'icons')]

    def execute(resume=False):
        return subprocess.run(arguments + (['-Resume'] if resume else []), capture_output=True, text=True,
                              encoding='utf-8', errors='replace', timeout=20)

    first = execute()
    assert first.returncode != 0
    assert (target / '继续完成安装.cmd').exists()
    assert 'intentional-engine-unavailable' in (package / '.local/logs/last-install-error.txt').read_text(encoding='utf-8-sig')
    environment = package / 'release-test/.tmp/portable.env'
    assert not environment.exists()
    (scripts / 'engine-ready.flag').touch()
    second = execute(True)
    assert second.returncode != 0
    assert 'intentional-deployment-failure' in (package / '.local/logs/last-install-error.txt').read_text(encoding='utf-8-sig')
    before = environment.read_bytes()
    (package / 'deployment-ready.flag').touch()
    third = execute(True)
    assert third.returncode == 0, third.stdout + third.stderr
    assert environment.read_bytes() == before
    assert len((scripts / 'initialized.log').read_text().splitlines()) == 1
    assert (target / '管理端/central-client/MES中控管理.exe').exists()
    assert (target / '工位客户端/盐雾试验室/MES盐雾试验室.exe').exists()
    assert (target / '安装记录.json').exists()
