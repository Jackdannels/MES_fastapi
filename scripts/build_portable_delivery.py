"""Assemble an offline click-to-deploy delivery around verified portable images/data."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import shutil

ROOT=Path(__file__).resolve().parents[1]

def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream,'sha256').hexdigest()

def finalize(root,version):
    entries=[]
    for path in sorted(root.rglob('*')):
        if not path.is_file() or path.name in {'delivery-manifest.json','SHA256SUMS.txt'}:
            continue
        parts=path.relative_to(root).parts
        if '.local' in parts or '.tmp' in parts:
            continue
        entries.append(dict(path=path.relative_to(root).as_posix(),bytes=path.stat().st_size,sha256=digest(path)))
    manifest=dict(format='mes-portable-click-deployment',format_version=1,version=version,
        created_at_utc=datetime.now(timezone.utc).isoformat(),releaseDirectory='release-'+version,
        backupDirectory='data-backup-'+version,desktopDirectory='desktop-tools',controlCenterVersion='2.7.0',files=entries)
    (root/'delivery-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
    (root/'SHA256SUMS.txt').write_text(''.join(entry['sha256']+'  '+entry['path']+'\n' for entry in entries),encoding='utf-8')
    return manifest

def assemble(root,release,backup,desktop,version):
    root.mkdir(parents=True,exist_ok=True)
    for source,target in ((release,root/('release-'+version)),(backup,root/('data-backup-'+version)),(desktop,root/'desktop-tools')):
        if source.resolve()!=target.resolve():
            shutil.copytree(source,target,dirs_exist_ok=True)
    shutil.copy2(ROOT/'deploy/portable/Deploy-MES.ps1',root/'Deploy-MES.ps1')
    for name,action in (('01-Deploy.cmd','Install'),('02-Create-Desktop.cmd','Desktop'),('03-Connection-Info.cmd','Info'),('04-Verify.cmd','Verify')):
        (root/name).write_text('@echo off\r\ncd /d "%~dp0"\r\npowershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Deploy-MES.ps1" -Action '+action+'\r\nset "MES_EXIT_CODE=%ERRORLEVEL%"\r\necho.\r\npause\r\nexit /b %MES_EXIT_CODE%\r\n',encoding='ascii',newline='')
    shutil.copy2(ROOT/'docs/portable-one-click.md',root/'先读我.md')
    return finalize(root,version)

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--version',required=True)
    parser.add_argument('--release',type=Path)
    parser.add_argument('--backup',type=Path)
    parser.add_argument('--desktop',type=Path)
    parser.add_argument('--finalize-only',action='store_true')
    args=parser.parse_args()
    if args.finalize_only: manifest=finalize(args.output,args.version)
    else:
        if not all((args.release,args.backup,args.desktop)):parser.error('Release, backup and desktop directories are required')
        manifest=assemble(args.output,args.release,args.backup,args.desktop,args.version)
    print(json.dumps(dict(output=str(args.output),files=len(manifest['files']),bytes=sum(e['bytes'] for e in manifest['files'])),ensure_ascii=False))
