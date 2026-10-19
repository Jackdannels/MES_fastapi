const $ = (id) => document.getElementById(id);

const state = {
  connected: false,
  connecting: false,
  configDirty: false,
  pendingAutoMode: null,
  logAutoRefreshPaused: false,
  latestLogs: [],
  renderedLogs: [],
  pendingLogs: null,
  renderedLogSignature: "",
  visibleLogLimit: 100,
  refreshInFlight: false,
  telemetryItems: [],
  telemetryMeta: {},
};

const LOG_PAGE_SIZE = 100;

const LAB_OPTIONS = [
  { code: "LAB_IMPACT_1", name: "冲击一室", testType: "冲击试验" },
  { code: "LAB_IMPACT_2", name: "冲击二室", testType: "冲击试验" },
  { code: "LAB_VIBRATION_1", name: "振动一室", testType: "振动试验" },
  { code: "LAB_VIBRATION_2", name: "振动二室", testType: "振动试验" },
  { code: "LAB_COMPREHENSIVE", name: "四综合实验室", testType: "四综合试验" },
  { code: "LAB_TEMP_SHOCK_1", name: "温度冲击一室", testType: "温度冲击试验" },
  { code: "LAB_TEMP_SHOCK_2", name: "温度冲击二室", testType: "温度冲击试验" },
  { code: "LAB_HOT_HUMID", name: "高低温湿热一室", testType: "高低温湿热试验" },
  { code: "LAB_HOT_HUMID_2", name: "高低温湿热二室", testType: "高低温湿热试验" },
  { code: "LAB_SALT", name: "盐雾试验室", testType: "盐雾试验" },
  { code: "LAB_MOLD", name: "霉菌试验室", testType: "霉菌试验" },
];

function beijingNowText() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const pick = (type) => parts.find((item) => item.type === type)?.value || "00";
  return `${pick("year")}-${pick("month")}-${pick("day")} ${pick("hour")}:${pick("minute")}:${pick("second")}`;
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(data.detail || response.statusText);
  }
  return data;
}

function readConfig() {
  const username = $("username").value.trim() || "guest";
  const password = $("password").value || (username === "guest" ? "guest" : "");
  return {
    host: $("host").value.trim(),
    port: Number($("port").value || 1883),
    topicPrefix: $("topicPrefix").value.trim() || "mes/v1",
    lab_code: $("labCode").value.trim(),
    username,
    password,
    auto_mode: $("autoMode").checked,
  };
}

function labOptionLabel(option) {
  return `${option.code} - ${option.name}`;
}

function findLabOption(code) {
  return LAB_OPTIONS.find((option) => option.code === code) || null;
}

function renderLabOptions(selectedCode = "LAB_SALT") {
  const select = $("labCode");
  const hasSelectedCode = LAB_OPTIONS.some((option) => option.code === selectedCode);
  const options = hasSelectedCode
    ? LAB_OPTIONS
    : [{ code: selectedCode, name: "当前配置中的试验间", testType: "未知试验" }, ...LAB_OPTIONS];
  select.innerHTML = options.map((option) => (
    `<option value="${escapeHtml(option.code)}">${escapeHtml(labOptionLabel(option))}</option>`
  )).join("");
  select.value = selectedCode;
  updateLabCodeHint();
}

function updateLabCodeHint() {
  const code = $("labCode").value.trim();
  const option = findLabOption(code);
  $("labCodeHint").textContent = option
    ? `${option.code} 对应${option.name}，用于${option.testType}`
    : `${code} 为当前配置中的试验间 code，请确认主项目 md_lab 中存在该编码`;
}

function setStatus(connected) {
  state.connected = connected;
  const badge = $("statusBadge");
  badge.textContent = connected ? "已连接" : "未连接";
  badge.classList.toggle("is-connected", connected);
}

function setWorkspacePage(page) {
  const telemetrySelected = page !== "workflow";
  $("telemetryPage").hidden = !telemetrySelected;
  $("workflowPage").hidden = telemetrySelected;
  $("telemetryTab").classList.toggle("is-active", telemetrySelected);
  $("workflowTab").classList.toggle("is-active", !telemetrySelected);
  $("telemetryTab").setAttribute("aria-selected", String(telemetrySelected));
  $("workflowTab").setAttribute("aria-selected", String(!telemetrySelected));
}

function telemetryMetric(payload, group, field) {
  const value = payload?.[group]?.[field];
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value)) ? Number(value) : "";
}

function renderTelemetry(items = [], meta = {}) {
  state.telemetryItems = items;
  state.telemetryMeta = meta;
  const grid = $("telemetryGrid");
  if (grid.contains(document.activeElement) && document.activeElement.matches("input")) {
    return;
  }
  $("telemetryActiveCount").textContent = `${items.filter((item) => item.enabled).length} / ${items.length || 11}`;
  $("telemetryFaultCountdown").textContent = `${Number(meta.next_fault_in_cycles || 10)} 轮后`;
  grid.innerHTML = items.map((item) => {
    const payload = item.payload || {};
    const hasSnapshot = Boolean(payload.observed_at);
    const carrierConfigured = Boolean(item.carrier_configured);
    const enabledLabel = item.enabled ? "采集中" : "已暂停";
    const statusClass = item.enabled && hasSnapshot ? "is-online" : item.enabled ? "is-waiting" : "is-paused";
    const field = (label, key, value, unit, disabled = false) => `
      <label class="telemetry-field ${disabled ? "is-disabled" : ""}">
        <span>${label}</span>
        <span class="telemetry-input-wrap">
          <input type="number" step="0.1" data-telemetry-field="${key}" value="${value}" ${disabled ? "disabled" : ""} />
          <small>${unit}</small>
        </span>
      </label>`;
    return `
      <article class="telemetry-card ${statusClass}" data-lab-code="${escapeHtml(item.lab_code)}">
        <header>
          <div><strong>${escapeHtml(item.lab_name)}</strong><code>${escapeHtml(item.lab_code)}</code></div>
          <span class="telemetry-state"><i></i>${enabledLabel}</span>
        </header>
        <div class="telemetry-fields">
          ${field("室温", "room_temperature_c", telemetryMetric(payload, "environment", "temperature_c"), "°C")}
          ${field("湿度", "humidity_rh", telemetryMetric(payload, "environment", "humidity_rh"), "%RH")}
          ${field("试验设备温度", "test_temperature_c", telemetryMetric(payload, "test_device", "temperature_c"), "°C")}
          ${field("试验设备电压", "test_voltage_v", telemetryMetric(payload, "test_device", "voltage_v"), "V")}
          ${field("搬运设备温度", "carrier_temperature_c", telemetryMetric(payload, "carrier_device", "temperature_c"), carrierConfigured ? "°C" : "无设备", !carrierConfigured)}
          ${field("搬运设备电压", "carrier_voltage_v", telemetryMetric(payload, "carrier_device", "voltage_v"), carrierConfigured ? "V" : "无设备", !carrierConfigured)}
        </div>
        <footer>
          <span>${hasSnapshot ? `最近发送 ${escapeHtml(payload.observed_at)}` : "等待首次 MQTT 发送"}</span>
          <div>
            <button type="button" data-telemetry-action="toggle">${item.enabled ? "暂停采集" : "恢复采集"}</button>
            <button type="button" class="primary" data-telemetry-action="save">应用并发送</button>
          </div>
        </footer>
      </article>`;
  }).join("") || '<div class="empty">正在加载遥测配置…</div>';
}

async function updateTelemetryCard(card, action) {
  const labCode = card.dataset.labCode;
  const current = state.telemetryItems.find((item) => item.lab_code === labCode);
  const payload = { lab_code: labCode };
  if (action === "toggle") {
    payload.enabled = !current?.enabled;
  } else {
    card.querySelectorAll("[data-telemetry-field]").forEach((input) => {
      if (!input.disabled && input.value !== "") {
        payload[input.dataset.telemetryField] = Number(input.value);
      }
    });
  }
  const result = await requestJson("/api/telemetry", {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
  renderTelemetry(result.items || [], result);
}

function setAutoMode(enabled) {
  $("autoMode").checked = Boolean(enabled);
  $("modeSwitch").classList.toggle("is-auto", Boolean(enabled));
  $("modeSwitch").setAttribute("aria-checked", String(Boolean(enabled)));
  $("autoModeHint").textContent = enabled
    ? "自动模式监听全部试验间，自动回传实验开始；收到 MES 结束指令后回传结束"
    : "手动模式仅订阅当前试验间";
}

function readAutoModeFromConfig(config = {}, fallback = false) {
  if (Object.prototype.hasOwnProperty.call(config, "auto_mode")) {
    return Boolean(config.auto_mode);
  }
  if (Object.prototype.hasOwnProperty.call(config, "autoMode")) {
    return Boolean(config.autoMode);
  }
  return Boolean(fallback);
}

function subscriptionTopic(config = readConfig()) {
  const prefix = config.topicPrefix || "mes/v1";
  return config.auto_mode
    ? `${prefix}/labs/+/commands/#`
    : `${prefix}/labs/${config.lab_code}/commands/#`;
}

function showNotice(title, message) {
  $("noticeTitle").textContent = title;
  $("noticeMessage").textContent = message;
  $("noticeDialog").hidden = false;
  $("noticeOkBtn").focus();
}

function hideNotice() {
  $("noticeDialog").hidden = true;
}

function shouldStartInAutoMode() {
  const params = new URLSearchParams(window.location.search);
  const mode = String(params.get("mode") || "").trim().toLowerCase();
  return params.get("auto") === "1" || params.get("autoMode") === "1" || mode === "auto";
}

function renderLastMessages(lastMessages = {}) {
  const install = lastMessages["fixture-install"];
  const ready = lastMessages["experiment-ready"];
  $("lastFixtureInstall").textContent = install ? JSON.stringify(install, null, 2) : "暂无消息";
  $("lastExperimentReady").textContent = ready ? JSON.stringify(ready, null, 2) : "暂无消息";
}

function selectionIsInsideLogs() {
  const selection = window.getSelection?.();
  const logsElement = $("logs");
  if (!selection || selection.rangeCount === 0 || !logsElement) {
    return false;
  }
  return logsElement.contains(selection.anchorNode) || logsElement.contains(selection.focusNode);
}

function isReviewingOlderLogs() {
  return $("logs").scrollTop > 12;
}

function formatLogEntry(entry = {}) {
  const lines = [`[${entry.time || ""}] ${entry.message || ""}`];
  if (entry.topic) {
    lines.push(`Topic: ${entry.topic}`);
  }
  if (entry.payload !== null && entry.payload !== undefined) {
    lines.push(JSON.stringify(entry.payload, null, 2));
  }
  return lines.join("\n");
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.className = "clipboard-fallback";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function showCopiedFeedback(button, originalText) {
  button.textContent = "已复制";
  button.classList.add("is-copied");
  window.setTimeout(() => {
    button.textContent = originalText;
    button.classList.remove("is-copied");
  }, 1500);
}

async function copyLogEntry(index, button) {
  const entry = state.renderedLogs[index];
  if (!entry) {
    return;
  }
  const originalText = button.textContent;
  await copyText(formatLogEntry(entry));
  showCopiedFeedback(button, originalText);
}

async function copyAllLogs() {
  if (!state.latestLogs.length) {
    showNotice("暂无日志", "当前没有可复制的通信日志。");
    return;
  }
  const button = $("copyLogsBtn");
  const originalText = button.textContent;
  await copyText(state.latestLogs.map(formatLogEntry).join("\n\n"));
  showCopiedFeedback(button, originalText);
}

function updateLogControls(totalCount = state.latestLogs.length) {
  const visibleCount = Math.min(state.visibleLogLimit, totalCount);
  $("logSummary").textContent = `${visibleCount} / ${totalCount} 条${state.logAutoRefreshPaused ? " · 已暂停" : ""}`;
  $("pauseLogsBtn").textContent = state.logAutoRefreshPaused ? "继续自动刷新" : "暂停自动刷新";
  $("pauseLogsBtn").setAttribute("aria-pressed", String(state.logAutoRefreshPaused));
  const remainingCount = Math.max(0, totalCount - visibleCount);
  $("showMoreLogsBtn").hidden = remainingCount === 0;
  $("showMoreLogsBtn").textContent = remainingCount > 0
    ? `显示更多（剩余 ${remainingCount} 条）`
    : "显示更多";
}

function setPendingLogNotice(visible) {
  $("logUpdateNotice").hidden = !visible;
}

function renderLogs(logs = [], { force = false, preserveScroll = false } = {}) {
  state.latestLogs = logs;
  const signature = JSON.stringify(logs);
  if (!force && signature === state.renderedLogSignature) {
    updateLogControls(logs.length);
    return;
  }
  if (!force && (state.logAutoRefreshPaused || selectionIsInsideLogs() || isReviewingOlderLogs())) {
    state.pendingLogs = logs;
    setPendingLogNotice(true);
    updateLogControls(logs.length);
    return;
  }

  const previousScrollTop = $("logs").scrollTop;
  const displayedLogs = logs.slice(0, state.visibleLogLimit);
  $("logs").innerHTML = displayedLogs.map((entry, index) => {
    const payload = entry.payload ? `<pre>${escapeHtml(JSON.stringify(entry.payload, null, 2))}</pre>` : "";
    const topic = entry.topic ? `<code>${escapeHtml(entry.topic)}</code>` : "";
    return `
      <article class="log-row log-${entry.level}">
        <div class="log-head">
          <strong>${escapeHtml(entry.message)}</strong>
          <div class="log-head-actions">
            <span>${escapeHtml(entry.time)}</span>
            <button class="log-copy-button" type="button" data-log-index="${index}" aria-label="复制这条通信日志">复制整条</button>
          </div>
        </div>
        ${topic}
        ${payload}
      </article>
    `;
  }).join("") || `<div class="empty">暂无日志</div>`;
  state.renderedLogs = displayedLogs;
  state.renderedLogSignature = signature;
  state.pendingLogs = null;
  setPendingLogNotice(false);
  updateLogControls(logs.length);
  if (preserveScroll) {
    $("logs").scrollTop = previousScrollTop;
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function refreshState() {
  const data = await requestJson("/api/state");
  $("versionBadge").textContent = data.version ? `v${data.version}` : "版本未知";
  setStatus(Boolean(data.connected));
  renderLastMessages(data.lastMessages);
  renderTelemetry(data.telemetry || [], data.telemetryMeta || {});
  if (data.config && !state.configDirty) {
    $("host").value = data.config.host || "127.0.0.1";
    $("port").value = data.config.port || 1883;
    $("topicPrefix").value = data.config.topicPrefix || "mes/v1";
    renderLabOptions(data.config.lab_code || "LAB_SALT");
    $("username").value = data.config.username || "guest";
    setAutoMode(
      state.connecting && state.pendingAutoMode !== null
        ? state.pendingAutoMode
        : readAutoModeFromConfig(data.config, $("autoMode").checked),
    );
    if (!$("password").value && $("username").value === "guest") {
      $("password").value = "guest";
    }
  }
}

async function refreshLogs({ force = false } = {}) {
  const data = await requestJson("/api/logs");
  renderLogs(data.logs || [], { force });
}

async function refreshDashboard({ forceLogs = false } = {}) {
  if (state.refreshInFlight || (document.hidden && !forceLogs)) {
    return;
  }
  state.refreshInFlight = true;
  try {
    if (state.logAutoRefreshPaused && !forceLogs) {
      await refreshState();
    } else {
      await Promise.all([refreshState(), refreshLogs({ force: forceLogs })]);
    }
  } finally {
    state.refreshInFlight = false;
  }
}

async function connect({ showSuccess = false } = {}) {
  if (state.connecting) {
    return;
  }
  state.connecting = true;
  const config = readConfig();
  state.pendingAutoMode = config.auto_mode;
  $("connectBtn").disabled = true;
  const data = await requestJson("/api/connect", {
    method: "POST",
    body: JSON.stringify(config),
  }).finally(() => {
    state.connecting = false;
    $("connectBtn").disabled = false;
  });
  state.configDirty = false;
  const connectedAutoMode = readAutoModeFromConfig(data.config, config.auto_mode);
  state.pendingAutoMode = null;
  setAutoMode(connectedAutoMode);
  setStatus(Boolean(data.connected));
  renderLastMessages(data.lastMessages);
  await refreshLogs();
  if (showSuccess && data.connected) {
    showNotice(
      "订阅成功",
      `当前已${connectedAutoMode ? "自动模式" : "手动模式"}连接 MQTT，并订阅 ${subscriptionTopic({
        ...config,
        auto_mode: connectedAutoMode,
      })}。`,
    );
  }
}

async function disconnect() {
  await requestJson("/api/disconnect", { method: "POST" });
  setStatus(false);
  await refreshLogs();
}

function readResultPackage() {
  const text = $("result_package").value.trim();
  if (!text) {
    return {};
  }
  return JSON.parse(text);
}

async function sendEvent(eventName) {
  const eventTime = $("eventTime").value.trim() || beijingNowText();
  let payload = { event_time: eventTime };
  if (eventName === "fixture-ready") {
    payload = {
      success_id: $("success_id").value.trim() || "OK",
      event_time: eventTime,
    };
  }
  if (eventName === "experiment-result") {
    payload.result_package = readResultPackage();
  }
  await requestJson(`/api/events/${eventName}`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  await Promise.all([refreshState(), refreshLogs()]);
}

function bindEvents() {
  $("telemetryTab").addEventListener("click", () => setWorkspacePage("telemetry"));
  $("workflowTab").addEventListener("click", () => setWorkspacePage("workflow"));
  $("telemetryGrid").addEventListener("click", (event) => {
    const button = event.target.closest("[data-telemetry-action]");
    const card = button?.closest("[data-lab-code]");
    if (!button || !card) {
      return;
    }
    button.disabled = true;
    updateTelemetryCard(card, button.dataset.telemetryAction)
      .catch((error) => showNotice("遥测设置失败", error.message))
      .finally(() => { button.disabled = false; });
  });
  document.querySelectorAll("#host, #port, #topicPrefix, #labCode, #username, #password").forEach((field) => {
    field.addEventListener("input", () => {
      state.configDirty = true;
    });
    field.addEventListener("change", () => {
      state.configDirty = true;
    });
  });
  $("connectBtn").addEventListener("click", () => connect({ showSuccess: true }).catch(alert));
  $("disconnectBtn").addEventListener("click", () => disconnect().catch(alert));
  $("refreshBtn").addEventListener("click", () => refreshDashboard({ forceLogs: true }).catch(alert));
  $("copyLogsBtn").addEventListener("click", () => copyAllLogs().catch(alert));
  $("pauseLogsBtn").addEventListener("click", () => {
    state.logAutoRefreshPaused = !state.logAutoRefreshPaused;
    updateLogControls();
    if (!state.logAutoRefreshPaused && state.pendingLogs) {
      renderLogs(state.pendingLogs, { force: true });
    }
  });
  $("logUpdateNotice").addEventListener("click", () => {
    renderLogs(state.pendingLogs || state.latestLogs, { force: true });
  });
  $("showMoreLogsBtn").addEventListener("click", () => {
    state.visibleLogLimit += LOG_PAGE_SIZE;
    renderLogs(state.latestLogs, { force: true, preserveScroll: true });
  });
  $("logs").addEventListener("click", (event) => {
    const button = event.target.closest("[data-log-index]");
    if (!button) {
      return;
    }
    copyLogEntry(Number(button.dataset.logIndex), button).catch(alert);
  });
  document.addEventListener("selectionchange", () => {
    if (selectionIsInsideLogs() || state.logAutoRefreshPaused || !state.pendingLogs) {
      return;
    }
    window.setTimeout(() => {
      if (!selectionIsInsideLogs() && !isReviewingOlderLogs() && !state.logAutoRefreshPaused && state.pendingLogs) {
        renderLogs(state.pendingLogs, { force: true });
      }
    }, 200);
  });
  $("labCode").addEventListener("change", updateLabCodeHint);
  $("modeSwitch").addEventListener("click", (event) => {
    const bounds = $("modeSwitch").getBoundingClientRect();
    const enableAuto = event.clientX >= bounds.left + bounds.width / 2;
    setAutoMode(enableAuto);
    state.pendingAutoMode = enableAuto;
    state.configDirty = false;
    if (enableAuto || state.connected) {
      connect({ showSuccess: true }).catch(alert);
    }
  });
  $("modeSwitch").addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== " " && event.key !== "Enter") {
      return;
    }
    event.preventDefault();
    const enableAuto = event.key === "ArrowRight" || event.key === " " || event.key === "Enter"
      ? !$("autoMode").checked
      : false;
    setAutoMode(enableAuto);
    state.pendingAutoMode = enableAuto;
    state.configDirty = false;
    if (enableAuto || state.connected) {
      connect({ showSuccess: true }).catch(alert);
    }
  });
  $("noticeOkBtn").addEventListener("click", hideNotice);
  $("noticeDialog").addEventListener("click", (event) => {
    if (event.target === $("noticeDialog")) {
      hideNotice();
    }
  });
  document.querySelectorAll("[data-event]").forEach((button) => {
    button.addEventListener("click", () => sendEvent(button.dataset.event).catch(alert));
  });
}

renderLabOptions();
bindEvents();
setWorkspacePage("telemetry");
setAutoMode(shouldStartInAutoMode());
Promise.all([refreshState(), refreshLogs()])
  .then(() => {
    if (shouldStartInAutoMode() && (!state.connected || !$("autoMode").checked)) {
      setAutoMode(true);
      return connect({ showSuccess: true });
    }
    return null;
  })
  .catch(console.error);
setInterval(() => {
  refreshDashboard().catch(console.error);
}, 1000);
