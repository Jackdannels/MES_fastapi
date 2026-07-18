from __future__ import annotations

import random
import threading
import uuid
from collections import deque
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from fastapi import Body, FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

try:
    from .rabbitmq_runtime import LimsRabbitClient
except ImportError:  # pragma: no cover - direct uvicorn launch from this directory
    from rabbitmq_runtime import LimsRabbitClient


BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
BEIJING_TZ = timezone(timedelta(hours=8))
MAX_LOGS = 300
SIMULATOR_VERSION = "1.0"
EXPERIMENT_TYPES = (
    "冲击试验",
    "振动试验",
    "四综合试验",
    "温度冲击试验",
    "高低温湿热试验",
    "盐雾试验",
    "霉菌试验",
)


def now_beijing() -> datetime:
    return datetime.now(BEIJING_TZ)


def now_text() -> str:
    return now_beijing().strftime("%Y-%m-%d %H:%M:%S")


def normalize_text(value: Any) -> str:
    return str(value or "").strip()


class RandomBatchRequest(BaseModel):
    count: int = Field(default=1, ge=1, le=20)


class LimsSimulator:
    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._logs: deque[dict[str, Any]] = deque(maxlen=MAX_LOGS)
        self._sent_count = 0
        self._sequence = 0
        self._task_statuses: dict[str, str] = {}
        self.rabbit: LimsRabbitClient | None = None

    def log(self, level: str, message: str, payload: Any | None = None) -> None:
        with self._lock:
            self._logs.appendleft({"time": now_text(), "level": level, "message": message, "payload": payload})

    def logs(self) -> list[dict[str, Any]]:
        with self._lock:
            return list(self._logs)

    def mark_sent(self) -> None:
        with self._lock:
            self._sent_count += 1

    def state(self) -> dict[str, Any]:
        rabbit_state = self.rabbit.state() if self.rabbit else {"connected": False, "rabbitmq_url": "-", "last_error": "runtime unavailable"}
        with self._lock:
            sent_count = self._sent_count
            pending_count = sum(1 for status in self._task_statuses.values() if status in {"published", "received", "pending"})
        return {
            "version": SIMULATOR_VERSION,
            **rabbit_state,
            "pending_count": pending_count,
            "sent_count": sent_count,
        }

    def next_task_code(self) -> str:
        current = now_beijing()
        with self._lock:
            self._sequence = (self._sequence + 1) % 100
            sequence = self._sequence
        return f"SYLU-{current.strftime('%Y-%m-%d-%H%M%S')}-{sequence:02d}"

    def random_task(self) -> dict[str, Any]:
        rng = random.SystemRandom()
        code = self.next_task_code()
        type_count = rng.randint(1, 3)
        test_types = rng.sample(list(EXPERIMENT_TYPES), type_count)
        request_id = f"LIMS-{now_beijing().strftime('%Y%m%d%H%M%S')}-{uuid.uuid4().hex[:6].upper()}"
        return {
            "lims_request_id": request_id,
            "code": code,
            "name": f"LIMS委托{code[-3:]}",
            "source": "外部委托",
            "client": f"{rng.randint(10, 99)}单位",
            "contact": f"联系人{rng.randint(10, 99)}",
            "contact_info": f"139{rng.randint(0, 99_999_999):08d}",
            "priority": rng.choice(("高", "中", "低")),
            "sample_count": str(rng.randint(1, 12)),
            "sample_type": rng.choice(("金属件", "复合材料", "电子组件", "粉末样品")),
            "test_type": " / ".join(test_types),
            "test_types": test_types,
            "required_device": " / ".join(test_types),
            "due_at": (now_beijing() + timedelta(days=rng.randint(3, 10))).strftime("%Y-%m-%d %H:%M"),
            "arrival_at": "",
            "conditions": rng.choice(("", "常温避光", "温湿度受控")),
            "attachment": "",
            "remark": "LIMS模拟器开发测试下发",
        }

    async def send(self, payload: dict[str, Any]) -> dict[str, Any]:
        next_payload = dict(payload)
        next_payload["lims_request_id"] = normalize_text(next_payload.get("lims_request_id")) or f"LIMS-{uuid.uuid4().hex}"
        next_payload["source"] = "外部委托"
        try:
            if not self.rabbit:
                raise RuntimeError("RabbitMQ 运行时未初始化")
            envelope = await self.rabbit.publish_intake(next_payload)
        except Exception as exc:
            self.log("error", f"任务发布失败：{exc}", next_payload)
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        self.mark_sent()
        with self._lock:
            self._task_statuses[next_payload["lims_request_id"]] = "published"
        self.log("success", f"任务已发布到 RabbitMQ：{normalize_text(next_payload.get('code'))}", envelope)
        return {**next_payload, "message_id": envelope["message_id"], "publish_status": "published"}

    async def handle_status(self, event: dict[str, Any]) -> None:
        payload = event.get("payload") if isinstance(event.get("payload"), dict) else {}
        intake_id = normalize_text(payload.get("lims_request_id") or payload.get("intake_id") or event.get("correlation_id"))
        event_type = normalize_text(event.get("type"))
        event_status = normalize_text(payload.get("acceptance_status"))
        if not event_status:
            event_status = "accepted" if ".accepted." in event_type else "failed" if ".failed." in event_type else "received"
        if intake_id:
            with self._lock:
                self._task_statuses[intake_id] = event_status
        level = "error" if event_status == "failed" else "success"
        self.log(level, f"MES 状态回传：{intake_id or '-'} → {event_status}", event)


simulator = LimsSimulator()
rabbit_client = LimsRabbitClient(simulator.handle_status)
simulator.rabbit = rabbit_client


@asynccontextmanager
async def lifespan(_app: FastAPI):
    await rabbit_client.start()
    try:
        yield
    finally:
        await rabbit_client.stop()


app = FastAPI(title="MES LIMS Simulator", version=SIMULATOR_VERSION, lifespan=lifespan)
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


@app.get("/")
def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/api/state")
def state() -> dict[str, Any]:
    return simulator.state()


@app.get("/api/logs")
def logs() -> dict[str, Any]:
    return {"logs": simulator.logs()}


@app.post("/api/tasks/generate")
def generate_task() -> dict[str, Any]:
    return simulator.random_task()


@app.post("/api/tasks/send")
async def send_task(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
    return await simulator.send(payload)


@app.post("/api/tasks/send-random")
async def send_random_tasks(payload: RandomBatchRequest) -> dict[str, Any]:
    sent = []
    for _index in range(payload.count):
        sent.append(await simulator.send(simulator.random_task()))
    return {"count": len(sent), "items": sent}
