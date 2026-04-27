import { SAMPLE_FLOW_STEPS } from "@/modules/samples/samplesFlowModel";

const RETURNED_STATUS = "厂家收回";
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

const buildTaskRow = (task, samples) => {
  const code = resolveTaskCode(task) || resolveSampleTaskCode(samples[0]);
  const trays = buildTrayRows(samples);
  return {
    id: task?.id || code,
    code,
    name: normalizeText(task?.name || task?.task_name || task?.test_type || task?.experiment_type),
    status: normalizeText(task?.status || task?.transfer_status || task?.taskStatus) || RETURNED_STATUS,
    updatedAt: normalizeText(task?.updated_at || task?.created_at),
    sampleCount: samples.length,
    trayCount: trays.length,
    taskFlow: collectFlowEntries(samples),
    trays,
  };
};

function buildReturnedTaskHistoryView(input = {}) {
  const tasks = asArray(input.tasks);
  const samples = asArray(input.samples);
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
      return buildTaskRow(taskRecordsByCode.get(taskCode) || { code: taskCode }, taskSamples);
    })
    .filter(Boolean)
    .sort((left, right) => {
      const timeCompare = String(right.updatedAt || "").localeCompare(String(left.updatedAt || ""));
      return timeCompare || left.code.localeCompare(right.code, "zh-Hans-CN", { numeric: true });
    });

  return { tasks: historyTasks };
}

export { buildReturnedTaskHistoryView };
