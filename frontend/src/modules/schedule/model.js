// 提供排程页所需的表单、看板行、甘特数据和增删改辅助函数。
import { getLabsForTestType, TEST_LABS, TEST_PREFIX_MAP } from "@/lib/labs.js";
import { collectExperimentTypes } from "@/lib/experimentTypes";
import { formatLocalDateTime } from "@/lib/dateTime";
import { filterActiveTasks } from "@/lib/taskArchive";
import { resolveLabRef, resolveScheduleLabCode, scheduleMatchesLab } from "@/lib/labIdentity";
import {
  RUNNING_SCHEDULE_DELETE_MESSAGE,
  RUNNING_SCHEDULE_RESCHEDULE_MESSAGE,
  scheduleExperimentHasStarted,
  scheduleHasPartialCompletedAxes,
} from "@/lib/runningExperimentGuards";
import { resolveTransferConfirmedAt } from "@/lib/transferArrivalTime";

const STATUS_WAITING = "待排程";
const STATUS_SCHEDULED = "已排程";
const STATUS_RUNNING = "实验进行中";
const STATUS_COMPLETED = "实验已完成";
const STATUS_RETENTION = "暂存间存放";
const DEVICE_STATUS_MAINTENANCE = "维护/校准";
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
import {
  RETENTION_DEVICE,
  RETENTION_KEYWORD,
  SLOT_RANGES,
  addDays,
  createId,
  formatDateTime,
  getSlotState,
  isRetentionDevice,
  normalizeText,
  overlaps,
  parseDate,
  toLocalDateValue,
  toLocalTimeValue,
} from "./sharedModel";
import {
  PLANNED_DURATION_MAX_DAYS,
  PLANNED_DURATION_MAX_HOURS,
  buildManualTimeSlotOptions,
  buildScheduleEditForm,
  buildScheduleRescheduleForm,
  createManualScheduleForm,
  createScheduleEditForm,
  isManualScheduleSelectionLegal,
  resolveLegalManualScheduleState,
  resolveScheduleTimes,
} from "./formModel";
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

const normalizeAxisCodes = (value) => {
  const rawValues = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.replace(/，/g, ",").split(",")
      : [];
  const seen = new Set();
  return rawValues
    .map((item) => normalizeText(item).toLowerCase())
    .filter((item) => {
      if (!item || seen.has(item)) {
        return false;
      }
      seen.add(item);
      return true;
    });
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

const resolveScheduledAxisCodes = ({ experimentCode, experiments = [], experimentRunSteps = [], form, schedules = [] }) => {
  const selection = resolveScheduledAxisSelection({ experimentCode, experiments, experimentRunSteps, form, schedules });
  return selection.axisCodes;
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

const SLOT_SEQUENCE = ["am", "pm"];
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
    const experimentCode = normalizeText(schedule?.experiment_code);
    const axisCodes = normalizeAxisCodes(schedule?.axis_codes ?? schedule?.axisCodes);
    const subExperimentCode = resolveSubExperimentCode(schedule);
    const groupKey = subExperimentCode || (axisCodes.length > 0 ? `${taskCode}::${experimentCode}::${axisCodes.join("/")}` : taskCode);
    const current = byTaskCode.get(groupKey);
    const startAt = parseDate(schedule?.start_at);
    const endAt = parseDate(schedule?.end_at);
    const stateMeta = getSlotState({ startAt, endAt, now });
    if (!current) {
      const experimentLabel = buildAxisExperimentLabel(
        experimentNameByCode?.get(experimentCode) || buildExperimentLabel(experimentCode),
        axisCodes,
      );
      const timeRange = formatScheduleWindow(schedule?.start_at, schedule?.end_at);
      const nextItem = {
        color: resolveTaskColor(taskCode),
        experimentLabel,
        scheduleId: normalizeText(schedule?.id),
        scheduleIds: [normalizeText(schedule?.id)].filter(Boolean),
        state: stateMeta.state,
        subExperimentCode,
        sub_experiment_code: subExperimentCode,
        taskCode,
        timeRange,
        title: `${taskCode} / ${experimentLabel || "-"} / ${timeRange}`.trim(),
      };
      byTaskCode.set(groupKey, nextItem);
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

const mergeUniqueTextList = (values) => {
  const seen = new Set();
  return (Array.isArray(values) ? values : [])
    .map(normalizeText)
    .filter((value) => {
      if (!value || seen.has(value)) {
        return false;
      }
      seen.add(value);
      return true;
    });
};

const mergeGanttItems = (leftItems = [], rightItems = []) => {
  const result = [];
  const seen = new Set();
  [...(Array.isArray(leftItems) ? leftItems : []), ...(Array.isArray(rightItems) ? rightItems : [])].forEach((item) => {
    const itemScheduleIds = Array.isArray(item?.scheduleIds) ? item.scheduleIds : [item?.scheduleId].filter(Boolean);
    const key = itemScheduleIds.join("\u0001") || normalizeText(item?.title);
    if (!key || seen.has(key)) {
      return;
    }
    seen.add(key);
    result.push(item);
  });
  return result;
};

const collectGanttScheduleIds = (items = []) =>
  mergeUniqueTextList((Array.isArray(items) ? items : []).flatMap((item) =>
    Array.isArray(item?.scheduleIds) ? item.scheduleIds : [item?.scheduleId],
  ));

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
  if (COMPLETED_SCHEDULE_STATUSES.has(normalizeText(schedule?.status ?? schedule?.schedule_status))) {
    return {
      completed: true,
      started: true,
    };
  }

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
      const subExperimentCode = resolveSubExperimentCode(schedule);
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
        axisLabel: normalizeAxisCodes(schedule?.axis_codes ?? schedule?.axisCodes).map(formatAxisLabel).join(" / "),
        device: normalizeText(schedule?.device),
        endAt: formatDateTime(schedule?.end_at),
        axisCodes: normalizeAxisCodes(schedule?.axis_codes ?? schedule?.axisCodes),
        experimentCode,
        experimentLabel: experimentNameByCode.get(experimentCode) || buildExperimentLabel(experimentCode),
        id: normalizeText(schedule?.id),
        rowStatus: status,
        rowStatusClass: statusClass(status),
        startAt: formatDateTime(schedule?.start_at),
        subExperimentCode,
        sub_experiment_code: subExperimentCode,
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
            allItems: items,
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
            allItems: items,
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
          allItems: items,
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
      // 空闲类槽位可折叠；同一条排程跨多个半天槽位也可延展，但不同排程不合并。
      const signature = slot.state === "idle" || slot.state === "maintenance" || slot.state === "disabled"
        ? `${slot.state}:${slot.label}:${slot.title}`
        : slot.state === "conflict" || slot.state === "stacked" || slot.state === "split"
          ? `${slot.state}:${slot.key}`
          : `${slot.label}:${slot.className}`;
      const previous = segments[segments.length - 1];
      const canMergeSlot =
        slot.state === "idle"
        || slot.state === "maintenance"
        || slot.state === "disabled"
        || (
          slot.displayMode === "single"
          && previous?.displayMode === "single"
          && normalizeText(slot.scheduleId)
          && normalizeText(slot.scheduleId) === normalizeText(previous.scheduleId)
        );
      if (canMergeSlot && previous && previous.signature == signature) {
        previous.colspan += 1;
        previous.allItems = mergeGanttItems(previous.allItems, slot.allItems || slot.items);
        previous.items = mergeGanttItems(previous.items, slot.items);
        previous.scheduleIds = collectGanttScheduleIds(previous.allItems);
        previous.title = previous.allItems.map((item) => item.title).filter(Boolean).join("\n");
        return;
      }
      const allItems = slot.allItems || slot.items;
      const scheduleIds = collectGanttScheduleIds(allItems);
      segments.push({
        className: slot.className,
        allItems,
        colspan: 1,
        displayMode: slot.displayMode,
        items: slot.items,
        key: `${slot.key}-segment`,
        label: slot.label,
        overflowCount: slot.overflowCount,
        scheduleId: slot.scheduleId,
        scheduleIds,
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
function buildManualTaskOptions({ tasks, experiments, experimentTrays, experimentRunSteps = [], samples, schedules }) {
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
              experimentRunSteps,
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

function buildExperimentOptions({ taskCode, experiments, experimentRunSteps = [], schedules, tasks, samples = [] }) {
  const { activeTasks, activeTaskCodes } = buildActiveTaskContext(tasks, samples);
  const taskList = Array.isArray(tasks) && tasks.length > 0 ? activeTasks : tasks;
  const normalizedTaskCode = normalizeText(taskCode);
  if (activeTaskCodes && normalizedTaskCode && !activeTaskCodes.has(normalizedTaskCode)) {
    return [];
  }
  const activeSchedules = filterSchedulesForActiveTasks({ schedules, tasks, samples });
  const seenLabels = new Set();
  return buildExperimentCandidates({ taskCode, experiments, tasks: taskList })
    .map((experiment) => {
      const experimentCode = normalizeText(experiment?.experiment_code);
      const experimentTerminal = isTerminalExperimentStatus(experiment?.status ?? experiment?.experiment_status);
      const axisCodes = resolveExperimentAxisCodes(experiment);
      const scheduledAxisCodes = scheduledAxisCodesForExperiment({ experimentCode, schedules: activeSchedules });
      const completedAxisCodes = completedAxisCodesForExperiment({
        experimentCode,
        experimentRunSteps,
        taskCode: normalizeText(experiment?.task_code),
      });
      const unavailableAxisCodes = new Set([...scheduledAxisCodes, ...completedAxisCodes]);
      const remainingAxisCodes = axisCodes.filter((axisCode) => !unavailableAxisCodes.has(axisCode));
      const matchingFormalSchedules = activeSchedules.filter(
        (schedule) =>
          !isRetentionDevice(schedule) &&
          normalizeText(schedule?.experiment_code) === experimentCode,
      );
      const hasFormalSchedule = matchingFormalSchedules.length > 0;
      const hasAxisFormalSchedule = matchingFormalSchedules.some(
        (schedule) => normalizeAxisCodes(schedule?.axis_codes ?? schedule?.axisCodes).length > 0,
      );
      const axisExperimentComplete =
        experimentSupportsAxisScheduling(experiment) &&
        axisCodes.length > 0 &&
        remainingAxisCodes.length === 0 &&
        completedAxisCodes.length >= axisCodes.length;
      return {
        experiment,
        axisCodes,
        scheduledAxisCodes,
        completedAxisCodes,
        remainingAxisCodes,
        hiddenByExperimentStatus: experimentTerminal,
        hiddenByCompletedAxes: axisExperimentComplete,
        hiddenBySchedule:
          hasFormalSchedule &&
          (!experimentSupportsAxisScheduling(experiment) || !hasAxisFormalSchedule || remainingAxisCodes.length === 0),
      };
    })
    .filter((entry) => !entry.hiddenByExperimentStatus && !entry.hiddenBySchedule && !entry.hiddenByCompletedAxes)
    .map((entry) => {
      const experiment = entry.experiment;
      const experimentCode = normalizeText(experiment?.experiment_code);
      const typeLabel = resolveExperimentTypeLabel(experiment) || experimentCode;
      const option = {
        code: experimentCode,
        fullCode: experimentCode,
        label: typeLabel,
        requiredDevice: normalizeText(experiment?.required_device) || typeLabel,
        taskCode: normalizeText(experiment?.task_code),
      };
      if (
        entry.axisCodes.length > 0 ||
        entry.scheduledAxisCodes.length > 0 ||
        entry.completedAxisCodes.length > 0 ||
        entry.remainingAxisCodes.length > 0
      ) {
        option.axisCodes = entry.axisCodes;
        option.scheduledAxisCodes = entry.scheduledAxisCodes;
        option.completedAxisCodes = entry.completedAxisCodes;
        option.remainingAxisCodes = entry.remainingAxisCodes;
      }
      option.supportsAxisScheduling = experimentSupportsAxisScheduling(experiment);
      return option;
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

function createScheduleRecord({
  devices = [],
  experiments,
  experimentRunSteps = [],
  form,
  tasks,
  schedules,
  streams,
  now = new Date(),
  samples = [],
  experimentTrays = [],
}) {
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
  const initialDeviceBlockMessage = isRetentionDevice(device)
    ? ""
    : resolveDeviceScheduleBlockMessage({
        device: deviceRecord,
        endAt: resolved.endAt,
        now,
        startAt: resolved.startAt,
      });
  if (initialDeviceBlockMessage) {
    return { error: initialDeviceBlockMessage };
  }

  const axisSelection = resolveScheduledAxisSelection({
    experimentCode: form?.experiment_code,
    experiments,
    experimentRunSteps,
    form,
    schedules,
  });
  if (axisSelection.error) {
    return { error: axisSelection.error };
  }
  const selectedAxisCodes = axisSelection.axisCodes;
  const axisScheduleLock = resolveAxisScheduleLockContext({
    experimentCode: form?.experiment_code,
    experiments,
    form,
    schedules,
  });
  if (axisScheduleLock.device && device !== axisScheduleLock.device) {
    return { error: `后续${axisScheduleLock.label}轴向需沿用${axisScheduleLock.device}` };
  }
  const explicitAxisBatchNo = normalizeText(form?.axis_batch_no ?? form?.axisBatchNo);
  const axisBatchNo = explicitAxisBatchNo || (selectedAxisCodes.length > 0
    ? resolveNextAxisBatchNo({
      experimentCode: form?.experiment_code,
      schedules,
      taskCode,
    })
    : "");
  const subExperimentCode = resolveSubExperimentCode(form) || deriveAxisSubExperimentCode(form?.experiment_code, axisBatchNo);
  const candidate = {
    device,
    end_at: formatLocalDateTime(resolved.endAt),
    experiment_code: normalizeText(form?.experiment_code),
    lab_code: normalizeText(form?.lab_code ?? form?.labCode),
    lab_id: form?.lab_id ?? form?.labId ?? "",
    planned_hours: resolved.plannedHours,
    start_at: formatLocalDateTime(resolved.startAt),
    sub_experiment_code: subExperimentCode,
    task_code: taskCode,
  };
  if (selectedAxisCodes.length > 0) {
    candidate.axis_codes = selectedAxisCodes;
  }
  if (axisBatchNo) {
    candidate.axis_batch_no = axisBatchNo;
  }

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
    retentionSchedule.sub_experiment_code = candidate.sub_experiment_code;
    retentionSchedule.status = STATUS_SCHEDULED;
    if (candidate.axis_codes) {
      retentionSchedule.axis_codes = candidate.axis_codes;
    } else {
      delete retentionSchedule.axis_codes;
    }
    if (candidate.axis_batch_no) {
      retentionSchedule.axis_batch_no = candidate.axis_batch_no;
    } else {
      delete retentionSchedule.axis_batch_no;
    }
    if (!candidate.sub_experiment_code) {
      delete retentionSchedule.sub_experiment_code;
    }
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

function updateScheduleRecord({
  devices = [],
  experiments,
  experimentRuns = [],
  experimentRunTrays = [],
  experimentTrays = [],
  form,
  tasks,
  schedules,
  streams,
  now = new Date(),
  samples = [],
}) {
  const scheduleId = normalizeText(form?.id);
  const nextSchedules = Array.isArray(schedules) ? schedules.map((schedule) => ({ ...schedule })) : [];
  const target = nextSchedules.find((schedule) => normalizeText(schedule?.id) === scheduleId);
  if (!target) {
    return { error: "未找到排程记录" };
  }
  if (
    scheduleExperimentHasStarted({
      experimentRuns,
      experimentRunTrays,
      experimentTrays,
      samples,
      schedule: target,
    })
  ) {
    return { error: RUNNING_SCHEDULE_RESCHEDULE_MESSAGE };
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
    sub_experiment_code: resolveSubExperimentCode(form),
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
  target.sub_experiment_code = candidate.sub_experiment_code;
  target.status = isRetentionDevice(device) ? STATUS_RETENTION : STATUS_SCHEDULED;
  if (!candidate.sub_experiment_code) {
    delete target.sub_experiment_code;
  }

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

function deleteScheduleRecord({
  experimentRuns = [],
  experimentRunSteps = [],
  experimentRunTrays = [],
  experimentTrays = [],
  experiments,
  samples = [],
  scheduleId,
  tasks,
  schedules,
  streams,
  now = new Date(),
}) {
  const removedSchedule = (Array.isArray(schedules) ? schedules : []).find(
    (schedule) => normalizeText(schedule?.id) === normalizeText(scheduleId),
  );
  if (
    scheduleExperimentHasStarted({
      experimentRuns,
      experimentRunTrays,
      experimentTrays,
      samples,
      schedule: removedSchedule,
    }) &&
    !scheduleHasPartialCompletedAxes({
      experimentRuns,
      experimentRunSteps,
      schedule: removedSchedule,
    })
  ) {
    return {
      error: RUNNING_SCHEDULE_DELETE_MESSAGE,
      experiments: Array.isArray(experiments) ? experiments.map((experiment) => ({ ...experiment })) : [],
      schedules: Array.isArray(schedules) ? schedules.map((schedule) => ({ ...schedule })) : [],
      streams: Array.isArray(streams) ? streams.map((stream) => ({ ...stream })) : [],
      tasks: Array.isArray(tasks) ? tasks.map((task) => ({ ...task })) : [],
    };
  }
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
  AXIS_CODE_OPTIONS,
  RETENTION_DEVICE,
  PLANNED_DURATION_MAX_DAYS,
  PLANNED_DURATION_MAX_HOURS,
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
  resolveAxisScheduleDeviceLock,
  resolveTaskStatus,
  isManualScheduleSelectionLegal,
  updateScheduleRecord,
  resolveDeviceUnavailableReason,
};
