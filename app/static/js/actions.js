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

// formatLocalDate：格式化本地日期
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

// formatLocalTime：格式化本地时间
function formatLocalTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

// toDateTimeLocalValue：转换为datetime-local输入值
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

// escapeSelectorValue：转义选择器值
function escapeSelectorValue(value) {
  if (window.CSS && typeof window.CSS.escape === "function") {
    return window.CSS.escape(value);
  }
  return value.replace(/["\\]/g, "\\$&");
}

// overlaps：判断时间区间是否重叠
function overlaps(start, end, rangeStart, rangeEnd) {
  return start < rangeEnd && end > rangeStart;
}

// parseCodeList：解析编号列表
function parseCodeList(value) {
  return (value || "")
    .split(/[\s,;]+/)
    .map((code) => code.trim())
    .filter(Boolean);
}

// attachActionHandlers：绑定页面动作事件
function attachActionHandlers(labels) {
  // setWarning：设置表单警告提示
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

  const taskWarning = document.querySelector("[data-task-warning]");
  const taskQuickWarning = document.querySelector("[data-task-quick-warning]");
  const scheduleWarning = document.querySelector("[data-schedule-warning]");
  const scheduleEditWarning = document.querySelector("[data-schedule-edit-warning]");
  const stagingWarning = document.querySelector("[data-staging-warning]");
  const unpackingWarning = document.querySelector("[data-unpacking-warning]");
  const retentionWarning = document.querySelector("[data-retention-warning]");
  const taskEditWarning = document.querySelector("[data-task-edit-warning]");
  const testingRandom = document.body?.dataset?.testingRandom === "1";
  const randomTaskYear = document.body?.dataset?.randomTaskYear || "2026";

  // getSlotLabel：获取时段显示文案
  const getSlotLabel = (slotKey) => (slotKey === "afternoon" ? labels.slotAfternoon : labels.slotMorning);

  // resolveSampleStatus：根据位置推导样品状态
  const resolveSampleStatus = (location) => {
    if (location === labels.retentionLocation) {
      return labels.sampleStored;
    }
    if (location === labels.unpackingLocation || location === labels.intakeLocation) {
      return labels.sampleReceived;
    }
    if (TEST_LABS.includes(location)) {
      return labels.sampleTesting;
    }
    return labels.sampleReceived;
  };

  // ensureSampleHistory：确保样品历史数组
  const ensureSampleHistory = (sample) => {
    if (!Array.isArray(sample.history)) {
      sample.history = [];
    }
  };

  // appendSampleHistory：追加样品历史记录
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

  // ensureOption：确保下拉选项存在
  const ensureOption = (select, value) => {
    if (!select || !value) {
      return;
    }
    // exists：检查选项是否已存在
    const exists = Array.from(select.options).some((option) => option.value === value);
    if (!exists) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value;
      select.appendChild(option);
    }
  };

  // nextTaskCode：生成下一个任务编号
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

  // buildRandomTask：构建随机任务
  const buildRandomTask = (tasks, statusOverride) => {
    const filteredTypes = TEST_TASK_TYPES.filter(
      (type) => !type.includes("\u6052\u6e29\u6052\u6e7f") && !type.includes("\u9ad8\u4f4e\u6e29\u6e7f\u70ed")
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
      status: statusOverride || labels.statusAccepted,
      created_at: now.toISOString(),
    };
  };

  // resolveScheduleTimes：解析排程时间信息
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
    return { dateValue, slot, startTime, endTime, startAt, endAt };
  };

  // clearConflictHighlights：清除冲突高亮
  const clearConflictHighlights = () => {
    document.querySelectorAll(".gantt-slot.focus").forEach((slot) => slot.classList.remove("focus"));
  };

  // highlightConflictSlots：高亮冲突时段
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

  // buildSuggestion：生成可用时段建议
  const buildSuggestion = (schedules, device, dateValue, ignoreId) => {
    if (!device || !dateValue) {
      return "";
    }
    const startDate = new Date(`${dateValue}T00:00:00`);
    if (Number.isNaN(startDate.getTime())) {
      return "";
    }
    // isSlotFree：判断时段是否空闲
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

  // fillLabOptions：填充实验室下拉选项
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

// handleTaskCreate：处理任务创建
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
          status: statusOverride || labels.statusAccepted,
          created_at: new Date().toISOString(),
        };
    setWarning(warningEl, "");
    tasks.unshift(task);
    saveStore(STORAGE_KEYS.tasks, tasks);
    return true;
  };

  const taskSubmit = document.querySelector('[data-action="task-submit"]');
  if (taskSubmit) {
    taskSubmit.addEventListener("click", (event) => {
      event.preventDefault();
      if (handleTaskCreate('[data-form="task-intake"]', labels.statusAccepted, taskWarning)) {
        renderAll(labels);
      }
    });
  }

  const taskDraft = document.querySelector('[data-action="task-draft"]');
  if (taskDraft) {
    taskDraft.addEventListener("click", (event) => {
      event.preventDefault();
      if (handleTaskCreate('[data-form="task-intake"]', labels.statusWaiting, taskWarning)) {
        renderAll(labels);
      }
    });
  }

  const taskQuick = document.querySelector('[data-action="task-quick-submit"]');
  if (taskQuick) {
    taskQuick.addEventListener("click", (event) => {
      event.preventDefault();
      if (handleTaskCreate('[data-form="task-quick"]', labels.statusAccepted, taskQuickWarning)) {
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
    taskQuickDraft.addEventListener("click", (event) => {
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

  // getTaskEditForm：获取任务编辑表单
  const getTaskEditForm = () => document.querySelector('[data-form="task-edit"]');
  // getTaskDrawer：获取任务抽屉
  const getTaskDrawer = () => document.getElementById("task-drawer");

  // openTaskEditor：打开任务编辑抽屉并填充
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

  // bindTaskEditClick：绑定任务编辑点击事件
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

  // performTaskUpdate：保存任务编辑内容
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

  // performTaskDelete：删除任务并刷新
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
    // updated：移除目标后的新列表
    const updated = taskId ? tasks.filter((item) => item.id !== taskId) : tasks.filter((item) => item !== task);
    saveStore(STORAGE_KEYS.tasks, updated);

    if (task?.code) {
      const schedules = loadStore(STORAGE_KEYS.schedules, []);
      const streams = loadStore(STORAGE_KEYS.streams, []);
      // nextSchedules：移除任务后的排程列表
      const nextSchedules = schedules.filter((entry) => entry.task_code !== task.code);
      // nextStreams：移除任务后的数据流列表
      const nextStreams = streams.filter((entry) => entry.task_code !== task.code);
      saveStore(STORAGE_KEYS.schedules, nextSchedules);
      saveStore(STORAGE_KEYS.streams, nextStreams);
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

  // resetManualScheduleForm：重置手动排程表单
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
      schedules.push({
        id: generateId("schedule"),
        task_code: data.task_code,
        device: data.device,
        start_at: startAt.toISOString(),
        end_at: endAt.toISOString(),
        status: labels.statusScheduled,
      });
      // task：当前任务
      const task = tasks.find((t) => t.code === data.task_code);
      if (task) {
        task.status = isRetentionSchedule ? labels.statusRetention : labels.statusScheduled;
      }
      if (!streams.find((stream) => stream.task_code === data.task_code)) {
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
  // bindEditTimeSlot：绑定排程时间段联动
  const bindEditTimeSlot = () => {
    if (!scheduleEditForm) {
      return;
    }
    const slotSelect = scheduleEditForm.querySelector('[data-edit-time-slot]');
    const customFields = scheduleEditForm.querySelectorAll("[data-edit-custom-time]");
    // toggleCustom：切换自定义时间输入
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

  // openScheduleEditor：打开排程编辑抽屉并填充
  const openScheduleEditor = (scheduleId) => {
    if (!scheduleId || !scheduleEditForm) {
      return;
    }
    const schedules = loadStore(STORAGE_KEYS.schedules, []);
    const tasks = loadStore(STORAGE_KEYS.tasks, []);
    const devices = loadStore(STORAGE_KEYS.devices, []);
    // schedule：当前排程
    const schedule = schedules.find((entry) => entry.id === scheduleId);
    if (!schedule) {
      return;
    }
    // task：当前任务
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

  // handleScheduleEditClick：绑定排程编辑点击事件
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
      // schedule：当前排程
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
      // stream：当前数据流
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
      // schedule：当前排程
      const schedule = schedules.find((entry) => entry.id === scheduleId);
      // updated：移除目标后的新列表
      const updated = schedules.filter((entry) => entry.id !== scheduleId);
      saveStore(STORAGE_KEYS.schedules, updated);

      const tasks = loadStore(STORAGE_KEYS.tasks, []);
      if (schedule) {
        // task：当前任务
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
const sampleSubmit = document.querySelector('[data-action="sample-submit"]');
  if (sampleSubmit) {
    sampleSubmit.addEventListener("click", (event) => {
      event.preventDefault();
      const data = getFormData('[data-form="sample-intake"]');
      if (!data.code) {
        data.code = `SP-${Date.now().toString().slice(-6)}`;
      }
      const samples = loadStore(STORAGE_KEYS.samples, []);
      const sample = {
        id: generateId("sample"),
        code: data.code,
        task_code: data.task_code || "",
        location: labels.intakeLocation || labels.unpackingLocation,
        owner: "",
        status: labels.sampleReceived,
        created_at: new Date().toISOString(),
      };
      appendSampleHistory(sample, "样品登记");
      samples.unshift(sample);
      saveStore(STORAGE_KEYS.samples, samples);
      const tasks = loadStore(STORAGE_KEYS.tasks, []);
      // task：当前任务
      const task = tasks.find((t) => t.code === data.task_code);
      if (task && task.status === labels.statusAccepted) {
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
      if (!data.code) {
        data.code = `SP-${Date.now().toString().slice(-6)}`;
      }
      const samples = loadStore(STORAGE_KEYS.samples, []);
      const sample = {
        id: generateId("sample"),
        code: data.code,
        task_code: data.task_code || "",
        location: labels.intakeLocation || labels.unpackingLocation,
        owner: "",
        status: labels.sampleReceived,
        created_at: new Date().toISOString(),
      };
      appendSampleHistory(sample, "样品登记");
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
      const targetLocation = data.location || labels.intakeLocation || labels.retentionLocation;
      if (!targetLocation || codes.length === 0) {
        return;
      }
      const samples = loadStore(STORAGE_KEYS.samples, []);
      const now = new Date().toISOString();
      const actionText = targetLocation === labels.retentionLocation ? "\u63a5\u9a73\u533a\u9001\u8fbe\u6682\u5b58\u95f4" : "\u6279\u91cf\u5165\u5e93";
      codes.forEach((code) => {
        if (!code) {
          return;
        }
        // sample：当前样品
        let sample = samples.find((item) => item.code === code);
        if (!sample) {
          sample = {
            id: generateId("sample"),
            code,
            task_code: "",
            location: targetLocation,
            owner: data.owner || "",
            status: resolveSampleStatus(targetLocation),
            created_at: now,
          };
          samples.unshift(sample);
        } else {
          sample.location = targetLocation;
          sample.owner = data.owner || sample.owner;
          sample.status = resolveSampleStatus(targetLocation);
          sample.updated_at = now;
        }
        if (targetLocation === labels.retentionLocation) {
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

  // Intake/Unpacking dispatch to lab or retention.
const unpackingDispatch = document.querySelector('[data-action="unpacking-dispatch"]');
  if (unpackingDispatch) {
    unpackingDispatch.addEventListener("click", (event) => {
      event.preventDefault();
      const data = getFormData('[data-form="unpacking-dispatch"]');
      const targetLocation = data.target_location || "";
      const codes = parseCodeList(data.codes);
      const intakeLocations = [labels.intakeLocation, labels.unpackingLocation].filter(Boolean);
      if (!targetLocation || codes.length === 0) {
        setWarning(unpackingWarning, "请填写样品编号并选择目标位置。");
        return;
      }
      const samples = loadStore(STORAGE_KEYS.samples, []);
      const missing = [];
      const notUnpacking = [];
      codes.forEach((code) => {
        // sample：当前样品
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
        if (targetLocation === labels.retentionLocation) {
          sample.retention_source = "intake";
        } else if (sample.retention_source) {
          delete sample.retention_source;
        }
        sample.owner = data.owner || sample.owner;
        sample.status = resolveSampleStatus(targetLocation);
        sample.updated_at = new Date().toISOString();
        const actionText = targetLocation === labels.retentionLocation ? "\u63a5\u9a73\u533a\u9001\u8fbe\u6682\u5b58\u95f4" : "\u63a5\u9a73\u533a\u6d3e\u53d1";
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
      const targetLab = data.target_lab || "";
      const codes = parseCodeList(data.codes);
      if (!targetLab || codes.length === 0) {
        setWarning(retentionWarning, "请填写样品编号并选择目标实验室。");
        return;
      }
      if (targetLab === labels.retentionLocation) {
        setWarning(retentionWarning, "暂存间排程只能派发至实验室。");
        return;
      }
      const samples = loadStore(STORAGE_KEYS.samples, []);
      const missing = [];
      const notRetention = [];
      codes.forEach((code) => {
        // sample：当前样品
        const sample = samples.find((item) => item.code === code);
        if (!sample) {
          missing.push(code);
          return;
        }
        if (sample.location !== labels.retentionLocation) {
          notRetention.push(code);
          return;
        }
        sample.location = targetLab;
        sample.owner = data.owner || sample.owner;
        sample.status = resolveSampleStatus(targetLab);
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
      const targetLab = data.target_lab || "";
      const codes = parseCodeList(data.codes);
      if (!targetLab || codes.length === 0) {
        setWarning(stagingWarning, "请填写样品编号并选择目标实验室。");
        return;
      }
      const samples = loadStore(STORAGE_KEYS.samples, []);
      const missing = [];
      const notStaging = [];
      codes.forEach((code) => {
        // sample：当前样品
        const sample = samples.find((item) => item.code === code);
        if (!sample) {
          missing.push(code);
          return;
        }
        if (sample.location !== labels.retentionLocation) {
          notStaging.push(code);
          return;
        }
        sample.location = targetLab;
        sample.owner = data.owner || sample.owner;
        sample.status = labels.sampleTesting;
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
      setWarning(stagingWarning, warnings.length ? `${warnings.join("。")}。` : "");
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
      // existing：已存在设备记录
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
        // target：目标数据流
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
