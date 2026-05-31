import { SAMPLE_FLOW_STEPS, normalizeLifecycleStatus } from "@/modules/samples/samplesFlowModel";

const RETURNED_STATUS = "厂家收回";
const TASK_STATUS_FLOW_STEPS = [
  { key: "waiting", label: "待排程" },
  { key: "scheduled", label: "已排程" },
  { key: "running", label: "任务进行中" },
  { key: "completed", label: "任务已完成" },
  { key: "returned", label: RETURNED_STATUS },
];
const EXPERIMENT_COMPLETED_STATUSES = new Set(["实验已完成", "实验完成", "放置实验后暂存间"]);
const FLOW_LABEL_ALIASES = new Map([
  ["运输中", "样品运输中"],
  ["已运输", "样品运输中"],
  ["实验完成", "实验已完成"],
  ["试验完成", "实验已完成"],
  ["实验后暂存", "放置实验后暂存间"],
  ["放置实验后暂存", "放置实验后暂存间"],
  ["收回", "厂家收回"],
  ["已收回", "厂家收回"],
]);
const FLOW_INDEX_BY_LABEL = new Map(SAMPLE_FLOW_STEPS.map((step, index) => [step.label, index]));

const normalizeText = (value) => String(value ?? "").trim();
const asArray = (value) => (Array.isArray(value) ? value : []);
const parseTimeValue = (value) => {
  const timestamp = Date.parse(normalizeText(value));
  return Number.isFinite(timestamp) ? timestamp : 0;
};

const normalizeFlowLabel = (value) => {
  const text = normalizeText(value);
  if (!text) {
    return "";
  }
  if (FLOW_INDEX_BY_LABEL.has(text)) {
    return text;
  }
  if (FLOW_LABEL_ALIASES.has(text)) {
    return FLOW_LABEL_ALIASES.get(text);
  }
  const matchedStep = SAMPLE_FLOW_STEPS.find((step) => text.includes(step.label));
  if (matchedStep) {
    return matchedStep.label;
  }
  const matchedAlias = Array.from(FLOW_LABEL_ALIASES.entries()).find(([alias]) => text.includes(alias));
  return matchedAlias ? matchedAlias[1] : "";
};

const normalizeTime = (value) => normalizeText(value);
const pad2 = (value) => String(value ?? "").padStart(2, "0");
const EXPLICIT_TIMEZONE_PATTERN = /(?:Z|[+-]\d{2}:?\d{2})$/;

const formatBeijingDateTime = (value) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }
  const beijing = new Date(parsed.getTime() + 8 * 60 * 60 * 1000);
  return [
    `${beijing.getUTCFullYear()}-${pad2(beijing.getUTCMonth() + 1)}-${pad2(beijing.getUTCDate())}`,
    `${pad2(beijing.getUTCHours())}:${pad2(beijing.getUTCMinutes())}:${pad2(beijing.getUTCSeconds())}`,
  ].join(" ");
};

const formatHistoryTime = (value) => {
  const normalized = normalizeText(value);
  if (!normalized) {
    return "-";
  }
  const withoutMilliseconds = normalized.replace(/\.\d{1,6}/, "");
  if (EXPLICIT_TIMEZONE_PATTERN.test(withoutMilliseconds)) {
    return formatBeijingDateTime(withoutMilliseconds) || "-";
  }
  return withoutMilliseconds.replace("T", " ");
};

const formatHistoryDatePart = (value) => {
  const formatted = formatHistoryTime(value);
  return formatted.includes(" ") ? formatted.split(" ")[0] : formatted;
};

const formatHistoryClockPart = (value) => {
  const formatted = formatHistoryTime(value);
  return formatted.includes(" ") ? formatted.split(" ")[1] : "";
};

const resolveTaskCode = (task) => normalizeText(task?.code || task?.task_code || task?.taskNo || task?.task_no || task?.id);
const resolveSampleTaskCode = (sample) => normalizeText(sample?.task_code || sample?.taskCode || sample?.taskNo || sample?.task_no);
const resolveSampleCode = (sample) => normalizeText(sample?.code || sample?.sample_code || sample?.sampleNo || sample?.sample_no || sample?.id);
const resolveTrayCode = (tray) => normalizeText(tray?.tray_code || tray?.trayCode || tray?.trayNo || tray?.tray_no || tray?.code || tray?.id);
const resolveStatus = (value) => normalizeText(value?.status || value?.tray_status || value?.trayStatus || value?.sampleStatus);
const resolveExperimentTaskCode = (experiment) => normalizeText(experiment?.task_code || experiment?.taskCode || experiment?.taskNo || experiment?.task_no);
const resolveExperimentCode = (experiment) => normalizeText(experiment?.experiment_code || experiment?.experimentCode || experiment?.code || experiment?.id);
const resolveExperimentName = (experiment) => normalizeText(experiment?.experiment_name || experiment?.experimentName || experiment?.required_device || experiment?.test_type || experiment?.name);
const resolveExperimentStatus = (experiment) => normalizeText(experiment?.status || experiment?.experiment_status || experiment?.experimentStatus);
const resolveExperimentTime = (experiment) => normalizeText(experiment?.completed_at || experiment?.completedAt || experiment?.updated_at || experiment?.updatedAt || experiment?.created_at || experiment?.createdAt);
const resolveRelationTaskCode = (relation) => normalizeText(relation?.task_code || relation?.taskCode || relation?.taskNo || relation?.task_no);
const resolveRelationExperimentCode = (relation) => normalizeText(relation?.experiment_code || relation?.experimentCode || relation?.experimentNo || relation?.experiment_no);
const resolveTaskArchiveStatus = (task) => normalizeText(task?.transfer_status || task?.transferStatus || task?.status || task?.displayStatus || task?.display_status);
const resolveTaskTrayCodes = (task) => asArray(task?.tray_codes || task?.trayCodes || task?.tray_nos || task?.trayNos)
  .map((trayCode) => normalizeText(trayCode))
  .filter(Boolean);
const resolveTaskPlannedSampleCount = (task) => {
  const parsed = Number.parseInt(String(task?.sample_count ?? task?.sampleCount ?? ""), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

const collectTrayRefs = (samples) => {
  const trayRefsByCode = new Map();
  samples.forEach((sample) => {
    asArray(sample?.trays).forEach((tray) => {
      const trayCode = resolveTrayCode(tray);
      if (!trayCode) {
        return;
      }
      const existing = trayRefsByCode.get(trayCode) || [];
      existing.push({ sample, tray });
      trayRefsByCode.set(trayCode, existing);
    });
  });
  return trayRefsByCode;
};

const isReturned = (status) => normalizeFlowLabel(status) === RETURNED_STATUS || normalizeText(status) === RETURNED_STATUS;
const trayRefIsReturned = ({ sample, tray }) => {
  const trayStatus = resolveStatus(tray);
  const sampleStatus = resolveStatus(sample);
  const sampleLocation = normalizeText(sample?.location);
  const lifecycleStatus = normalizeLifecycleStatus(sampleLocation, trayStatus || sampleStatus);
  return (
    isReturned(trayStatus)
    || isReturned(sampleStatus)
    || isReturned(sampleLocation)
    || isReturned(lifecycleStatus)
  );
};

const hasExplicitReturnedStatus = (task) => isReturned(resolveTaskArchiveStatus(task));

const collectReturnedTrayCodes = (samples) => {
  const trayRefsByCode = collectTrayRefs(samples);
  return new Set(Array.from(trayRefsByCode.entries())
    .filter((entry) => entry[1].some(trayRefIsReturned))
    .map(([trayCode]) => trayCode));
};

const collectAssignedTrayCodes = (task, samples, experimentTrays) => {
  const taskCode = resolveTaskCode(task) || resolveSampleTaskCode(samples[0]);
  const trayCodes = new Set([
    ...Array.from(collectTrayRefs(samples).keys()),
    ...resolveTaskTrayCodes(task),
  ]);
  asArray(experimentTrays).forEach((relation) => {
    if (resolveRelationTaskCode(relation) !== taskCode) {
      return;
    }
    const trayCode = resolveTrayCode(relation);
    if (trayCode) {
      trayCodes.add(trayCode);
    }
  });
  return trayCodes;
};

const hasAllAssignedTraysReturned = (samples, task = null, experimentTrays = []) => {
  const trayRefsByCode = collectTrayRefs(samples);
  const assignedTrayCodes = collectAssignedTrayCodes(task, samples, experimentTrays);
  if (!trayRefsByCode.size && !assignedTrayCodes.size) {
    return hasExplicitReturnedStatus(task);
  }
  const returnedTrayCodes = collectReturnedTrayCodes(samples);
  return assignedTrayCodes.size > 0 && returnedTrayCodes.size === assignedTrayCodes.size;
};

const collectSampleStats = (task, samples, returnedTrayCodes) => {
  const sampleCodes = asArray(samples).map(resolveSampleCode).filter(Boolean);
  const uniqueSampleCodes = new Set(sampleCodes);
  const plannedCount = resolveTaskPlannedSampleCount(task);
  const originalSampleCount = Math.max(
    plannedCount ?? 0,
    uniqueSampleCodes.size || samples.length,
  );
  const returnedSampleCodes = new Set();
  let anonymousReturnedCount = 0;
  samples.forEach((sample) => {
    const sampleCode = resolveSampleCode(sample);
    const sampleTrays = asArray(sample?.trays);
    const isOnReturnedTray = sampleTrays.some((tray) => returnedTrayCodes.has(resolveTrayCode(tray)));
    const isReturnedSample = isOnReturnedTray || (!sampleTrays.length && isReturned(resolveStatus(sample)));
    if (!isReturnedSample) {
      return;
    }
    if (sampleCode) {
      returnedSampleCodes.add(sampleCode);
    } else {
      anonymousReturnedCount += 1;
    }
  });
  const returnedSampleCount = Math.min(originalSampleCount, returnedSampleCodes.size + anonymousReturnedCount);
  return {
    originalSampleCount,
    remainingSampleCount: Math.max(originalSampleCount - returnedSampleCount, 0),
    returnedSampleCount,
  };
};

const shouldPreferFlowTime = (label, nextTime, currentTime) => {
  if (!currentTime) {
    return true;
  }
  if (label === "到货" || label === "实验进行中") {
    return parseTimeValue(nextTime) < parseTimeValue(currentTime);
  }
  return parseTimeValue(nextTime) >= parseTimeValue(currentTime);
};

const collectFlowEntries = (samples) => {
  const latestByLabel = new Map();
  samples.forEach((sample) => {
    asArray(sample?.history).forEach((entry) => {
      const label = normalizeFlowLabel(entry?.status || entry?.action || entry?.detail);
      const time = normalizeTime(entry?.time || entry?.created_at || entry?.updated_at || entry?.timestamp);
      if (!label || !time) {
        return;
      }
      const current = latestByLabel.get(label);
      if (
        !current
        || shouldPreferFlowTime(label, time, current.time)
      ) {
        latestByLabel.set(label, { label, time });
      }
    });
  });
  return Array.from(latestByLabel.values()).sort((left, right) => {
    const leftIndex = FLOW_INDEX_BY_LABEL.get(left.label) ?? Number.MAX_SAFE_INTEGER;
    const rightIndex = FLOW_INDEX_BY_LABEL.get(right.label) ?? Number.MAX_SAFE_INTEGER;
    if (leftIndex !== rightIndex) {
      return leftIndex - rightIndex;
    }
    return left.time.localeCompare(right.time);
  });
};

const filterTaskFlowForExperiments = (flowEntries, experiments) => {
  if (!experiments.length) {
    return flowEntries;
  }
  const allCompleted = experiments.every((experiment) => EXPERIMENT_COMPLETED_STATUSES.has(resolveExperimentStatus(experiment)));
  if (allCompleted) {
    return flowEntries;
  }
  return flowEntries.filter((entry) => entry.label !== "实验已完成");
};

const TASK_FLOW_TIME_LABELS = new Map([
  ["任务进行中", "实验进行中"],
  ["任务已完成", "实验已完成"],
  [RETURNED_STATUS, RETURNED_STATUS],
]);

const buildReturnedTaskStatusFlow = (flowEntries = []) => {
  const activeIndex = TASK_STATUS_FLOW_STEPS.length - 1;
  const timeByLabel = new Map(asArray(flowEntries).map((entry) => [normalizeText(entry?.label), normalizeText(entry?.time)]));
  return TASK_STATUS_FLOW_STEPS.map((step, index) => ({
    ...step,
    active: index === activeIndex,
    reached: index <= activeIndex,
    time: timeByLabel.get(TASK_FLOW_TIME_LABELS.get(step.label)) || "",
  }));
};

const buildRunningTaskStatusFlow = (flowEntries = []) => {
  const activeIndex = TASK_STATUS_FLOW_STEPS.findIndex((step) => step.label === "任务进行中");
  const timeByLabel = new Map(asArray(flowEntries).map((entry) => [normalizeText(entry?.label), normalizeText(entry?.time)]));
  return TASK_STATUS_FLOW_STEPS.map((step, index) => ({
    ...step,
    active: index === activeIndex,
    reached: index <= activeIndex,
    time: timeByLabel.get(TASK_FLOW_TIME_LABELS.get(step.label)) || "",
  }));
};

const buildExperimentRows = (task, taskSamples, experiments, experimentTrays) => {
  const taskCode = resolveTaskCode(task) || resolveSampleTaskCode(taskSamples[0]);
  const taskExperiments = experiments
    .filter((experiment) => resolveExperimentTaskCode(experiment) === taskCode)
    .sort((left, right) => resolveExperimentCode(left).localeCompare(resolveExperimentCode(right), "zh-Hans-CN", { numeric: true }));
  const relationsByExperimentCode = new Map();
  experimentTrays.forEach((relation) => {
    if (resolveRelationTaskCode(relation) !== taskCode) {
      return;
    }
    const experimentCode = resolveRelationExperimentCode(relation);
    const trayCode = resolveTrayCode(relation);
    if (!experimentCode || !trayCode) {
      return;
    }
    const trayCodes = relationsByExperimentCode.get(experimentCode) || [];
    if (!trayCodes.includes(trayCode)) {
      trayCodes.push(trayCode);
    }
    relationsByExperimentCode.set(experimentCode, trayCodes);
  });

  return taskExperiments.map((experiment) => {
    const status = resolveExperimentStatus(experiment);
    const completed = EXPERIMENT_COMPLETED_STATUSES.has(status);
    return {
      experimentCode: resolveExperimentCode(experiment),
      experimentName: resolveExperimentName(experiment) || resolveExperimentCode(experiment) || "-",
      rawStatus: status,
      displayStatus: completed ? "已完成" : "未完成",
      completed,
      completedAt: completed ? resolveExperimentTime(experiment) : "",
      trayCodes: (relationsByExperimentCode.get(resolveExperimentCode(experiment)) || []).sort((left, right) => left.localeCompare(right, "zh-Hans-CN", { numeric: true })),
    };
  });
};

const buildTrayRows = (samples, includedTrayCodes = null) => {
  const trayRefsByCode = collectTrayRefs(samples);
  return Array.from(trayRefsByCode.entries())
    .filter(([trayCode]) => !includedTrayCodes || includedTrayCodes.has(trayCode))
    .map(([trayCode, refs]) => {
      const traySamples = refs.map(({ sample }) => sample);
      const sampleCodes = Array.from(new Set(traySamples.map(resolveSampleCode).filter(Boolean))).sort((left, right) => left.localeCompare(right, "zh-Hans-CN"));
      const latestReturnedStatus = refs.find(trayRefIsReturned);
      return {
        trayCode,
        status: latestReturnedStatus ? RETURNED_STATUS : (resolveStatus(refs[0]?.tray) || "-"),
        sampleCodes,
        flowSteps: collectFlowEntries(traySamples),
      };
    })
    .sort((left, right) => left.trayCode.localeCompare(right.trayCode, "zh-Hans-CN", { numeric: true }));
};

const buildTaskRow = (task, samples, experiments, experimentTrays) => {
  const code = resolveTaskCode(task) || resolveSampleTaskCode(samples[0]);
  const assignedTrayCodes = collectAssignedTrayCodes(task, samples, experimentTrays);
  const returnedTrayCodes = collectReturnedTrayCodes(samples);
  const allTrayCount = assignedTrayCodes.size;
  const returnedTrayCount = returnedTrayCodes.size;
  const isFullyReturned = allTrayCount > 0
    ? returnedTrayCount === allTrayCount
    : hasExplicitReturnedStatus(task);
  const trays = buildTrayRows(samples, returnedTrayCount > 0 ? returnedTrayCodes : null);
  const experimentRows = buildExperimentRows(task || { code }, samples, experiments, experimentTrays);
  const completedCount = experimentRows.filter((experiment) => experiment.completed).length;
  const sampleFlowEntries = filterTaskFlowForExperiments(collectFlowEntries(samples), experimentRows);
  const returnedAt = sampleFlowEntries.find((entry) => entry.label === RETURNED_STATUS)?.time || "";
  const remainingTrayCount = Math.max(allTrayCount - returnedTrayCount, 0);
  const sampleStats = collectSampleStats(task, samples, returnedTrayCodes);
  const displayStatus = isFullyReturned
    ? RETURNED_STATUS
    : `任务进行中（收回${returnedTrayCount}，剩余${remainingTrayCount}）`;
  return {
    id: task?.id || code,
    code,
    name: normalizeText(task?.name || task?.task_name || task?.test_type || task?.experiment_type),
    status: displayStatus,
    updatedAt: returnedAt || normalizeText(task?.updated_at || task?.created_at),
    sampleCount: sampleStats.originalSampleCount,
    trayCount: trays.length,
    originalTrayCount: allTrayCount,
    remainingTrayCount,
    returnedTrayCount,
    ...sampleStats,
    sampleCountText: `${sampleStats.originalSampleCount} 个样品（收回${sampleStats.returnedSampleCount}，剩余${sampleStats.remainingSampleCount}）`,
    trayCountText: `${allTrayCount} 个托盘（收回${returnedTrayCount}，剩余${remainingTrayCount}）`,
    experimentCount: experimentRows.length,
    experimentCompletedCount: completedCount,
    experiments: experimentRows,
    taskFlow: isFullyReturned ? buildReturnedTaskStatusFlow(sampleFlowEntries) : buildRunningTaskStatusFlow(sampleFlowEntries),
    trays,
  };
};

const matchesTaskSearch = (task, query) => {
  const normalizedQuery = normalizeText(query).toLowerCase();
  if (!normalizedQuery) {
    return true;
  }
  const searchText = [
    task.code,
    task.name,
    task.status,
    ...asArray(task.trays).flatMap((tray) => [tray.trayCode, ...asArray(tray.sampleCodes)]),
  ]
    .map((item) => normalizeText(item).toLowerCase())
    .join(" ");
  return searchText.includes(normalizedQuery);
};

const matchesDateWindow = (task, days, now) => {
  const parsedDays = Number.parseInt(String(days || ""), 10);
  if (!Number.isFinite(parsedDays) || parsedDays <= 0) {
    return true;
  }
  const taskTime = parseTimeValue(task.updatedAt);
  const nowTime = parseTimeValue(now) || Date.now();
  if (!taskTime) {
    return false;
  }
  return taskTime >= nowTime - parsedDays * 24 * 60 * 60 * 1000;
};

function buildReturnedTaskHistoryView(input = {}) {
  const tasks = asArray(input.tasks);
  const samples = asArray(input.samples);
  const experiments = asArray(input.experiments);
  const experimentTrays = asArray(input.experimentTrays || input.experiment_trays);
  const samplesByTaskCode = new Map();

  samples.forEach((sample) => {
    const taskCode = resolveSampleTaskCode(sample);
    if (!taskCode) {
      return;
    }
    const taskSamples = samplesByTaskCode.get(taskCode) || [];
    taskSamples.push(sample);
    samplesByTaskCode.set(taskCode, taskSamples);
  });

  const taskRecordsByCode = new Map(tasks.map((task) => [resolveTaskCode(task), task]).filter(([code]) => code));
  const taskCodes = new Set([...taskRecordsByCode.keys(), ...samplesByTaskCode.keys()]);
  const filters = input.filters && typeof input.filters === "object" ? input.filters : {};
  const pageSize = Number(input.pageSize) > 0 ? Number(input.pageSize) : 8;
  const historyTasks = Array.from(taskCodes)
    .map((taskCode) => {
      const taskSamples = samplesByTaskCode.get(taskCode) || [];
      const taskRecord = taskRecordsByCode.get(taskCode) || { code: taskCode };
      const hasReturnedTrays = collectReturnedTrayCodes(taskSamples).size > 0;
      if (!hasAllAssignedTraysReturned(taskSamples, taskRecord, experimentTrays) && !hasReturnedTrays) {
        return null;
      }
      return buildTaskRow(taskRecord, taskSamples, experiments, experimentTrays);
    })
    .filter(Boolean)
    .filter((task) => matchesTaskSearch(task, filters.query || input.query))
    .filter((task) => matchesDateWindow(task, filters.days ?? input.days, input.now))
    .sort((left, right) => {
      const timeCompare = String(right.updatedAt || "").localeCompare(String(left.updatedAt || ""));
      return timeCompare || left.code.localeCompare(right.code, "zh-Hans-CN", { numeric: true });
    });

  const totalPages = Math.max(1, Math.ceil(historyTasks.length / pageSize));
  const rawPage = Number.parseInt(String(input.page ?? 1), 10);
  const currentPage = Number.isFinite(rawPage) ? Math.min(Math.max(rawPage, 1), totalPages) : 1;
  const startIndex = (currentPage - 1) * pageSize;

  return {
    currentPage,
    tasks: historyTasks.slice(startIndex, startIndex + pageSize),
    totalCount: historyTasks.length,
    totalPages,
  };
}

export { buildReturnedTaskHistoryView, formatHistoryClockPart, formatHistoryDatePart, formatHistoryTime };
