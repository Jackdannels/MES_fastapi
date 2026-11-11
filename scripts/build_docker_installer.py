"""Compile the verified offline delivery into the Chinese selectable installer."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
NAME = "交付版5826信息化管理系统v1.2"


def verify_delivery(root):
    manifest = json.loads((root / "delivery-manifest.json").read_text(encoding="utf-8-sig"))
    for entry in manifest["files"]:
        relative = entry["path"]
        if not relative or "\\" in relative or ":" in relative or any(part in {".", ".."} for part in relative.split("/")):
            raise ValueError("Unsafe delivery path")
        path = (root / relative).resolve()
        if not path.is_relative_to(root.resolve()) or not path.is_file() or path.stat().st_size != entry["bytes"]:
            raise ValueError(f"Delivery file mismatch: {relative}")
        with path.open("rb") as stream:
            if hashlib.file_digest(stream, "sha256").hexdigest() != entry["sha256"]:
                raise ValueError(f"Delivery checksum mismatch: {relative}")
    return manifest


def includes(catalog, temporary):
    components, files, selections = [], [], []
    for station in catalog:
        identifier = station["labCode"] or station["module"]
        if not re.fullmatch(r"[A-Za-z0-9_\-]+", identifier):
            raise ValueError("Invalid workstation identifier")
        folder = station["folder"]
        if Path(folder).name != folder or any(character in folder for character in '\\/:"'):
            raise ValueError("Invalid workstation folder")
        component = "workstations\\" + identifier.lower()
        components.append(f'Name: "{component}"; Description: "{folder}"; Types: workstation')
        files.append('Source: "{#SourceRoot}\\workstation-payload\\' + folder + '\\*"; DestDir: "{app}\\package\\workstation-payload\\' + folder + f'"; Components: {component}; Flags: ignoreversion recursesubdirs createallsubdirs')
        selections.append("if WizardIsComponentSelected('" + component + "') then begin if Result <> '' then Result := Result + ','; Result := Result + '" + identifier + "'; end;")
    paths = []
    for name, lines in (("Components.iss", components), ("Files.iss", files), ("Selections.iss", selections)):
        path = temporary / name
        path.write_text("\n".join(lines) + "\n", encoding="utf-8-sig")
        paths.append(path)
    return paths


def build(delivery, output, compiler):
    manifest = verify_delivery(delivery)
    output.mkdir(parents=True, exist_ok=True)
    catalog = json.loads((delivery / "workstations.json").read_text(encoding="utf-8-sig"))
    with tempfile.TemporaryDirectory(prefix="MES5826Installer-") as directory:
        paths = includes(catalog, Path(directory))
        arguments = [str(compiler), "/Qp", "/DSourceRoot=" + str(delivery.resolve()),
                     "/DOutputRoot=" + str(output.resolve()), "/DProjectRoot=" + str(ROOT),
                     "/DReleaseVersion=" + manifest["version"]]
        for name, path in zip(("WorkstationComponents", "WorkstationFiles", "WorkstationSelections"), paths):
            arguments.append("/D" + name + "=" + str(path))
        subprocess.run(arguments + [str(ROOT / "deploy/portable/setup.iss")], check=True)
    executable = output / (NAME + "_安装程序.exe")
    with executable.open("rb") as stream:
        checksum = hashlib.file_digest(stream, "sha256").hexdigest()
    (output / "SHA256SUMS.txt").write_text(checksum + "  " + executable.name + "\n", encoding="utf-8")
    return executable


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--delivery", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--compiler", type=Path, default=ROOT / ".tmp/native-inno-compiler/ISCC.exe")
    args = parser.parse_args()
    print(build(args.delivery, args.output, args.compiler))
