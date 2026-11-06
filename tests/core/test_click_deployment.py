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
    assert manifest['controlCenterVersion'] == '2.7.2'
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
    assert "'MES控制中心_v2.7.2_Docker版'" in source
    assert 'MES工作台设置_Docker版' in source and 'MES终端管理_Docker版' in source


def test_installer_opens_all_three_pages_through_managed_controller(tmp_path):
    script=tmp_path/'pages.ps1'
    script.write_text('''param([string]$Source)
$ErrorActionPreference='Stop'
$tree=[Management.Automation.Language.Parser]::ParseFile($Source,[ref]$null,[ref]$null)
$function=$tree.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Open-DeploymentPages'},$true)
Invoke-Expression $function.Extent.Text
$runtime='C:\\MES local'
function Start-Process {
    param($FilePath,$ArgumentList,$WindowStyle,[switch]$PassThru)
    if(-not $FilePath.EndsWith('MES控制中心_Docker版.exe')){throw 'Must use managed desktop browser session'}
    $script:captured=$ArgumentList
    $process=[pscustomobject]@{Handle=1;ExitCode=0}
    $process|Add-Member ScriptMethod WaitForExit {}
    $process|Add-Member ScriptMethod Refresh {}
    return $process
}
Open-DeploymentPages ([pscustomobject]@{limsUrl='http://127.0.0.1:28900';upperComputerUrl='http://127.0.0.1:28899'}) 'http://192.0.2.5:25173'
if($script:captured -ne '--open-pages "http://192.0.2.5:25173" "http://127.0.0.1:28900" "http://127.0.0.1:28899"'){throw 'Incorrect startup pages'}
''',encoding='utf-8-sig')
    result=subprocess.run([PS,'-NoProfile','-ExecutionPolicy','Bypass','-File',str(script),'-Source',str(ROOT/'deploy/portable/Deploy-MES.ps1')],
        capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=20)
    assert result.returncode==0,result.stdout+result.stderr


def test_delivery_display_name_and_new_release_paths_persist(tmp_path):
    delivery,_,_=make_delivery(tmp_path)
    manifest=builder.finalize(delivery,'2026.10.31-v1.1','v1.1预交付docker测试版')
    assert manifest['releaseDirectory']=='release-2026.10.31-v1.1'
    assert manifest['backupDirectory']=='data-backup-2026.10.31-v1.1'
    assert builder.finalize(delivery,'2026.10.31-v1.1')['displayName']=='v1.1预交付docker测试版'
