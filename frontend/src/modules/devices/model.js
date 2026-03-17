// 提供设备页所需的行数据、表单和点位管理工厂与映射函数。
import { LAB_LOCATIONS, LAB_TEST_MAP, TEST_PREFIX_MAP } from "@/lib/labs.js";

const DEFAULT_DEVICE_STATUS = "可用";
const ACTIVE_DEVICE_STATUS = "使用中";
const MAINTENANCE_DEVICE_STATUS = "维护/校准";
const DISABLED_DEVICE_STATUS = "停用";

const DEFAULT_POINT_ROWS = Object.freeze([
  {
    address: "40001",
    dataType: "INT16",
    frequency: "1s",
    id: "point-1",
    name: "温度",
    note: "反应腔温度",
    ratio: "0.1",
    unit: "°C",
  },
  {
    address: "40003",
    dataType: "INT16",
    frequency: "2s",
    id: "point-2",
    name: "压力",
    note: "进样压力",
    ratio: "0.01",
    unit: "MPa",
  },
  {
    address: "40005",
    dataType: "FLOAT32",
    frequency: "5s",
    id: "point-3",
    name: "流量",
    note: "泵流量",
    ratio: "1",
    unit: "mL/min",
  },
]);

const normalizeText = (value) => String(value ?? "").trim();

const createId = (prefix) => {
  const random = Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, "0");
  return `${prefix}-${Date.now()}-${random}`;
};

const isScheduleActive = (schedule, deviceCode, now = new Date()) => {
  if (!schedule || schedule.device !== deviceCode) {
    return false;
  }

  const start = new Date(schedule.start_at);
  const end = new Date(schedule.end_at);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return false;
  }

  return start <= now && end >= now;
};

// 根据排程活动和维护标记推导设备当前状态。
function resolveDeviceStatus(device, schedules, now = new Date()) {
  const deviceCode = normalizeText(device?.code);
  const activeSchedule = (Array.isArray(schedules) ? schedules : []).find((schedule) =>
    isScheduleActive(schedule, deviceCode, now),
  );
  if (activeSchedule) {
    return ACTIVE_DEVICE_STATUS;
  }
  return normalizeText(device?.status) || DEFAULT_DEVICE_STATUS;
}

// 将设备状态映射为表格和卡片复用的 CSS 状态类。
function resolveStatusClass(status) {
  const normalized = normalizeText(status);
  if (normalized === ACTIVE_DEVICE_STATUS) {
    return "status running";
  }
  if (normalized === MAINTENANCE_DEVICE_STATUS) {
    return "status alert";
  }
  if (normalized === DISABLED_DEVICE_STATUS) {
    return "status warn";
  }
  return "status";
}

// 将存储中的设备记录转换成设备页表格行。
function buildDeviceRows(devices, schedules, now = new Date()) {
  const deviceList = Array.isArray(devices) ? devices : [];
  return deviceList.map((device, index) => {
    const status = resolveDeviceStatus(device, schedules, now);
    return {
      acquisitionEnabled: normalizeText(device?.acquisition_enabled) || "启用",
      code: normalizeText(device?.code) || `DEVICE-${index + 1}`,
      id: normalizeText(device?.id) || `device-${index + 1}`,
      location: normalizeText(device?.location) || "-",
      model: normalizeText(device?.model) || "",
      name: normalizeText(device?.name) || "-",
      nextCal: normalizeText(device?.next_cal) || "-",
      nextCalRaw: normalizeText(device?.next_cal),
      owner: normalizeText(device?.owner) || "",
      status,
      statusClass: resolveStatusClass(status),
      type: normalizeText(device?.type) || "-",
    };
  });
}

// 构建设备表格上方展示的汇总计数。
function buildDeviceMetrics(rows) {
  const rowList = Array.isArray(rows) ? rows : [];
  return {
    activeCount: rowList.filter((row) => row.status === ACTIVE_DEVICE_STATUS).length,
    idleCount: rowList.filter((row) => row.status === DEFAULT_DEVICE_STATUS).length,
    maintenanceCount: rowList.filter((row) => row.status === MAINTENANCE_DEVICE_STATUS).length,
  };
}

// 通过表单工厂统一新增、编辑和抽屉状态的数据结构。
function createDeviceForm() {
  return {
    acquisition_enabled: "启用",
    code: "",
    location: "",
    model: "",
    name: "",
    next_cal: "",
    owner: "",
    status: DEFAULT_DEVICE_STATUS,
    type: "",
  };
}

function buildDeviceForm(device = {}) {
  return {
    acquisition_enabled: normalizeText(device?.acquisitionEnabled ?? device?.acquisition_enabled) || "启用",
    code: normalizeText(device?.code),
    location: normalizeText(device?.location),
    model: normalizeText(device?.model),
    name: normalizeText(device?.name),
    next_cal: normalizeText(device?.nextCalRaw ?? device?.next_cal),
    owner: normalizeText(device?.owner),
    status: normalizeText(device?.status) || DEFAULT_DEVICE_STATUS,
    type: normalizeText(device?.type),
  };
}

function buildSelectedDevice(device = {}) {
  return {
    code: normalizeText(device?.code) || "-",
    name: normalizeText(device?.name) || "未选择设备",
  };
}

function createMaintenanceForm(device = {}) {
  return {
    latestCalibration: normalizeText(device?.nextCalRaw ?? device?.next_cal),
    maintenanceType: "校准",
    record: "",
  };
}

// 通过持久化辅助函数完成设备记录的新增或更新。
function upsertDevice(devices, form) {
  const normalizedCode = normalizeText(form?.code);
  if (!normalizedCode) {
    return Array.isArray(devices) ? devices.slice() : [];
  }

  const nextDevice = {
    acquisition_enabled: normalizeText(form?.acquisition_enabled) || "启用",
    code: normalizedCode,
    location: normalizeText(form?.location),
    model: normalizeText(form?.model),
    name: normalizeText(form?.name),
    next_cal: normalizeText(form?.next_cal),
    owner: normalizeText(form?.owner),
    status: normalizeText(form?.status) || DEFAULT_DEVICE_STATUS,
    type: normalizeText(form?.type),
  };

  const deviceList = Array.isArray(devices) ? devices.map((device) => ({ ...device })) : [];
  const existingIndex = deviceList.findIndex((device) => normalizeText(device?.code) === normalizedCode);
  if (existingIndex >= 0) {
    deviceList[existingIndex] = {
      ...deviceList[existingIndex],
      ...nextDevice,
    };
    return deviceList;
  }

  deviceList.unshift({
    id: createId("device"),
    ...nextDevice,
  });
  return deviceList;
}

function appendDevice(devices, form) {
  const normalizedCode = normalizeText(form?.code);
  if (!normalizedCode) {
    return Array.isArray(devices) ? devices.slice() : [];
  }

  const deviceList = Array.isArray(devices) ? devices.map((device) => ({ ...device })) : [];
  deviceList.unshift({
    id: createId("device"),
    acquisition_enabled: normalizeText(form?.acquisition_enabled) || "启用",
    code: normalizedCode,
    location: normalizeText(form?.location),
    model: normalizeText(form?.model),
    name: normalizeText(form?.name),
    next_cal: normalizeText(form?.next_cal),
    owner: normalizeText(form?.owner),
    status: normalizeText(form?.status) || DEFAULT_DEVICE_STATUS,
    type: normalizeText(form?.type),
  });
  return deviceList;
}

// 下拉选项和点位辅助函数用于支持筛选和点位配置。
function buildLocationOptions(devices) {
  const defaults = [...LAB_LOCATIONS, "其他/自定义"];
  const existingLocations = (Array.isArray(devices) ? devices : [])
    .map((device) => normalizeText(device?.location))
    .filter(Boolean);
  return Array.from(new Set([...defaults, ...existingLocations]));
}

function buildTestTypeOptions(devices) {
  const defaults = [...Object.keys(TEST_PREFIX_MAP), "其他/自定义"];
  const existingTypes = (Array.isArray(devices) ? devices : [])
    .map((device) => normalizeText(device?.type))
    .filter(Boolean);
  return Array.from(new Set([...defaults, ...existingTypes]));
}

function syncDeviceTypeWithLocation(location, fallbackType = "") {
  const mappedType = LAB_TEST_MAP[normalizeText(location)];
  return normalizeText(mappedType) || normalizeText(fallbackType);
}

function createConnectionForm() {
  return {
    endpoint: "10.10.0.23",
    functionCode: "03 读保持寄存器",
    parity: "CRC",
    pollingInterval: "1s",
    port: "502",
    protocol: "TCP",
    retryPolicy: "3s / 2次",
    stationId: "1",
  };
}

function createPointForm() {
  return {
    address: "",
    dataType: "INT16",
    frequency: "1s",
    name: "",
    note: "",
    ratio: "1",
    unit: "",
  };
}

function createPointRows() {
  return DEFAULT_POINT_ROWS.map((row) => ({ ...row }));
}

function buildVisiblePointRows(points, query) {
  const pointList = Array.isArray(points) ? points : [];
  const normalizedQuery = normalizeText(query).toLowerCase();
  if (!normalizedQuery) {
    return pointList;
  }

  return pointList.filter((point) =>
    [
      point?.name,
      point?.address,
      point?.dataType,
      point?.unit,
      point?.note,
    ].some((value) => normalizeText(value).toLowerCase().includes(normalizedQuery)),
  );
}

function appendPoint(points, form) {
  const name = normalizeText(form?.name);
  const address = normalizeText(form?.address);
  if (!name || !address) {
    return Array.isArray(points) ? points.slice() : [];
  }

  const pointList = Array.isArray(points) ? points.map((point) => ({ ...point })) : [];
  pointList.unshift({
    address,
    dataType: normalizeText(form?.dataType) || "INT16",
    frequency: normalizeText(form?.frequency) || "1s",
    id: createId("point"),
    name,
    note: normalizeText(form?.note),
    ratio: normalizeText(form?.ratio) || "1",
    unit: normalizeText(form?.unit),
  });
  return pointList;
}

export {
  ACTIVE_DEVICE_STATUS,
  MAINTENANCE_DEVICE_STATUS,
  appendPoint,
  appendDevice,
  buildDeviceForm,
  buildDeviceMetrics,
  buildDeviceRows,
  buildLocationOptions,
  buildSelectedDevice,
  buildTestTypeOptions,
  buildVisiblePointRows,
  createConnectionForm,
  createDeviceForm,
  createMaintenanceForm,
  createPointForm,
  createPointRows,
  syncDeviceTypeWithLocation,
  upsertDevice,
};
