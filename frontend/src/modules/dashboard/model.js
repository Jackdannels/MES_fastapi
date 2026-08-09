// 将持久化的总览数据整理成卡片、列表行和状态标签，供页面渲染使用。
import { withRequiredLabDevices } from "@/lib/deviceLedger";
import { serverNowMs } from "@/lib/serverClock";
import { isScheduleExperimentRunning } from "@/modules/devices/model";
import { labIdentityMatches, scheduleMatchesLab, scheduleTargetsStorageArea } from "@/lib/labIdentity";
import { resolveTransferConfirmedAt } from "@/lib/transferArrivalTime";
import {
  EXPERIMENT_STATUS_COMPLETED,
  EXPERIMENT_STATUS_RUNNING,
  RETURNED_STATUS as STATUS_RETENTION,
  TASK_STATUS_RUNNING as STATUS_RUNNING,
  TASK_STATUS_WAITING as STATUS_WAITING,
  TRANSFER_STATUS_ARRIVED,
  isTransferArrivedStatus,
  normalizeTaskStatusLabel,
} from "@/lib/statusNormalization";

const SOURCE_EXTERNAL = "外部委托";
const SOURCE_INTERNAL = "内部新增";
const LEGACY_STATUS_RUNNING = "实验中";
const STATUS_SCHEDULED = "已排程";
const DEVICE_STATUS_AVAILABLE = "可用";
const DEVICE_STATUS_WORKING = "工作中";
const DEVICE_STATUS_REPAIR = "维修";
const DEVICE_STATUS_CARE = "保养";
const RUNNING_EXPERIMENT_RUN_STATUSES = new Set([EXPERIMENT_STATUS_RUNNING, LEGACY_STATUS_RUNNING]);
const LEGACY_STATUS_COMPLETED = "实验完成";
const LEGACY_STATUS_COMPLETED_ALT = "实验已经完成";
const ARRIVED_OR_LATER_SAMPLE_STATUSES = new Set([
  TRANSFER_STATUS_ARRIVED,
  "送至实验室",
  "实验准备就绪",
  EXPERIMENT_STATUS_RUNNING,
  LEGACY_STATUS_RUNNING,
  EXPERIMENT_STATUS_COMPLETED,
  LEGACY_STATUS_COMPLETED,
  LEGACY_STATUS_COMPLETED_ALT,
  "实验后暂存间存放",
  "已到达暂存间",
]);

// 总览页各类输入在进入统计逻辑前统一转成稳定字符串。
const normalizeText = (value) => String(value ?? "").trim();
const compareTaskCodes = (left, right) =>
  normalizeText(left).localeCompare(normalizeText(right), "zh-Hans-CN", { numeric: true });
// 带“暂存间”标识的设备会被视为留样暂存位置，而非正式实验室。
const isRetentionSchedule = (schedule) => scheduleTargetsStorageArea(schedule);
const OVERDUE_MS = 24 * 60 * 60 * 1000;
const isRunningStatus = (value) => {
  const normalized = normalizeText(value);
  return normalized === STATUS_RUNNING || normalized === EXPERIMENT_STATUS_RUNNING || normalized === LEGACY_STATUS_RUNNING;
};
// 兼容历史状态文案，保证统计口径一致。
const normalizeStatusLabel = normalizeTaskStatusLabel;

const isArrivedOrLaterSampleStatus = (value) => ARRIVED_OR_LATER_SAMPLE_STATUSES.has(normalizeStatusLabel(value)) || ARRIVED_OR_LATER_SAMPLE_STATUSES.has(normalizeText(value));
const isTaskStoredBySamples = (taskSamples) => {
  const samples = Array.isArray(taskSamples) ? taskSamples : [];
  if (samples.length === 0) {
    return false;
  }
  return samples.every((sample) => {
    if (isArrivedOrLaterSampleStatus(sample?.status) || isArrivedOrLaterSampleStatus(sample?.flow_status)) {
      return true;
    }
    const trays = Array.isArray(sample?.trays) ? sample.trays : [];
    return trays.length > 0 && trays.every((tray) => isArrivedOrLaterSampleStatus(tray?.status));
  });
};
const isTaskStored = (task, taskSamples = []) =>
  isTransferArrivedStatus(task?.transfer_status) ||
  isTaskStoredBySamples(taskSamples);
const isReturnedTaskRecord = (task, schedules) => {
  const taskCode = normalizeText(task?.code);
  const explicitReturned =
    normalizeText(task?.transfer_status) === STATUS_RETENTION ||
    normalizeStatusLabel(task?.status) === STATUS_RETENTION ||
    normalizeStatusLabel(task?.displayStatus) === STATUS_RETENTION ||
    normalizeStatusLabel(task?.display_status) === STATUS_RETENTION;
  if (!explicitReturned) {
    return false;
  }
  return !(Array.isArray(schedules) ? schedules : []).some(
    (entry) => normalizeText(entry?.task_code) === taskCode && isRetentionSchedule(entry),
  );
};
const trayIsReturned = (tray) => normalizeStatusLabel(tray?.status) === STATUS_RETENTION;
const collectReturnedTaskCodesFromSamples = (samples) => {
  const trayReturnStatsByTaskCode = new Map();
  (Array.isArray(samples) ? samples : []).forEach((sample) => {
    const taskCode = normalizeText(sample?.task_code);
    if (!taskCode) {
      return;
    }
    const trays = Array.isArray(sample?.trays) ? sample.trays : [];
    trays.forEach((tray) => {
      const stats = trayReturnStatsByTaskCode.get(taskCode) || { returned: 0, total: 0 };
      stats.total += 1;
      if (trayIsReturned(tray)) {
        stats.returned += 1;
      }
      trayReturnStatsByTaskCode.set(taskCode, stats);
    });
  });

  return [...trayReturnStatsByTaskCode.entries()]
    .filter(([, stats]) => stats.total > 0 && stats.returned === stats.total)
    .map(([taskCode]) => taskCode);
};
const hasFormalScheduleForExperiment = (schedules, taskCode, experimentCode) =>
  (Array.isArray(schedules) ? schedules : []).some(
    (entry) =>
      !isRetentionSchedule(entry) &&
      normalizeText(entry?.task_code) === normalizeText(taskCode) &&
      normalizeText(entry?.experiment_code) === normalizeText(experimentCode),
  );
const isExperimentRunning = (experiment) => {
  const normalized = normalizeText(experiment?.status);
  return normalized === EXPERIMENT_STATUS_RUNNING || normalized === LEGACY_STATUS_RUNNING;
};
const scheduleMatchesExperiment = (schedule, experiment) => {
  if (normalizeText(schedule?.task_code) !== normalizeText(experiment?.task_code)) {
    return false;
  }
  const scheduleExperimentCode = normalizeText(schedule?.experiment_code);
  if (!scheduleExperimentCode) {
    return true;
  }
  return scheduleExperimentCode === normalizeText(experiment?.experiment_code);
};
const hasRunningExperimentForSchedule = (schedule, experiments) =>
  (Array.isArray(experiments) ? experiments : []).some(
    (experiment) => isExperimentRunning(experiment) && scheduleMatchesExperiment(schedule, experiment),
  );
const makeExperimentKey = (taskCode, experimentCode) => `${normalizeText(taskCode)}::${normalizeText(experimentCode)}`;
const buildPendingExceptionExperimentKeys = (conflicts) => {
  const keys = new Set();
  (Array.isArray(conflicts) ? conflicts : []).forEach((conflict) => {
    if (normalizeText(conflict?.status) !== "pending") {
      return;
    }
    const taskCode = normalizeText(conflict?.task_code);
    const experimentCode = normalizeText(conflict?.experiment_code);
    if (!taskCode || !experimentCode) {
      return;
    }
    keys.add(makeExperimentKey(taskCode, experimentCode));
  });
  return keys;
};

const formatElapsedDuration = (elapsedMs) => {
  const safeElapsed = Math.max(0, Math.floor(elapsedMs / 1000));
  const hours = String(Math.floor(safeElapsed / 3600)).padStart(2, "0");
  const minutes = String(Math.floor((safeElapsed % 3600) / 60)).padStart(2, "0");
  const seconds = String(safeElapsed % 60).padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
};

// 总览卡片与表格共用一套状态到样式类的映射。
const statusClass = (value) => {
  const normalized = normalizeText(value);
  if (isRunningStatus(normalized)) {
    return "status running";
  }
  if (normalized === STATUS_SCHEDULED) {
    return "status scheduled";
  }
  if (normalized === STATUS_RETENTION) {
    return "status retention";
  }
  if (normalized.includes("缺口")) {
    return "status warn";
  }
  return "status";
};

// 根据任务数据和当前排程推导总览卡片上的任务状态。
function resolveTaskStatus(task, schedules, experiments) {
  const taskCode = normalizeText(task?.code);
  const matchedSchedules = (Array.isArray(schedules) ? schedules : []).filter(
    (entry) => normalizeText(entry?.task_code) === taskCode
  );

  // 先判断正式排程关联的实验是否已经真实开始，避免只因时间窗命中而误判为运行中。
  const runningSchedule = matchedSchedules.find(
    (entry) => !isRetentionSchedule(entry) && hasRunningExperimentForSchedule(entry, experiments),
  );
  if (runningSchedule) {
    return STATUS_RUNNING;
  }

  // 其次判断是否已经进入正式排程，但还没到执行时间。
  const scheduledEntry = matchedSchedules.find((entry) => !isRetentionSchedule(entry));
  if (scheduledEntry) {
    return STATUS_SCHEDULED;
  }

  // 再判断是否只存在暂存间记录。
  const retentionEntry = matchedSchedules.find((entry) => isRetentionSchedule(entry));
  if (retentionEntry) {
    return STATUS_WAITING;
  }

  const rawStatus = normalizeStatusLabel(task?.status);
  if (rawStatus) {
    return rawStatus;
  }

  return STATUS_WAITING;
}

// 推导设备汇总区当前显示的设备状态标签。
function buildRunByNo(experimentRuns) {
  const runByNo = new Map();
  (Array.isArray(experimentRuns) ? experimentRuns : []).forEach((run) => {
    const runNo = normalizeText(run?.run_no) || normalizeText(run?.id);
    if (runNo) {
      runByNo.set(runNo, run);
    }
  });
  return runByNo;
}

function runTrayIsRunning(relation) {
  return RUNNING_EXPERIMENT_RUN_STATUSES.has(normalizeText(relation?.run_tray_status || relation?.runTrayStatus || relation?.status));
}

function resolveTimedDeviceStatus(device, now) {
  const status = normalizeDeviceStatus(device?.status);
  const startAt = Date.parse(String(device?.maintenance_start_at ?? device?.maintenanceStartAt ?? ""));
  const endAt = Date.parse(String(device?.maintenance_end_at ?? device?.maintenanceEndAt ?? ""));
  const current = Number.isFinite(Number(now)) ? Number(now) : Date.parse(String(now ?? ""));
  if (!Number.isFinite(startAt) || !Number.isFinite(current)) {
    return status;
  }
  if (current < startAt || (Number.isFinite(endAt) && current > endAt)) {
    return [DEVICE_STATUS_REPAIR, DEVICE_STATUS_CARE].includes(status) ? DEVICE_STATUS_AVAILABLE : status;
  }
  return normalizeText(device?.maintenance_type ?? device?.maintenanceType).includes("保养")
    ? DEVICE_STATUS_CARE
    : DEVICE_STATUS_REPAIR;
}

function computeDeviceStatus(device, schedules, samples, experimentTrays, experimentRuns, experimentRunTrays = [], returnedTaskCodes = new Set(), now = serverNowMs()) {
  const experimentRunList = Array.isArray(experimentRuns) ? experimentRuns : [];
  const experimentRunTrayList = Array.isArray(experimentRunTrays) ? experimentRunTrays : [];
  const runByNo = buildRunByNo(experimentRunList);
  const runningRunTray = experimentRunTrayList.find((relation) => {
    const run = runByNo.get(normalizeText(relation?.run_no) || normalizeText(relation?.runNo));
    return run
      && labIdentityMatches(run, device)
      && runTrayIsRunning(relation)
      && !returnedTaskCodes.has(normalizeText(relation?.task_code || run?.task_code));
  });
  if (runningRunTray) {
    return DEVICE_STATUS_WORKING;
  }
  const runningRun = experimentRunList.find(
    (run) =>
      labIdentityMatches(run, device)
      && RUNNING_EXPERIMENT_RUN_STATUSES.has(normalizeText(run?.status))
      && !returnedTaskCodes.has(normalizeText(run?.task_code)),
  );
  if (runningRun) {
    return DEVICE_STATUS_WORKING;
  }
  if (experimentRunList.length > 0) {
    return resolveTimedDeviceStatus(device, now);
  }
  const matchedSchedules = (Array.isArray(schedules) ? schedules : []).filter(
    (entry) => scheduleMatchesLab(entry, device)
  );
  // 设备状态必须落到真实运行托盘，不能只按排程或实验主状态推导。
  const runningSchedule = matchedSchedules.find(
    (entry) =>
      !returnedTaskCodes.has(normalizeText(entry?.task_code)) &&
      isScheduleExperimentRunning(entry, device, samples, experimentTrays),
  );
  if (runningSchedule) {
    return DEVICE_STATUS_WORKING;
  }
  return resolveTimedDeviceStatus(device, now);
}

function normalizeDeviceStatus(status) {
  const normalized = normalizeText(status);
  if (normalized === DEVICE_STATUS_WORKING || normalized === "使用中") {
    return DEVICE_STATUS_WORKING;
  }
  if (normalized.includes(DEVICE_STATUS_CARE)) {
    return DEVICE_STATUS_CARE;
  }
  if (
    normalized.includes(DEVICE_STATUS_REPAIR)
    || normalized.includes("故障")
    || normalized.includes("停用")
    || normalized.includes("禁用")
  ) {
    return DEVICE_STATUS_REPAIR;
  }
  return DEVICE_STATUS_AVAILABLE;
}

function resolveDeviceDotClass(status) {
  const normalized = normalizeText(status);
  if (normalized === DEVICE_STATUS_WORKING) {
    return "timeline-dot--running";
  }
  if (normalized === DEVICE_STATUS_AVAILABLE) {
    return "timeline-dot--available";
  }
  if (normalized === DEVICE_STATUS_REPAIR) {
    return "timeline-dot--repair";
  }
  if (normalized === DEVICE_STATUS_CARE) {
    return "timeline-dot--care";
  }
  return "timeline-dot--available";
}

// 生成中控总览页组合函数直接消费的完整视图模型。
function buildDashboardViewModel({ tasks, schedules, devices, streams, experiments, experimentRuns, experimentRunTrays, samples, experimentTrays, conflicts, now = serverNowMs() }) {
  const sampleList = Array.isArray(samples) ? samples : [];
  const returnedTaskCodes = new Set(
    [
      ...(Array.isArray(tasks) ? tasks : [])
        .filter((task) => isReturnedTaskRecord(task, schedules))
        .map((task) => normalizeText(task?.code)),
      ...collectReturnedTaskCodesFromSamples(sampleList),
    ].filter(Boolean),
  );
  const taskList = (Array.isArray(tasks) ? tasks : []).filter((task) => !returnedTaskCodes.has(normalizeText(task?.code)));
  const scheduleList = Array.isArray(schedules) ? schedules : [];
  const deviceList = withRequiredLabDevices(devices);
  const streamList = Array.isArray(streams) ? streams : [];
  const experimentList = Array.isArray(experiments) ? experiments : [];
  const activeExperimentList = experimentList.filter((experiment) => !returnedTaskCodes.has(normalizeText(experiment?.task_code)));
  const experimentTrayList = Array.isArray(experimentTrays) ? experimentTrays : [];
  const experimentRunList = Array.isArray(experimentRuns) ? experimentRuns : [];
  const experimentRunTrayList = Array.isArray(experimentRunTrays) ? experimentRunTrays : [];
  const pendingExceptionExperimentKeys = buildPendingExceptionExperimentKeys(conflicts);
  const taskByCode = new Map(taskList.map((task) => [normalizeText(task?.code), task]));
  const samplesByTaskCode = new Map();
  sampleList.forEach((sample) => {
    const taskCode = normalizeText(sample?.task_code);
    if (!taskCode) {
      return;
    }
    samplesByTaskCode.set(taskCode, [...(samplesByTaskCode.get(taskCode) || []), sample]);
  });

  // 先补齐每条任务的展示态和样式，后面的统计全部基于统一后的任务集合。
  const normalizedTasks = taskList.map((task) => {
    const nextStatus = resolveTaskStatus(task, scheduleList, activeExperimentList);
    return {
      ...task,
      displayStatus: nextStatus,
      statusClass: statusClass(nextStatus),
    };
  });

  // 任务来源、暂存、排程和数据健康指标都在这里集中计算，页面只负责展示。
  const externalCount = normalizedTasks.filter((task) => normalizeText(task?.source) === SOURCE_EXTERNAL).length;
  const internalCount = normalizedTasks.filter((task) => normalizeText(task?.source) === SOURCE_INTERNAL).length;
  const formalScheduledTaskCodes = new Set(
    scheduleList
      .filter((entry) => !isRetentionSchedule(entry))
      .map((entry) => normalizeText(entry?.task_code))
      .filter(Boolean),
  );
  const unscheduledCount = normalizedTasks.filter((task) => normalizeText(task?.displayStatus) === STATUS_WAITING).length;
  const runningExperimentKeysFromRunTrays = new Set(
    experimentRunTrayList
      .filter((relation) => runTrayIsRunning(relation) && !returnedTaskCodes.has(normalizeText(relation?.task_code)))
      .map((relation) => `${normalizeText(relation?.task_code)}::${normalizeText(relation?.experiment_code)}`)
      .filter((key) => key !== "::"),
  );
  const experimentKeysWithRunTrays = new Set(
    experimentRunTrayList
      .map((relation) => `${normalizeText(relation?.task_code)}::${normalizeText(relation?.experiment_code)}`)
      .filter((key) => key !== "::"),
  );
  const runningExperimentCount = activeExperimentList.filter((experiment) => {
    const key = `${normalizeText(experiment?.task_code)}::${normalizeText(experiment?.experiment_code)}`;
    return runningExperimentKeysFromRunTrays.has(key) || (!experimentKeysWithRunTrays.has(key) && isExperimentRunning(experiment));
  }).length;
  const scheduledCount = normalizedTasks.filter((task) => formalScheduledTaskCodes.has(normalizeText(task?.code))).length;
  const gapCount = streamList.filter((stream) => normalizeText(stream?.status).includes("缺口")).length;
  const taskRows = normalizedTasks
    .map((task, index) => ({
      // 任务列表只保留总览页需要的最小字段集合。
      code: normalizeText(task?.code) || "-",
      index: index + 1,
      source: normalizeText(task?.source) || "-",
      status: normalizeText(task?.displayStatus) || STATUS_WAITING,
      statusClass: task.statusClass,
    }))
    .sort((left, right) => compareTaskCodes(left.code, right.code));

  // 设备列表同样只输出页面摘要卡片会展示的标识和状态。
  const deviceItems = deviceList.map((device) => {
    const deviceStatus = computeDeviceStatus(device, scheduleList, sampleList, experimentTrayList, experimentRunList, experimentRunTrayList, returnedTaskCodes, now);
    return {
      code: normalizeText(device?.code) || "-",
      dotClass: resolveDeviceDotClass(deviceStatus),
      status: deviceStatus,
    };
  });

  const unscheduledExperimentItems = activeExperimentList
    .map((experiment) => {
      const taskCode = normalizeText(experiment?.task_code);
      const experimentCode = normalizeText(experiment?.experiment_code);
      const task = taskByCode.get(taskCode);
      const confirmedAt = resolveTransferConfirmedAt({ samples: samplesByTaskCode.get(taskCode), task });
      const hasPendingException = pendingExceptionExperimentKeys.has(makeExperimentKey(taskCode, experimentCode));
      if (!hasPendingException && !confirmedAt && !isTaskStored(task, samplesByTaskCode.get(taskCode))) {
        return null;
      }
      if (hasFormalScheduleForExperiment(scheduleList, experiment?.task_code, experiment?.experiment_code)) {
        return null;
      }
      // dashboard 使用精简样品投影时不会携带入库历史；排程异常恢复为待排程后，
      // 以实验记录中持久化的未排程起点兜底，避免计时项被错误过滤。
      const persistedUnscheduledAt = Date.parse(normalizeText(experiment?.unscheduled_since));
      const startedAt = confirmedAt?.getTime() ?? persistedUnscheduledAt;
      if (!Number.isFinite(startedAt)) {
        return null;
      }

      const elapsedMs = Math.max(0, now - startedAt);
      return {
        elapsedLabel: formatElapsedDuration(elapsedMs),
        experimentCode: normalizeText(experiment?.experiment_code) || "-",
        experimentLabel: normalizeText(experiment?.experiment_name) || normalizeText(experiment?.experiment_code) || "-",
        isOverdue: elapsedMs > OVERDUE_MS,
        taskCode: normalizeText(experiment?.task_code) || "-",
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.taskCode.localeCompare(right.taskCode, "zh-Hans-CN"));

  return {
    deviceItems,
    summaryCards: {
      alertCount: gapCount,
      alertNote: gapCount > 0 ? "存在数据缺口" : "无预警",
      deviceCount: runningExperimentCount,
      intakeCount: normalizedTasks.length,
      intakeNote: `外部 ${externalCount} / 内部 ${internalCount}`,
      scheduledCount,
      unscheduledCount,
    },
    taskRows,
    unscheduledExperimentItems,
  };
}

export { buildDashboardViewModel };
