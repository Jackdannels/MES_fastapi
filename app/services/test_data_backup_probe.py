"""Short-lived permission probe. Only removes its own uniquely named test files."""
from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from threading import BoundedSemaphore

from app.services.test_data_backup import _no_links

_PROBES = BoundedSemaphore(2)


def probe_directory(destination: str, local_roots: list[str]) -> dict:
    result = {"ok": False, "path": destination, "checks": [], "detail": ""}
    probe_dir = None
    files = []
    stage = "路径格式"

    def passed(label):
        result["checks"].append({"label": label, "ok": True})

    try:
        target = Path(destination)
        if not destination.strip() or not target.is_absolute():
            raise ValueError("请输入绝对路径；共享目录格式为 \\\\服务器\\共享名\\文件夹")
        if ".." in target.parts:
            raise ValueError("路径不能包含上级目录跳转")
        passed(stage)
        stage = "目录可达"
        _no_links(target)
        if not target.is_dir():
            raise FileNotFoundError("目录不存在或无法访问，请检查设备连接、共享名称及登录凭据")
        target = target.resolve()
        passed(stage)
        stage = "本地与备份分离"
        for root in local_roots:
            local = Path(root).resolve()
            if target.is_relative_to(local) or local.is_relative_to(target):
                raise ValueError("备份目录与本地报告目录不能相同或互相包含")
        passed(stage)
        stage = "创建目录及写入文件"
        probe_dir = Path(tempfile.mkdtemp(prefix=".mes-backup-probe-", dir=target))
        source, published = probe_dir / "probe.tmp", probe_dir / "probe.complete"
        files = [source, published]
        content = os.urandom(64)
        with source.open("xb") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        passed(stage)
        stage = "读取及内容校验"
        if source.read_bytes() != content:
            raise OSError("读取内容与写入内容不一致")
        passed(stage)
        stage = "文件发布"
        if os.name == "nt":
            os.rename(source, published)
        else:
            os.link(source, published)
        if published.read_bytes() != content:
            raise OSError("发布后内容校验失败")
        passed(stage)
    except Exception as exc:
        detail = f"{stage}失败：{exc}"
        result["checks"].append({"label": stage, "ok": False, "detail": detail})
        result["detail"] = detail
    finally:
        if probe_dir is not None:
            try:
                for file in files:
                    file.unlink(missing_ok=True)
                probe_dir.rmdir()
                passed("临时文件清理")
            except OSError as exc:
                detail = f"临时文件清理失败：{exc}；仅可清理本次检测目录 {probe_dir}"
                result["checks"].append({"label": "临时文件清理", "ok": False, "detail": detail})
                result["detail"] = detail
    result["ok"] = bool(result["checks"]) and all(item["ok"] for item in result["checks"])
    if result["ok"]:
        result["path"] = str(target)
        result["detail"] = "检测通过：目录可达，写入、读取、文件发布及清理权限正常"
    return result


def check_backup_directory(destination: str, local_roots: list[str], *, timeout: float = 15) -> dict:
    # Called from a synchronous FastAPI route (threadpool). Timeout kills SMB IO.
    if not _PROBES.acquire(blocking=False):
        return {"ok": False, "path": destination, "checks": [], "detail": "已有路径正在检测，请稍后重试"}
    try:
        from app.core.config import REPO_ROOT
        process = subprocess.run(
            [sys.executable, "-m", "app.services.test_data_backup_probe"], cwd=REPO_ROOT,
            input=json.dumps({"destination": destination, "localRoots": local_roots}),
            text=True, encoding="utf-8", capture_output=True, timeout=timeout,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
        )
        if process.returncode:
            raise OSError("检测进程未正常完成，请检查后端运行环境")
        return json.loads(process.stdout)
    except subprocess.TimeoutExpired:
        return {"ok": False, "path": destination, "checks": [], "detail": "路径检测超时，请检查设备连接及共享权限；可能遗留 .mes-backup-probe- 临时目录"}
    except (OSError, ValueError) as exc:
        return {"ok": False, "path": destination, "checks": [], "detail": f"检测失败：{exc}"}
    finally:
        _PROBES.release()


if __name__ == "__main__":
    # Explicit UTF-8 pipe encoding, independent of Windows console code page.
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stdin.reconfigure(encoding="utf-8")
    payload = json.load(sys.stdin)
    print(json.dumps(probe_directory(payload["destination"], payload["localRoots"]), ensure_ascii=False))
