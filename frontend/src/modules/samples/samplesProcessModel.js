const DEFAULT_TRAY_LIMIT = 5;
const DEFAULT_TRAY_COUNT = 1;
const TEST_TYPE_LABS = Object.freeze({
  冲击试验: ["冲击一室", "冲击二室"],
  振动试验: ["振动一室", "振动二室"],
  四综合试验: ["四综合实验室"],
  温度冲击试验: ["温度冲击一室", "温度冲击二室"],
  高低温湿热试验: ["高低温湿热一室"],
  盐雾试验: ["盐雾试验室"],
  霉菌试验: ["霉菌试验室"],
});
const TASK_STATUS_WAITING = "待排程";
const TASK_STATUS_RUNNING = "实验中";
const TASK_STATUS_COMPLETED = "实验已经完成";
const TASK_STATUS_RETURNED = "厂家收回";
const ACTIVE_TRAY_STATUSES = new Set(["送至实验室", "已到达实验室", "工装夹具安装", "实验准备就绪", "实验进行中", TASK_STATUS_RUNNING]);
const COMPLETED_TRAY_STATUSES = new Set(["实验已完成", "实验完成", "放置实验后暂存间", TASK_STATUS_RETURNED]);
const RETURNED_TRAY_STATUSES = new Set([TASK_STATUS_RETURNED]);

// 该模型负责让托盘均衡分配和入库更新保持可预测、可测试。
const normalizeText = (value) => String(value ?? "").trim();
const asArray = (value) => (Array.isArray(value) ? value : []);

// 草稿操作里会频繁做不可变更新，这里用深拷贝隔离引用。
const clone = (value) => JSON.parse(JSON.stringify(value));

const compareText = (left, right) => String(left || "").localeCompare(String(right || ""), "zh-Hans-CN");
const formatTaskArrivalTime = (value) => {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }
  return text.includes("T") ? text.replace("T", " ").slice(0, 19) : text.slice(0, 19);
};

const parsePositiveInt = (value) => {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }
  return Math.floor(parsed);
};

const parseDate = (value) => {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const padNumber = (value) => String(value).padStart(2, "0");

const formatOutboundScheduleText = (schedule) => {
  const startAt = parseDate(schedule?.start_at);
  const endAt = parseDate(schedule?.end_at);
  if (!startAt || !endAt) {
    return "未排程";
  }
  return `${padNumber(startAt.getMonth() + 1)}/${padNumber(startAt.getDate())} ${padNumber(startAt.getHours())}:${padNumber(startAt.getMinutes())} - ${padNumber(endAt.getMonth() + 1)}/${padNumber(endAt.getDate())} ${padNumber(endAt.getHours())}:${padNumber(endAt.getMinutes())}`;
};

const getLabsForTestType = (testType) => {
  const normalizedType = normalizeText(testType);
  return Array.isArray(TEST_TYPE_LABS[normalizedType]) ? TEST_TYPE_LABS[normalizedType] : [];
};

const collectTaskTrayStatuses = (taskCode, samples) => {
  const code = normalizeText(taskCode);
  const trayStatusMap = new Map();
  const fallbackStatuses = [];

  asArray(samples).forEach((sample) => {
    if (normalizeText(sample?.task_code) !== code) {
      return;
    }

    const sampleStatus = normalizeLifecycleStatus(sample?.location, sample?.status);
    const sampleTrays = asArray(sample?.trays);
    if (sampleTrays.length === 0) {
      if (sampleStatus) {
        fallbackStatuses.push(sampleStatus);
      }
      return;
    }

    sampleTrays.forEach((tray, index) => {
      const trayCode = normalizeText(tray?.tray_code) || `${code}-tray-${index + 1}`;
      const trayStatus = normalizeLifecycleStatus(sample?.location, normalizeText(tray?.status) || sampleStatus);
      if (trayStatus) {
        trayStatusMap.set(trayCode, trayStatus);
      }
    });
  });

  return trayStatusMap.size > 0 ? Array.from(trayStatusMap.values()) : fallbackStatuses;
};

const resolveTaskDisplayStatus = (task, samples) => {
  const trayStatuses = collectTaskTrayStatuses(task?.code, samples);
  if (trayStatuses.length > 0) {
    if (trayStatuses.every((status) => RETURNED_TRAY_STATUSES.has(status))) {
      return TASK_STATUS_RETURNED;
    }
    if (trayStatuses.every((status) => COMPLETED_TRAY_STATUSES.has(status))) {
      return TASK_STATUS_COMPLETED;
    }
    if (trayStatuses.some((status) => ACTIVE_TRAY_STATUSES.has(status))) {
      return TASK_STATUS_RUNNING;
    }
  }

  return normalizeText(task?.displayStatus || task?.display_status || task?.status) || TASK_STATUS_WAITING;
};

// 样品、托盘、历史记录的默认 ID 都走同一套生成逻辑。
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
    // 没有明确计划数时，优先以现有样品数或已出现过的最大编号为准。
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

// 按最大托盘容量将样品均衡拆分成若干托盘草稿。
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
    // 使用“平均分 + 余数前置”策略，让前几个托盘多一个样品。
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
        // 非当前任务样品、重复样品或超容量样品都会被过滤掉。
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
    // 剩余未分配样品会尽量塞进还有容量的托盘，否则新建空托盘承接。
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
    const leftEmpty = left.samples.length === 0;
    const rightEmpty = right.samples.length === 0;
    if (leftEmpty !== rightEmpty) {
      return leftEmpty ? 1 : -1;
    }
    const leftKey = left.samples[0] || "";
    const rightKey = right.samples[0] || "";
    return compareText(leftKey, rightKey);
  });

  // 归一化后会重新顺排托盘编号，保证托盘号连续。
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
      // 样品已有托盘分配时，先按 trayCode 聚合回草稿。
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

// 构建开始托盘分配前展示的任务选项。
function buildSampleProcessTaskOptions({ tasks, samples }) {
  const sampleTaskCodes = new Set(asArray(samples).map((sample) => normalizeText(sample?.task_code)).filter(Boolean));

  return asArray(tasks)
    .filter((task) => parsePositiveInt(task?.sample_count) > 0 || sampleTaskCodes.has(normalizeText(task?.code)))
    .map((task) => ({
      code: normalizeText(task?.code),
      displayStatus: resolveTaskDisplayStatus(task, samples),
      label: [normalizeText(task?.code), normalizeText(task?.name)].filter(Boolean).join(" | "),
      sampleCount: parsePositiveInt(task?.sample_count),
      status: normalizeText(task?.status),
    }))
    .filter((option) => option.code)
    .sort((left, right) => compareText(left.code, right.code));
}

// 为草稿布局将样品编号尽量均衡地分配到托盘槽位。
function buildBalancedTrayDraft({ taskCode, sampleCodes, maxPerTray = DEFAULT_TRAY_LIMIT, trayCount = DEFAULT_TRAY_COUNT }) {
  return createBalancedTrays({
    taskCode,
    sampleCodes,
    maxPerTray,
    minimumTrayCount: trayCount,
  });
}

// 基于已存样品和托盘状态重建指定任务的托盘草稿。
function selectTaskProcessDraft({ taskCode, tasks, samples, preferExistingTrays = true }) {
  const code = normalizeText(taskCode);
  const { task, taskSamples, sampleCodes } = buildTaskProcessSamples({ taskCode: code, tasks, samples });
  const maxPerTray = DEFAULT_TRAY_LIMIT;
  const traysWithExisting = preferExistingTrays ? buildExistingTaskTrays({ taskCode: code, taskSamples, sampleCodes, maxPerTray }) : [];
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

// 将样品编号从当前托盘移动到指定目标托盘。
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
  // 目标托盘已满时禁止移动，保持容量约束不被破坏。
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

// 从草稿中移除一个托盘，并重新均衡剩余分配。
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
    // 托盘入库会连续写入多条历史，保留每次动作的完整上下文。
    id: createId("sample-event", nowIso),
    time: nowIso,
    action,
    location: normalizeText(sample.location),
    owner: normalizeText(sample.owner),
    status: normalizeText(sample.status),
    detail: normalizeText(detail),
  });
};

// 将确认后的托盘分配结果回写到任务和样品数据中。
function confirmSampleTaskStore({ taskCode, tasks, samples, trayDraft, labels = {}, now = new Date().toISOString(), arrivalTime = "" }) {
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

  // 未选择样品时回退到任务下全部可用样品号。
  if (!codes.length) {
    return { error: `任务 ${code} 暂无可入库样品编号。` };
  }

  const normalizedTrays = normalizeTrays({
    taskCode: code,
    sampleCodes: codes,
    trays: asArray(trayDraft?.trays),
    maxPerTray: trayDraft?.maxPerTray,
  });
  const assignedTrays = normalizedTrays.filter((tray) => asArray(tray?.samples).length > 0);

  const trayCodes = assignedTrays.map((tray) => tray.trayCode).filter(Boolean);
  const codesWithoutTray = codes.filter((sampleCode) => !assignedTrays.some((tray) => tray.samples.includes(sampleCode)));
  // 任何样品未落到托盘都会阻止确认入库。
  if (codesWithoutTray.length) {
    return { error: `以下样品未配置分装托盘：${codesWithoutTray.join("、")}` };
  }

  const trayStatus = resolveSampleStatus(labels);
  const status = trayStatus;
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
      // 已绑定到其他任务的样品不能被当前任务强行接管。
      outOfTask.push(sampleCode);
      return;
    }

    sample.task_code = code;
    sample.location = targetLocation;
    sample.status = status;
    sample.flow_status = flowStatus;
    sample.updated_at = now;
    sample.trays = assignedTrays
      .filter((tray) => tray.samples.includes(sampleCode))
      .map((tray) => {
        const existing = asArray(sample.trays).find((entry) => normalizeText(entry?.tray_code) === tray.trayCode) || {};
        return {
          id: normalizeText(existing.id) || createId("tray", now),
          tray_code: tray.trayCode,
          sample_code: sampleCode,
          status: trayStatus,
          quantity: 1,
          created_at: normalizeText(existing.created_at) || normalizeText(sample.created_at) || now,
          updated_at: now,
        };
      });

    // 每个样品会同时记录“分装托盘”和“任务入库”两条历史。
    appendSampleHistory(sample, "样品分装托盘", `共 ${sample.trays.length} 盘，合计数量 ${sample.trays.reduce((sum, tray) => sum + Number(tray.quantity || 0), 0)}`, now);
    appendSampleHistory(sample, "任务样品入库（接驳区）", `任务 ${code}`, now);
    updatedSamples.push(sample);
  });

  if (outOfTask.length > 0) {
    return { error: `样品不属于任务 ${code}：${outOfTask.join("、")}` };
  }

  if (task) {
    task.tray_codes = Array.from(new Set(trayCodes)).sort(compareText);
    task.arrival_at = formatTaskArrivalTime(arrivalTime || now);
    task.updated_at = now;
  }

  return {
    tasks: nextTasks,
    samples: nextSamples.sort((left, right) => compareText(left.code, right.code)),
    trayCodes: Array.from(new Set(trayCodes)).sort(compareText),
    warning: `任务 ${code} 已登记到 ${targetLocation} ${updatedSamples.length} 个样品。`,
  };
}

function buildTrayOutboundDestinations({ taskCode, trayCode, tasks, schedules, labels = {} }) {
  const code = normalizeText(taskCode);
  const normalizedTrayCode = normalizeText(trayCode);
  const task = asArray(tasks).find((item) => normalizeText(item?.code) === code) || null;
  const testType = normalizeText(task?.test_type);
  const stagingLocation = normalizeText(labels.preRetentionLocation || labels.retentionLocation) || "恒温恒湿间（暂存间）";
  const relatedLabSchedules = asArray(schedules).filter(
    (schedule) => normalizeText(schedule?.task_code) === code && !normalizeText(schedule?.device).includes("暂存间"),
  );

  const cards = [
    {
      available: true,
      highlighted: false,
      key: "staging",
      label: "暂存间",
      location: stagingLocation,
      scheduleText: "中转缓冲",
      status: "送至暂存间",
      taskCode: code,
      testType,
      trayCode: normalizedTrayCode,
      variant: "staging",
    },
  ];

  getLabsForTestType(testType).forEach((lab) => {
    const matchedSchedule = relatedLabSchedules.find((schedule) => normalizeText(schedule?.device) === lab) || null;
    cards.push({
      available: Boolean(matchedSchedule),
      highlighted: Boolean(matchedSchedule),
      key: `lab:${lab}`,
      label: lab,
      location: lab,
      scheduleText: matchedSchedule ? formatOutboundScheduleText(matchedSchedule) : "未排程",
      status: "送至实验室",
      taskCode: code,
      testType,
      trayCode: normalizedTrayCode,
      variant: matchedSchedule ? "lab-scheduled" : "lab-disabled",
    });
  });

  return {
    cards,
    taskCode: code,
    taskName: normalizeText(task?.name),
    testType,
    trayCode: normalizedTrayCode,
  };
}

function submitTrayOutbound({ taskCode, trayCode, destination, samples, now = new Date().toISOString() }) {
  const normalizedTaskCode = normalizeText(taskCode);
  const normalizedTrayCode = normalizeText(trayCode);
  const target = destination && typeof destination === "object" ? destination : null;
  const nextSamples = asArray(samples).map((sample) => clone(sample));

  if (!normalizedTrayCode || !target) {
    return { error: "请先扫码托盘并选择出库目的地。", samples: nextSamples };
  }
  if (!target.available) {
    return { error: "当前目的地不可选，请先使用暂存间或已排程实验室。", samples: nextSamples };
  }

  let updatedCount = 0;
  nextSamples.forEach((sample) => {
    if (normalizedTaskCode && normalizeText(sample?.task_code) !== normalizedTaskCode) {
      return;
    }
    const sampleTrays = asArray(sample?.trays);
    if (!sampleTrays.some((tray) => normalizeText(tray?.tray_code) === normalizedTrayCode)) {
      return;
    }

    sample.trays = sampleTrays.map((tray) =>
      normalizeText(tray?.tray_code) === normalizedTrayCode
        ? {
            ...tray,
            status: normalizeText(target.status),
            updated_at: now,
          }
        : tray,
    );
    sample.location = normalizeText(target.location);
    sample.status = normalizeText(target.status);
    sample.flow_status = normalizeText(target.status);
    sample.updated_at = now;
    appendSampleHistory(sample, "扫码出库", `${normalizedTrayCode} -> ${normalizeText(target.label)}`, now);
    updatedCount += 1;
  });

  return {
    error: updatedCount > 0 ? "" : `未找到托盘 ${normalizedTrayCode}。`,
    samples: nextSamples,
    warning: updatedCount > 0 ? `托盘 ${normalizedTrayCode} 已${normalizeText(target.status)}。` : "",
  };
}

// 标准化托盘标签打印弹窗所需的打印载荷。
function buildTrayPrintPayload({ taskCode, trayCodes }) {
  return {
    taskCode: normalizeText(taskCode),
    trayCodes: Array.from(new Set(asArray(trayCodes).map(normalizeText).filter(Boolean))).sort(compareText),
  };
}

export {
  buildBalancedTrayDraft,
  buildTrayOutboundDestinations,
  buildSampleProcessTaskOptions,
  buildTaskTrayCode,
  buildTrayPrintPayload,
  confirmSampleTaskStore,
  moveSampleBetweenTrays,
  removeTrayFromDraft,
  selectTaskProcessDraft,
  submitTrayOutbound,
};
import { normalizeLifecycleStatus } from "./samplesFlowModel";
