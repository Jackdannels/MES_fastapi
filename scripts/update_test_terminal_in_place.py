"""Update the existing desktop test terminal and its local repair component."""
import argparse
from datetime import datetime
import hashlib
import json
from pathlib import Path
import shutil
import zipfile


def sha(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def inside(root, relative):
    path = (root / relative).resolve()
    if not path.is_relative_to(root.resolve()) or path == root.resolve():
        raise ValueError("Path escaped the selected directory")
    return path


def update(source, target):
    source, target = source.resolve(), target.resolve()
    if not (target / "MES控制中心_v2.10.0.exe").is_file():
        raise ValueError("Select the existing desktop v2.10.0 directory")
    installed = inside(target, "测试终端")
    manifest = json.loads((source / "client-manifest.json").read_text(encoding="utf-8-sig"))
    if manifest["module"] != "test" or manifest["executable"] != "MES综合测试终端.exe":
        raise ValueError("Source is not a test terminal")
    for entry in manifest["files"]:
        path = inside(source, entry["path"])
        if path.stat().st_size != entry["bytes"] or sha(path) != entry["sha256"]:
            raise ValueError("Source checksum mismatch: " + entry["path"])
    config = (installed / "mes-client.json").read_bytes()
    if json.loads(config.decode("utf-8-sig"))["module"] != "test":
        raise ValueError("Installed terminal role does not match")
    catalog_path = inside(target, ".mes/components/catalog.json")
    catalog = json.loads(catalog_path.read_text(encoding="utf-8-sig"))
    matches = [row for row in catalog["components"] if row["id"] == "test"]
    if len(matches) != 1 or matches[0]["directory"] != "测试终端":
        raise ValueError("Test component catalogue is missing or ambiguous")
    component = matches[0]
    backup = inside(target, ".mes/backups/test-terminal-" + datetime.now().strftime("%Y%m%d-%H%M%S"))
    shutil.copytree(installed, backup)
    # Replace the executable first: a running/locked old host fails before other files change.
    entries = sorted(manifest["files"], key=lambda entry: entry["path"] != manifest["executable"])
    for entry in entries:
        if entry["path"] != "mes-client.json":
            shutil.copy2(inside(source, entry["path"]), inside(installed, entry["path"]))
    assert (installed / "mes-client.json").read_bytes() == config
    for entry in manifest["files"]:
        path = inside(installed, entry["path"])
        entry.update(bytes=path.stat().st_size, sha256=sha(path))
    manifest_path = installed / "client-manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    payload = [(entry["path"], inside(installed, entry["path"])) for entry in manifest["files"]]
    payload.append(("client-manifest.json", manifest_path))
    archive_path = inside(target, ".mes/components/" + component["archive"])
    temporary = archive_path.with_suffix(".zip.new")
    with zipfile.ZipFile(temporary, "w", zipfile.ZIP_DEFLATED) as archive:
        for relative, path in payload:
            archive.write(path, relative)
    with zipfile.ZipFile(temporary) as archive:
        assert archive.testzip() is None
    temporary.replace(archive_path)
    component.update(sha256=sha(archive_path), version=manifest["version"], files=[
        dict(path=relative, bytes=path.stat().st_size, sha256=sha(path),
             mutable=relative in {"mes-client.json", "client-manifest.json"}) for relative, path in payload
    ])
    catalog_path.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return installed


def update_checksums(target):
    target = target.resolve()
    checksums = target / "SHA256SUMS.txt"
    files = sorted((path for path in target.rglob("*") if path.is_file() and path != checksums),
                   key=lambda path: path.relative_to(target).as_posix().casefold())
    checksums.write_text("".join(sha(path) + "  " + path.relative_to(target).as_posix() + "\n" for path in files), encoding="utf-8")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--target", type=Path, default=Path.home() / "Desktop/MES开发环境_v2.10.0")
    options = parser.parse_args()
    installed = update(options.source, options.target)
    update_checksums(options.target)
    print("Updated existing desktop test terminal, repair component and checksums: " + str(installed))
