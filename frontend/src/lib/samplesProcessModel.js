const DEFAULT_TRAY_LIMIT = 5;
const DEFAULT_TRAY_COUNT = 2;

const normalizeText = (value) => String(value ?? "").trim();
const asArray = (value) => (Array.isArray(value) ? value : []);

const clone = (value) => JSON.parse(JSON.stringify(value));

const compareText = (left, right) => String(left || "").localeCompare(String(right || ""), "zh-Hans-CN");

const parsePositiveInt = (value) => {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }
  return Math.floor(parsed);
};

const createId = (prefix, now = new Date().toISOString()) => {
  const safeNow = String(now).replace(/[^0-9]/g, "").slice(0, 14) || "0";
  const random = Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, "0");
  return `${prefix}-${safeNow}-${random}`;
};

const buildTaskSampleCodes = (taskCode, plannedCount, taskSamples) => {
  const code = normalizeText(taskCode);
  if (!code) {
    return [];
  }

  const existingCodes = Array.from(
    new Set(
      asArray(taskSamples)
        .map((sample) => normalizeText(sample?.code))
        .filter(Boolean),
    ),
  );

  const pattern = new RegExp(`^${code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-SP-(\\d{3})$`);
  let maxIndex = 0;
  existingCodes.forEach((sampleCode) => {
    const match = sampleCode.match(pattern);
    if (!match) {
      return;
    }
    const index = Number.parseInt(match[1], 10);
    if (Number.isFinite(index)) {
      maxIndex = Math.max(maxIndex, index);
    }
  });

  let targetCount = parsePositiveInt(plannedCount);
  if (!targetCount) {
    targetCount = existingCodes.length || maxIndex;
  }

  const codes = [];
  for (let index = 1; index <= targetCount; index += 1) {
    codes.push(`${code}-SP-${String(index).padStart(3, "0")}`);
  }
  return codes;
};

const buildTaskTrayCode = (taskCode, serial) => {
  const code = normalizeText(taskCode);
  const index = parsePositiveInt(serial);
  if (!code || !index) {
    return "";
  }
  return `${code}-TP-${String(index).padStart(3, "0")}`;
};

const buildTaskProcessSamples = ({ taskCode, tasks, samples }) => {
  const code = normalizeText(taskCode);
  const task = asArray(tasks).find((item) => normalizeText(item?.code) === code) || null;
  const taskSamples = asArray(samples).filter((sample) => normalizeText(sample?.task_code) === code);
  const sampleCodes = buildTaskSampleCodes(code, task?.sample_count, taskSamples);
  return { task, taskSamples, sampleCodes };
};

const createBalancedTrays = ({ taskCode, sampleCodes, maxPerTray = DEFAULT_TRAY_LIMIT, minimumTrayCount = DEFAULT_TRAY_COUNT }) => {
  const codes = asArray(sampleCodes).map(normalizeText).filter(Boolean).sort(compareText);
  const safeLimit = Math.max(1, parsePositiveInt(maxPerTray) || DEFAULT_TRAY_LIMIT);
  const requiredTrayCount = codes.length ? Math.ceil(codes.length / safeLimit) : 1;
  const trayCount = Math.max(minimumTrayCount, requiredTrayCount);
  const trays = [];
  const baseSize = trayCount > 0 ? Math.floor(codes.length / trayCount) : 0;
  const remainder = trayCount > 0 ? codes.length % trayCount : 0;
  let cursor = 0;

  for (let index = 0; index < trayCount; index += 1) {
    const take = baseSize + (index < remainder ? 1 : 0);
    const samplesForTray = codes.slice(cursor, cursor + take);
    cursor += take;
    trays.push({
      id: `tray-draft-${index + 1}`,
      trayCode: buildTaskTrayCode(taskCode, index + 1),
      samples: samplesForTray,
    });
  }

  return trays;
};

const normalizeTrays = ({ taskCode, sampleCodes, trays, maxPerTray = DEFAULT_TRAY_LIMIT, minimumTrayCount = DEFAULT_TRAY_COUNT }) => {
  const codes = asArray(sampleCodes).map(normalizeText).filter(Boolean).sort(compareText);
  const allowed = new Set(codes);
  const limit = Math.max(1, parsePositiveInt(maxPerTray) || DEFAULT_TRAY_LIMIT);
  const normalized = [];
  const assigned = new Set();

  asArray(trays).forEach((tray, index) => {
    const traySamples = [];
    asArray(tray?.samples)
      .map(normalizeText)
      .filter(Boolean)
      .sort(compareText)
      .forEach((sampleCode) => {
        if (!allowed.has(sampleCode) || assigned.has(sampleCode) || traySamples.length >= limit) {
          return;
        }
        assigned.add(sampleCode);
        traySamples.push(sampleCode);
      });

    normalized.push({
      id: normalizeText(tray?.id) || `tray-draft-${index + 1}`,
      trayCode: normalizeText(tray?.trayCode) || buildTaskTrayCode(taskCode, index + 1),
      samples: traySamples,
    });
  });

  const unassigned = codes.filter((sampleCode) => !assigned.has(sampleCode));
  unassigned.forEach((sampleCode) => {
    const target = normalized.find((tray) => tray.samples.length < limit);
    if (target) {
      target.samples.push(sampleCode);
      return;
    }
    normalized.push({
      id: `tray-draft-${normalized.length + 1}`,
      trayCode: "",
      samples: [sampleCode],
    });
  });

  while (normalized.length < Math.max(minimumTrayCount, codes.length ? 1 : minimumTrayCount)) {
    normalized.push({
      id: `tray-draft-${normalized.length + 1}`,
      trayCode: "",
      samples: [],
    });
  }

  normalized.sort((left, right) => {
    const leftKey = left.samples[0] || "~~~";
    const rightKey = right.samples[0] || "~~~";
    return compareText(leftKey, rightKey);
  });

  return normalized.map((tray, index) => ({
    ...tray,
    trayCode: buildTaskTrayCode(taskCode, index + 1),
    samples: tray.samples.slice().sort(compareText),
  }));
};

const buildExistingTaskTrays = ({ taskCode, taskSamples, sampleCodes, maxPerTray }) => {
  const allowed = new Set(sampleCodes);
  const trayMap = new Map();

  asArray(taskSamples).forEach((sample) => {
    const sampleCode = normalizeText(sample?.code);
    if (!allowed.has(sampleCode)) {
      return;
    }
    asArray(sample?.trays).forEach((tray, index) => {
      const trayCode = normalizeText(tray?.tray_code) || buildTaskTrayCode(taskCode, index + 1);
      if (!trayMap.has(trayCode)) {
        trayMap.set(trayCode, {
          id: normalizeText(tray?.id) || `tray-draft-${trayMap.size + 1}`,
          trayCode,
          samples: [],
        });
      }
      const entry = trayMap.get(trayCode);
      if (!entry.samples.includes(sampleCode)) {
        entry.samples.push(sampleCode);
      }
    });
  });

  if (trayMap.size === 0) {
    return [];
  }

  return normalizeTrays({
    taskCode,
    sampleCodes,
    trays: Array.from(trayMap.values()),
    maxPerTray,
  });
};

function buildSampleProcessTaskOptions({ tasks, samples }) {
  const sampleTaskCodes = new Set(asArray(samples).map((sample) => normalizeText(sample?.task_code)).filter(Boolean));

  return asArray(tasks)
    .filter((task) => parsePositiveInt(task?.sample_count) > 0 || sampleTaskCodes.has(normalizeText(task?.code)))
    .map((task) => ({
      code: normalizeText(task?.code),
      label: [normalizeText(task?.code), normalizeText(task?.name)].filter(Boolean).join(" | "),
      sampleCount: parsePositiveInt(task?.sample_count),
    }))
    .filter((option) => option.code)
    .sort((left, right) => compareText(left.code, right.code));
}

function buildBalancedTrayDraft({ taskCode, sampleCodes, maxPerTray = DEFAULT_TRAY_LIMIT, trayCount = DEFAULT_TRAY_COUNT }) {
  return createBalancedTrays({
    taskCode,
    sampleCodes,
    maxPerTray,
    minimumTrayCount: trayCount,
  });
}

function selectTaskProcessDraft({ taskCode, tasks, samples }) {
  const code = normalizeText(taskCode);
  const { task, taskSamples, sampleCodes } = buildTaskProcessSamples({ taskCode: code, tasks, samples });
  const maxPerTray = DEFAULT_TRAY_LIMIT;
  const traysWithExisting = buildExistingTaskTrays({ taskCode: code, taskSamples, sampleCodes, maxPerTray });
  const trays = traysWithExisting.some((tray) => tray.samples.length > 0)
    ? traysWithExisting
    : createBalancedTrays({ taskCode: code, sampleCodes, maxPerTray });

  return {
    taskCode: code,
    sampleCount: parsePositiveInt(task?.sample_count) || sampleCodes.length,
    sampleCodes,
    maxPerTray,
    trays,
  };
}

function moveSampleBetweenTrays({ trayDraft, sampleCode, targetIndex }) {
  const code = normalizeText(sampleCode);
  const sourceDraft = clone(trayDraft || {});
  const trayIndex = Number.parseInt(targetIndex, 10);
  if (!code || !Number.isFinite(trayIndex) || trayIndex < 0) {
    return { moved: false, trays: asArray(sourceDraft.trays) };
  }

  const normalized = normalizeTrays({
    taskCode: normalizeText(sourceDraft.taskCode),
    sampleCodes: asArray(sourceDraft.sampleCodes),
    trays: asArray(sourceDraft.trays),
    maxPerTray: sourceDraft.maxPerTray,
  });

  if (trayIndex >= normalized.length) {
    return { moved: false, trays: normalized };
  }

  const currentIndex = normalized.findIndex((tray) => tray.samples.includes(code));
  if (currentIndex === trayIndex) {
    return { moved: true, trays: normalized };
  }

  const limit = Math.max(1, parsePositiveInt(sourceDraft.maxPerTray) || DEFAULT_TRAY_LIMIT);
  if (normalized[trayIndex].samples.length >= limit) {
    return { moved: false, trays: normalized };
  }

  if (currentIndex >= 0) {
    normalized[currentIndex].samples = normalized[currentIndex].samples.filter((item) => item !== code);
  }
  normalized[trayIndex].samples.push(code);

  return {
    moved: true,
    trays: normalizeTrays({
      taskCode: normalizeText(sourceDraft.taskCode),
      sampleCodes: asArray(sourceDraft.sampleCodes),
      trays: normalized,
      maxPerTray: sourceDraft.maxPerTray,
    }),
  };
}

function removeTrayFromDraft({ taskCode, sampleCodes, maxPerTray = DEFAULT_TRAY_LIMIT, trays, removeIndex }) {
  const targetIndex = Number.parseInt(removeIndex, 10);
  const sourceTrays = asArray(trays);
  if (!Number.isFinite(targetIndex) || targetIndex < 0 || targetIndex >= sourceTrays.length) {
    return normalizeTrays({
      taskCode,
      sampleCodes,
      trays: sourceTrays,
      maxPerTray,
    });
  }

  const remainingCount = Math.max(1, sourceTrays.length - 1);
  return buildBalancedTrayDraft({
    taskCode,
    sampleCodes,
    maxPerTray,
    trayCount: remainingCount,
  });
}

const resolveSampleStatus = () => "到货";
const resolveFlowStatus = () => "到货";

const appendSampleHistory = (sample, action, detail = "", nowIso) => {
  if (!Array.isArray(sample.history)) {
    sample.history = [];
  }
  sample.history.unshift({
    id: createId("sample-event", nowIso),
    time: nowIso,
    action,
    location: normalizeText(sample.location),
    owner: normalizeText(sample.owner),
    status: normalizeText(sample.status),
    detail: normalizeText(detail),
  });
};

function confirmSampleTaskStore({ taskCode, tasks, samples, trayDraft, labels = {}, now = new Date().toISOString() }) {
  const code = normalizeText(taskCode);
  if (!code) {
    return { error: "请先选择任务。" };
  }

  const targetLocation =
    normalizeText(labels.intakeLocation) ||
    normalizeText(labels.unpackingLocation) ||
    normalizeText(labels.preRetentionLocation) ||
    normalizeText(labels.retentionLocation);

  if (!targetLocation) {
    return { error: "未配置默认入库位置。" };
  }

  const nextTasks = asArray(tasks).map((task) => ({ ...task }));
  const nextSamples = asArray(samples).map((sample) => clone(sample));
  const task = nextTasks.find((item) => normalizeText(item?.code) === code) || null;
  const taskSamples = nextSamples.filter((sample) => normalizeText(sample?.task_code) === code);
  const availableCodes = buildTaskSampleCodes(code, task?.sample_count, taskSamples);
  const selectedCodes = asArray(trayDraft?.sampleCodes).map(normalizeText).filter(Boolean);
  const codes = selectedCodes.length ? selectedCodes : availableCodes;

  if (!codes.length) {
    return { error: `任务 ${code} 暂无可入库样品编号。` };
  }

  const normalizedTrays = normalizeTrays({
    taskCode: code,
    sampleCodes: codes,
    trays: asArray(trayDraft?.trays),
    maxPerTray: trayDraft?.maxPerTray,
  });

  const trayCodes = normalizedTrays.map((tray) => tray.trayCode).filter(Boolean);
  const codesWithoutTray = codes.filter((sampleCode) => !normalizedTrays.some((tray) => tray.samples.includes(sampleCode)));
  if (codesWithoutTray.length) {
    return { error: `以下样品未配置分装托盘：${codesWithoutTray.join("、")}` };
  }

  const status = resolveSampleStatus(labels);
  const flowStatus = resolveFlowStatus(labels);
  const updatedSamples = [];
  const outOfTask = [];

  codes.forEach((sampleCode) => {
    let sample = nextSamples.find((item) => normalizeText(item?.code) === sampleCode);
    if (!sample) {
      sample = {
        id: createId("sample", now),
        code: sampleCode,
        created_at: now,
      };
      nextSamples.push(sample);
    }

    const boundTaskCode = normalizeText(sample.task_code);
    if (boundTaskCode && boundTaskCode !== code) {
      outOfTask.push(sampleCode);
      return;
    }

    sample.task_code = code;
    sample.location = targetLocation;
    sample.status = status;
    sample.flow_status = flowStatus;
    sample.updated_at = now;
    sample.trays = normalizedTrays
      .filter((tray) => tray.samples.includes(sampleCode))
      .map((tray, index) => {
        const existing = asArray(sample.trays).find((entry) => normalizeText(entry?.tray_code) === tray.trayCode) || {};
        return {
          id: normalizeText(existing.id) || createId("tray", now),
          tray_code: tray.trayCode,
          sample_code: sampleCode,
          quantity: 1,
          created_at: normalizeText(existing.created_at) || normalizeText(sample.created_at) || now,
          updated_at: now,
        };
      });

    appendSampleHistory(sample, "样品分装托盘", `共 ${sample.trays.length} 盘，合计数量 ${sample.trays.reduce((sum, tray) => sum + Number(tray.quantity || 0), 0)}`, now);
    appendSampleHistory(sample, "任务样品入库（接驳区）", `任务 ${code}`, now);
    updatedSamples.push(sample);
  });

  if (outOfTask.length > 0) {
    return { error: `样品不属于任务 ${code}：${outOfTask.join("、")}` };
  }

  if (task) {
    task.tray_codes = Array.from(new Set(trayCodes)).sort(compareText);
    task.updated_at = now;
  }

  return {
    tasks: nextTasks,
    samples: nextSamples.sort((left, right) => compareText(left.code, right.code)),
    trayCodes: Array.from(new Set(trayCodes)).sort(compareText),
    warning: `任务 ${code} 已登记到 ${targetLocation} ${updatedSamples.length} 个样品。`,
  };
}

function buildTrayPrintPayload({ taskCode, trayCodes }) {
  return {
    taskCode: normalizeText(taskCode),
    trayCodes: Array.from(new Set(asArray(trayCodes).map(normalizeText).filter(Boolean))).sort(compareText),
  };
}

export {
  buildBalancedTrayDraft,
  buildSampleProcessTaskOptions,
  buildTaskTrayCode,
  buildTrayPrintPayload,
  confirmSampleTaskStore,
  moveSampleBetweenTrays,
  removeTrayFromDraft,
  selectTaskProcessDraft,
};
