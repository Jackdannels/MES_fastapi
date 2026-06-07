// 提供排程页所需的表单、看板行、甘特数据和增删改辅助函数。
import { getLabsForTestType, TEST_LABS, TEST_PREFIX_MAP } from "@/lib/labs.js";
import { collectExperimentTypes } from "@/lib/experimentTypes";
import { formatLocalDateTime } from "@/lib/dateTime";
import { filterActiveTasks } from "@/lib/taskArchive";
import { resolveLabRef, resolveScheduleLabCode, scheduleMatchesLab, scheduleTargetsStorageArea } from "@/lib/labIdentity";
import { resolveTransferConfirmedAt } from "@/lib/transferArrivalTime";

const STATUS_WAITING = "待排程";
const STATUS_SCHEDULED = "已排程";
const STATUS_RUNNING = "实验进行中";
const STATUS_COMPLETED = "实验已完成";
const STATUS_RETENTION = "暂存间存放";
const DEVICE_STATUS_MAINTENANCE = "维护/校准";
const DEVICE_STATUS_DISABLED = "停用";
const STREAMING_STATUS = "Streaming";
const RETENTION_DEVICE = "恒温恒湿间（暂存间）";
const RETENTION_KEYWORD = "暂存间";
const STARTED_TRAY_STATUSES = new Set([
  STATUS_RUNNING,
  "实验中",
  STATUS_COMPLETED,
  "实验完成",
  "送至外观检测间",
  "外观检测间存放",
  "放置实验后暂存间",
  "厂家收回",
]);
const COMPLETED_TRAY_STATUSES = new Set([
  STATUS_COMPLETED,
  "实验完成",
  "送至外观检测间",
  "外观检测间存放",
  "放置实验后暂存间",
  "厂家收回",
]);
const SLOT_RANGES = Object.freeze({
  morning: { start: "08:00", end: "12:00", label: "上午 08:00-12:00" },
  afternoon: { start: "12:00", end: "18:00", label: "下午 12:00-18:00" },
});
const SLOT_BUFFER_MINUTES = 10;

// 排程模块的大部分判断都依赖稳定字符串，因此先做统一规范化。
const normalizeText = (value) => String(value ?? "").trim();

const buildActiveTaskContext = (tasks, samples = []) => {
  const taskList = Array.isArray(tasks) ? tasks : [];
  if (taskList.length === 0) {
    return { activeTasks: [], activeTaskCodes: null };
  }
  const activeTasks = filterActiveTasks(taskList, samples);
  return {
    activeTasks,
    activeTaskCodes: new Set(activeTasks.map((task) => normalizeText(task?.code)).filter(Boolean)),
  };
};

const filterSchedulesForActiveTasks = ({ schedules, tasks, samples = [] }) => {
  const scheduleList = Array.isArray(schedules) ? schedules : [];
  const { activeTaskCodes } = buildActiveTaskContext(tasks, samples);
  if (!activeTaskCodes) {
    return scheduleList;
  }
  return scheduleList.filter((schedule) => activeTaskCodes.has(normalizeText(schedule?.task_code)));
};

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
const isRetentionDevice = (value) => {
  if (value && typeof value === "object") {
    return scheduleTargetsStorageArea(value);
  }
  return normalizeText(value).includes(RETENTION_KEYWORD);
};

// 输入可能来自 ISO 字符串、空值或 Date 实例，统一在这里做容错解析。
const parseDate = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const isDeviceInMaintenanceWindow = (device, now = new Date()) => {
  const startAt = parseDate(device?.maintenance_start_at ?? device?.maintenanceStartAt);
  const endAt = parseDate(device?.maintenance_end_at ?? device?.maintenanceEndAt);
  const current = parseDate(now) || new Date();
  return Boolean(startAt && endAt && startAt <= current && current <= endAt);
};

const resolveDeviceUnavailableReason = (device, now = new Date()) => {
  const status = normalizeText(device?.status);
  const maintenanceStart = parseDate(device?.maintenance_start_at ?? device?.maintenanceStartAt);
  const maintenanceEnd = parseDate(device?.maintenance_end_at ?? device?.maintenanceEndAt);
  const current = parseDate(now) || new Date();
  const hasMaintenanceWindow = Boolean(maintenanceStart && maintenanceEnd);
  if (status === DEVICE_STATUS_DISABLED || status.includes("停用") || status.includes("禁用")) {
    return "disabled";
  }
  if (hasMaintenanceWindow && maintenanceEnd < current) {
    return status.includes("不可用") ? "unavailable" : "";
  }
  if (status === DEVICE_STATUS_MAINTENANCE || status.includes("维护") || status.includes("维修") || isDeviceInMaintenanceWindow(device, now)) {
    return "maintenance";
  }
  if (status.includes("不可用")) {
    return "unavailable";
  }
  return "";
};

const isDeviceUnavailableForSchedule = (device, now = new Date()) => {
  return Boolean(resolveDeviceUnavailableReason(device, now));
};

const deviceMaintenanceOverlapsSchedule = (device, startAt, endAt) => {
  const maintenanceStart = parseDate(device?.maintenance_start_at ?? device?.maintenanceStartAt);
  const maintenanceEnd = parseDate(device?.maintenance_end_at ?? device?.maintenanceEndAt);
  return Boolean(maintenanceStart && maintenanceEnd && startAt && endAt && maintenanceStart < endAt && maintenanceEnd > startAt);
};

const resolveDeviceScheduleBlockMessage = ({ device, endAt = null, now = new Date(), startAt = null }) => {
  const reason = resolveDeviceUnavailableReason(device, now)
    || (deviceMaintenanceOverlapsSchedule(device, startAt, endAt) ? "maintenance" : "");
  if (reason === "disabled") {
    return "该设备已停用，不可排程";
  }
  if (reason === "maintenance") {
    return "该设备处于维护状态，不可排程";
  }
  if (reason === "unavailable") {
    return "该设备不可用，不可排程";
  }
  return "";
};

const resolveUnavailableSlotMeta = ({ device, deviceCode, endAt, now, startAt }) => {
  const name = normalizeText(deviceCode);
  const reason = resolveDeviceUnavailableReason(device, now)
    || (deviceMaintenanceOverlapsSchedule(device, startAt, endAt) ? "maintenance" : "");
  if (reason === "disabled") {
    return {
      className: "gantt-slot idle disabled",
      label: "停用",
      state: "disabled",
      title: `${name}已停用，暂不可排程`,
    };
  }
  if (reason === "maintenance") {
    return {
      className: "gantt-slot idle maintenance",
      label: "维护中",
      state: "maintenance",
      title: `${name}维护中，暂不可排程`,
    };
  }
  if (reason === "unavailable") {
    return {
      className: "gantt-slot idle disabled",
      label: "不可用",
      state: "disabled",
      title: `${name}不可用，暂不可排程`,
    };
  }
  return null;
};

const findDeviceRecord = (devices = [], deviceCode = "") =>
  (Array.isArray(devices) ? devices : []).find((device) => normalizeText(device?.code) === normalizeText(deviceCode));

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

const truncateToMinute = (value) => {
  const date = parseDate(value);
  if (!date) {
    return null;
  }
  date.setSeconds(0, 0);
  return date;
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

const buildSlotBoundary = (dateValue, timeValue) => parseDate(`${dateValue}T${timeValue}:00`);

const getLatestMorningScheduleEnd = (dateValue, schedules = []) => {
  const noonBoundary = buildSlotBoundary(dateValue, SLOT_RANGES.afternoon.start);
  if (!noonBoundary) {
    return null;
  }

  let latestEnd = null;
  (Array.isArray(schedules) ? schedules : []).forEach((schedule) => {
    if (isRetentionDevice(schedule)) {
      return;
    }
    const startAt = parseDate(schedule?.start_at);
    const endAt = parseDate(schedule?.end_at);
    if (!startAt || !endAt) {
      return;
    }
    if (toLocalDateValue(startAt) !== dateValue) {
      return;
    }
    if (startAt >= noonBoundary) {
      return;
    }
    if (!latestEnd || endAt > latestEnd) {
      latestEnd = endAt;
    }
  });

  return latestEnd;
};

const resolveFixedSlotStartAt = ({ dateValue, now = new Date(), schedules = [], slot }) => {
  const range = SLOT_RANGES[slot] || SLOT_RANGES.morning;
  const current = truncateToMinute(now) || new Date();
  let earliestStart = buildSlotBoundary(dateValue, range.start);
  const slotEnd = buildSlotBoundary(dateValue, range.end);

  if (!earliestStart || !slotEnd) {
    return null;
  }

  if (slot === "afternoon") {
    const latestMorningEnd = getLatestMorningScheduleEnd(dateValue, schedules);
    if (latestMorningEnd) {
      const bufferedStart = new Date(latestMorningEnd.getTime() + SLOT_BUFFER_MINUTES * 60 * 1000);
      if (bufferedStart > earliestStart) {
        earliestStart = bufferedStart;
      }
    }
  }

  if (toLocalDateValue(current) === dateValue && current >= earliestStart && current < slotEnd) {
    earliestStart = current;
  }

  return truncateToMinute(earliestStart);
};

const buildFixedSlotLabel = ({ dateValue, now = new Date(), schedules = [], slot }) => {
  const range = SLOT_RANGES[slot] || SLOT_RANGES.morning;
  const prefix = slot === "afternoon" ? "下午" : "上午";
  const earliestStart = resolveFixedSlotStartAt({ dateValue, now, schedules, slot });
  const earliestText = toLocalTimeValue(earliestStart);
  if (!earliestText || earliestText === range.start) {
    return `${prefix}（${range.start}-${range.end}）`;
  }
  return `${prefix}（${range.start}-${range.end}，最早 ${earliestText} 开始）`;
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
const HALF_DAY_HOURS = 12;

// 计划时长以 0.5 小时为最小粒度，其他输入都会归一化到这个精度。
const parsePlannedHours = (value) => {
  const rawValue = Number.parseFloat(String(value ?? "").trim());
  if (!Number.isFinite(rawValue)) {
    return null;
  }
  const normalized = Math.round(rawValue * 2) / 2;
  return normalized >= 0.5 ? normalized : null;
};

const parsePlannedDays = (value) => {
  const rawValue = Number.parseFloat(String(value ?? "").trim());
  if (!Number.isFinite(rawValue)) {
    return null;
  }
  const normalized = Math.round(rawValue * 2) / 2;
  return normalized >= 0.5 ? normalized : null;
};

const resolvePlannedHours = (form) => {
  const unit = normalizeText(form?.planned_duration_unit) || "hours";
  if (unit === "days") {
    const days = parsePlannedDays(form?.planned_hours);
    return days ? days * 24 : null;
  }
  return parsePlannedHours(form?.planned_hours);
};

// 如果没有显式填写计划时长，则从开始/结束时间反推。
const inferPlannedHours = (startAt, endAt) => {
  if (!startAt || !endAt) {
    return 3.5;
  }
  const hours = (endAt.getTime() - startAt.getTime()) / (1000 * 60 * 60);
  return parsePlannedHours(hours) || 3.5;
};

const buildPlannedDurationFormState = (plannedHours) => {
  const hours = parsePlannedHours(plannedHours);
  if (hours && Number.isInteger(hours / HALF_DAY_HOURS)) {
    return {
      plannedDurationUnit: "days",
      plannedHours: hours / 24,
    };
  }
  return {
    plannedDurationUnit: "hours",
    plannedHours: hours || 3.5,
  };
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

function buildManualTimeSlotOptions({ now = new Date(), scheduleDate = "", schedules = [] } = {}) {
  const selectedDate = normalizeText(scheduleDate) || toLocalDateValue(now);
  return [
    {
      value: "morning",
      label: buildFixedSlotLabel({ dateValue: selectedDate, now, schedules, slot: "morning" }),
    },
    {
      value: "afternoon",
      label: buildFixedSlotLabel({ dateValue: selectedDate, now, schedules, slot: "afternoon" }),
    },
    {
      value: "custom",
      label: "自定义",
    },
  ];
}

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
    lab_code: "",
    lab_id: "",
    planned_hours: 3.5,
    planned_duration_unit: "hours",
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
    lab_code: "",
    lab_id: "",
    planned_hours: 3.5,
    planned_duration_unit: "hours",
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
  const duration = buildPlannedDurationFormState(schedule?.planned_hours || inferPlannedHours(startAt, endAt));
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
    lab_code: normalizeText(schedule?.lab_code ?? schedule?.labCode),
    lab_id: schedule?.lab_id ?? schedule?.labId ?? "",
    planned_hours: duration.plannedHours,
    planned_duration_unit: duration.plannedDurationUnit,
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
    lab_code: editForm.lab_code,
    lab_id: editForm.lab_id,
    planned_hours: editForm.planned_hours,
    planned_duration_unit: editForm.planned_duration_unit,
    schedule_date: editForm.schedule_date,
    task_code: editForm.task_code,
    time_slot: editForm.time_slot,
  };
}

// 解析手动排程操作实际使用的开始和结束时间。
function resolveScheduleTimes(form, now = new Date(), schedules = []) {
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
  let plannedHours = resolvePlannedHours(form);

  if (slot === "custom") {
    // 自定义时段优先使用手填开始时间，如未填计划时长则从结束时间反推。
    startTime = normalizeText(form?.custom_start);
    if (!startTime) {
      return { error: "Custom start time required" };
    }
    const customStartAt = parseDate(`${dateValue}T${startTime}:00`);
    const earliestCustomStart = truncateToMinute(now) || new Date();
    if (!customStartAt || customStartAt < earliestCustomStart) {
      return { error: "自定义开始时间不能早于当前时间" };
    }
    if (!plannedHours) {
      const endTime = normalizeText(form?.custom_end);
      const endAt = parseDate(`${dateValue}T${endTime}:00`);
      plannedHours = inferPlannedHours(customStartAt, endAt);
    }
  } else {
    // 上午/下午快捷时段直接复用预设时间窗。
    const range = SLOT_RANGES[slot] || SLOT_RANGES.morning;
    const slotStartAt = resolveFixedSlotStartAt({ dateValue, now, schedules, slot });
    startTime = toLocalTimeValue(slotStartAt) || range.start;
    plannedHours ||= inferPlannedHours(
      slotStartAt,
      parseDate(`${dateValue}T${range.end}:00`),
    );
  }

  if (!plannedHours) {
    return { error: "Planned hours must be at least 0.5" };
  }

  const startAt = parseDate(`${dateValue}T${startTime}:00`);
  const endAt = startAt ? new Date(startAt.getTime() + plannedHours * 60 * 60 * 1000) : null;
  if (!startAt || !endAt || endAt <= startAt) {
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

const resolveScheduleTaskStatusArgs = (samplesOrNow, nowMaybe, experimentTraysMaybe) => {
  if (Array.isArray(samplesOrNow)) {
    return {
      experimentTrays: Array.isArray(experimentTraysMaybe) ? experimentTraysMaybe : [],
      now: parseDate(nowMaybe) || new Date(),
      samples: samplesOrNow,
    };
  }

  if (samplesOrNow instanceof Date || typeof samplesOrNow === "number" || typeof samplesOrNow === "string") {
    return {
      experimentTrays: Array.isArray(nowMaybe) ? nowMaybe : [],
      now: parseDate(samplesOrNow) || new Date(),
      samples: [],
    };
  }

  return {
    experimentTrays: Array.isArray(experimentTraysMaybe) ? experimentTraysMaybe : [],
    now: parseDate(nowMaybe) || new Date(),
    samples: [],
  };
};

// 推导看板行和留样视图共用的任务状态。
function resolveTaskStatus(taskOrTaskCode, schedules, samplesOrNow, nowMaybe, experimentTraysMaybe) {
  const { samples, now, experimentTrays } = resolveScheduleTaskStatusArgs(samplesOrNow, nowMaybe, experimentTraysMaybe);
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
  if (rawStatus === STATUS_COMPLETED) {
    return STATUS_COMPLETED;
  }

  const labSchedules = related.filter((schedule) => !isRetentionDevice(schedule));
  const retentionSchedules = related.filter((schedule) => isRetentionDevice(schedule));
  const currentTime = now.getTime();
  const experimentTrayMap = buildExperimentTrayMap(experimentTrays);
  const lifecycleStates = labSchedules.map((schedule) => resolveScheduleLifecycleState({ schedule, samples, experimentTrayMap }));

  if (lifecycleStates.some((state) => state.started)) {
    if (lifecycleStates.every((state) => state.completed)) {
      return STATUS_COMPLETED;
    }
    return STATUS_RUNNING;
  }

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

const getMasterLabName = (lab) =>
  normalizeText(lab?.name || lab?.labName || lab?.lab_name || lab?.code || lab?.labCode || lab?.lab_code);

const getMasterLabType = (lab) => normalizeText(lab?.type || lab?.labType || lab?.lab_type);

const getMasterLabTestTypeKeys = (lab) =>
  [
    lab?.testTypeName,
    lab?.test_type_name,
    lab?.testType,
    lab?.test_type,
    lab?.testTypeCode,
    lab?.test_type_code,
  ]
    .map((value) => normalizeText(value))
    .filter(Boolean);

const FORMAL_TEST_TYPE_KEYS = new Set(
  Object.entries(TEST_PREFIX_MAP).flatMap(([testTypeName, testTypeCode]) => [testTypeName, testTypeCode]),
);

const isMasterLabEnabled = (lab) => ![0, "0", false].includes(lab?.status);

const isMasterLabCandidate = (lab) => {
  const name = getMasterLabName(lab);
  const labType = getMasterLabType(lab).toLowerCase();
  const hasFormalTestType = getMasterLabTestTypeKeys(lab).some((key) => FORMAL_TEST_TYPE_KEYS.has(key));
  return (
    Boolean(name) &&
    hasFormalTestType &&
    !isRetentionDevice(name) &&
    !["retention", "staging"].some((keyword) => labType.includes(keyword)) &&
    !labType.includes(RETENTION_KEYWORD)
  );
};

const getMasterLabCandidates = (masterLabs) =>
  (Array.isArray(masterLabs) ? masterLabs : []).filter((lab) => isMasterLabEnabled(lab) && isMasterLabCandidate(lab));

const resolveMasterLabCandidates = (value, masterLabs) => {
  const normalizedValue = normalizeText(value);
  const labs = getMasterLabCandidates(masterLabs);
  if (!normalizedValue || labs.length === 0) {
    return [];
  }
  if (labs.some((lab) => getMasterLabName(lab) === normalizedValue)) {
    return [normalizedValue];
  }
  const matchedLabs = labs
    .filter((lab) => getMasterLabTestTypeKeys(lab).includes(normalizedValue))
    .map((lab) => getMasterLabName(lab));
  return Array.from(new Set(matchedLabs));
};

const getMasterLabNames = (masterLabs) =>
  Array.from(
    new Set(
      getMasterLabCandidates(masterLabs)
        .filter((lab) => getMasterLabTestTypeKeys(lab).length > 0)
        .map((lab) => getMasterLabName(lab)),
    ),
  );

const resolveLabCandidates = (value, masterLabs = []) => {
  const normalizedValue = normalizeText(value);
  if (!normalizedValue) {
    return [];
  }
  const masterLabCandidates = resolveMasterLabCandidates(normalizedValue, masterLabs);
  if (masterLabCandidates.length > 0) {
    return masterLabCandidates;
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

const buildSelectedTaskLabSet = ({ selectedTaskCode, experiments, schedules, tasks, masterLabs = [] }) => {
  const normalizedTaskCode = normalizeText(selectedTaskCode);
  if (!normalizedTaskCode) {
    return null;
  }

  const labs = new Set();
  buildExperimentCandidates({ taskCode: normalizedTaskCode, experiments, tasks })
    .forEach((experiment) => {
      resolveLabCandidates(experiment?.required_device, masterLabs).forEach((lab) => labs.add(lab));
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
      resolveExperimentTypeLabel(experiment),
    ]),
  );

const isLikelyLabDestination = (value) => /室$/.test(normalizeText(value));

const resolveExperimentTypeLabel = (experiment) => {
  const explicitType =
    normalizeText(experiment?.experiment_type)
    || normalizeText(experiment?.experimentType)
    || normalizeText(experiment?.test_type)
    || normalizeText(experiment?.testType);
  if (explicitType) {
    return explicitType;
  }
  const requiredDevice = normalizeText(experiment?.required_device) || normalizeText(experiment?.requiredDevice);
  if (requiredDevice && !isLikelyLabDestination(requiredDevice)) {
    return requiredDevice;
  }
  return normalizeText(experiment?.experiment_name)
    || normalizeText(experiment?.experimentName)
    || normalizeText(experiment?.name)
    || requiredDevice;
};

const formatScheduleWindow = (startAt, endAt) => {
  const startLabel = formatDateTime(startAt);
  const endLabel = formatDateTime(endAt);
  return startLabel && endLabel ? `${startLabel} - ${endLabel}` : "";
};

const buildExperimentTrayMap = (experimentTrays) => {
  const trayMap = new Map();
  (Array.isArray(experimentTrays) ? experimentTrays : []).forEach((entry) => {
    const taskCode = normalizeText(entry?.task_code || entry?.taskCode);
    const experimentCode = normalizeText(entry?.experiment_code || entry?.experimentCode);
    const trayCode = normalizeText(entry?.tray_code || entry?.trayCode);
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

const buildTrayExperimentCodeMap = (experimentTrays) => {
  const trayMap = new Map();
  (Array.isArray(experimentTrays) ? experimentTrays : []).forEach((entry) => {
    const taskCode = normalizeText(entry?.task_code || entry?.taskCode);
    const trayCode = normalizeText(entry?.tray_code || entry?.trayCode);
    const experimentCode = normalizeText(entry?.experiment_code || entry?.experimentCode);
    if (!taskCode || !trayCode || !experimentCode) {
      return;
    }
    const key = `${taskCode}::${trayCode}`;
    const current = trayMap.get(key) || new Set();
    current.add(experimentCode);
    trayMap.set(key, current);
  });
  return trayMap;
};

const parseExperimentHistoryDetail = (detail, taskCode) => {
  const segments = String(detail ?? "")
    .split(" / ")
    .map((segment) => normalizeText(segment))
    .filter(Boolean);
  if (segments.length < 3 || segments[0] !== normalizeText(taskCode)) {
    return null;
  }
  return {
    experimentName: segments[1],
    status: segments[2],
  };
};

const collectScheduleMatchedSamples = ({ schedule, samples, experimentTrayMap }) => {
  const taskCode = normalizeText(schedule?.task_code);
  const experimentCode = normalizeText(schedule?.experiment_code);
  const scopedTrayCodes = new Set(experimentTrayMap.get(`${taskCode}::${experimentCode}`) || []);
  const matchedSamples = (Array.isArray(samples) ? samples : []).filter((sample) => {
    if (normalizeText(sample?.task_code) !== taskCode) {
      return false;
    }
    if (scopedTrayCodes.size === 0) {
      return true;
    }
    return (Array.isArray(sample?.trays) ? sample.trays : []).some((tray) => scopedTrayCodes.has(normalizeText(tray?.tray_code)));
  });
  return {
    experimentCode,
    matchedSamples,
    scopedTrayCodes,
    taskCode,
  };
};

const collectScheduleTrayStatuses = ({ schedule, samples, experimentTrayMap }) => {
  const { matchedSamples, scopedTrayCodes } = collectScheduleMatchedSamples({ schedule, samples, experimentTrayMap });
  const statuses = [];

  matchedSamples.forEach((sample) => {
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

const resolveScheduleLifecycleState = ({
  schedule,
  samples,
  experimentTrayMap,
  experimentNameByCode = new Map(),
  trayExperimentCodeMap = new Map(),
}) => {
  const { matchedSamples, scopedTrayCodes, taskCode, experimentCode } = collectScheduleMatchedSamples({
    schedule,
    samples,
    experimentTrayMap,
  });
  const experimentName =
    normalizeText(schedule?.experiment_name)
    || normalizeText(experimentNameByCode.get(experimentCode));
  const latestHistoryBySample = new Map();

  if (experimentName) {
    matchedSamples.forEach((sample) => {
      const sampleCode = normalizeText(sample?.code);
      if (!sampleCode) {
        return;
      }
      (Array.isArray(sample?.history) ? sample.history : []).forEach((entry) => {
        const parsed = parseExperimentHistoryDetail(entry?.detail, taskCode);
        if (!parsed || parsed.experimentName !== experimentName) {
          return;
        }
        const eventTime = parseDate(entry?.time)?.getTime() || 0;
        const existing = latestHistoryBySample.get(sampleCode);
        if (!existing || eventTime >= existing.time) {
          latestHistoryBySample.set(sampleCode, { status: parsed.status, time: eventTime });
        }
      });
    });
  }

  if (latestHistoryBySample.size > 0) {
    const historyStatuses = Array.from(latestHistoryBySample.values()).map((entry) => entry.status);
    return {
      completed: matchedSamples.length > 0 && latestHistoryBySample.size === matchedSamples.length && historyStatuses.every((status) => COMPLETED_TRAY_STATUSES.has(status)),
      started: historyStatuses.some((status) => STARTED_TRAY_STATUSES.has(status)),
    };
  }

  const trayStatuses = collectScheduleTrayStatuses({ schedule, samples, experimentTrayMap });
  const hasSharedScopedTray = Array.from(scopedTrayCodes).some((trayCode) => (trayExperimentCodeMap.get(`${taskCode}::${trayCode}`)?.size || 0) > 1);
  if (hasSharedScopedTray) {
    return {
      completed: false,
      started: false,
    };
  }
  return {
    completed: trayStatuses.length > 0 && trayStatuses.every((status) => COMPLETED_TRAY_STATUSES.has(status)),
    started: trayStatuses.some((status) => STARTED_TRAY_STATUSES.has(status)),
  };
};

const resolveScheduleRowStatus = ({
  schedule,
  samples,
  now,
  experimentTrayMap,
  experimentNameByCode = new Map(),
  trayExperimentCodeMap = new Map(),
}) => {
  const lifecycleState = resolveScheduleLifecycleState({
    schedule,
    samples,
    experimentTrayMap,
    experimentNameByCode,
    trayExperimentCodeMap,
  });
  if (lifecycleState.started) {
    return lifecycleState.completed ? STATUS_COMPLETED : STATUS_RUNNING;
  }

  if (isRetentionDevice(schedule)) {
    return STATUS_RETENTION;
  }

  const currentTime = now.getTime();
  const startAt = parseDate(schedule?.start_at);
  const endAt = parseDate(schedule?.end_at);
  if (startAt && endAt && startAt.getTime() <= currentTime && endAt.getTime() >= currentTime) {
    return STATUS_SCHEDULED;
  }
  if (endAt && endAt.getTime() > currentTime) {
    return STATUS_SCHEDULED;
  }
  return STATUS_WAITING;
};

const scheduleIsCompleted = ({
  experimentNameByCode = new Map(),
  experimentTrayMap,
  samples,
  schedule,
  trayExperimentCodeMap = new Map(),
}) =>
  resolveScheduleLifecycleState({
    experimentNameByCode,
    experimentTrayMap,
    samples,
    schedule,
    trayExperimentCodeMap,
  }).completed;

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

function buildTaskScheduledOverlays({ taskCode, experimentCode, schedules, experiments, experimentTrays, tasks = [], samples = [] }) {
  const normalizedTaskCode = normalizeText(taskCode);
  const selectedExperimentCode = normalizeText(experimentCode);
  if (!normalizedTaskCode) {
    return [];
  }
  const { activeTaskCodes } = buildActiveTaskContext(tasks, samples);
  if (activeTaskCodes && !activeTaskCodes.has(normalizedTaskCode)) {
    return [];
  }

  const experimentNameByCode = buildExperimentNameMap(experiments);
  const trayMap = buildExperimentTrayMap(experimentTrays);

  return filterSchedulesForActiveTasks({ schedules, tasks, samples })
    .filter((schedule) => {
      if (normalizeText(schedule?.task_code) !== normalizedTaskCode) {
        return false;
      }
      if (isRetentionDevice(schedule)) {
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
    .map((overlay) => {
      const nextOverlay = { ...overlay };
      delete nextOverlay.sortTime;
      return nextOverlay;
    });
}

function analyzeTaskTrayConflict({ candidate, schedules, experiments, experimentTrays, samples = [] }) {
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
  const trayExperimentCodeMap = buildTrayExperimentCodeMap(experimentTrays);
  const conflictSchedules = (Array.isArray(schedules) ? schedules : [])
    .filter((schedule) => {
      if (normalizeText(schedule?.task_code) !== candidateTaskCode) {
        return false;
      }
      if (isRetentionDevice(schedule)) {
        return false;
      }
      if (normalizeText(schedule?.experiment_code) === candidateExperimentCode) {
        return false;
      }
      if (scheduleIsCompleted({ experimentNameByCode, experimentTrayMap: trayMap, samples, schedule, trayExperimentCodeMap })) {
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
function buildScheduleRows({ schedules, tasks, experiments, samples = [], experimentTrays = [], now = new Date() }) {
  const { activeTasks } = buildActiveTaskContext(tasks, samples);
  const taskList = Array.isArray(tasks) && tasks.length > 0 ? activeTasks : [];
  const taskByCode = new Map(taskList.map((task) => [normalizeText(task?.code), task]));
  const experimentNameByCode = buildExperimentNameMap(experiments);
  const experimentTrayMap = buildExperimentTrayMap(experimentTrays);
  const trayExperimentCodeMap = buildTrayExperimentCodeMap(experimentTrays);
  const visibleSchedules = filterSchedulesForActiveTasks({ schedules, tasks, samples });

  return visibleSchedules
    .map((schedule) => {
      const taskCode = normalizeText(schedule?.task_code);
      const experimentCode = normalizeText(schedule?.experiment_code);
      const task = taskByCode.get(taskCode);
      // 排程列表的状态按当前这条实验排程的真实生命周期判断，避免同任务下兄弟实验互相串扰。
      const status = resolveScheduleRowStatus({
        schedule,
        samples,
        now,
        experimentTrayMap,
        experimentNameByCode,
        trayExperimentCodeMap,
      });

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
function buildConflictRows({ schedules, tasks = [], samples = [], experiments = [], experimentTrays = [] }) {
  const experimentTrayMap = buildExperimentTrayMap(experimentTrays);
  const experimentNameByCode = buildExperimentNameMap(experiments);
  const trayExperimentCodeMap = buildTrayExperimentCodeMap(experimentTrays);
  const scheduleList = filterSchedulesForActiveTasks({ schedules, tasks, samples })
    .filter((schedule) => !isRetentionDevice(schedule))
    .filter(
      (schedule) =>
        !scheduleIsCompleted({
          experimentNameByCode,
          experimentTrayMap,
          samples,
          schedule,
          trayExperimentCodeMap,
        }),
    )
    .map((schedule) => ({ ...schedule }));
  const byDevice = new Map();

  // 冲突检查按设备分组后，只需要比较同设备下相邻时间段是否重叠。
  scheduleList.forEach((schedule) => {
    const device = normalizeText(schedule?.device);
    const labKey = resolveScheduleLabCode(schedule) || device;
    if (!device) {
      return;
    }
    const group = byDevice.get(labKey) || [];
    group.push(schedule);
    byDevice.set(labKey, group);
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
        device: normalizeText(current?.device) || device,
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
function buildGanttRows({ schedules, experiments = [], experimentTrays = [], samples = [], tasks = [], devices = [], masterLabs = [], days = 3, filterDevice = "", selectedTaskCode = "", startDate = new Date(), now = new Date() }) {
  const experimentTrayMap = buildExperimentTrayMap(experimentTrays);
  const experimentNameByCode = buildExperimentNameMap(experiments);
  const trayExperimentCodeMap = buildTrayExperimentCodeMap(experimentTrays);
  const deviceByCode = new Map((Array.isArray(devices) ? devices : []).map((device) => [normalizeText(device?.code), device]));
  const visibleSchedules = filterSchedulesForActiveTasks({ schedules, tasks, samples }).filter((schedule) => {
    if (isRetentionDevice(schedule)) {
      return false;
    }
    const lifecycleState = resolveScheduleLifecycleState({
      schedule,
      samples,
      experimentTrayMap,
      experimentNameByCode,
      trayExperimentCodeMap,
    });
    // 实验实际完成后立即释放甘特占用，不再等到计划结束时间。
    return !lifecycleState.completed;
  });
  const anchorDate = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
  // 如果视图窗口内的默认天数不足以覆盖最新排程，会自动向后扩展。
  const dayList = Array.from({ length: days }, (_, index) => {
    const date = addDays(anchorDate, index);
    return {
      date,
      key: toLocalDateValue(date),
      label: `${date.getMonth() + 1}/${date.getDate()}`,
    };
  });

  const masterLabNames = getMasterLabNames(masterLabs);
  const masterLabByName = new Map(
    (Array.isArray(masterLabs) ? masterLabs : [])
      .map((lab) => {
        const name = getMasterLabName(lab);
        return name ? [name, { ...resolveLabRef(lab), name }] : null;
      })
      .filter(Boolean),
  );
  const hasMasterLabRows = masterLabNames.length > 0;
  const inventoryDeviceCodes = (Array.isArray(devices) ? devices : [])
    .map((device) => normalizeText(device?.code))
    .filter((code) => !hasMasterLabRows || masterLabNames.includes(code) || TEST_LABS.includes(code));
  const baseDeviceCodes = Array.from(
    new Set(
      []
        .concat(TEST_LABS)
        .concat(inventoryDeviceCodes)
        .concat(masterLabNames)
        .concat(
          visibleSchedules.map((schedule) => {
            const scheduleCode = resolveScheduleLabCode(schedule);
            if (scheduleCode && hasMasterLabRows) {
              const masterLab = (Array.isArray(masterLabs) ? masterLabs : [])
                .find((lab) => resolveLabRef(lab).code === scheduleCode);
              const masterName = getMasterLabName(masterLab);
              if (masterName) {
                return masterName;
              }
            }
            return normalizeText(schedule?.device);
          }),
        ),
    ),
  )
    .filter(Boolean)
    .filter((device) => !isRetentionDevice(device));

  const selectedTaskLabs = buildSelectedTaskLabSet({
    experiments,
    schedules: visibleSchedules,
    selectedTaskCode,
    tasks,
    masterLabs,
  });
  const deviceCodes = selectedTaskLabs && selectedTaskLabs.size > 0
    ? baseDeviceCodes.filter((device) => selectedTaskLabs.has(device))
    : normalizeText(filterDevice)
      ? baseDeviceCodes.filter((device) => normalizeText(device) === normalizeText(filterDevice))
      : baseDeviceCodes;

  const rows = deviceCodes.map((device) => {
    const labRef = masterLabByName.get(device) || { name: device };
    const deviceSchedules = visibleSchedules.filter((schedule) => scheduleMatchesLab(schedule, labRef));
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
          const unavailableMeta = resolveUnavailableSlotMeta({
            device: deviceByCode.get(device),
            deviceCode: device,
            endAt: segmentEnd,
            now,
            startAt: segmentStart,
          });
          return {
            className: unavailableMeta?.className || "gantt-slot idle",
            date: day.key,
            displayMode: "idle",
            items: [],
            key: slotKey,
            label: unavailableMeta?.label || "空闲",
            overflowCount: 0,
            scheduleId: "",
            segment,
            state: unavailableMeta?.state || "idle",
            title: unavailableMeta?.title || "空闲",
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
        const lifecycleState = resolveScheduleLifecycleState({
          schedule,
          samples,
          experimentTrayMap,
          experimentNameByCode,
          trayExperimentCodeMap,
        });
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
      const signature = slot.state === "idle" || slot.state === "maintenance" || slot.state === "disabled"
        ? `${slot.state}:${slot.label}:${slot.title}`
        : slot.state === "conflict" || slot.state === "stacked" || slot.state === "split"
          ? `${slot.state}:${slot.key}`
          : `${slot.label}:${slot.className}`;
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
      segments: segments.map((segment) => {
        const nextSegment = { ...segment };
        delete nextSegment.signature;
        return nextSegment;
      }),
      slots,
    };
  });

  return { days: dayList, rows };
}

// 构建留样面板中等待暂存的任务和样品行数据。
function buildRetentionInternalRows({ tasks, schedules, now = new Date() }) {
  const taskByCode = new Map((Array.isArray(tasks) ? tasks : []).map((task) => [normalizeText(task?.code), task]));
  const nonRetentionCodes = new Set(
    (Array.isArray(schedules) ? schedules : [])
      .filter((schedule) => !isRetentionDevice(schedule))
      .map((schedule) => normalizeText(schedule?.task_code))
      .filter(Boolean),
  );

  const rowsByCode = new Map();

  // 留样面板只关注“仅在暂存间且尚未进入正式实验”的任务。
  (Array.isArray(schedules) ? schedules : []).forEach((schedule) => {
    const taskCode = normalizeText(schedule?.task_code);
    if (!taskCode || nonRetentionCodes.has(taskCode) || !isRetentionDevice(schedule)) {
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
  const { activeTasks } = buildActiveTaskContext(tasks, samples);
  const taskList = Array.isArray(tasks) && tasks.length > 0 ? activeTasks : [];
  const activeSchedules = filterSchedulesForActiveTasks({ schedules, tasks, samples });
  const pendingExperimentTaskCodes = new Set(
    taskList
      .map((task) => normalizeText(task?.code))
      .filter((taskCode) =>
        Boolean(
          taskCode &&
            buildExperimentOptions({
              experiments,
              samples,
              schedules: activeSchedules,
              taskCode,
              tasks: taskList,
            }).length > 0,
        ),
      )
      .filter(Boolean),
  );

  // 正常排程页签优先显示仍有未排实验的任务。
  return taskList
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
      label: normalizeText(task?.code),
      testType: normalizeText(task?.test_type),
    }));
}

function buildLabOptions({ testType, selectedDevice = "", masterLabs = [] }) {
  let labs = normalizeText(testType) ? resolveLabCandidates(normalizeText(testType), masterLabs) : [];
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
function buildSummaryCards({ schedules, tasks = [], samples = [], experiments = [], experimentTrays = [], now = new Date() }) {
  const rows = buildScheduleRows({ schedules, tasks, samples, experiments, experimentTrays, now });
  const conflictRows = buildConflictRows({ schedules, tasks, samples, experiments, experimentTrays });
  return {
    changeCount: 0,
    conflictCount: conflictRows.length,
    nextAuto: formatDateTime(new Date(now.getTime() + 60 * 60 * 1000)),
    scheduleCount: rows.length,
  };
}

// 持久化辅助逻辑会在更新排程时同步任务和数据流状态。
function syncTaskStatuses(tasks, schedules, now = new Date(), samples = [], experimentTrays = []) {
  return (Array.isArray(tasks) ? tasks : []).map((task) => ({
    ...task,
    // 任务状态完全以当前排程快照重新计算，避免手工维护多处状态。
    status: resolveTaskStatus(task, schedules, samples, now, experimentTrays),
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
      !isRetentionDevice(schedule),
  );
}

function syncExperimentUnscheduledSince({ experiments, schedules, taskCode, experimentCode, tasks = [], samples = [] }) {
  const normalizedTaskCode = normalizeText(taskCode);
  const normalizedExperimentCode = normalizeText(experimentCode);
  const nextExperiments = Array.isArray(experiments) ? experiments.map((experiment) => ({ ...experiment })) : [];
  if (!normalizedTaskCode || !normalizedExperimentCode) {
    return nextExperiments;
  }

  const hasFormalSchedule = hasFormalExperimentSchedule(schedules, normalizedTaskCode, normalizedExperimentCode);
  const task = (Array.isArray(tasks) ? tasks : []).find(
    (entry) => normalizeText(entry?.code || entry?.task_code) === normalizedTaskCode,
  );
  const taskSamples = (Array.isArray(samples) ? samples : []).filter(
    (sample) => normalizeText(sample?.task_code) === normalizedTaskCode,
  );
  const confirmedAt = resolveTransferConfirmedAt({ samples: taskSamples, task });
  return nextExperiments.map((experiment) => {
    if (
      normalizeText(experiment?.task_code) !== normalizedTaskCode ||
      normalizeText(experiment?.experiment_code) !== normalizedExperimentCode
    ) {
      return experiment;
    }

    return {
      ...experiment,
      status: hasFormalSchedule ? experiment.status : STATUS_WAITING,
      unscheduled_since: hasFormalSchedule ? "" : confirmedAt ? formatLocalDateTime(confirmedAt) : "",
    };
  });
}

function buildExperimentOptions({ taskCode, experiments, schedules, tasks, samples = [] }) {
  const { activeTasks, activeTaskCodes } = buildActiveTaskContext(tasks, samples);
  const taskList = Array.isArray(tasks) && tasks.length > 0 ? activeTasks : tasks;
  const normalizedTaskCode = normalizeText(taskCode);
  if (activeTaskCodes && normalizedTaskCode && !activeTaskCodes.has(normalizedTaskCode)) {
    return [];
  }
  const activeSchedules = filterSchedulesForActiveTasks({ schedules, tasks, samples });
  const scheduledExperimentCodes = new Set(
    activeSchedules
      .filter(
        (schedule) =>
          !isRetentionDevice(schedule) &&
          normalizeText(schedule?.experiment_code),
      )
      .map((schedule) => normalizeText(schedule?.experiment_code)),
  );

  const seenLabels = new Set();
  return buildExperimentCandidates({ taskCode, experiments, tasks: taskList })
    .filter((experiment) => !scheduledExperimentCodes.has(normalizeText(experiment?.experiment_code)))
    .map((experiment) => {
      const experimentCode = normalizeText(experiment?.experiment_code);
      const typeLabel = resolveExperimentTypeLabel(experiment) || experimentCode;
      return {
        code: experimentCode,
        fullCode: experimentCode,
        label: typeLabel,
        requiredDevice: normalizeText(experiment?.required_device) || typeLabel,
        taskCode: normalizeText(experiment?.task_code),
      };
    })
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

function findScheduleConflicts({ schedules, candidate, ignoreId = "", experiments = [], experimentTrays = [], samples = [] }) {
  const device = normalizeText(candidate?.device);
  if (!device || isRetentionDevice(device)) {
    return [];
  }
  const startAt = parseDate(candidate?.start_at);
  const endAt = parseDate(candidate?.end_at);
  if (!startAt || !endAt) {
    return [];
  }

  const experimentTrayMap = buildExperimentTrayMap(experimentTrays);
  const experimentNameByCode = buildExperimentNameMap(experiments);
  const trayExperimentCodeMap = buildTrayExperimentCodeMap(experimentTrays);

  // 冲突检查排除自身编辑场景，只比较同设备且时间重叠的正式排程。
  return (Array.isArray(schedules) ? schedules : []).filter((schedule) => {
    if (normalizeText(schedule?.id) === normalizeText(ignoreId)) {
      return false;
    }
    if (!scheduleMatchesLab(schedule, candidate)) {
      return false;
    }
    if (scheduleIsCompleted({ experimentNameByCode, experimentTrayMap, samples, schedule, trayExperimentCodeMap })) {
      return false;
    }
    const existingStart = parseDate(schedule?.start_at);
    const existingEnd = parseDate(schedule?.end_at);
    return existingStart && existingEnd && overlaps(startAt, endAt, existingStart, existingEnd);
  });
}

function createScheduleRecord({ devices = [], experiments, form, tasks, schedules, streams, now = new Date(), samples = [], experimentTrays = [] }) {
  const taskCode = normalizeText(form?.task_code);
  const device = normalizeText(form?.device);
  if (!taskCode || !device) {
    return { error: "请选择任务和实验室" };
  }

  const resolved = resolveScheduleTimes(form, now, schedules);
  if (resolved.error) {
    return resolved;
  }

  const deviceRecord = findDeviceRecord(devices, device);
  const deviceBlockMessage = isRetentionDevice(device)
    ? ""
    : resolveDeviceScheduleBlockMessage({
        device: deviceRecord,
        endAt: resolved.endAt,
        now,
        startAt: resolved.startAt,
      });
  if (deviceBlockMessage) {
    return { error: deviceBlockMessage };
  }

  const nextSchedules = Array.isArray(schedules) ? schedules.map((schedule) => ({ ...schedule })) : [];
      const candidate = {
        device,
        end_at: formatLocalDateTime(resolved.endAt),
        experiment_code: normalizeText(form?.experiment_code),
        lab_code: normalizeText(form?.lab_code ?? form?.labCode),
        lab_id: form?.lab_id ?? form?.labId ?? "",
        planned_hours: resolved.plannedHours,
        start_at: formatLocalDateTime(resolved.startAt),
        task_code: taskCode,
  };
  const conflicts = findScheduleConflicts({ candidate, experiments, experimentTrays, samples, schedules: nextSchedules });
  if (conflicts.length > 0) {
    return { error: "排程冲突，请调整时间或实验室" };
  }

  // 任务此前若只在暂存间，转入正式实验室时直接复用原暂存记录。
  const retentionSchedule = nextSchedules.find(
    (schedule) => normalizeText(schedule?.task_code) === taskCode && isRetentionDevice(schedule) && !isRetentionDevice(device),
  );
  if (retentionSchedule) {
    retentionSchedule.device = device;
    retentionSchedule.start_at = candidate.start_at;
    retentionSchedule.end_at = candidate.end_at;
    retentionSchedule.experiment_code = candidate.experiment_code;
    retentionSchedule.lab_code = candidate.lab_code;
    retentionSchedule.lab_id = candidate.lab_id;
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

  const nextTasks = syncTaskStatuses(tasks, nextSchedules, now, samples, experimentTrays);
  const nextExperiments = syncExperimentUnscheduledSince({
    experimentCode: candidate.experiment_code,
    experiments,
    samples,
    schedules: nextSchedules,
    taskCode,
    tasks,
  });
  const targetSchedule =
    nextSchedules.find((schedule) => normalizeText(schedule?.task_code) === taskCode && scheduleMatchesLab(schedule, candidate)) ||
    nextSchedules[nextSchedules.length - 1];
  const nextStreams = ensureStreamForSchedule(streams, targetSchedule, now);

  return { experiments: nextExperiments, schedules: nextSchedules, streams: nextStreams, tasks: nextTasks };
}

function updateScheduleRecord({ devices = [], experiments, form, tasks, schedules, streams, now = new Date(), samples = [], experimentTrays = [] }) {
  const scheduleId = normalizeText(form?.id);
  const nextSchedules = Array.isArray(schedules) ? schedules.map((schedule) => ({ ...schedule })) : [];
  const target = nextSchedules.find((schedule) => normalizeText(schedule?.id) === scheduleId);
  if (!target) {
    return { error: "未找到排程记录" };
  }

  const resolved = resolveScheduleTimes(form, now, schedules);
  if (resolved.error) {
    return resolved;
  }

  const device = normalizeText(form?.device);
  if (!device) {
    return { error: "请选择实验室" };
  }

  const candidate = {
    device,
    end_at: formatLocalDateTime(resolved.endAt),
    experiment_code: normalizeText(form?.experiment_code),
    lab_code: normalizeText(form?.lab_code ?? form?.labCode),
    lab_id: form?.lab_id ?? form?.labId ?? "",
    planned_hours: resolved.plannedHours,
    start_at: formatLocalDateTime(resolved.startAt),
    task_code: normalizeText(form?.task_code),
  };
  const deviceRecord = findDeviceRecord(devices, device);
  const deviceBlockMessage = isRetentionDevice(device)
    ? ""
    : resolveDeviceScheduleBlockMessage({
        device: deviceRecord,
        endAt: resolved.endAt,
        now,
        startAt: resolved.startAt,
      });
  if (deviceBlockMessage) {
    return { error: deviceBlockMessage };
  }
  const conflicts = findScheduleConflicts({ candidate, experiments, experimentTrays, samples, schedules: nextSchedules, ignoreId: scheduleId });
  if (conflicts.length > 0) {
    return { error: "排程冲突，请调整时间或实验室" };
  }

  // 编辑场景直接原位覆盖目标排程记录。
  target.device = device;
  target.start_at = candidate.start_at;
  target.end_at = candidate.end_at;
  target.experiment_code = candidate.experiment_code;
  target.lab_code = candidate.lab_code;
  target.lab_id = candidate.lab_id;
  target.planned_hours = candidate.planned_hours;
  target.status = isRetentionDevice(device) ? STATUS_RETENTION : STATUS_SCHEDULED;

  const nextTasks = syncTaskStatuses(tasks, nextSchedules, now, samples, experimentTrays);
  const nextExperiments = syncExperimentUnscheduledSince({
    experimentCode: candidate.experiment_code,
    experiments,
    samples,
    schedules: nextSchedules,
    taskCode: candidate.task_code,
    tasks,
  });
  const nextStreams = ensureStreamForSchedule(streams, target, now);

  return { experiments: nextExperiments, schedules: nextSchedules, streams: nextStreams, tasks: nextTasks };
}

function deleteScheduleRecord({ experimentTrays = [], experiments, samples = [], scheduleId, tasks, schedules, streams, now = new Date() }) {
  const removedSchedule = (Array.isArray(schedules) ? schedules : []).find(
    (schedule) => normalizeText(schedule?.id) === normalizeText(scheduleId),
  );
  const nextSchedules = (Array.isArray(schedules) ? schedules : []).filter(
    (schedule) => normalizeText(schedule?.id) !== normalizeText(scheduleId),
  );
  const nextTasks = syncTaskStatuses(tasks, nextSchedules, now, samples, experimentTrays);
  const nextExperiments = syncExperimentUnscheduledSince({
    experimentCode: normalizeText(removedSchedule?.experiment_code),
    experiments,
    samples,
    schedules: nextSchedules,
    taskCode: normalizeText(removedSchedule?.task_code),
    tasks,
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
  buildManualTimeSlotOptions,
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
  isDeviceUnavailableForSchedule,
  normalizeText,
  toLocalDateValue,
  toLocalTimeValue,
  resolveLegalManualScheduleState,
  resolveRetentionTimeState,
  resolveScheduleTimes,
  resolveTaskStatus,
  isManualScheduleSelectionLegal,
  updateScheduleRecord,
  resolveDeviceUnavailableReason,
};
