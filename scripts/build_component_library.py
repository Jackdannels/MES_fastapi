"""Cache verified, credential-free desktop components for selective local repair."""
import argparse
import hashlib
import json
from pathlib import Path
import zipfile
from urllib.parse import urlsplit

ROOT=Path(__file__).resolve().parents[1]


def sha(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream,'sha256').hexdigest()


def build(output,clients,controller,include_test=True):
    output=output.resolve();cache=output/'.mes/components';cache.mkdir(parents=True,exist_ok=True)
    catalog=json.loads((ROOT/'tools/desktop-client/workstations.json').read_text(encoding='utf-8'))
    components=[]
    choices=[('central','中控管理','central','中控管理')]
    if include_test:choices.append(('test','测试终端','test','测试终端'))
    choices += [(row['labCode'] or row['module'],row['folder'],'workstation','工位终端/'+row['folder']) for row in catalog]
    for identifier,name,kind,directory in choices:
        folder=clients/directory
        manifest=json.loads((folder/'client-manifest.json').read_text(encoding='utf-8-sig'))
        files=[];payload={}
        for entry in manifest['files']:
            path=folder/entry['path']
            assert path.resolve().is_relative_to(folder.resolve()) and path.is_file()
            assert path.stat().st_size==entry['bytes'] and sha(path)==entry['sha256'],path
            assert path.suffix not in {'.bin','.sql','.sqlite3'}
            payload[entry['path']]=path.read_bytes()
        config=json.loads((folder/'mes-client.json').read_text(encoding='utf-8-sig'))
        assert not any('password' in key.lower() or 'secret' in key.lower() for key in config)
        installed_config=output/directory/'mes-client.json'
        if installed_config.is_file():
            try:
                raw=installed_config.read_bytes();current=json.loads(raw.decode('utf-8-sig'));url=urlsplit(current.get('serverUrl',''))
                valid=url.scheme in {'http','https'} and url.hostname and not url.username and not url.password and url.path in {'','/'} and not url.query and not url.fragment
                valid=valid and current.get('module')==manifest['module'] and current.get('labCode','')==manifest.get('labCode','') and current.get('labName','')==manifest.get('labName','')
                if valid and not any('password' in key.lower() or 'secret' in key.lower() for key in current):payload['mes-client.json']=raw
            except (ValueError,TypeError):pass
        for entry in manifest['files']:
            data=payload[entry['path']];entry['bytes']=len(data);entry['sha256']=hashlib.sha256(data).hexdigest()
        payload['client-manifest.json']=json.dumps(manifest,ensure_ascii=False,indent=2).encode('utf-8')
        for relative,data in payload.items():files.append(dict(path=relative,bytes=len(data),sha256=hashlib.sha256(data).hexdigest(),mutable=relative in {'mes-client.json','client-manifest.json'}))
        archive=cache/(identifier+'.zip')
        with zipfile.ZipFile(archive,'w',compression=zipfile.ZIP_DEFLATED) as zip:
            for relative,data in payload.items():zip.writestr(relative,data)
        components.append(dict(id=identifier,name=name,kind=kind,directory=directory,archive=archive.name,sha256=sha(archive),
                               executable=manifest['executable'],version=manifest['version'],module=manifest['module'],
                               labCode=manifest.get('labCode',''),labName=manifest.get('labName',''),files=files))
    archive=cache/'controller.zip'
    with zipfile.ZipFile(archive,'w',compression=zipfile.ZIP_DEFLATED) as zip:zip.write(controller,controller.name)
    components.insert(0,dict(id='controller',name='MES控制中心',kind='controller',directory='',archive=archive.name,sha256=sha(archive),
                            executable=controller.name,version='2.10.0',module='',labCode='',labName='',
                            files=[dict(path=controller.name,bytes=controller.stat().st_size,sha256=sha(controller),mutable=False)]))
    (cache/'catalog.json').write_text(json.dumps(dict(format='mes-component-library',format_version=1,controlCenterVersion='2.10.0',components=components),ensure_ascii=False,indent=2),encoding='utf-8')
    state=output/'.mes/installed-components.json'
    installed=set(json.loads(state.read_text(encoding='utf-8-sig'))) if state.exists() else set()
    installed.update(item['id'] for item in components if (output/item['directory']/item['executable']).is_file())
    state.write_text(json.dumps(sorted(installed)),encoding='utf-8')
    (output/'.mes/layout.json').write_text(json.dumps(dict(format='mes-desktop-layout',version=1,central='中控管理',test='测试终端',workstations='工位终端'),ensure_ascii=False,indent=2),encoding='utf-8')
    (output/'.mes/Restore-ControlCenter.ps1').write_bytes((ROOT/'scripts/client/Restore-ControlCenter.ps1').read_bytes())
    (output/'.mes/恢复控制中心.cmd').write_text('@echo off\r\npowershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Restore-ControlCenter.ps1"\r\npause\r\n',encoding='ascii',newline='')
    return components


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path,required=True);parser.add_argument('--clients',type=Path,required=True);parser.add_argument('--controller',type=Path,required=True)
    parser.add_argument('--exclude-test',action='store_true')
    args=parser.parse_args()
    print('Cached desktop components:',len(build(args.output,args.clients,args.controller,not args.exclude_test)))
