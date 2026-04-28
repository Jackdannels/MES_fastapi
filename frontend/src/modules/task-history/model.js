import { SAMPLE_FLOW_STEPS } from "@/modules/samples/samplesFlowModel";

const RETURNED_STATUS = "厂家收回";
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

const isReturned = (status) => normalizeText(status) === RETURNED_STATUS;

const hasAllAssignedTraysReturned = (samples) => {
  const trayRefsByCode = collectTrayRefs(samples);
  if (!trayRefsByCode.size) {
    return false;
  }
  return Array.from(trayRefsByCode.values()).every((refs) => (
    refs.length > 0
    && refs.every(({ sample, tray }) => isReturned(resolveStatus(tray) || resolveStatus(sample)))
  ));
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
      if (!current || time.localeCompare(current.time) > 0) {
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

const buildTrayRows = (samples) => {
  const trayRefsByCode = collectTrayRefs(samples);
  return Array.from(trayRefsByCode.entries())
    .map(([trayCode, refs]) => {
      const traySamples = refs.map(({ sample }) => sample);
      const sampleCodes = Array.from(new Set(traySamples.map(resolveSampleCode).filter(Boolean))).sort((left, right) => left.localeCompare(right, "zh-Hans-CN"));
      const latestReturnedStatus = refs.find(({ tray, sample }) => isReturned(resolveStatus(tray) || resolveStatus(sample)));
      return {
        trayCode,
        status: resolveStatus(latestReturnedStatus?.tray) || resolveStatus(latestReturnedStatus?.sample) || resolveStatus(refs[0]?.tray) || "-",
        sampleCodes,
        flowSteps: collectFlowEntries(traySamples),
      };
    })
    .sort((left, right) => left.trayCode.localeCompare(right.trayCode, "zh-Hans-CN", { numeric: true }));
};

const buildTaskRow = (task, samples, experiments, experimentTrays) => {
  const code = resolveTaskCode(task) || resolveSampleTaskCode(samples[0]);
  const trays = buildTrayRows(samples);
  const experimentRows = buildExperimentRows(task || { code }, samples, experiments, experimentTrays);
  const completedCount = experimentRows.filter((experiment) => experiment.completed).length;
  const taskFlow = filterTaskFlowForExperiments(collectFlowEntries(samples), experimentRows);
  return {
    id: task?.id || code,
    code,
    name: normalizeText(task?.name || task?.task_name || task?.test_type || task?.experiment_type),
    status: RETURNED_STATUS,
    updatedAt: normalizeText(task?.updated_at || task?.created_at),
    sampleCount: samples.length,
    trayCount: trays.length,
    experimentCount: experimentRows.length,
    experimentCompletedCount: completedCount,
    experiments: experimentRows,
    taskFlow,
    trays,
  };
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
  const historyTasks = Array.from(taskCodes)
    .map((taskCode) => {
      const taskSamples = samplesByTaskCode.get(taskCode) || [];
      if (!hasAllAssignedTraysReturned(taskSamples)) {
        return null;
      }
      return buildTaskRow(taskRecordsByCode.get(taskCode) || { code: taskCode }, taskSamples, experiments, experimentTrays);
    })
    .filter(Boolean)
    .sort((left, right) => {
      const timeCompare = String(right.updatedAt || "").localeCompare(String(left.updatedAt || ""));
      return timeCompare || left.code.localeCompare(right.code, "zh-Hans-CN", { numeric: true });
    });

  return { tasks: historyTasks };
}

export { buildReturnedTaskHistoryView };
