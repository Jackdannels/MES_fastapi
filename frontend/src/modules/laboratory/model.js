import { buildTrayFlowView } from "@/modules/samples/samplesFlowModel";
import {
  resolveTaskStatus,
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
const LABORATORY_TASK_FLOW_STEPS = [
  { key: "waiting", label: STATUS_WAITING },
  { key: "scheduled", label: STATUS_SCHEDULED },
  { key: "running", label: STATUS_RUNNING },
  { key: "completed", label: STATUS_COMPLETED },
  { key: "returned", label: STATUS_RETENTION },
];
const LABORATORY_TASK_FLOW_INDEX = new Map(LABORATORY_TASK_FLOW_STEPS.map((step, index) => [step.label, index]));

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

  const pushRow = (trayCode, sampleCode = "", quantity = "", owner = "") => {
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
      return;
    }
    indexByTrayCode.set(normalizedTrayCode, trayRows.length);
    trayRows.push({
      displayStatus: "",
      owner: normalizeText(owner),
      quantity: quantity || "",
      sampleCodes: sampleCode ? [sampleCode] : [],
      trayStatus: "",
      trayCode: normalizedTrayCode,
    });
  };

  const scopedTrayCodes = experimentTrayCodeMap.get(experimentKey) || [];
  scopedTrayCodes.forEach((trayCode) => pushRow(trayCode));

  asArray(relatedSamples).forEach((sample) => {
    const sampleCode = normalizeText(sample?.code);
    const owner = normalizeText(sample?.owner);
    asArray(sample?.trays).forEach((tray) => {
      const trayCode = normalizeText(tray?.tray_code);
      const quantity = tray?.quantity ?? "";
      if (scopedTrayCodes.length > 0 && !scopedTrayCodes.includes(trayCode)) {
        return;
      }
      pushRow(trayCode, sampleCode, quantity, owner);
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

function buildSaltSprayLaboratoryView({
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

  const allScheduleRows = asArray(schedules)
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

  const selectedTask = scheduleRows.find((row) => row.taskCode === normalizeText(selectedTaskCode)) || null;
  const currentTask = selectedTask || defaultTask;
  const currentExperimentTrayRows = asArray(currentTask?.trayRows);
  const selectedTrayRow =
    currentExperimentTrayRows.find((row) => row.trayCode === normalizeText(selectedTrayCode))
    || currentExperimentTrayRows[0]
    || null;
  const currentTaskRecord = taskMap.get(normalizeText(currentTask?.taskCode)) || currentTask || null;
  const currentTaskStatus = currentTask
    ? resolveTaskStatus(currentTaskRecord, schedules, samples, nowTime)
    : STATUS_WAITING;
  const currentTaskFlow = buildLaboratoryTaskFlow(currentTaskStatus);
  const selectedTrayFlow = buildTrayFlowView({
    currentExperimentCode: normalizeText(currentTask?.experimentCode),
    experimentTrays,
    experiments,
    location: normalizeText(currentTask?.device) || labName,
    samples,
    schedules,
    status: normalizeText(selectedTrayRow?.displayStatus) || normalizeText(selectedTrayRow?.trayStatus),
    taskCode: normalizeText(currentTask?.taskCode),
    trayCode: normalizeText(selectedTrayRow?.trayCode),
  });

  return {
    allScheduleRows,
    currentTask,
    currentTaskFlow,
    currentTaskStatus,
    currentExperimentTrayRows,
    defaultTask,
    labName,
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
    installationDone: false,
  };
}

function buildLaboratoryWorkflowFromTask(task) {
  const maxRank = asArray(task?.trayRows).reduce((highest, row) => Math.max(highest, resolveLaboratoryStatusRank(row?.trayStatus)), 0);
  return {
    comparisonDone: maxRank >= 1,
    experimentConfirmed: maxRank >= 3,
    installationDone: maxRank >= 2,
  };
}

function getLaboratoryActionState(workflow = createLaboratoryWorkflow()) {
  if (workflow.experimentConfirmed) {
    return {
      canCompare: true,
      canInstallSample: false,
      canMarkReady: false,
    };
  }
  return {
    canCompare: !workflow.comparisonDone,
    canInstallSample: workflow.comparisonDone && !workflow.installationDone,
    canMarkReady: workflow.comparisonDone && workflow.installationDone,
  };
}

function completeLaboratoryComparison(workflow = createLaboratoryWorkflow()) {
  return {
    ...workflow,
    comparisonDone: true,
    experimentConfirmed: false,
  };
}

function completeLaboratoryInstallation(workflow = createLaboratoryWorkflow()) {
  if (!workflow.comparisonDone) {
    return { ...workflow };
  }
  return {
    ...workflow,
    installationDone: true,
    experimentConfirmed: false,
  };
}

function confirmLaboratoryExperiment(workflow = createLaboratoryWorkflow()) {
  if (!workflow.installationDone) {
    return { ...workflow };
  }
  return {
    comparisonDone: false,
    experimentConfirmed: true,
    installationDone: false,
  };
}

function buildLaboratoryProgressMessage(workflow, currentTask) {
  if (!currentTask) {
    return "当前盐雾试验室暂无排程";
  }
  if (workflow.experimentConfirmed) {
    return "当前任务已确认实验准备就绪";
  }
  if (workflow.installationDone) {
    return "当前任务已完成样品安装，待实验确认";
  }
  if (workflow.comparisonDone) {
    return "当前任务已完成任务比对，待样品安装";
  }
  return `当前任务 ${currentTask.taskCode} 待开始任务比对`;
}

function applyLaboratoryTaskStep({
  samples = [],
  currentTask = null,
  nextStatus = "",
  historyAction = "",
  now = new Date().toISOString(),
}) {
  if (!currentTask) {
    return asArray(samples);
  }

  const normalizedStatus = normalizeText(nextStatus);
  const trayCodeSet = new Set(asArray(currentTask.trayCodes).map((trayCode) => normalizeText(trayCode)).filter(Boolean));
  const taskCode = normalizeText(currentTask.taskCode);
  const detail = `${taskCode} / ${normalizeText(currentTask.experimentName) || "-"} / ${normalizedStatus}`;

  return asArray(samples).map((sample) => {
    if (normalizeText(sample?.task_code) !== taskCode) {
      return sample;
    }

    let matchedTray = false;
    const nextTrays = asArray(sample?.trays).map((tray) => {
      const trayCode = normalizeText(tray?.tray_code);
      if (trayCodeSet.size > 0 && !trayCodeSet.has(trayCode)) {
        return tray;
      }
      matchedTray = true;
      return {
        ...tray,
        status: normalizedStatus,
        updated_at: now,
      };
    });

    if (!matchedTray && trayCodeSet.size > 0) {
      return sample;
    }

    return {
      ...sample,
      flow_status: normalizedStatus,
      history: buildLaboratoryHistoryEntry(sample, historyAction, normalizedStatus, detail, now),
      location: normalizeText(currentTask.device) || SALT_SPRAY_LAB,
      status: normalizedStatus,
      trays: nextTrays,
      updated_at: now,
    };
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
  LAB_READY_STATUS,
  buildLaboratoryChecklist,
  buildLaboratoryTaskFlow,
  buildLaboratoryProgressMessage,
  buildLaboratorySummary,
  buildLaboratoryWorkflowFromTask,
  buildSaltSprayLaboratoryView,
  completeLaboratoryComparison,
  completeLaboratoryInstallation,
  confirmLaboratoryExperiment,
  createLaboratoryWorkflow,
  getLaboratoryActionState,
  validateLaboratoryTrayScan,
};
