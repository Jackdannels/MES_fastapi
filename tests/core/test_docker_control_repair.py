import hashlib
import json
from pathlib import Path
import shutil
import subprocess

import pytest

ROOT=Path(__file__).resolve().parents[2]
PS=shutil.which('powershell.exe')
pytestmark=pytest.mark.skipif(not PS,reason='Windows PowerShell required')


def fixture(tmp_path):
    delivery=tmp_path/'MES delivery'
    payload=delivery/'desktop-tools/scripts/docker-service-control.ps1'
    runtime=delivery/'.local/desktop-tools/scripts/docker-service-control.ps1'
    for path in (payload,runtime):
        path.parent.mkdir(parents=True)
        path.write_text('old controller',encoding='utf-8')
    settings=runtime.parent.parent/'mes-desktop-tools.json'
    settings.write_text('{"serverUrl":"http://192.0.2.5:15173","deploymentDirectory":"D:/MES"}',encoding='utf-8')
    (delivery/'Deploy-MES.ps1').touch()
    tools=delivery/'desktop-tools/desktop-tools-manifest.json'
    tools.write_text(json.dumps({'files':[{'path':'scripts/docker-service-control.ps1','bytes':14,'sha256':'old'}]}),encoding='utf-8')
    manifest={'format':'mes-portable-click-deployment','version':'2026.10.21-r1','desktopDirectory':'desktop-tools',
        'files':[{'path':str(path.relative_to(delivery)).replace('\\','/'),'bytes':path.stat().st_size,'sha256':hashlib.sha256(path.read_bytes()).hexdigest()} for path in (payload,tools)]}
    (delivery/'delivery-manifest.json').write_text(json.dumps(manifest),encoding='utf-8')
    patch=tmp_path/'repair';patch.mkdir()
    shutil.copy2(ROOT/'scripts/client/Repair-DockerControl.ps1',patch/'Repair-DockerControl.ps1')
    (patch/'docker-service-control.ps1').write_bytes(b'fixed-controller')
    (patch/'repair-manifest.json').write_text(json.dumps({'controllerSha256':hashlib.sha256(b'fixed-controller').hexdigest()}),encoding='utf-8')
    return delivery,patch,payload,runtime,settings


def test_repair_updates_both_controllers_and_checksums_preserving_configuration(tmp_path):
    delivery,patch,payload,runtime,settings=fixture(tmp_path)
    before=settings.read_bytes()
    result=subprocess.run([PS,'-NoProfile','-ExecutionPolicy','Bypass','-File',str(patch/'Repair-DockerControl.ps1'),
        '-DeploymentDirectory',str(delivery)],capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=20)
    assert result.returncode==0,result.stdout+result.stderr
    assert payload.read_bytes()==runtime.read_bytes()==b'fixed-controller'
    assert settings.read_bytes()==before
    manifest=json.loads((delivery/'delivery-manifest.json').read_text(encoding='utf-8'))
    for entry in manifest['files']:
        assert hashlib.sha256((delivery/entry['path']).read_bytes()).hexdigest()==entry['sha256']
    backups=list((delivery/'.local').glob('control-repair-*'))
    assert len(backups)==1
    assert (backups[0]/'controller-0.ps1').read_text()=='old controller'


def test_corrupt_patch_is_rejected_before_existing_controllers_are_replaced(tmp_path):
    delivery,patch,payload,runtime,_=fixture(tmp_path)
    (patch/'docker-service-control.ps1').write_bytes(b'corrupt')
    result=subprocess.run([PS,'-NoProfile','-ExecutionPolicy','Bypass','-File',str(patch/'Repair-DockerControl.ps1'),
        '-DeploymentDirectory',str(delivery)],capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=20)
    assert result.returncode!=0
    assert payload.read_text()==runtime.read_text()=='old controller'
    assert not list((delivery/'.local').glob('control-repair-*'))


def test_repair_can_update_browser_opening_deployer_and_its_inventory(tmp_path):
    delivery,patch,_,_,settings=fixture(tmp_path)
    config=settings.read_bytes()
    deployer=patch/'Deploy-MES.ps1';deployer.write_bytes(b'updated-deployer-browser-launch')
    fix=json.loads((patch/'repair-manifest.json').read_text())
    fix['deployerSha256']=hashlib.sha256(deployer.read_bytes()).hexdigest();fix['revision']='2026.10.21-browser-fix2'
    (patch/'repair-manifest.json').write_text(json.dumps(fix),encoding='utf-8')
    manifest=json.loads((delivery/'delivery-manifest.json').read_text())
    manifest['files'].append({'path':'Deploy-MES.ps1','bytes':0,'sha256':hashlib.sha256(b'').hexdigest()})
    (delivery/'delivery-manifest.json').write_text(json.dumps(manifest),encoding='utf-8')
    result=subprocess.run([PS,'-NoProfile','-ExecutionPolicy','Bypass','-File',str(patch/'Repair-DockerControl.ps1'),
        '-DeploymentDirectory',str(delivery)],capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=20)
    assert result.returncode==0,result.stdout+result.stderr
    assert (delivery/'Deploy-MES.ps1').read_bytes()==deployer.read_bytes()
    assert settings.read_bytes()==config
    updated=json.loads((delivery/'delivery-manifest.json').read_text(encoding='utf-8'))
    for entry in updated['files']:
        assert hashlib.sha256((delivery/entry['path']).read_bytes()).hexdigest()==entry['sha256']
