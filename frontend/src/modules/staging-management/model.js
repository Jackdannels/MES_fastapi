import { synchronizeSamplesForTrayCodes } from "@/modules/samples/samplesFlowModel";
import { getLabsForTestType } from "@/lib/labs";

const TASKS_KEY = "mes.tasks";
const SCHEDULES_KEY = "mes.schedules";
const EXPERIMENTS_KEY = "mes.experiments";
const EXPERIMENT_TRAYS_KEY = "mes.experiment_trays";
const SAMPLES_KEY = "mes.samples";
const STAGING_EVENTS_KEY = "mes.staging_events";
const STAGING_LOCATION = "恒温恒湿间（暂存间）";
const POST_EXPERIMENT_STAGING_STATUS = "放置实验后暂存间";
const PRE_STAGING_STATUSES = new Set(["送至暂存间", "已到达暂存间"]);
const STOCK_IN_CANDIDATE_STATUSES = new Set([
  ...PRE_STAGING_STATUSES,
  "实验已完成",
  "实验完成",
  POST_EXPERIMENT_STAGING_STATUS,
]);

const normalizeText = (value) => String(value ?? "").trim();
const asArray = (value) => (Array.isArray(value) ? value : []);
const COMPLETED_EXPERIMENT_STATUSES = new Set(["实验已完成", "实验完成", POST_EXPERIMENT_STAGING_STATUS]);

const createId = (prefix) => {
  const stamp = Date.now();
  const random = Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, "0");
  return `${prefix}-${stamp}-${random}`;
};

const formatDateTime = (value) => {
  const normalized = normalizeText(value);
  if (!normalized) {
    return "-";
  }

  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    return normalized.replace("T", " ");
  }

  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  const hour = `${date.getHours()}`.padStart(2, "0");
  const minute = `${date.getMinutes()}`.padStart(2, "0");
  return `${year}-${month}-${day} ${hour}:${minute}`;
};

const resolveStatusClass = (status) => {
  const normalized = normalizeText(status);
  if (normalized === "待入库") {
    return "status accepted";
  }
  if (normalized === "已入库" || normalized === POST_EXPERIMENT_STAGING_STATUS) {
    return "status retention";
  }
  if (normalized === "已出库") {
    return "status warn";
  }
  return "status";
};

const compareValues = (left, right, direction) => {
  const factor = direction === "desc" ? -1 : 1;
  const leftNumber = Number(left);
  const rightNumber = Number(right);

  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
    return (leftNumber - rightNumber) * factor;
  }

  return normalizeText(left).localeCompare(normalizeText(right), "zh-Hans-CN") * factor;
};

const compareDateTimes = (left, right, direction) => {
  const leftTime = new Date(normalizeText(left)).getTime();
  const rightTime = new Date(normalizeText(right)).getTime();

  if (!Number.isNaN(leftTime) && !Number.isNaN(rightTime)) {
    return direction === "desc" ? rightTime - leftTime : leftTime - rightTime;
  }

  return compareValues(left, right, direction);
};

const toDateKey = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const parseTimeValue = (value) => {
  const timestamp = Date.parse(normalizeText(value));
  return Number.isFinite(timestamp) ? timestamp : Number.MAX_SAFE_INTEGER;
};

const isStagingDestination = (value) => normalizeText(value).includes("暂存间");

const resolveExperimentName = (experiment, fallback = "") =>
  normalizeText(experiment?.experiment_name)
  || normalizeText(experiment?.name)
  || normalizeText(experiment?.experiment_type)
  || normalizeText(fallback);

const parseExperimentHistoryDetail = (detail, taskCode) => {
  const segments = normalizeText(detail)
    .split(" / ")
    .map((segment) => normalizeText(segment))
    .filter(Boolean);
  if (segments.length < 3 || segments[0] !== normalizeText(taskCode)) {
    return null;
  }
  return {
    experimentName: segments[1],
    status: segments[2],
  };
};

const buildTaskMap = (tasks) => {
  const map = new Map();
  asArray(tasks).forEach((task) => {
    const code = normalizeText(task?.code);
    if (code) {
      map.set(code, task);
    }
  });
  return map;
};

const buildEventMap = (stagingEvents) => {
  const eventMap = new Map();
  asArray(stagingEvents).forEach((event) => {
    const trayCode = normalizeText(event?.tray_code);
    if (!trayCode) {
      return;
    }
    const current = eventMap.get(trayCode) || [];
    current.push({ ...event });
    eventMap.set(trayCode, current);
  });

  eventMap.forEach((events, trayCode) => {
    eventMap.set(
      trayCode,
      events.slice().sort((left, right) => compareDateTimes(left?.time, right?.time, "asc")),
    );
  });

  return eventMap;
};

const isCurrentStagingStatus = (status) => {
  const normalized = normalizeText(status);
  return normalized === "已入库" || normalized === POST_EXPERIMENT_STAGING_STATUS;
};

const resolveTrayStatus = (statuses, events, options = {}) => {
  const latestEvent = asArray(events).at(-1);
  const hasStoredStatus = statuses.some((status) => normalizeText(status) === "已到达暂存间" || normalizeText(status) === "暂存间存放");
  const hasStockInCandidateStatus = statuses.some((status) => STOCK_IN_CANDIDATE_STATUSES.has(normalizeText(status)));
  const hasCompletedExperimentStatus = statuses.some((status) => COMPLETED_EXPERIMENT_STATUSES.has(normalizeText(status)));
  if (normalizeText(latestEvent?.action) === "stock_out" && hasCompletedExperimentStatus) {
    return "待入库";
  }
  if (normalizeText(latestEvent?.action) === "stock_out") {
    return "已出库";
  }
  if (normalizeText(latestEvent?.action) === "stock_in") {
    return options.isPostExperimentInbound ? POST_EXPERIMENT_STAGING_STATUS : "已入库";
  }
  if (hasStoredStatus) {
    return "已入库";
  }
  if (hasStockInCandidateStatus) {
    return "待入库";
  }
  return "";
};

const buildExperimentMap = (experiments) => {
  const map = new Map();
  asArray(experiments).forEach((experiment) => {
    const code = normalizeText(experiment?.experiment_code);
    if (code) {
      map.set(code, experiment);
    }
  });
  return map;
};

const collectTrayExperimentCodes = ({ taskCode, trayCode, experimentTrays }) => {
  const codes = new Set();
  asArray(experimentTrays).forEach((entry) => {
    if (normalizeText(entry?.task_code) !== taskCode || normalizeText(entry?.tray_code) !== trayCode) {
      return;
    }
    const experimentCode = normalizeText(entry?.experiment_code);
    if (experimentCode) {
      codes.add(experimentCode);
    }
  });
  return codes;
};

const collectCompletedExperimentNames = ({ samples, taskCode, trayCode }) => {
  const names = new Set();
  asArray(samples).forEach((sample) => {
    if (normalizeText(sample?.task_code) !== taskCode) {
      return;
    }
    const touchesTray = asArray(sample?.trays).some((tray) => normalizeText(tray?.tray_code) === trayCode);
    if (!touchesTray) {
      return;
    }
    asArray(sample?.history).forEach((entry) => {
      const parsed = parseExperimentHistoryDetail(entry?.detail, taskCode);
      if (parsed && COMPLETED_EXPERIMENT_STATUSES.has(parsed.status)) {
        names.add(parsed.experimentName);
      }
    });
  });
  return names;
};

const hasRemainingMappedExperiment = ({ samples, taskCode, trayCode, experiments, experimentTrays }) => {
  const experimentMap = buildExperimentMap(experiments);
  const trayExperimentCodes = collectTrayExperimentCodes({ taskCode, trayCode, experimentTrays });
  if (trayExperimentCodes.size === 0) {
    return false;
  }

  const completedExperimentNames = collectCompletedExperimentNames({ samples, taskCode, trayCode });
  return Array.from(trayExperimentCodes).some((experimentCode) => {
    const experimentName = resolveExperimentName(experimentMap.get(experimentCode));
    return !experimentName || !completedExperimentNames.has(experimentName);
  });
};

const resolveTrayTargetDestination = ({ row, samples, schedules, experiments, experimentTrays }) => {
  const taskCode = normalizeText(row?.taskCode);
  const trayCode = normalizeText(row?.trayCode);
  if (!taskCode || !trayCode) {
    return null;
  }

  const experimentMap = buildExperimentMap(experiments);
  const trayExperimentCodes = collectTrayExperimentCodes({ taskCode, trayCode, experimentTrays });
  const completedExperimentNames = collectCompletedExperimentNames({ samples, taskCode, trayCode });
  const acceptsExperimentCode = (experimentCode) => trayExperimentCodes.size === 0 || trayExperimentCodes.has(normalizeText(experimentCode));
  const isUnfinishedExperiment = (experimentCode, fallbackName = "") => {
    const experiment = experimentMap.get(normalizeText(experimentCode));
    const experimentName = resolveExperimentName(experiment, fallbackName);
    return !experimentName || !completedExperimentNames.has(experimentName);
  };

  const scheduledDestinations = asArray(schedules)
    .filter((schedule) => {
      const experimentCode = normalizeText(schedule?.experiment_code);
      const device = normalizeText(schedule?.device);
      return (
        normalizeText(schedule?.task_code) === taskCode
        && device
        && !isStagingDestination(device)
        && acceptsExperimentCode(experimentCode)
        && isUnfinishedExperiment(experimentCode, schedule?.experiment_name)
      );
    })
    .sort((left, right) => parseTimeValue(left?.start_at) - parseTimeValue(right?.start_at));

  const scheduled = scheduledDestinations[0];
  if (scheduled) {
    const experimentCode = normalizeText(scheduled?.experiment_code);
    const experiment = experimentMap.get(experimentCode);
    return {
      targetExperimentCode: experimentCode,
      targetExperimentName: resolveExperimentName(experiment, scheduled?.experiment_name),
      targetLab: normalizeText(scheduled?.device),
      targetScheduleStartAt: normalizeText(scheduled?.start_at),
      targetScheduleEndAt: normalizeText(scheduled?.end_at),
    };
  }

  const fallbackExperiment = asArray(experiments).find((experiment) => {
    const experimentCode = normalizeText(experiment?.experiment_code);
    const requiredDevice = normalizeText(experiment?.required_device);
    return (
      normalizeText(experiment?.task_code) === taskCode
      && requiredDevice
      && !isStagingDestination(requiredDevice)
      && acceptsExperimentCode(experimentCode)
      && isUnfinishedExperiment(experimentCode, experiment?.experiment_name)
    );
  });
  if (fallbackExperiment) {
    return {
      targetExperimentCode: normalizeText(fallbackExperiment?.experiment_code),
      targetExperimentName: resolveExperimentName(fallbackExperiment),
      targetLab: normalizeText(fallbackExperiment?.required_device),
      targetScheduleStartAt: "",
      targetScheduleEndAt: "",
    };
  }

  if (trayExperimentCodes.size > 0) {
    return null;
  }

  const fallbackLab = getLabsForTestType(row?.testType)[0] || "";
  if (fallbackLab && !isStagingDestination(fallbackLab)) {
    return {
      targetExperimentCode: "",
      targetExperimentName: normalizeText(row?.testType),
      targetLab: fallbackLab,
      targetScheduleStartAt: "",
      targetScheduleEndAt: "",
    };
  }

  return null;
};

function buildZancunRowsFromSnapshot(snapshot = {}, options = {}) {
  const tasks = asArray(snapshot[TASKS_KEY]);
  const schedules = asArray(snapshot[SCHEDULES_KEY]);
  const experiments = asArray(snapshot[EXPERIMENTS_KEY]);
  const experimentTrays = asArray(snapshot[EXPERIMENT_TRAYS_KEY]);
  const samples = asArray(snapshot[SAMPLES_KEY]);
  const stagingEvents = asArray(snapshot[STAGING_EVENTS_KEY]);
  const taskMap = buildTaskMap(tasks);
  const eventMap = buildEventMap(stagingEvents);
  const trayMap = new Map();

  samples.forEach((sample) => {
    const taskCode = normalizeText(sample?.task_code);
    asArray(sample?.trays).forEach((tray, trayIndex) => {
      const trayCode = normalizeText(tray?.tray_code);
      if (!trayCode) {
        return;
      }

      const task = taskMap.get(taskCode) || {};
      const current = trayMap.get(trayCode) || {
        id: createId("zancun-row"),
        location: normalizeText(sample?.location) || STAGING_LOCATION,
        owner: normalizeText(sample?.owner) || "待确认",
        quantity: 0,
        sampleType: normalizeText(task?.test_type || task?.sample_type || sample?.sample_type) || "待确认样品类型",
        source: normalizeText(task?.source) || "待确认来源",
        statuses: [],
        taskCode,
        testType: normalizeText(task?.test_type),
        trayCode,
      };

      current.taskCode = current.taskCode || taskCode;
      current.owner = current.owner || normalizeText(sample?.owner) || "待确认";
      current.location = current.location || normalizeText(sample?.location) || STAGING_LOCATION;
      current.sampleType = current.sampleType || normalizeText(task?.test_type || task?.sample_type || sample?.sample_type) || "待确认样品类型";
      current.source = current.source || normalizeText(task?.source) || "待确认来源";
      current.testType = current.testType || normalizeText(task?.test_type);
      current.quantity += Number(tray?.quantity) || 1;
      current.statuses.push(normalizeText(tray?.status) || normalizeText(sample?.status) || `${taskCode}-tray-${trayIndex + 1}`);
      trayMap.set(trayCode, current);
    });
  });

  eventMap.forEach((events, trayCode) => {
    if (!trayMap.has(trayCode)) {
      const latestEvent = events.at(-1) || {};
      trayMap.set(trayCode, {
        id: createId("zancun-row"),
        location: STAGING_LOCATION,
        owner: normalizeText(latestEvent?.operator) || "待确认",
        quantity: 0,
        sampleType: "待确认样品类型",
        source: "待确认来源",
        statuses: [],
        taskCode: normalizeText(latestEvent?.task_code),
        testType: "",
        trayCode,
      });
    }
  });

  return Array.from(trayMap.values())
    .map((row) => {
      const events = eventMap.get(row.trayCode) || [];
      const lastEvent = events.at(-1) || null;
      const lastStockInEvent = events
        .slice()
        .reverse()
        .find((event) => normalizeText(event?.action) === "stock_in") || null;
      const hasCompletedExperimentStatus = row.statuses.some((status) => COMPLETED_EXPERIMENT_STATUSES.has(normalizeText(status)));
      const isPostExperimentInbound =
        hasCompletedExperimentStatus
        && !hasRemainingMappedExperiment({
          experiments,
          experimentTrays,
          samples,
          taskCode: normalizeText(row.taskCode),
          trayCode: normalizeText(row.trayCode),
        });
      const status = resolveTrayStatus(row.statuses, events, { isPostExperimentInbound });
      const stockInToday = events.some(
        (event) => normalizeText(event?.action) === "stock_in" && toDateKey(event?.time) === toDateKey(options.now || new Date()),
      );
      const stockOutToday = events.some(
        (event) => normalizeText(event?.action) === "stock_out" && toDateKey(event?.time) === toDateKey(options.now || new Date()),
      );

      const targetDestination = resolveTrayTargetDestination({
        experiments,
        experimentTrays,
        row,
        samples,
        schedules,
      });

      return {
        id: row.id,
        location: status === "已出库" ? "已完成出库" : normalizeText(row.location) || STAGING_LOCATION,
        owner: normalizeText(row.owner) || "待确认",
        quantity: Number(row.quantity) || 0,
        sampleType: normalizeText(row.sampleType) || "待确认样品类型",
        source: normalizeText(row.source) || "待确认来源",
        status,
        statusClass: resolveStatusClass(status),
        stockInAt: normalizeText(lastStockInEvent?.time),
        stockInAtDisplay: formatDateTime(lastStockInEvent?.time),
        stockInToday,
        stockOutToday,
        taskCode: normalizeText(row.taskCode),
        isPostExperimentInbound,
        targetExperimentCode: targetDestination?.targetExperimentCode || "",
        targetExperimentName: targetDestination?.targetExperimentName || "",
        targetLab: targetDestination?.targetLab || "",
        targetScheduleEndAt: targetDestination?.targetScheduleEndAt || "",
        targetScheduleStartAt: targetDestination?.targetScheduleStartAt || "",
        testType: normalizeText(row.testType),
        trayCode: normalizeText(row.trayCode),
        updatedAt: normalizeText(lastEvent?.time || lastStockInEvent?.time),
      };
    })
    .filter((row) => Boolean(row.status))
    .sort((left, right) => compareValues(left.trayCode, right.trayCode, "asc"));
}

function buildZancunInventorySections(rows = []) {
  const rowList = asArray(rows);
  return {
    currentStagingRows: rowList
      .filter((row) => isCurrentStagingStatus(row?.status))
      .sort((left, right) => compareValues(left?.trayCode, right?.trayCode, "asc")),
    plannedInboundRows: rowList
      .filter((row) => normalizeText(row?.status) === "待入库")
      .sort((left, right) => compareValues(left?.trayCode, right?.trayCode, "asc")),
  };
}

function buildZancunMetrics(input = {}) {
  const rowList = Array.isArray(input) ? input : asArray(input.rows);
  const stagingEvents = Array.isArray(input) ? [] : asArray(input.stagingEvents);
  const todayKey = toDateKey(Array.isArray(input) ? new Date() : (input.now || new Date()));
  const stockedInToday = new Set();
  const stockedOutToday = new Set();

  stagingEvents.forEach((event) => {
    const trayCode = normalizeText(event?.tray_code);
    if (!trayCode || toDateKey(event?.time) !== todayKey) {
      return;
    }
    if (normalizeText(event?.action) === "stock_in") {
      stockedInToday.add(trayCode);
    }
    if (normalizeText(event?.action) === "stock_out") {
      stockedOutToday.add(trayCode);
    }
  });

  return {
    stockedInTodayCount: stockedInToday.size,
    stockedOutTodayCount: stockedOutToday.size,
    totalQuantity: rowList
      .filter((row) => isCurrentStagingStatus(row?.status))
      .reduce((sum, row) => sum + (Number(row?.quantity) || 0), 0),
  };
}

function buildZancunOverviewView(input = {}) {
  const rows = asArray(input.rows);
  const filters = input.filters && typeof input.filters === "object" ? input.filters : {};
  const sort = input.sort && typeof input.sort === "object" ? input.sort : {};
  const pageSize = Number(input.pageSize) > 0 ? Number(input.pageSize) : 5;
  const query = normalizeText(filters.query).toLowerCase();
  const sampleType = normalizeText(filters.sampleType);
  const status = normalizeText(filters.status);
  const metricMode = normalizeText(filters.metricMode) || "all";
  const sortKey = normalizeText(sort.key) || "trayCode";
  const sortDirection = normalizeText(sort.direction) === "desc" ? "desc" : "asc";

  const filteredRows = rows
    .filter((row) => {
      if (metricMode === "active" && normalizeText(row?.status) === "已出库") {
        return false;
      }
      if (metricMode === "stockedInToday" && !row?.stockInToday) {
        return false;
      }
      if (metricMode === "stockedOutToday" && !row?.stockOutToday) {
        return false;
      }
      if (sampleType && normalizeText(row?.sampleType) !== sampleType) {
        return false;
      }
      if (status && normalizeText(row?.status) !== status) {
        return false;
      }
      if (!query) {
        return true;
      }

      const searchText = [row.trayCode, row.taskCode, row.owner, row.location, row.source, row.sampleType, row.status]
        .map((item) => normalizeText(item).toLowerCase())
        .join(" ");
      return searchText.includes(query);
    })
    .slice()
    .sort((left, right) => {
      if (sortKey === "stockInAt") {
        const order = compareDateTimes(left?.stockInAt, right?.stockInAt, sortDirection);
        if (order !== 0) {
          return order;
        }
        return compareValues(left?.trayCode, right?.trayCode, "asc");
      }
      const order = compareValues(left?.[sortKey], right?.[sortKey], sortDirection);
      if (order !== 0) {
        return order;
      }
      return compareValues(left?.trayCode, right?.trayCode, "asc");
    });

  const totalCount = filteredRows.length;
  const pageCount = Math.max(1, Math.ceil(totalCount / pageSize));
  const rawPage = Number.parseInt(String(input.page ?? 1), 10);
  const currentPage = Number.isFinite(rawPage) ? Math.min(Math.max(rawPage, 1), pageCount) : 1;
  const startIndex = (currentPage - 1) * pageSize;

  return {
    currentPage,
    pageCount,
    rows: filteredRows.slice(startIndex, startIndex + pageSize),
    totalCount,
  };
}

function buildZancunScanDetail(rows, code, mode) {
  const rowList = asArray(rows);
  const normalizedCode = normalizeText(code);
  const actionMode = mode === "stockOut" ? "stockOut" : "stockIn";
  const matchedRow = rowList.find((row) => normalizeText(row?.trayCode) === normalizedCode);

  if (!matchedRow) {
    return {
      actionLabel: actionMode === "stockIn" ? "入库" : "出库",
      actionMode,
      found: false,
      location: actionMode === "stockIn" ? "待确认暂存库位" : "待确认当前位置",
      nextStatus: actionMode === "stockIn" ? "已入库" : "已出库",
      owner: "待确认",
      quantity: 0,
      sampleType: "待确认样品类型",
      source: "扫码识别",
      status: actionMode === "stockIn" ? "待入库" : "待出库",
      stockInAt: "",
      stockInAtDisplay: "-",
      taskCode: "待确认任务",
      targetExperimentCode: "",
      targetExperimentName: "",
      targetLab: "",
      trayCode: normalizedCode,
    };
  }

  return {
    ...matchedRow,
    actionLabel: actionMode === "stockIn" ? "入库" : "出库",
    actionMode,
    found: true,
    nextStatus: actionMode === "stockIn" ? "已入库" : "已出库",
    stockInAtDisplay: formatDateTime(matchedRow.stockInAt),
  };
}

function applyZancunInventoryAction(input = {}) {
  const snapshot = input.snapshot && typeof input.snapshot === "object" ? input.snapshot : {};
  const payload = input.payload && typeof input.payload === "object" ? input.payload : {};
  const actionMode = payload.mode === "stockOut" ? "stockOut" : "stockIn";
  const normalizedCode = normalizeText(payload.code);
  const actionTime = normalizeText(payload.actionTime || input.now) || new Date().toISOString();

  const nextSnapshot = {
    ...snapshot,
    [TASKS_KEY]: asArray(snapshot[TASKS_KEY]).map((task) => ({ ...task })),
    [SCHEDULES_KEY]: asArray(snapshot[SCHEDULES_KEY]).map((schedule) => ({ ...schedule })),
    [EXPERIMENTS_KEY]: asArray(snapshot[EXPERIMENTS_KEY]).map((experiment) => ({ ...experiment })),
    [EXPERIMENT_TRAYS_KEY]: asArray(snapshot[EXPERIMENT_TRAYS_KEY]).map((entry) => ({ ...entry })),
    [SAMPLES_KEY]: asArray(snapshot[SAMPLES_KEY]).map((sample) => ({
      ...sample,
      trays: asArray(sample?.trays).map((tray) => ({ ...tray })),
    })),
    [STAGING_EVENTS_KEY]: asArray(snapshot[STAGING_EVENTS_KEY]).map((event) => ({ ...event })),
  };

  if (!normalizedCode) {
    return {
      error: "未提供托盘编号。",
      row: null,
      snapshot: nextSnapshot,
    };
  }

  const rows = buildZancunRowsFromSnapshot(nextSnapshot, { now: actionTime });
  const matchedRow = rows.find((row) => normalizeText(row?.trayCode) === normalizedCode);
  if (!matchedRow) {
    return {
      error: actionMode === "stockOut" ? "未找到对应的出库托盘。" : "未找到对应的入库托盘。",
      row: null,
      snapshot: nextSnapshot,
    };
  }

  if (actionMode === "stockOut" && normalizeText(matchedRow.status) === POST_EXPERIMENT_STAGING_STATUS) {
    return {
      error: "该托盘已完成全部实验，当前应保留在暂存间。",
      row: null,
      snapshot: nextSnapshot,
    };
  }

  if (actionMode === "stockOut" && normalizeText(matchedRow.status) !== "已入库") {
    return {
      error: "该托盘尚未完成暂存间扫码入库。",
      row: null,
      snapshot: nextSnapshot,
    };
  }

  if (actionMode === "stockOut" && !normalizeText(matchedRow.targetLab)) {
    return {
      error: "未找到该托盘可出库的目标实验室。",
      row: null,
      snapshot: nextSnapshot,
    };
  }

  const selectedTargetLab = normalizeText(payload.targetLab);
  if (actionMode === "stockOut" && !selectedTargetLab) {
    return {
      error: "请选择目标实验室后再出库。",
      row: null,
      snapshot: nextSnapshot,
    };
  }

  nextSnapshot[STAGING_EVENTS_KEY].push({
    id: createId("staging-event"),
    tray_code: matchedRow.trayCode,
    task_code: matchedRow.taskCode,
    action: actionMode === "stockIn" ? "stock_in" : "stock_out",
    time: actionTime,
    operator: normalizeText(payload.operator) || "扫码登记",
    ...(actionMode === "stockOut"
      ? {
          target_experiment_code: normalizeText(matchedRow.targetExperimentCode),
          target_experiment_name: normalizeText(matchedRow.targetExperimentName),
          target_lab: selectedTargetLab,
        }
      : {}),
  });

  if (actionMode === "stockIn") {
    const nextStockInStatus = matchedRow.isPostExperimentInbound ? POST_EXPERIMENT_STAGING_STATUS : "已到达暂存间";
    const synced = synchronizeSamplesForTrayCodes({
      historyAction: "暂存间扫码入库",
      historyDetail: `${matchedRow.trayCode} ${nextStockInStatus}`,
      location: STAGING_LOCATION,
      now: actionTime,
      owner: normalizeText(payload.operator) || "扫码登记",
      samples: nextSnapshot[SAMPLES_KEY],
      status: nextStockInStatus,
      trayCodes: [matchedRow.trayCode],
    });
    nextSnapshot[SAMPLES_KEY] = synced.samples;
  }

  if (actionMode === "stockOut") {
    const synced = synchronizeSamplesForTrayCodes({
      historyAction: "暂存间扫码出库",
      historyDetail: `${matchedRow.trayCode} 送至 ${selectedTargetLab}`,
      location: selectedTargetLab,
      now: actionTime,
      owner: normalizeText(payload.operator) || "扫码登记",
      samples: nextSnapshot[SAMPLES_KEY],
      status: "送至实验室",
      trayCodes: [matchedRow.trayCode],
    });
    nextSnapshot[SAMPLES_KEY] = synced.samples;
  }

  const nextRows = buildZancunRowsFromSnapshot(nextSnapshot, { now: actionTime });
  const updatedRow = nextRows.find((row) => normalizeText(row?.trayCode) === normalizedCode) || null;

  return {
    error: "",
    row: updatedRow,
    snapshot: nextSnapshot,
  };
}

export {
  applyZancunInventoryAction,
  buildZancunInventorySections,
  buildZancunMetrics,
  buildZancunOverviewView,
  buildZancunRowsFromSnapshot,
  buildZancunScanDetail,
};
