"""Persistent bidirectional application probes, retry/alert state, and replay audit."""
from __future__ import annotations

import asyncio
import json
import time
import uuid
from urllib import request

from app.services.lims_communication_store import CommunicationRepository, STATE_KEY, SENT_KEY, RECEIVED_KEY
from app.services.lims_http import _NoRedirect, enqueue_lims_event

BATCH_SIZE = 100


def initial_state():
    return {"phase": "unknown", "retry_count": 0, "next_check_at": 0, "last_check_at": None,
            "last_success_at": None, "fault_since": None, "alarm": "none", "acknowledged": False,
            "http": "unknown", "rabbitmq": "unknown", "out_cursor": 0, "in_cursor": 0,
            "pending_count": 0, "differences": [], "history": [], "detail": "等待首次双向检测"}


class LimsCommunicationRuntime:
    def __init__(self, settings, http_runtime, rabbit_runtime, *, repository=None, clock=None):
        self.settings = settings
        self.http = http_runtime
        self.rabbit = rabbit_runtime
        self.repository = repository or CommunicationRepository()
        self.clock = clock or time.time
        self.last_error = ""
        self._busy = False

    @property
    def enabled(self):
        return bool(self.settings.LIMS_COMMUNICATION_ENABLED and self.settings.LIMS_HTTP_CALLBACK_URL)

    @property
    def base_url(self):
        return (self.settings.LIMS_COMMUNICATION_URL or
                self.settings.LIMS_HTTP_CALLBACK_URL.rsplit("/", 1)[0] + "/communication").rstrip("/")

    def status(self):
        state = self.repository.read(STATE_KEY, initial_state())
        running = self.http.runner is not None and not self.http.runner.done()
        stale = bool(state.get("last_check_at") and self.clock() > state["next_check_at"] + 30)
        return {**state, "history": state.get("history", [])[-100:][::-1], "enabled": self.enabled,
                "running": running, "stale": stale, "server_time": self.clock(),
                "retry_interval_seconds": self.settings.LIMS_COMMUNICATION_RETRY_SECONDS,
                "check_interval_seconds": self.settings.LIMS_COMMUNICATION_INTERVAL_SECONDS,
                "runtime_error": self.last_error}

    def _request(self, path, payload):
        headers = {"Content-Type": "application/json", "Accept": "application/json"}
        if self.settings.LIMS_HTTP_TOKEN:
            headers["Authorization"] = f"Bearer {self.settings.LIMS_HTTP_TOKEN}"
        req = request.Request(self.base_url + path, data=json.dumps(payload, ensure_ascii=False).encode(), headers=headers, method="POST")
        with request.build_opener(_NoRedirect).open(req, timeout=self.settings.LIMS_HTTP_TIMEOUT_SECONDS) as response:
            value = json.loads(response.read(1024 * 1024 + 1))
            if response.status != 200 or not isinstance(value, dict) or value.get("ok") is not True:
                raise ValueError("Invalid communication response")
            if value.get("check_id") != payload["check_id"] or value.get("schema_version") != 1:
                raise ValueError("Communication response identity mismatch")
            return value

    def _history(self, state, kind, detail):
        state["history"].append({"at": self.clock(), "kind": kind, "detail": detail, "retry_count": state["retry_count"]})

    def _fail(self, state, detail):
        if state["fault_since"] is None:
            state.update(fault_since=self.clock(), retry_count=0, acknowledged=False, out_cursor=0, in_cursor=0)
            self._history(state, "warning", detail)
        alarm = "critical" if state["retry_count"] >= 3 else "warning"
        if alarm == "critical" and state["alarm"] != "critical":
            self._history(state, "critical", "连续三次重试失败，告警升级")
        state.update(phase="offline", alarm=alarm, detail=detail,
                     next_check_at=self.clock() + self.settings.LIMS_COMMUNICATION_RETRY_SECONDS)

    async def _probe(self, state, check_id):
        if self.settings.RABBITMQ_ENABLED and not self.rabbit.connected:
            await self.rabbit.start()
        future = self.rabbit.prepare_communication_probe(check_id)
        try:
            reply = await asyncio.to_thread(self._request, "/probe", {
                "check_id": check_id, "schema_version": 1,
                "reply_routing_key": self.rabbit.communication_routing_key,
            })
            state["http"] = "online"
            if reply.get("rabbit_sent") is not True:
                raise ConnectionError("RabbitMQ application probe not sent")
            await asyncio.wait_for(future, timeout=self.settings.LIMS_HTTP_TIMEOUT_SECONDS)
            state["rabbitmq"] = "online"
        finally:
            self.rabbit.forget_communication_probe(check_id)

    async def _reconcile(self, state, check_id):
        sent = await asyncio.to_thread(self.repository.read, SENT_KEY, [])
        received = await asyncio.to_thread(self.repository.read, RECEIVED_KEY, [])
        batch = sent[state["out_cursor"]:state["out_cursor"] + BATCH_SIZE]
        response = await asyncio.to_thread(self._request, "/reconcile", {
            "check_id": check_id, "schema_version": 1,
            "events": [{"id": row["id"], "digest": row["digest"]} for row in batch],
            "dispatch_after": state["in_cursor"], "limit": BATCH_SIZE,
        })
        statuses = response.get("events")
        dispatch = response.get("dispatch")
        if (not isinstance(statuses, list) or len(statuses) != len(batch) or
                not isinstance(dispatch, list) or len(dispatch) > BATCH_SIZE or
                type(response.get("dispatch_more")) is not bool):
            raise ValueError("Invalid reconciliation manifest")
        differences = []
        for row, result in zip(batch, statuses):
            if not isinstance(result, dict) or result.get("id") != row["id"] or result.get("status") not in {"matched", "missing", "conflict"}:
                raise ValueError("Invalid reconciliation result")
            if result["status"] == "missing":
                await asyncio.to_thread(enqueue_lims_event, row["body"])
            if result["status"] != "matched":
                differences.append({"direction": "MES → LIMS", "id": row["id"], "status": result["status"]})
        lookup = {row["id"]: row for row in received}
        confirmations = []
        replay = []
        last_seq = state["in_cursor"]
        for item in dispatch:
            if (not isinstance(item, dict) or type(item.get("sequence")) is not int or item["sequence"] <= last_seq
                    or not isinstance(item.get("id"), str) or not isinstance(item.get("digest"), str)):
                raise ValueError("Invalid dispatch manifest")
            last_seq = item["sequence"]
            local = lookup.get(item["id"])
            if not local:
                replay.append(item["id"])
                differences.append({"direction": "LIMS → MES", "id": item["id"], "status": "missing"})
            elif local["digest"] != item["digest"]:
                differences.append({"direction": "LIMS → MES", "id": item["id"], "status": "conflict"})
            else:
                confirmations.append({"id": item["id"], "digest": item["digest"], "outcome": local["outcome"]})
        # Exact IDs only: never reset or delete either side's business records.
        await asyncio.to_thread(self._request, "/resume", {
            "check_id": check_id, "schema_version": 1, "confirmed": confirmations, "replay": replay,
        })
        state["differences"] = differences
        if any(row["status"] == "conflict" for row in differences):
            raise ValueError("Message identity/content conflict")
        if not any(row["direction"] == "MES → LIMS" for row in differences):
            state["out_cursor"] += len(batch)
        if not any(row["direction"] == "LIMS → MES" for row in differences):
            state["in_cursor"] = last_seq
        await self.http.deliver_once(ignore_deadlines=True, max_events=BATCH_SIZE, max_duration_seconds=3)
        state["pending_count"] = self.http.pending_count
        if self.http.last_error:
            state["http"] = "offline"
            raise ConnectionError("HTTP business delivery failed")
        return (not differences and not self.http.pending_count and
                state["out_cursor"] >= len(sent) and not response["dispatch_more"])

    async def tick(self):
        if not self.enabled or self._busy:
            return
        self._busy = True
        lease = None
        try:
            acquisition = asyncio.create_task(asyncio.to_thread(self.repository.acquire_cycle))
            try:
                lease = await asyncio.shield(acquisition)
            except asyncio.CancelledError:
                # A blocking DB call cannot be cancelled; collect/release any acquired lock.
                lease = await acquisition
                raise
            if lease is None:
                return
            state = await asyncio.to_thread(self.repository.read, STATE_KEY, initial_state())
            commands = await asyncio.to_thread(self.repository.take_commands)
            if commands.get("acknowledge") and state["alarm"] != "none" and not state["acknowledged"]:
                state["acknowledged"] = True
                self._history(state, "acknowledged", "人工已知悉；不清除故障，也不停止重试")
            if commands.get("check") and state["phase"] == "online":
                state["next_check_at"] = 0
            if self.clock() < state["next_check_at"]:
                if state["phase"] == "online":
                    await self.http.deliver_once(max_events=BATCH_SIZE, max_duration_seconds=3)
                    state["pending_count"] = self.http.pending_count
                    if self.http.last_error:
                        state["http"] = "offline"
                        self._fail(state, "HTTP 业务回调失败，等待定时重试")
                await asyncio.to_thread(self.repository.save_state, state)
                self.last_error = ""
                return
            if state["fault_since"] is not None:
                state["retry_count"] += 1
            state.update(last_check_at=self.clock(), http="unknown", rabbitmq="unknown",
                         phase="checking", next_check_at=self.clock() + self.settings.LIMS_COMMUNICATION_RETRY_SECONDS)
            # Reserve this attempt before I/O, so restart cannot reset the deadline/counter.
            await asyncio.to_thread(self.repository.save_state, state)
            try:
                check_id = uuid.uuid4().hex
                await self._probe(state, check_id)
                complete = await self._reconcile(state, check_id)
                if complete:
                    if state["fault_since"] is not None:
                        self._history(state, "recovered", "双向链路与数据对账均已恢复")
                    state.update(phase="online", alarm="none", fault_since=None, acknowledged=False, retry_count=0,
                                 last_success_at=self.clock(), detail="双向应用检测及数据对账正常",
                                 out_cursor=0, in_cursor=0,
                                 next_check_at=self.clock() + self.settings.LIMS_COMMUNICATION_INTERVAL_SECONDS)
                else:
                    if state["differences"] or state["pending_count"]:
                        self._fail(state, "数据同步存在缺口，补传后将再次对账")
                    state.update(phase="syncing", detail="链路已连通，正在补传并核对缺失记录",
                                 next_check_at=self.clock() + self.settings.LIMS_COMMUNICATION_RETRY_SECONDS)
            except Exception as exc:
                if state["http"] == "unknown":
                    state["http"] = "offline"
                if state["rabbitmq"] == "unknown":
                    state["rabbitmq"] = "offline"
                self._fail(state, f"通讯或数据同步校验失败（{type(exc).__name__}）")
                if state["http"] == "online" and state["rabbitmq"] == "online":
                    state["phase"] = "syncing"
            await asyncio.to_thread(self.repository.save_state, state)
            self.last_error = ""
        except Exception as exc:
            # Never replace a persistence failure with an invented healthy status.
            self.last_error = f"通讯保障存储不可用（{type(exc).__name__}）"
        finally:
            try:
                if lease is not None:
                    await asyncio.to_thread(self.repository.release_cycle, lease)
            finally:
                self._busy = False
