// 提供排程页所需的表单、看板行、甘特数据和增删改辅助函数。
import { getLabsForTestType, TEST_LABS } from "@/lib/labs.js";
import { buildExperimentTypeOptions, collectExperimentTypes } from "@/lib/experimentTypes";

const STATUS_WAITING = "待排程";
const STATUS_SCHEDULED = "已排程";
const STATUS_RUNNING = "实验中";
const STATUS_COMPLETED = "实验已完成";
const STATUS_RETENTION = "暂存间存放";
const STREAMING_STATUS = "Streaming";
const RETENTION_DEVICE = "恒温恒湿间（暂存间）";
const RETENTION_KEYWORD = "暂存间";
const STARTED_TRAY_STATUSES = new Set(["实验进行中", "实验中", "实验已完成", "实验完成", "放置实验后暂存间", "厂家收回"]);
const COMPLETED_TRAY_STATUSES = new Set(["实验已完成", "实验完成", "放置实验后暂存间", "厂家收回"]);
const SLOT_RANGES = Object.freeze({
  morning: { start: "08:00", end: "12:00", label: "上午 08:00-12:00" },
  afternoon: { start: "12:00", end: "18:00", label: "下午 12:00-18:00" },
});

// 排程模块的大部分判断都依赖稳定字符串，因此先做统一规范化。
const normalizeText = (value) => String(value ?? "").trim();

const buildExperimentLabel = (experimentCode) => {
  const code = normalizeText(experimentCode);
  if (!code) {
    return "";
  }
  const suffix = code.split("-").at(-1) || code;
  return `${suffix}实验`;
};

const buildFallbackExperimentsForTask = (task) => {
  const taskCode = normalizeText(task?.code);
  if (!taskCode) {
    return [];
  }
  const experimentTypes = collectExperimentTypes(task?.test_type, task?.required_device);
  const experimentCodes = Array.isArray(task?.experiment_codes)
    ? task.experiment_codes.map((code) => normalizeText(code)).filter(Boolean)
    : [];
  const codes = experimentCodes.length > 0 ? experimentCodes : [`${taskCode}-A`];

  return codes.map((experimentCode, index) => ({
    experiment_code: experimentCode,
    experiment_name: experimentTypes[index] || experimentTypes[0] || buildExperimentLabel(experimentCode),
    required_device: experimentTypes[index] || experimentTypes[0] || "",
    task_code: taskCode,
  }));
};

const buildExperimentCandidates = ({ taskCode, experiments, tasks }) => {
  const normalizedTaskCode = normalizeText(taskCode);
  const experimentList = Array.isArray(experiments) ? experiments : [];
  const explicitExperiments = experimentList.filter(
    (experiment) =>
      !normalizedTaskCode || normalizeText(experiment?.task_code) === normalizedTaskCode,
  );
  if (explicitExperiments.length > 0) {
    return explicitExperiments;
  }

  const taskList = Array.isArray(tasks) ? tasks : [];
  if (normalizedTaskCode) {
    const task = taskList.find((entry) => normalizeText(entry?.code) === normalizedTaskCode);
    return task ? buildFallbackExperimentsForTask(task) : [];
  }

  return taskList.flatMap((task) => buildFallbackExperimentsForTask(task));
};

// 暂存间是特殊设备类型，很多冲突和状态判断都要排除它。
const isRetentionDevice = (value) => normalizeText(value).includes(RETENTION_KEYWORD);

// 输入可能来自 ISO 字符串、空值或 Date 实例，统一在这里做容错解析。
const parseDate = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

// 把 Date 对象格式化成日期输入框可直接消费的 yyyy-MM-dd。
const toLocalDateValue = (date) => {
  const source = date instanceof Date ? new Date(date.getTime()) : new Date(date);
  if (Number.isNaN(source.getTime())) {
    return "";
  }
  const year = source.getFullYear();
  const month = String(source.getMonth() + 1).padStart(2, "0");
  const day = String(source.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

// 从日期对象中提取 HH:mm，供时间输入框和展示逻辑复用。
const toLocalTimeValue = (value) => {
  const date = parseDate(value);
  if (!date) {
    return "";
  }
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
};

// 排程表格统一展示 yyyy-MM-dd HH:mm 格式。
const formatDateTime = (value) => {
  const date = parseDate(value);
  if (!date) {
    return "";
  }
  return `${toLocalDateValue(date)} ${toLocalTimeValue(date)}`;
};

// 甘特图和默认排程窗口经常需要按天偏移。
const addDays = (date, days) => {
  const nextDate = new Date(date.getTime());
  nextDate.setDate(nextDate.getDate() + days);
  return nextDate;
};

// 判断两个时间区间是否重叠，是冲突检测和甘特图命中的基础工具。
const overlaps = (startA, endA, startB, endB) => startA < endB && endA > startB;

// 新增排程、流记录等前端实体时使用轻量级本地 ID。
const createId = (prefix) => {
  const random = Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, "0");
  return `${prefix}-${Date.now()}-${random}`;
};

const SLOT_SEQUENCE = ["am", "pm"];
const HALF_DAY_MS = 12 * 60 * 60 * 1000;

// 计划时长以 0.5 小时为最小粒度，其他输入都会归一化到这个精度。
const parsePlannedHours = (value) => {
  const rawValue = Number.parseFloat(String(value ?? "").trim());
  if (!Number.isFinite(rawValue)) {
    return null;
  }
  const normalized = Math.round(rawValue * 2) / 2;
  return normalized >= 0.5 ? normalized : null;
};

// 如果没有显式填写计划时长，则从开始/结束时间反推。
const inferPlannedHours = (startAt, endAt) => {
  if (!startAt || !endAt) {
    return 3.5;
  }
  const hours = (endAt.getTime() - startAt.getTime()) / (1000 * 60 * 60);
  return parsePlannedHours(hours) || 3.5;
};

// 甘特图里的时间段会根据当前时刻区分为进行中、已完成或忙碌。
const getSlotState = ({ startAt, endAt, now, started = false, completed = false }) => {
  if (completed && startAt && endAt) {
    if (endAt < now) {
      return { state: "completed", className: "gantt-slot busy completed" };
    }
    if (startAt <= now && endAt >= now) {
      return { state: "running", className: "gantt-slot busy running" };
    }
  }
  if (started) {
    return { state: "running", className: "gantt-slot busy running" };
  }
  return { state: "busy", className: "gantt-slot busy" };
};

// 计算视图窗口需要覆盖多少天，以便甘特图自动延展。
const getDaySpan = (startDate, endDate) => {
  const startValue = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate()).getTime();
  const endValue = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate()).getTime();
  return Math.floor((endValue - startValue) / (24 * 60 * 60 * 1000));
};

// 手动排程默认落在“当前时刻之后最近一个合法时段”。
const resolveLegalManualScheduleState = (now = new Date()) => {
  const current = parseDate(now) || new Date();
  const currentHour = current.getHours();

  if (currentHour < 12) {
    return {
      schedule_date: toLocalDateValue(current),
      time_slot: "morning",
    };
  }

  if (currentHour < 18) {
    return {
      schedule_date: toLocalDateValue(current),
      time_slot: "afternoon",
    };
  }

  return {
    schedule_date: toLocalDateValue(addDays(current, 1)),
    time_slot: "morning",
  };
};

// 阻止用户把手动排程放到已经过去的非法时间片。
const isManualScheduleSelectionLegal = (form, now = new Date()) => {
  const selectedDate = normalizeText(form?.schedule_date);
  const selectedSlot = normalizeText(form?.time_slot) || "morning";
  if (!selectedDate || selectedSlot === "custom") {
    return true;
  }

  const today = toLocalDateValue(now);
  if (selectedDate > today) {
    return true;
  }
  if (selectedDate < today) {
    return false;
  }

  const currentHour = now.getHours();
  if (currentHour >= 18) {
    return false;
  }
  if (currentHour >= 12 && selectedSlot === "morning") {
    return false;
  }
  return true;
};

// 表单工厂用于统一手动创建和编辑状态的数据结构。
function createManualScheduleForm(now = new Date()) {
  const legalState = resolveLegalManualScheduleState(now);
  return {
    custom_end: "",
    custom_start: "",
    device: "",
    experiment_code: "",
    planned_hours: 3.5,
    schedule_date: legalState.schedule_date,
    task_code: "",
    time_slot: legalState.time_slot,
  };
}

function createScheduleEditForm() {
  return {
    custom_end: "",
    custom_start: "",
    device: "",
    experiment_code: "",
    id: "",
    planned_hours: 3.5,
    schedule_date: "",
    task_code: "",
    time_slot: "morning",
  };
}

// 将已存排程映射为编辑抽屉所需的表单结构。
function buildScheduleEditForm(schedule) {
  const startAt = parseDate(schedule?.start_at);
  const endAt = parseDate(schedule?.end_at);
  const startTime = startAt ? toLocalTimeValue(startAt) : "";
  const endTime = endAt ? toLocalTimeValue(endAt) : "";
  let timeSlot = "custom";

  if (startTime === SLOT_RANGES.morning.start) {
    timeSlot = "morning";
  } else if (startTime === SLOT_RANGES.afternoon.start) {
    timeSlot = "afternoon";
  }

  // 编辑表单会尽量把固定时段还原回上午/下午选项，否则回退到自定义时段。
  return {
    custom_end: endTime,
    custom_start: startTime,
    device: normalizeText(schedule?.device),
    experiment_code: normalizeText(schedule?.experiment_code),
    id: normalizeText(schedule?.id),
    planned_hours: parsePlannedHours(schedule?.planned_hours) || inferPlannedHours(startAt, endAt),
    schedule_date: startAt ? toLocalDateValue(startAt) : "",
    task_code: normalizeText(schedule?.task_code),
    time_slot: timeSlot,
  };
}

function buildScheduleRescheduleForm(schedule) {
  const editForm = buildScheduleEditForm(schedule);
  return {
    custom_end: editForm.custom_end,
    custom_start: editForm.custom_start,
    device: editForm.device,
    experiment_code: editForm.experiment_code,
    planned_hours: editForm.planned_hours,
    schedule_date: editForm.schedule_date,
    task_code: editForm.task_code,
    time_slot: editForm.time_slot,
  };
}

// 解析手动排程操作实际使用的开始和结束时间。
function resolveScheduleTimes(form, now = new Date()) {
  const dateValue = normalizeText(form?.schedule_date);
  if (!dateValue) {
    return { error: "Invalid schedule date" };
  }

  const isRetention = isRetentionDevice(form?.device);
  if (isRetention) {
    // 暂存间记录按“立即进入、立即结束”的占位逻辑处理，不占正式实验时长。
    const startAt = new Date(now.getTime());
    const endAt = new Date(now.getTime());
    return {
      dateValue: toLocalDateValue(startAt),
      endAt,
      endTime: toLocalTimeValue(endAt),
      plannedHours: 0,
      slot: "retention",
      startAt,
      startTime: toLocalTimeValue(startAt),
    };
  }

  const slot = normalizeText(form?.time_slot) || "morning";
  let startTime = "";
  let plannedHours = parsePlannedHours(form?.planned_hours);

  if (slot === "custom") {
    // 自定义时段优先使用手填开始时间，如未填计划时长则从结束时间反推。
    startTime = normalizeText(form?.custom_start);
    if (!startTime) {
      return { error: "Custom start time required" };
    }
    if (!plannedHours) {
      const endTime = normalizeText(form?.custom_end);
      const startAt = parseDate(`${dateValue}T${startTime}:00`);
      const endAt = parseDate(`${dateValue}T${endTime}:00`);
      plannedHours = inferPlannedHours(startAt, endAt);
    }
  } else {
    // 上午/下午快捷时段直接复用预设时间窗。
    const range = SLOT_RANGES[slot] || SLOT_RANGES.morning;
    startTime = range.start;
    plannedHours ||= inferPlannedHours(
      parseDate(`${dateValue}T${range.start}:00`),
      parseDate(`${dateValue}T${range.end}:00`),
    );
  }

  if (!plannedHours) {
    return { error: "Planned hours must be at least 0.5" };
  }

  const startAt = parseDate(`${dateValue}T${startTime}:00`);
  const endAt = startAt ? new Date(startAt.getTime() + plannedHours * 60 * 60 * 1000) : null;
  if (!startAt || !endAt || endAt <= startAt || endAt <= now) {
    return { error: "Invalid schedule time" };
  }

  return {
    dateValue,
    endAt,
    endTime: toLocalTimeValue(endAt),
    plannedHours,
    slot,
    startAt,
    startTime,
  };
}

// 推导看板行和留样视图共用的任务状态。
function resolveTaskStatus(taskOrTaskCode, schedules, now = new Date()) {
  const taskCode =
    typeof taskOrTaskCode === "object" && taskOrTaskCode !== null
      ? normalizeText(taskOrTaskCode?.code)
      : normalizeText(taskOrTaskCode);
  const rawStatus =
    typeof taskOrTaskCode === "object" && taskOrTaskCode !== null
      ? normalizeText(taskOrTaskCode?.status)
      : "";
  const related = (Array.isArray(schedules) ? schedules : []).filter(
    (schedule) => normalizeText(schedule?.task_code) === taskCode,
  );

  if (rawStatus === STATUS_RUNNING) {
    return STATUS_RUNNING;
  }

  const labSchedules = related.filter((schedule) => !isRetentionDevice(schedule?.device));
  const retentionSchedules = related.filter((schedule) => isRetentionDevice(schedule?.device));
  const currentTime = now.getTime();

  // 当前时间命中排程窗口也只能说明任务已进入排程窗口，不能自动说明已经开始实验。
  const activeLab = labSchedules.find((schedule) => {
    const start = parseDate(schedule?.start_at);
    const end = parseDate(schedule?.end_at);
    return start && end && start.getTime() <= currentTime && end.getTime() >= currentTime;
  });
  if (activeLab) {
    return STATUS_SCHEDULED;
  }

  // 其次判断是否存在未来或尚未结束的正式实验排程。
  const futureLab = labSchedules.find((schedule) => {
    const end = parseDate(schedule?.end_at);
    return end && end.getTime() > currentTime;
  });
  if (futureLab) {
    return STATUS_SCHEDULED;
  }

  // 有历史实验结束记录但没有后续排程时，视为已完成。
  const completedLab = labSchedules.find((schedule) => {
    const end = parseDate(schedule?.end_at);
    return end && end.getTime() < currentTime;
  });
  if (completedLab) {
    return STATUS_COMPLETED;
  }

  if (retentionSchedules.length > 0) {
    return STATUS_RETENTION;
  }

  return STATUS_WAITING;
}

const statusClass = (status) => {
  if (status === STATUS_RUNNING) {
    return "status running";
  }
  if (status === STATUS_SCHEDULED) {
    return "status scheduled";
  }
  if (status === STATUS_RETENTION) {
    return "status retention";
  }
  if (status === STATUS_COMPLETED) {
    return "status completed";
  }
  return "status";
};

const sortTextList = (values) =>
  Array.from(new Set((Array.isArray(values) ? values : []).map((value) => normalizeText(value)).filter(Boolean))).sort((left, right) =>
    left.localeCompare(right, "zh-Hans-CN"),
  );

const DEFAULT_TASK_COLOR = "#1d4ed8";

const resolveLabCandidates = (value) => {
  const normalizedValue = normalizeText(value);
  if (!normalizedValue) {
    return [];
  }
  if (TEST_LABS.includes(normalizedValue)) {
    return [normalizedValue];
  }
  return getLabsForTestType(normalizedValue).filter((lab) => !isRetentionDevice(lab));
};

const hashText = (value) => {
  const text = normalizeText(value);
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }
  return hash;
};

const resolveTaskColor = (taskCode) => {
  const normalizedTaskCode = normalizeText(taskCode);
  if (!normalizedTaskCode) {
    return DEFAULT_TASK_COLOR;
  }
  const hash = hashText(normalizedTaskCode);
  const hue = (hash * 137) % 360;
  const saturation = 74 + (hash % 8);
  const lightness = 36 + ((hash >>> 3) % 7);
  return `hsl(${hue} ${saturation}% ${lightness}%)`;
};

const buildSelectedTaskLabSet = ({ selectedTaskCode, experiments, schedules, tasks }) => {
  const normalizedTaskCode = normalizeText(selectedTaskCode);
  if (!normalizedTaskCode) {
    return null;
  }

  const labs = new Set();
  buildExperimentCandidates({ taskCode: normalizedTaskCode, experiments, tasks }).forEach((experiment) => {
    resolveLabCandidates(experiment?.required_device).forEach((lab) => labs.add(lab));
  });

  (Array.isArray(schedules) ? schedules : []).forEach((schedule) => {
    if (normalizeText(schedule?.task_code) !== normalizedTaskCode) {
      return;
    }
    const device = normalizeText(schedule?.device);
    if (device && !isRetentionDevice(device)) {
      labs.add(device);
    }
  });

  return labs;
};

const hasScheduleOverlap = (schedules) => {
  const sortedSchedules = [...(Array.isArray(schedules) ? schedules : [])].sort((left, right) => {
    const leftTime = parseDate(left?.start_at)?.getTime() || 0;
    const rightTime = parseDate(right?.start_at)?.getTime() || 0;
    return leftTime - rightTime;
  });

  for (let index = 1; index < sortedSchedules.length; index += 1) {
    const previousEnd = parseDate(sortedSchedules[index - 1]?.end_at);
    const currentStart = parseDate(sortedSchedules[index]?.start_at);
    if (previousEnd && currentStart && previousEnd > currentStart) {
      return true;
    }
  }
  return false;
};

const buildSlotTaskItems = ({ matchedSchedules, now, experimentNameByCode }) => {
  const sortedSchedules = [...matchedSchedules].sort((left, right) => {
    const leftTime = parseDate(left?.start_at)?.getTime() || 0;
    const rightTime = parseDate(right?.start_at)?.getTime() || 0;
    return leftTime - rightTime;
  });

  const items = [];
  const byTaskCode = new Map();

  sortedSchedules.forEach((schedule) => {
    const taskCode = normalizeText(schedule?.task_code);
    if (!taskCode) {
      return;
    }
    const current = byTaskCode.get(taskCode);
    const startAt = parseDate(schedule?.start_at);
    const endAt = parseDate(schedule?.end_at);
    const stateMeta = getSlotState({ startAt, endAt, now });
    if (!current) {
      const experimentCode = normalizeText(schedule?.experiment_code);
      const experimentLabel = experimentNameByCode?.get(experimentCode) || buildExperimentLabel(experimentCode);
      const timeRange = formatScheduleWindow(schedule?.start_at, schedule?.end_at);
      const nextItem = {
        color: resolveTaskColor(taskCode),
        experimentLabel,
        scheduleIds: [normalizeText(schedule?.id)].filter(Boolean),
        state: stateMeta.state,
        taskCode,
        timeRange,
        title: `${taskCode} / ${experimentLabel || "-"} / ${timeRange}`.trim(),
      };
      byTaskCode.set(taskCode, nextItem);
      items.push(nextItem);
      return;
    }

    const scheduleId = normalizeText(schedule?.id);
    if (scheduleId && !current.scheduleIds.includes(scheduleId)) {
      current.scheduleIds.push(scheduleId);
    }
    if (current.state !== "running" && stateMeta.state === "running") {
      current.state = "running";
    } else if (current.state === "completed" && stateMeta.state === "busy") {
      current.state = "busy";
    }
  });

  return items;
};

const buildExperimentNameMap = (experiments) =>
  new Map(
    (Array.isArray(experiments) ? experiments : []).map((experiment) => [
      normalizeText(experiment?.experiment_code),
      normalizeText(experiment?.experiment_name),
    ]),
  );

const formatScheduleWindow = (startAt, endAt) => {
  const startLabel = formatDateTime(startAt);
  const endLabel = formatDateTime(endAt);
  return startLabel && endLabel ? `${startLabel} - ${endLabel}` : "";
};

const buildExperimentTrayMap = (experimentTrays) => {
  const trayMap = new Map();
  (Array.isArray(experimentTrays) ? experimentTrays : []).forEach((entry) => {
    const taskCode = normalizeText(entry?.task_code);
    const experimentCode = normalizeText(entry?.experiment_code);
    const trayCode = normalizeText(entry?.tray_code);
    if (!taskCode || !experimentCode || !trayCode) {
      return;
    }
    const key = `${taskCode}::${experimentCode}`;
    const trays = trayMap.get(key) || [];
    trays.push(trayCode);
    trayMap.set(key, trays);
  });
  return trayMap;
};

const collectScheduleTrayStatuses = ({ schedule, samples, experimentTrayMap }) => {
  const taskCode = normalizeText(schedule?.task_code);
  const experimentCode = normalizeText(schedule?.experiment_code);
  const scopedTrayCodes = new Set(experimentTrayMap.get(`${taskCode}::${experimentCode}`) || []);
  const statuses = [];

  (Array.isArray(samples) ? samples : []).forEach((sample) => {
    if (normalizeText(sample?.task_code) !== taskCode) {
      return;
    }

    const trays = Array.isArray(sample?.trays) ? sample.trays : [];
    if (trays.length === 0 && scopedTrayCodes.size === 0) {
      const sampleStatus = normalizeText(sample?.status);
      if (sampleStatus) {
        statuses.push(sampleStatus);
      }
      return;
    }

    trays.forEach((tray) => {
      const trayCode = normalizeText(tray?.tray_code);
      if (scopedTrayCodes.size > 0 && !scopedTrayCodes.has(trayCode)) {
        return;
      }
      const trayStatus = normalizeText(tray?.status) || normalizeText(sample?.status);
      if (trayStatus) {
        statuses.push(trayStatus);
      }
    });
  });

  return statuses;
};

const resolveScheduleLifecycleState = ({ schedule, samples, experimentTrayMap }) => {
  const trayStatuses = collectScheduleTrayStatuses({ schedule, samples, experimentTrayMap });
  return {
    completed: trayStatuses.length > 0 && trayStatuses.every((status) => COMPLETED_TRAY_STATUSES.has(status)),
    started: trayStatuses.some((status) => STARTED_TRAY_STATUSES.has(status)),
  };
};

const taskHasSavedTrayPlan = ({ task, samples, experimentTrays }) => {
  const taskCode = normalizeText(task?.code);
  if (!taskCode) {
    return false;
  }

  const taskTrayCodes = Array.isArray(task?.tray_codes)
    ? task.tray_codes.map((trayCode) => normalizeText(trayCode)).filter(Boolean)
    : [];
  if (taskTrayCodes.length > 0) {
    return true;
  }

  const sampleHasTray = (Array.isArray(samples) ? samples : []).some((sample) => {
    if (normalizeText(sample?.task_code) !== taskCode) {
      return false;
    }
    const trays = Array.isArray(sample?.trays)
      ? sample.trays.map((trayCode) => normalizeText(trayCode)).filter(Boolean)
      : [];
    return trays.length > 0;
  });
  if (sampleHasTray) {
    return true;
  }

  return (Array.isArray(experimentTrays) ? experimentTrays : []).some(
    (entry) =>
      normalizeText(entry?.task_code) === taskCode &&
      normalizeText(entry?.tray_code),
  );
};

const formatTraySummary = (trayNos) => {
  const trays = sortTextList(trayNos);
  return trays.length > 0 ? trays.join(" / ") : "未记录托盘";
};

const formatOverlapRange = (startAt, endAt) => {
  const start = parseDate(startAt);
  const end = parseDate(endAt);
  if (!start || !end) {
    return "-";
  }
  return `${formatDateTime(start)} - ${formatDateTime(end)}`;
};

function buildTaskScheduledOverlays({ taskCode, experimentCode, schedules, experiments, experimentTrays }) {
  const normalizedTaskCode = normalizeText(taskCode);
  const selectedExperimentCode = normalizeText(experimentCode);
  if (!normalizedTaskCode) {
    return [];
  }

  const experimentNameByCode = buildExperimentNameMap(experiments);
  const trayMap = buildExperimentTrayMap(experimentTrays);

  return (Array.isArray(schedules) ? schedules : [])
    .filter((schedule) => {
      if (normalizeText(schedule?.task_code) !== normalizedTaskCode) {
        return false;
      }
      if (isRetentionDevice(schedule?.device)) {
        return false;
      }
      if (normalizeText(schedule?.experiment_code) === selectedExperimentCode) {
        return false;
      }
      return true;
    })
    .map((schedule) => {
      const overlayExperimentCode = normalizeText(schedule?.experiment_code);
      const trayNos = sortTextList(trayMap.get(`${normalizedTaskCode}::${overlayExperimentCode}`) || []);
      const startAt = parseDate(schedule?.start_at);
      return {
        device: normalizeText(schedule?.device),
        endAt: normalizeText(schedule?.end_at),
        experimentCode: overlayExperimentCode,
        experimentLabel: experimentNameByCode.get(overlayExperimentCode) || buildExperimentLabel(overlayExperimentCode),
        scheduleId: normalizeText(schedule?.id),
        startAt: normalizeText(schedule?.start_at),
        taskCode: normalizedTaskCode,
        timeLabel: formatOverlapRange(schedule?.start_at, schedule?.end_at),
        trayNos,
        traySummary: formatTraySummary(trayNos),
        sortTime: startAt?.getTime() || Number.MAX_SAFE_INTEGER,
      };
    })
    .sort((left, right) => left.sortTime - right.sortTime)
    .map(({ sortTime, ...overlay }) => overlay);
}

function analyzeTaskTrayConflict({ candidate, schedules, experiments, experimentTrays }) {
  const candidateTaskCode = normalizeText(candidate?.task_code);
  const candidateExperimentCode = normalizeText(candidate?.experiment_code);
  const candidateStart = parseDate(candidate?.start_at);
  const candidateEnd = parseDate(candidate?.end_at);
  if (!candidateTaskCode || !candidateExperimentCode || !candidateStart || !candidateEnd) {
    return null;
  }

  const trayMap = buildExperimentTrayMap(experimentTrays);
  const candidateTrayNos = sortTextList(trayMap.get(`${candidateTaskCode}::${candidateExperimentCode}`) || []);
  if (candidateTrayNos.length === 0) {
    return null;
  }

  const candidateTraySet = new Set(candidateTrayNos);
  const experimentNameByCode = buildExperimentNameMap(experiments);
  const conflictSchedules = (Array.isArray(schedules) ? schedules : [])
    .filter((schedule) => {
      if (normalizeText(schedule?.task_code) !== candidateTaskCode) {
        return false;
      }
      if (isRetentionDevice(schedule?.device)) {
        return false;
      }
      if (normalizeText(schedule?.experiment_code) === candidateExperimentCode) {
        return false;
      }
      const scheduleStart = parseDate(schedule?.start_at);
      const scheduleEnd = parseDate(schedule?.end_at);
      return scheduleStart && scheduleEnd && overlaps(candidateStart, candidateEnd, scheduleStart, scheduleEnd);
    })
    .map((schedule) => {
      const scheduleExperimentCode = normalizeText(schedule?.experiment_code);
      const trayNos = sortTextList(trayMap.get(`${candidateTaskCode}::${scheduleExperimentCode}`) || []);
      const overlapTrayNos = trayNos.filter((trayNo) => candidateTraySet.has(trayNo));
      if (overlapTrayNos.length === 0) {
        return null;
      }
      const overlapStart = new Date(Math.max(candidateStart.getTime(), parseDate(schedule?.start_at)?.getTime() || 0));
      const overlapEnd = new Date(Math.min(candidateEnd.getTime(), parseDate(schedule?.end_at)?.getTime() || 0));
      return {
        device: normalizeText(schedule?.device),
        experimentCode: scheduleExperimentCode,
        experimentLabel: experimentNameByCode.get(scheduleExperimentCode) || buildExperimentLabel(scheduleExperimentCode),
        overlapRange: formatOverlapRange(overlapStart, overlapEnd),
        scheduleId: normalizeText(schedule?.id),
        trayNos,
        traySummary: formatTraySummary(trayNos),
      };
    })
    .filter(Boolean);

  if (conflictSchedules.length === 0) {
    return null;
  }

  const conflictTrayNos = sortTextList(conflictSchedules.flatMap((schedule) => schedule.trayNos.filter((trayNo) => candidateTraySet.has(trayNo))));
  return {
    candidateExperimentCode,
    candidateExperimentLabel: experimentNameByCode.get(candidateExperimentCode) || buildExperimentLabel(candidateExperimentCode),
    candidateTrayNos,
    conflictSchedules,
    conflictTrayNos,
    level: candidateTrayNos.every((trayNo) => conflictTrayNos.includes(trayNo)) ? "full" : "partial",
    taskCode: candidateTaskCode,
  };
}

// 构建看板页签使用的主排程表格行。
function buildScheduleRows({ schedules, tasks, experiments, now = new Date() }) {
  const taskList = Array.isArray(tasks) ? tasks : [];
  const taskByCode = new Map(taskList.map((task) => [normalizeText(task?.code), task]));
  const experimentList = Array.isArray(experiments) ? experiments : [];
  const experimentNameByCode = new Map(
    experimentList.map((experiment) => [normalizeText(experiment?.experiment_code), normalizeText(experiment?.experiment_name)]),
  );

  return (Array.isArray(schedules) ? schedules : [])
    .map((schedule) => {
      const taskCode = normalizeText(schedule?.task_code);
      const experimentCode = normalizeText(schedule?.experiment_code);
      const task = taskByCode.get(taskCode);
      // 行状态不是直接读排程状态，而是基于任务整体排程情况实时推导。
      const status = resolveTaskStatus(task || taskCode, schedules, now);

      return {
        device: normalizeText(schedule?.device),
        endAt: formatDateTime(schedule?.end_at),
        experimentCode,
        experimentLabel: experimentNameByCode.get(experimentCode) || buildExperimentLabel(experimentCode),
        id: normalizeText(schedule?.id),
        rowStatus: status,
        rowStatusClass: statusClass(status),
        startAt: formatDateTime(schedule?.start_at),
        taskCode,
        taskName: normalizeText(task?.name),
        testType: normalizeText(task?.test_type),
      };
    })
    .sort((left, right) => left.startAt.localeCompare(right.startAt, "zh-Hans-CN"));
}

// 提取冲突排程对，用于告警条和冲突检查表格。
function buildConflictRows({ schedules }) {
  const scheduleList = (Array.isArray(schedules) ? schedules : [])
    .filter((schedule) => !isRetentionDevice(schedule?.device))
    .map((schedule) => ({ ...schedule }));
  const byDevice = new Map();

  // 冲突检查按设备分组后，只需要比较同设备下相邻时间段是否重叠。
  scheduleList.forEach((schedule) => {
    const device = normalizeText(schedule?.device);
    if (!device) {
      return;
    }
    const group = byDevice.get(device) || [];
    group.push(schedule);
    byDevice.set(device, group);
  });

  const rows = [];
  byDevice.forEach((entries, device) => {
    entries.sort((left, right) => {
      const leftTime = parseDate(left?.start_at)?.getTime() || 0;
      const rightTime = parseDate(right?.start_at)?.getTime() || 0;
      return leftTime - rightTime;
    });

    for (let index = 1; index < entries.length; index += 1) {
      const previous = entries[index - 1];
      const current = entries[index];
      const previousEnd = parseDate(previous?.end_at);
      const currentStart = parseDate(current?.start_at);
      if (!previousEnd || !currentStart || previousEnd <= currentStart) {
        continue;
      }
      rows.push({
        device,
        id: normalizeText(current?.id),
        impact: "Delay",
        reason: "Overlap",
        suggestion: "Reschedule",
        taskCode: normalizeText(current?.task_code),
      });
    }
  });

  return rows;
}

// 按设备和时间窗口构建可直接用于甘特图的行数据。
function buildGanttRows({ schedules, devices, experiments = [], experimentTrays = [], samples = [], tasks = [], days = 3, filterDevice = "", selectedTaskCode = "", startDate = new Date(), now = new Date() }) {
  const experimentTrayMap = buildExperimentTrayMap(experimentTrays);
  const visibleSchedules = (Array.isArray(schedules) ? schedules : []).filter((schedule) => {
    if (isRetentionDevice(schedule?.device)) {
      return false;
    }
    const lifecycleState = resolveScheduleLifecycleState({ schedule, samples, experimentTrayMap });
    const endAt = parseDate(schedule?.end_at);
    if (!lifecycleState.started) {
      return true;
    }
    if (!lifecycleState.completed) {
      return true;
    }
    return !endAt || endAt >= now;
  });
  const experimentNameByCode = buildExperimentNameMap(experiments);
  const anchorDate = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
  // 如果视图窗口内的默认天数不足以覆盖最新排程，会自动向后扩展。
  const latestVisibleEnd = visibleSchedules.reduce((latest, schedule) => {
    const scheduleEnd = parseDate(schedule?.end_at);
    if (!scheduleEnd) {
      return latest;
    }
    return !latest || scheduleEnd > latest ? scheduleEnd : latest;
  }, null);
  const requiredDays = latestVisibleEnd ? getDaySpan(anchorDate, latestVisibleEnd) + 1 : days;
  const totalDays = Math.max(days, requiredDays);

  const dayList = Array.from({ length: totalDays }, (_, index) => {
    const date = addDays(anchorDate, index);
    return {
      date,
      key: toLocalDateValue(date),
      label: `${date.getMonth() + 1}/${date.getDate()}`,
    };
  });

  const baseDeviceCodes = Array.from(
    new Set(
      []
        .concat(TEST_LABS)
        .concat((Array.isArray(devices) ? devices : []).map((device) => normalizeText(device?.code || device?.name)))
        .concat(visibleSchedules.map((schedule) => normalizeText(schedule?.device))),
    ),
  )
    .filter(Boolean)
    .filter((device) => !isRetentionDevice(device));

  const selectedTaskLabs = buildSelectedTaskLabSet({
    experiments,
    schedules: visibleSchedules,
    selectedTaskCode,
    tasks,
  });
  const deviceCodes = selectedTaskLabs && selectedTaskLabs.size > 0
    ? baseDeviceCodes.filter((device) => selectedTaskLabs.has(device))
    : normalizeText(filterDevice)
      ? baseDeviceCodes.filter((device) => normalizeText(device) === normalizeText(filterDevice))
      : baseDeviceCodes;

  const rows = deviceCodes.map((device) => {
    const deviceSchedules = visibleSchedules.filter((schedule) => normalizeText(schedule?.device) === device);
    // 每个设备按“天 x 半天”拆成离散槽位，再聚合成最终显示段。
    const slots = dayList.flatMap((day) =>
      SLOT_SEQUENCE.map((segment) => {
        const range = segment === "am" ? SLOT_RANGES.morning : SLOT_RANGES.afternoon;
        const segmentStart = parseDate(`${day.key}T${range.start}:00`);
        const segmentEnd = segment === "am"
          ? parseDate(`${day.key}T${SLOT_RANGES.afternoon.start}:00`)
          : parseDate(`${toLocalDateValue(addDays(day.date, 1))}T${SLOT_RANGES.morning.start}:00`);
        const matched = deviceSchedules.filter((schedule) => {
          const startAt = parseDate(schedule?.start_at);
          const endAt = parseDate(schedule?.end_at);
          return startAt && endAt && overlaps(startAt, endAt, segmentStart, segmentEnd);
        });

        const slotKey = `${device}-${day.key}-${segment}`;
        if (matched.length === 0) {
          return {
            className: "gantt-slot idle",
            date: day.key,
            displayMode: "idle",
            items: [],
            key: slotKey,
            label: "空闲",
            overflowCount: 0,
            scheduleId: "",
            segment,
            state: "idle",
            title: "空闲",
          };
        }

        if (hasScheduleOverlap(matched)) {
          // 同一半天命中多条且真实时间重叠时，仍按冲突槽位处理。
          return {
            className: "gantt-slot conflict",
            date: day.key,
            displayMode: "conflict",
            items: [],
            key: slotKey,
            label: `${normalizeText(matched[0]?.task_code)} +${matched.length - 1}`,
            overflowCount: 0,
            scheduleId: normalizeText(matched[0]?.id),
            segment,
            state: "conflict",
            title: "冲突",
          };
        }

        const items = buildSlotTaskItems({ matchedSchedules: matched, now, experimentNameByCode });
        const slotTitle = items.map((item, index) => `${index >= 2 ? "隐藏: " : ""}${item.title}`).join("\n");
        if (items.length === 2) {
          return {
            className: "gantt-slot busy gantt-slot--split",
            date: day.key,
            displayMode: "split",
            items,
            key: slotKey,
            label: items[0]?.taskCode || "",
            overflowCount: 0,
            scheduleId: "",
            segment,
            stackKey: slotKey,
            state: "split",
            title: slotTitle,
          };
        }
        if (items.length > 1) {
          return {
            className: "gantt-slot busy gantt-slot--stacked",
            date: day.key,
            displayMode: "stacked",
            items: items.slice(0, 2),
            key: slotKey,
            label: items[0]?.taskCode || "",
            overflowCount: Math.max(0, items.length - 2),
            scheduleId: "",
            segment,
            stackKey: slotKey,
            state: "stacked",
            title: slotTitle,
          };
        }

        const schedule = matched[0];
        const startAt = parseDate(schedule?.start_at);
        const endAt = parseDate(schedule?.end_at);
        const lifecycleState = resolveScheduleLifecycleState({ schedule, samples, experimentTrayMap });
        const stateMeta = getSlotState({ completed: lifecycleState.completed, endAt, now, startAt, started: lifecycleState.started });
        return {
          className: stateMeta.className,
          date: day.key,
          displayMode: "single",
          items,
          key: slotKey,
          label: normalizeText(schedule?.task_code),
          overflowCount: 0,
          scheduleId: normalizeText(schedule?.id),
          segment,
          stackKey: slotKey,
          state: stateMeta.state,
          taskColor: items[0]?.color || resolveTaskColor(schedule?.task_code),
          title: items[0]?.title || `${normalizeText(schedule?.task_code)} ${formatDateTime(schedule?.start_at)}-${formatDateTime(schedule?.end_at)}`.trim(),
        };
      }),
    );

    const segments = [];
    slots.forEach((slot) => {
      // 连续同态槽位在这里折叠成 colspan 段，减少甘特图重复单元格。
      const signature = slot.state === "idle"
        ? "idle"
        : slot.state === "conflict" || slot.state === "stacked" || slot.state === "split"
          ? `${slot.state}:${slot.key}`
          : `${slot.scheduleId}:${slot.className}`;
      const previous = segments[segments.length - 1];
      if (previous && previous.signature == signature && slot.state !== "conflict" && slot.state !== "stacked" && slot.state !== "split") {
        previous.colspan += 1;
        return;
      }
      segments.push({
        className: slot.className,
        colspan: 1,
        displayMode: slot.displayMode,
        items: slot.items,
        key: `${slot.key}-segment`,
        label: slot.label,
        overflowCount: slot.overflowCount,
        scheduleId: slot.scheduleId,
        signature,
        stackKey: slot.stackKey || slot.key,
        state: slot.state,
        taskColor: slot.taskColor || slot.items?.[0]?.color || "",
        title: slot.title,
      });
    });

    return {
      device,
      segments: segments.map(({ signature, ...segment }) => segment),
      slots,
    };
  });

  return { days: dayList, rows };
}

// 构建留样面板中等待暂存的任务和样品行数据。
function buildRetentionInternalRows({ tasks, samples, schedules, now = new Date() }) {
  const taskByCode = new Map((Array.isArray(tasks) ? tasks : []).map((task) => [normalizeText(task?.code), task]));
  const nonRetentionCodes = new Set(
    (Array.isArray(schedules) ? schedules : [])
      .filter((schedule) => !isRetentionDevice(schedule?.device))
      .map((schedule) => normalizeText(schedule?.task_code))
      .filter(Boolean),
  );

  const rowsByCode = new Map();

  // 留样面板只关注“仅在暂存间且尚未进入正式实验”的任务。
  (Array.isArray(schedules) ? schedules : []).forEach((schedule) => {
    const taskCode = normalizeText(schedule?.task_code);
    if (!taskCode || nonRetentionCodes.has(taskCode) || !isRetentionDevice(schedule?.device)) {
      return;
    }
    const existing = rowsByCode.get(taskCode) || {
      code: taskCode,
      name: normalizeText(taskByCode.get(taskCode)?.name),
      testType: normalizeText(taskByCode.get(taskCode)?.test_type),
      waitLabel: "--",
      since: null,
      sinceText: "-",
    };
    const startAt = parseDate(schedule?.start_at);
    if (startAt && (!existing.since || startAt < existing.since)) {
      existing.since = startAt;
    }
    rowsByCode.set(taskCode, existing);
  });

  return Array.from(rowsByCode.values())
    .map((row) => {
      // 等待时长按最早进入暂存间的时间计算整小时差。
      const since = row.since;
      const elapsedHours = since ? Math.max(0, Math.floor((now.getTime() - since.getTime()) / (1000 * 60 * 60))) : 0;
      return {
        ...row,
        sinceText: since ? formatDateTime(since) : "-",
        waitLabel: since ? `${elapsedHours}h` : "--",
      };
    })
    .sort((left, right) => {
      const leftTime = left.since?.getTime() || Number.MAX_SAFE_INTEGER;
      const rightTime = right.since?.getTime() || Number.MAX_SAFE_INTEGER;
      return leftTime - rightTime;
    });
}

// 生成手动排程表单使用的下拉选项。
function buildManualTaskOptions({ tasks, experiments, experimentTrays, samples, schedules }) {
  const pendingExperimentTaskCodes = new Set(
    (Array.isArray(tasks) ? tasks : [])
      .map((task) => normalizeText(task?.code))
      .filter((taskCode) =>
        Boolean(
          taskCode &&
            buildExperimentOptions({
              experiments,
              schedules,
              taskCode,
              tasks,
            }).length > 0,
        ),
      )
      .filter(Boolean),
  );

  // 正常排程页签优先显示仍有未排实验的任务。
  return (Array.isArray(tasks) ? tasks : [])
    .filter((task) => {
      const taskCode = normalizeText(task?.code);
      if (!taskCode) {
        return false;
      }
      if (!taskHasSavedTrayPlan({ experimentTrays, samples, task })) {
        return false;
      }
      if (pendingExperimentTaskCodes.size > 0) {
        return pendingExperimentTaskCodes.has(taskCode);
      }
      return normalizeText(task?.status) === STATUS_WAITING;
    })
    .map((task) => ({
      code: normalizeText(task?.code),
      label: `${normalizeText(task?.code)}${normalizeText(task?.name) ? ` ${normalizeText(task?.name)}` : ""}`.trim(),
      testType: normalizeText(task?.test_type),
    }));
}

function buildLabOptions({ testType, selectedDevice = "" }) {
  let labs = normalizeText(testType) ? resolveLabCandidates(normalizeText(testType)) : [];
  if (selectedDevice && !labs.includes(selectedDevice)) {
    labs = [...labs, selectedDevice];
  }
  return labs;
}

// 根据当前时钟计算留样时间状态标签。
function resolveRetentionTimeState(now = new Date()) {
  const current = new Date(now.getTime());
  const timeValue = toLocalTimeValue(current);
  const morningStart = parseDate(`${toLocalDateValue(current)}T${SLOT_RANGES.morning.start}:00`);
  const morningEnd = parseDate(`${toLocalDateValue(current)}T${SLOT_RANGES.morning.end}:00`);
  const afternoonStart = parseDate(`${toLocalDateValue(current)}T${SLOT_RANGES.afternoon.start}:00`);
  const afternoonEnd = parseDate(`${toLocalDateValue(current)}T${SLOT_RANGES.afternoon.end}:00`);
  let timeSlot = "custom";

  // 当前时刻落在上午/下午固定窗口内时，优先回填对应快捷时段。
  if (morningStart && morningEnd && current >= morningStart && current <= morningEnd) {
    timeSlot = "morning";
  } else if (afternoonStart && afternoonEnd && current >= afternoonStart && current <= afternoonEnd) {
    timeSlot = "afternoon";
  }

  return {
    custom_end: timeValue,
    custom_start: timeValue,
    schedule_date: toLocalDateValue(current),
    time_slot: timeSlot,
  };
}

// 构建排程看板上方展示的汇总卡片。
function buildSummaryCards({ schedules, now = new Date() }) {
  const rows = buildScheduleRows({ schedules, tasks: [], now });
  const conflictRows = buildConflictRows({ schedules });
  return {
    changeCount: 0,
    conflictCount: conflictRows.length,
    nextAuto: formatDateTime(new Date(now.getTime() + 60 * 60 * 1000)),
    scheduleCount: rows.length,
  };
}

// 持久化辅助逻辑会在更新排程时同步任务和数据流状态。
function syncTaskStatuses(tasks, schedules, now = new Date()) {
  return (Array.isArray(tasks) ? tasks : []).map((task) => ({
    ...task,
    // 任务状态完全以当前排程快照重新计算，避免手工维护多处状态。
    status: resolveTaskStatus(task, schedules, now),
  }));
}

function hasFormalExperimentSchedule(schedules, taskCode, experimentCode) {
  const normalizedTaskCode = normalizeText(taskCode);
  const normalizedExperimentCode = normalizeText(experimentCode);
  if (!normalizedTaskCode || !normalizedExperimentCode) {
    return false;
  }

  return (Array.isArray(schedules) ? schedules : []).some(
    (schedule) =>
      normalizeText(schedule?.task_code) === normalizedTaskCode &&
      normalizeText(schedule?.experiment_code) === normalizedExperimentCode &&
      !isRetentionDevice(schedule?.device),
  );
}

function syncExperimentUnscheduledSince({ experiments, schedules, taskCode, experimentCode, now = new Date() }) {
  const normalizedTaskCode = normalizeText(taskCode);
  const normalizedExperimentCode = normalizeText(experimentCode);
  const nextExperiments = Array.isArray(experiments) ? experiments.map((experiment) => ({ ...experiment })) : [];
  if (!normalizedTaskCode || !normalizedExperimentCode) {
    return nextExperiments;
  }

  const hasFormalSchedule = hasFormalExperimentSchedule(schedules, normalizedTaskCode, normalizedExperimentCode);
  return nextExperiments.map((experiment) => {
    if (
      normalizeText(experiment?.task_code) !== normalizedTaskCode ||
      normalizeText(experiment?.experiment_code) !== normalizedExperimentCode
    ) {
      return experiment;
    }

    return {
      ...experiment,
      unscheduled_since: hasFormalSchedule ? "" : now.toISOString(),
    };
  });
}

function buildExperimentOptions({ taskCode, experiments, schedules, tasks }) {
  const scheduledExperimentCodes = new Set(
    (Array.isArray(schedules) ? schedules : [])
      .filter(
        (schedule) =>
          !isRetentionDevice(schedule?.device) &&
          normalizeText(schedule?.experiment_code),
      )
      .map((schedule) => normalizeText(schedule?.experiment_code)),
  );

  const seenLabels = new Set();
  return buildExperimentCandidates({ taskCode, experiments, tasks })
    .filter((experiment) => !scheduledExperimentCodes.has(normalizeText(experiment?.experiment_code)))
    .map((experiment) => ({
      code: normalizeText(experiment?.experiment_code),
      fullCode: normalizeText(experiment?.experiment_code),
      label: normalizeText(experiment?.experiment_name) || normalizeText(experiment?.required_device) || normalizeText(experiment?.experiment_code),
      requiredDevice: normalizeText(experiment?.required_device) || normalizeText(experiment?.experiment_name),
      taskCode: normalizeText(experiment?.task_code),
    }))
    .filter((option) => {
      const label = normalizeText(option.label);
      if (!label || seenLabels.has(label)) {
        return false;
      }
      seenLabels.add(label);
      return true;
    });
}

function ensureStreamForSchedule(streams, schedule, now = new Date()) {
  const nextStreams = Array.isArray(streams) ? streams.map((stream) => ({ ...stream })) : [];
  const taskCode = normalizeText(schedule?.task_code);
  const existing = nextStreams.find((stream) => normalizeText(stream?.task_code) === taskCode);
  if (existing) {
    // 已有数据流时仅同步最新设备归属，不重复创建。
    existing.device = normalizeText(schedule?.device);
    return nextStreams;
  }
  // 首次排程会为任务补建一条默认数据流记录。
  nextStreams.push({
    device: normalizeText(schedule?.device),
    id: createId("stream"),
    last_packet: formatDateTime(now),
    quality: "98.0%",
    reported: false,
    status: STREAMING_STATUS,
    task_code: taskCode,
  });
  return nextStreams;
}

function findScheduleConflicts({ schedules, candidate, ignoreId = "" }) {
  const device = normalizeText(candidate?.device);
  if (!device || isRetentionDevice(device)) {
    return [];
  }
  const startAt = parseDate(candidate?.start_at);
  const endAt = parseDate(candidate?.end_at);
  if (!startAt || !endAt) {
    return [];
  }

  // 冲突检查排除自身编辑场景，只比较同设备且时间重叠的正式排程。
  return (Array.isArray(schedules) ? schedules : []).filter((schedule) => {
    if (normalizeText(schedule?.id) === normalizeText(ignoreId)) {
      return false;
    }
    if (normalizeText(schedule?.device) !== device) {
      return false;
    }
    const existingStart = parseDate(schedule?.start_at);
    const existingEnd = parseDate(schedule?.end_at);
    return existingStart && existingEnd && overlaps(startAt, endAt, existingStart, existingEnd);
  });
}

function createScheduleRecord({ experiments, form, tasks, schedules, streams, now = new Date() }) {
  const taskCode = normalizeText(form?.task_code);
  const device = normalizeText(form?.device);
  if (!taskCode || !device) {
    return { error: "请选择任务和实验室" };
  }

  const resolved = resolveScheduleTimes(form, now);
  if (resolved.error) {
    return resolved;
  }

  const nextSchedules = Array.isArray(schedules) ? schedules.map((schedule) => ({ ...schedule })) : [];
      const candidate = {
        device,
        end_at: resolved.endAt.toISOString(),
        experiment_code: normalizeText(form?.experiment_code),
        planned_hours: resolved.plannedHours,
        start_at: resolved.startAt.toISOString(),
        task_code: taskCode,
  };
  const conflicts = findScheduleConflicts({ candidate, schedules: nextSchedules });
  if (conflicts.length > 0) {
    return { error: "排程冲突，请调整时间或实验室" };
  }

  // 任务此前若只在暂存间，转入正式实验室时直接复用原暂存记录。
  const retentionSchedule = nextSchedules.find(
    (schedule) => normalizeText(schedule?.task_code) === taskCode && isRetentionDevice(schedule?.device) && !isRetentionDevice(device),
  );
  if (retentionSchedule) {
    retentionSchedule.device = device;
    retentionSchedule.start_at = candidate.start_at;
    retentionSchedule.end_at = candidate.end_at;
    retentionSchedule.experiment_code = candidate.experiment_code;
    retentionSchedule.planned_hours = candidate.planned_hours;
    retentionSchedule.status = STATUS_SCHEDULED;
  } else {
    // 否则新增一条排程记录，并根据设备类型设置初始状态。
      nextSchedules.push({
        id: createId("schedule"),
        ...candidate,
      status: isRetentionDevice(device) ? STATUS_RETENTION : STATUS_SCHEDULED,
    });
  }

  const nextTasks = syncTaskStatuses(tasks, nextSchedules, now);
  const nextExperiments = syncExperimentUnscheduledSince({
    experimentCode: candidate.experiment_code,
    experiments,
    now,
    schedules: nextSchedules,
    taskCode,
  });
  const targetSchedule =
    nextSchedules.find((schedule) => normalizeText(schedule?.task_code) === taskCode && normalizeText(schedule?.device) === device) ||
    nextSchedules[nextSchedules.length - 1];
  const nextStreams = ensureStreamForSchedule(streams, targetSchedule, now);

  return { experiments: nextExperiments, schedules: nextSchedules, streams: nextStreams, tasks: nextTasks };
}

function updateScheduleRecord({ experiments, form, tasks, schedules, streams, now = new Date() }) {
  const scheduleId = normalizeText(form?.id);
  const nextSchedules = Array.isArray(schedules) ? schedules.map((schedule) => ({ ...schedule })) : [];
  const target = nextSchedules.find((schedule) => normalizeText(schedule?.id) === scheduleId);
  if (!target) {
    return { error: "未找到排程记录" };
  }

  const resolved = resolveScheduleTimes(form, now);
  if (resolved.error) {
    return resolved;
  }

  const device = normalizeText(form?.device);
  if (!device) {
    return { error: "请选择实验室" };
  }

  const candidate = {
    device,
    end_at: resolved.endAt.toISOString(),
    experiment_code: normalizeText(form?.experiment_code),
    planned_hours: resolved.plannedHours,
    start_at: resolved.startAt.toISOString(),
    task_code: normalizeText(form?.task_code),
  };
  const conflicts = findScheduleConflicts({ candidate, schedules: nextSchedules, ignoreId: scheduleId });
  if (conflicts.length > 0) {
    return { error: "排程冲突，请调整时间或实验室" };
  }

  // 编辑场景直接原位覆盖目标排程记录。
  target.device = device;
  target.start_at = candidate.start_at;
  target.end_at = candidate.end_at;
  target.experiment_code = candidate.experiment_code;
  target.planned_hours = candidate.planned_hours;
  target.status = isRetentionDevice(device) ? STATUS_RETENTION : STATUS_SCHEDULED;

  const nextTasks = syncTaskStatuses(tasks, nextSchedules, now);
  const nextExperiments = syncExperimentUnscheduledSince({
    experimentCode: candidate.experiment_code,
    experiments,
    now,
    schedules: nextSchedules,
    taskCode: candidate.task_code,
  });
  const nextStreams = ensureStreamForSchedule(streams, target, now);

  return { experiments: nextExperiments, schedules: nextSchedules, streams: nextStreams, tasks: nextTasks };
}

function deleteScheduleRecord({ experiments, scheduleId, tasks, schedules, streams, now = new Date() }) {
  const removedSchedule = (Array.isArray(schedules) ? schedules : []).find(
    (schedule) => normalizeText(schedule?.id) === normalizeText(scheduleId),
  );
  const nextSchedules = (Array.isArray(schedules) ? schedules : []).filter(
    (schedule) => normalizeText(schedule?.id) !== normalizeText(scheduleId),
  );
  const nextTasks = syncTaskStatuses(tasks, nextSchedules, now);
  const nextExperiments = syncExperimentUnscheduledSince({
    experimentCode: normalizeText(removedSchedule?.experiment_code),
    experiments,
    now,
    schedules: nextSchedules,
    taskCode: normalizeText(removedSchedule?.task_code),
  });
  return {
    experiments: nextExperiments,
    schedules: nextSchedules,
    streams: Array.isArray(streams) ? streams.map((stream) => ({ ...stream })) : [],
    tasks: nextTasks,
  };
}

export {
  RETENTION_DEVICE,
  SLOT_RANGES,
  STATUS_COMPLETED,
  STATUS_RETENTION,
  STATUS_RUNNING,
  STATUS_SCHEDULED,
  STATUS_WAITING,
  analyzeTaskTrayConflict,
  buildConflictRows,
  buildExperimentOptions,
  buildGanttRows,
  buildLabOptions,
  buildManualTaskOptions,
  buildRetentionInternalRows,
  buildScheduleEditForm,
  buildScheduleRescheduleForm,
  buildScheduleRows,
  buildTaskScheduledOverlays,
  buildSummaryCards,
  createManualScheduleForm,
  createScheduleRecord,
  createScheduleEditForm,
  deleteScheduleRecord,
  formatDateTime,
  isRetentionDevice,
  normalizeText,
  resolveLegalManualScheduleState,
  resolveRetentionTimeState,
  resolveScheduleTimes,
  resolveTaskStatus,
  isManualScheduleSelectionLegal,
  updateScheduleRecord,
};
