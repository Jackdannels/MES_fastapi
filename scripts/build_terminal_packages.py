"""Publish precompiled workstation ZIPs for approved LAN provisioning."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import zipfile

ROOT = Path(__file__).resolve().parents[1]


def build(source, output):
    catalog = json.loads((ROOT / 'tools/desktop-client/workstations.json').read_text(encoding='utf-8'))
    output.mkdir(parents=True, exist_ok=True)
    result = []
    for station in catalog:
        identifier = station['labCode'] or station['module']
        assert re.fullmatch(r'[A-Za-z0-9_-]+', identifier)
        folder = source / station['folder']
        manifest = json.loads((folder / 'client-manifest.json').read_text(encoding='utf-8-sig'))
        if manifest['module'] != station['module'] or manifest['labCode'] != station['labCode']:
            raise ValueError('Compiled workstation does not match catalogue: ' + identifier)
        entries = []
        for entry in manifest['files']:
            path = (folder / entry['path']).resolve()
            if not path.is_relative_to(folder.resolve()) or not path.is_file():
                raise ValueError('Unsafe package file')
            if path.stat().st_size != entry['bytes'] or hashlib.sha256(path.read_bytes()).hexdigest() != entry['sha256']:
                raise ValueError('Client checksum mismatch: ' + entry['path'])
            entries.append((path, entry['path']))
        destination = output / (identifier + '.zip')
        temporary = output / (identifier + '.zip.new')
        with zipfile.ZipFile(temporary, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
            for path, relative in entries:
                archive.write(path, relative)
            archive.write(folder / 'client-manifest.json', 'client-manifest.json')
        temporary.replace(destination)
        result.append(dict(stationId=identifier, bytes=destination.stat().st_size,
                           sha256=hashlib.sha256(destination.read_bytes()).hexdigest(), version=manifest['version']))
    (output / 'packages.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--output', type=Path, default=ROOT / 'app/assets/terminal-clients')
    args = parser.parse_args()
    print(json.dumps(build(args.source, args.output), ensure_ascii=False))
