import { TEST_PREFIX_MAP } from "@/lib/labs.js";

const SOURCE_EXTERNAL = "外部委托";
const SOURCE_INTERNAL = "内部新增";
const STATUS_WAITING = "待排程";
const STATUS_SCHEDULED = "已排程";
const STATUS_RUNNING = "实验中";
const STATUS_COMPLETED = "实验已经完成";
const STATUS_RETENTION = "暂存间排放";
const RETENTION_LOCATION = "暂存间";
const RANDOM_SAMPLE_TYPES = ["结构件", "整机", "粉末", "线缆", "组件"];
const RANDOM_PRIORITIES = ["高", "中", "低"];

const randomFrom = (items) => items[Math.floor(Math.random() * items.length)] || "";

const addHours = (date, hours) => {
  const nextDate = new Date(date.getTime());
  nextDate.setHours(nextDate.getHours() + hours);
  return nextDate;
};

const normalizeText = (value) => String(value ?? "").trim();

const parseTime = (value) => {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : Number.NaN;
};

const createId = (prefix) => {
  const random = Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, "0");
  return `${prefix}-${Date.now()}-${random}`;
};

const formatDateTime = (value) => {
  const normalized = normalizeText(value);
  if (!normalized) {
    return "";
  }
  if (normalized.includes("T")) {
    return normalized.replace("T", " ").slice(0, 16);
  }
  return normalized.slice(0, 16);
};

const toDateTimeLocalValue = (value) => {
  const normalized = normalizeText(value);
  if (!normalized) {
    return "";
  }
  if (normalized.includes("T")) {
    return normalized.slice(0, 16);
  }
  if (normalized.includes(" ")) {
    return normalized.replace(" ", "T").slice(0, 16);
  }
  return normalized;
};

const fromDateTimeLocalValue = (value) => {
  const normalized = normalizeText(value);
  if (!normalized) {
    return "";
  }
  return normalized.replace("T", " ").slice(0, 16);
};

const statusClass = (value) => {
  const normalized = normalizeText(value);
  if (normalized === STATUS_RUNNING) {
    return "status running";
  }
  if (normalized === STATUS_SCHEDULED) {
    return "status scheduled";
  }
  if (normalized === STATUS_RETENTION) {
    return "status retention";
  }
  if (normalized.includes("缺口")) {
    return "status warn";
  }
  if (normalized === STATUS_COMPLETED) {
    return "status completed";
  }
  return "status";
};

function resolveTaskStatus(task, schedules, now = Date.now()) {
  const taskCode = normalizeText(task?.code);
  const relatedSchedules = (Array.isArray(schedules) ? schedules : []).filter(
    (schedule) => normalizeText(schedule?.task_code) === taskCode,
  );

  const activeSchedule = relatedSchedules.find((schedule) => {
    const start = parseTime(schedule?.start_at);
    const end = parseTime(schedule?.end_at);
    return Number.isFinite(start) && Number.isFinite(end) && start <= now && end >= now;
  });
  if (activeSchedule) {
    return STATUS_RUNNING;
  }

  const scheduledEntry = relatedSchedules.find((schedule) => normalizeText(schedule?.device) !== RETENTION_LOCATION);
  if (scheduledEntry) {
    return STATUS_SCHEDULED;
  }

  const rawStatus = normalizeText(task?.status);
  if (rawStatus === "已受理") {
    return STATUS_WAITING;
  }
  return rawStatus || STATUS_WAITING;
}

function buildTaskRows(tasks, schedules, now = Date.now()) {
  const taskList = Array.isArray(tasks) ? tasks : [];
  return taskList.map((task, index) => {
    const displayStatus = resolveTaskStatus(task, schedules, now);
    return {
      arrivalAt: formatDateTime(task?.arrival_at),
      attachment: normalizeText(task?.attachment),
      client: normalizeText(task?.client) || "内部部门",
      code: normalizeText(task?.code) || `TASK-${index + 1}`,
      conditions: normalizeText(task?.conditions),
      contact: normalizeText(task?.contact),
      contactInfo: normalizeText(task?.contact_info),
      createdAt: normalizeText(task?.created_at),
      displayStatus,
      dueAt: formatDateTime(task?.due_at),
      id: normalizeText(task?.id) || `task-${index + 1}`,
      name: normalizeText(task?.name),
      priority: normalizeText(task?.priority) || "中",
      remark: normalizeText(task?.remark),
      requiredDevice: normalizeText(task?.required_device) || "-",
      sampleCount: normalizeText(task?.sample_count),
      sampleType: normalizeText(task?.sample_type),
      source: normalizeText(task?.source) || SOURCE_EXTERNAL,
      status: normalizeText(task?.status) || STATUS_WAITING,
      statusClass: statusClass(displayStatus),
      testType: normalizeText(task?.test_type),
    };
  });
}

function buildTaskMetrics(rows) {
  const rowList = Array.isArray(rows) ? rows : [];
  const externalCount = rowList.filter((row) => row.source === SOURCE_EXTERNAL).length;
  const internalCount = rowList.filter((row) => row.source === SOURCE_INTERNAL).length;
  const retentionCount = rowList.filter((row) => row.displayStatus === STATUS_RETENTION).length;
  const waitingCount = rowList.filter((row) => row.displayStatus === STATUS_WAITING).length;
  const unscheduledCount = waitingCount + retentionCount;

  return {
    externalCount,
    internalCount,
    retentionCount,
    unscheduledCount,
    unscheduledLabel: `${unscheduledCount}（暂存间存放${retentionCount}）`,
  };
}

function buildFilterOptions(rows) {
  const rowList = Array.isArray(rows) ? rows : [];
  return {
    statusOptions: Array.from(new Set(rowList.map((row) => row.displayStatus).filter(Boolean))),
    testTypeOptions: Array.from(new Set(Object.keys(TEST_PREFIX_MAP).concat(rowList.map((row) => row.testType).filter(Boolean)))).sort(
      (left, right) => left.localeCompare(right, "zh-Hans-CN"),
    ),
  };
}

function buildTaskCode(testType, tasks, year = new Date().getFullYear()) {
  const normalizedType = normalizeText(testType);
  if (!normalizedType) {
    return "";
  }
  const prefix = TEST_PREFIX_MAP[normalizedType] || "TASK";
  const taskList = Array.isArray(tasks) ? tasks : [];
  const pattern = new RegExp(`^${prefix}-${year}-(\\d{3})$`);
  let maxSeq = 0;

  taskList.forEach((task) => {
    const taskCode = normalizeText(task?.code);
    const matched = taskCode.match(pattern);
    if (!matched) {
      return;
    }
    const parsed = Number.parseInt(matched[1], 10);
    if (Number.isFinite(parsed)) {
      maxSeq = Math.max(maxSeq, parsed);
    }
  });

  return `${prefix}-${year}-${String(maxSeq + 1).padStart(3, "0")}`;
}

function createTaskIntakeForm() {
  return {
    arrival_at: "",
    attachment: "",
    client: "内部部门",
    code: "",
    conditions: "",
    contact: "",
    contact_info: "",
    due_at: "",
    name: "",
    priority: "高",
    remark: "",
    required_device: "",
    sample_count: "",
    sample_type: "",
    source: SOURCE_INTERNAL,
    test_type: "",
  };
}

function isTaskIntakeFormPristine(form) {
  const defaultForm = createTaskIntakeForm();
  const keys = Object.keys(defaultForm);

  return keys.every((key) => normalizeText(form?.[key]) === normalizeText(defaultForm[key]));
}

function createRandomTaskIntakeForm(now = new Date()) {
  const testType = randomFrom(Object.keys(TEST_PREFIX_MAP));
  const sampleCount = String(Math.floor(Math.random() * 5) + 1);
  const source = SOURCE_INTERNAL;
  const arrivalAt = addHours(now, Math.floor(Math.random() * 6));
  const dueAt = addHours(arrivalAt, Math.floor(Math.random() * 48) + 8);
  const suffix = Math.floor(Math.random() * 900) + 100;

  return {
    ...createTaskIntakeForm(),
    arrival_at: arrivalAt.toISOString().slice(0, 16),
    client: source === SOURCE_EXTERNAL ? `外部客户${suffix}` : "内部部门",
    contact: `调度员${suffix}`,
    contact_info: `1380000${suffix}`,
    due_at: dueAt.toISOString().slice(0, 16),
    name: `${testType}-随机任务${suffix}`,
    priority: randomFrom(RANDOM_PRIORITIES),
    required_device: testType,
    sample_count: sampleCount,
    sample_type: randomFrom(RANDOM_SAMPLE_TYPES),
    source,
    test_type: testType,
  };
}

function createTaskEditForm() {
  return {
    arrival_at: "",
    code: "",
    due_at: "",
    id: "",
    name: "",
    priority: "高",
    remark: "",
    required_device: "",
    sample_count: "",
    sample_type: "",
    source: SOURCE_EXTERNAL,
    status: STATUS_WAITING,
    test_type: "",
  };
}

function buildTaskEditForm(row = {}) {
  return {
    arrival_at: toDateTimeLocalValue(row?.arrivalAt ?? row?.arrival_at),
    code: normalizeText(row?.code),
    due_at: toDateTimeLocalValue(row?.dueAt ?? row?.due_at),
    id: normalizeText(row?.id),
    name: normalizeText(row?.name),
    priority: normalizeText(row?.priority) || "高",
    remark: normalizeText(row?.remark),
    required_device: normalizeText(row?.requiredDevice ?? row?.required_device),
    sample_count: normalizeText(row?.sampleCount ?? row?.sample_count),
    sample_type: normalizeText(row?.sampleType ?? row?.sample_type),
    source: normalizeText(row?.source) || SOURCE_EXTERNAL,
    status: normalizeText(row?.displayStatus ?? row?.status) || STATUS_WAITING,
    test_type: normalizeText(row?.testType ?? row?.test_type),
  };
}

function createTaskRecord(form, tasks) {
  const taskCode = normalizeText(form?.code) || buildTaskCode(form?.test_type, tasks) || `TASK-${Date.now().toString().slice(-6)}`;
  return {
    id: createId("task"),
    code: taskCode,
    name: normalizeText(form?.name),
    source: normalizeText(form?.source) || SOURCE_EXTERNAL,
    client: normalizeText(form?.client) || "内部部门",
    contact: normalizeText(form?.contact),
    contact_info: normalizeText(form?.contact_info),
    priority: normalizeText(form?.priority) || "高",
    sample_count: normalizeText(form?.sample_count),
    sample_type: normalizeText(form?.sample_type),
    test_type: normalizeText(form?.test_type),
    required_device: normalizeText(form?.required_device) || normalizeText(form?.test_type),
    due_at: fromDateTimeLocalValue(form?.due_at),
    arrival_at: fromDateTimeLocalValue(form?.arrival_at),
    conditions: normalizeText(form?.conditions),
    attachment: normalizeText(form?.attachment),
    remark: normalizeText(form?.remark),
    status: STATUS_WAITING,
    created_at: new Date().toISOString(),
  };
}

function updateTaskRecord(tasks, editForm) {
  const taskList = Array.isArray(tasks) ? tasks.map((task) => ({ ...task })) : [];
  const targetIndex = taskList.findIndex((task) => normalizeText(task?.id) === normalizeText(editForm?.id));
  if (targetIndex === -1) {
    return { previousCode: "", tasks: taskList };
  }

  const previousCode = normalizeText(taskList[targetIndex]?.code);
  taskList[targetIndex] = {
    ...taskList[targetIndex],
    arrival_at: fromDateTimeLocalValue(editForm?.arrival_at),
    code: normalizeText(editForm?.code) || taskList[targetIndex].code,
    due_at: fromDateTimeLocalValue(editForm?.due_at),
    name: normalizeText(editForm?.name),
    priority: normalizeText(editForm?.priority),
    remark: normalizeText(editForm?.remark),
    required_device: normalizeText(editForm?.required_device),
    sample_count: normalizeText(editForm?.sample_count),
    sample_type: normalizeText(editForm?.sample_type),
    source: normalizeText(editForm?.source),
    status: normalizeText(editForm?.status) || taskList[targetIndex].status,
    test_type: normalizeText(editForm?.test_type),
    updated_at: new Date().toISOString(),
  };

  return { previousCode, tasks: taskList };
}

function deleteTaskSnapshot(snapshot, taskId) {
  const taskList = Array.isArray(snapshot?.tasks) ? snapshot.tasks : [];
  const targetTask = taskList.find((task) => normalizeText(task?.id) === normalizeText(taskId));
  if (!targetTask) {
    return {
      samples: Array.isArray(snapshot?.samples) ? snapshot.samples : [],
      schedules: Array.isArray(snapshot?.schedules) ? snapshot.schedules : [],
      streams: Array.isArray(snapshot?.streams) ? snapshot.streams : [],
      tasks: taskList,
    };
  }

  const taskCode = normalizeText(targetTask.code);
  return {
    samples: (Array.isArray(snapshot?.samples) ? snapshot.samples : []).filter(
      (sample) => normalizeText(sample?.task_code) !== taskCode,
    ),
    schedules: (Array.isArray(snapshot?.schedules) ? snapshot.schedules : []).filter(
      (schedule) => normalizeText(schedule?.task_code) !== taskCode,
    ),
    streams: (Array.isArray(snapshot?.streams) ? snapshot.streams : []).filter(
      (stream) => normalizeText(stream?.task_code) !== taskCode,
    ),
    tasks: taskList.filter((task) => normalizeText(task?.id) !== normalizeText(taskId)),
  };
}

const escapeRegExp = (value) => String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function buildTaskSampleCodes(taskCode, sampleCount, taskSamples) {
  const normalizedCode = normalizeText(taskCode);
  if (!normalizedCode) {
    return [];
  }

  const existingSamples = Array.isArray(taskSamples) ? taskSamples : [];
  const pattern = new RegExp(`^${escapeRegExp(normalizedCode)}-SP-(\\d{3})$`);
  let maxIndex = 0;
  existingSamples.forEach((sample) => {
    const matched = normalizeText(sample?.code).match(pattern);
    if (!matched) {
      return;
    }
    const parsed = Number.parseInt(matched[1], 10);
    if (Number.isFinite(parsed)) {
      maxIndex = Math.max(maxIndex, parsed);
    }
  });

  const plannedRaw = Number.parseInt(sampleCount, 10);
  let targetCount = Number.isFinite(plannedRaw) && plannedRaw > 0 ? plannedRaw : existingSamples.length;
  if (targetCount <= 0 && maxIndex > 0) {
    targetCount = maxIndex;
  }

  return Array.from({ length: targetCount }, (_, index) => `${normalizedCode}-SP-${String(index + 1).padStart(3, "0")}`);
}

function syncTaskSamples(samples, task, previousTaskCode = "") {
  const sampleList = Array.isArray(samples) ? samples.map((sample) => ({ ...sample })) : [];
  const taskCode = normalizeText(task?.code);
  if (!taskCode) {
    return sampleList;
  }

  const oldTaskCode = normalizeText(previousTaskCode);
  if (oldTaskCode && oldTaskCode !== taskCode) {
    const oldPattern = new RegExp(`^${escapeRegExp(oldTaskCode)}-SP-(\\d{3})$`);
    sampleList.forEach((sample) => {
      if (normalizeText(sample?.task_code) !== oldTaskCode) {
        return;
      }
      sample.task_code = taskCode;
      const matched = normalizeText(sample?.code).match(oldPattern);
      if (matched) {
        sample.code = `${taskCode}-SP-${matched[1]}`;
      }
    });
  }

  const relatedSamples = sampleList.filter((sample) => normalizeText(sample?.task_code) === taskCode);
  const expectedCodes = buildTaskSampleCodes(taskCode, task?.sample_count, relatedSamples);
  const nextSamples = sampleList.filter((sample) => normalizeText(sample?.task_code) !== taskCode);

  expectedCodes.forEach((code, index) => {
    const existingSample = relatedSamples[index];
    if (existingSample) {
      nextSamples.push({
        ...existingSample,
        code,
        task_code: taskCode,
      });
      return;
    }

    nextSamples.push({
      id: createId("sample"),
      code,
      task_code: taskCode,
      location: "",
      owner: "",
      status: "运输中",
      flow_status: "运输中",
      created_at: new Date().toISOString(),
    });
  });

  return nextSamples;
}

export {
  SOURCE_EXTERNAL,
  SOURCE_INTERNAL,
  STATUS_COMPLETED,
  STATUS_RETENTION,
  STATUS_RUNNING,
  STATUS_SCHEDULED,
  STATUS_WAITING,
  buildFilterOptions,
  buildTaskCode,
  buildTaskEditForm,
  buildTaskMetrics,
  buildTaskRows,
  createTaskEditForm,
  createTaskIntakeForm,
  createRandomTaskIntakeForm,
  createTaskRecord,
  deleteTaskSnapshot,
  fromDateTimeLocalValue,
  isTaskIntakeFormPristine,
  normalizeText,
  resolveTaskStatus,
  syncTaskSamples,
  toDateTimeLocalValue,
  updateTaskRecord,
};
