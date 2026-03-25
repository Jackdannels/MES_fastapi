const DEFAULT_OVERVIEW_ROWS = Object.freeze([
  {
    id: "zancun-overview-1",
    location: "恒温恒湿间 A-01",
    owner: "王工",
    quantity: 6,
    sampleType: "温度冲击试验",
    source: "外部委托",
    status: "待出库",
    stockInAt: "2026-03-18T15:42",
    taskCode: "WDC-2026-008",
    trayCode: "WDC-2026-008-TP-001",
  },
  {
    id: "zancun-overview-2",
    location: "恒温恒湿间 A-03",
    owner: "李工",
    quantity: 1,
    sampleType: "振动试验",
    source: "内部新增",
    status: "待入库",
    stockInAt: "2026-03-18T10:12",
    taskCode: "ZD-2026-003",
    trayCode: "ZD-2026-003-TP-001",
  },
  {
    id: "zancun-overview-3",
    location: "恒温恒湿间 B-02",
    owner: "样品库",
    quantity: 4,
    sampleType: "高低温湿热试验",
    source: "内部新增",
    status: "已入库",
    stockInAt: "2026-03-18T09:35",
    taskCode: "GDW-2026-002",
    trayCode: "GDW-2026-002-TP-001",
  },
  {
    id: "zancun-overview-4",
    location: "实验后暂存区 C-01",
    owner: "周工",
    quantity: 1,
    sampleType: "综合台试验",
    source: "内部新增",
    status: "待出库",
    stockInAt: "2026-03-17T16:20",
    taskCode: "SZH-2026-006",
    trayCode: "SZH-2026-006-TP-001",
  },
  {
    id: "zancun-overview-5",
    location: "恒温恒湿间 A-05",
    owner: "王工",
    quantity: 2,
    sampleType: "振动试验",
    source: "内部新增",
    status: "已入库",
    stockInAt: "2026-03-17T13:08",
    taskCode: "ZD-2026-002",
    trayCode: "ZD-2026-002-TP-001",
  },
  {
    id: "zancun-overview-6",
    location: "恒温恒湿间 B-06",
    owner: "赵工",
    quantity: 2,
    sampleType: "温度冲击试验",
    source: "外部委托",
    status: "待入库",
    stockInAt: "2026-03-17T10:40",
    taskCode: "WDC-2026-003",
    trayCode: "WDC-2026-003-TP-001",
  },
  {
    id: "zancun-overview-7",
    location: "恒温恒湿间 C-02",
    owner: "样品库",
    quantity: 3,
    sampleType: "综合台试验",
    source: "外部委托",
    status: "已入库",
    stockInAt: "2026-03-16T18:32",
    taskCode: "SZH-2026-005",
    trayCode: "SZH-2026-005-TP-001",
  },
  {
    id: "zancun-overview-8",
    location: "恒温恒湿间 B-01",
    owner: "韩工",
    quantity: 5,
    sampleType: "高低温湿热试验",
    source: "内部新增",
    status: "待出库",
    stockInAt: "2026-03-16T09:15",
    taskCode: "ICP-2026-001",
    trayCode: "ICP-2026-001-TP-001",
  },
]);

const normalizeText = (value) => String(value ?? "").trim();

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
  if (normalized === "待出库") {
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

function createZancunOverviewRows() {
  return DEFAULT_OVERVIEW_ROWS.map((row) => ({ ...row }));
}

function buildZancunMetrics(rows) {
  const rowList = Array.isArray(rows) ? rows : [];
  return {
    pendingStockInCount: rowList.filter((row) => normalizeText(row?.status) === "待入库").length,
    pendingStockOutCount: rowList.filter((row) => normalizeText(row?.status) === "待出库").length,
    totalQuantity: rowList
      .filter((row) => normalizeText(row?.status) !== "已出库")
      .reduce((sum, row) => sum + (Number(row?.quantity) || 0), 0),
  };
}

function buildZancunOverviewView(input = {}) {
  const rows = Array.isArray(input.rows) ? input.rows : [];
  const filters = input.filters && typeof input.filters === "object" ? input.filters : {};
  const sort = input.sort && typeof input.sort === "object" ? input.sort : {};
  const pageSize = Number(input.pageSize) > 0 ? Number(input.pageSize) : 6;
  const query = normalizeText(filters.query).toLowerCase();
  const sampleType = normalizeText(filters.sampleType);
  const status = normalizeText(filters.status);
  const sortKey = normalizeText(sort.key) || "stockInAt";
  const sortDirection = normalizeText(sort.direction) === "asc" ? "asc" : "desc";

  const filteredRows = rows
    .map((row) => ({
      ...row,
      statusClass: resolveStatusClass(row?.status),
      stockInAtDisplay: formatDateTime(row?.stockInAt),
    }))
    .filter((row) => {
      if (sampleType && normalizeText(row.sampleType) !== sampleType) {
        return false;
      }
      if (status && normalizeText(row.status) !== status) {
        return false;
      }
      if (!query) {
        return true;
      }

      const searchText = [row.trayCode, row.taskCode, row.owner, row.location, row.source, row.sampleType, row.status]
        .map((item) => normalizeText(item).toLowerCase())
        .join(" ");

      return searchText.includes(query);
    });

  const sortedRows = filteredRows.slice().sort((left, right) => {
    if (sortKey === "stockInAt") {
      const order = compareDateTimes(left.stockInAt, right.stockInAt, sortDirection);
      if (order !== 0) {
        return order;
      }
      return compareValues(left.trayCode, right.trayCode, "asc");
    }

    const order = compareValues(left?.[sortKey], right?.[sortKey], sortDirection);
    if (order !== 0) {
      return order;
    }
    return compareDateTimes(left.stockInAt, right.stockInAt, "desc");
  });

  const totalCount = sortedRows.length;
  const pageCount = Math.max(1, Math.ceil(totalCount / pageSize));
  const rawPage = Number.parseInt(String(input.page ?? 1), 10);
  const currentPage = Number.isFinite(rawPage) ? Math.min(Math.max(rawPage, 1), pageCount) : 1;
  const startIndex = (currentPage - 1) * pageSize;

  return {
    currentPage,
    pageCount,
    rows: sortedRows.slice(startIndex, startIndex + pageSize),
    sampleTypeOptions: Array.from(new Set(rows.map((row) => normalizeText(row.sampleType)).filter(Boolean))).sort((left, right) =>
      left.localeCompare(right, "zh-Hans-CN"),
    ),
    statusOptions: Array.from(new Set(rows.map((row) => normalizeText(row.status)).filter(Boolean))).sort((left, right) =>
      left.localeCompare(right, "zh-Hans-CN"),
    ),
    totalCount,
  };
}

function buildZancunScanDetail(rows, code, mode) {
  const rowList = Array.isArray(rows) ? rows : [];
  const normalizedCode = normalizeText(code);
  const actionMode = mode === "stockOut" ? "stockOut" : "stockIn";
  const matchedRow = rowList.find((row) => normalizeText(row?.trayCode) === normalizedCode);

  const baseRow = matchedRow || {
    location: actionMode === "stockIn" ? "待分配暂存库位" : "待确认当前位置",
    owner: "待确认",
    quantity: 1,
    sampleType: "待确认样品类型",
    source: "扫码识别",
    status: actionMode === "stockIn" ? "待入库" : "待出库",
    stockInAt: "",
    taskCode: "待确认任务",
    trayCode: normalizedCode,
  };

  return {
    ...baseRow,
    actionLabel: actionMode === "stockIn" ? "入库" : "出库",
    actionMode,
    nextStatus: actionMode === "stockIn" ? "已入库" : "已出库",
    stockInAtDisplay: formatDateTime(baseRow.stockInAt),
  };
}

function applyZancunInventoryAction(input = {}) {
  const rows = Array.isArray(input.rows) ? input.rows.map((row) => ({ ...row })) : [];
  const payload = input.payload && typeof input.payload === "object" ? input.payload : {};
  const actionMode = payload.mode === "stockOut" ? "stockOut" : "stockIn";
  const normalizedCode = normalizeText(payload.code);
  const actionTime = normalizeText(payload.actionTime) || new Date().toISOString();

  if (!normalizedCode) {
    return {
      error: "未提供托盘编号。",
      row: null,
      rows,
    };
  }

  const rowIndex = rows.findIndex((row) => normalizeText(row?.trayCode) === normalizedCode);

  if (rowIndex < 0) {
    if (actionMode === "stockOut") {
      return {
        error: "未找到对应的出库托盘。",
        row: null,
        rows,
      };
    }

    const createdRow = {
      id: createId("zancun-overview"),
      location: "恒温恒湿间（暂存间）",
      owner: "扫码登记",
      quantity: 1,
      sampleType: "待确认样品类型",
      source: "扫码识别",
      status: "已入库",
      stockInAt: actionTime,
      taskCode: "待确认任务",
      trayCode: normalizedCode,
    };

    rows.unshift(createdRow);
    return {
      error: "",
      row: createdRow,
      rows,
    };
  }

  const nextRow = {
    ...rows[rowIndex],
  };

  if (actionMode === "stockIn") {
    nextRow.location = normalizeText(nextRow.location) || "恒温恒湿间（暂存间）";
    nextRow.status = "已入库";
    nextRow.stockInAt = normalizeText(nextRow.stockInAt) || actionTime;
  } else {
    nextRow.location = "已完成出库";
    nextRow.status = "已出库";
  }

  rows[rowIndex] = nextRow;

  return {
    error: "",
    row: nextRow,
    rows,
  };
}

export {
  applyZancunInventoryAction,
  buildZancunMetrics,
  buildZancunOverviewView,
  buildZancunScanDetail,
  createZancunOverviewRows,
};
