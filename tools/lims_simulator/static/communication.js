/* Read-only observation plus explicit operator actions. No browser-owned retry engine. */
(() => {
  const $ = (id) => document.getElementById(id);
  const phases = { unknown: "等待检测", checking: "检测中", online: "正常", offline: "通讯中断", syncing: "补传 / 对账中" };
  const links = { online: "已连通", offline: "未连通", unknown: "未确认" };
  const alarms = { none: "无告警", warning: "普通告警", critical: "严重告警" };
  const kinds = { warning: "普通告警", critical: "告警升级", acknowledged: "人工已知悉", recovered: "恢复正常" };
  const statuses = { queued: "待补传", published: "已发布待确认", received: "MES 已接收", accepted: "MES 已受理", failed: "MES 已拒绝" };
  let state = null;
  let clockOffset = 0;
  let busy = false;
  let actionBusy = false;
  let faultDraft = false;
  const text = (tag, value) => { const node = document.createElement(tag); node.textContent = value; return node; };
  const formatTime = (value) => value == null ? "无" : new Date(value * 1000).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
  async function request(url, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7000);
    try {
      const response = await fetch(url, { cache: "no-store", ...options, signal: controller.signal, headers: { "Content-Type": "application/json" } });
      const result = await response.json();
      if (!response.ok) throw new Error(typeof result.detail === "string" ? result.detail : "请求失败");
      return result;
    } finally { clearTimeout(timeout); }
  }
  function countdown() {
    $("communicationCountdown").textContent = state ? `${Math.max(0, Math.ceil(state.next_check_at - (Date.now() / 1000 + clockOffset)))} 秒` : "—";
  }
  function list(id, rows, empty) {
    $(id).replaceChildren(...(rows.length ? rows : [empty]).map((row) => text("li", row)));
  }
  function render(data) {
    state = data.mes && data.mes.enabled && data.mes.running && !data.mes.stale && !data.mes.runtime_error ? data.mes : null;
    const feedback = data.error || data.mes?.runtime_error || (!state ? "MES 通讯保障未运行或状态过期，不能确认链路在线。" : state.detail);
    $("communicationFeedback").textContent = feedback;
    $("communicationPhase").textContent = state ? phases[state.phase] || "未确认" : "未确认";
    $("communicationHttp").textContent = state ? links[state.http] || "未确认" : "未确认";
    $("communicationRabbit").textContent = state ? links[state.rabbitmq] || "未确认" : "未确认";
    $("communicationAlarm").textContent = state ? `${alarms[state.alarm] || "未确认"}${state.acknowledged ? "（已知悉）" : ""}` : "未确认";
    $("communicationAlarm").dataset.severity = state?.alarm || "unknown";
    $("communicationAlarm").closest("article").classList.toggle("communication-critical", state?.alarm === "critical");
    $("communicationRetries").textContent = state ? `${state.retry_count} / 3` : "—";
    $("acknowledgeCommunication").disabled = actionBusy || !state || state.alarm === "none" || state.acknowledged;
    $("communicationDetails").replaceChildren();
    if (state) {
      clockOffset = state.server_time - Date.now() / 1000;
      $("communicationPolicy").textContent = `正常巡检 ${state.check_interval_seconds} 秒 · 当前重试 ${state.retry_interval_seconds} 秒 · 第三次失败升级告警`;
      const details = [["最近检测", formatTime(state.last_check_at)], ["最近对账成功", formatTime(state.last_success_at)],
        ["故障开始", formatTime(state.fault_since)], ["故障持续", state.fault_since == null ? "无" : `${Math.max(0, Math.floor(state.server_time - state.fault_since))} 秒`],
        ["本轮双向检查点", `MES ${state.out_cursor} / LIMS ${state.in_cursor}`]];
      for (const [label, value] of details) {
        const group = document.createElement("div"); group.append(text("dt", label), text("dd", value)); $("communicationDetails").append(group);
      }
    }
    $("communicationQueueSummary").textContent = `LIMS 持久化下发 ${data.dispatch.total} 条，待确认 ${data.dispatch.pending} 条；MES 待发送 ${state ? state.pending_count : "未确认"} 条。`;
    list("communicationDifferences", (state?.differences || []).map((row) => `${row.direction} · ${row.id} · ${row.status === "missing" ? "记录缺失，等待补传确认" : "内容冲突，需人工核查"}`), state ? "本轮暂无已发现的同步差异。" : "MES 状态未确认，不能判断同步是否一致。");
    list("communicationDispatch", data.dispatch.items.map((row) => `${row.task_code} · ${statuses[row.status] || row.status} · 发布尝试 ${row.attempts} 次${row.last_error ? ` · ${row.last_error}` : ""}`), "尚无下发记录。");
    list("communicationHistory", (data.mes?.history || []).map((row) => `${formatTime(row.at)} · ${kinds[row.kind] || row.kind} · ${row.detail}`), "尚无告警历史。");
    if (!faultDraft) for (const input of $("communicationFaults").querySelectorAll("input[type=checkbox]")) input.checked = Boolean(data.faults[input.name]);
    countdown();
  }
  async function refresh() {
    if (busy || $("communicationPage").hidden) return;
    busy = true;
    $("refreshCommunication").disabled = true;
    try { render(await request("/api/communication")); }
    catch (error) { render({ mes: null, error: error.message, dispatch: { total: "未确认", pending: "未确认", items: [] }, faults: {} }); }
    finally { busy = false; $("refreshCommunication").disabled = false; }
  }
  async function action(url, payload) {
    if (actionBusy) return;
    actionBusy = true;
    const buttons = [$("checkCommunication"), $("acknowledgeCommunication"), $("restoreCommunication"), $("communicationFaults").querySelector("button[type=submit]")];
    buttons.forEach((button) => { button.disabled = true; });
    try {
      const result = await request(url, { method: "POST", body: JSON.stringify(payload) });
      $("communicationActionFeedback").textContent = result.message || "操作已保存；恢复结果以 MES 后台下一轮检测和对账为准。";
      $("communicationActionFeedback").classList.remove("is-error");
      if (url.endsWith("faults")) faultDraft = false;
    } catch (error) {
      $("communicationActionFeedback").textContent = error.message;
      $("communicationActionFeedback").classList.add("is-error");
    } finally {
      actionBusy = false;
      buttons.forEach((button) => { button.disabled = false; });
      await refresh();
    }
  }
  $("refreshCommunication").addEventListener("click", refresh);
  $("checkCommunication").addEventListener("click", () => action("/api/communication/action", { action: "check" }));
  $("acknowledgeCommunication").addEventListener("click", () => action("/api/communication/action", { action: "acknowledge" }));
  $("restoreCommunication").addEventListener("click", () => action("/api/communication/faults", {}));
  $("communicationFaults").addEventListener("change", () => { faultDraft = true; });
  $("communicationFaults").addEventListener("submit", (event) => {
    event.preventDefault();
    const faults = Object.fromEntries([...$("communicationFaults").querySelectorAll("input[type=checkbox]")].map((input) => [input.name, input.checked]));
    void action("/api/communication/faults", faults);
  });
  window.addEventListener("hashchange", refresh);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
  setInterval(() => { if (!document.hidden) refresh(); }, 2000);
  setInterval(countdown, 1000);
  refresh();
})();
