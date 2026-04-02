const TASKS_KEY = "mes.tasks";
const SAMPLES_KEY = "mes.samples";
const STAGING_EVENTS_KEY = "mes.staging_events";
const STAGING_LOCATION = "恒温恒湿间（暂存间）";
const PRE_STAGING_STATUSES = new Set(["送至暂存间", "已到达暂存间"]);

const normalizeText = (value) => String(value ?? "").trim();
const asArray = (value) => (Array.isArray(value) ? value : []);

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
  if (normalized === "已入库") {
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

const resolveTrayStatus = (statuses, events) => {
  const latestEvent = asArray(events).at(-1);
  if (normalizeText(latestEvent?.action) === "stock_out") {
    return "已出库";
  }
  if (normalizeText(latestEvent?.action) === "stock_in") {
    return "已入库";
  }
  if (statuses.some((status) => PRE_STAGING_STATUSES.has(status))) {
    return "待入库";
  }
  return "";
};

function buildZancunRowsFromSnapshot(snapshot = {}, options = {}) {
  const tasks = asArray(snapshot[TASKS_KEY]);
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
        trayCode,
      };

      current.taskCode = current.taskCode || taskCode;
      current.owner = current.owner || normalizeText(sample?.owner) || "待确认";
      current.location = current.location || normalizeText(sample?.location) || STAGING_LOCATION;
      current.sampleType = current.sampleType || normalizeText(task?.test_type || task?.sample_type || sample?.sample_type) || "待确认样品类型";
      current.source = current.source || normalizeText(task?.source) || "待确认来源";
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
      const status = resolveTrayStatus(row.statuses, events);
      const stockInToday = events.some(
        (event) => normalizeText(event?.action) === "stock_in" && toDateKey(event?.time) === toDateKey(options.now || new Date()),
      );
      const stockOutToday = events.some(
        (event) => normalizeText(event?.action) === "stock_out" && toDateKey(event?.time) === toDateKey(options.now || new Date()),
      );

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
        trayCode: normalizeText(row.trayCode),
        updatedAt: normalizeText(lastEvent?.time || lastStockInEvent?.time),
      };
    })
    .filter((row) => Boolean(row.status))
    .sort((left, right) => compareValues(left.trayCode, right.trayCode, "asc"));
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
      .filter((row) => normalizeText(row?.status) !== "已出库")
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

  if (actionMode === "stockOut" && normalizeText(matchedRow.status) !== "已入库") {
    return {
      error: "该托盘尚未完成暂存间扫码入库。",
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
  });

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
  buildZancunMetrics,
  buildZancunOverviewView,
  buildZancunRowsFromSnapshot,
  buildZancunScanDetail,
};
