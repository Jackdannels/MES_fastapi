import { serverNowDate } from "@/lib/serverClock";
import { normalizeTrayScanCode } from "@/lib/trayQrCode";
import {
  asArray,
  compareDateTimes,
  compareValues,
  eventMatchesRoom,
  formatDateTime,
  isCurrentStagingStatus,
  normalizeText,
  resolveStorageRoomConfig,
  toDateKey,
} from "./stagingStorageModel";


function buildZancunInventorySections(rows = [], options = {}) {
  const config = resolveStorageRoomConfig(options.room);
  const rowList = asArray(rows);
  return {
    currentStagingRows: rowList
      .filter((row) => isCurrentStagingStatus(row?.status, config))
      .sort((left, right) => compareValues(left?.trayCode, right?.trayCode, "asc")),
    plannedInboundRows: rowList
      .filter((row) => normalizeText(row?.status) === "待入库")
      .sort((left, right) => compareValues(left?.trayCode, right?.trayCode, "asc")),
  };
}

function buildZancunMetrics(input = {}) {
  const rowList = Array.isArray(input) ? input : asArray(input.rows);
  const config = resolveStorageRoomConfig(Array.isArray(input) ? "staging" : input.room);
  const stagingEvents = Array.isArray(input) ? [] : asArray(input.stagingEvents);
  const todayKey = toDateKey(Array.isArray(input) ? serverNowDate() : (input.now || serverNowDate()));
  const stockedInToday = new Set();
  const latestEventsByTray = new Map();

  stagingEvents.forEach((event) => {
    const trayCode = normalizeText(event?.tray_code);
    if (!trayCode || !eventMatchesRoom(event, config)) {
      return;
    }
    const current = latestEventsByTray.get(trayCode);
    if (!current || compareDateTimes(current?.time, event?.time, "asc") <= 0) {
      latestEventsByTray.set(trayCode, event);
    }
    if (toDateKey(event?.time) === todayKey && normalizeText(event?.action) === "stock_in") {
      stockedInToday.add(trayCode);
    }
  });
  const stockedOutToday = new Set(
    Array.from(latestEventsByTray.entries())
      .filter(([, event]) => (
        toDateKey(event?.time) === todayKey
        && eventMatchesRoom(event, config)
        && ["stock_out", "manufacturer_return"].includes(normalizeText(event?.action))
      ))
      .map(([trayCode]) => trayCode),
  );

  return {
    stockedInTodayCount: stockedInToday.size,
    stockedOutTodayCount: stockedOutToday.size,
    totalTrayCount: rowList.filter((row) => isCurrentStagingStatus(row?.status, config)).length,
  };
}

function buildZancunOverviewView(input = {}) {
  const rows = asArray(input.rows);
  const filters = input.filters && typeof input.filters === "object" ? input.filters : {};
  const sort = input.sort && typeof input.sort === "object" ? input.sort : {};
  const pageSize = Number(input.pageSize) > 0 ? Number(input.pageSize) : 4;
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

function buildZancunScanDetail(rows, code, mode, options = {}) {
  const config = resolveStorageRoomConfig(options.room);
  const rowList = asArray(rows);
  const normalizedCode = normalizeTrayScanCode(code);
  const actionMode = mode === "stockOut" ? "stockOut" : "stockIn";
  const matchedRow = rowList.find((row) => normalizeText(row?.trayCode) === normalizedCode);

  if (!matchedRow) {
    return {
      actionLabel: actionMode === "stockIn" ? "入库" : "出库",
      actionMode,
      found: false,
      location: actionMode === "stockIn" ? `待确认${config.currentLocation}` : "待确认当前位置",
      nextStatus: actionMode === "stockIn" ? config.stockedDisplayStatus : "已出库",
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
      targetIsFallback: false,
      targetLab: "",
      targetUnavailableReason: "",
      trayCode: normalizedCode,
    };
  }

  return {
    ...matchedRow,
    actionLabel: actionMode === "stockIn" ? "入库" : "出库",
    actionMode,
    found: true,
    nextStatus: actionMode === "stockIn" ? config.stockedDisplayStatus : "已出库",
    stockInAtDisplay: formatDateTime(matchedRow.stockInAt),
  };
}


export {
  buildZancunInventorySections,
  buildZancunMetrics,
  buildZancunOverviewView,
  buildZancunScanDetail,
};
