import { buildTrayFlowView, synchronizeSamplesForTrayCodes } from "@/modules/samples/samplesFlowModel";
import {
  STATUS_COMPLETED,
  STATUS_RETENTION,
  STATUS_RUNNING,
  STATUS_SCHEDULED,
  STATUS_WAITING,
} from "@/modules/tasks/model";

const SALT_SPRAY_LAB = "盐雾试验室";
const LAB_COMPARE_STATUS = "已到达实验室";
const LAB_INSTALL_STATUS = "工装夹具安装";
const LAB_READY_STATUS = "实验准备就绪";
const LAB_RESET_STATUS = "送至实验室";
const PRE_DISPATCH_FALLBACK_LOCATION = "恒温恒湿间（暂存间）";
const PRE_DISPATCH_FALLBACK_STATUS = "已到达暂存间";
const PRE_DISPATCH_STATUSES = new Set(["到货", "已接收", "送至暂存间", "已到达暂存间"]);
const RUNNING_EXPERIMENT_STATUSES = new Set(["实验进行中", "实验中"]);
const LABORATORY_TASK_FLOW_STEPS = [
  { key: "waiting", label: STATUS_WAITING },
  { key: "scheduled", label: STATUS_SCHEDULED },
  { key: "running", label: STATUS_RUNNING },
  { key: "completed", label: STATUS_COMPLETED },
  { key: "returned", label: STATUS_RETENTION },
];
const LABORATORY_TASK_FLOW_INDEX = new Map(LABORATORY_TASK_FLOW_STEPS.map((step, index) => [step.label, index]));
const COMPLETED_EXPERIMENT_STATUSES = new Set(["实验已完成", "实验已经完成", "实验完成"]);
const COMPLETED_TRAY_STATUSES = new Set(["实验已完成", "实验已经完成", "实验完成", "放置实验后暂存间", "厂家收回"]);

const normalizeText = (value) => String(value ?? "").trim();
const asArray = (value) => (Array.isArray(value) ? value : []);

const toTime = (value) => {
  const time = Date.parse(String(value || ""));
  return Number.isFinite(time) ? time : null;
};

const formatTime = (value) => {
  const time = toTime(value);
  if (!Number.isFinite(time)) {
    return "-";
  }
  const date = new Date(time);
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
};

const formatDateKey = (value) => {
  const time = value instanceof Date ? value.getTime() : toTime(value);
  if (!Number.isFinite(time)) {
    return "";
  }
  const date = new Date(time);
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const formatDateTime = (value) => {
  const time = toTime(value);
  if (!Number.isFinite(time)) {
    return "-";
  }
  const date = new Date(time);
  return `${formatDateKey(date)} ${formatTime(date)}`;
};

const formatDuration = (totalSeconds) => {
  const safeSeconds = Math.max(0, Number(totalSeconds) || 0);
  const hours = String(Math.floor(safeSeconds / 3600)).padStart(2, "0");
  const minutes = String(Math.floor((safeSeconds % 3600) / 60)).padStart(2, "0");
  const seconds = String(Math.floor(safeSeconds % 60)).padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
};

const uniqueValues = (values = []) => {
  const seen = new Set();
  return asArray(values).filter((value) => {
    const normalized = normalizeText(value);
    if (!normalized || seen.has(normalized)) {
      return false;
    }
    seen.add(normalized);
    return true;
  });
};

const buildLaboratoryHistoryEntry = (sample, action, status, detail, now) => {
  const history = Array.isArray(sample?.history) ? sample.history.slice() : [];
  history.unshift({
    action,
    detail,
    id: `laboratory-event-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    location: normalizeText(sample?.location) || SALT_SPRAY_LAB,
    owner: normalizeText(sample?.owner),
    status,
    time: now,
  });
  return history;
};

const resolvePreDispatchLocation = (status, location = "") => {
  const normalizedLocation = normalizeText(location);
  if (normalizedLocation) {
    return normalizedLocation;
  }
  const normalizedStatus = normalizeText(status);
  if (normalizedStatus === "到货" || normalizedStatus === "已接收") {
    return "接驳区";
  }
  return PRE_DISPATCH_FALLBACK_LOCATION;
};

const resolvePreDispatchStatusFromLocation = (location) => {
  const normalizedLocation = normalizeText(location);
  if (normalizedLocation === PRE_DISPATCH_FALLBACK_LOCATION) {
    return PRE_DISPATCH_FALLBACK_STATUS;
  }
  if (normalizedLocation === "接驳区" || normalizedLocation === "室外接驳区") {
    return "到货";
  }
  return "";
};

const resolvePreDispatchSnapshot = (sample) => {
  const history = asArray(sample?.history);
  for (const entry of history) {
    const status = normalizeText(entry?.status);
    const location = normalizeText(entry?.location);
    if (PRE_DISPATCH_STATUSES.has(status)) {
      return {
        location: resolvePreDispatchLocation(status, location),
        status,
      };
    }
    const statusFromLocation = resolvePreDispatchStatusFromLocation(location);
    if (statusFromLocation) {
      return {
        location,
        status: statusFromLocation,
      };
    }
  }
  return {
    location: PRE_DISPATCH_FALLBACK_LOCATION,
    status: PRE_DISPATCH_FALLBACK_STATUS,
  };
};

const shouldRevertLaboratoryTrayStatus = (status) => {
  const normalized = normalizeText(status);
  const rank = resolveLaboratoryStatusRank(normalized);
  return normalized === LAB_RESET_STATUS || (rank >= 1 && rank < 4);
};

const resolveLaboratoryStatusRank = (value) => {
  const normalized = normalizeText(value);
  if (normalized === LAB_COMPARE_STATUS) {
    return 1;
  }
  if (normalized === LAB_INSTALL_STATUS) {
    return 2;
  }
  if (normalized === LAB_READY_STATUS) {
    return 3;
  }
  if (normalized === "实验进行中" || normalized === "实验中") {
    return 4;
  }
  if (normalized === "实验已完成" || normalized === "放置实验后暂存间" || normalized === "厂家收回") {
    return 5;
  }
  return 0;
};

const isFixtureReady = (value) => {
  if (value === true) {
    return true;
  }
  const normalized = normalizeText(value).toLowerCase();
  return ["1", "true", "yes", "ready", "fixture_ready", "夹具安装完成"].includes(normalized);
};

const buildBlockedComparisonResult = (trayCode, status) => {
  const normalizedTrayCode = normalizeText(trayCode);
  const normalizedStatus = normalizeText(status);
  if (normalizedStatus === "实验已完成" || normalizedStatus === "实验完成" || normalizedStatus === "放置实验后暂存间" || normalizedStatus === "厂家收回") {
    return {
      guidance: `${normalizedTrayCode} 已完成实验，无需再次比对。`,
      message: "托盘已完成实验",
      ok: false,
      tone: "error",
      trayCode: normalizedTrayCode,
    };
  }
  if (normalizedStatus === "实验进行中" || normalizedStatus === "实验中") {
    return {
      guidance: `${normalizedTrayCode} 当前实验正在进行中，不能再次比对。`,
      message: "托盘实验进行中",
      ok: false,
      tone: "error",
      trayCode: normalizedTrayCode,
    };
  }
  return {
    guidance: `${normalizedTrayCode} 当前状态为${normalizedStatus || "已比对"}，已完成任务比对，无需再次比对。`,
    message: "托盘已完成比对",
    ok: false,
    tone: "error",
    trayCode: normalizedTrayCode,
  };
};

const buildTaskMap = (tasks) => {
  const taskMap = new Map();
  asArray(tasks).forEach((task) => {
    const code = normalizeText(task?.code);
    if (code) {
      taskMap.set(code, task);
    }
  });
  return taskMap;
};

const buildExperimentMap = (experiments) => {
  const experimentMap = new Map();
  asArray(experiments).forEach((experiment) => {
    const taskCode = normalizeText(experiment?.task_code);
    const experimentCode = normalizeText(experiment?.experiment_code);
    if (taskCode && experimentCode) {
      experimentMap.set(`${taskCode}::${experimentCode}`, normalizeText(experiment?.experiment_name));
    }
  });
  return experimentMap;
};

const findExperimentRecord = ({ experiments, experimentCode, taskCode }) =>
  asArray(experiments).find(
    (experiment) =>
      normalizeText(experiment?.task_code) === normalizeText(taskCode)
      && normalizeText(experiment?.experiment_code) === normalizeText(experimentCode),
  ) || null;

const buildSampleMap = (samples) => {
  const sampleMap = new Map();
  asArray(samples).forEach((sample) => {
    const taskCode = normalizeText(sample?.task_code);
    if (!taskCode) {
      return;
    }
    const current = sampleMap.get(taskCode) || [];
    current.push(sample);
    sampleMap.set(taskCode, current);
  });
  return sampleMap;
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

const buildNotDispatchedComparisonResult = (trayCode, tray = null) => {
  const normalizedTrayCode = normalizeText(trayCode);
  const location = normalizeText(tray?.currentLocation || tray?.location);
  const status = normalizeText(tray?.trayStatus || tray?.displayStatus);
  const sourceLabel = location.includes("暂存间") || status.includes("暂存间") ? "暂存间" : "接驳间";
  return {
    guidance: `请先在${sourceLabel}完成出库并送至实验室。`,
    message: "托盘尚未出库",
    ok: false,
    tone: "error",
    trayCode: normalizedTrayCode,
  };
};

const buildScheduleTrayCodeSet = ({ experimentTrays, experimentCode, taskCode }) =>
  new Set(
    asArray(experimentTrays)
      .filter(
        (entry) =>
          normalizeText(entry?.task_code) === normalizeText(taskCode)
          && normalizeText(entry?.experiment_code) === normalizeText(experimentCode),
      )
      .map((entry) => normalizeText(entry?.tray_code))
      .filter(Boolean),
  );

const buildTrayExperimentCodeMap = (experimentTrays) => {
  const trayMap = new Map();
  asArray(experimentTrays).forEach((entry) => {
    const trayCode = normalizeText(entry?.tray_code);
    const experimentCode = normalizeText(entry?.experiment_code);
    if (!trayCode || !experimentCode) {
      return;
    }
    const current = trayMap.get(trayCode) || new Set();
    current.add(experimentCode);
    trayMap.set(trayCode, current);
  });
  return trayMap;
};

const collectScheduleSamples = ({ experimentTrays, samples, schedule }) => {
  const taskCode = normalizeText(schedule?.task_code);
  const experimentCode = normalizeText(schedule?.experiment_code);
  const scopedTrayCodes = buildScheduleTrayCodeSet({ experimentTrays, experimentCode, taskCode });
  const matchedSamples = asArray(samples).filter((sample) => {
    if (normalizeText(sample?.task_code) !== taskCode) {
      return false;
    }
    if (!scopedTrayCodes.size) {
      return true;
    }
    return asArray(sample?.trays).some((tray) => scopedTrayCodes.has(normalizeText(tray?.tray_code)));
  });

  return {
    matchedSamples,
    scopedTrayCodes,
    taskCode,
  };
};

const scheduleExperimentIsCompleted = ({ experiments, experimentTrays, samples, schedule }) => {
  const taskCode = normalizeText(schedule?.task_code);
  const experimentCode = normalizeText(schedule?.experiment_code);
  if (!taskCode) {
    return false;
  }

  const experiment = findExperimentRecord({ experiments, experimentCode, taskCode });
  if (COMPLETED_EXPERIMENT_STATUSES.has(normalizeText(experiment?.status))) {
    return true;
  }

  const { matchedSamples, scopedTrayCodes } = collectScheduleSamples({ experimentTrays, samples, schedule });
  if (matchedSamples.length === 0) {
    return false;
  }

  const experimentName = normalizeText(experiment?.experiment_name);
  if (experimentName) {
    const latestHistoryBySample = new Map();
    matchedSamples.forEach((sample) => {
      const sampleCode = normalizeText(sample?.code);
      if (!sampleCode) {
        return;
      }
      asArray(sample?.history).forEach((entry) => {
        const parsed = parseExperimentHistoryDetail(entry?.detail, taskCode);
        if (!parsed || parsed.experimentName !== experimentName) {
          return;
        }
        const eventTime = toTime(entry?.time) || 0;
        const existing = latestHistoryBySample.get(sampleCode);
        if (!existing || eventTime >= existing.time) {
          latestHistoryBySample.set(sampleCode, { status: parsed.status, time: eventTime });
        }
      });
    });

    if (latestHistoryBySample.size > 0) {
      const historyStatuses = Array.from(latestHistoryBySample.values()).map((entry) => entry.status);
      return latestHistoryBySample.size === matchedSamples.length
        && historyStatuses.every((status) => COMPLETED_TRAY_STATUSES.has(status));
    }
  }

  const trayExperimentCodeMap = buildTrayExperimentCodeMap(experimentTrays);
  const hasSharedScopedTray = Array.from(scopedTrayCodes).some((trayCode) => (trayExperimentCodeMap.get(trayCode)?.size || 0) > 1);
  if (hasSharedScopedTray) {
    return false;
  }

  const statuses = [];
  matchedSamples.forEach((sample) => {
    const sampleTrays = asArray(sample?.trays);
    if (!sampleTrays.length && !scopedTrayCodes.size) {
      const sampleStatus = normalizeText(sample?.status);
      if (sampleStatus) {
        statuses.push(sampleStatus);
      }
      return;
    }
    sampleTrays.forEach((tray) => {
      const trayCode = normalizeText(tray?.tray_code);
      if (scopedTrayCodes.size && !scopedTrayCodes.has(trayCode)) {
        return;
      }
      const status = normalizeText(tray?.status) || normalizeText(sample?.status);
      if (status) {
        statuses.push(status);
      }
    });
  });

  return statuses.length > 0 && statuses.every((status) => COMPLETED_TRAY_STATUSES.has(status));
};

const buildLaboratoryTaskFlow = (status = STATUS_WAITING) => {
  const currentStatus = LABORATORY_TASK_FLOW_INDEX.has(status) ? status : STATUS_WAITING;
  const activeIndex = LABORATORY_TASK_FLOW_INDEX.get(currentStatus) ?? 0;
  return {
    currentStatus,
    steps: LABORATORY_TASK_FLOW_STEPS.map((step, index) => ({
      ...step,
      active: index === activeIndex,
      reached: index <= activeIndex,
    })),
  };
};

const resolveLaboratoryTaskStatus = (currentTask) => {
  if (!currentTask) {
    return STATUS_WAITING;
  }
  const trayStatuses = asArray(currentTask?.trayRows)
    .map((row) => normalizeText(row?.trayStatus) || normalizeText(row?.displayStatus))
    .filter(Boolean);
  if (trayStatuses.some((status) => RUNNING_EXPERIMENT_STATUSES.has(status))) {
    return STATUS_RUNNING;
  }
  return STATUS_SCHEDULED;
};

const buildRunningExperimentView = ({ currentTask, now }) => {
  const runningTrayRows = asArray(currentTask?.trayRows).filter((row) => normalizeText(row?.trayStatus) === "实验进行中");
  if (!currentTask || !runningTrayRows.length) {
    return {
      active: false,
      countdownLabel: "",
      endDateTimeLabel: "-",
      endTime: null,
      experimentName: "",
      overdue: false,
      overdueLabel: "",
      remainingSeconds: 0,
      sampleCodes: [],
      startDateTimeLabel: "-",
      startTime: null,
      taskCode: "",
      trayCodes: [],
      trayRows: [],
    };
  }

  const nowTime = now instanceof Date ? now.getTime() : toTime(now);
  const startTime = toTime(currentTask?.startAt);
  const endTime = toTime(currentTask?.endAt);
  const remainingSeconds = Number.isFinite(endTime) && Number.isFinite(nowTime) ? Math.floor((endTime - nowTime) / 1000) : 0;
  const overdueSeconds = remainingSeconds < 0 ? Math.abs(remainingSeconds) : 0;

  return {
    active: true,
    countdownLabel: remainingSeconds >= 0 ? formatDuration(remainingSeconds) : `已超时 ${formatDuration(overdueSeconds)}`,
    endDateTimeLabel: formatDateTime(currentTask?.endAt),
    endTime,
    experimentName: normalizeText(currentTask?.experimentName),
    overdue: remainingSeconds < 0,
    overdueLabel: overdueSeconds ? formatDuration(overdueSeconds) : "",
    remainingSeconds,
    sampleCodes: uniqueValues(runningTrayRows.flatMap((row) => asArray(row?.sampleCodes))),
    startDateTimeLabel: formatDateTime(currentTask?.startAt),
    startTime,
    taskCode: normalizeText(currentTask?.taskCode),
    trayCodes: runningTrayRows.map((row) => row.trayCode),
    trayRows: runningTrayRows,
  };
};

const buildExperimentTrayCodeMap = (experimentTrays) => {
  const trayMap = new Map();
  asArray(experimentTrays).forEach((entry) => {
    const taskCode = normalizeText(entry?.task_code);
    const experimentCode = normalizeText(entry?.experiment_code);
    const trayCode = normalizeText(entry?.tray_code);
    if (!taskCode || !experimentCode || !trayCode) {
      return;
    }
    const key = `${taskCode}::${experimentCode}`;
    const current = trayMap.get(key) || [];
    if (!current.includes(trayCode)) {
      current.push(trayCode);
    }
    trayMap.set(key, current);
  });
  return trayMap;
};

const collectTrayRows = ({ experimentTrayCodeMap, experimentKey, relatedSamples }) => {
  const trayRows = [];
  const indexByTrayCode = new Map();

  const pushRow = (trayCode, sampleCode = "", quantity = "", owner = "", location = "", fixtureReady = false) => {
    const normalizedTrayCode = normalizeText(trayCode);
    if (!normalizedTrayCode) {
      return;
    }
    const existingIndex = indexByTrayCode.get(normalizedTrayCode);
    if (existingIndex !== undefined) {
      const current = trayRows[existingIndex];
      if (sampleCode && !current.sampleCodes.includes(sampleCode)) {
        current.sampleCodes.push(sampleCode);
      }
      if (!current.owner && owner) {
        current.owner = owner;
      }
      if (!current.quantity && quantity) {
        current.quantity = quantity;
      }
      if (!current.currentLocation && location) {
        current.currentLocation = location;
      }
      current.fixtureReady = current.fixtureReady || isFixtureReady(fixtureReady);
      return;
    }
    indexByTrayCode.set(normalizedTrayCode, trayRows.length);
    trayRows.push({
      currentLocation: normalizeText(location),
      displayStatus: "",
      owner: normalizeText(owner),
      quantity: quantity || "",
      sampleCodes: sampleCode ? [sampleCode] : [],
      fixtureReady: isFixtureReady(fixtureReady),
      trayStatus: "",
      trayCode: normalizedTrayCode,
    });
  };

  const scopedTrayCodes = experimentTrayCodeMap.get(experimentKey) || [];
  scopedTrayCodes.forEach((trayCode) => pushRow(trayCode));

  asArray(relatedSamples).forEach((sample) => {
    const sampleCode = normalizeText(sample?.code);
    const owner = normalizeText(sample?.owner);
    const location = normalizeText(sample?.location);
    asArray(sample?.trays).forEach((tray) => {
      const trayCode = normalizeText(tray?.tray_code);
      const quantity = tray?.quantity ?? "";
      if (scopedTrayCodes.length > 0 && !scopedTrayCodes.includes(trayCode)) {
        return;
      }
      pushRow(trayCode, sampleCode, quantity, owner, location, tray?.fixtureReady ?? tray?.fixture_ready);
      const row = trayRows[indexByTrayCode.get(trayCode)];
      const currentRank = resolveLaboratoryStatusRank(row?.trayStatus);
      const nextStatus = normalizeText(tray?.status);
      if (resolveLaboratoryStatusRank(nextStatus) >= currentRank) {
        row.trayStatus = nextStatus;
      }
      const displayStatusCandidate = nextStatus || normalizeText(sample?.status);
      const currentDisplayRank = resolveLaboratoryStatusRank(row?.displayStatus);
      if (resolveLaboratoryStatusRank(displayStatusCandidate) >= currentDisplayRank) {
        row.displayStatus = displayStatusCandidate;
      }
    });
  });

  return trayRows;
};

const buildLaboratoryScheduleRow = ({ experimentMap, experimentTrayCodeMap, sampleMap, schedule, taskMap }) => {
  const taskCode = normalizeText(schedule?.task_code);
  const experimentCode = normalizeText(schedule?.experiment_code);
  const task = taskMap.get(taskCode) || null;
  const relatedSamples = sampleMap.get(taskCode) || [];
  const experimentKey = `${taskCode}::${experimentCode}`;
  const trayRows = collectTrayRows({ experimentTrayCodeMap, experimentKey, relatedSamples });
  const owner = normalizeText(relatedSamples[0]?.owner) || "-";
  const experimentName =
    normalizeText(experimentMap.get(experimentKey))
    || normalizeText(task?.test_type)
    || normalizeText(task?.name)
    || "-";
  const startAt = String(schedule?.start_at || "");
  const endAt = String(schedule?.end_at || "");

  return {
    device: normalizeText(schedule?.device) || SALT_SPRAY_LAB,
    endAt,
    endTimeLabel: formatTime(endAt),
    experimentCode,
    experimentKey,
    experimentName,
    id: normalizeText(schedule?.id) || `${taskCode}-${experimentCode}-${startAt}`,
    owner,
    sampleCount: trayRows.reduce((count, row) => count + Math.max(1, row.sampleCodes.length || 0), 0) || relatedSamples.length,
    startAt,
    startDateTimeLabel: formatDateTime(startAt),
    startTimeLabel: formatTime(startAt),
    taskCode,
    taskName: normalizeText(task?.name) || taskCode || "-",
    dateTimeRange: `${formatDateTime(startAt)} - ${formatDateTime(endAt)}`,
    timeRange: `${formatTime(startAt)} - ${formatTime(endAt)}`,
    title: `${taskCode} / ${experimentName} / ${formatDateTime(startAt)} - ${formatDateTime(endAt)}`,
    trayCodes: trayRows.map((row) => row.trayCode),
    trayRows,
    endDateTimeLabel: formatDateTime(endAt),
  };
};

function buildLaboratoryWorkbenchView({
  tasks = [],
  schedules = [],
  experiments = [],
  experimentTrays = [],
  samples = [],
  now = new Date(),
  selectedTaskCode = "",
  selectedTrayCode = "",
  labName = SALT_SPRAY_LAB,
}) {
  const taskMap = buildTaskMap(tasks);
  const experimentMap = buildExperimentMap(experiments);
  const sampleMap = buildSampleMap(samples);
  const experimentTrayCodeMap = buildExperimentTrayCodeMap(experimentTrays);
  const rowBuilderInput = { experimentMap, experimentTrayCodeMap, sampleMap, taskMap };

  const activeSchedules = asArray(schedules).filter(
    (schedule) => !scheduleExperimentIsCompleted({ experiments, experimentTrays, samples, schedule }),
  );
  const allScheduleRows = activeSchedules
    .map((schedule) => buildLaboratoryScheduleRow({ ...rowBuilderInput, schedule }))
    .sort((left, right) => (toTime(left.startAt) || 0) - (toTime(right.startAt) || 0));

  const scheduleRows = allScheduleRows.filter((row) => row.device === labName);
  const nowTime = now instanceof Date ? now.getTime() : toTime(now);
  const defaultTask =
    scheduleRows.find((row) => {
      const start = toTime(row.startAt);
      const end = toTime(row.endAt);
      return Number.isFinite(start) && Number.isFinite(end) && start <= nowTime && end >= nowTime;
    })
    || scheduleRows.find((row) => {
      const start = toTime(row.startAt);
      return Number.isFinite(start) && start > nowTime;
    })
    || scheduleRows[0]
    || null;

  const selectedKey = normalizeText(selectedTaskCode);
  const selectedTask =
    scheduleRows.find((row) => normalizeText(row.experimentKey) === selectedKey || normalizeText(row.id) === selectedKey)
    || scheduleRows.find((row) => row.taskCode === selectedKey)
    || null;
  const currentTask = selectedTask || defaultTask;
  const currentExperimentTrayRows = asArray(currentTask?.trayRows);
  const selectedTrayRow =
    currentExperimentTrayRows.find((row) => row.trayCode === normalizeText(selectedTrayCode))
    || currentExperimentTrayRows[0]
    || null;
  const currentTaskStatus = resolveLaboratoryTaskStatus(currentTask);
  const currentTaskFlow = buildLaboratoryTaskFlow(currentTaskStatus);
  const selectedTrayFlow = selectedTrayRow
    ? buildTrayFlowView({
        currentExperimentCode: normalizeText(currentTask?.experimentCode),
        experimentTrays,
        experiments,
        location: normalizeText(selectedTrayRow?.currentLocation),
        samples,
        schedules,
        status: normalizeText(selectedTrayRow?.displayStatus) || normalizeText(selectedTrayRow?.trayStatus),
        taskCode: normalizeText(currentTask?.taskCode),
        trayCode: normalizeText(selectedTrayRow?.trayCode),
      })
    : buildTrayFlowView();
  const runningExperiment = buildRunningExperimentView({
    currentTask,
    now: now instanceof Date ? now : new Date(nowTime || Date.now()),
  });

  return {
    allScheduleRows,
    currentTask,
    currentTaskFlow,
    currentTaskStatus,
    currentExperimentTrayRows,
    defaultTask,
    labName,
    runningExperiment,
    scheduleRows,
    selectedTrayFlow,
    selectedTrayRow,
  };
}

function buildLaboratorySummary(scheduleRows = [], now = new Date()) {
  const todayKey = formatDateKey(now);
  const nowTime = now instanceof Date ? now.getTime() : toTime(now);
  const todayRows = asArray(scheduleRows).filter((row) => formatDateKey(row?.startAt) === todayKey);
  return {
    todayPendingCount: todayRows.length,
    todayUndoneCount: todayRows.filter((row) => {
      const end = toTime(row?.endAt);
      return Number.isFinite(end) && end < nowTime;
    }).length,
  };
}

function createLaboratoryWorkflow() {
  return {
    comparisonDone: false,
    experimentConfirmed: false,
    fixtureReadyDone: false,
    hasCompared: false,
    hasInstalled: false,
    installationDone: false,
  };
}

function buildLaboratoryWorkflowFromTask(task) {
  const trayRows = asArray(task?.trayRows);
  const trayRanks = trayRows.map((row) => resolveLaboratoryStatusRank(row?.trayStatus));
  const installedWaitingReadyRows = trayRows.filter((row) => resolveLaboratoryStatusRank(row?.trayStatus) === 2);
  const hasCompared = trayRanks.some((rank) => rank >= 1);
  const comparisonDone = trayRanks.length > 0 && trayRanks.every((rank) => rank >= 1);
  const hasInstalled = trayRanks.some((rank) => rank >= 2 && rank < 5);
  const installationDone = trayRanks.length > 0 && trayRanks.every((rank) => rank >= 2);
  const experimentConfirmed = trayRanks.length > 0 && trayRanks.every((rank) => rank >= 3);
  const fixtureReadyDone =
    installedWaitingReadyRows.length > 0 && installedWaitingReadyRows.every((row) => row?.fixtureReady === true);
  const workflow = {
    comparisonDone,
    experimentConfirmed,
    hasCompared,
    hasInstalled,
    installationDone,
  };
  Object.defineProperties(workflow, {
    fixtureReadyDone: {
      value: fixtureReadyDone,
    },
    hasComparedWaitingInstall: {
      value: trayRanks.some((rank) => rank === 1),
    },
    hasInstalledWaitingReady: {
      value: trayRanks.some((rank) => rank === 2),
    },
    hasInProgressPreparation: {
      value: trayRanks.some((rank) => rank >= 2 && rank < 5),
    },
  });
  return workflow;
}

function getLaboratoryActionState(workflow = createLaboratoryWorkflow()) {
  if (workflow.experimentConfirmed) {
    return {
      canCompare: false,
      canInstallSample: false,
      canMarkReady: false,
    };
  }
  const hasComparedWaitingInstall = Object.prototype.hasOwnProperty.call(workflow, "hasComparedWaitingInstall")
    ? workflow.hasComparedWaitingInstall
    : !workflow.hasInstalled && (workflow.hasCompared || workflow.comparisonDone) && !workflow.installationDone;
  const hasInstalledWaitingReady = Object.prototype.hasOwnProperty.call(workflow, "hasInstalledWaitingReady")
    ? workflow.hasInstalledWaitingReady
    : (workflow.hasInstalled || workflow.installationDone) && !workflow.experimentConfirmed;
  const hasInProgressPreparation = Object.prototype.hasOwnProperty.call(workflow, "hasInProgressPreparation")
    ? workflow.hasInProgressPreparation
    : Boolean(workflow.hasInstalled);
  const fixtureReadyDone = Object.prototype.hasOwnProperty.call(workflow, "fixtureReadyDone")
    ? workflow.fixtureReadyDone
    : false;
  return {
    canCompare: !workflow.comparisonDone && !hasInProgressPreparation,
    canInstallSample: Boolean(hasComparedWaitingInstall),
    canMarkReady: Boolean(hasInstalledWaitingReady && fixtureReadyDone),
  };
}

const buildSaltSprayLaboratoryView = buildLaboratoryWorkbenchView;

function completeLaboratoryComparison(workflow = createLaboratoryWorkflow()) {
  return {
    ...workflow,
    comparisonDone: true,
    experimentConfirmed: false,
    hasCompared: true,
    hasInstalled: false,
    installationDone: false,
  };
}

function completeLaboratoryInstallation(workflow = createLaboratoryWorkflow()) {
  if (!(workflow.hasCompared || workflow.comparisonDone)) {
    return { ...workflow };
  }
  return {
    ...workflow,
    hasCompared: true,
    hasInstalled: true,
    installationDone: true,
    fixtureReadyDone: false,
    experimentConfirmed: false,
  };
}

function confirmLaboratoryExperiment(workflow = createLaboratoryWorkflow()) {
  if (!(workflow.hasInstalled || workflow.installationDone) || !workflow.fixtureReadyDone) {
    return { ...workflow };
  }
  return {
    comparisonDone: true,
    experimentConfirmed: true,
    fixtureReadyDone: true,
    hasCompared: true,
    hasInstalled: true,
    installationDone: true,
  };
}

function buildLaboratoryProgressMessage(workflow, currentTask, labName = SALT_SPRAY_LAB) {
  if (!currentTask) {
    return `当前${normalizeText(labName) || SALT_SPRAY_LAB}暂无排程`;
  }
  if (workflow.experimentConfirmed) {
    return "当前任务已确认全部托盘实验准备就绪";
  }
  if (workflow.hasInstalledWaitingReady && !workflow.fixtureReadyDone) {
    return "当前任务已完成夹具安装，等待上位机确认夹具安装完成";
  }
  if (workflow.hasInstalledWaitingReady && workflow.fixtureReadyDone) {
    return "夹具安装完成，可确认实验准备就绪";
  }
  if (workflow.hasInstalled && !workflow.installationDone) {
    return "当前任务已有托盘完成样品安装，待确认已安装托盘准备就绪";
  }
  if (workflow.installationDone) {
    return "当前任务已完成全部托盘样品安装，待实验确认";
  }
  if (workflow.hasCompared && !workflow.comparisonDone) {
    return "当前任务已完成部分托盘比对，可继续比对或开始样品安装";
  }
  if (workflow.comparisonDone) {
    return "当前任务已完成全部托盘任务比对，待样品安装";
  }
  return `当前任务 ${currentTask.taskCode} 待开始任务比对`;
}

function applyLaboratoryTaskStep({
  samples = [],
  currentTask = null,
  nextStatus = "",
  historyAction = "",
  now = new Date().toISOString(),
  targetTrayCodes = [],
}) {
  if (!currentTask) {
    return asArray(samples);
  }

  const normalizedStatus = normalizeText(nextStatus);
  const scopedTrayCodes = asArray(targetTrayCodes).length > 0 ? targetTrayCodes : currentTask.trayCodes;
  const trayCodeSet = new Set(asArray(scopedTrayCodes).map((trayCode) => normalizeText(trayCode)).filter(Boolean));
  const taskCode = normalizeText(currentTask.taskCode);
  const detail = `${taskCode} / ${normalizeText(currentTask.experimentName) || "-"} / ${normalizedStatus}`;
  const scopedSamples = asArray(samples).filter((sample) => normalizeText(sample?.task_code) === taskCode);
  const syncedSamples = synchronizeSamplesForTrayCodes({
    historyAction,
    historyDetail: detail,
    location: normalizeText(currentTask.device) || SALT_SPRAY_LAB,
    now,
    samples: scopedSamples,
    status: normalizedStatus,
    trayCodes: Array.from(trayCodeSet),
  }).samples;
  const syncedByCode = new Map(syncedSamples.map((sample) => [normalizeText(sample?.code), sample]));
  return asArray(samples).map((sample) => syncedByCode.get(normalizeText(sample?.code)) || sample);
}

function resetLaboratoryExperimentTrays({
  samples = [],
  currentTask = null,
  now = new Date().toISOString(),
}) {
  if (!currentTask || !asArray(currentTask?.trayCodes).length) {
    return asArray(samples);
  }

  return applyLaboratoryTaskStep({
    currentTask,
    historyAction: "实验任务重置",
    nextStatus: LAB_RESET_STATUS,
    now,
    samples,
    targetTrayCodes: currentTask.trayCodes,
  });
}

function revertLaboratoryTaskToPreDispatch({
  samples = [],
  currentTask = null,
  now = new Date().toISOString(),
}) {
  if (!currentTask || !asArray(currentTask?.trayCodes).length) {
    return asArray(samples);
  }

  const taskCode = normalizeText(currentTask?.taskCode);
  const trayCodeSet = new Set(asArray(currentTask?.trayCodes).map((trayCode) => normalizeText(trayCode)).filter(Boolean));
  const experimentName = normalizeText(currentTask?.experimentName) || "-";

  return asArray(samples).map((sample) => {
    if (normalizeText(sample?.task_code) !== taskCode) {
      return sample;
    }

    let restoreSnapshot = null;
    let reverted = false;
    const nextTrays = asArray(sample?.trays).map((tray) => {
      const trayCode = normalizeText(tray?.tray_code);
      if (!trayCodeSet.has(trayCode) || !shouldRevertLaboratoryTrayStatus(normalizeText(tray?.status) || normalizeText(sample?.status))) {
        return { ...tray };
      }
      restoreSnapshot = restoreSnapshot || resolvePreDispatchSnapshot(sample);
      reverted = true;
      return {
        ...tray,
        status: restoreSnapshot.status,
        updated_at: now,
      };
    });

    if (!reverted || !restoreSnapshot) {
      return sample;
    }

    const nextSample = {
      ...sample,
      flow_status: restoreSnapshot.status,
      location: restoreSnapshot.location,
      status: restoreSnapshot.status,
      trays: nextTrays,
      updated_at: now,
    };
    nextSample.history = buildLaboratoryHistoryEntry(
      nextSample,
      "任务切换撤回",
      restoreSnapshot.status,
      `${taskCode} / ${experimentName} / 撤回至${restoreSnapshot.status}`,
      now,
    );
    return nextSample;
  });
}

function buildLaboratoryChecklist(task) {
  if (!task) {
    return [];
  }
  return [
    { label: "任务编号", value: task.taskCode || "-" },
    { label: "实验项目", value: task.experimentName || "-" },
    { label: "执行人员", value: task.owner || "-" },
    { label: "开始时间", value: task.startTimeLabel || "-" },
    { label: "结束时间", value: task.endTimeLabel || "-" },
    { label: "样品数量", value: task.sampleCount ? `${task.sampleCount} 件` : "-" },
    { label: "实验室", value: task.device || SALT_SPRAY_LAB },
  ];
}

function validateLaboratoryTrayScan({ currentTask = null, scheduleRows = [], allScheduleRows = [], scanCode = "" }) {
  const normalizedScanCode = normalizeText(scanCode);
  if (!normalizedScanCode) {
    return {
      guidance: "请扫描托盘编号",
      message: "请扫描托盘编号",
      ok: false,
      tone: "error",
    };
  }
  if (!currentTask) {
    return {
      guidance: "当前没有可比对的任务",
      message: "当前没有可比对的任务",
      ok: false,
      tone: "error",
    };
  }

  if (asArray(currentTask.trayCodes).includes(normalizedScanCode)) {
    const matchedTray = asArray(currentTask.trayRows).find((row) => normalizeText(row?.trayCode) === normalizedScanCode) || null;
    const trayStatus = normalizeText(matchedTray?.trayStatus) || normalizeText(matchedTray?.displayStatus);
    if (resolveLaboratoryStatusRank(trayStatus) >= 1) {
      return buildBlockedComparisonResult(normalizedScanCode, trayStatus);
    }
    if (trayStatus !== LAB_RESET_STATUS) {
      return buildNotDispatchedComparisonResult(normalizedScanCode, matchedTray);
    }
    return {
      guidance: `${normalizedScanCode} 属于当前任务 ${currentTask.taskCode}`,
      matchedRow: currentTask,
      message: "比对正确",
      ok: true,
      tone: "success",
      trayCode: normalizedScanCode,
    };
  }

  const searchRows = asArray(allScheduleRows).length ? asArray(allScheduleRows) : asArray(scheduleRows);
  const matchedRows = searchRows.filter((row) => asArray(row.trayCodes).includes(normalizedScanCode));
  if (matchedRows.length > 0) {
    const destinationLabels = uniqueValues(matchedRows.map((row) => row.device));
    return {
      guidance: `当前任务并非优先所选任务。该托盘可前往：${destinationLabels.join("、")}`,
      matchedRow: matchedRows[0],
      matchedRows,
      message: "比对不正确",
      ok: false,
      tone: "error",
      trayCode: normalizedScanCode,
    };
  }

  return {
    guidance: "未匹配到该托盘",
    message: "比对不正确",
    ok: false,
    tone: "error",
    trayCode: normalizedScanCode,
  };
}

export {
  applyLaboratoryTaskStep,
  SALT_SPRAY_LAB,
  LAB_COMPARE_STATUS,
  LAB_INSTALL_STATUS,
  LAB_RESET_STATUS,
  LAB_READY_STATUS,
  buildLaboratoryChecklist,
  buildLaboratoryWorkbenchView,
  buildLaboratoryTaskFlow,
  buildLaboratoryProgressMessage,
  buildRunningExperimentView,
  buildLaboratorySummary,
  buildLaboratoryWorkflowFromTask,
  buildSaltSprayLaboratoryView,
  completeLaboratoryComparison,
  completeLaboratoryInstallation,
  confirmLaboratoryExperiment,
  createLaboratoryWorkflow,
  getLaboratoryActionState,
  resetLaboratoryExperimentTrays,
  revertLaboratoryTaskToPreDispatch,
  validateLaboratoryTrayScan,
};
