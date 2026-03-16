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
  { key: "in_transit", label: "\u8FD0\u8F93\u4E2D" },
  { key: "arrived", label: "\u5230\u8D27" },
  { key: "sent_to_staging", label: "\u9001\u81F3\u6682\u5B58\u95F4" },
  { key: "arrived_staging", label: "\u5DF2\u5230\u8FBE\u6682\u5B58\u95F4" },
  { key: "sent_to_lab", label: "\u9001\u81F3\u5B9E\u9A8C\u5BA4" },
  { key: "arrived_lab", label: "\u5DF2\u5230\u8FBE\u5B9E\u9A8C\u5BA4" },
  { key: "fixture_install", label: "\u5DE5\u88C5\u5939\u5177\u5B89\u88C5" },
  { key: "ready", label: "\u5B9E\u9A8C\u51C6\u5907\u5C31\u7EEA" },
  { key: "completed", label: "\u5B9E\u9A8C\u5DF2\u5B8C\u6210" },
  { key: "post_test_staging", label: "\u653E\u7F6E\u5B9E\u9A8C\u540E\u6682\u5B58\u95F4" },
  { key: "returned", label: "\u5382\u5BB6\u6536\u56DE" },
];

const DETAIL_STATUS_OPTIONS = SAMPLE_FLOW_STEPS.map((step) => step.label);
const FLOW_STATUS_LABELS = new Set(DETAIL_STATUS_OPTIONS);

const normalizeText = (value) => String(value ?? "").trim();

const normalizeLabels = (labels = {}) => ({
  ...DEFAULT_LABELS,
  ...(labels && typeof labels === "object" ? labels : {}),
});

const generateId = (prefix) => {
  const stamp = Date.now();
  const rand = Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, "0");
  return `${prefix}-${stamp}-${rand}`;
};

const parseCodeList = (value) =>
  Array.from(
    new Set(
      String(value ?? "")
        .split(/[\s,\uFF0C;\uFF1B]+/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );

const getSampleTrayList = (sample) => {
  if (!sample || !Array.isArray(sample.trays)) {
    return [];
  }
  const sampleCode = normalizeText(sample.code);
  return sample.trays.filter((tray) => {
    if (!tray) {
      return false;
    }
    const traySampleCode = normalizeText(tray.sample_code || sampleCode);
    const quantity = Number.parseInt(tray.quantity, 10);
    return traySampleCode === sampleCode && Number.isFinite(quantity) && quantity > 0;
  });
};

const resolveSampleStatus = (location, labels = DEFAULT_LABELS) => {
  const normalizedLabels = normalizeLabels(labels);
  const normalizedLocation = normalizeText(location);
  const preRetentionLocation = normalizeText(
    normalizedLabels.preRetentionLocation || normalizedLabels.retentionLocation,
  );
  const postRetentionLocation = normalizeText(normalizedLabels.postRetentionLocation);

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

const resolveFlowStatusByLocation = (location, status = "", labels = DEFAULT_LABELS) => {
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
    return currentStatus;
  }
  if (currentStatus === "\u5382\u5BB6\u6536\u56DE" || currentStatus === "\u5DF2\u5904\u7F6E") {
    return "\u5382\u5BB6\u6536\u56DE";
  }
  if (currentStatus === "\u653E\u7F6E\u6682\u5B58\u95F4") {
    return "\u653E\u7F6E\u5B9E\u9A8C\u540E\u6682\u5B58\u95F4";
  }
  if (
    currentStatus === "\u5165\u5E93" ||
    currentStatus === "\u5DF2\u5165\u5E93" ||
    currentStatus === normalizedLabels.sampleStored
  ) {
    return isPostRetention ? "\u653E\u7F6E\u5B9E\u9A8C\u540E\u6682\u5B58\u95F4" : isPreRetention ? "\u5DF2\u5230\u8FBE\u6682\u5B58\u95F4" : "\u5230\u8D27";
  }
  if (currentStatus === "\u5B9E\u9A8C\u5B8C\u6210" || currentStatus === "\u5B9E\u9A8C\u5DF2\u5B8C\u6210") {
    return "\u5B9E\u9A8C\u5DF2\u5B8C\u6210";
  }
  if (currentStatus === "\u5B9E\u9A8C\u51C6\u5907\u5C31\u7EEA" || currentStatus === normalizedLabels.sampleTesting) {
    return "\u5B9E\u9A8C\u51C6\u5907\u5C31\u7EEA";
  }
  if (isPostRetention) {
    return "\u653E\u7F6E\u5B9E\u9A8C\u540E\u6682\u5B58\u95F4";
  }
  if (isPreRetention) {
    return "\u5DF2\u5230\u8FBE\u6682\u5B58\u95F4";
  }
  if (TEST_LABS.has(normalizedLocation)) {
    return "\u5DF2\u5230\u8FBE\u5B9E\u9A8C\u5BA4";
  }
  if (
    normalizedLocation &&
    (normalizedLocation === normalizeText(normalizedLabels.unpackingLocation) ||
      normalizedLocation === normalizeText(normalizedLabels.intakeLocation))
  ) {
    return "\u5230\u8D27";
  }
  return "\u8FD0\u8F93\u4E2D";
};

const appendSampleHistory = (sample, action, detail = "", now = new Date().toISOString()) => {
  const history = Array.isArray(sample.history) ? sample.history.slice() : [];
  history.unshift({
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
    normalized === "\u5B9E\u9A8C\u51C6\u5907\u5C31\u7EEA"
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
  if (normalized === "\u8FD0\u8F93\u4E2D" || normalized === "\u5230\u8D27") {
    return "status accepted";
  }
  return "status";
};

const compareValue = (left, right, direction) => {
  const factor = direction === "desc" ? -1 : 1;
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
    return (leftNumber - rightNumber) * factor;
  }
  return normalizeText(left).localeCompare(normalizeText(right), "zh-Hans-CN") * factor;
};

function buildSamplesFlowView(input = {}) {
  const samples = Array.isArray(input.samples) ? input.samples.slice() : [];
  const tasks = Array.isArray(input.tasks) ? input.tasks : [];
  const filters = input.filters && typeof input.filters === "object" ? input.filters : {};
  const sort = input.sort && typeof input.sort === "object" ? input.sort : {};
  const pageSize = Number(input.pageSize) > 0 ? Number(input.pageSize) : 8;

  const query = normalizeText(filters.query).toLowerCase();
  const selectedTaskCode = normalizeText(filters.taskCode);
  const selectedStatus = normalizeText(filters.status);

  const rows = samples
    .filter((sample) => {
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
    new Set(
      tasks
        .map((task) => normalizeText(task?.code))
        .filter(Boolean)
        .concat(samples.map((sample) => normalizeText(sample?.task_code)).filter(Boolean)),
    ),
  ).sort((left, right) => left.localeCompare(right, "zh-Hans-CN"));
  const statusOptions = Array.from(
    new Set(samples.map((sample) => normalizeText(sample?.status)).filter(Boolean)),
  ).sort((left, right) => left.localeCompare(right, "zh-Hans-CN"));

  return {
    currentPage,
    rows: sortedRows.slice(startIndex, startIndex + pageSize),
    statusOptions,
    taskOptions: taskCodes,
    totalCount: sortedRows.length,
    totalPages,
  };
}

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

  if (!targetLocation || codes.length === 0) {
    return { error: "\u8BF7\u586B\u5199\u5165\u5E93\u4F4D\u7F6E\u548C\u6837\u54C1\u5217\u8868\u3002", samples };
  }

  const now = input.now || new Date().toISOString();
  codes.forEach((code) => {
    const existing = samples.find((sample) => normalizeText(sample.code) === code);
    const nextStatus = resolveSampleStatus(targetLocation, labels);
    if (existing) {
      existing.location = targetLocation;
      existing.owner = normalizeText(payload.owner) || existing.owner || "";
      existing.status = nextStatus;
      existing.flow_status = resolveFlowStatusByLocation(targetLocation, nextStatus, labels);
      existing.updated_at = now;
      existing.history = appendSampleHistory(existing, "\u6279\u91CF\u5165\u5E93", "", now);
      return;
    }

    const created = {
      id: generateId("sample"),
      code,
      task_code: "",
      location: targetLocation,
      owner: normalizeText(payload.owner),
      status: nextStatus,
      flow_status: resolveFlowStatusByLocation(targetLocation, nextStatus, labels),
      created_at: now,
      updated_at: now,
      trays: [],
      history: [],
    };
    created.history = appendSampleHistory(created, "\u6279\u91CF\u5165\u5E93", "", now);
    samples.unshift(created);
  });

  return { error: "", samples };
}

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

  sample.status = nextStatus;
  sample.flow_status = resolveFlowStatusByLocation(sample.location, nextStatus, labels);
  sample.updated_at = now;
  sample.history = appendSampleHistory(sample, "\u6837\u54C1\u8BE6\u60C5\u66F4\u65B0", nextRemark, now);

  return { error: "", sample };
}

function buildSamplesStagingView(input = {}) {
  const labels = normalizeLabels(input.labels);
  const samples = Array.isArray(input.samples) ? input.samples : [];
  const query = normalizeText(input.query).toLowerCase();
  const selectedCodes = Array.isArray(input.selectedCodes)
    ? input.selectedCodes.map((code) => normalizeText(code)).filter(Boolean)
    : [];
  const selectedSet = new Set(selectedCodes);
  const preRetentionLocation = normalizeText(labels.preRetentionLocation || labels.retentionLocation);

  const rows = samples
    .filter((sample) => {
      const location = normalizeText(sample?.location);
      const status = normalizeText(sample?.status);
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

    sample.location = targetLab;
    sample.owner = owner || normalizeText(sample.owner);
    sample.status = "\u5DF2\u5230\u8FBE\u5B9E\u9A8C\u5BA4";
    sample.flow_status = resolveFlowStatusByLocation(targetLab, sample.status, labels);
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
    error: warnings.length ? `${warnings.join("；")}。` : "",
    samples,
    dispatchedCodes,
  };
}

export {
  SAMPLE_FLOW_STEPS,
  DETAIL_STATUS_OPTIONS,
  buildSamplesFlowView,
  buildSamplesStagingView,
  dispatchStagingSamples,
  getSampleTrayList,
  resolveFlowStatusByLocation,
  submitSamplesBatchIntake,
  updateSampleDetail,
};
