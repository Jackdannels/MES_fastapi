"""Native component repair/UI regressions use isolated fake runtime payloads."""
import hashlib
import json
from pathlib import Path
import shutil
import subprocess

import pytest
from scripts.build_component_library import build

ROOT=Path(__file__).resolve().parents[2]
PS=shutil.which('powershell.exe')
pytestmark=pytest.mark.skipif(not PS,reason='Windows control center required')


def powershell(script,*args):
    result=subprocess.run([PS,'-NoProfile','-STA','-ExecutionPolicy','Bypass','-File',str(ROOT/script),*map(str,args)],
                          capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=60)
    assert result.returncode == 0,result.stdout+result.stderr
    return result


@pytest.fixture(scope='module')
def component_bundle(tmp_path_factory):
    bundle=tmp_path_factory.mktemp('control-center-integrity')/'bundle'
    controller=bundle/'MES控制中心_v2.10.0.exe'
    powershell('scripts/build_control_center.ps1','-OutputPath',controller,'-IconPath',bundle/'controller.ico','-NoAdminManifest')
    catalog=json.loads((ROOT/'tools/desktop-client/workstations.json').read_text(encoding='utf-8'))
    entries=[dict(folder='中控管理',module='central',labCode='',labName='',executable='MES中控管理.exe'),
             dict(folder='测试终端',module='test',labCode='',labName='',executable='MES综合测试终端.exe')]
    entries += [dict(row,folder='工位终端/'+row['folder'],executable='MES'+row['folder']+'.exe') for row in catalog]
    for row in entries:
        folder=bundle/row['folder'];folder.mkdir(parents=True)
        (folder/row['executable']).write_bytes(b'fixture only; never executed')
        (folder/'WebView2Loader.dll').write_bytes(b'fixture runtime')
        (folder/'mes-client.json').write_text(json.dumps(dict(serverUrl='http://127.0.0.1:5173',module=row['module'],labCode=row['labCode'],labName=row['labName'])),encoding='utf-8')
        inventory=[dict(path=file.name,bytes=file.stat().st_size,sha256=hashlib.sha256(file.read_bytes()).hexdigest()) for file in folder.iterdir()]
        (folder/'client-manifest.json').write_text(json.dumps(dict(version='1.8.0',module=row['module'],labCode=row['labCode'],labName=row['labName'],executable=row['executable'],files=inventory)),encoding='utf-8')
    build(bundle,bundle,controller)
    return bundle,controller


def test_component_repair_preserves_settings_credentials_and_root_boundaries(component_bundle,tmp_path):
    bundle,controller=component_bundle
    powershell('tests/control_center/Test-ComponentIntegrity.ps1','-Executable',controller,'-Bundle',bundle,'-TestDirectory',tmp_path/'repair')


def test_integrity_ui_repairs_only_checked_component_and_releases_busy_state(component_bundle,tmp_path):
    bundle,controller=component_bundle
    powershell('tests/control_center/Test-IntegrityUi.ps1','-Executable',controller,'-Bundle',bundle,'-TestDirectory',tmp_path/'ui')


def test_integrity_page_scales_in_both_themes(component_bundle,tmp_path):
    _,controller=component_bundle
    powershell('tests/control_center/Test-IntegrityLayout.ps1','-Executable',controller,'-PreviewDirectory',tmp_path/'previews')


def test_controller_recovery_restores_exe_without_service_changes(component_bundle,tmp_path):
    bundle,controller=component_bundle
    target=tmp_path/'recovery';cache=target/'.mes/components';cache.mkdir(parents=True)
    for name in ['catalog.json','controller.zip']:shutil.copy2(bundle/'.mes/components'/name,cache/name)
    (target/'.env').write_text('preserve me',encoding='utf-8')
    powershell('scripts/client/Restore-ControlCenter.ps1','-Root',target)
    assert (target/controller.name).read_bytes()==controller.read_bytes()
    assert (target/'.env').read_text(encoding='utf-8')=='preserve me'
