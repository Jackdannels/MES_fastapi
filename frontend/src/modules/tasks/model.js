// 提供任务页所需的列表行、表单和持久化记录工厂与映射函数。
import { buildExperimentTypeOptions, buildExperimentTypeSummary, collectExperimentTypes } from "@/lib/experimentTypes";
import { DEFAULT_AXIS_CODES, formatAxisCodeLabel, normalizeAxisCodes } from "@/lib/axisCodes";
import { formatLocalDateTime } from "@/lib/dateTime";
import { serverNowDate, serverNowMs } from "@/lib/serverClock";
import { RUNNING_TASK_DELETE_MESSAGE, taskHasRunningExperiment } from "@/lib/runningExperimentGuards";
import { filterActiveTasks } from "@/lib/taskArchive";
import {
  EXPERIMENT_STATUS_COMPLETED,
  EXPERIMENT_STATUS_RUNNING,
  RETURNED_STATUS as STATUS_RETENTION,
  TASK_STATUS_COMPLETED as STATUS_COMPLETED,
  TASK_STATUS_RUNNING as STATUS_RUNNING,
  TASK_STATUS_WAITING as STATUS_WAITING,
  normalizeExperimentStatusLabel,
  normalizeTaskStatusLabel,
} from "@/lib/statusNormalization";
import { normalizeLifecycleStatus } from "@/modules/samples/samplesFlowModel";

const SOURCE_EXTERNAL = "外部委托";
const SOURCE_INTERNAL = "内部新增";
const STATUS_SCHEDULED = "已排程";
const TEMPORARY_STAGING_DEVICE_KEYWORD = "暂存间";
const LEGACY_STATUS_RUNNING = "实验中";
const LEGACY_STATUS_COMPLETED = "实验已经完成";
const LEGACY_STATUS_COMPLETED_ALT = "实验完成";
const ACTIVE_TRAY_STATUSES = new Set([EXPERIMENT_STATUS_RUNNING, LEGACY_STATUS_RUNNING]);
const COMPLETED_TRAY_STATUSES = new Set([
  EXPERIMENT_STATUS_COMPLETED,
  LEGACY_STATUS_COMPLETED_ALT,
  "实验后暂存间存放",
  "厂家收回",
]);
const COMPLETED_EXPERIMENT_STATUSES = new Set([EXPERIMENT_STATUS_COMPLETED, LEGACY_STATUS_COMPLETED, LEGACY_STATUS_COMPLETED_ALT]);
const RETURNED_TRAY_STATUSES = new Set(["厂家收回"]);
const SYLU_TASK_CODE_PATTERN = /^SYLU-(\d{4})-(\d{2})-(\d{3})$/;
const MIN_SAMPLE_COUNT = 1;
const MAX_SAMPLE_COUNT = 99;
const MAX_CONTACT_LENGTH = 15;
const INVALID_TASK_TEXT_PATTERN = /[\uFFFD&^*#<>`{}|\\]/;
const AXIS_AWARE_EXPERIMENT_TYPES = new Set(["冲击试验", "振动试验"]);
const TASK_TEXT_FIELD_LABELS = {
  attachment: "附件",
  client: "委托单位/部门",
  conditions: "环境/特殊条件",
  contact: "联系人",
  contact_info: "联系方式",
  name: "任务名称",
  remark: "备注",
  sample_type: "样品类型",
};

// 所有输入字段统一走字符串规范化，减少 null / undefined 分支。
const normalizeText = (value) => String(value ?? "").trim();
const isAxisAwareExperimentType = (value) => AXIS_AWARE_EXPERIMENT_TYPES.has(normalizeText(value));
const normalizeAxisCodesByTestType = (axisMap, selectedTypes = []) => {
  const source = axisMap && typeof axisMap === "object" ? axisMap : {};
  const selectedAxisTypes = collectExperimentTypes(selectedTypes).filter(isAxisAwareExperimentType);
  return selectedAxisTypes.reduce((result, experimentType) => {
    const axisCodes = normalizeAxisCodes(source[experimentType]);
    if (axisCodes.length > 0) {
      result[experimentType] = axisCodes;
    }
    return result;
  }, {});
};
const buildExperimentTypeAxisSummary = (types, axisMap = {}) =>
  collectExperimentTypes(types)
    .map((experimentType) => {
      const axisCodes = normalizeAxisCodes(axisMap?.[experimentType]);
      if (!isAxisAwareExperimentType(experimentType) || axisCodes.length === 0) {
        return experimentType;
      }
      return `${experimentType}（${axisCodes.map(formatAxisCodeLabel).join("、")}）`;
    })
    .join(" / ");
const compareTaskCodes = (left, right) =>
  normalizeText(left).localeCompare(normalizeText(right), "zh-Hans-CN", { numeric: true });
const validateTaskSampleCount = (value) => {
  const normalized = normalizeText(value);
  if (!normalized) {
    return "请填写样品数量";
  }
  if (!/^-?\d+$/.test(normalized)) {
    return "样品数量必须为整数";
  }
  const parsed = Number.parseInt(normalized, 10);
  if (parsed < MIN_SAMPLE_COUNT) {
    return "样品数量至少为 1";
  }
  if (parsed > MAX_SAMPLE_COUNT) {
    return `样品数量最多为 ${MAX_SAMPLE_COUNT}`;
  }
  return "";
};
const normalizeTaskSampleCount = (value, fallback = 0) => {
  const parsed = Number.parseInt(value, 10);
  const fallbackParsed = Number.parseInt(fallback, 10);
  const count = Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackParsed;
  if (!Number.isFinite(count) || count <= 0) {
    return 0;
  }
  return Math.min(count, MAX_SAMPLE_COUNT);
};
const validateTaskTextFields = (form = {}, options = {}) => {
  const requireContact = Boolean(options?.requireContact);
  const contact = normalizeText(form?.contact);
  const contactInfo = normalizeText(form?.contact_info);
  if (requireContact && !contact) {
    return "请填写联系人";
  }
  if (requireContact && !contactInfo) {
    return "请填写联系方式";
  }
  if ([...contact].length > MAX_CONTACT_LENGTH) {
    return `联系人不能超过 ${MAX_CONTACT_LENGTH} 个字`;
  }
  if (contactInfo && !/^\d{1,15}$/.test(contactInfo)) {
    return "联系方式必须为 1-15 位数字";
  }
  const taskName = normalizeText(form?.name);
  if ([...taskName].length > 20) {
    return "任务名称不能超过 20 个字";
  }
  const invalidEntry = Object.entries(TASK_TEXT_FIELD_LABELS).find(([field]) => {
    const normalized = normalizeText(form?.[field]);
    return normalized && INVALID_TASK_TEXT_PATTERN.test(normalized);
  });
  if (!invalidEntry) {
    return "";
  }
  return `${invalidEntry[1]}包含无效字符，请检查输入`;
};
// 兼容历史脏数据：旧版本可能残留暂存间“排程”记录，当前业务中暂存间只是临时放置位置。
const isLegacyTemporaryStagingSchedule = (value) => normalizeText(value).includes(TEMPORARY_STAGING_DEVICE_KEYWORD);
const resolveBuildTaskRowsArgs = (samplesOrNow, nowMaybe) => {
  if (Array.isArray(samplesOrNow)) {
    return {
      now: Number.isFinite(nowMaybe) ? nowMaybe : serverNowMs(),
      samples: samplesOrNow,
    };
  }
  return {
    now: Number.isFinite(samplesOrNow) ? samplesOrNow : serverNowMs(),
    samples: [],
  };
};

const resolveBuildTaskRowCollections = (samplesOrNow, experimentsOrNow, nowMaybe) => {
  if (Array.isArray(samplesOrNow)) {
    return {
      experiments: Array.isArray(experimentsOrNow) ? experimentsOrNow : [],
      now: Number.isFinite(nowMaybe) ? nowMaybe : serverNowMs(),
      samples: samplesOrNow,
    };
  }
  return {
    experiments: [],
    now: Number.isFinite(samplesOrNow) ? samplesOrNow : serverNowMs(),
    samples: [],
  };
};

// 前端临时记录 ID 使用时间戳 + 随机后缀即可满足唯一性需求。
const createId = (prefix) => {
  const random = Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, "0");
  return `${prefix}-${Date.now()}-${random}`;
};

// 将持久化时间裁剪成页面列表展示使用的 yyyy-MM-dd HH:mm。
const formatDateTime = (value) => {
  const normalized = normalizeText(value);
  if (!normalized) {
    return "";
  }
  const sliceLength = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/.test(normalized) ? 19 : 16;
  if (normalized.includes("T")) {
    return normalized.replace("T", " ").slice(0, sliceLength);
  }
  return normalized.slice(0, sliceLength);
};

// datetime-local 组件使用 `T` 分隔，因此编辑前要做格式转换。
const toDateTimeLocalValue = (value) => {
  const normalized = normalizeText(value);
  if (!normalized) {
    return "";
  }
  const sliceLength = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/.test(normalized) ? 19 : 16;
  if (normalized.includes("T")) {
    return normalized.slice(0, sliceLength);
  }
  if (normalized.includes(" ")) {
    return normalized.replace(" ", "T").slice(0, sliceLength);
  }
  return normalized;
};

// 从表单值回写记录时，再把 `T` 格式转换回页面存储习惯的空格格式。
const fromDateTimeLocalValue = (value) => {
  const normalized = normalizeText(value);
  if (!normalized) {
    return "";
  }
  const sliceLength = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/.test(normalized) ? 19 : 16;
  return normalized.replace("T", " ").slice(0, sliceLength);
};

const formatBeijingDateTime = (value) => formatLocalDateTime(value, { includeSeconds: false });

const buildDefaultDueAt = (now = serverNowDate()) => formatBeijingDateTime(new Date(now.getTime() + 72 * 60 * 60 * 1000));

// 任务页表格和标签共用状态样式类映射。
const statusClass = (value) => {
  const normalized = normalizeText(value);
  if (normalized === STATUS_WAITING) {
    return "status waiting";
  }
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

const collectTaskTrayStatuses = (taskCode, samples) => {
  const normalizedTaskCode = normalizeText(taskCode);
  const trayStatusMap = new Map();

  (Array.isArray(samples) ? samples : []).forEach((sample) => {
    if (normalizeText(sample?.task_code) !== normalizedTaskCode) {
      return;
    }

    const sampleTrays = Array.isArray(sample?.trays) ? sample.trays : [];

    sampleTrays.forEach((tray) => {
      const trayCode = normalizeText(tray?.tray_code);
      if (!trayCode) {
        return;
      }
      const rawTrayStatus = normalizeText(tray?.status || tray?.tray_status || tray?.trayStatus);
      const trayStatus = rawTrayStatus ? normalizeLifecycleStatus(sample?.location, rawTrayStatus) : "";
      if (trayStatus) {
        trayStatusMap.set(trayCode, trayStatus);
      }
    });
  });

  return Array.from(trayStatusMap.values());
};

const aggregateTaskStatusFromSamples = (task, samples) => {
  const trayStatuses = collectTaskTrayStatuses(task?.code, samples);
  if (trayStatuses.length === 0) {
    return "";
  }

  if (trayStatuses.every((status) => RETURNED_TRAY_STATUSES.has(status))) {
    return STATUS_RETENTION;
  }
  if (trayStatuses.every((status) => COMPLETED_TRAY_STATUSES.has(status))) {
    return STATUS_COMPLETED;
  }
  if (trayStatuses.some((status) => ACTIVE_TRAY_STATUSES.has(status))) {
    return STATUS_RUNNING;
  }

  return "";
};

const buildTaskExperimentProgress = (taskCode, experiments) => {
  const normalizedTaskCode = normalizeText(taskCode);
  const matchedExperiments = (Array.isArray(experiments) ? experiments : []).filter(
    (experiment) => normalizeText(experiment?.task_code) === normalizedTaskCode,
  );
  const totalCount = matchedExperiments.length;
  const completedCount = matchedExperiments.filter((experiment) =>
    COMPLETED_EXPERIMENT_STATUSES.has(normalizeExperimentStatusLabel(experiment?.status)),
  ).length;

  return {
    completedCount,
    hasPartialCompletion: totalCount > 0 && completedCount > 0 && completedCount < totalCount,
    isFullyCompleted: totalCount > 0 && completedCount === totalCount,
    totalCount,
  };
};

const buildTaskStatusLabel = (status, experimentProgress) => {
  const normalizedStatus = normalizeText(status);
  if (normalizedStatus !== STATUS_RUNNING) {
    return normalizedStatus;
  }
  if (!experimentProgress?.hasPartialCompletion) {
    return normalizedStatus;
  }
  return `${STATUS_RUNNING}（已完成${experimentProgress.completedCount}个实验）`;
};

const resolveTaskDisplayStatus = (task, schedules, samples, experiments, now) => {
  const experimentProgress = buildTaskExperimentProgress(task?.code, experiments);
  const aggregatedStatus = aggregateTaskStatusFromSamples(task, samples);
  if (aggregatedStatus === STATUS_RETENTION) {
    return {
      displayStatus: STATUS_RETENTION,
      experimentProgress,
    };
  }
  if (experimentProgress.hasPartialCompletion) {
    return {
      displayStatus: STATUS_RUNNING,
      experimentProgress,
    };
  }
  if (aggregatedStatus) {
    return {
      displayStatus: aggregatedStatus,
      experimentProgress,
    };
  }

  const displayStatus = resolveTaskStatus(task, schedules, samples, now);
  return {
    displayStatus,
    experimentProgress,
  };
};

// 根据当前排程时间推导任务表格中显示的任务状态。
function resolveTaskStatus(task, schedules, samplesOrNow, nowMaybe) {
  const { samples } = resolveBuildTaskRowsArgs(samplesOrNow, nowMaybe);
  const taskCode = normalizeText(task?.code);
  const aggregatedStatus = aggregateTaskStatusFromSamples(task, samples);
  if (aggregatedStatus) {
    return aggregatedStatus;
  }
  const rawStatus = normalizeTaskStatusLabel(task?.status);
  if (rawStatus === STATUS_RUNNING) {
    return STATUS_RUNNING;
  }
  const relatedSchedules = (Array.isArray(schedules) ? schedules : []).filter(
    (schedule) => normalizeText(schedule?.task_code) === taskCode,
  );

  // 正式实验室排程只能说明“已排程”，不能自动说明“实验中”。
  const scheduledEntry = relatedSchedules.find((schedule) => !isLegacyTemporaryStagingSchedule(schedule?.device));
  if (scheduledEntry) {
    return STATUS_SCHEDULED;
  }

  if (rawStatus === "已受理") {
    return STATUS_WAITING;
  }
  return rawStatus || STATUS_WAITING;
}

// 将存储中的任务和排程转换为任务页专用的表格行。
function buildTaskRows(tasks, schedules, samplesOrNow, experimentsOrNow, nowMaybe) {
  const { samples, experiments, now } = resolveBuildTaskRowCollections(samplesOrNow, experimentsOrNow, nowMaybe);
  const taskList = filterActiveTasks(tasks, samples);
  const experimentsByTaskCode = new Map();
  const axisCodesByTaskCode = new Map();

  (Array.isArray(experiments) ? experiments : []).forEach((experiment) => {
    const taskCode = normalizeText(experiment?.task_code);
    if (!taskCode) {
      return;
    }
    const current = experimentsByTaskCode.get(taskCode) || [];
    const label =
      normalizeText(experiment?.experiment_type) ||
      normalizeText(experiment?.required_device);
    if (label) {
      current.push(label);
    }
    experimentsByTaskCode.set(taskCode, current);
    const axisCodes = normalizeAxisCodes(experiment?.axis_codes || experiment?.axisCodes);
    if (label && isAxisAwareExperimentType(label) && axisCodes.length > 0) {
      axisCodesByTaskCode.set(taskCode, {
        ...(axisCodesByTaskCode.get(taskCode) || {}),
        [label]: axisCodes,
      });
    }
  });

  return taskList
    .map((task, index) => {
      // 列表行展示状态由排程实时推导，原始状态保留给数据层参考。
      const { displayStatus, experimentProgress } = resolveTaskDisplayStatus(task, schedules, samples, experiments, now);
      const taskCode = normalizeText(task?.code) || `TASK-${index + 1}`;
      const experimentTypes = collectExperimentTypes(experimentsByTaskCode.get(taskCode) || []);
      const fallbackType = normalizeText(task?.test_type);
      const taskExperimentTypes = collectExperimentTypes(experimentTypes, fallbackType);
      const taskAxisCodesByTestType = normalizeAxisCodesByTestType(
        task?.axis_codes_by_test_type || task?.axisCodesByTestType,
        taskExperimentTypes,
      );
      const experimentAxisCodesByTestType = normalizeAxisCodesByTestType(
        axisCodesByTaskCode.get(taskCode),
        taskExperimentTypes,
      );
      const axisCodesByTestType = {
        ...taskAxisCodesByTestType,
        ...experimentAxisCodesByTestType,
      };
      const experimentSummary = buildExperimentTypeSummary(taskExperimentTypes);
      const experimentCount =
        taskExperimentTypes.length ||
        Number.parseInt(task?.experiment_count, 10) ||
        (experimentSummary ? 1 : 0);

      return {
        arrivalAt: formatDateTime(task?.arrival_at),
        attachment: normalizeText(task?.attachment),
        client: normalizeText(task?.client) || "内部部门",
        code: taskCode,
        conditions: normalizeText(task?.conditions),
        contact: normalizeText(task?.contact),
        contactInfo: normalizeText(task?.contact_info),
        createdAt: normalizeText(task?.created_at),
        displayStatus,
        displayStatusLabel: buildTaskStatusLabel(displayStatus, experimentProgress),
        dueAt: formatDateTime(task?.due_at),
        id: normalizeText(task?.id) || `task-${index + 1}`,
        name: normalizeText(task?.name),
        priority: normalizeText(task?.priority) || "中",
        remark: normalizeText(task?.remark),
        requiredDevice: normalizeText(task?.required_device) || "-",
        experimentCount,
        experimentSummary,
        sampleCount: normalizeText(task?.sample_count),
        sampleType: normalizeText(task?.sample_type),
        source: normalizeText(task?.source) || SOURCE_EXTERNAL,
        status: normalizeTaskStatusLabel(task?.status) || STATUS_WAITING,
        statusClass: statusClass(displayStatus),
        testType: experimentSummary,
        testTypes: taskExperimentTypes,
        axis_codes_by_test_type: axisCodesByTestType,
        axisCodesByTestType,
      };
    })
    .sort((left, right) => compareTaskCodes(left.code, right.code));
}

// 构建任务表格上方展示的汇总计数。
function buildTaskMetrics(rows, pendingExternalCount = 0) {
  const rowList = Array.isArray(rows) ? rows : [];
  const externalCount = rowList.filter((row) => row.source === SOURCE_EXTERNAL).length;
  const internalCount = rowList.filter((row) => row.source === SOURCE_INTERNAL).length;
  const retentionCount = rowList.filter((row) => row.displayStatus === STATUS_RETENTION).length;
  const waitingCount = rowList.filter((row) => row.displayStatus === STATUS_WAITING).length;
  const unscheduledCount = waitingCount;

  return {
    externalCount,
    internalCount,
    pendingExternalCount: Number.isFinite(Number(pendingExternalCount)) ? Number(pendingExternalCount) : 0,
    retentionCount,
    unscheduledCount,
    unscheduledLabel: unscheduledCount,
  };
}

// 根据当前可见行生成任务页使用的筛选选项。
function buildFilterOptions(rows) {
  const rowList = Array.isArray(rows) ? rows : [];
  return {
    // 状态筛选仅基于当前可见行生成，保证筛选器与列表同步。
    statusOptions: Array.from(new Set(rowList.map((row) => row.displayStatus).filter(Boolean))),
    // 试验类型选项只展示当前数据中存在的原子实验类型，组合串会先拆分去重。
    testTypeOptions: buildExperimentTypeOptions(rowList.map((row) => row.testType)),
  };
}

const resolveTaskCodeDate = (referenceValue) => {
  const raw = normalizeText(referenceValue);
  if (!raw) {
    return serverNowDate();
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return serverNowDate();
  }
  return parsed;
};

// 所有新任务统一按 SYLU-YYYY-MM-NNN 递增，不再按旧实验前缀分流。
function buildTaskCode(testType, tasks, referenceValue = serverNowDate()) {
  const codeDate = resolveTaskCodeDate(referenceValue);
  const year = codeDate.getFullYear();
  const month = String(codeDate.getMonth() + 1).padStart(2, "0");
  const taskList = Array.isArray(tasks) ? tasks : [];
  let maxSeq = 0;

  // 同月任务共用一条主线编号，不再按实验类型拆前缀。
  taskList.forEach((task) => {
    const taskCode = normalizeText(task?.code);
    const matched = taskCode.match(SYLU_TASK_CODE_PATTERN);
    if (!matched) {
      return;
    }
    if (matched[1] !== String(year) || matched[2] !== month) {
      return;
    }
    const parsed = Number.parseInt(matched[3], 10);
    if (Number.isFinite(parsed) && parsed > maxSeq) {
      maxSeq = parsed;
    }
  });

  return `SYLU-${year}-${month}-${String(maxSeq + 1).padStart(3, "0")}`;
}

const buildDefaultTaskName = (taskCode, tasks = []) => {
  const digits = normalizeText(taskCode).replace(/\D/g, "");
  const suffix = (digits || "00000").slice(-5).padStart(5, "0");
  const baseName = `测试实验${suffix}`;
  const existingNames = new Set((Array.isArray(tasks) ? tasks : []).map((task) => normalizeText(task?.name)).filter(Boolean));
  if (!existingNames.has(baseName)) {
    return baseName;
  }
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${baseName}-${index}`;
    if (!existingNames.has(candidate)) {
      return candidate;
    }
  }
  return `${baseName}-${Date.now().toString().slice(-3)}`;
};

// 通过表单工厂统一任务弹窗和抽屉的数据结构。
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
    sample_count: "",
    sample_type: "",
    source: SOURCE_INTERNAL,
    test_type: "",
    test_types: [],
    axis_codes_by_test_type: {},
  };
}

function buildExternalIntakeRows(intakes) {
  return (Array.isArray(intakes) ? intakes : [])
    .filter((item) => (normalizeText(item?.acceptance_status) || "pending") === "pending")
    .map((item, index) => {
      const testTypes = collectExperimentTypes(item?.test_types, item?.test_type);
      const code = normalizeText(item?.code) || `LIMS-TASK-${index + 1}`;
      return {
        ...item,
        id: normalizeText(item?.intake_id || item?.lims_request_id || item?.id) || `external-intake-${index + 1}`,
        intakeId: normalizeText(item?.intake_id || item?.lims_request_id || item?.id),
        code,
        name: normalizeText(item?.name),
        source: SOURCE_EXTERNAL,
        client: normalizeText(item?.client),
        contact: normalizeText(item?.contact),
        contactInfo: normalizeText(item?.contact_info),
        priority: normalizeText(item?.priority) || "中",
        sampleCount: normalizeText(item?.sample_count),
        sampleType: normalizeText(item?.sample_type),
        testType: buildExperimentTypeSummary(testTypes),
        testTypes,
        dueAt: formatDateTime(item?.due_at),
        arrivalAt: formatDateTime(item?.arrival_at),
        conditions: normalizeText(item?.conditions),
        attachment: normalizeText(item?.attachment),
        remark: normalizeText(item?.remark),
        receivedAt: formatDateTime(item?.received_at),
      };
    });
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
    sample_count: "",
    sample_type: "",
    source: SOURCE_EXTERNAL,
    status: STATUS_WAITING,
    test_type: "",
    test_types: [],
    axis_codes_by_test_type: {},
  };
}

// 将表格中的可见行映射回抽屉编辑表单所需的结构。
function buildTaskEditForm(row = {}) {
  const selectedTestTypes = collectExperimentTypes(row?.testTypes, row?.test_types, row?.testType, row?.test_type);
  const testTypeSummary = buildExperimentTypeSummary(selectedTestTypes);
  const axisCodesByTestType = normalizeAxisCodesByTestType(
    row?.axis_codes_by_test_type || row?.axisCodesByTestType,
    selectedTestTypes,
  );
  return {
    arrival_at: toDateTimeLocalValue(row?.arrivalAt ?? row?.arrival_at),
    code: normalizeText(row?.code),
    due_at: toDateTimeLocalValue(row?.dueAt ?? row?.due_at),
    id: normalizeText(row?.id),
    name: normalizeText(row?.name),
    priority: normalizeText(row?.priority) || "高",
    remark: normalizeText(row?.remark),
    sample_count: normalizeText(row?.sampleCount ?? row?.sample_count),
    sample_type: normalizeText(row?.sampleType ?? row?.sample_type),
    source: normalizeText(row?.source) || SOURCE_EXTERNAL,
    status: normalizeTaskStatusLabel(row?.displayStatus ?? row?.status) || STATUS_WAITING,
    test_type: testTypeSummary,
    test_types: selectedTestTypes,
    axis_codes_by_test_type: axisCodesByTestType,
  };
}

// 将新的受理表单转换为可持久化的任务记录。
function createTaskRecord(form, tasks) {
  const selectedTestTypes = collectExperimentTypes(form?.test_types);
  const axisCodesByTestType = normalizeAxisCodesByTestType(
    form?.axis_codes_by_test_type || form?.axisCodesByTestType,
    selectedTestTypes,
  );
  const testTypeSummary = buildExperimentTypeSummary(
    selectedTestTypes,
    selectedTestTypes.length > 0 ? "" : form?.test_type,
  );
  // 优先使用表单中已有任务号，否则按试验类型自动生成，再兜底为时间戳编号。
  const currentDate = serverNowDate();
  const taskCode = normalizeText(form?.code)
    || buildTaskCode(testTypeSummary, tasks, form?.due_at || form?.arrival_at || currentDate)
    || `SYLU-${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, "0")}-${serverNowMs().toString().slice(-3)}`;
  return {
    id: createId("task"),
    code: taskCode,
    name: normalizeText(form?.name) || buildDefaultTaskName(taskCode, tasks),
    source: normalizeText(form?.source) || SOURCE_EXTERNAL,
    client: normalizeText(form?.client) || "内部部门",
    contact: normalizeText(form?.contact),
    contact_info: normalizeText(form?.contact_info),
    priority: normalizeText(form?.priority) || "高",
    sample_count: normalizeText(form?.sample_count),
    sample_type: normalizeText(form?.sample_type),
    test_type: testTypeSummary,
    test_types: selectedTestTypes,
    ...(Object.keys(axisCodesByTestType).length > 0
      ? {
          axis_codes_by_test_type: axisCodesByTestType,
          axisCodesByTestType,
        }
      : {}),
    required_device: testTypeSummary,
    due_at: fromDateTimeLocalValue(form?.due_at) || buildDefaultDueAt(),
    arrival_at: "",
    conditions: normalizeText(form?.conditions),
    attachment: normalizeText(form?.attachment),
    remark: normalizeText(form?.remark),
    status: STATUS_WAITING,
    created_at: formatLocalDateTime(),
  };
}

// 将编辑表单中的修改应用回已存储的任务集合。
function updateTaskRecord(tasks, editForm) {
  const taskList = Array.isArray(tasks) ? tasks.map((task) => ({ ...task })) : [];
  const targetIndex = taskList.findIndex((task) => normalizeText(task?.id) === normalizeText(editForm?.id));
  if (targetIndex === -1) {
    return { previousCode: "", tasks: taskList };
  }

  const previousCode = normalizeText(taskList[targetIndex]?.code);
  const selectedTestTypes = collectExperimentTypes(editForm?.test_types);
  const testTypeSummary = buildExperimentTypeSummary(
    selectedTestTypes,
    selectedTestTypes.length > 0 ? "" : editForm?.test_type,
  );
  const axisCodesByTestType = normalizeAxisCodesByTestType(
    editForm?.axis_codes_by_test_type
      || editForm?.axisCodesByTestType
      || taskList[targetIndex]?.axis_codes_by_test_type
      || taskList[targetIndex]?.axisCodesByTestType,
    selectedTestTypes,
  );
  // 更新时保留未编辑字段，仅覆盖抽屉允许修改的部分。
  const nextTask = {
    ...taskList[targetIndex],
    code: normalizeText(editForm?.code) || taskList[targetIndex].code,
    due_at: fromDateTimeLocalValue(editForm?.due_at),
    name: normalizeText(editForm?.name),
    priority: normalizeText(editForm?.priority),
    remark: normalizeText(editForm?.remark),
    required_device: testTypeSummary || taskList[targetIndex].required_device,
    sample_count: normalizeText(editForm?.sample_count),
    sample_type: normalizeText(editForm?.sample_type),
    source: normalizeText(editForm?.source),
    status: taskList[targetIndex].status,
    test_type: testTypeSummary,
    test_types: collectExperimentTypes(selectedTestTypes, testTypeSummary),
    updated_at: formatLocalDateTime(),
  };
  if (Object.keys(axisCodesByTestType).length > 0) {
    nextTask.axis_codes_by_test_type = axisCodesByTestType;
    nextTask.axisCodesByTestType = axisCodesByTestType;
  } else {
    delete nextTask.axis_codes_by_test_type;
    delete nextTask.axisCodesByTestType;
  }
  taskList[targetIndex] = nextTask;

  return { previousCode, tasks: taskList };
}

// 删除任务及其需要一并删除的关联实体。
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
  if (
    taskHasRunningExperiment({
      experimentRuns: snapshot?.experimentRuns,
      experimentRunTrays: snapshot?.experimentRunTrays,
      experiments: snapshot?.experiments,
      samples: snapshot?.samples,
      schedules: snapshot?.schedules,
      task: targetTask,
    })
  ) {
    return {
      error: RUNNING_TASK_DELETE_MESSAGE,
      samples: Array.isArray(snapshot?.samples) ? snapshot.samples : [],
      schedules: Array.isArray(snapshot?.schedules) ? snapshot.schedules : [],
      streams: Array.isArray(snapshot?.streams) ? snapshot.streams : [],
      tasks: taskList,
    };
  }
  return {
    // 任务删除后，样品、排程和数据流中同任务号的记录一并移除。
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

// 按任务号生成样品编号列表，并尽量沿用已有样品数量和最大序号。
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
  let targetCount = normalizeTaskSampleCount(plannedRaw, existingSamples.length);
  if (targetCount <= 0 && maxIndex > 0) {
    targetCount = normalizeTaskSampleCount(maxIndex);
  }

  return Array.from({ length: targetCount }, (_, index) => `${normalizedCode}-SP-${String(index + 1).padStart(3, "0")}`);
}

const splitSampleCodeText = (value) =>
  normalizeText(value)
    .split(/[\n\r,，、;；\s]+/)
    .map((item) => normalizeText(item))
    .filter(Boolean);

function validateSampleCodeDraft({ codes, samples, taskCode }) {
  const normalizedTaskCode = normalizeText(taskCode);
  const codeList = Array.isArray(codes) ? codes.map((code) => normalizeText(code)).filter(Boolean) : [];
  if (codeList.length === 0) {
    return "请填写至少一个样品编号";
  }
  if (codeList.length > MAX_SAMPLE_COUNT) {
    return `样品编号最多为 ${MAX_SAMPLE_COUNT} 个`;
  }
  if (codeList.length !== new Set(codeList).size) {
    return "样品编号不能重复";
  }
  const occupiedByOtherTask = new Set(
    (Array.isArray(samples) ? samples : [])
      .filter((sample) => normalizeText(sample?.task_code) !== normalizedTaskCode)
      .map((sample) => normalizeText(sample?.code))
      .filter(Boolean),
  );
  const duplicateWithOthers = codeList.filter((code) => occupiedByOtherTask.has(code));
  if (duplicateWithOthers.length > 0) {
    return `样品编号已被其他任务使用：${duplicateWithOthers.join("、")}`;
  }
  return "";
}

function applyTaskSampleCodes(samples, task, codes) {
  const sampleList = Array.isArray(samples) ? samples.map((sample) => ({ ...sample })) : [];
  const taskCode = normalizeText(task?.code);
  const nextCodes = Array.isArray(codes) ? codes.map((code) => normalizeText(code)).filter(Boolean) : [];
  if (!taskCode || nextCodes.length === 0) {
    return sampleList;
  }

  const now = formatLocalDateTime();
  const relatedSamples = sampleList
    .filter((sample) => normalizeText(sample?.task_code) === taskCode)
    .sort((left, right) => compareTaskCodes(left?.code, right?.code));
  const nextSamples = sampleList.filter((sample) => normalizeText(sample?.task_code) !== taskCode);

  nextCodes.forEach((code, index) => {
    const existing = relatedSamples[index];
    if (existing) {
      nextSamples.push({
        ...existing,
        code,
        task_code: taskCode,
        trays: Array.isArray(existing.trays)
          ? existing.trays.map((tray) => ({
              ...tray,
              sample_code: normalizeText(tray?.sample_code) ? code : tray?.sample_code,
              sampleCode: normalizeText(tray?.sampleCode) ? code : tray?.sampleCode,
            }))
          : existing.trays,
        updated_at: now,
      });
      return;
    }
    nextSamples.push({
      id: createId("sample"),
      code,
      task_code: taskCode,
      location: "",
      owner: "",
      status: "样品运输中",
      flow_status: "样品运输中",
      created_at: now,
    });
  });

  return nextSamples;
}

// 在任务编辑后同步维护与任务绑定的样品编号。
function syncTaskSamples(samples, task, previousTaskCode = "", options = {}) {
  const sampleList = Array.isArray(samples) ? samples.map((sample) => ({ ...sample })) : [];
  const taskCode = normalizeText(task?.code);
  if (!taskCode) {
    return sampleList;
  }

  const oldTaskCode = normalizeText(previousTaskCode);
  if (oldTaskCode && oldTaskCode !== taskCode) {
    // 任务号变更时，先把原有关联样品整体迁移到新任务号。
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
  const preserveExistingCodes = Boolean(options?.preserveExistingCodes);

  // 目标样品编号列表决定保留哪些已有样品，以及是否需要补建新样品。
  expectedCodes.forEach((code, index) => {
    const existingSample = relatedSamples[index];
    if (existingSample) {
      nextSamples.push({
        ...existingSample,
        code: preserveExistingCodes ? normalizeText(existingSample?.code) || code : code,
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
      status: "样品运输中",
      flow_status: "样品运输中",
      created_at: formatLocalDateTime(),
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
  buildExternalIntakeRows,
  buildTaskCode,
  buildTaskEditForm,
  buildTaskExperimentProgress,
  buildTaskMetrics,
  buildTaskRows,
  buildTaskSampleCodes,
  buildTaskStatusLabel,
  buildExperimentTypeAxisSummary,
  createTaskEditForm,
  createTaskIntakeForm,
  createTaskRecord,
  deleteTaskSnapshot,
  DEFAULT_AXIS_CODES,
  formatAxisCodeLabel,
  isAxisAwareExperimentType,
  normalizeText,
  normalizeAxisCodes,
  normalizeAxisCodesByTestType,
  normalizeTaskSampleCount,
  applyTaskSampleCodes,
  aggregateTaskStatusFromSamples,
  resolveTaskStatus,
  splitSampleCodeText,
  syncTaskSamples,
  updateTaskRecord,
  validateSampleCodeDraft,
  validateTaskSampleCount,
  validateTaskTextFields,
};
