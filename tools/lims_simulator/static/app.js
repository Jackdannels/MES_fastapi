const $ = (id) => document.getElementById(id);
const EXPERIMENT_TYPES = ["冲击试验", "振动试验", "四综合试验", "温度冲击试验", "高低温湿热试验", "盐雾试验", "霉菌试验"];
const AXIS_AWARE_EXPERIMENT_TYPES = new Set(["冲击试验", "振动试验"]);
const DEFAULT_AXIS_CODES = ["x+", "x-", "y+", "y-", "z+", "z-"];
let selectedTestTypes = [];
let selectedAxisCodesByTestType = {};
let draftTestTypes = [];
let draftAxisCodesByTestType = {};
let axisPickerType = "";
let axisPickerCodes = [];

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

function uniqueTextValues(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || "").trim()).filter(Boolean))];
}

function normalizeAxisCodes(values) {
  const source = Array.isArray(values) ? values : String(values || "").split(/[,，/、\s]+/);
  const uniqueCodes = uniqueTextValues(source.map((value) => String(value).toLowerCase()));
  return [...DEFAULT_AXIS_CODES.filter((code) => uniqueCodes.includes(code)), ...uniqueCodes.filter((code) => !DEFAULT_AXIS_CODES.includes(code))];
}

function normalizeAxisMap(axisMap, testTypes) {
  const source = axisMap && typeof axisMap === "object" ? axisMap : {};
  return uniqueTextValues(testTypes).reduce((result, testType) => {
    if (!AXIS_AWARE_EXPERIMENT_TYPES.has(testType)) return result;
    const axisCodes = normalizeAxisCodes(source[testType]);
    if (axisCodes.length) result[testType] = axisCodes;
    return result;
  }, {});
}

function cloneAxisMap(axisMap) {
  return Object.fromEntries(Object.entries(axisMap || {}).map(([testType, axisCodes]) => [testType, [...axisCodes]]));
}

function buildTestTypesSummary(testTypes, axisMap = {}) {
  return uniqueTextValues(testTypes).map((testType) => {
    const axisCodes = normalizeAxisCodes(axisMap[testType]);
    return AXIS_AWARE_EXPERIMENT_TYPES.has(testType) && axisCodes.length
      ? `${testType}（${axisCodes.map((code) => code.toUpperCase()).join("、")}）`
      : testType;
  }).join(" / ");
}

function syncSelectedTestTypes(testTypes, axisMap = {}) {
  selectedTestTypes = uniqueTextValues(testTypes);
  selectedAxisCodesByTestType = normalizeAxisMap(axisMap, selectedTestTypes);
  const summary = buildTestTypesSummary(selectedTestTypes, selectedAxisCodesByTestType);
  $("testTypes").value = selectedTestTypes.join(" / ");
  $("testTypesSummary").textContent = summary || "请选择试验类型";
  $("testTypesTrigger").classList.toggle("is-empty", !summary);
}

function setSelectionValidation(id, message = "") {
  $(id).textContent = message;
  $(id).hidden = !message;
}

function syncModalState() {
  const hasOpenModal = !$("testTypesModal").hidden || !$("axisModal").hidden;
  document.body.classList.toggle("has-modal", hasOpenModal);
}

function renderTestTypesPicker() {
  $("testTypesDraftSummary").textContent = buildTestTypesSummary(draftTestTypes, draftAxisCodesByTestType) || "请选择试验类型";
  $("testTypesGrid").innerHTML = EXPERIMENT_TYPES.map((testType) => {
    const selected = draftTestTypes.includes(testType);
    return `<button class="test-type-card${selected ? " is-selected" : ""}" type="button" data-test-type="${escapeHtml(testType)}" aria-pressed="${selected}"><span class="test-type-card__name">${escapeHtml(testType)}</span><span class="test-type-card__check${selected ? " is-selected" : ""}" aria-hidden="true">${selected ? "✓" : ""}</span></button>`;
  }).join("");
}

function openTestTypesPicker() {
  draftTestTypes = [...selectedTestTypes];
  draftAxisCodesByTestType = cloneAxisMap(selectedAxisCodesByTestType);
  setSelectionValidation("testTypesValidation");
  renderTestTypesPicker();
  $("testTypesModal").hidden = false;
  $("testTypesTrigger").setAttribute("aria-expanded", "true");
  syncModalState();
  $("testTypesModal").querySelector(".selection-modal__dialog").focus();
}

function closeTestTypesPicker({ restoreFocus = true } = {}) {
  if (!$("axisModal").hidden) closeAxisPicker({ restoreFocus: false });
  $("testTypesModal").hidden = true;
  $("testTypesTrigger").setAttribute("aria-expanded", "false");
  setSelectionValidation("testTypesValidation");
  syncModalState();
  if (restoreFocus) $("testTypesTrigger").focus();
}

function renderAxisPicker() {
  $("axisExperimentType").textContent = axisPickerType || "-";
  $("axisGrid").innerHTML = DEFAULT_AXIS_CODES.map((axisCode) => {
    const selected = axisPickerCodes.includes(axisCode);
    return `<button class="axis-option${selected ? " is-selected" : ""}" type="button" data-axis-code="${axisCode}" aria-pressed="${selected}">${axisCode.toUpperCase()}</button>`;
  }).join("");
}

function openAxisPicker(testType) {
  axisPickerType = testType;
  const currentCodes = normalizeAxisCodes(draftAxisCodesByTestType[testType]);
  axisPickerCodes = currentCodes.length ? currentCodes : [...DEFAULT_AXIS_CODES];
  setSelectionValidation("axisValidation");
  renderAxisPicker();
  $("testTypesModal").setAttribute("inert", "");
  $("axisModal").hidden = false;
  syncModalState();
  $("axisModal").querySelector(".selection-modal__dialog").focus();
}

function closeAxisPicker({ restoreFocus = true } = {}) {
  const closingType = axisPickerType;
  $("axisModal").hidden = true;
  $("testTypesModal").removeAttribute("inert");
  axisPickerType = "";
  axisPickerCodes = [];
  setSelectionValidation("axisValidation");
  syncModalState();
  if (restoreFocus) [...$("testTypesGrid").querySelectorAll("[data-test-type]")].find((option) => option.dataset.testType === closingType)?.focus();
}

function toggleDraftTestType(testType) {
  if (draftTestTypes.includes(testType)) {
    draftTestTypes = draftTestTypes.filter((value) => value !== testType);
    delete draftAxisCodesByTestType[testType];
    renderTestTypesPicker();
    return;
  }
  if (AXIS_AWARE_EXPERIMENT_TYPES.has(testType)) {
    openAxisPicker(testType);
    return;
  }
  draftTestTypes.push(testType);
  renderTestTypesPicker();
}

function confirmAxisPicker() {
  const confirmedType = axisPickerType;
  const axisCodes = normalizeAxisCodes(axisPickerCodes);
  if (!axisCodes.length) {
    setSelectionValidation("axisValidation", "请选择至少一个试验轴向");
    return;
  }
  if (!draftTestTypes.includes(axisPickerType)) draftTestTypes.push(axisPickerType);
  draftAxisCodesByTestType[axisPickerType] = axisCodes;
  closeAxisPicker({ restoreFocus: false });
  renderTestTypesPicker();
  [...$("testTypesGrid").querySelectorAll("[data-test-type]")].find((option) => option.dataset.testType === confirmedType)?.focus();
}

function confirmTestTypesPicker() {
  if (!draftTestTypes.length) {
    setSelectionValidation("testTypesValidation", "请选择至少一个试验类型");
    return;
  }
  syncSelectedTestTypes(draftTestTypes, draftAxisCodesByTestType);
  closeTestTypesPicker();
}

function trapModalFocus(event, modal) {
  if (event.key !== "Tab") return;
  const focusable = [...modal.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])')].filter((element) => !element.hidden);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable.at(-1);
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
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
  syncSelectedTestTypes(task.test_types || [], task.axis_codes_by_test_type || task.axisCodesByTestType || {});
  setDueValue(dueAt.date ? `${dueAt.date} ${dueAt.hour}:${dueAt.minute}` : "");
  closeDuePicker();
  $("conditions").value = task.conditions || "";
  $("attachment").value = task.attachment || "";
  $("remark").value = task.remark || "";
}

function readForm() {
  const testTypes = [...selectedTestTypes];
  return {
    code: $("code").value.trim(), name: $("name").value.trim(), client: $("client").value.trim(),
    contact: $("contact").value.trim(), contact_info: $("contactInfo").value.trim(), priority: $("priority").value,
    sample_count: $("sampleCount").value, sample_type: $("sampleType").value.trim(), test_types: testTypes,
    test_type: testTypes.join(" / "), required_device: testTypes.join(" / "),
    axis_codes_by_test_type: cloneAxisMap(selectedAxisCodesByTestType),
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
  if (!selectedTestTypes.length) {
    feedback("请选择至少一个试验类型。", true);
    openTestTypesPicker();
    return;
  }
  const missingAxisType = selectedTestTypes.find((testType) => AXIS_AWARE_EXPERIMENT_TYPES.has(testType) && !normalizeAxisCodes(selectedAxisCodesByTestType[testType]).length);
  if (missingAxisType) {
    feedback(`请为${missingAxisType}选择至少一个试验轴向。`, true);
    openTestTypesPicker();
    openAxisPicker(missingAxisType);
    return;
  }
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
$("testTypesTrigger").addEventListener("click", openTestTypesPicker);
$("testTypesGrid").addEventListener("click", (event) => {
  const option = event.target.closest("[data-test-type]");
  if (option) toggleDraftTestType(option.dataset.testType);
});
$("testTypesClose").addEventListener("click", () => closeTestTypesPicker());
$("testTypesCancel").addEventListener("click", () => closeTestTypesPicker());
$("testTypesConfirm").addEventListener("click", confirmTestTypesPicker);
$("testTypesModal").querySelector("[data-close-test-types]").addEventListener("click", () => closeTestTypesPicker());
$("axisGrid").addEventListener("click", (event) => {
  const option = event.target.closest("[data-axis-code]");
  if (!option) return;
  const axisCode = option.dataset.axisCode;
  axisPickerCodes = axisPickerCodes.includes(axisCode) ? axisPickerCodes.filter((value) => value !== axisCode) : [...axisPickerCodes, axisCode];
  setSelectionValidation("axisValidation");
  renderAxisPicker();
});
$("axisClose").addEventListener("click", () => closeAxisPicker());
$("axisCancel").addEventListener("click", () => closeAxisPicker());
$("axisConfirm").addEventListener("click", confirmAxisPicker);
$("axisModal").querySelector("[data-close-axis]").addEventListener("click", () => closeAxisPicker());
[$("testTypesModal"), $("axisModal")].forEach((modal) => modal.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    if (modal === $("axisModal")) closeAxisPicker();
    else closeTestTypesPicker();
    return;
  }
  trapModalFocus(event, modal);
}));
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
