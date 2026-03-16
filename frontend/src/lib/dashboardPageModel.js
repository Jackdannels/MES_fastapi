const SOURCE_EXTERNAL = "外部委托";
const SOURCE_INTERNAL = "内部新增";
const STATUS_RUNNING = "实验中";
const STATUS_SCHEDULED = "已排程";
const STATUS_RETENTION = "暂存间存放";
const STATUS_WAITING = "待排程";
const RETENTION_LOCATION = "暂存间";

const normalizeText = (value) => String(value ?? "").trim();

const parseTime = (value) => {
  const time = Date.parse(String(value || ""));
  return Number.isFinite(time) ? time : Number.NaN;
};

const statusClass = (value) => {
  const normalized = normalizeText(value);
  if (normalized === STATUS_RUNNING) {
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

function resolveTaskStatus(task, schedules, now = Date.now()) {
  const taskCode = normalizeText(task?.code);
  const matchedSchedules = (Array.isArray(schedules) ? schedules : []).filter(
    (entry) => normalizeText(entry?.task_code) === taskCode
  );

  const activeSchedule = matchedSchedules.find((entry) => {
    const start = parseTime(entry?.start_at);
    const end = parseTime(entry?.end_at);
    return Number.isFinite(start) && Number.isFinite(end) && start <= now && end >= now;
  });
  if (activeSchedule) {
    return STATUS_RUNNING;
  }

  const scheduledEntry = matchedSchedules.find((entry) => normalizeText(entry?.device) !== RETENTION_LOCATION);
  if (scheduledEntry) {
    return STATUS_SCHEDULED;
  }

  const rawStatus = normalizeText(task?.status);
  if (rawStatus) {
    return rawStatus;
  }

  return STATUS_WAITING;
}

function computeDeviceStatus(device, schedules, now = Date.now()) {
  const deviceCode = normalizeText(device?.code);
  const matchedSchedules = (Array.isArray(schedules) ? schedules : []).filter(
    (entry) => normalizeText(entry?.device) === deviceCode
  );
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

function buildDashboardViewModel({ tasks, schedules, devices, streams, now = Date.now() }) {
  const taskList = Array.isArray(tasks) ? tasks : [];
  const scheduleList = Array.isArray(schedules) ? schedules : [];
  const deviceList = Array.isArray(devices) ? devices : [];
  const streamList = Array.isArray(streams) ? streams : [];

  const normalizedTasks = taskList.map((task) => {
    const nextStatus = resolveTaskStatus(task, scheduleList, now);
    return {
      ...task,
      displayStatus: nextStatus,
      statusClass: statusClass(nextStatus),
    };
  });

  const externalCount = normalizedTasks.filter((task) => normalizeText(task?.source) === SOURCE_EXTERNAL).length;
  const internalCount = normalizedTasks.filter((task) => normalizeText(task?.source) === SOURCE_INTERNAL).length;
  const retentionCount = normalizedTasks.filter((task) => normalizeText(task?.displayStatus) === STATUS_RETENTION).length;
  const unscheduledCount = normalizedTasks.filter(
    (task) =>
      ![STATUS_RUNNING, STATUS_SCHEDULED].includes(normalizeText(task?.displayStatus))
  ).length;
  const runningTaskCount = normalizedTasks.filter((task) => normalizeText(task?.displayStatus) === STATUS_RUNNING).length;
  const scheduledCount = scheduleList.filter((entry) => normalizeText(entry?.device) !== RETENTION_LOCATION).length;
  const gapCount = streamList.filter((stream) => normalizeText(stream?.status).includes("缺口")).length;
  const averageQuality =
    streamList.length === 0
      ? 0
      : Math.round(
          (streamList.reduce((sum, stream) => sum + Number.parseFloat(stream?.quality || 0), 0) / streamList.length) * 10
        ) / 10;

  const taskRows = normalizedTasks.map((task, index) => ({
    code: normalizeText(task?.code) || "-",
    index: index + 1,
    source: normalizeText(task?.source) || "-",
    status: normalizeText(task?.displayStatus) || STATUS_WAITING,
    statusClass: task.statusClass,
  }));

  const deviceItems = deviceList.map((device) => ({
    code: normalizeText(device?.code) || "-",
    status: computeDeviceStatus(device, scheduleList, now),
  }));

  return {
    dataGap: gapCount > 0 ? "已记录缺口" : "暂无缺口",
    dataHealth: `${Number.isNaN(averageQuality) ? 0 : averageQuality}%`,
    deviceItems,
    summaryCards: {
      alertCount: gapCount,
      alertNote: gapCount > 0 ? "存在数据缺口" : "无预警",
      deviceCount: runningTaskCount,
      deviceNote: "实验中任务",
      intakeCount: normalizedTasks.length,
      intakeNote: `外部 ${externalCount} / 内部 ${internalCount}`,
      scheduledCount,
      unscheduledCount: `${unscheduledCount}（暂存间存放${retentionCount}）`,
    },
    taskRows,
  };
}

export { buildDashboardViewModel };
