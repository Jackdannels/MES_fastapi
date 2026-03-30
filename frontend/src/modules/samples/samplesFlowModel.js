// 构建样品流转列表、暂存视图和更新辅助逻辑。
const DEFAULT_LABELS = {
  intakeLocation: "\u63A5\u9A73\u533A",
  unpackingLocation: "\u62C6\u7BB1\u64CD\u4F5C\u95F4",
  preRetentionLocation: "\u6052\u6E29\u6052\u6E7F\u95F4\uFF08\u6682\u5B58\u95F4\uFF09",
  retentionLocation: "\u6052\u6E29\u6052\u6E7F\u95F4\uFF08\u6682\u5B58\u95F4\uFF09",
  postRetentionLocation: "\u6052\u6E29\u6052\u6E7F\u95F4\uFF08\u5B9E\u9A8C\u540E\u6682\u5B58\u95F4\uFF09",
  sampleReceived: "\u5DF2\u63A5\u6536",
  sampleTesting: "\u8BD5\u9A8C\u4E2D",
  sampleStored: "\u5DF2\u5165\u5E93",
};

const TEST_LABS = new Set([
  "\u51B2\u51FB\u4E00\u5BA4",
  "\u51B2\u51FB\u4E8C\u5BA4",
  "\u632F\u52A8\u4E00\u5BA4",
  "\u632F\u52A8\u4E8C\u5BA4",
  "\u56DB\u7EFC\u5408\u5B9E\u9A8C\u5BA4",
  "\u6E29\u5EA6\u51B2\u51FB\u4E00\u5BA4",
  "\u6E29\u5EA6\u51B2\u51FB\u4E8C\u5BA4",
  "\u9AD8\u4F4E\u6E29\u6E7F\u70ED\u4E00\u5BA4",
  "\u76D0\u96FE\u8BD5\u9A8C\u5BA4",
  "\u9709\u83CC\u8BD5\u9A8C\u5BA4",
]);

const TEST_LAB_OPTIONS = Array.from(TEST_LABS).sort((left, right) => left.localeCompare(right, "zh-Hans-CN"));

const SAMPLE_FLOW_STEPS = [
  { key: "in_transit", label: "\u6837\u54C1\u8FD0\u8F93\u4E2D" },
  { key: "arrived", label: "\u5230\u8D27" },
  { key: "sent_to_staging", label: "\u9001\u81F3\u6682\u5B58\u95F4" },
  { key: "arrived_staging", label: "\u5DF2\u5230\u8FBE\u6682\u5B58\u95F4" },
  { key: "sent_to_lab", label: "\u9001\u81F3\u5B9E\u9A8C\u5BA4" },
  { key: "arrived_lab", label: "\u5DF2\u5230\u8FBE\u5B9E\u9A8C\u5BA4" },
  { key: "fixture_install", label: "\u5DE5\u88C5\u5939\u5177\u5B89\u88C5" },
  { key: "ready", label: "\u5B9E\u9A8C\u51C6\u5907\u5C31\u7EEA" },
  { key: "running", label: "\u5B9E\u9A8C\u8FDB\u884C\u4E2D" },
  { key: "completed", label: "\u5B9E\u9A8C\u5DF2\u5B8C\u6210" },
  { key: "post_test_staging", label: "\u653E\u7F6E\u5B9E\u9A8C\u540E\u6682\u5B58\u95F4" },
  { key: "returned", label: "\u5382\u5BB6\u6536\u56DE" },
];

const FLOW_STEP_KEY_BY_LABEL = new Map(SAMPLE_FLOW_STEPS.map((step) => [step.label, step.key]));
const FLOW_STEP_INDEX_BY_KEY = new Map(SAMPLE_FLOW_STEPS.map((step, index) => [step.key, index]));

const DETAIL_STATUS_OPTIONS = SAMPLE_FLOW_STEPS.map((step) => step.label);
const FLOW_STATUS_LABELS = new Set(DETAIL_STATUS_OPTIONS);
const TRAY_STATUS_OPTIONS = DETAIL_STATUS_OPTIONS.slice();

// 样品流转涉及大量字符串比较，统一先做基础规范化。
const normalizeText = (value) => String(value ?? "").trim();

// 允许通过覆盖 labels 复用同一套状态推导逻辑。
const normalizeLabels = (labels = {}) => ({
  ...DEFAULT_LABELS,
  ...(labels && typeof labels === "object" ? labels : {}),
});

const normalizeLifecycleStatus = (location, status = "", labels = DEFAULT_LABELS) => {
  const normalizedLabels = normalizeLabels(labels);
  const normalizedLocation = normalizeText(location);
  const currentStatus = normalizeText(status);
  const preRetentionLocation = normalizeText(
    normalizedLabels.preRetentionLocation || normalizedLabels.retentionLocation,
  );
  const postRetentionLocation = normalizeText(normalizedLabels.postRetentionLocation);
  const isPreRetention = normalizedLocation && normalizedLocation === preRetentionLocation;
  const isPostRetention = normalizedLocation && normalizedLocation === postRetentionLocation;

  if (FLOW_STATUS_LABELS.has(currentStatus)) {
    return currentStatus === "运输中" ? "样品运输中" : currentStatus;
  }
  if (currentStatus === "运输中") {
    return "样品运输中";
  }
  if (currentStatus === "厂家收回" || currentStatus === "已处置") {
    return "厂家收回";
  }
  if (currentStatus === "放置暂存间") {
    return "放置实验后暂存间";
  }
  if (currentStatus === "入库" || currentStatus === "已入库" || currentStatus === normalizedLabels.sampleStored) {
    return isPostRetention ? "放置实验后暂存间" : isPreRetention ? "已到达暂存间" : "到货";
  }
  if (currentStatus === "实验完成" || currentStatus === "实验已完成") {
    return "实验已完成";
  }
  if (currentStatus === "实验进行中" || currentStatus === "实验中") {
    return "实验进行中";
  }
  if (currentStatus === "实验准备就绪" || currentStatus === normalizedLabels.sampleTesting) {
    return "实验准备就绪";
  }
  if (isPostRetention) {
    return "放置实验后暂存间";
  }
  if (isPreRetention) {
    return "已到达暂存间";
  }
  if (TEST_LABS.has(normalizedLocation)) {
    return "已到达实验室";
  }
  if (
    normalizedLocation &&
    (normalizedLocation === normalizeText(normalizedLabels.unpackingLocation) ||
      normalizedLocation === normalizeText(normalizedLabels.intakeLocation))
  ) {
    return "到货";
  }
  return SAMPLE_FLOW_STEPS[0].label;
};

const normalizeSampleRecord = (sample, labels = DEFAULT_LABELS) => {
  const record = sample && typeof sample === "object" ? { ...sample } : {};
  const normalizedStatus = normalizeLifecycleStatus(record.location, record.status, labels);
  const trays = Array.isArray(record.trays)
    ? record.trays.map((tray) => ({
        ...tray,
        status: normalizeLifecycleStatus(record.location, normalizeText(tray?.status) || normalizedStatus, labels),
      }))
    : [];

  return {
    ...record,
    flow_status: normalizedStatus,
    status: normalizedStatus,
    trays,
  };
};

const normalizeSamplesSnapshot = (samples, labels = DEFAULT_LABELS) =>
  (Array.isArray(samples) ? samples : []).map((sample) => normalizeSampleRecord(sample, labels));

// 托盘状态与样品状态保持同一套规范流程标签。
const syncTrayStatusToSampleStatus = (status, location = "", labels = DEFAULT_LABELS) =>
  normalizeLifecycleStatus(location, status, labels);

// 批量创建样品和历史记录时使用轻量级随机 ID。
const generateId = (prefix) => {
  const stamp = Date.now();
  const rand = Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, "0");
  return `${prefix}-${stamp}-${rand}`;
};

// 批量输入框支持按空格、逗号和分号拆分样品号。
const parseCodeList = (value) =>
  Array.from(
    new Set(
      String(value ?? "")
        .split(/[\s,\uFF0C;\uFF1B]+/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );

const compareText = (left, right) => normalizeText(left).localeCompare(normalizeText(right), "zh-Hans-CN");
const parseTimeValue = (value) => {
  const timestamp = Date.parse(String(value ?? ""));
  return Number.isFinite(timestamp) ? timestamp : 0;
};

const getSampleTrayList = (sample) => {
  if (!sample || !Array.isArray(sample.trays)) {
    return [];
  }
  const sampleCode = normalizeText(sample.code);
  const validTrays = sample.trays.filter((tray) => {
    // 只保留与当前样品编码匹配且数量有效的托盘条目。
    if (!tray) {
      return false;
    }
    const traySampleCode = normalizeText(tray.sample_code || sampleCode);
    const quantity = Number.parseInt(tray.quantity, 10);
    return traySampleCode === sampleCode && Number.isFinite(quantity) && quantity > 0;
  });
  if (validTrays.length <= 1) {
    return validTrays;
  }
  return validTrays
    .slice()
    .sort((left, right) => (
      parseTimeValue(right?.updated_at) - parseTimeValue(left?.updated_at)
      || parseTimeValue(right?.created_at) - parseTimeValue(left?.created_at)
      || sample.trays.indexOf(right) - sample.trays.indexOf(left)
    ))
    .slice(0, 1);
};

function buildSamplesTrayOverviewView(input = {}) {
  const tasks = Array.isArray(input.tasks) ? input.tasks : [];
  const samples = Array.isArray(input.samples) ? input.samples : [];
  const query = normalizeText(input.query).toLowerCase();
  const taskMap = new Map(
    tasks.map((task) => [
      normalizeText(task?.code),
      {
        code: normalizeText(task?.code),
        name: normalizeText(task?.name),
        testType: normalizeText(task?.test_type),
      },
    ]),
  );
  const trayMap = new Map();

  samples.forEach((sample) => {
    const sampleCode = normalizeText(sample?.code);
    const taskCode = normalizeText(sample?.task_code);
    const task = taskMap.get(taskCode) || { code: taskCode, name: "", testType: "" };
    const sampleStatus = normalizeLifecycleStatus(sample?.location, sample?.status);
    getSampleTrayList(sample).forEach((tray) => {
      const trayCode = normalizeText(tray?.tray_code);
      if (!trayCode) {
        return;
      }
      if (!trayMap.has(trayCode)) {
        trayMap.set(trayCode, {
          trayCode,
          taskCode,
          taskName: task.name,
          testType: task.testType,
          status: normalizeLifecycleStatus(sample?.location, normalizeText(tray?.status) || sampleStatus),
          sampleCodes: [],
        });
      }
      const row = trayMap.get(trayCode);
      if (!row.sampleCodes.includes(sampleCode)) {
        row.sampleCodes.push(sampleCode);
      }
      if (!row.status) {
        row.status = normalizeLifecycleStatus(sample?.location, normalizeText(tray?.status) || sampleStatus);
      }
    });
  });

  const rows = Array.from(trayMap.values())
    .map((row) => ({
      ...row,
      sampleCodes: row.sampleCodes.slice().sort(compareText),
      sampleCount: row.sampleCodes.length,
      statusClass: resolveStatusClass(row.status),
      sampleSummary: row.sampleCodes.slice().sort(compareText).join("、"),
    }))
    .filter((row) => {
      if (!query) {
        return true;
      }
      return [row.trayCode, row.taskCode, row.taskName, row.testType, row.status, row.sampleSummary]
        .map((item) => normalizeText(item).toLowerCase())
        .join(" ")
        .includes(query);
    })
    .sort((left, right) => compareText(left.trayCode, right.trayCode));

  return { rows };
}

function buildTrayFlowView(input = {}) {
  const trayCode = normalizeText(input.trayCode);
  const status = normalizeLifecycleStatus(input.location, input.status) || SAMPLE_FLOW_STEPS[0].label;
  const currentKey = FLOW_STEP_KEY_BY_LABEL.get(status) || SAMPLE_FLOW_STEPS[0].key;
  const currentIndex = FLOW_STEP_INDEX_BY_KEY.get(currentKey) ?? 0;

  return {
    trayCode,
    status,
    currentStatus: trayCode ? `当前托盘：${trayCode} | 当前状态：${status}` : `当前状态：${status}`,
    steps: SAMPLE_FLOW_STEPS.map((step, index) => ({
      ...step,
      active: step.key === currentKey,
      reached: index < currentIndex,
    })),
  };
}

const resolveSampleStatus = (location, labels = DEFAULT_LABELS) => {
  const normalizedLabels = normalizeLabels(labels);
  const normalizedLocation = normalizeText(location);
  const preRetentionLocation = normalizeText(
    normalizedLabels.preRetentionLocation || normalizedLabels.retentionLocation,
  );
  const postRetentionLocation = normalizeText(normalizedLabels.postRetentionLocation);

  // 按位置反推展示状态，让批量入库不需要额外指定状态。
  if (normalizedLocation && normalizedLocation === postRetentionLocation) {
    return "\u653E\u7F6E\u5B9E\u9A8C\u540E\u6682\u5B58\u95F4";
  }
  if (
    normalizedLocation &&
    (normalizedLocation === preRetentionLocation ||
      normalizedLocation === normalizeText(normalizedLabels.unpackingLocation) ||
      normalizedLocation === normalizeText(normalizedLabels.intakeLocation))
  ) {
    return normalizedLocation === preRetentionLocation ? "\u5DF2\u5230\u8FBE\u6682\u5B58\u95F4" : "\u5230\u8D27";
  }
  if (TEST_LABS.has(normalizedLocation)) {
    return "\u5DF2\u5230\u8FBE\u5B9E\u9A8C\u5BA4";
  }
  return "\u8FD0\u8F93\u4E2D";
};

const resolveFlowStatusByLocation = (location, status = "", labels = DEFAULT_LABELS) =>
  normalizeLifecycleStatus(location, status, labels);

const appendSampleHistory = (sample, action, detail = "", now = new Date().toISOString()) => {
  const history = Array.isArray(sample.history) ? sample.history.slice() : [];
  history.unshift({
    // 每次流转更新都记录时间、位置、责任人和状态快照。
    id: generateId("sample-event"),
    time: now,
    action,
    location: sample.location || "",
    owner: sample.owner || "",
    status: sample.status || "",
    detail,
  });
  return history;
};

const resolveStatusClass = (status) => {
  const normalized = normalizeText(status);
  if (
    normalized === "\u9001\u81F3\u5B9E\u9A8C\u5BA4" ||
    normalized === "\u5DF2\u5230\u8FBE\u5B9E\u9A8C\u5BA4" ||
    normalized === "\u5DE5\u88C5\u5939\u5177\u5B89\u88C5" ||
    normalized === "\u5B9E\u9A8C\u51C6\u5907\u5C31\u7EEA" ||
    normalized === "\u5B9E\u9A8C\u8FDB\u884C\u4E2D"
  ) {
    return "status running";
  }
  if (
    normalized === "\u9001\u81F3\u6682\u5B58\u95F4" ||
    normalized === "\u5DF2\u5230\u8FBE\u6682\u5B58\u95F4" ||
    normalized === "\u653E\u7F6E\u5B9E\u9A8C\u540E\u6682\u5B58\u95F4"
  ) {
    return "status retention";
  }
  if (
    normalized === "\u5DF2\u5904\u7F6E" ||
    normalized === "\u5382\u5BB6\u6536\u56DE" ||
    normalized === "\u5B9E\u9A8C\u5DF2\u5B8C\u6210"
  ) {
    return "status completed";
  }
  if (normalized === "\u6837\u54C1\u8FD0\u8F93\u4E2D" || normalized === "\u8FD0\u8F93\u4E2D" || normalized === "\u5230\u8D27") {
    return "status accepted";
  }
  return "status";
};

// 排序时优先按数字比较，无法数字化时回退到中文字符串排序。
const compareValue = (left, right, direction) => {
  const factor = direction === "desc" ? -1 : 1;
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
    return (leftNumber - rightNumber) * factor;
  }
  return normalizeText(left).localeCompare(normalizeText(right), "zh-Hans-CN") * factor;
};

// 在筛选和排序后构建分页样品流转表格。
function buildSamplesFlowView(input = {}) {
  const samples = Array.isArray(input.samples) ? input.samples.slice() : [];
  const tasks = Array.isArray(input.tasks) ? input.tasks : [];
  const filters = input.filters && typeof input.filters === "object" ? input.filters : {};
  const sort = input.sort && typeof input.sort === "object" ? input.sort : {};
  const pageSize = Number(input.pageSize) > 0 ? Number(input.pageSize) : 8;

  const query = normalizeText(filters.query).toLowerCase();
  const selectedTaskCode = normalizeText(filters.taskCode);
  const selectedStatus = normalizeText(filters.status);

  const normalizedSamples = samples.map((sample) => normalizeSampleRecord(sample));
  const rows = normalizedSamples
    .filter((sample) => {
      // 列表筛选同时支持任务号、状态和自由关键词。
      if (selectedTaskCode && normalizeText(sample.task_code) !== selectedTaskCode) {
        return false;
      }
      if (selectedStatus && normalizeText(sample.status) !== selectedStatus) {
        return false;
      }
      if (!query) {
        return true;
      }
      const trayText = getSampleTrayList(sample)
        .map((tray) => normalizeText(tray.tray_code))
        .join(" ");
      const searchText = [
        sample.task_code,
        sample.code,
        trayText,
        sample.location,
        sample.owner,
        sample.status,
        sample.flow_status,
      ]
        .map((item) => normalizeText(item).toLowerCase())
        .join(" ");
      return searchText.includes(query);
    })
    .map((sample) => ({
      ...sample,
      // trayCount 和 statusClass 都在视图层消费，因此提前派生好。
      trayCount: getSampleTrayList(sample).length,
      statusClass: resolveStatusClass(sample.status),
    }));

  const sortKey = normalizeText(sort.key);
  const sortDirection = normalizeText(sort.direction) === "desc" ? "desc" : "asc";
  const sortedRows = rows.slice().sort((left, right) => {
    if (!sortKey) {
      return compareValue(left.code, right.code, "asc");
    }
    const order = compareValue(left?.[sortKey], right?.[sortKey], sortDirection);
    if (order !== 0) {
      return order;
    }
    return compareValue(left.code, right.code, "asc");
  });

  const totalPages = Math.max(1, Math.ceil(sortedRows.length / pageSize));
  const rawPage = Number.parseInt(String(input.page ?? 1), 10);
  const currentPage = Number.isFinite(rawPage) ? Math.min(Math.max(rawPage, 1), totalPages) : 1;
  const startIndex = (currentPage - 1) * pageSize;

  const taskCodes = Array.from(
    new Set(normalizedSamples.map((sample) => normalizeText(sample?.task_code)).filter(Boolean)),
  ).sort((left, right) => left.localeCompare(right, "zh-Hans-CN"));
  const statusOptions = Array.from(new Set(normalizedSamples.map((sample) => normalizeText(sample?.status)).filter(Boolean))).sort(
    (left, right) => left.localeCompare(right, "zh-Hans-CN"),
  );

  return {
    currentPage,
    rows: sortedRows.slice(startIndex, startIndex + pageSize),
    statusOptions,
    taskOptions: taskCodes,
    totalCount: sortedRows.length,
    totalPages,
  };
}

// 对多个样品一次性执行批量接样操作。
function submitSamplesBatchIntake(input = {}) {
  const labels = normalizeLabels(input.labels);
  const samples = Array.isArray(input.samples)
    ? input.samples.map((sample) => ({
        ...sample,
        history: Array.isArray(sample?.history) ? sample.history.slice() : [],
        trays: Array.isArray(sample?.trays) ? sample.trays.slice() : [],
      }))
    : [];
  const payload = input.payload && typeof input.payload === "object" ? input.payload : {};
  const codes = parseCodeList(payload.codes);
  const targetLocation =
    normalizeText(payload.location) ||
    normalizeText(labels.intakeLocation) ||
    normalizeText(labels.unpackingLocation) ||
      normalizeText(labels.preRetentionLocation) ||
      normalizeText(labels.retentionLocation);

  // 批量接样要求同时提供目标位置和至少一个样品号。
  if (!targetLocation || codes.length === 0) {
    return { error: "\u8BF7\u586B\u5199\u5165\u5E93\u4F4D\u7F6E\u548C\u6837\u54C1\u5217\u8868\u3002", samples };
  }

  const now = input.now || new Date().toISOString();
  codes.forEach((code) => {
    const existing = samples.find((sample) => normalizeText(sample.code) === code);
    const nextStatus = resolveSampleStatus(targetLocation, labels);
    if (existing) {
      // 已存在样品按“更新位置与状态”处理，不重复生成记录。
      existing.location = targetLocation;
      existing.owner = normalizeText(payload.owner) || existing.owner || "";
      existing.status = normalizeLifecycleStatus(targetLocation, nextStatus, labels);
      existing.flow_status = existing.status;
      existing.updated_at = now;
      existing.history = appendSampleHistory(existing, "\u6279\u91CF\u5165\u5E93", "", now);
      return;
    }

    const created = {
      // 不存在的样品号会在批量接样时被直接创建。
      id: generateId("sample"),
      code,
      task_code: "",
      location: targetLocation,
      owner: normalizeText(payload.owner),
      status: normalizeLifecycleStatus(targetLocation, nextStatus, labels),
      flow_status: normalizeLifecycleStatus(targetLocation, nextStatus, labels),
      created_at: now,
      updated_at: now,
      trays: [],
      history: [],
    };
    created.history = appendSampleHistory(created, "\u6279\u91CF\u5165\u5E93", "", now);
    samples.unshift(created);
  });

  return { error: "", samples: normalizeSamplesSnapshot(samples, labels) };
}

// 更新单个样品可编辑的明细字段及其派生状态。
function updateSampleDetail(input = {}) {
  const sample = input.sample && typeof input.sample === "object" ? { ...input.sample } : null;
  if (!sample) {
    return { error: "\u672A\u627E\u5230\u6837\u54C1\u3002", sample: null };
  }
  const payload = input.payload && typeof input.payload === "object" ? input.payload : {};
  const labels = normalizeLabels(input.labels);
  const nextStatus = normalizeText(payload.status) || normalizeText(sample.status);
  const nextRemark = normalizeText(payload.remark);
  const now = input.now || new Date().toISOString();

  // 明细抽屉只允许改状态与备注，流转状态由位置和状态共同派生。
  sample.status = normalizeLifecycleStatus(sample.location, nextStatus, labels);
  sample.flow_status = sample.status;
  sample.updated_at = now;
  sample.history = appendSampleHistory(sample, "\u6837\u54C1\u8BE6\u60C5\u66F4\u65B0", nextRemark, now);

  return { error: "", sample };
}

function updateTrayStatus(input = {}) {
  const trayCode = normalizeText(input.trayCode);
  const labels = normalizeLabels(input.labels);
  const now = input.now || new Date().toISOString();
  const samples = Array.isArray(input.samples)
    ? input.samples.map((sample) => ({
        ...sample,
        history: Array.isArray(sample?.history) ? sample.history.slice() : [],
        trays: Array.isArray(sample?.trays) ? sample.trays.map((tray) => ({ ...tray })) : [],
      }))
    : [];

  if (!trayCode || !normalizeText(input.status)) {
    return { error: "请选择托盘和目标状态。", samples };
  }

  let updatedCount = 0;
  samples.forEach((sample) => {
    const matchingTrays = getSampleTrayList(sample).filter((tray) => normalizeText(tray?.tray_code) === trayCode);
    if (matchingTrays.length === 0) {
      return;
    }
    const nextStatus = syncTrayStatusToSampleStatus(input.status, sample.location, labels);
    sample.trays = sample.trays.map((tray) =>
      normalizeText(tray?.tray_code) === trayCode
        ? {
            ...tray,
            status: nextStatus,
            updated_at: now,
          }
        : tray,
    );
    sample.status = nextStatus;
    sample.flow_status = nextStatus;
    sample.updated_at = now;
    sample.history = appendSampleHistory(sample, "托盘状态更新", `${trayCode} -> ${nextStatus}`, now);
    updatedCount += 1;
  });

  return {
    error: updatedCount > 0 ? "" : `未找到托盘 ${trayCode}。`,
    samples,
  };
}

// 构建用于向实验室派发样品的暂存区列表。
function buildSamplesStagingView(input = {}) {
  const labels = normalizeLabels(input.labels);
  const samples = Array.isArray(input.samples) ? input.samples : [];
  const query = normalizeText(input.query).toLowerCase();
  const selectedCodes = Array.isArray(input.selectedCodes)
    ? input.selectedCodes.map((code) => normalizeText(code)).filter(Boolean)
    : [];
  const selectedSet = new Set(selectedCodes);
  const preRetentionLocation = normalizeText(labels.preRetentionLocation || labels.retentionLocation);

  const normalizedSamples = normalizeSamplesSnapshot(samples, labels);
  const rows = normalizedSamples
    .filter((sample) => {
      // 暂存派发面板只展示当前仍停留在前置暂存间的样品。
      const location = normalizeText(sample?.location);
      if (location !== preRetentionLocation) {
        return false;
      }
      if (!query) {
        return true;
      }
      const searchText = [
        sample?.code,
        sample?.task_code,
        sample?.location,
        sample?.status,
        sample?.owner,
        sample?.flow_status,
      ]
        .map((item) => normalizeText(item).toLowerCase())
        .join(" ");
      return searchText.includes(query);
    })
    .map((sample) => ({
      ...sample,
      // 选中态在视图模型里直接展开，组件层不再额外做集合判断。
      selected: selectedSet.has(normalizeText(sample?.code)),
      statusClass: resolveStatusClass(sample?.status),
    }))
    .sort((left, right) => compareValue(left.code, right.code, "asc"));

  return {
    count: rows.length,
    labOptions: TEST_LAB_OPTIONS.slice(),
    rows,
  };
}

// 将选中的暂存样品派发到目标实验室和责任人。
function dispatchStagingSamples(input = {}) {
  const labels = normalizeLabels(input.labels);
  const samples = Array.isArray(input.samples)
    ? input.samples.map((sample) => ({
        ...sample,
        history: Array.isArray(sample?.history) ? sample.history.slice() : [],
        trays: Array.isArray(sample?.trays) ? sample.trays.slice() : [],
      }))
    : [];
  const payload = input.payload && typeof input.payload === "object" ? input.payload : {};
  const selectedCodes = Array.isArray(input.selectedCodes) ? input.selectedCodes : [];
  const targetLab = normalizeText(payload.targetLab);
  const owner = normalizeText(payload.owner);
  const preRetentionLocation = normalizeText(labels.preRetentionLocation || labels.retentionLocation);
  const codes = Array.from(new Set([...selectedCodes, ...parseCodeList(payload.codes)].map((code) => normalizeText(code)).filter(Boolean)));

  // 暂存派发要求目标实验室和样品集合都有效。
  if (!targetLab || codes.length === 0) {
    return {
      error: "请填写样品编号并选择目标实验室。",
      samples,
      dispatchedCodes: [],
    };
  }

  const missing = [];
  const notStaging = [];
  const dispatchedCodes = [];
  const now = input.now || new Date().toISOString();

  codes.forEach((code) => {
    const sample = samples.find((item) => normalizeText(item?.code) === code);
    if (!sample) {
      missing.push(code);
      return;
    }
    if (normalizeText(sample.location) !== preRetentionLocation) {
      notStaging.push(code);
      return;
    }

    // 只有当前位于暂存间的样品才允许派发到正式实验室。
    sample.location = targetLab;
    sample.owner = owner || normalizeText(sample.owner);
    sample.status = normalizeLifecycleStatus(targetLab, "\u5DF2\u5230\u8FBE\u5B9E\u9A8C\u5BA4", labels);
    sample.flow_status = sample.status;
    sample.updated_at = now;
    sample.history = appendSampleHistory(sample, "暂存间派发", "", now);
    dispatchedCodes.push(code);
  });

  const warnings = [];
  if (missing.length) {
    warnings.push(`未找到样品：${missing.join("、")}`);
  }
  if (notStaging.length) {
    warnings.push(`不在暂存间：${notStaging.join("、")}`);
  }

  return {
    // 部分成功时会同时返回更新后的样品集合和告警文本。
    error: warnings.length ? `${warnings.join("；")}。` : "",
    samples,
    dispatchedCodes,
  };
}

export {
  SAMPLE_FLOW_STEPS,
  DETAIL_STATUS_OPTIONS,
  buildTrayFlowView,
  buildSamplesFlowView,
  buildSamplesTrayOverviewView,
  buildSamplesStagingView,
  dispatchStagingSamples,
  getSampleTrayList,
  normalizeLifecycleStatus,
  normalizeSampleRecord,
  normalizeSamplesSnapshot,
  resolveFlowStatusByLocation,
  submitSamplesBatchIntake,
  syncTrayStatusToSampleStatus,
  TRAY_STATUS_OPTIONS,
  updateTrayStatus,
  updateSampleDetail,
};
