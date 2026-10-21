import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess

import pytest

ROOT=Path(__file__).resolve().parents[2]
PS=shutil.which('powershell.exe')
spec=importlib.util.spec_from_file_location('portable_delivery',ROOT/'scripts/build_portable_delivery.py')
builder=importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)
pytestmark=pytest.mark.skipif(not PS,reason='Windows PowerShell required')


def make_delivery(tmp_path):
    delivery=tmp_path/'delivery with spaces'
    release=delivery/'release-test'
    (release/'scripts/deploy').mkdir(parents=True)
    (release/'scripts/deploy/Mes-Portable.ps1').write_text('fixture')
    shutil.copy2(ROOT/'scripts/deploy/Mes-PortableHost.ps1',release/'scripts/deploy/Mes-PortableHost.ps1')
    backup=delivery/'data-backup-test'
    backup.mkdir()
    (backup/'data-manifest.json').write_text('{"files":[]}')
    (delivery/'desktop-tools').mkdir()
    shutil.copy2(ROOT/'deploy/portable/Deploy-MES.ps1',delivery/'Deploy-MES.ps1')
    manifest=builder.finalize(delivery,'test')
    assert manifest['controlCenterVersion'] == '2.7.0'
    return delivery,release,manifest


def run(delivery,action,*extra):
    return subprocess.run([PS,'-NoProfile','-ExecutionPolicy','Bypass','-File',str(delivery/'Deploy-MES.ps1'),
        '-Action',action,'-NoOpen',*map(str,extra)],capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=20)


def test_click_delivery_verification_checks_integrity_without_docker(tmp_path):
    delivery,release,_=make_delivery(tmp_path)
    assert run(delivery,'Verify').returncode==0
    (release/'scripts/deploy/Mes-Portable.ps1').write_text('changed')
    result=run(delivery,'Verify')
    assert result.returncode!=0
    assert 'checksum mismatch' in result.stdout


def test_click_delivery_rejects_manifest_path_escape(tmp_path):
    delivery,_,manifest=make_delivery(tmp_path)
    manifest['files'][0]['path']='../outside.txt'
    (delivery/'delivery-manifest.json').write_text(json.dumps(manifest))
    result=run(delivery,'Verify')
    assert result.returncode!=0
    assert 'Invalid delivery-relative path' in result.stdout


def test_recreate_desktop_refuses_uninitialized_machine(tmp_path):
    delivery,_,_=make_delivery(tmp_path)
    result=run(delivery,'Desktop')
    assert result.returncode!=0
    assert '01-Deploy.cmd first' in result.stdout


def test_delivery_inventory_excludes_target_state_and_passwords(tmp_path):
    delivery,release,_=make_delivery(tmp_path)
    (release/'.tmp').mkdir()
    (release/'.tmp/portable.env').write_text('SECRET=do-not-export')
    (delivery/'.local').mkdir(exist_ok=True)
    (delivery/'.local/MES-connection.txt').write_text('private credentials')
    manifest=builder.finalize(delivery,'test')
    assert not any('.tmp/' in row['path'] or '.local/' in row['path'] for row in manifest['files'])


def test_install_state_guards_and_automatic_shortcuts_are_present():
    source=(ROOT/'deploy/portable/Deploy-MES.ps1').read_text(encoding='utf-8-sig')
    assert "$state.phase -eq 'restoring'" in source
    assert 'one-click installer will not overwrite' in source
    assert "'-Action',$Step,'-EnvFile',$environment" in source
    assert "'MES控制中心_v2.7_Docker版'" in source
    assert 'MES工作台设置_Docker版' in source and 'MES终端管理_Docker版' in source
