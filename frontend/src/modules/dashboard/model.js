// 将持久化的总览数据整理成卡片、列表行和状态标签，供页面渲染使用。
const SOURCE_EXTERNAL = "外部委托";
const SOURCE_INTERNAL = "内部新增";
const STATUS_RUNNING = "任务进行中";
const EXPERIMENT_STATUS_RUNNING = "实验进行中";
const LEGACY_STATUS_RUNNING = "实验中";
const TASK_LEGACY_RUNNING = "任务进行中";
const STATUS_SCHEDULED = "已排程";
const STATUS_WAITING = "待排程";
const TRANSFER_STATUS_STORED = "已入库";
const STATUS_RETENTION = "厂家收回";
const STATUS_COMPLETED = "任务已完成";
const EXPERIMENT_STATUS_COMPLETED = "实验已完成";
const LEGACY_STATUS_COMPLETED = "实验完成";
const LEGACY_STATUS_COMPLETED_ALT = "实验已经完成";
const LEGACY_STATUS_RETENTION = "暂存间排放";
const LEGACY_STATUS_STORAGE = "暂存间存放";
const RETENTION_LOCATION = "暂存间";

// 总览页各类输入在进入统计逻辑前统一转成稳定字符串。
const normalizeText = (value) => String(value ?? "").trim();
// 带“暂存间”标识的设备会被视为留样暂存位置，而非正式实验室。
const isRetentionDevice = (value) => normalizeText(value).includes(RETENTION_LOCATION);
const OVERDUE_MS = 24 * 60 * 60 * 1000;
const isRunningStatus = (value) => {
  const normalized = normalizeText(value);
  return normalized === STATUS_RUNNING || normalized === TASK_LEGACY_RUNNING || normalized === EXPERIMENT_STATUS_RUNNING || normalized === LEGACY_STATUS_RUNNING;
};
// 兼容历史状态文案，保证统计口径一致。
const normalizeStatusLabel = (value) => {
  const normalized = normalizeText(value);
  if (normalized === EXPERIMENT_STATUS_RUNNING || normalized === LEGACY_STATUS_RUNNING || normalized === STATUS_RUNNING) {
    return STATUS_RUNNING;
  }
  if (normalized === EXPERIMENT_STATUS_COMPLETED || normalized === LEGACY_STATUS_COMPLETED || normalized === LEGACY_STATUS_COMPLETED_ALT || normalized === STATUS_COMPLETED) {
    return STATUS_COMPLETED;
  }
  if (normalized === LEGACY_STATUS_RETENTION || normalized === LEGACY_STATUS_STORAGE) {
    return STATUS_WAITING;
  }
  if (normalized === STATUS_RETENTION) {
    return STATUS_RETENTION;
  }
  return normalized;
};

// 时间比较统一使用时间戳，无法解析时返回 NaN 交由调用方兜底。
const parseTime = (value) => {
  const time = Date.parse(String(value || ""));
  return Number.isFinite(time) ? time : Number.NaN;
};

const isTaskStored = (task) => normalizeText(task?.transfer_status) === TRANSFER_STATUS_STORED;
const hasFormalScheduleForExperiment = (schedules, taskCode, experimentCode) =>
  (Array.isArray(schedules) ? schedules : []).some(
    (entry) =>
      !isRetentionDevice(entry?.device) &&
      normalizeText(entry?.task_code) === normalizeText(taskCode) &&
      normalizeText(entry?.experiment_code) === normalizeText(experimentCode),
  );

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
function resolveTaskStatus(task, schedules, now = Date.now()) {
  const taskCode = normalizeText(task?.code);
  const matchedSchedules = (Array.isArray(schedules) ? schedules : []).filter(
    (entry) => normalizeText(entry?.task_code) === taskCode
  );

  // 先判断是否存在当前正在执行的正式实验排程。
  const activeSchedule = matchedSchedules.find((entry) => {
    if (isRetentionDevice(entry?.device)) {
      return false;
    }
    const start = parseTime(entry?.start_at);
    const end = parseTime(entry?.end_at);
    return Number.isFinite(start) && Number.isFinite(end) && start <= now && end >= now;
  });
  if (activeSchedule) {
    return STATUS_RUNNING;
  }

  // 其次判断是否已经进入正式排程，但还没到执行时间。
  const scheduledEntry = matchedSchedules.find((entry) => !isRetentionDevice(entry?.device));
  if (scheduledEntry) {
    return STATUS_SCHEDULED;
  }

  // 再判断是否只存在暂存间记录。
  const retentionEntry = matchedSchedules.find((entry) => isRetentionDevice(entry?.device));
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
function computeDeviceStatus(device, schedules, now = Date.now()) {
  const deviceCode = normalizeText(device?.code);
  const matchedSchedules = (Array.isArray(schedules) ? schedules : []).filter(
    (entry) => normalizeText(entry?.device) === deviceCode
  );
  // 设备状态在总览区以“是否正被排程占用”为最高优先级。
  const activeSchedule = matchedSchedules.find((entry) => {
    const start = parseTime(entry?.start_at);
    const end = parseTime(entry?.end_at);
    return Number.isFinite(start) && Number.isFinite(end) && start <= now && end >= now;
  });
  if (activeSchedule) {
    return STATUS_RUNNING;
  }
  return normalizeText(device?.status) || "可用";
}

// 生成中控总览页组合函数直接消费的完整视图模型。
function buildDashboardViewModel({ tasks, schedules, devices, streams, experiments, now = Date.now() }) {
  const taskList = Array.isArray(tasks) ? tasks : [];
  const scheduleList = Array.isArray(schedules) ? schedules : [];
  const deviceList = Array.isArray(devices) ? devices : [];
  const streamList = Array.isArray(streams) ? streams : [];
  const experimentList = Array.isArray(experiments) ? experiments : [];
  const taskByCode = new Map(taskList.map((task) => [normalizeText(task?.code), task]));

  // 先补齐每条任务的展示态和样式，后面的统计全部基于统一后的任务集合。
  const normalizedTasks = taskList.map((task) => {
    const nextStatus = resolveTaskStatus(task, scheduleList, now);
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
      .filter((entry) => !isRetentionDevice(entry?.device))
      .map((entry) => normalizeText(entry?.task_code))
      .filter(Boolean),
  );
  const unscheduledCount = normalizedTasks.filter((task) => normalizeText(task?.displayStatus) === STATUS_WAITING).length;
  const runningExperimentCount = experimentList.filter((experiment) => {
    const normalized = normalizeText(experiment?.status);
    return normalized === EXPERIMENT_STATUS_RUNNING || normalized === LEGACY_STATUS_RUNNING;
  }).length;
  const scheduledCount = normalizedTasks.filter((task) => formalScheduledTaskCodes.has(normalizeText(task?.code))).length;
  const gapCount = streamList.filter((stream) => normalizeText(stream?.status).includes("缺口")).length;
  const averageQuality =
    streamList.length === 0
      ? 0
      : Math.round(
          (streamList.reduce((sum, stream) => sum + Number.parseFloat(stream?.quality || 0), 0) / streamList.length) * 10
        ) / 10;

  const taskRows = normalizedTasks.map((task, index) => ({
    // 任务列表只保留总览页需要的最小字段集合。
    code: normalizeText(task?.code) || "-",
    index: index + 1,
    source: normalizeText(task?.source) || "-",
    status: normalizeText(task?.displayStatus) || STATUS_WAITING,
    statusClass: task.statusClass,
  }));

  // 设备列表同样只输出页面摘要卡片会展示的标识和状态。
  const deviceItems = deviceList.map((device) => ({
    code: normalizeText(device?.code) || "-",
    status: computeDeviceStatus(device, scheduleList, now),
  }));

  const unscheduledExperimentItems = experimentList
    .map((experiment) => {
      const task = taskByCode.get(normalizeText(experiment?.task_code));
      if (!isTaskStored(task)) {
        return null;
      }
      if (hasFormalScheduleForExperiment(scheduleList, experiment?.task_code, experiment?.experiment_code)) {
        return null;
      }
      const startedAt = parseTime(experiment?.unscheduled_since);
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
