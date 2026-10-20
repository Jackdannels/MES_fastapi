"""Build a Windows x64 offline release; downloads occur only on the build PC."""
from __future__ import annotations

import argparse
import concurrent.futures
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
DOWNLOADS = {
    "python.zip": "https://www.python.org/ftp/python/3.12.10/python-3.12.10-embed-amd64.zip",
    "winsw.exe": "https://github.com/winsw/winsw/releases/download/v2.12.0/WinSW-x64.exe",
    "caddy.zip": "https://github.com/caddyserver/caddy/releases/download/v2.11.7/caddy_2.11.7_windows_amd64.zip",
    "rabbitmq.zip": "https://github.com/rabbitmq/rabbitmq-server/releases/download/v4.3.6/rabbitmq-server-windows-4.3.6.zip",
    "inno.exe": "https://github.com/jrsoftware/issrc/releases/download/is-6_7_3/innosetup-6.7.3.exe",
    "vc_redist.x64.exe": "https://aka.ms/vc14/vc_redist.x64.exe",
    "NotoSansSC.ttf": "https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/Variable/TTF/Subset/NotoSansSC-VF.ttf",
    "OFL.txt": "https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/LICENSE",
}


def sha(path):
    with Path(path).open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def fetch(cache, item):
    name, url = item
    target = cache / name
    if not target.exists():
        print(f"Downloading {name}", flush=True)
        temporary = target.with_suffix(target.suffix + ".partial")
        req = urllib.request.Request(url, headers={"User-Agent": "MES-native-offline-builder"})
        with urllib.request.urlopen(req, timeout=120) as source, temporary.open("wb") as output:
            shutil.copyfileobj(source, output, 1024 * 1024)
        temporary.rename(target)
    return {"name": name, "source": url, "sha256": sha(target), "bytes": target.stat().st_size}


def copytree(source, target):
    shutil.copytree(source, target, dirs_exist_ok=True, ignore=shutil.ignore_patterns(
        "__pycache__", "*.pyc", ".venv", ".pytest_cache", "data", "*.log"))


def prepare(output, cache):
    cache.mkdir(parents=True, exist_ok=True)
    failures, records = [], []
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as executor:
        futures = {executor.submit(fetch, cache, item): item[0] for item in DOWNLOADS.items()}
        for future in concurrent.futures.as_completed(futures):
            try:
                record = future.result()
                records.append(record)
                print(f"Ready {record['name']}: {record['bytes']} bytes", flush=True)
            except Exception as exc:
                failures.append(f"{futures[future]}: {exc}")
    (cache / "download-manifest.json").write_text(json.dumps(records, indent=2), encoding="utf-8")
    if failures:
        raise RuntimeError("\n".join(failures))
    output.mkdir(parents=True, exist_ok=True)
    (output / "build-inputs.json").write_text(json.dumps(records, indent=2), encoding="utf-8")


def assemble(output, cache):
    payload = output / "payload"
    runtime = payload / "runtime"
    runtime.mkdir(parents=True, exist_ok=True)
    for name, folder in (("python.zip", "python"), ("caddy.zip", "caddy")):
        with zipfile.ZipFile(cache / name) as archive:
            archive.extractall(runtime / folder)
    rabbit_target = runtime / "rabbitmq"
    with zipfile.ZipFile(cache / "rabbitmq.zip") as archive:
        archive.extractall(cache / "rabbitmq-expanded")
    rabbit_source = next((cache / "rabbitmq-expanded").glob("rabbitmq_server-*"))
    copytree(rabbit_source, rabbit_target)
    # Native upstream runtimes contain no database, cookie, user configuration,
    # Conda environment, or machine credentials. Hash all redistributed files.
    erlang = Path(r"C:\Program Files\Erlang OTP")
    otp = (erlang / "releases/28/OTP_VERSION").read_text().strip()
    if otp != "28.5":
        raise RuntimeError(f"Expected Erlang/OTP 28.5, found {otp}")
    for name in ("bin", "lib", "erts-16.4", "releases"):
        copytree(erlang / name, runtime / "erlang" / name)
    mysql = Path(r"C:\Program Files\MySQL\MySQL Server 9.6")
    subprocess.run([str(mysql / "bin/mysqld.exe"), "--no-defaults", "--version"], check=True)
    for name in ("bin", "lib", "share", "docs"):
        if (mysql / name).exists():
            copytree(mysql / name, runtime / "mysql" / name)
    for name in ("LICENSE", "README"):
        if (mysql / name).exists():
            shutil.copy2(mysql / name, runtime / "mysql" / name)
    shutil.copy2(cache / "winsw.exe", runtime / "WinSW.exe")
    (payload / "fonts").mkdir(exist_ok=True)
    shutil.copy2(cache / "NotoSansSC.ttf", payload / "fonts/NotoSansSC.ttf")
    licenses = output / "licenses"
    licenses.mkdir(exist_ok=True)
    shutil.copy2(cache / "OFL.txt", licenses / "Noto-font-license.txt")
    (output / "prerequisites").mkdir(exist_ok=True)
    shutil.copy2(cache / "vc_redist.x64.exe", output / "prerequisites/vc_redist.x64.exe")
    copytree(ROOT / "app", payload / "app")
    for name in ("lims_simulator", "upper_computer_simulator"):
        copytree(ROOT / "tools" / name, payload / "tools" / name)
    (payload / "scripts/sql").mkdir(parents=True, exist_ok=True)
    shutil.copy2(ROOT / "scripts/init_mysql_storage.py", payload / "scripts/init_mysql_storage.py")
    for source in (ROOT / "scripts/sql").glob("*.sql"):
        shutil.copy2(source, payload / "scripts/sql" / source.name)
    (payload / "scripts/deploy").mkdir(exist_ok=True)
    shutil.copy2(ROOT / "scripts/deploy/portable_data.py", payload / "scripts/deploy/portable_data.py")
    copytree(ROOT / "deploy/native", payload / "native")
    if not (ROOT / "frontend/dist/index.html").exists():
        raise RuntimeError("Build frontend before assembling the native package")
    copytree(ROOT / "frontend/dist", payload / "frontend/dist")
    python = runtime / "python"
    (python / "python312._pth").write_text("python312.zip\n.\nLib\\site-packages\n..\\..\nimport site\n", encoding="utf-8")
    wheelhouse = cache / "wheelhouse"
    wheelhouse.mkdir(exist_ok=True)
    if not list(wheelhouse.glob("*.whl")):
        subprocess.run([sys.executable, "-m", "pip", "download", "--only-binary=:all:",
                        "--platform", "win_amd64", "--python-version", "312", "--implementation", "cp",
                        "--abi", "cp312", "--dest", str(wheelhouse), "-r", str(ROOT / "requirements-prod.txt")], check=True)
    target = python / "Lib/site-packages"
    if not (target / "fastapi").exists():
        subprocess.run([sys.executable, "-m", "pip", "install", "--no-index", "--find-links", str(wheelhouse),
                        "--only-binary=:all:", "--platform", "win_amd64", "--python-version", "312", "--implementation", "cp",
                        "--abi", "cp312", "--target", str(target), "-r", str(ROOT / "requirements-prod.txt")], check=True)
    # Linux-only Uvicorn extras must not be requested by the Windows lock.
    wheels = [{"name": p.name, "sha256": sha(p)} for p in sorted(wheelhouse.glob("*.whl"))]
    (output / "windows-wheels.json").write_text(json.dumps(wheels, indent=2), encoding="utf-8")
    (output / "runtime-versions.json").write_text(json.dumps({"python": "3.12.10", "mysql": "9.6.0",
        "erlang": otp, "rabbitmq": "4.3.6", "caddy": "2.11.7", "winsw": "2.12.0",
        "source": "Windows official binary distributions; Erlang/MySQL runtime files assembled from verified local installations"}, indent=2), encoding="utf-8")
    subprocess.run([str(python / "python.exe"), "-I", "-X", "utf8", "-c",
        "import fastapi,uvicorn,pymysql,sqlite3,paho.mqtt.client,aio_pika,cryptography,pdfplumber,pypdf,reportlab; print('Private Windows runtime imports passed')"], check=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("prepare", "assemble"))
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--cache", type=Path, default=ROOT / ".tmp/native-cache")
    args = parser.parse_args()
    if args.action == "prepare":
        prepare(args.output.resolve(), args.cache.resolve())
    else:
        assemble(args.output.resolve(), args.cache.resolve())


if __name__ == "__main__":
    main()
