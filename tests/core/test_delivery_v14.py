"""v1.4 lifecycle boundaries against isolated client-only installation fixtures."""
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import zipfile

import pytest

ROOT=Path(__file__).resolve().parents[2]
PS=shutil.which('powershell.exe')
pytestmark=pytest.mark.skipif(not PS,reason='Windows installer required')


def write(path,value):
    path.parent.mkdir(parents=True,exist_ok=True);path.write_text(json.dumps(value,ensure_ascii=False),encoding='utf-8')


def run(script,*args):
    return subprocess.run([PS,'-NoProfile','-ExecutionPolicy','Bypass','-File',str(script),*map(str,args)],capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=40)


@pytest.fixture
def package(tmp_path):
    package=tmp_path/'isolated-package';package.mkdir()
    for source,target in [('Install-DeliveryV14.ps1','Install-Delivery.ps1'),('Uninstall-Delivery.ps1','Uninstall-Delivery.ps1'),('Mes-Installation.ps1','Mes-Installation.ps1')]:
        shutil.copy2(ROOT/'deploy/portable'/source,package/target)
    write(package/'workstations.json',[dict(folder='盐雾试验室',module='laboratory',labCode='LAB_SALT',labName='盐雾试验室')])
    components=[]
    for id,folder,module,lab,relative in [('central','中控管理','central','','desktop-tools/central-client'),('LAB_SALT','盐雾试验室','laboratory','LAB_SALT','workstation-payload/盐雾试验室')]:
        source=package/relative;source.mkdir(parents=True);exe='MES中控管理.exe' if module=='central' else 'MES盐雾试验室.exe'
        write(source/'mes-client.json',dict(module=module,serverUrl='http://old:15173',labCode=lab,labName='' if not lab else folder,simulatorsEnabled=True))
        (source/exe).write_bytes(b'not executable; fixture only')
        (source/'MES终端接入.exe').write_bytes(b'fixture enrollment')
        files=[dict(path=p.name,bytes=p.stat().st_size,sha256=hashlib.sha256(p.read_bytes()).hexdigest()) for p in source.iterdir()]
        write(source/'client-manifest.json',dict(module=module,version='1.8.0',labCode=lab,labName='' if not lab else folder,executable=exe,files=files))
        all_files=[dict(path=p.name,bytes=p.stat().st_size,sha256=hashlib.sha256(p.read_bytes()).hexdigest(),mutable=p.name in ['mes-client.json','client-manifest.json']) for p in source.iterdir()]
        archive=package/'component-cache/components'/(id+'.zip');archive.parent.mkdir(parents=True,exist_ok=True)
        with zipfile.ZipFile(archive,'w') as data:
            for p in source.iterdir():data.write(p,p.name)
        components.append(dict(id=id,name=folder,kind='central' if module=='central' else 'workstation',directory='中控管理' if module=='central' else '工位终端/'+folder,
                               archive=archive.name,sha256=hashlib.sha256(archive.read_bytes()).hexdigest(),executable=exe,version='1.8.0',module=module,labCode=lab,labName='' if not lab else folder,files=all_files))
    write(package/'component-cache/components/catalog.json',dict(format='mes-component-library',format_version=1,controlCenterVersion='2.10.0',components=components))
    write(package/'component-cache/layout.json',dict(central='中控管理'))
    for name in ['MES控制中心.exe','MES中控管理.exe','卸载5826信息化系统.exe']:
        file=package/'entries'/name;file.parent.mkdir(exist_ok=True);file.write_bytes(b'fixture desktop entry')
    (package/'先读我.md').write_text('fixture instructions',encoding='utf-8')
    files=[dict(path=p.relative_to(package).as_posix(),bytes=p.stat().st_size,sha256=hashlib.sha256(p.read_bytes()).hexdigest()) for p in package.rglob('*') if p.is_file()]
    write(package/'delivery-manifest.json',dict(format='mes-portable-click-deployment',format_version=1,version='2026.11.12-v1.4',releaseDirectory='release-test',backupDirectory='data-test',files=files))
    return package


def install(package,target,desktop,*extra):
    return run(package/'Install-Delivery.ps1','-PackageRoot',package,'-InstallDirectory',target,'-Role','client','-ServerUrl','http://192.0.2.25:35174',
               '-DesktopDirectory',desktop,'-SkipRuntimeInstallation',*extra)


def uninstall(target):
    return run(ROOT/'deploy/portable/Uninstall-Delivery.ps1','-InstallDirectory',target,'-Mode','Clean','-ConfirmRemoval')


def test_client_install_has_only_exe_entry_and_clean_uninstall_allows_same_path(package,tmp_path):
    target=tmp_path/'安装路径 with spaces';desktop=tmp_path/'desktop';outside=tmp_path/'unrelated.txt';outside.write_text('keep',encoding='utf-8')
    try:
        result=install(package,target,desktop,'-CentralClient','-Workstations','LAB_SALT')
        assert result.returncode==0,result.stdout+result.stderr
        assert sorted(p.name for p in desktop.iterdir())==['MES中控管理.exe']
        assert not list(desktop.glob('*.lnk')) and not list(desktop.glob('*.config'))
        assert (target/'工位终端/盐雾试验室/MES终端接入.exe').is_file()
        marker=json.loads((target/'.mes/installation.json').read_text(encoding='utf-8'))
        assert marker['phase']=='complete' and marker['installationId']
        progress=(target/'.mes/logs/install-progress.log').read_text(encoding='utf-8').splitlines()
        assert progress[-1].startswith('MES_PROGRESS|7|')
        assert not any(line.startswith('MES_PROGRESS|7|') for line in progress[:-1])
        assert json.loads((target/'中控管理/mes-client.json').read_text(encoding='utf-8'))['simulatorsEnabled'] is False
        result=uninstall(target);assert result.returncode==0,result.stdout+result.stderr
        assert not target.exists() and not list(desktop.iterdir()) and outside.read_text(encoding='utf-8')=='keep'
        result=install(package,target,desktop,'-CentralClient');assert result.returncode==0,result.stdout+result.stderr
    finally:
        if (target/'.mes/installation.json').exists():uninstall(target)


def test_invalid_selection_makes_no_runtime_or_desktop_changes(package,tmp_path):
    target=tmp_path/'must-not-exist';result=install(package,target,tmp_path/'desktop','-Workstations','UNKNOWN')
    assert result.returncode!=0 and not target.exists()


def test_uninstaller_rejects_changed_root_before_deleting_anything(tmp_path):
    target=tmp_path/'wrong-root';write(target/'.mes/installation.json',dict(format='mes-installation',root=str(tmp_path),installationId='a'*32,project='mes-5826-'+'a'*32))
    sentinel=target/'keep.txt';sentinel.write_text('keep',encoding='utf-8')
    result=uninstall(target);assert result.returncode!=0 and sentinel.exists()


def test_failure_never_reports_final_progress(package,tmp_path):
    (package/'entries/MES中控管理.exe').write_bytes(b'corrupt')
    target=tmp_path/'failed';result=install(package,target,tmp_path/'desktop','-CentralClient')
    assert result.returncode!=0
    assert 'MES_PROGRESS|7|' not in result.stdout


def test_uninstall_handles_missing_library_and_invalid_client_config(package,tmp_path):
    target=tmp_path/'damaged-install';desktop=tmp_path/'desktop'
    result=install(package,target,desktop,'-CentralClient');assert result.returncode==0,result.stdout+result.stderr
    (target/'中控管理/mes-client.json').write_text('{broken',encoding='utf-8')
    (target/'.mes/components/catalog.json').unlink()
    result=uninstall(target)
    assert result.returncode==0,result.stdout+result.stderr
    assert not target.exists() and not list(desktop.iterdir())


def test_one_workstation_only_creates_no_desktop_entry_and_keeps_array_manifest(package,tmp_path):
    target=tmp_path/'one-station';desktop=tmp_path/'desktop'
    try:
        result=install(package,target,desktop,'-Workstations','LAB_SALT');assert result.returncode==0,result.stdout+result.stderr
        assert not list(desktop.iterdir())
        assert json.loads((target/'.mes/installed-components.json').read_text(encoding='utf-8'))==['LAB_SALT']
        assert not (target/'MES控制中心.exe').exists()
    finally:
        if (target/'.mes/installation.json').exists():uninstall(target)
