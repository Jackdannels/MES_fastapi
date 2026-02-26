/* FILE: actions.js
 * UI action handlers for tasks, scheduling, and samples.
 * Mutates localStorage via storage.js and triggers UI re-render.
 */
import { STORAGE_KEYS, loadStore, saveStore } from "./storage.js";
import { TEST_LABS, TEST_PREFIX_MAP, getLabsForTestType } from "./labs.js";
import { formatDateTime, generateId, getFormData } from "./utils.js";
import { renderAll, renderSampleTrace } from "./render.js";

// Default time slots for manual scheduling.
const SLOT_RANGES = {
  morning: { start: "08:00", end: "11:30" },
  afternoon: { start: "13:30", end: "17:00" },
};

const TEST_TASK_TYPES = Object.keys(TEST_PREFIX_MAP);

// formatLocalDate閿涙碍鐗稿蹇撳閺堫剙婀撮弮銉︽埂
function formatLocalDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// formatLocalTime閿涙碍鐗稿蹇撳閺堫剙婀撮弮鍫曟？
function formatLocalTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

// toDateTimeLocalValue閿涙俺娴嗛幑顫礋datetime-local鏉堟挸鍙嗛崐?
function toDateTimeLocalValue(value) {
  if (!value) {
    return "";
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.includes("T")) {
      return trimmed.slice(0, 16);
    }
    if (trimmed.includes(" ")) {
      return trimmed.replace(" ", "T").slice(0, 16);
    }
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toISOString().slice(0, 16);
}

// escapeSelectorValue閿涙俺娴嗘稊澶愨偓澶嬪閸ｃ劌鈧?
function escapeSelectorValue(value) {
  if (window.CSS && typeof window.CSS.escape === "function") {
    return window.CSS.escape(value);
  }
  return value.replace(/["\\]/g, "\\$&");
}

// overlaps閿涙艾鍨介弬顓熸闂傛潙灏梻瀛樻Ц閸氾箓鍣搁崣?
function overlaps(start, end, rangeStart, rangeEnd) {
  return start < rangeEnd && end > rangeStart;
}

// parseCodeList閿涙俺袙閺嬫劗绱崣宄板灙鐞?
function parseCodeList(value) {
  return (value || "")
    .split(/[\s,;]+/)
    .map((code) => code.trim())
    .filter(Boolean);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildTaskSampleCodes(taskCode, plannedCount, taskSamples) {
  const code = (taskCode || "").trim();
  if (!code) {
    return [];
  }
  const list = Array.isArray(taskSamples) ? taskSamples : [];
  const existingCodes = Array.from(
    new Set(
      list
        .map((item) => (item?.code || "").trim())
        .filter(Boolean)
    )
  );
  const pattern = new RegExp(`^${escapeRegExp(code)}-SP-(\\d{3})$`);
  let maxIndex = 0;
  existingCodes.forEach((itemCode) => {
    const match = itemCode.match(pattern);
    if (!match) {
      return;
    }
    const index = Number.parseInt(match[1], 10);
    if (Number.isFinite(index)) {
      maxIndex = Math.max(maxIndex, index);
    }
  });
  let targetCount = Number.isFinite(plannedCount) && plannedCount > 0 ? Math.floor(plannedCount) : existingCodes.length;
  if (targetCount <= 0 && maxIndex > 0) {
    targetCount = maxIndex;
  }
  const generatedCodes = [];
  for (let index = 1; index <= targetCount; index += 1) {
    generatedCodes.push(`${code}-SP-${String(index).padStart(3, "0")}`);
  }
  return generatedCodes;
}

function nextTaskSampleCode(taskCode, samples) {
  const code = (taskCode || "").trim();
  if (!code) {
    return "";
  }
  const list = Array.isArray(samples) ? samples : [];
  const taskSamples = list.filter((item) => (item?.task_code || "").trim() === code);
  const pattern = new RegExp(`^${escapeRegExp(code)}-SP-(\\d{3})$`);
  let maxIndex = 0;
  taskSamples.forEach((item) => {
    const sampleCode = (item?.code || "").trim();
    const match = sampleCode.match(pattern);
    if (!match) {
      return;
    }
    const index = Number.parseInt(match[1], 10);
    if (Number.isFinite(index)) {
      maxIndex = Math.max(maxIndex, index);
    }
  });
  return `${code}-SP-${String(maxIndex + 1).padStart(3, "0")}`;
}

function buildSampleTrayCode(sampleCode, serial) {
  const code = (sampleCode || "").trim();
  const index = Number.parseInt(serial, 10);
  if (!code || !Number.isFinite(index) || index <= 0) {
    return "";
  }
  return `${code}-TP-${String(index).padStart(3, "0")}`;
}

function buildTaskTrayCode(taskCode, serial) {
  const code = (taskCode || "").trim();
  const index = Number.parseInt(serial, 10);
  if (!code || !Number.isFinite(index) || index <= 0) {
    return "";
  }
  return `${code}-TP-${String(index).padStart(3, "0")}`;
}

function parseSampleTrayPlan(value) {
  const lines = String(value || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const entries = [];
  const errors = [];
  lines.forEach((line, index) => {
    const lineNo = index + 1;
    const parts = line
      .split(/[,\uff0c;\uff1b|\t]+/)
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length < 2) {
      errors.push(`第 ${lineNo} 行格式错误，应为“样品编号,托盘数量[,托盘编号]”。`);
      return;
    }
    let sampleCode = parts[0];
    let quantityText = parts[1];
    let trayCode = parts[2] || "";
    if (parts.length >= 3 && /-TP-\d{3}$/i.test(parts[0])) {
      trayCode = parts[0];
      sampleCode = parts[1];
      quantityText = parts[2];
    }
    const quantity = Number.parseInt(quantityText, 10);
    if (!sampleCode) {
      errors.push(`第 ${lineNo} 行缺少样品编号。`);
      return;
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      errors.push(`第 ${lineNo} 行托盘数量必须为正整数。`);
      return;
    }
    entries.push({
      lineNo,
      sampleCode,
      quantity: Math.floor(quantity),
      trayCode: (trayCode || "").trim(),
    });
  });
  return { entries, errors };
}

function getSampleTrays(sample) {
  if (!sample || !Array.isArray(sample.trays)) {
    return [];
  }
  const sampleCode = (sample.code || "").trim();
  return sample.trays
    .filter((tray) => {
      if (!tray) {
        return false;
      }
      const traySampleCode = (tray.sample_code || sampleCode || "").trim();
      const quantity = Number.parseInt(tray.quantity, 10);
      return traySampleCode === sampleCode && Number.isFinite(quantity) && quantity > 0;
    })
    .map((tray, index) => ({
      id: tray.id || generateId("tray"),
      tray_code: (tray.tray_code || "").trim() || buildSampleTrayCode(sampleCode, index + 1),
      sample_code: sampleCode,
      quantity: Math.floor(Number.parseInt(tray.quantity, 10)),
      created_at: tray.created_at || sample.created_at || new Date().toISOString(),
      updated_at: tray.updated_at || sample.updated_at || sample.created_at || new Date().toISOString(),
    }));
}

// attachActionHandlers閿涙氨绮︾€规岸銆夐棃銏犲З娴ｆ粈绨ㄦ禒?
function attachActionHandlers(labels) {
  // setWarning閿涙俺顔曠純顔裤€冮崡鏇☆劅閸涘﹥褰佺粈?
  const setWarning = (element, message) => {
    if (!element) {
      return;
    }
    if (message) {
      element.textContent = message;
      element.classList.remove("is-hidden");
      return;
    }
    element.textContent = "";
    element.classList.add("is-hidden");
  };
  const bindClickOnce = (element, boundKey, handler) => {
    if (!element || element.dataset[boundKey] === "1") {
      return;
    }
    element.addEventListener("click", handler);
    element.dataset[boundKey] = "1";
  };

  const taskWarning = document.querySelector("[data-task-warning]");
  const taskQuickWarning = document.querySelector("[data-task-quick-warning]");
  const sampleWarning = document.querySelector("[data-sample-warning]");
  const sampleProcessWarning = document.querySelector("[data-sample-process-warning]");
  const scheduleWarning = document.querySelector("[data-schedule-warning]");
  const scheduleEditWarning = document.querySelector("[data-schedule-edit-warning]");
  const stagingWarning = document.querySelector("[data-staging-warning]");
  const unpackingWarning = document.querySelector("[data-unpacking-warning]");
  const retentionWarning = document.querySelector("[data-retention-warning]");
  const taskEditWarning = document.querySelector("[data-task-edit-warning]");
  const testingRandom = document.body?.dataset?.testingRandom === "1";
  const randomTaskYear = document.body?.dataset?.randomTaskYear || "2026";

  // getSlotLabel閿涙俺骞忛崣鏍ㄦ濞堝灚妯夌粈鐑樻瀮濡?
  const getSlotLabel = (slotKey) => (slotKey === "afternoon" ? labels.slotAfternoon : labels.slotMorning);

  // resolveSampleStatus閿涙碍鐗撮幑顔荤秴缂冾喗甯圭€靛吋鐗遍崫浣哄Ц閹?
  const resolveSampleStatus = (location) => {
    const preRetentionLocation = labels.preRetentionLocation || labels.retentionLocation;
    const postRetentionLocation = labels.postRetentionLocation || "";
    if (location === postRetentionLocation) {
      return labels.sampleStored || "已入库";
    }
    if (location === preRetentionLocation || location === labels.unpackingLocation || location === labels.intakeLocation) {
      return labels.sampleReceived;
    }
    if (TEST_LABS.includes(location)) {
      return labels.sampleTesting;
    }
    return labels.sampleReceived;
  };

  const resolveFlowStatusByLocation = (location, status = "") => {
    const preRetentionLocation = labels.preRetentionLocation || labels.retentionLocation;
    const postRetentionLocation = labels.postRetentionLocation || "";
    const isPostRetention = Boolean(postRetentionLocation) && location === postRetentionLocation;
    const isPreRetention = Boolean(preRetentionLocation) && location === preRetentionLocation;
    const currentStatus = (status || "").trim();
    if (currentStatus === "厂家收回" || currentStatus === "已处置") {
      return "厂家收回";
    }
    if (currentStatus === "放置暂存间") {
      return "放置暂存间";
    }
    if (currentStatus === "入库" || currentStatus === "已入库" || currentStatus === labels.sampleStored) {
      return isPostRetention ? "放置暂存间" : "到货";
    }
    if (currentStatus === "实验完成" || currentStatus === labels.statusCompleted || currentStatus === "实验已完成") {
      return "实验完成";
    }
    if (currentStatus === "实验准备就绪") {
      return "实验准备就绪";
    }
    if (isPostRetention) {
      return "放置暂存间";
    }
    if (isPreRetention) {
      return "到货";
    }
    if (TEST_LABS.includes(location)) {
      return "到达实验间";
    }
    if (location === labels.unpackingLocation || location === labels.intakeLocation) {
      return "到货";
    }
    return "运输中";
  };

  // ensureSampleHistory閿涙氨鈥樻穱婵囩壉閸濅礁宸婚崣鍙夋殶缂?
  const ensureSampleHistory = (sample) => {
    if (!Array.isArray(sample.history)) {
      sample.history = [];
    }
  };

  // appendSampleHistory閿涙俺鎷烽崝鐘崇壉閸濅礁宸婚崣鑼额唶瑜?
  const appendSampleHistory = (sample, action, detail = "") => {
    ensureSampleHistory(sample);
    sample.history.unshift({
      id: generateId("sample-event"),
      time: new Date().toISOString(),
      action,
      location: sample.location || "",
      owner: sample.owner || "",
      status: sample.status || "",
      detail,
    });
  };

  // ensureOption閿涙氨鈥樻穱婵呯瑓閹峰鈧銆嶇€涙ê婀?
  const ensureOption = (select, value) => {
    if (!select || !value) {
      return;
    }
    // exists閿涙碍顥呴弻銉┾偓澶愩€嶉弰顖氭儊瀹告彃鐡ㄩ崷?
    const exists = Array.from(select.options).some((option) => option.value === value);
    if (!exists) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value;
      select.appendChild(option);
    }
  };

  // nextTaskCode閿涙氨鏁撻幋鎰瑓娑撯偓娑擃亙鎹㈤崝锛勭椽閸?
  const nextTaskCode = (prefix, year, tasks) => {
    const pattern = new RegExp(`^${prefix}-${year}-(\\d{3})$`);
    let maxSeq = 0;
    tasks.forEach((task) => {
      if (!task.code) {
        return;
      }
      const match = task.code.match(pattern);
      if (match) {
        const seq = Number.parseInt(match[1], 10);
        if (!Number.isNaN(seq)) {
          maxSeq = Math.max(maxSeq, seq);
        }
      }
    });
    const next = String(maxSeq + 1).padStart(3, "0");
    return `${prefix}-${year}-${next}`;
  };

  // buildRandomTask閿涙碍鐎娲閺堣桨鎹㈤崝?
  const buildRandomTask = (tasks, statusOverride) => {
    const filteredTypes = TEST_TASK_TYPES.filter(
      (type) => !type.includes("恒温恒湿") && !type.includes("高低温湿热")
    );
    const pool = filteredTypes.length ? filteredTypes : TEST_TASK_TYPES;
    const testType = pool[Math.floor(Math.random() * pool.length)];
    const prefix = TEST_PREFIX_MAP[testType] || "TASK";
    const code = nextTaskCode(prefix, randomTaskYear, tasks);
    const now = new Date();
    const arrival = new Date(now.getTime() + (Math.floor(Math.random() * 6) + 1) * 60 * 60 * 1000);
    const due = new Date(arrival.getTime() + (Math.floor(Math.random() * 12) + 4) * 60 * 60 * 1000);
    return {
      id: generateId("task"),
      code,
      name: testType,
      source: labels.sourceExternal,
      priority: "Medium",
      sample_count: Math.floor(Math.random() * 8) + 3,
      sample_type: "",
      test_type: testType,
      required_device: testType,
      due_at: formatDateTime(due),
      arrival_at: formatDateTime(arrival),
      status: statusOverride || labels.statusWaiting,
      created_at: now.toISOString(),
    };
  };

  // resolveScheduleTimes閿涙俺袙閺嬫劖甯撶粙瀣闂傜繝淇婇幁?
  const resolveScheduleTimes = (data, warningEl) => {
    const dateValue = data.schedule_date || "";
    if (!dateValue) {
      setWarning(warningEl, labels.scheduleTimeInvalid);
      return null;
    }
    const slot = data.time_slot || "morning";
    let startTime = "";
    let endTime = "";
    if (slot === "custom") {
      startTime = data.custom_start || "";
      endTime = data.custom_end || "";
      if (!startTime || !endTime) {
        setWarning(warningEl, labels.scheduleCustomTimeRequired);
        return null;
      }
    } else {
      const range = SLOT_RANGES[slot] || SLOT_RANGES.morning;
      startTime = range.start;
      endTime = range.end;
    }
    const startAt = new Date(`${dateValue}T${startTime}:00`);
    const endAt = new Date(`${dateValue}T${endTime}:00`);
    if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime()) || endAt <= startAt) {
      setWarning(warningEl, labels.scheduleTimeInvalid);
      return null;
    }
    const now = new Date();
    if (endAt <= now) {
      setWarning(warningEl, labels.scheduleTimeInvalid);
      return null;
    }
    return { dateValue, slot, startTime, endTime, startAt, endAt };
  };

  // clearConflictHighlights閿涙碍绔婚梽銈呭暱缁愪線鐝禍?
  const clearConflictHighlights = () => {
    document.querySelectorAll(".gantt-slot.focus").forEach((slot) => slot.classList.remove("focus"));
  };

  // highlightConflictSlots閿涙岸鐝禍顔煎暱缁愪焦妞傚▓?
  const highlightConflictSlots = (device, dateValue, startAt, endAt) => {
    clearConflictHighlights();
    if (!device || !dateValue) {
      return;
    }
    const segments = [
      { key: "am", start: "08:00", end: "11:30" },
      { key: "pm", start: "13:30", end: "17:00" },
    ];
    segments.forEach((segment) => {
      const segStart = new Date(`${dateValue}T${segment.start}:00`);
      const segEnd = new Date(`${dateValue}T${segment.end}:00`);
      if (!overlaps(startAt, endAt, segStart, segEnd)) {
        return;
      }
      const selector = `.gantt-slot[data-device="${escapeSelectorValue(device)}"][data-date="${escapeSelectorValue(
        dateValue
      )}"][data-segment="${segment.key}"]`;
      document.querySelectorAll(selector).forEach((slot) => slot.classList.add("focus"));
    });
  };

  // buildSuggestion閿涙氨鏁撻幋鎰讲閻劍妞傚▓闈涚紦鐠?
  const buildSuggestion = (schedules, device, dateValue, ignoreId) => {
    if (!device || !dateValue) {
      return "";
    }
    const startDate = new Date(`${dateValue}T00:00:00`);
    if (Number.isNaN(startDate.getTime())) {
      return "";
    }
    // isSlotFree閿涙艾鍨介弬顓熸濞堝灚妲搁崥锔锯敄闂?
    const isSlotFree = (dayValue, range) =>
      !schedules.some((entry) => {
        if (ignoreId && entry.id === ignoreId) {
          return false;
        }
        if (entry.device !== device) {
          return false;
        }
        const existingStart = new Date(entry.start_at);
        const existingEnd = new Date(entry.end_at);
        if (Number.isNaN(existingStart.getTime()) || Number.isNaN(existingEnd.getTime())) {
          return false;
        }
        const slotStart = new Date(`${dayValue}T${range.start}:00`);
        const slotEnd = new Date(`${dayValue}T${range.end}:00`);
        return overlaps(slotStart, slotEnd, existingStart, existingEnd);
      });

    for (let offset = 0; offset < 7; offset += 1) {
      const date = new Date(startDate);
      date.setDate(startDate.getDate() + offset);
      const dayValue = formatLocalDate(date);
      const morningRange = SLOT_RANGES.morning;
      const afternoonRange = SLOT_RANGES.afternoon;
      if (isSlotFree(dayValue, morningRange)) {
        return `${labels.scheduleSuggestPrefix}${dayValue} ${getSlotLabel("morning")}`;
      }
      if (isSlotFree(dayValue, afternoonRange)) {
        return `${labels.scheduleSuggestPrefix}${dayValue} ${getSlotLabel("afternoon")}`;
      }
    }
    return `${labels.scheduleSuggestPrefix}${labels.scheduleSuggestNone}`;
  };

  // fillLabOptions閿涙艾锝為崗鍛杽妤犲苯顓绘稉瀣闁銆?
  const fillLabOptions = (select, labs, currentValue) => {
    if (!select) {
      return;
    }
    const placeholderText = select.dataset.placeholder || "Select lab";
    const emptyText = select.dataset.emptyPlaceholder || "No labs";
    const customText = select.dataset.customLabel || "Other/Custom";
    select.innerHTML = "";
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = labs.length ? placeholderText : emptyText;
    select.appendChild(placeholder);
    labs.forEach((lab) => {
      const option = document.createElement("option");
      option.value = lab;
      option.textContent = lab;
      select.appendChild(option);
    });
    if (labs.length) {
      const customOption = document.createElement("option");
      customOption.value = customText;
      customOption.textContent = customText;
      select.appendChild(customOption);
    }
    if (currentValue) {
      select.value = currentValue;
    }
  };

  const getTaskSampleSerial = (sampleCode, taskCode) => {
    const code = (sampleCode || "").trim();
    const task = (taskCode || "").trim();
    if (!code || !task) {
      return Number.POSITIVE_INFINITY;
    }
    const match = code.match(new RegExp(`^${escapeRegExp(task)}-SP-(\\d{3})$`));
    if (!match) {
      return Number.POSITIVE_INFINITY;
    }
    const serial = Number.parseInt(match[1], 10);
    return Number.isFinite(serial) ? serial : Number.POSITIVE_INFINITY;
  };

  const compareTaskSamples = (left, right, taskCode) => {
    const leftIndex = getTaskSampleSerial(left?.code, taskCode);
    const rightIndex = getTaskSampleSerial(right?.code, taskCode);
    if (leftIndex !== rightIndex) {
      return leftIndex - rightIndex;
    }
    const leftCreatedAt = new Date(left?.created_at || left?.updated_at || 0).getTime();
    const rightCreatedAt = new Date(right?.created_at || right?.updated_at || 0).getTime();
    if (leftCreatedAt !== rightCreatedAt) {
      return leftCreatedAt - rightCreatedAt;
    }
    return (left?.id || "").localeCompare(right?.id || "");
  };

  const syncTaskSamples = (task, previousTaskCode = "") => {
    const taskCode = (task?.code || "").trim();
    if (!taskCode) {
      return { changed: false, codes: [] };
    }

    const previousCode = (previousTaskCode || "").trim();
    let samples = asArray(loadStore(STORAGE_KEYS.samples, []));
    const now = new Date().toISOString();
    let changed = false;

    if (previousCode && previousCode !== taskCode) {
      const oldPattern = new RegExp(`^${escapeRegExp(previousCode)}-SP-(\\d{3})$`);
      samples.forEach((sample) => {
        if ((sample?.task_code || "").trim() !== previousCode) {
          return;
        }
        sample.task_code = taskCode;
        const currentCode = (sample.code || "").trim();
        const matched = currentCode.match(oldPattern);
        if (matched) {
          sample.code = `${taskCode}-SP-${matched[1]}`;
        }
        sample.updated_at = now;
        appendSampleHistory(sample, "浠诲姟鏍峰搧閲嶇粦", `浠诲姟 ${previousCode} -> ${taskCode}`);
        changed = true;
      });
    }

    const taskSamples = samples.filter((item) => (item.task_code || "").trim() === taskCode);
    const plannedRaw = Number.parseInt(task?.sample_count, 10);
    const plannedCount =
      Number.isFinite(plannedRaw) && plannedRaw >= 0 ? Math.floor(plannedRaw) : taskSamples.length;
    const expectedCodes = buildTaskSampleCodes(taskCode, plannedCount, taskSamples);
    const sortedSamples = [...taskSamples].sort((left, right) => compareTaskSamples(left, right, taskCode));
    const used = new Set();

    expectedCodes.forEach((expectedCode) => {
      let sampleChanged = false;
      let sample = sortedSamples.find(
        (item) => !used.has(item) && (item?.code || "").trim() === expectedCode
      );
      if (!sample) {
        sample = sortedSamples.find((item) => !used.has(item));
      }

      if (!sample) {
        sample = {
          id: generateId("sample"),
          code: expectedCode,
          task_code: taskCode,
          location: "",
          owner: "",
          status: "运输中",
          flow_status: "运输中",
          created_at: now,
        };
        appendSampleHistory(sample, "鏍峰搧缁戝畾浠诲姟", `浠诲姟 ${taskCode}`);
        samples.unshift(sample);
        used.add(sample);
        changed = true;
        return;
      }

      used.add(sample);
      const oldCode = (sample.code || "").trim();
      if (oldCode !== expectedCode) {
        sample.code = expectedCode;
        appendSampleHistory(sample, "鏍峰搧缂栧彿閲嶆帓", `${oldCode} -> ${expectedCode}`);
        changed = true;
        sampleChanged = true;
      }
      if ((sample.task_code || "").trim() !== taskCode) {
        sample.task_code = taskCode;
        changed = true;
        sampleChanged = true;
      }
      if (!sample.status) {
        sample.status = "运输中";
        changed = true;
        sampleChanged = true;
      }
      if (!sample.flow_status) {
        sample.flow_status = resolveFlowStatusByLocation(sample.location, sample.status || "运输中");
        changed = true;
        sampleChanged = true;
      }
      if (!sample.created_at) {
        sample.created_at = now;
        changed = true;
        sampleChanged = true;
      }
      if (sampleChanged) {
        sample.updated_at = now;
      }
    });

    const hasExtra = taskSamples.some((item) => !used.has(item));
    if (hasExtra) {
      samples = samples.filter((item) => (item.task_code || "").trim() !== taskCode || used.has(item));
      changed = true;
    }

    if (changed) {
      saveStore(STORAGE_KEYS.samples, samples);
    }
    return { changed, codes: expectedCodes };
  };

  const ensureTaskSamples = (task, previousTaskCode = "") => syncTaskSamples(task, previousTaskCode);

  // handleTaskCreate閿涙艾顦╅悶鍡曟崲閸斺€冲灡瀵?
  const handleTaskCreate = (formSelector, statusOverride, warningEl) => {
    const data = getFormData(formSelector);
    const tasks = loadStore(STORAGE_KEYS.tasks, []);
    if (!data.name && !testingRandom) {
      setWarning(warningEl, labels.taskNameRequired);
      return false;
    }
    const task = !data.name && testingRandom
      ? buildRandomTask(tasks, statusOverride)
      : {
          id: generateId("task"),
          code: data.code || `TASK-${Date.now().toString().slice(-6)}`,
          name: data.name,
          source: data.source || labels.sourceExternal,
          priority: data.priority || "Medium",
          sample_count: data.sample_count || "",
          sample_type: data.sample_type || "",
          test_type: data.test_type || "",
          required_device: data.required_device || data.test_type || "",
          due_at: data.due_at || "",
          arrival_at: data.arrival_at || "",
          status: statusOverride || labels.statusWaiting,
          created_at: new Date().toISOString(),
        };
    setWarning(warningEl, "");
    tasks.unshift(task);
    saveStore(STORAGE_KEYS.tasks, tasks);
    ensureTaskSamples(task);
    return true;
  };

  const taskSubmit = document.querySelector('[data-action="task-submit"]');
  if (taskSubmit) {
    bindClickOnce(taskSubmit, "boundClick", (event) => {
      event.preventDefault();
      if (handleTaskCreate('[data-form="task-intake"]', labels.statusWaiting, taskWarning)) {
        renderAll(labels);
      }
    });
  }

  const taskDraft = document.querySelector('[data-action="task-draft"]');
  if (taskDraft) {
    bindClickOnce(taskDraft, "boundClick", (event) => {
      event.preventDefault();
      if (handleTaskCreate('[data-form="task-intake"]', labels.statusWaiting, taskWarning)) {
        renderAll(labels);
      }
    });
  }

  const taskQuick = document.querySelector('[data-action="task-quick-submit"]');
  if (taskQuick) {
    bindClickOnce(taskQuick, "boundClick", (event) => {
      event.preventDefault();
      if (handleTaskCreate('[data-form="task-quick"]', labels.statusWaiting, taskQuickWarning)) {
        const modal = document.getElementById("task-modal");
        if (modal) {
          modal.classList.remove("is-open");
        }
        renderAll(labels);
      }
    });
  }

  const taskQuickDraft = document.querySelector('[data-action="task-quick-draft"]');
  if (taskQuickDraft) {
    bindClickOnce(taskQuickDraft, "boundClick", (event) => {
      event.preventDefault();
      if (handleTaskCreate('[data-form="task-quick"]', labels.statusWaiting, taskQuickWarning)) {
        const modal = document.getElementById("task-modal");
        if (modal) {
          modal.classList.remove("is-open");
        }
        renderAll(labels);
      }
    });
  }

  // getTaskEditForm閿涙俺骞忛崣鏍︽崲閸旓紕绱潏鎴ｃ€冮崡?
  const getTaskEditForm = () => document.querySelector('[data-form="task-edit"]');
  // getTaskDrawer閿涙俺骞忛崣鏍︽崲閸斺剝濞婄仦?
  const getTaskDrawer = () => document.getElementById("task-drawer");

  // openTaskEditor閿涙碍澧﹀鈧禒璇插缂傛牞绶幎钘夌溄楠炶泛锝為崗?
  const openTaskEditor = (taskId, taskCode) => {
    const taskEditForm = getTaskEditForm();
    if (!taskEditForm) {
      return;
    }
    const tasks = loadStore(STORAGE_KEYS.tasks, []);
    const task =
      tasks.find((item) => item.id === taskId) ||
      (taskCode ? tasks.find((item) => item.code === taskCode) : undefined);
    if (!task) {
      return;
    }
    const codeInput = taskEditForm.querySelector('input[name="code"]');
    const nameInput = taskEditForm.querySelector('input[name="name"]');
    const sourceSelect = taskEditForm.querySelector('select[name="source"]');
    const prioritySelect = taskEditForm.querySelector('select[name="priority"]');
    const sampleCountInput = taskEditForm.querySelector('input[name="sample_count"]');
    const sampleTypeInput = taskEditForm.querySelector('input[name="sample_type"]');
    const testTypeSelect = taskEditForm.querySelector('select[name="test_type"]');
    const dueInput = taskEditForm.querySelector('input[name="due_at"]');
    const arrivalInput = taskEditForm.querySelector('input[name="arrival_at"]');
    const requiredInput = taskEditForm.querySelector('input[name="required_device"]');
    const statusSelect = taskEditForm.querySelector('select[name="status"]');
    const remarkInput = taskEditForm.querySelector('textarea[name="remark"]');

    if (codeInput) {
      codeInput.value = task.code || "";
    }
    if (nameInput) {
      nameInput.value = task.name || "";
    }
    if (sourceSelect) {
      ensureOption(sourceSelect, task.source);
      sourceSelect.value = task.source || sourceSelect.value;
    }
    if (prioritySelect) {
      ensureOption(prioritySelect, task.priority);
      prioritySelect.value = task.priority || prioritySelect.value;
    }
    if (sampleCountInput) {
      sampleCountInput.value = task.sample_count || "";
    }
    if (sampleTypeInput) {
      sampleTypeInput.value = task.sample_type || "";
    }
    if (testTypeSelect) {
      ensureOption(testTypeSelect, task.test_type);
      testTypeSelect.value = task.test_type || "";
    }
    if (dueInput) {
      dueInput.value = toDateTimeLocalValue(task.due_at);
    }
    if (arrivalInput) {
      arrivalInput.value = toDateTimeLocalValue(task.arrival_at);
    }
    if (requiredInput) {
      requiredInput.value = task.required_device || "";
    }
    if (statusSelect) {
      ensureOption(statusSelect, task.status);
      statusSelect.value = task.status || statusSelect.value;
    }
    if (remarkInput) {
      remarkInput.value = task.remark || "";
    }
    taskEditForm.dataset.taskId = task.id || "";
    taskEditForm.dataset.taskCode = task.code || "";
    setWarning(taskEditWarning, "");
    const taskDrawer = getTaskDrawer();
    if (taskDrawer) {
      taskDrawer.classList.add("is-open");
    }
  };

  // bindTaskEditClick閿涙氨绮︾€规矮鎹㈤崝锛勭椽鏉堟垹鍋ｉ崙璁崇皑娴?
  const bindTaskEditClick = () => {
    if (document.body?.dataset.taskEditBound === "1") {
      return;
    }
    document.addEventListener("click", (event) => {
      const trigger = event.target.closest('[data-action="task-edit"], [data-drawer-open="task-drawer"]');
      if (!trigger) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const row = trigger.closest("tr");
      let taskId = trigger.getAttribute("data-task-id") || row?.dataset.taskId || "";
      let taskCode = trigger.getAttribute("data-task-code") || row?.dataset.taskCode || "";
      if (!taskCode && row) {
        const codeCell = row.querySelector("td");
        if (codeCell) {
          taskCode = codeCell.textContent.trim();
        }
      }
      openTaskEditor(taskId, taskCode);
    });
    if (document.body) {
      document.body.dataset.taskEditBound = "1";
    }
  };
  bindTaskEditClick();

  // performTaskUpdate閿涙矮绻氱€涙ü鎹㈤崝锛勭椽鏉堟垵鍞寸€?
  const performTaskUpdate = () => {
    const taskEditForm = getTaskEditForm();
    if (!taskEditForm) {
      return;
    }
    const taskDrawer = getTaskDrawer();
    const taskId = taskEditForm.dataset.taskId;
    const taskCode = taskEditForm.dataset.taskCode;
    if (!taskId && !taskCode) {
      return;
    }
    const data = getFormData(taskEditForm);
    const tasks = loadStore(STORAGE_KEYS.tasks, []);
    const task =
      tasks.find((item) => item.id === taskId) || (taskCode ? tasks.find((item) => item.code === taskCode) : null);
    if (!task) {
      return;
    }
    const previousTaskCode = (task.code || "").trim();
    task.code = data.code || task.code;
    task.name = data.name || "";
    task.source = data.source || "";
    task.priority = data.priority || "";
    task.sample_count = data.sample_count || "";
    task.sample_type = data.sample_type || "";
    task.test_type = data.test_type || "";
    task.due_at = data.due_at || "";
    task.arrival_at = data.arrival_at || "";
    task.required_device = data.required_device || "";
    task.status = data.status || task.status;
    task.remark = data.remark || "";
    task.updated_at = new Date().toISOString();
    saveStore(STORAGE_KEYS.tasks, tasks);
    ensureTaskSamples(task, previousTaskCode);
    taskEditForm.dataset.taskCode = task.code || "";
    setWarning(taskEditWarning, "");
    renderAll(labels);
    if (taskDrawer) {
      taskDrawer.classList.remove("is-open");
    }
  };

  const taskUpdate = document.querySelector('[data-action="task-update"]');
  if (taskUpdate) {
    taskUpdate.addEventListener("click", (event) => {
      event.preventDefault();
      performTaskUpdate();
    });
  }

  // performTaskDelete閿涙艾鍨归梽銈勬崲閸斺€宠嫙閸掗攱鏌?
  const performTaskDelete = () => {
    const taskEditForm = getTaskEditForm();
    if (!taskEditForm) {
      return;
    }
    const taskDrawer = getTaskDrawer();
    const taskId = taskEditForm.dataset.taskId;
    const taskCode = taskEditForm.dataset.taskCode;
    if (!taskId && !taskCode) {
      return;
    }
    const tasks = loadStore(STORAGE_KEYS.tasks, []);
    const task =
      tasks.find((item) => item.id === taskId) || (taskCode ? tasks.find((item) => item.code === taskCode) : null);
    // updated閿涙氨些闂勩倗娲伴弽鍥ф倵閻ㄥ嫭鏌婇崚妤勩€?
    const updated = taskId ? tasks.filter((item) => item.id !== taskId) : tasks.filter((item) => item !== task);
    saveStore(STORAGE_KEYS.tasks, updated);

    if (task?.code) {
      const schedules = loadStore(STORAGE_KEYS.schedules, []);
      const streams = loadStore(STORAGE_KEYS.streams, []);
      const samples = asArray(loadStore(STORAGE_KEYS.samples, []));
      // nextSchedules閿涙氨些闂勩倓鎹㈤崝鈥虫倵閻ㄥ嫭甯撶粙瀣灙鐞?
      const nextSchedules = schedules.filter((entry) => entry.task_code !== task.code);
      // nextStreams閿涙氨些闂勩倓鎹㈤崝鈥虫倵閻ㄥ嫭鏆熼幑顔界ウ閸掓銆?
      const nextStreams = streams.filter((entry) => entry.task_code !== task.code);
      const nextSamples = samples.filter((item) => (item.task_code || "").trim() !== task.code);
      saveStore(STORAGE_KEYS.schedules, nextSchedules);
      saveStore(STORAGE_KEYS.streams, nextStreams);
      saveStore(STORAGE_KEYS.samples, nextSamples);
    }

    setWarning(taskEditWarning, "");
    renderAll(labels);
    if (taskDrawer) {
      taskDrawer.classList.remove("is-open");
    }
  };

  const taskDelete = document.querySelector('[data-action="task-delete"]');
  if (taskDelete) {
    taskDelete.addEventListener("click", (event) => {
      event.preventDefault();
      performTaskDelete();
    });
  }

  if (document.body && document.body.dataset.taskEditActionBound !== "1") {
    document.addEventListener("click", (event) => {
      if (event.target.closest('[data-action="task-update"]')) {
        event.preventDefault();
        performTaskUpdate();
        return;
      }
      if (event.target.closest('[data-action="task-delete"]')) {
        event.preventDefault();
        performTaskDelete();
      }
    });
    document.body.dataset.taskEditActionBound = "1";
  }

  const manualScheduleForm = document.querySelector('[data-form="manual-schedule"]');
  const manualTaskSelect = manualScheduleForm?.querySelector('select[name="task_code"]');
  const manualLabSelect = manualScheduleForm?.querySelector('select[name="device"]');
  const manualSlotSelect = manualScheduleForm?.querySelector('[data-time-slot]');
  const manualSlotField = manualSlotSelect?.closest(".form-field");
  const manualDateInput = manualScheduleForm?.querySelector('input[name="schedule_date"]');
  const manualCustomStart = manualScheduleForm?.querySelector('input[name="custom_start"]');
  const manualCustomEnd = manualScheduleForm?.querySelector('input[name="custom_end"]');
  const manualCustomFields = manualScheduleForm?.querySelectorAll("[data-custom-time]") || [];
  const retentionNowField = manualScheduleForm?.querySelector("[data-retention-now]");
  const retentionNowValue = retentionNowField?.querySelector("[data-retention-now-value]");
  let retentionNowTimer = null;

  const getCurrentSlotKey = () => {
    const now = new Date();
    const minutes = now.getHours() * 60 + now.getMinutes();
    if (minutes >= 8 * 60 && minutes < 11 * 60 + 30) {
      return "morning";
    }
    if (minutes >= 13 * 60 + 30 && minutes < 17 * 60) {
      return "afternoon";
    }
    return "custom";
  };

  const setManualScheduleToNow = () => {
    const now = new Date();
    const slotKey = getCurrentSlotKey();
    if (manualDateInput) {
      manualDateInput.value = now.toISOString().slice(0, 10);
    }
    if (manualSlotSelect) {
      manualSlotSelect.value = slotKey;
    }
    const timeValue = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    if (manualCustomStart) {
      manualCustomStart.value = timeValue;
    }
    if (manualCustomEnd) {
      manualCustomEnd.value = timeValue;
    }
    manualCustomFields.forEach((field) => field.classList.toggle("is-hidden", slotKey !== "custom"));
  };

  const setManualScheduleLocked = (locked) => {
    [manualDateInput, manualSlotSelect, manualCustomStart, manualCustomEnd].forEach((input) => {
      if (input) {
        input.disabled = locked;
      }
    });
    if (!locked && manualSlotSelect) {
      const isCustom = manualSlotSelect.value === "custom";
      manualCustomFields.forEach((field) => field.classList.toggle("is-hidden", !isCustom));
    }
  };

  const updateRetentionNow = () => {
    if (!retentionNowValue) {
      return;
    }
    retentionNowValue.textContent = formatDateTime(new Date());
  };

  const setRetentionTimeVisibility = (isRetention) => {
    if (manualSlotField) {
      manualSlotField.classList.toggle("is-hidden", isRetention);
    }
    manualCustomFields.forEach((field) => {
      field.classList.toggle("is-hidden", isRetention || manualSlotSelect?.value !== "custom");
    });
    if (retentionNowField) {
      retentionNowField.classList.toggle("is-hidden", !isRetention);
    }
    if (isRetention) {
      updateRetentionNow();
      if (!retentionNowTimer) {
        retentionNowTimer = window.setInterval(updateRetentionNow, 1000);
      }
    } else if (retentionNowTimer) {
      window.clearInterval(retentionNowTimer);
      retentionNowTimer = null;
    }
  };

  const syncManualRetentionLock = () => {
    if (!manualLabSelect || !labels.retentionLocation) {
      return;
    }
    const isRetention = manualLabSelect.value === labels.retentionLocation;
    if (isRetention) {
      setManualScheduleToNow();
    }
    setManualScheduleLocked(isRetention);
    setRetentionTimeVisibility(isRetention);
  };

  // resetManualScheduleForm閿涙岸鍣哥純顔藉閸斻劍甯撶粙瀣€冮崡?
  const resetManualScheduleForm = () => {
    if (!manualScheduleForm) {
      return;
    }
    manualScheduleForm.reset();
    manualScheduleForm.dataset.ganttFilter = "";
    if (manualTaskSelect) {
      manualTaskSelect.value = "";
    }
    if (manualLabSelect) {
      manualLabSelect.value = "";
    }
    if (manualDateInput) {
      manualDateInput.value = new Date().toISOString().slice(0, 10);
    }
    if (manualSlotSelect) {
      manualSlotSelect.value = "morning";
    }
    if (manualCustomStart) {
      manualCustomStart.value = "";
    }
    if (manualCustomEnd) {
      manualCustomEnd.value = "";
    }
    manualCustomFields.forEach((field) => field.classList.add("is-hidden"));
    if (retentionNowField) {
      retentionNowField.classList.add("is-hidden");
    }
    clearConflictHighlights();
    setWarning(scheduleWarning, "");
    setManualScheduleLocked(false);
    setRetentionTimeVisibility(false);
  };

  if (manualLabSelect && manualLabSelect.dataset.bound !== "1") {
    manualLabSelect.addEventListener("change", () => {
      const selectedLab = manualLabSelect.value || "";
      manualScheduleForm.dataset.ganttFilter =
        labels.retentionLocation && selectedLab === labels.retentionLocation ? "" : selectedLab;
      syncManualRetentionLock();
      renderAll(labels);
    });
    manualLabSelect.dataset.bound = "1";
  }

  if (manualTaskSelect && manualTaskSelect.dataset.resetBound !== "1") {
    manualTaskSelect.addEventListener("change", () => {
      if (!manualTaskSelect.value) {
        resetManualScheduleForm();
        renderAll(labels);
      }
    });
    manualTaskSelect.dataset.resetBound = "1";
  }

  // Manual scheduling: reset form and create schedule entries.
const manualScheduleReset = document.querySelector('[data-action="manual-schedule-reset"]');
  if (manualScheduleReset) {
    manualScheduleReset.addEventListener("click", (event) => {
      event.preventDefault();
      resetManualScheduleForm();
      renderAll(labels);
    });
  }

  const manualSchedule = document.querySelector('[data-action="manual-schedule-run"]');
  if (manualSchedule) {
    manualSchedule.addEventListener("click", (event) => {
      event.preventDefault();
      const data = getFormData('[data-form="manual-schedule"]');
      if (!data.task_code || !data.device) {
        setWarning(scheduleWarning, labels.scheduleSelectRequired);
        return;
      }
      const isRetentionSchedule = data.device === labels.retentionLocation;
      let resolved = null;
      if (isRetentionSchedule) {
        const now = new Date();
        resolved = {
          dateValue: formatLocalDate(now),
          startAt: now,
          endAt: new Date(now.getTime()),
        };
      } else {
        resolved = resolveScheduleTimes(data, scheduleWarning);
      }
      if (!resolved) {
        return;
      }
      const { dateValue, startAt, endAt } = resolved;
      const schedules = loadStore(STORAGE_KEYS.schedules, []);
      const ignoreConflict = data.device === labels.retentionLocation;
      const deviceConflict = ignoreConflict
        ? null
        : schedules.find((entry) => {
            if (entry.device !== data.device) {
              return false;
            }
        const existingStart = new Date(entry.start_at);
        const existingEnd = new Date(entry.end_at);
        if (Number.isNaN(existingStart.getTime()) || Number.isNaN(existingEnd.getTime())) {
          return false;
        }
        return overlaps(startAt, endAt, existingStart, existingEnd);
      });
      const taskConflict = ignoreConflict
        ? null
        : schedules.find((entry) => {
            if (entry.device === labels.retentionLocation) {
              return false;
            }
            if (entry.task_code !== data.task_code) {
              return false;
            }
        const existingStart = new Date(entry.start_at);
        const existingEnd = new Date(entry.end_at);
        if (Number.isNaN(existingStart.getTime()) || Number.isNaN(existingEnd.getTime())) {
          return false;
        }
        return overlaps(startAt, endAt, existingStart, existingEnd);
      });
      if (deviceConflict || taskConflict) {
        let conflictMessage = "";
        if (deviceConflict) {
          conflictMessage = labels.scheduleConflictTemplate
            .replace("{device}", data.device)
            .replace("{start}", formatDateTime(deviceConflict.start_at))
            .replace("{end}", formatDateTime(deviceConflict.end_at))
            .replace("{task}", deviceConflict.task_code || "Task");
          highlightConflictSlots(data.device, dateValue, startAt, endAt);
        }
        if (taskConflict) {
          const taskMessage = labels.scheduleTaskConflictTemplate
            .replace("{task}", taskConflict.task_code || "Task")
            .replace("{start}", formatDateTime(taskConflict.start_at))
            .replace("{end}", formatDateTime(taskConflict.end_at));
          conflictMessage = conflictMessage ? `${conflictMessage} ${taskMessage}` : taskMessage;
        }
        const suggestion = buildSuggestion(schedules, data.device, dateValue);
        setWarning(scheduleWarning, `${conflictMessage} ${suggestion}`.trim());
        return;
      }
      clearConflictHighlights();
      setWarning(scheduleWarning, "");
      const tasks = loadStore(STORAGE_KEYS.tasks, []);
      const streams = loadStore(STORAGE_KEYS.streams, []);
      const retentionSchedule =
        !isRetentionSchedule && labels.retentionLocation
          ? schedules.find(
              (entry) => entry.task_code === data.task_code && entry.device === labels.retentionLocation
            )
          : null;
      if (retentionSchedule) {
        retentionSchedule.device = data.device;
        retentionSchedule.start_at = startAt.toISOString();
        retentionSchedule.end_at = endAt.toISOString();
        retentionSchedule.status = labels.statusScheduled;
      } else {
        schedules.push({
          id: generateId("schedule"),
          task_code: data.task_code,
          device: data.device,
          start_at: startAt.toISOString(),
          end_at: endAt.toISOString(),
          status: labels.statusScheduled,
        });
      }
      // task閿涙艾缍嬮崜宥勬崲閸?
      const task = tasks.find((t) => t.code === data.task_code);
      if (task) {
        task.status = isRetentionSchedule ? labels.statusRetention : labels.statusScheduled;
      }
      const stream = streams.find((item) => item.task_code === data.task_code);
      if (stream) {
        if (!isRetentionSchedule) {
          stream.device = data.device;
        }
      } else {
        streams.push({
          id: generateId("stream"),
          task_code: data.task_code,
          device: data.device,
          last_packet: formatDateTime(new Date()),
          quality: "98.0%",
          status: labels.dataStreaming,
          reported: false,
        });
      }
      saveStore(STORAGE_KEYS.schedules, schedules);
      saveStore(STORAGE_KEYS.tasks, tasks);
      saveStore(STORAGE_KEYS.streams, streams);
      resetManualScheduleForm();
      renderAll(labels);
    });
  }

  if (manualScheduleForm && typeof window !== "undefined") {
    window.__MES_SYNC_MANUAL_SCHEDULE__ = syncManualRetentionLock;
    syncManualRetentionLock();
  }

  // Schedule edit drawer: load, update, delete schedule entries.
const scheduleEditForm = document.querySelector('[data-form="schedule-edit"]');
  const scheduleDrawer = document.getElementById("schedule-drawer");
  // bindEditTimeSlot閿涙氨绮︾€规碍甯撶粙瀣闂傚瓨顔岄懕鏂垮З
  const bindEditTimeSlot = () => {
    if (!scheduleEditForm) {
      return;
    }
    const slotSelect = scheduleEditForm.querySelector('[data-edit-time-slot]');
    const customFields = scheduleEditForm.querySelectorAll("[data-edit-custom-time]");
    // toggleCustom閿涙艾鍨忛幑銏ｅ殰鐎规矮绠熼弮鍫曟？鏉堟挸鍙?
    const toggleCustom = () => {
      const isCustom = slotSelect?.value === "custom";
      customFields.forEach((field) => field.classList.toggle("is-hidden", !isCustom));
    };
    if (slotSelect && scheduleEditForm.dataset.bound !== "1") {
      slotSelect.addEventListener("change", toggleCustom);
      scheduleEditForm.dataset.bound = "1";
    }
    toggleCustom();
  };

  // openScheduleEditor閿涙碍澧﹀鈧幒鎺斺柤缂傛牞绶幎钘夌溄楠炶泛锝為崗?
  const openScheduleEditor = (scheduleId) => {
    if (!scheduleId || !scheduleEditForm) {
      return;
    }
    const schedules = loadStore(STORAGE_KEYS.schedules, []);
    const tasks = loadStore(STORAGE_KEYS.tasks, []);
    const devices = loadStore(STORAGE_KEYS.devices, []);
    // schedule閿涙艾缍嬮崜宥嗗笓缁?
    const schedule = schedules.find((entry) => entry.id === scheduleId);
    if (!schedule) {
      return;
    }
    // task閿涙艾缍嬮崜宥勬崲閸?
    const task = tasks.find((item) => item.code === schedule.task_code);
    const testType = task?.test_type || "";
    const labs = getLabsForTestType(testType);
    if (labels.retentionLocation && !labs.includes(labels.retentionLocation)) {
      labs.push(labels.retentionLocation);
    }
    if (schedule.device && !labs.includes(schedule.device)) {
      labs.push(schedule.device);
    }
    const labSelect = scheduleEditForm.querySelector('select[name="device"]');
    fillLabOptions(labSelect, labs, schedule.device);

    const taskInput = scheduleEditForm.querySelector('input[name="task_code"]');
    const dateInput = scheduleEditForm.querySelector('input[name="schedule_date"]');
    const slotSelect = scheduleEditForm.querySelector('select[name="time_slot"]');
    const customStart = scheduleEditForm.querySelector('input[name="custom_start"]');
    const customEnd = scheduleEditForm.querySelector('input[name="custom_end"]');
    const startTime = formatLocalTime(schedule.start_at);
    const endTime = formatLocalTime(schedule.end_at);
    const dateValue = formatLocalDate(schedule.start_at);
    let slotValue = "custom";
    if (startTime === SLOT_RANGES.morning.start && endTime === SLOT_RANGES.morning.end) {
      slotValue = "morning";
    } else if (startTime === SLOT_RANGES.afternoon.start && endTime === SLOT_RANGES.afternoon.end) {
      slotValue = "afternoon";
    }

    if (taskInput) {
      taskInput.value = schedule.task_code || "";
    }
    if (dateInput) {
      dateInput.value = dateValue;
    }
    if (slotSelect) {
      slotSelect.value = slotValue;
    }
    if (customStart) {
      customStart.value = startTime;
    }
    if (customEnd) {
      customEnd.value = endTime;
    }
    scheduleEditForm.dataset.scheduleId = scheduleId;
    setWarning(scheduleEditWarning, "");
    bindEditTimeSlot();
    if (scheduleDrawer) {
      scheduleDrawer.classList.add("is-open");
    }
  };

  // handleScheduleEditClick閿涙氨绮︾€规碍甯撶粙瀣椽鏉堟垹鍋ｉ崙璁崇皑娴?
  const handleScheduleEditClick = (event) => {
    const trigger = event.target.closest('[data-action="schedule-edit"]');
    if (!trigger) {
      return;
    }
    event.preventDefault();
    const scheduleId = trigger.getAttribute("data-schedule-id") || trigger.closest("tr")?.dataset.scheduleId;
    openScheduleEditor(scheduleId);
  };

  const scheduleTable = document.getElementById("schedule-table");
  if (scheduleTable && !scheduleTable.dataset.bound) {
    scheduleTable.addEventListener("click", handleScheduleEditClick);
    scheduleTable.dataset.bound = "1";
  }
  const conflictTable = document.getElementById("conflict-table");
  if (conflictTable && !conflictTable.dataset.bound) {
    conflictTable.addEventListener("click", handleScheduleEditClick);
    conflictTable.dataset.bound = "1";
  }
  const ganttTable = document.getElementById("gantt-table");
  if (ganttTable && !ganttTable.dataset.bound) {
    ganttTable.addEventListener("click", (event) => {
      const tag = event.target?.tagName;
      if (tag === "SELECT" || tag === "OPTION" || event.target.closest(".gantt-conflict-select")) {
        return;
      }
      const slot = event.target.closest(".gantt-slot");
      if (!slot || slot.classList.contains("idle")) {
        return;
      }
      const scheduleId = slot.dataset.scheduleId;
      if (scheduleId) {
        openScheduleEditor(scheduleId);
      }
    });
    ganttTable.addEventListener("change", (event) => {
      const select = event.target.closest(".gantt-conflict-select");
      if (!select) {
        return;
      }
      const scheduleId = select.value;
      if (scheduleId) {
        openScheduleEditor(scheduleId);
      }
    });
    ganttTable.dataset.bound = "1";
  }

  const scheduleUpdate = document.querySelector('[data-action="schedule-update"]');
  if (scheduleUpdate) {
    scheduleUpdate.addEventListener("click", (event) => {
      event.preventDefault();
      if (!scheduleEditForm) {
        return;
      }
      const scheduleId = scheduleEditForm.dataset.scheduleId;
      if (!scheduleId) {
        return;
      }
      const data = getFormData(scheduleEditForm);
      if (!data.device) {
        setWarning(scheduleEditWarning, labels.scheduleSelectRequired);
        return;
      }
      const resolved = resolveScheduleTimes(data, scheduleEditWarning);
      if (!resolved) {
        return;
      }
      const { dateValue, startAt, endAt } = resolved;
      const schedules = loadStore(STORAGE_KEYS.schedules, []);
      // schedule閿涙艾缍嬮崜宥嗗笓缁?
      const schedule = schedules.find((entry) => entry.id === scheduleId);
      if (!schedule) {
        return;
      }
      const ignoreConflict = data.device === labels.retentionLocation;
      const deviceConflict = ignoreConflict
        ? null
        : schedules.find((entry) => {
            if (entry.id === scheduleId) {
              return false;
            }
            if (entry.device !== data.device) {
              return false;
            }
        const existingStart = new Date(entry.start_at);
        const existingEnd = new Date(entry.end_at);
        if (Number.isNaN(existingStart.getTime()) || Number.isNaN(existingEnd.getTime())) {
          return false;
        }
        return overlaps(startAt, endAt, existingStart, existingEnd);
      });
      const taskConflict = ignoreConflict
        ? null
        : schedules.find((entry) => {
            if (entry.id === scheduleId) {
              return false;
            }
            if (entry.device === labels.retentionLocation) {
              return false;
            }
            if (entry.task_code !== data.task_code) {
              return false;
            }
        const existingStart = new Date(entry.start_at);
        const existingEnd = new Date(entry.end_at);
        if (Number.isNaN(existingStart.getTime()) || Number.isNaN(existingEnd.getTime())) {
          return false;
        }
        return overlaps(startAt, endAt, existingStart, existingEnd);
      });
      if (deviceConflict || taskConflict) {
        let conflictMessage = "";
        if (deviceConflict) {
          conflictMessage = labels.scheduleConflictTemplate
            .replace("{device}", data.device)
            .replace("{start}", formatDateTime(deviceConflict.start_at))
            .replace("{end}", formatDateTime(deviceConflict.end_at))
            .replace("{task}", deviceConflict.task_code || "Task");
          highlightConflictSlots(data.device, dateValue, startAt, endAt);
        }
        if (taskConflict) {
          const taskMessage = labels.scheduleTaskConflictTemplate
            .replace("{task}", taskConflict.task_code || "Task")
            .replace("{start}", formatDateTime(taskConflict.start_at))
            .replace("{end}", formatDateTime(taskConflict.end_at));
          conflictMessage = conflictMessage ? `${conflictMessage} ${taskMessage}` : taskMessage;
        }
        const suggestion = buildSuggestion(schedules, data.device, dateValue, scheduleId);
        setWarning(scheduleEditWarning, `${conflictMessage} ${suggestion}`.trim());
        return;
      }
      clearConflictHighlights();
      setWarning(scheduleEditWarning, "");
      schedule.device = data.device;
      schedule.start_at = startAt.toISOString();
      schedule.end_at = endAt.toISOString();
      saveStore(STORAGE_KEYS.schedules, schedules);

      const streams = loadStore(STORAGE_KEYS.streams, []);
      // stream閿涙艾缍嬮崜宥嗘殶閹诡喗绁?
      const stream = streams.find((entry) => entry.task_code === data.task_code);
      if (stream) {
        stream.device = data.device;
      }
      saveStore(STORAGE_KEYS.streams, streams);
      const tasks = loadStore(STORAGE_KEYS.tasks, []);
      const task = tasks.find((entry) => entry.code === data.task_code);
      if (task) {
        task.status = data.device === labels.retentionLocation ? labels.statusRetention : labels.statusScheduled;
      }
      saveStore(STORAGE_KEYS.tasks, tasks);

      renderAll(labels);
      if (scheduleDrawer) {
        scheduleDrawer.classList.remove("is-open");
      }
    });
  }

  const scheduleDelete = document.querySelector('[data-action="schedule-delete"]');
  if (scheduleDelete) {
    scheduleDelete.addEventListener("click", (event) => {
      event.preventDefault();
      if (!scheduleEditForm) {
        return;
      }
      const scheduleId = scheduleEditForm.dataset.scheduleId;
      if (!scheduleId) {
        return;
      }
      const schedules = loadStore(STORAGE_KEYS.schedules, []);
      // schedule閿涙艾缍嬮崜宥嗗笓缁?
      const schedule = schedules.find((entry) => entry.id === scheduleId);
      // updated閿涙氨些闂勩倗娲伴弽鍥ф倵閻ㄥ嫭鏌婇崚妤勩€?
      const updated = schedules.filter((entry) => entry.id !== scheduleId);
      saveStore(STORAGE_KEYS.schedules, updated);

      const tasks = loadStore(STORAGE_KEYS.tasks, []);
      if (schedule) {
        // task閿涙艾缍嬮崜宥勬崲閸?
        const task = tasks.find((entry) => entry.code === schedule.task_code);
        if (task) {
          task.status = labels.statusWaiting;
        }
      }
      saveStore(STORAGE_KEYS.tasks, tasks);

      renderAll(labels);
      if (scheduleDrawer) {
        scheduleDrawer.classList.remove("is-open");
      }
    });
  }

  // Sample intake and batch operations.
  const sampleIntakeForm = document.querySelector('[data-form="sample-intake"]');
  if (sampleIntakeForm) {
    const intakeTaskSelect = sampleIntakeForm.querySelector('select[name="task_code"]');
    const intakeCodeInput = sampleIntakeForm.querySelector('input[name="code"]');
    const syncIntakeCode = () => {
      if (!intakeTaskSelect || !intakeCodeInput) {
        return;
      }
      const taskCode = (intakeTaskSelect.value || "").trim();
      if (!taskCode) {
        intakeCodeInput.value = "";
        return;
      }
      const samples = asArray(loadStore(STORAGE_KEYS.samples, []));
      intakeCodeInput.value = nextTaskSampleCode(taskCode, samples);
    };
    if (intakeTaskSelect && intakeCodeInput && intakeTaskSelect.dataset.autoCodeBound !== "1") {
      intakeTaskSelect.addEventListener("change", syncIntakeCode);
      intakeTaskSelect.dataset.autoCodeBound = "1";
    }
    if (intakeTaskSelect && intakeCodeInput && !intakeCodeInput.value) {
      syncIntakeCode();
    }
  }

  const sampleSummaryTaskSelect = document.querySelector('select[data-sample-task-select="summary"]');
  if (sampleSummaryTaskSelect && sampleSummaryTaskSelect.dataset.persistBound !== "1") {
    sampleSummaryTaskSelect.addEventListener("change", (event) => {
      const taskCode = (sampleSummaryTaskSelect.value || "").trim();
      if (!taskCode) {
        return;
      }
      const tasks = loadStore(STORAGE_KEYS.tasks, []);
      const task = tasks.find((item) => (item.code || "").trim() === taskCode);
      const changed = task ? ensureTaskSamples(task).changed : false;
      if (changed) {
        renderAll(labels);
        if (event && typeof event.stopImmediatePropagation === "function") {
          event.stopImmediatePropagation();
        }
      }
    });
    sampleSummaryTaskSelect.dataset.persistBound = "1";
  }

  const sampleSubmit = document.querySelector('[data-action="sample-submit"]');
  if (sampleSubmit) {
    sampleSubmit.addEventListener("click", (event) => {
      event.preventDefault();
      const data = getFormData('[data-form="sample-intake"]');
      const tasks = loadStore(STORAGE_KEYS.tasks, []);
      const task = data.task_code ? tasks.find((t) => t.code === data.task_code) : null;
      if (task) {
        ensureTaskSamples(task);
      }
      const plannedCount = task ? Number.parseInt(task.sample_count, 10) : NaN;
      const samples = asArray(loadStore(STORAGE_KEYS.samples, []));
      if (!data.code && data.task_code) {
        data.code = nextTaskSampleCode(data.task_code, samples);
      }
      if (!data.code) {
        data.code = `SP-${Date.now().toString().slice(-6)}`;
      }
      if (task && Number.isFinite(plannedCount) && plannedCount >= 0) {
        const existingCount = samples.filter((item) => item.task_code === task.code).length;
        if (existingCount >= plannedCount) {
          setWarning(sampleWarning, `任务 ${task.code} 的样品数量已达到 ${plannedCount}。`);
          return;
        }
      }
      if (samples.some((item) => (item.code || "").trim() === (data.code || "").trim())) {
        setWarning(sampleWarning, `样品编号 ${data.code} 已存在。`);
        return;
      }
      setWarning(sampleWarning, "");
      const sample = {
        id: generateId("sample"),
        code: data.code,
        task_code: data.task_code || "",
        location: "",
        owner: "",
        status: "运输中",
        flow_status: "运输中",
        created_at: new Date().toISOString(),
      };
      appendSampleHistory(sample, "鏍峰搧鐧昏");
      samples.unshift(sample);
      saveStore(STORAGE_KEYS.samples, samples);
      // task閿涙艾缍嬮崜宥勬崲閸?
      if (task && (task.status === labels.statusAccepted || task.status === "已受理")) {
        task.status = labels.statusWaiting;
      }
      saveStore(STORAGE_KEYS.tasks, tasks);
      renderAll(labels);
    });
  }

  const sampleDraft = document.querySelector('[data-action="sample-draft"]');
  if (sampleDraft) {
    sampleDraft.addEventListener("click", (event) => {
      event.preventDefault();
      const data = getFormData('[data-form="sample-intake"]');
      const tasks = loadStore(STORAGE_KEYS.tasks, []);
      const task = data.task_code ? tasks.find((t) => t.code === data.task_code) : null;
      if (task) {
        ensureTaskSamples(task);
      }
      const plannedCount = task ? Number.parseInt(task.sample_count, 10) : NaN;
      const samples = asArray(loadStore(STORAGE_KEYS.samples, []));
      if (!data.code && data.task_code) {
        data.code = nextTaskSampleCode(data.task_code, samples);
      }
      if (!data.code) {
        data.code = `SP-${Date.now().toString().slice(-6)}`;
      }
      if (task && Number.isFinite(plannedCount) && plannedCount >= 0) {
        const existingCount = samples.filter((item) => item.task_code === task.code).length;
        if (existingCount >= plannedCount) {
          setWarning(sampleWarning, `任务 ${task.code} 的样品数量已达到 ${plannedCount}。`);
          return;
        }
      }
      if (samples.some((item) => (item.code || "").trim() === (data.code || "").trim())) {
        setWarning(sampleWarning, `样品编号 ${data.code} 已存在。`);
        return;
      }
      setWarning(sampleWarning, "");
      const sample = {
        id: generateId("sample"),
        code: data.code,
        task_code: data.task_code || "",
        location: "",
        owner: "",
        status: "运输中",
        flow_status: "运输中",
        created_at: new Date().toISOString(),
      };
      appendSampleHistory(sample, "鏍峰搧鐧昏");
      samples.unshift(sample);
      saveStore(STORAGE_KEYS.samples, samples);
      renderAll(labels);
    });
  }

  const sampleBatch = document.querySelector('[data-action="sample-batch-submit"]');
  if (sampleBatch) {
    sampleBatch.addEventListener("click", (event) => {
      event.preventDefault();
      const data = getFormData('[data-form="sample-batch"]');
      const codes = parseCodeList(data.codes);
      const preRetentionLocation = labels.preRetentionLocation || labels.retentionLocation;
      const postRetentionLocation = labels.postRetentionLocation || "";
      const targetLocation = data.location || labels.intakeLocation || labels.unpackingLocation || preRetentionLocation;
      if (!targetLocation || codes.length === 0) {
        return;
      }
      const samples = asArray(loadStore(STORAGE_KEYS.samples, []));
      const now = new Date().toISOString();
      const actionText =
        targetLocation === postRetentionLocation
          ? "閫佽揪瀹為獙鍚庢殏瀛橀棿"
          : targetLocation === preRetentionLocation
            ? "鎺ラ┏鍖洪€佽揪瀹為獙鍓嶆殏瀛橀棿"
            : "鎵归噺鍏ュ簱";
      codes.forEach((code) => {
        if (!code) {
          return;
        }
        // sample閿涙艾缍嬮崜宥嗙壉閸?
        let sample = samples.find((item) => item.code === code);
        if (!sample) {
          sample = {
            id: generateId("sample"),
            code,
            task_code: "",
            location: targetLocation,
            owner: data.owner || "",
            status: resolveSampleStatus(targetLocation),
            flow_status: resolveFlowStatusByLocation(targetLocation, resolveSampleStatus(targetLocation)),
            created_at: now,
          };
          samples.unshift(sample);
        } else {
          sample.location = targetLocation;
          sample.owner = data.owner || sample.owner;
          sample.status = resolveSampleStatus(targetLocation);
          sample.flow_status = resolveFlowStatusByLocation(targetLocation, sample.status);
          sample.updated_at = now;
        }
        if (targetLocation === preRetentionLocation) {
          sample.retention_source = "intake";
        } else if (sample.retention_source) {
          delete sample.retention_source;
        }
        appendSampleHistory(sample, actionText);
      });
      saveStore(STORAGE_KEYS.samples, samples);
      const modal = document.getElementById("sample-modal");
      if (modal) {
        modal.classList.remove("is-open");
      }
      renderAll(labels);
    });
  }

  const sampleTaskStore = document.querySelector('[data-action="sample-task-store"]');
  if (sampleTaskStore) {
    sampleTaskStore.addEventListener("click", (event) => {
      event.preventDefault();
      const data = getFormData('[data-form="sample-task-process"]');
      const preRetentionLocation = labels.preRetentionLocation || labels.retentionLocation;
      const select = document.querySelector('select[data-sample-task-select="summary"]');
      const taskCode = (select?.value || sampleTaskStore.dataset.taskCode || "").trim();
      if (!taskCode) {
        setWarning(sampleProcessWarning, "请先选择任务。");
        return;
      }

      const targetLocation = labels.intakeLocation || labels.unpackingLocation || preRetentionLocation;
      if (!targetLocation) {
        setWarning(sampleProcessWarning, "未配置默认入库位置。");
        return;
      }

      const tasks = loadStore(STORAGE_KEYS.tasks, []);
      const task = tasks.find((item) => (item.code || "").trim() === taskCode);
      if (task) {
        ensureTaskSamples(task);
      }

      const plannedCount = task ? Number.parseInt(task.sample_count, 10) : NaN;
      const samples = asArray(loadStore(STORAGE_KEYS.samples, []));
      const taskSamples = samples.filter((item) => (item.task_code || "").trim() === taskCode);
      const autoCodes = buildTaskSampleCodes(taskCode, plannedCount, taskSamples);
      const requestedCodes = parseCodeList(data.codes);
      const allowedCodeSet = new Set(autoCodes);
      const invalidRequestedCodes = requestedCodes.filter((code) => !allowedCodeSet.has(code));
      const codes = requestedCodes.length > 0 ? requestedCodes.filter((code) => allowedCodeSet.has(code)) : autoCodes;
      if (codes.length === 0) {
        setWarning(sampleProcessWarning, `任务 ${taskCode} 暂无可入库样品编号。`);
        return;
      }

      const { entries: trayPlanEntries, errors: trayPlanErrors } = parseSampleTrayPlan(data.tray_plan);
      if (trayPlanErrors.length) {
        setWarning(sampleProcessWarning, trayPlanErrors.join("；"));
        return;
      }

      const selectedCodeSet = new Set(codes);
      const trayPlanByCode = new Map();
      const invalidPlanCodes = [];
      trayPlanEntries.forEach((entry) => {
        if (!selectedCodeSet.has(entry.sampleCode)) {
          invalidPlanCodes.push(entry.sampleCode);
          return;
        }
        if (!trayPlanByCode.has(entry.sampleCode)) {
          trayPlanByCode.set(entry.sampleCode, []);
        }
        trayPlanByCode.get(entry.sampleCode).push(entry);
      });
      const uniqueInvalidPlanCodes = Array.from(new Set(invalidPlanCodes));
      if (uniqueInvalidPlanCodes.length) {
        setWarning(sampleProcessWarning, `分装计划中存在不属于当前任务样品的编号：${uniqueInvalidPlanCodes.join("、")}`);
        return;
      }

      const missingTrayPlan = [];
      codes.forEach((code) => {
        const plannedTrays = trayPlanByCode.get(code) || [];
        if (plannedTrays.length) {
          return;
        }
        const sample = samples.find((item) => item.code === code);
        const existingTrays = getSampleTrays(sample);
        if (!existingTrays.length) {
          missingTrayPlan.push(code);
        }
      });
      if (missingTrayPlan.length) {
        setWarning(sampleProcessWarning, `以下样品未配置分装托盘：${missingTrayPlan.join("、")}`);
        return;
      }

      const outOfTask = [];
      const success = [];
      const trayUpdated = [];
      const now = new Date().toISOString();
      const actionText = "任务样品入库（接驳区）";
      const intakeStatus = resolveSampleStatus(targetLocation);
      const intakeFlowStatus = resolveFlowStatusByLocation(targetLocation, intakeStatus);

      codes.forEach((code) => {
        let sample = samples.find((item) => item.code === code);
        if (!sample) {
          sample = {
            id: generateId("sample"),
            code,
            task_code: taskCode,
            location: targetLocation,
            owner: "",
            status: intakeStatus,
            flow_status: intakeFlowStatus,
            created_at: now,
          };
          if (targetLocation === preRetentionLocation) {
            sample.retention_source = "intake";
          }
          samples.unshift(sample);
        } else {
          const boundTaskCode = (sample.task_code || "").trim();
          if (boundTaskCode && boundTaskCode !== taskCode) {
            outOfTask.push(code);
            return;
          }
          sample.updated_at = now;
        }

        sample.task_code = taskCode;
        sample.location = targetLocation;
        sample.status = intakeStatus;
        sample.flow_status = intakeFlowStatus;
        if (targetLocation === preRetentionLocation) {
          sample.retention_source = "intake";
        } else if (sample.retention_source) {
          delete sample.retention_source;
        }

        const plannedTrays = trayPlanByCode.get(code) || [];
        const existingTrays = getSampleTrays(sample);
        if (plannedTrays.length) {
          sample.trays = plannedTrays.map((entry, index) => ({
            id: existingTrays[index]?.id || generateId("tray"),
            tray_code:
              (entry.trayCode || "").trim() ||
              (existingTrays[index]?.tray_code || "").trim() ||
              buildTaskTrayCode(taskCode, index + 1) ||
              buildSampleTrayCode(code, index + 1),
            sample_code: code,
            quantity: entry.quantity,
            created_at: existingTrays[index]?.created_at || now,
            updated_at: now,
          }));
          const trayQuantityTotal = sample.trays.reduce((total, tray) => total + tray.quantity, 0);
          appendSampleHistory(sample, "样品分装托盘", `共 ${sample.trays.length} 盘，合计数量 ${trayQuantityTotal}`);
          trayUpdated.push(`${code}(${sample.trays.length}盘)`);
        } else {
          sample.trays = existingTrays.map((tray, index) => ({
            ...tray,
            tray_code:
              (tray.tray_code || "").trim() ||
              buildTaskTrayCode(taskCode, index + 1) ||
              buildSampleTrayCode(code, index + 1),
            sample_code: code,
            updated_at: now,
          }));
        }

        appendSampleHistory(sample, actionText, `任务 ${taskCode}`);
        success.push(code);
      });

      if (success.length === 0) {
        const errors = [];
        if (invalidRequestedCodes.length) {
          errors.push(`样品编号不属于任务计划：${invalidRequestedCodes.join("、")}`);
        }
        if (outOfTask.length) {
          errors.push(`样品不属于任务 ${taskCode}：${outOfTask.join("、")}`);
        }
        setWarning(sampleProcessWarning, errors.length ? `${errors.join("；")}。` : `任务 ${taskCode} 暂无可入库样品。`);
        return;
      }

      saveStore(STORAGE_KEYS.samples, samples);
      const notices = [`任务 ${taskCode} 已登记到 ${targetLocation} ${success.length} 个样品。`];
      if (trayUpdated.length) {
        notices.push(`已完成托盘分装：${trayUpdated.join("，")}。`);
      }
      if (invalidRequestedCodes.length) {
        notices.push(`已忽略不属于任务计划的样品：${invalidRequestedCodes.join("、")}。`);
      }
      if (outOfTask.length) {
        notices.push(`不属于任务 ${taskCode} 的样品：${outOfTask.join("、")}。`);
      }
      setWarning(sampleProcessWarning, notices.join(" "));
      renderAll(labels);
    });
  }
  // Intake/Unpacking dispatch to lab or retention.
  const unpackingDispatch = document.querySelector('[data-action="unpacking-dispatch"]');
  if (unpackingDispatch) {
    unpackingDispatch.addEventListener("click", (event) => {
      event.preventDefault();
      const data = getFormData('[data-form="unpacking-dispatch"]');
      const preRetentionLocation = labels.preRetentionLocation || labels.retentionLocation;
      const targetLocation = data.target_location || "";
      const codes = parseCodeList(data.codes);
      const intakeLocations = [labels.intakeLocation, labels.unpackingLocation].filter(Boolean);
      if (!targetLocation || codes.length === 0) {
        setWarning(unpackingWarning, "请填写样品编号并选择目标位置。");
        return;
      }
      const samples = asArray(loadStore(STORAGE_KEYS.samples, []));
      const missing = [];
      const notUnpacking = [];
      codes.forEach((code) => {
        // sample锛氬綋鍓嶆牱鍝?
        const sample = samples.find((item) => item.code === code);
        if (!sample) {
          missing.push(code);
          return;
        }
        if (!intakeLocations.includes(sample.location)) {
          notUnpacking.push(code);
          return;
        }
        sample.location = targetLocation;
        if (targetLocation === preRetentionLocation) {
          sample.retention_source = "intake";
        } else if (sample.retention_source) {
          delete sample.retention_source;
        }
        sample.owner = data.owner || sample.owner;
        sample.status = resolveSampleStatus(targetLocation);
        sample.flow_status = resolveFlowStatusByLocation(targetLocation, sample.status);
        sample.updated_at = new Date().toISOString();
        const actionText =
          targetLocation === preRetentionLocation ? "接驳区送达实验前暂存间" : "接驳区派发";
        appendSampleHistory(sample, actionText);
      });
      const warnings = [];
      if (missing.length) {
        warnings.push(`未找到样品：${missing.join("、")}`);
      }
      if (notUnpacking.length) {
        warnings.push(`样品不在接驳区：${notUnpacking.join("、")}`);
      }
      setWarning(unpackingWarning, warnings.length ? `${warnings.join("；")}。` : "");
      saveStore(STORAGE_KEYS.samples, samples);
      renderAll(labels);
    });
  }

  const unpackingReset = document.querySelector('[data-action="unpacking-reset"]');
  if (unpackingReset) {
    unpackingReset.addEventListener("click", (event) => {
      event.preventDefault();
      const form = document.querySelector('[data-form="unpacking-dispatch"]');
      if (form) {
        form.querySelectorAll("input, textarea").forEach((field) => {
          field.value = "";
        });
        form.querySelectorAll("select").forEach((field) => {
          field.value = "";
        });
      }
      setWarning(unpackingWarning, "");
    });
  }

  // Retention dispatch: only forward to labs.
  const retentionDispatch = document.querySelector('[data-action="retention-dispatch"]');
  if (retentionDispatch) {
    retentionDispatch.addEventListener("click", (event) => {
      event.preventDefault();
      const data = getFormData('[data-form="retention-dispatch"]');
      const preRetentionLocation = labels.preRetentionLocation || labels.retentionLocation;
      const targetLab = data.target_lab || "";
      const codes = parseCodeList(data.codes);
      if (!targetLab || codes.length === 0) {
        setWarning(retentionWarning, "请填写样品编号并选择目标实验室。");
        return;
      }
      if (targetLab === preRetentionLocation) {
        setWarning(retentionWarning, "暂存间排程只允许派发至实验室。");
        return;
      }
      const samples = asArray(loadStore(STORAGE_KEYS.samples, []));
      const missing = [];
      const notRetention = [];
      codes.forEach((code) => {
        // sample锛氬綋鍓嶆牱鍝?
        const sample = samples.find((item) => item.code === code);
        if (!sample) {
          missing.push(code);
          return;
        }
        if (sample.location !== preRetentionLocation) {
          notRetention.push(code);
          return;
        }
        sample.location = targetLab;
        sample.owner = data.owner || sample.owner;
        sample.status = resolveSampleStatus(targetLab);
        sample.flow_status = resolveFlowStatusByLocation(targetLab, sample.status);
        sample.updated_at = new Date().toISOString();
        appendSampleHistory(sample, "暂存间派发");
      });
      const warnings = [];
      if (missing.length) {
        warnings.push(`未找到样品：${missing.join("、")}`);
      }
      if (notRetention.length) {
        warnings.push(`样品不在暂存间：${notRetention.join("、")}`);
      }
      setWarning(retentionWarning, warnings.length ? `${warnings.join("；")}。` : "");
      saveStore(STORAGE_KEYS.samples, samples);
      renderAll(labels);
    });
  }

  const retentionReset = document.querySelector('[data-action="retention-reset"]');
  if (retentionReset) {
    retentionReset.addEventListener("click", (event) => {
      event.preventDefault();
      const form = document.querySelector('[data-form="retention-dispatch"]');
      if (form) {
        form.querySelectorAll("input, textarea").forEach((field) => {
          field.value = "";
        });
        form.querySelectorAll("select").forEach((field) => {
          field.value = "";
        });
      }
      setWarning(retentionWarning, "");
    });
  }

  // Staging dispatch: forward to labs and update history.
  const stagingDispatch = document.querySelector('[data-action="staging-dispatch"]');
  if (stagingDispatch) {
    stagingDispatch.addEventListener("click", (event) => {
      event.preventDefault();
      const data = getFormData('[data-form="staging-dispatch"]');
      const preRetentionLocation = labels.preRetentionLocation || labels.retentionLocation;
      const targetLab = data.target_lab || "";
      const codes = parseCodeList(data.codes);
      if (!targetLab || codes.length === 0) {
        setWarning(stagingWarning, "请填写样品编号并选择目标实验室。");
        return;
      }
      const samples = asArray(loadStore(STORAGE_KEYS.samples, []));
      const missing = [];
      const notStaging = [];
      codes.forEach((code) => {
        // sample锛氬綋鍓嶆牱鍝?
        const sample = samples.find((item) => item.code === code);
        if (!sample) {
          missing.push(code);
          return;
        }
        if (sample.location !== preRetentionLocation) {
          notStaging.push(code);
          return;
        }
        sample.location = targetLab;
        sample.owner = data.owner || sample.owner;
        sample.status = labels.sampleTesting;
        sample.flow_status = resolveFlowStatusByLocation(targetLab, sample.status);
        sample.updated_at = new Date().toISOString();
        appendSampleHistory(sample, "暂存间派发");
      });
      const warnings = [];
      if (missing.length) {
        warnings.push(`未找到样品：${missing.join("、")}`);
      }
      if (notStaging.length) {
        warnings.push(`不在暂存间：${notStaging.join("、")}`);
      }
      setWarning(stagingWarning, warnings.length ? `${warnings.join("；")}。` : "");
      saveStore(STORAGE_KEYS.samples, samples);
      renderAll(labels);
    });
  }

  const stagingReset = document.querySelector('[data-action="staging-reset"]');
  if (stagingReset) {
    stagingReset.addEventListener("click", (event) => {
      event.preventDefault();
      const form = document.querySelector('[data-form="staging-dispatch"]');
      if (form) {
        form.querySelectorAll("input, textarea").forEach((field) => {
          field.value = "";
        });
        form.querySelectorAll("select").forEach((field) => {
          field.value = "";
        });
      }
      setWarning(stagingWarning, "");
    });
  }
  const sampleTraceRun = document.querySelector('[data-action="sample-trace-run"]');
  if (sampleTraceRun) {
    sampleTraceRun.addEventListener("click", (event) => {
      event.preventDefault();
      const data = getFormData('[data-form="sample-trace"]');
      renderSampleTrace(labels, data.task_code);
    });
  }

  const sampleTraceReset = document.querySelector('[data-action="sample-trace-reset"]');
  if (sampleTraceReset) {
    sampleTraceReset.addEventListener("click", (event) => {
      event.preventDefault();
      const form = document.querySelector('[data-form="sample-trace"]');
      if (form) {
        const input = form.querySelector('input[name="task_code"]');
        if (input) {
          input.value = "";
        }
      }
      renderSampleTrace(labels, "");
    });
  }

  const deviceAdd = document.querySelector('[data-action="device-add"]');
  if (deviceAdd) {
    deviceAdd.addEventListener("click", (event) => {
      event.preventDefault();
      const data = getFormData('[data-form="device-form"]');
      if (!data.code) {
        return;
      }
      const devices = loadStore(STORAGE_KEYS.devices, []);
      devices.unshift({
        id: generateId("device"),
        code: data.code,
        name: data.name || "",
        type: data.type || "",
        status: data.status || labels.deviceIdle,
        location: data.location || "",
        next_cal: data.next_cal || "",
      });
      saveStore(STORAGE_KEYS.devices, devices);
      renderAll(labels);
    });
  }

  const deviceSave = document.querySelector('[data-action="device-save"]');
  if (deviceSave) {
    deviceSave.addEventListener("click", (event) => {
      event.preventDefault();
      const data = getFormData('[data-form="device-form"]');
      if (!data.code) {
        return;
      }
      const devices = loadStore(STORAGE_KEYS.devices, []);
      // existing閿涙艾鍑＄€涙ê婀拋鎯ь槵鐠佹澘缍?
      const existing = devices.find((device) => device.code === data.code);
      if (existing) {
        existing.name = data.name || existing.name;
        existing.type = data.type || existing.type;
        existing.status = data.status || existing.status;
        existing.location = data.location || existing.location;
        existing.next_cal = data.next_cal || existing.next_cal;
      } else {
        devices.unshift({
          id: generateId("device"),
          code: data.code,
          name: data.name || "",
          type: data.type || "",
          status: data.status || labels.deviceIdle,
          location: data.location || "",
          next_cal: data.next_cal || "",
        });
      }
      saveStore(STORAGE_KEYS.devices, devices);
      renderAll(labels);
    });
  }

  const dataValidate = document.querySelector('[data-action="data-validate"]');
  if (dataValidate) {
    dataValidate.addEventListener("click", (event) => {
      event.preventDefault();
      const streams = loadStore(STORAGE_KEYS.streams, []);
      streams.forEach((stream) => {
        stream.status = labels.dataComplete;
      });
      saveStore(STORAGE_KEYS.streams, streams);
      resetManualScheduleForm();
      renderAll(labels);
    });
  }

  const reportGenerate = document.querySelector('[data-action="report-generate"]');
  if (reportGenerate) {
    reportGenerate.addEventListener("click", (event) => {
      event.preventDefault();
      const data = getFormData('[data-form="data-report"]');
      const streams = loadStore(STORAGE_KEYS.streams, []);
      if (data.task_code) {
        // target閿涙氨娲伴弽鍥ㄦ殶閹诡喗绁?
        const target = streams.find((stream) => stream.task_code === data.task_code);
        if (target) {
          target.reported = true;
        }
      } else {
        streams.forEach((stream) => {
          if (stream.status === labels.dataComplete) {
            stream.reported = true;
          }
        });
      }
      saveStore(STORAGE_KEYS.streams, streams);
      const modal = document.getElementById("report-modal");
      if (modal) {
        modal.classList.remove("is-open");
      }
      renderAll(labels);
    });
  }
}

export { attachActionHandlers };




