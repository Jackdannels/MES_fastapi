const LEGACY_TASK_PATTERN = /^[A-Z]+-\d{4}-\d{3}$/;
const SYLU_TASK_PATTERN = /^SYLU-(\d{4})-(\d{2})-(\d{3})$/;
const EXPERIMENT_SUFFIX_PATTERN = /-([A-Z]+)$/;
const SAMPLE_SUFFIX_PATTERN = /-SP-(\d+)$/;
const TRAY_SUFFIX_PATTERN = /-TP-(\d+)$/;
const LEGACY_MULTI_EXPERIMENT_TASK_COUNTS = Object.freeze({
  "GDW-2024-005": 3,
});
const MIN_EXPERIMENTS_PER_TASK = 3;
const EXPERIMENT_TYPE_OPTIONS = Object.freeze([
  "冲击试验",
  "振动试验",
  "四综合试验",
  "温度冲击试验",
  "高低温湿热试验",
  "盐雾试验",
  "霉菌试验",
]);

const normalizeText = (value) => String(value ?? "").trim();

const parseStorageDate = (value) => {
  const text = normalizeText(value);
  if (!text) {
    return null;
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const isLegacyMesTaskCode = (value) => LEGACY_TASK_PATTERN.test(normalizeText(value)) && !SYLU_TASK_PATTERN.test(normalizeText(value));

const extractNumericSuffix = (value, pattern, fallbackIndex) => {
  const match = normalizeText(value).match(pattern);
  return match?.[1] || String(fallbackIndex + 1).padStart(3, "0");
};

const extractExperimentSuffix = (value, fallbackIndex) => {
  const match = normalizeText(value).match(EXPERIMENT_SUFFIX_PATTERN);
  return match?.[1] || String.fromCharCode(65 + fallbackIndex);
};

const taskSortKey = (task) => {
  const taskDate =
    parseStorageDate(task?.arrival_at) ||
    parseStorageDate(task?.created_at) ||
    parseStorageDate(task?.due_at) ||
    new Date("2026-01-01T00:00:00");
  return [taskDate.getFullYear(), taskDate.getMonth() + 1, taskDate.getTime(), normalizeText(task?.code)];
};

const compareTaskSortKey = (left, right) => {
  const leftKey = taskSortKey(left);
  const rightKey = taskSortKey(right);
  for (let index = 0; index < leftKey.length; index += 1) {
    if (leftKey[index] < rightKey[index]) return -1;
    if (leftKey[index] > rightKey[index]) return 1;
  }
  return 0;
};

const replaceStrings = (value, replacements) => {
  if (Array.isArray(value)) {
    return value.map((item) => replaceStrings(item, replacements));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, replaceStrings(entry, replacements)]));
  }
  if (typeof value === "string") {
    return Object.entries(replacements).reduce((text, [source, target]) => (
      source ? text.replaceAll(source, target) : text
    ), value);
  }
  return value;
};

const resolveExperimentCount = (task, explicitCount) => {
  if (explicitCount > 0) {
    return Math.max(explicitCount, MIN_EXPERIMENTS_PER_TASK);
  }
  const explicitCodes = Array.isArray(task?.experiment_codes)
    ? task.experiment_codes.map((code) => normalizeText(code)).filter(Boolean)
    : [];
  if (explicitCodes.length > 0) {
    return Math.max(explicitCodes.length, MIN_EXPERIMENTS_PER_TASK);
  }
  const explicitTaskCount = Number.parseInt(task?.experiment_count, 10);
  if (Number.isFinite(explicitTaskCount) && explicitTaskCount > 0) {
    return Math.max(explicitTaskCount, MIN_EXPERIMENTS_PER_TASK);
  }
  return Math.max(LEGACY_MULTI_EXPERIMENT_TASK_COUNTS[normalizeText(task?.code)] || 1, MIN_EXPERIMENTS_PER_TASK);
};

const buildExperimentTypes = (taskType, count) => {
  const types = [];
  const baseType = normalizeText(taskType);
  if (baseType) {
    types.push(baseType);
  }
  EXPERIMENT_TYPE_OPTIONS.forEach((experimentType) => {
    if (types.length >= count || types.includes(experimentType)) {
      return;
    }
    types.push(experimentType);
  });
  while (types.length < count) {
    types.push(baseType || EXPERIMENT_TYPE_OPTIONS[0]);
  }
  return types;
};

function migrateStorageSnapshot(snapshot) {
  const normalized = { ...(snapshot || {}) };
  const tasks = Array.isArray(normalized["mes.tasks"]) ? normalized["mes.tasks"].map((task) => ({ ...task })) : [];
  if (!tasks.some((task) => isLegacyMesTaskCode(task?.code))) {
    return normalized;
  }

  const samples = Array.isArray(normalized["mes.samples"]) ? normalized["mes.samples"].map((sample) => ({ ...sample })) : [];
  const schedules = Array.isArray(normalized["mes.schedules"]) ? normalized["mes.schedules"].map((schedule) => ({ ...schedule })) : [];
  const experiments = Array.isArray(normalized["mes.experiments"]) ? normalized["mes.experiments"].map((experiment) => ({ ...experiment })) : [];
  const experimentTrays = Array.isArray(normalized["mes.experiment_trays"]) ? normalized["mes.experiment_trays"].map((entry) => ({ ...entry })) : [];
  const streams = Array.isArray(normalized["mes.streams"]) ? normalized["mes.streams"].map((stream) => ({ ...stream })) : [];

  const reservedSequenceByMonth = new Map();
  const taskCodeMap = new Map();

  tasks.forEach((task) => {
    const legacyCode = normalizeText(task?.code);
    const match = legacyCode.match(SYLU_TASK_PATTERN);
    if (!match) {
      return;
    }
    const monthKey = `${match[1]}-${match[2]}`;
    reservedSequenceByMonth.set(monthKey, Math.max(reservedSequenceByMonth.get(monthKey) || 0, Number.parseInt(match[3], 10)));
    taskCodeMap.set(legacyCode, legacyCode);
  });

  tasks.slice().sort(compareTaskSortKey).forEach((task) => {
    const legacyCode = normalizeText(task?.code);
    if (!legacyCode || taskCodeMap.has(legacyCode)) {
      return;
    }
    const taskDate =
      parseStorageDate(task?.arrival_at) ||
      parseStorageDate(task?.created_at) ||
      parseStorageDate(task?.due_at) ||
      new Date("2026-01-01T00:00:00");
    const monthKey = `${taskDate.getFullYear()}-${String(taskDate.getMonth() + 1).padStart(2, "0")}`;
    const nextSequence = (reservedSequenceByMonth.get(monthKey) || 0) + 1;
    reservedSequenceByMonth.set(monthKey, nextSequence);
    taskCodeMap.set(
      legacyCode,
      `SYLU-${taskDate.getFullYear()}-${String(taskDate.getMonth() + 1).padStart(2, "0")}-${String(nextSequence).padStart(3, "0")}`,
    );
  });

  const sampleCodeMap = new Map();
  taskCodeMap.forEach((migratedTaskCode, taskCode) => {
    const taskSamples = samples
      .filter((sample) => normalizeText(sample?.task_code) === taskCode)
      .sort((left, right) => {
        const leftDate = parseStorageDate(left?.created_at)?.getTime() || 0;
        const rightDate = parseStorageDate(right?.created_at)?.getTime() || 0;
        if (leftDate !== rightDate) return leftDate - rightDate;
        return normalizeText(left?.code).localeCompare(normalizeText(right?.code), "zh-Hans-CN");
      });
    taskSamples.forEach((sample, index) => {
      const sampleCode = normalizeText(sample?.code);
      if (!sampleCode) {
        return;
      }
      const sampleSuffix = extractNumericSuffix(sampleCode, SAMPLE_SUFFIX_PATTERN, index);
      sampleCodeMap.set(sampleCode, `${migratedTaskCode}-SP-${String(sampleSuffix).padStart(3, "0")}`);
    });
  });

  const taskTrayCodes = new Map();
  const rememberTrayCode = (taskCode, trayCode) => {
    const normalizedTaskCode = normalizeText(taskCode);
    const normalizedTrayCode = normalizeText(trayCode);
    if (!normalizedTaskCode || !normalizedTrayCode) {
      return;
    }
    if (!taskTrayCodes.has(normalizedTaskCode)) {
      taskTrayCodes.set(normalizedTaskCode, []);
    }
    const trayCodes = taskTrayCodes.get(normalizedTaskCode);
    if (!trayCodes.includes(normalizedTrayCode)) {
      trayCodes.push(normalizedTrayCode);
    }
  };

  tasks.forEach((task) => {
    (Array.isArray(task?.tray_codes) ? task.tray_codes : []).forEach((trayCode) => rememberTrayCode(task?.code, trayCode));
  });
  samples.forEach((sample) => {
    (Array.isArray(sample?.trays) ? sample.trays : []).forEach((tray) => rememberTrayCode(sample?.task_code, tray?.tray_code));
  });
  experimentTrays.forEach((entry) => rememberTrayCode(entry?.task_code, entry?.tray_code));

  const trayCodeMap = new Map();
  taskTrayCodes.forEach((trayCodes, legacyTaskCode) => {
    const migratedTaskCode = taskCodeMap.get(legacyTaskCode) || legacyTaskCode;
    trayCodes
      .slice()
      .sort((left, right) => left.localeCompare(right, "zh-Hans-CN"))
      .forEach((trayCode, index) => {
        const traySuffix = extractNumericSuffix(trayCode, TRAY_SUFFIX_PATTERN, index);
        trayCodeMap.set(trayCode, `${migratedTaskCode}-TP-${String(traySuffix).padStart(3, "0")}`);
      });
  });

  const experimentsByTask = new Map();
  experiments.forEach((experiment) => {
    const taskCode = normalizeText(experiment?.task_code);
    if (!experimentsByTask.has(taskCode)) {
      experimentsByTask.set(taskCode, []);
    }
    experimentsByTask.get(taskCode).push(experiment);
  });

  const experimentCodeMap = new Map();
  const migratedExperiments = [];
  tasks.slice().sort(compareTaskSortKey).forEach((task) => {
    const legacyTaskCode = normalizeText(task?.code);
    const migratedTaskCode = taskCodeMap.get(legacyTaskCode) || legacyTaskCode;
    const explicitExperiments = (experimentsByTask.get(legacyTaskCode) || []).slice().sort((left, right) => (
      normalizeText(left?.experiment_code).localeCompare(normalizeText(right?.experiment_code), "zh-Hans-CN")
    ));
    const experimentCount = resolveExperimentCount(task, explicitExperiments.length);
    const experimentTypes = buildExperimentTypes(task?.test_type || task?.required_device, experimentCount);
    const sourceExperiments = explicitExperiments.length > 0
      ? explicitExperiments
      : Array.from({ length: experimentCount }, (_, index) => ({
          id: `${legacyTaskCode}-experiment-${index + 1}`,
          task_code: legacyTaskCode,
          experiment_code: `${legacyTaskCode}-${String.fromCharCode(65 + index)}`,
          experiment_name: experimentTypes[index],
          required_device: experimentTypes[index],
          priority: task?.priority || "",
          planned_hours: 0,
          status: task?.status || "待排程",
          created_at: task?.created_at,
          updated_at: task?.updated_at || task?.created_at,
        }));

    sourceExperiments.forEach((experiment, index) => {
      const suffix = extractExperimentSuffix(experiment?.experiment_code, index);
      const migratedExperimentCode = `${migratedTaskCode}-${suffix}`;
      const requiredDevice = normalizeText(experiment?.required_device) || experimentTypes[index];
      let experimentName = normalizeText(experiment?.experiment_name);
      if (!experimentName || /^[A-Z]实验$/.test(experimentName)) {
        experimentName = requiredDevice;
      }
      experimentCodeMap.set(normalizeText(experiment?.experiment_code), migratedExperimentCode);
      migratedExperiments.push({
        ...experiment,
        id: migratedExperimentCode,
        task_code: migratedTaskCode,
        experiment_code: migratedExperimentCode,
        experiment_name: experimentName,
        required_device: requiredDevice,
      });
    });
  });

  const taskExperimentCodes = new Map();
  migratedExperiments.forEach((experiment) => {
    const taskCode = normalizeText(experiment?.task_code);
    if (!taskExperimentCodes.has(taskCode)) {
      taskExperimentCodes.set(taskCode, []);
    }
    taskExperimentCodes.get(taskCode).push(normalizeText(experiment?.experiment_code));
  });

  tasks.forEach((task) => {
    const legacyTaskCode = normalizeText(task?.code);
    const migratedTaskCode = taskCodeMap.get(legacyTaskCode) || legacyTaskCode;
    task.code = migratedTaskCode;
    task.id = task.id || migratedTaskCode;
    task.experiment_codes = taskExperimentCodes.get(migratedTaskCode) || [];
    task.experiment_count = task.experiment_codes.length;
    task.tray_codes = (Array.isArray(task?.tray_codes) ? task.tray_codes : []).map((trayCode) => (
      trayCodeMap.get(normalizeText(trayCode)) || normalizeText(trayCode)
    ));
  });

  samples.forEach((sample) => {
    const legacyTaskCode = normalizeText(sample?.task_code);
    sample.task_code = taskCodeMap.get(legacyTaskCode) || legacyTaskCode;
    sample.code = sampleCodeMap.get(normalizeText(sample?.code)) || normalizeText(sample?.code);
    sample.trays = (Array.isArray(sample?.trays) ? sample.trays : []).map((tray) => ({
      ...tray,
      tray_code: trayCodeMap.get(normalizeText(tray?.tray_code)) || normalizeText(tray?.tray_code),
      sample_code: sampleCodeMap.get(normalizeText(tray?.sample_code)) || sample.code,
    }));
  });

  schedules.forEach((schedule) => {
    const legacyTaskCode = normalizeText(schedule?.task_code);
    const migratedTaskCode = taskCodeMap.get(legacyTaskCode) || legacyTaskCode;
    schedule.task_code = migratedTaskCode;
    const legacyExperimentCode = normalizeText(schedule?.experiment_code);
    let migratedExperimentCode = experimentCodeMap.get(legacyExperimentCode) || "";
    if (!migratedExperimentCode && legacyExperimentCode) {
      const suffix = extractExperimentSuffix(legacyExperimentCode, 0);
      const candidate = `${migratedTaskCode}-${suffix}`;
      if ((taskExperimentCodes.get(migratedTaskCode) || []).includes(candidate)) {
        migratedExperimentCode = candidate;
      }
    }
    if (!migratedExperimentCode && (taskExperimentCodes.get(migratedTaskCode) || []).length > 0) {
      migratedExperimentCode = taskExperimentCodes.get(migratedTaskCode)[0];
    }
    schedule.experiment_code = migratedExperimentCode;
  });

  experimentTrays.forEach((entry) => {
    const legacyTaskCode = normalizeText(entry?.task_code);
    entry.task_code = taskCodeMap.get(legacyTaskCode) || legacyTaskCode;
    entry.experiment_code = experimentCodeMap.get(normalizeText(entry?.experiment_code)) || normalizeText(entry?.experiment_code);
    entry.tray_code = trayCodeMap.get(normalizeText(entry?.tray_code)) || normalizeText(entry?.tray_code);
  });

  streams.forEach((stream) => {
    const legacyTaskCode = normalizeText(stream?.task_code);
    stream.task_code = taskCodeMap.get(legacyTaskCode) || legacyTaskCode;
  });

  const replacements = Object.fromEntries([
    ...taskCodeMap.entries(),
    ...sampleCodeMap.entries(),
    ...trayCodeMap.entries(),
    ...experimentCodeMap.entries(),
  ]);

  normalized["mes.tasks"] = replaceStrings(tasks, replacements);
  normalized["mes.samples"] = replaceStrings(samples, replacements);
  normalized["mes.schedules"] = replaceStrings(schedules, replacements);
  normalized["mes.experiments"] = replaceStrings(migratedExperiments, replacements);
  normalized["mes.experiment_trays"] = replaceStrings(experimentTrays, replacements);
  normalized["mes.streams"] = replaceStrings(streams, replacements);
  return normalized;
}

export { migrateStorageSnapshot };
