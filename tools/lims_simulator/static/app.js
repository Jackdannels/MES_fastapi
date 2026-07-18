const $ = (id) => document.getElementById(id);

async function requestJson(path, options = {}) {
  const response = await fetch(path, { headers: { "Content-Type": "application/json" }, ...options });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(data.detail || response.statusText);
  return data;
}

function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function splitLocalDateTime(value) {
  const normalized = String(value || "").trim().replace(" ", "T").slice(0, 16);
  const [date = "", time = ""] = normalized.split("T");
  const [hour = "00", minute = "00"] = time.split(":");
  return { date, hour, minute };
}

const duePickerState = {
  cursor: new Date(),
  date: "",
  hour: "00",
  minute: "00",
};
const wheelOffsets = [-2, -1, 0, 1, 2];

function toDateValue(date) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

function parseDateValue(value) {
  const matched = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!matched) return null;
  const date = new Date(Number(matched[1]), Number(matched[2]) - 1, Number(matched[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

function setDueValue(value) {
  const parsed = splitLocalDateTime(value);
  $("dueAt").value = parsed.date ? `${parsed.date} ${parsed.hour}:${parsed.minute}` : "";
  $("dueDisplay").textContent = parsed.date
    ? `${parsed.date.replaceAll("-", " / ")} ${parsed.hour}:${parsed.minute}`
    : "年 / 月 / 日 --:--";
  $("duePickerTrigger").classList.toggle("is-empty", !parsed.date);
}

function renderDueCalendar() {
  const year = duePickerState.cursor.getFullYear();
  const month = duePickerState.cursor.getMonth();
  const first = new Date(year, month, 1);
  const mondayOffset = (first.getDay() + 6) % 7;
  const start = new Date(year, month, 1 - mondayOffset);
  const today = toDateValue(new Date());
  $("dueCalendarMonth").textContent = `${year}年${month + 1}月`;
  $("dueCalendarDays").innerHTML = Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index);
    const value = toDateValue(date);
    const classes = ["due-calendar__day"];
    if (date.getMonth() !== month) classes.push("is-muted");
    if (value === today) classes.push("is-today");
    if (value === duePickerState.date) classes.push("is-selected");
    return `<button class="${classes.join(" ")}" type="button" data-date-value="${value}">${date.getDate()}</button>`;
  }).join("");
}

function buildWheelItems(selectedValue, size) {
  const selected = Number.parseInt(selectedValue, 10) || 0;
  return wheelOffsets.map((offset) => {
    const value = String((selected + offset + size) % size).padStart(2, "0");
    return `<button class="due-time__wheel-item${offset === 0 ? " is-selected" : ""}" type="button" role="option" aria-selected="${offset === 0}" data-distance="${Math.abs(offset)}" data-wheel-value="${value}" tabindex="-1">${value}</button>`;
  }).join("");
}

function renderDueTimeWheels() {
  $("dueHourWheel").innerHTML = buildWheelItems(duePickerState.hour, 24);
  $("dueMinuteWheel").innerHTML = buildWheelItems(duePickerState.minute, 60);
}

function renderDuePicker() {
  renderDueCalendar();
  renderDueTimeWheels();
}

function openDuePicker() {
  const parsed = splitLocalDateTime($("dueAt").value);
  const now = new Date();
  duePickerState.date = parsed.date || toDateValue(now);
  duePickerState.hour = parsed.date ? parsed.hour : String(now.getHours()).padStart(2, "0");
  duePickerState.minute = parsed.date ? parsed.minute : String(now.getMinutes()).padStart(2, "0");
  duePickerState.cursor = parseDateValue(duePickerState.date) || now;
  renderDuePicker();
  $("duePicker").hidden = false;
  $("duePickerTrigger").setAttribute("aria-expanded", "true");
}

function closeDuePicker() {
  $("duePicker").hidden = true;
  $("duePickerTrigger").setAttribute("aria-expanded", "false");
}

function shiftDueMonth(delta) {
  duePickerState.cursor = new Date(duePickerState.cursor.getFullYear(), duePickerState.cursor.getMonth() + delta, 1);
  renderDueCalendar();
}

function selectDueTimePart(part, value) {
  duePickerState[part] = value;
  renderDueTimeWheels();
}

function shiftDueTimePart(part, delta) {
  const size = part === "hour" ? 24 : 60;
  const current = Number.parseInt(duePickerState[part], 10) || 0;
  selectDueTimePart(part, String((current + delta + size) % size).padStart(2, "0"));
}

function fillForm(task) {
  const dueAt = splitLocalDateTime(task.due_at);
  $("code").value = task.code || "";
  $("name").value = task.name || "";
  $("client").value = task.client || "";
  $("contact").value = task.contact || "";
  $("contactInfo").value = task.contact_info || "";
  $("priority").value = task.priority || "中";
  $("sampleCount").value = task.sample_count || "";
  $("sampleType").value = task.sample_type || "";
  $("testTypes").value = (task.test_types || []).join(" / ");
  setDueValue(dueAt.date ? `${dueAt.date} ${dueAt.hour}:${dueAt.minute}` : "");
  closeDuePicker();
  $("conditions").value = task.conditions || "";
  $("attachment").value = task.attachment || "";
  $("remark").value = task.remark || "";
}

function readForm() {
  const testTypes = $("testTypes").value.split("/").map((item) => item.trim()).filter(Boolean);
  return {
    code: $("code").value.trim(), name: $("name").value.trim(), client: $("client").value.trim(),
    contact: $("contact").value.trim(), contact_info: $("contactInfo").value.trim(), priority: $("priority").value,
    sample_count: $("sampleCount").value, sample_type: $("sampleType").value.trim(), test_types: testTypes,
    test_type: testTypes.join(" / "), required_device: testTypes.join(" / "),
    due_at: $("dueAt").value, arrival_at: "", conditions: $("conditions").value.trim(),
    attachment: $("attachment").value.trim(), remark: $("remark").value.trim(), source: "外部委托",
  };
}

function setBusy(busy) {
  ["generateBtn", "sendBtn", "batchBtn"].forEach((id) => { $(id).disabled = busy; });
}

function feedback(message, error = false) {
  $("feedback").textContent = message;
  $("feedback").classList.toggle("is-error", error);
}

async function refreshState() {
  const state = await requestJson("/api/state");
  $("versionBadge").textContent = `v${state.version || "1.0"}`;
  $("mesUrl").textContent = state.rabbitmq_url || "-";
  $("pendingCount").textContent = state.pending_count ?? 0;
  $("sentCount").textContent = state.sent_count ?? 0;
  $("statusBadge").textContent = state.connected ? "RabbitMQ 已连接" : "RabbitMQ 未连接";
  $("statusBadge").classList.toggle("is-connected", Boolean(state.connected));
}

async function refreshLogs() {
  const data = await requestJson("/api/logs");
  $("logs").innerHTML = (data.logs || []).map((entry) => `<article class="log log-${escapeHtml(entry.level)}"><div><strong>${escapeHtml(entry.message)}</strong><span>${escapeHtml(entry.time)}</span></div>${entry.payload ? `<pre>${escapeHtml(JSON.stringify(entry.payload, null, 2))}</pre>` : ""}</article>`).join("") || '<div class="empty">暂无日志</div>';
}

async function generate({ announce = true } = {}) {
  setBusy(true);
  try {
    fillForm(await requestJson("/api/tasks/generate", { method: "POST" }));
    if (announce) feedback("已生成新的模拟委托。");
  }
  finally { setBusy(false); }
}

async function sendCurrent() {
  if (!$("taskForm").reportValidity()) return;
  if (!$("dueAt").value) {
    feedback("请选择期望完成时间。", true);
    openDuePicker();
    return;
  }
  setBusy(true);
  try {
    const result = await requestJson("/api/tasks/send", { method: "POST", body: JSON.stringify(readForm()) });
    await Promise.all([refreshState(), refreshLogs()]);
    await generate({ announce: false });
    feedback(`已发布 ${result.code}，请在 MES 外部受理中确认。`);
  } catch (error) { feedback(error.message, true); }
  finally { setBusy(false); }
}

async function sendBatch() {
  setBusy(true);
  try {
    const count = Number($("batchCount").value || 1);
    const result = await requestJson("/api/tasks/send-random", { method: "POST", body: JSON.stringify({ count }) });
    await Promise.all([refreshState(), refreshLogs(), generate({ announce: false })]);
    feedback(`已批量下发 ${result.count} 条外部委托。`);
  } catch (error) { feedback(error.message, true); }
  finally { setBusy(false); }
}

$("generateBtn").addEventListener("click", () => generate().catch((error) => feedback(error.message, true)));
$("sendBtn").addEventListener("click", sendCurrent);
$("batchBtn").addEventListener("click", sendBatch);
$("refreshBtn").addEventListener("click", () => Promise.all([refreshState(), refreshLogs()]).catch((error) => feedback(error.message, true)));
$("duePickerTrigger").addEventListener("click", openDuePicker);
$("duePrevMonth").addEventListener("click", () => shiftDueMonth(-1));
$("dueNextMonth").addEventListener("click", () => shiftDueMonth(1));
$("dueCalendarDays").addEventListener("click", (event) => {
  const day = event.target.closest("[data-date-value]");
  if (!day) return;
  duePickerState.date = day.dataset.dateValue;
  renderDueCalendar();
});
[["dueHourWheel", "hour"], ["dueMinuteWheel", "minute"]].forEach(([id, part]) => {
  $(id).addEventListener("click", (event) => {
    const option = event.target.closest("[data-wheel-value]");
    if (option) selectDueTimePart(part, option.dataset.wheelValue);
  });
  $(id).addEventListener("wheel", (event) => {
    event.preventDefault();
    const direction = Math.sign(event.deltaY);
    if (direction) shiftDueTimePart(part, direction);
  }, { passive: false });
  $(id).addEventListener("keydown", (event) => {
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      shiftDueTimePart(part, event.key === "ArrowDown" ? 1 : -1);
    }
  });
});
$("dueClear").addEventListener("click", () => { setDueValue(""); closeDuePicker(); });
$("dueCancel").addEventListener("click", closeDuePicker);
$("dueConfirm").addEventListener("click", () => {
  setDueValue(`${duePickerState.date} ${duePickerState.hour}:${duePickerState.minute}`);
  closeDuePicker();
});
$("duePicker").addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    closeDuePicker();
  }
});
document.addEventListener("pointerdown", (event) => {
  if (!$("duePicker").hidden && !event.target.closest(".due-at-field")) closeDuePicker();
});
Promise.all([refreshState(), refreshLogs(), generate()]).catch((error) => feedback(error.message, true));
setInterval(() => Promise.all([refreshState(), refreshLogs()]).catch(() => {}), 2000);
