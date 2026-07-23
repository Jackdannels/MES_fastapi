import { normalizeAxisCodes } from "@/lib/axisCodes";
import { collectExperimentTypes } from "@/lib/experimentTypes";
import { serverNowDate } from "@/lib/serverClock";
import { filterActiveTasks } from "@/lib/taskArchive";
import {
  formatDateTime,
  isRetentionDevice,
  normalizeText,
  overlaps,
  parseDate,
} from "./sharedModel";


const STATUS_WAITING = "待排程";
const STATUS_SCHEDULED = "已排程";
const STATUS_RUNNING = "实验进行中";
const STATUS_COMPLETED = "实验已完成";
const STATUS_RETENTION = "暂存间存放";
const DEVICE_STATUS_REPAIR = "维修";
const DEVICE_STATUS_UPKEEP = "保养";
const DEVICE_STATUS_DISABLED = "停用";
const STREAMING_STATUS = "Streaming";
const STARTED_TRAY_STATUSES = new Set([
  STATUS_RUNNING,
  "实验中",
  STATUS_COMPLETED,
  "实验完成",
  "送至外观检测间",
  "实验后外观检测间存放",
  "实验后暂存间存放",
  "厂家收回",
]);
const COMPLETED_TRAY_STATUSES = new Set([
  STATUS_COMPLETED,
  "实验完成",
  "送至外观检测间",
  "实验后外观检测间存放",
  "实验后暂存间存放",
  "厂家收回",
]);
const COMPLETED_SCHEDULE_STATUSES = new Set([
  STATUS_COMPLETED,
  "实验完成",
  "实验已经完成",
  "厂家收回",
]);
const isTerminalExperimentStatus = (status) => COMPLETED_SCHEDULE_STATUSES.has(normalizeText(status));
const AXIS_EXPERIMENT_TYPES = new Set(["冲击试验", "冲击实验", "振动试验", "振动实验"]);
const AXIS_LAB_LOCK_GROUPS = [
  {
    label: "冲击",
    experimentTypes: new Set(["冲击试验", "冲击实验"]),
    labs: new Set(["冲击一室", "冲击二室"]),
  },
  {
    label: "振动",
    experimentTypes: new Set(["振动试验", "振动实验"]),
    labs: new Set(["振动一室", "振动二室"]),
  },
];
const AXIS_CODE_OPTIONS = [
  { code: "x+", label: "X+", testId: "x-plus" },
  { code: "x-", label: "X-", testId: "x-minus" },
  { code: "y+", label: "Y+", testId: "y-plus" },
  { code: "y-", label: "Y-", testId: "y-minus" },
  { code: "z+", label: "Z+", testId: "z-plus" },
  { code: "z-", label: "Z-", testId: "z-minus" },
];
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

const resolveSubExperimentCode = (value = {}) =>
  normalizeText(value?.subExperimentCode ?? value?.sub_experiment_code ?? value?.sub_experiment_no ?? value?.subExperimentNo);

const deriveAxisSubExperimentCode = (experimentCode, axisBatchNo) => {
  const normalizedExperimentCode = normalizeText(experimentCode);
  let normalizedAxisBatchNo = normalizeText(axisBatchNo);
  if (!normalizedExperimentCode || !normalizedAxisBatchNo) {
    return "";
  }
  if (/^\d+$/.test(normalizedAxisBatchNo)) {
    normalizedAxisBatchNo = normalizedAxisBatchNo.padStart(3, "0");
  }
  return `${normalizedExperimentCode}-AXIS-${normalizedAxisBatchNo}`;
};

const resolveNextAxisBatchNo = ({ experimentCode = "", schedules = [], taskCode = "" } = {}) => {
  const normalizedTaskCode = normalizeText(taskCode);
  const normalizedExperimentCode = normalizeText(experimentCode);
  const relatedAxisSchedules = (Array.isArray(schedules) ? schedules : []).filter((schedule) =>
    normalizeText(schedule?.task_code ?? schedule?.taskCode) === normalizedTaskCode
    && normalizeText(schedule?.experiment_code ?? schedule?.experimentCode) === normalizedExperimentCode
    && normalizeAxisCodes(schedule?.axis_codes ?? schedule?.axisCodes).length > 0,
  );
  const maxNumericBatchNo = relatedAxisSchedules.reduce((maxValue, schedule) => {
    const batchNo = normalizeText(schedule?.axis_batch_no ?? schedule?.axisBatchNo);
    if (!/^\d+$/.test(batchNo)) {
      return maxValue;
    }
    return Math.max(maxValue, Number(batchNo));
  }, 0);
  const nextBatchNo = maxNumericBatchNo > 0 ? maxNumericBatchNo + 1 : relatedAxisSchedules.length + 1;
  return String(nextBatchNo).padStart(3, "0");
};

const experimentSupportsAxisScheduling = (experiment) => {
  const axisCodes = normalizeAxisCodes(experiment?.axis_codes ?? experiment?.axisCodes);
  const labels = [
    normalizeText(experiment?.experiment_name),
    normalizeText(experiment?.experiment_type),
    normalizeText(experiment?.required_device),
  ];
  return axisCodes.length > 0 || labels.some((label) => AXIS_EXPERIMENT_TYPES.has(label));
};

const resolveAxisLabLockGroup = (experiment) => {
  const labels = [
    normalizeText(experiment?.experiment_name),
    normalizeText(experiment?.experiment_type),
    normalizeText(experiment?.required_device),
  ];
  if (!experimentSupportsAxisScheduling(experiment)) {
    return null;
  }
  return AXIS_LAB_LOCK_GROUPS.find((group) => labels.some((label) => group.experimentTypes.has(label))) || null;
};

const resolveExperimentAxisCodes = (experiment) => {
  const explicitAxisCodes = normalizeAxisCodes(experiment?.axis_codes ?? experiment?.axisCodes);
  if (explicitAxisCodes.length > 0) {
    return explicitAxisCodes;
  }
  return [];
};

const resolveAxisScheduleLockContext = ({ experimentCode, experiments = [], form = {}, schedules = [], taskCode = "" }) => {
  const normalizedTaskCode = normalizeText(taskCode || form?.task_code);
  const normalizedExperimentCode = normalizeText(experimentCode ?? form?.experiment_code);
  if (!normalizedTaskCode || !normalizedExperimentCode) {
    return { device: "", label: "" };
  }
  const experiment = (Array.isArray(experiments) ? experiments : []).find(
    (entry) =>
      normalizeText(entry?.experiment_code) === normalizedExperimentCode &&
      normalizeText(entry?.task_code) === normalizedTaskCode,
  );
  const lockGroup = resolveAxisLabLockGroup(experiment);
  if (!lockGroup) {
    return { device: "", label: "" };
  }
  const relatedSchedule = (Array.isArray(schedules) ? schedules : []).find((schedule) => {
    const device = normalizeText(schedule?.device);
    return (
      !isRetentionDevice(schedule) &&
      normalizeText(schedule?.task_code) === normalizedTaskCode &&
      normalizeText(schedule?.experiment_code) === normalizedExperimentCode &&
      lockGroup.labs.has(device) &&
      normalizeAxisCodes(schedule?.axis_codes ?? schedule?.axisCodes).length > 0
    );
  });
  return { device: normalizeText(relatedSchedule?.device), label: lockGroup.label };
};

const resolveAxisScheduleDeviceLock = (options) => resolveAxisScheduleLockContext(options).device;

const formatAxisLabel = (value) => normalizeText(value).toUpperCase();

const buildAxisExperimentLabel = (experimentLabel, axisCodes) => {
  const normalizedLabel = normalizeText(experimentLabel);
  const axisLabel = normalizeAxisCodes(axisCodes).map(formatAxisLabel).join(" / ");
  return axisLabel ? `${normalizedLabel} ${axisLabel}`.trim() : normalizedLabel;
};

const scheduledAxisCodesForExperiment = ({ experimentCode, schedules }) => {
  const normalizedExperimentCode = normalizeText(experimentCode);
  const seen = new Set();
  return (Array.isArray(schedules) ? schedules : [])
    .filter((schedule) => !isRetentionDevice(schedule) && normalizeText(schedule?.experiment_code) === normalizedExperimentCode)
    .flatMap((schedule) => normalizeAxisCodes(schedule?.axis_codes ?? schedule?.axisCodes))
    .filter((axisCode) => {
      if (!axisCode || seen.has(axisCode)) {
        return false;
      }
      seen.add(axisCode);
      return true;
    });
};

const AXIS_STEP_COMPLETED_STATUSES = new Set(["实验已完成", "实验完成", "实验已经完成"]);

const completedAxisCodesForExperiment = ({ experimentCode, experimentRunSteps = [], taskCode = "" }) => {
  const normalizedExperimentCode = normalizeText(experimentCode);
  const normalizedTaskCode = normalizeText(taskCode);
  const seen = new Set();
  return (Array.isArray(experimentRunSteps) ? experimentRunSteps : [])
    .filter((step) => {
      const stepTaskCode = normalizeText(step?.task_code ?? step?.taskCode);
      const stepExperimentCode = normalizeText(step?.experiment_code ?? step?.experimentCode);
      const stepStatus = normalizeText(step?.status ?? step?.step_status ?? step?.stepStatus);
      return (
        stepExperimentCode === normalizedExperimentCode &&
        (!normalizedTaskCode || stepTaskCode === normalizedTaskCode) &&
        AXIS_STEP_COMPLETED_STATUSES.has(stepStatus)
      );
    })
    .map((step) => normalizeText(step?.axis_code ?? step?.axisCode).toLowerCase())
    .filter((axisCode) => {
      if (!axisCode || seen.has(axisCode)) {
        return false;
      }
      seen.add(axisCode);
      return true;
    });
};

const resolveScheduledAxisSelection = ({ experimentCode, experiments = [], experimentRunSteps = [], form, schedules = [] }) => {
  const explicitAxisCodes = normalizeAxisCodes(form?.axis_codes ?? form?.axisCodes);
  const hasExplicitAxisSelection = explicitAxisCodes.length > 0;

  const normalizedTaskCode = normalizeText(form?.task_code);
  const normalizedExperimentCode = normalizeText(experimentCode ?? form?.experiment_code);
  const experiment = (Array.isArray(experiments) ? experiments : []).find(
    (entry) =>
      normalizeText(entry?.experiment_code) === normalizedExperimentCode &&
      (!normalizedTaskCode || normalizeText(entry?.task_code) === normalizedTaskCode),
  );
  if (!experiment || !experimentSupportsAxisScheduling(experiment)) {
    return { axisCodes: [] };
  }
  const axisCodes = resolveExperimentAxisCodes(experiment);
  if (axisCodes.length === 0) {
    return { axisCodes: [], error: "当前实验缺少任务下发的轴向信息" };
  }
  const completedAxisCodes = completedAxisCodesForExperiment({
    experimentCode: normalizedExperimentCode,
    experimentRunSteps,
    taskCode: normalizedTaskCode,
  });
  const unavailableAxisCodes = new Set([
    ...scheduledAxisCodesForExperiment({ experimentCode: normalizedExperimentCode, schedules }),
    ...completedAxisCodes,
  ]);
  const remainingAxisCodes = axisCodes.filter((axisCode) => !unavailableAxisCodes.has(axisCode));
  if (remainingAxisCodes.length === 0) {
    return { axisCodes: [], error: "当前实验的轴向已全部排程" };
  }
  if (!hasExplicitAxisSelection) {
    return { axisCodes: [], error: "请选择轴向" };
  }
  const selectedAxisCodes = explicitAxisCodes.filter((axisCode) => remainingAxisCodes.includes(axisCode));
  if (selectedAxisCodes.length === 0) {
    return { axisCodes: [], error: "请选择轴向" };
  }
  return { axisCodes: selectedAxisCodes };
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

const isExpiredMaintenanceWindow = (device, now = serverNowDate()) => {
  const endAt = parseDate(device?.maintenance_end_at ?? device?.maintenanceEndAt);
  const current = parseDate(now) || serverNowDate();
  return Boolean(endAt && endAt < current);
};

const isActiveMaintenanceDeviceStatus = (status) =>
  status === DEVICE_STATUS_UPKEEP || status === DEVICE_STATUS_REPAIR;

const resolveDeviceUnavailableReason = (device, now = serverNowDate()) => {
  const status = normalizeText(device?.status);
  const maintenanceStart = parseDate(device?.maintenance_start_at ?? device?.maintenanceStartAt);
  const maintenanceEnd = parseDate(device?.maintenance_end_at ?? device?.maintenanceEndAt);
  const current = parseDate(now) || serverNowDate();
  if (status === DEVICE_STATUS_DISABLED || status.includes("停用") || status.includes("禁用")) {
    return "disabled";
  }
  // 有计划时间边界时，状态字段不能覆盖该边界；甘特图必须按每个槽位的时刻判断。
  if (maintenanceStart) {
    if (maintenanceStart <= current && (!maintenanceEnd || current <= maintenanceEnd)) {
      return "maintenance";
    }
    if (maintenanceEnd && maintenanceEnd < current) {
      return status.includes("不可用") ? "unavailable" : "";
    }
    return status.includes("不可用") ? "unavailable" : "";
  }
  if (isActiveMaintenanceDeviceStatus(status)) {
    return "maintenance";
  }
  if (status.includes("不可用")) {
    return "unavailable";
  }
  return "";
};

const isDeviceUnavailableForSchedule = (device, now = serverNowDate()) => {
  return Boolean(resolveDeviceUnavailableReason(device, now));
};

const deviceMaintenanceOverlapsSchedule = (device, startAt, endAt, now = serverNowDate()) => {
  const maintenanceStart = parseDate(device?.maintenance_start_at ?? device?.maintenanceStartAt);
  const maintenanceEnd = parseDate(device?.maintenance_end_at ?? device?.maintenanceEndAt);
  if (isExpiredMaintenanceWindow(device, now)) {
    return false;
  }
  return Boolean(maintenanceStart && startAt && endAt && maintenanceStart < endAt && (!maintenanceEnd || maintenanceEnd > startAt));
};

const resolveDeviceScheduleBlockMessage = ({ device, endAt = null, now = serverNowDate(), startAt = null }) => {
  const reason = resolveDeviceUnavailableReason(device, now)
    || (deviceMaintenanceOverlapsSchedule(device, startAt, endAt, now) ? "maintenance" : "");
  if (reason === "disabled") {
    return "该设备已停用，不可排程";
  }
  if (reason === "maintenance") {
    return "该设备处于维修状态，不可排程";
  }
  if (reason === "unavailable") {
    return "该设备不可用，不可排程";
  }
  return "";
};

const resolveUnavailableSlotMeta = ({ device, deviceCode, endAt, now, startAt }) => {
  const name = normalizeText(deviceCode);
  const reason = (isExpiredMaintenanceWindow(device, now) ? "" : resolveDeviceUnavailableReason(device, startAt || now))
    || (deviceMaintenanceOverlapsSchedule(device, startAt, endAt, now) ? "maintenance" : "");
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
      label: "维修中",
      state: "maintenance",
      title: `${name}维修中，暂不可排程`,
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

const resolveMaintenanceConflictSlotMeta = ({ device, deviceCode, matchedSchedules = [], now, segmentEnd, segmentStart }) => {
  const hasMaintenanceConflict = matchedSchedules.some((schedule) => {
    const startAt = parseDate(schedule?.start_at);
    const endAt = parseDate(schedule?.end_at);
    return startAt && endAt
      && overlaps(startAt, endAt, segmentStart, segmentEnd)
      && deviceMaintenanceOverlapsSchedule(device, startAt, endAt, now);
  });
  if (!hasMaintenanceConflict) {
    return null;
  }
  const name = normalizeText(deviceCode);
  return {
    className: "gantt-slot conflict maintenance-conflict",
    label: "维修冲突",
    state: "maintenance-conflict",
    title: `${name}维修中，已有排程占用，请调整`,
  };
};

const slotIntervalIsVisible = ({ endAt, segmentEnd, segmentStart, startAt }) => {
  if (!startAt || !endAt || !segmentStart || !segmentEnd || segmentEnd <= segmentStart) {
    return false;
  }
  return startAt < segmentEnd && endAt > segmentStart;
};

const resolveScheduleMaintenanceSlotMeta = ({ device, deviceCode, matchedSchedules = [], now, segmentEnd, segmentStart }) => {
  if (matchedSchedules.length !== 1 || isExpiredMaintenanceWindow(device, now)) {
    return null;
  }
  const schedule = matchedSchedules[0];
  const scheduleStart = parseDate(schedule?.start_at);
  const scheduleEnd = parseDate(schedule?.end_at);
  const maintenanceStart = parseDate(device?.maintenance_start_at ?? device?.maintenanceStartAt);
  const maintenanceEnd = parseDate(device?.maintenance_end_at ?? device?.maintenanceEndAt);
  if (!scheduleStart || !scheduleEnd || !maintenanceStart || deviceMaintenanceOverlapsSchedule(device, scheduleStart, scheduleEnd, now)) {
    return null;
  }
  const taskIsVisible = slotIntervalIsVisible({
    endAt: scheduleEnd,
    segmentEnd,
    segmentStart,
    startAt: scheduleStart,
  });
  const maintenanceIsVisible = slotIntervalIsVisible({
    endAt: maintenanceEnd || segmentEnd,
    segmentEnd,
    segmentStart,
    startAt: maintenanceStart,
  });
  if (!taskIsVisible || !maintenanceIsVisible) {
    return null;
  }
  const taskCode = normalizeText(schedule?.task_code) || "任务";
  const maintenanceEndLabel = maintenanceEnd ? formatDateTime(maintenanceEnd) : "未设置结束时间";
  return {
    maintenance: {
      label: "维修中",
      title: `${normalizeText(deviceCode)}维修：${formatDateTime(maintenanceStart)} - ${maintenanceEndLabel}`,
    },
    task: {
      label: taskCode,
      title: `${taskCode}：${formatDateTime(scheduleStart)} - ${formatDateTime(scheduleEnd)}`,
    },
    timelineOrder: maintenanceStart < scheduleStart
      ? ["maintenance", "task"]
      : ["task", "maintenance"],
  };
};

const findDeviceRecord = (devices = [], deviceCode = "") =>
  (Array.isArray(devices) ? devices : []).find((device) => normalizeText(device?.code) === normalizeText(deviceCode));


export {
  AXIS_CODE_OPTIONS,
  AXIS_EXPERIMENT_TYPES,
  AXIS_LAB_LOCK_GROUPS,
  COMPLETED_TRAY_STATUSES,
  COMPLETED_SCHEDULE_STATUSES,
  DEVICE_STATUS_DISABLED,
  DEVICE_STATUS_REPAIR,
  DEVICE_STATUS_UPKEEP,
  STARTED_TRAY_STATUSES,
  STATUS_COMPLETED,
  STATUS_RETENTION,
  STATUS_RUNNING,
  STATUS_SCHEDULED,
  STATUS_WAITING,
  STREAMING_STATUS,
  buildActiveTaskContext,
  buildAxisExperimentLabel,
  buildExperimentCandidates,
  buildExperimentLabel,
  completedAxisCodesForExperiment,
  deriveAxisSubExperimentCode,
  experimentSupportsAxisScheduling,
  filterSchedulesForActiveTasks,
  findDeviceRecord,
  formatAxisLabel,
  isDeviceUnavailableForSchedule,
  isTerminalExperimentStatus,
  resolveAxisScheduleDeviceLock,
  resolveAxisScheduleLockContext,
  resolveDeviceScheduleBlockMessage,
  resolveDeviceUnavailableReason,
  resolveExperimentAxisCodes,
  resolveMaintenanceConflictSlotMeta,
  resolveNextAxisBatchNo,
  resolveScheduleMaintenanceSlotMeta,
  resolveScheduledAxisSelection,
  resolveSubExperimentCode,
  resolveUnavailableSlotMeta,
  scheduledAxisCodesForExperiment,
};
