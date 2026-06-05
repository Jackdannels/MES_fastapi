// 提供设备页所需的行数据、表单和点位管理工厂与映射函数。
import { LAB_LOCATIONS, LAB_TEST_MAP, TEST_PREFIX_MAP } from "@/lib/labs.js";

const DEFAULT_DEVICE_STATUS = "可用";
const IDLE_DEVICE_STATUS = "空闲";
const ACTIVE_DEVICE_STATUS = "工作中";
const REPAIR_DEVICE_STATUS = "维修";
const CARE_DEVICE_STATUS = "保养";
const MAINTENANCE_DEVICE_STATUS = REPAIR_DEVICE_STATUS;
const DISABLED_DEVICE_STATUS = "停用";
const RUNNING_TRAY_STATUSES = new Set(["实验进行中", "实验中"]);
const RUNNING_EXPERIMENT_RUN_STATUSES = new Set(["实验进行中", "实验中"]);

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

// 设备页所有输入都先转成干净字符串，便于后续构造表单和展示行。
const normalizeText = (value) => String(value ?? "").trim();

const parseDate = (value) => {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? new Date(parsed) : null;
};

const isDeviceInMaintenanceWindow = (device, now = new Date()) => {
  const startAt = parseDate(device?.maintenance_start_at ?? device?.maintenanceStartAt);
  const endAt = parseDate(device?.maintenance_end_at ?? device?.maintenanceEndAt);
  const current = parseDate(now) || new Date();
  return Boolean(startAt && startAt <= current && (!endAt || current <= endAt));
};

const maintenanceTypeToSafetyStatus = (type) => (normalizeText(type).includes("保养") ? CARE_DEVICE_STATUS : REPAIR_DEVICE_STATUS);

const normalizeSafetyStatus = (status) => {
  const normalized = normalizeText(status);
  if (normalized.includes("保养")) {
    return CARE_DEVICE_STATUS;
  }
  if (normalized.includes("维修") || normalized.includes("维护") || normalized.includes("校准")) {
    return REPAIR_DEVICE_STATUS;
  }
  return DEFAULT_DEVICE_STATUS;
};

// 本地演示数据使用时间戳 + 随机数生成轻量级前端 ID。
const createId = (prefix) => {
  const random = Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, "0");
  return `${prefix}-${Date.now()}-${random}`;
};

const asArray = (value) => (Array.isArray(value) ? value : []);

const isRunningTrayStatus = (status) => RUNNING_TRAY_STATUSES.has(normalizeText(status));

const isRunningExperimentRunStatus = (status) => RUNNING_EXPERIMENT_RUN_STATUSES.has(normalizeText(status));

const buildDeviceMatchLabels = (device) => {
  if (typeof device === "string") {
    return [normalizeText(device)].filter(Boolean);
  }
  return Array.from(new Set([normalizeText(device?.code), normalizeText(device?.name)].filter(Boolean)));
};

const experimentRunIsActiveForDevice = (run, device) =>
  buildDeviceMatchLabels(device).includes(normalizeText(run?.device)) && isRunningExperimentRunStatus(run?.status);

const isScheduleExperimentRunning = (schedule, deviceCode, samples = [], experimentTrays = []) => {
  const taskCode = normalizeText(schedule?.task_code);
  const experimentCode = normalizeText(schedule?.experiment_code);
  if (!taskCode || normalizeText(schedule?.device) !== deviceCode) {
    return false;
  }

  const scopedTrayCodes = new Set(
    asArray(experimentTrays)
      .filter(
        (entry) =>
          normalizeText(entry?.task_code) === taskCode
          && normalizeText(entry?.experiment_code) === experimentCode,
      )
      .map((entry) => normalizeText(entry?.tray_code))
      .filter(Boolean),
  );
  if (experimentCode && scopedTrayCodes.size === 0) {
    return false;
  }

  return asArray(samples).some((sample) => {
    if (normalizeText(sample?.task_code) !== taskCode) {
      return false;
    }
    const sampleLocation = normalizeText(sample?.location);
    if (sampleLocation && sampleLocation !== deviceCode) {
      return false;
    }

    return asArray(sample?.trays).some((tray) => {
      const trayCode = normalizeText(tray?.tray_code);
      if (scopedTrayCodes.size > 0 && !scopedTrayCodes.has(trayCode)) {
        return false;
      }
      return isRunningTrayStatus(normalizeText(tray?.status) || normalizeText(sample?.status));
    });
  });
};

// 根据实际实验运行状态和维护标记推导设备当前状态。
function resolveDeviceStatus(device, schedules, samples = [], experimentTrays = [], now = new Date(), experimentRuns = []) {
  const deviceCode = normalizeText(device?.code);
  const storedStatus = normalizeText(device?.status);
  if (isDeviceInMaintenanceWindow(device, now)) {
    return maintenanceTypeToSafetyStatus(device?.maintenance_type ?? device?.maintenanceType);
  }
  const maintenanceEnd = parseDate(device?.maintenance_end_at ?? device?.maintenanceEndAt);
  const current = parseDate(now) || new Date();
  if ([REPAIR_DEVICE_STATUS, CARE_DEVICE_STATUS, "维护/校准"].includes(storedStatus) && maintenanceEnd && maintenanceEnd < current) {
    return IDLE_DEVICE_STATUS;
  }
  const safetyStatus = normalizeSafetyStatus(storedStatus);
  if (safetyStatus !== DEFAULT_DEVICE_STATUS) {
    return safetyStatus;
  }
  const runList = asArray(experimentRuns);
  if (runList.length > 0) {
    return runList.some((run) => experimentRunIsActiveForDevice(run, device)) ? ACTIVE_DEVICE_STATUS : IDLE_DEVICE_STATUS;
  }
  const runningSchedule = asArray(schedules).find((schedule) =>
    isScheduleExperimentRunning(schedule, deviceCode, samples, experimentTrays),
  );
  return runningSchedule ? ACTIVE_DEVICE_STATUS : IDLE_DEVICE_STATUS;
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
  if (normalized === CARE_DEVICE_STATUS) {
    return "status warn";
  }
  if (normalized === DISABLED_DEVICE_STATUS) {
    return "status warn";
  }
  return "status";
}

// 将存储中的设备记录转换成设备页表格行。
function buildDeviceRows(devices, schedules, now = new Date(), samples = [], experimentTrays = [], experimentRuns = []) {
  void now;
  const deviceList = Array.isArray(devices) ? devices : [];
  return deviceList.map((device, index) => {
    // 设备状态优先以实际运行托盘推导结果为准，再回退到设备自身状态。
    const status = resolveDeviceStatus(device, schedules, samples, experimentTrays, now, experimentRuns);
    const safetyStatus = normalizeSafetyStatus(device?.status);
    return {
      acquisitionEnabled: normalizeText(device?.acquisition_enabled) || "启用",
      code: normalizeText(device?.code) || `DEVICE-${index + 1}`,
      id: normalizeText(device?.id) || `device-${index + 1}`,
      location: normalizeText(device?.location) || "-",
      maintenanceEndAt: normalizeText(device?.maintenance_end_at),
      maintenanceNote: normalizeText(device?.maintenance_note),
      maintenanceStartAt: normalizeText(device?.maintenance_start_at),
      maintenanceType: normalizeText(device?.maintenance_type),
      model: normalizeText(device?.model) || "",
      name: normalizeText(device?.name) || "-",
      nextCal: normalizeText(device?.next_cal) || "-",
      nextCalRaw: normalizeText(device?.next_cal),
      owner: normalizeText(device?.owner) || "",
      safetyStatus,
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
    idleCount: rowList.filter((row) => row.status === IDLE_DEVICE_STATUS).length,
    maintenanceCount: rowList.filter((row) => [REPAIR_DEVICE_STATUS, CARE_DEVICE_STATUS].includes(row.status)).length,
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

// 将表格行或原始记录统一映射为设备编辑表单字段。
function buildDeviceForm(device = {}) {
  return {
    acquisition_enabled: normalizeText(device?.acquisitionEnabled ?? device?.acquisition_enabled) || "启用",
    code: normalizeText(device?.code),
    location: normalizeText(device?.location),
    maintenance_end_at: normalizeText(device?.maintenanceEndAt ?? device?.maintenance_end_at),
    maintenance_note: normalizeText(device?.maintenanceNote ?? device?.maintenance_note),
    maintenance_start_at: normalizeText(device?.maintenanceStartAt ?? device?.maintenance_start_at),
    maintenance_type: normalizeText(device?.maintenanceType ?? device?.maintenance_type),
    model: normalizeText(device?.model),
    name: normalizeText(device?.name),
    next_cal: normalizeText(device?.nextCalRaw ?? device?.next_cal),
    owner: normalizeText(device?.owner),
    status: normalizeText(device?.status) || DEFAULT_DEVICE_STATUS,
    type: normalizeText(device?.type),
  };
}

// 抽屉标题等区域只需要保留最核心的设备标识信息。
function buildSelectedDevice(device = {}) {
  return {
    code: normalizeText(device?.code) || "-",
    name: normalizeText(device?.name) || "未选择设备",
  };
}

// 维护操作只关心最近校准信息和本次维护记录。
function createMaintenanceForm(device = {}) {
  return {
    latestCalibration: normalizeText(device?.nextCalRaw ?? device?.next_cal),
    maintenanceType: "校准",
    record: "",
  };
}

function createMaintenancePlanForm() {
  return {
    endAt: "",
    note: "",
    startAt: "",
    type: "计划维修",
  };
}

function buildMaintenancePlanForm(device = {}) {
  return {
    endAt: normalizeText(device?.maintenanceEndAt ?? device?.maintenance_end_at),
    note: normalizeText(device?.maintenanceNote ?? device?.maintenance_note),
    startAt: normalizeText(device?.maintenanceStartAt ?? device?.maintenance_start_at),
    type: normalizeText(device?.maintenanceType ?? device?.maintenance_type) || "计划维修",
  };
}

function normalizeMaintenancePlan(form = {}) {
  return {
    maintenance_end_at: normalizeText(form?.endAt),
    maintenance_note: normalizeText(form?.note),
    maintenance_start_at: normalizeText(form?.startAt),
    maintenance_type: normalizeText(form?.type) || "计划维修",
  };
}

function resolveMaintenanceScheduleImpact({ deviceCode, endAt, schedules = [], startAt }) {
  const normalizedDevice = normalizeText(deviceCode);
  const maintenanceStart = parseDate(startAt);
  const maintenanceEnd = parseDate(endAt);
  if (!normalizedDevice || !maintenanceStart || !maintenanceEnd || maintenanceEnd <= maintenanceStart) {
    return { conflictingSchedules: [] };
  }

  return {
    conflictingSchedules: asArray(schedules).filter((schedule) => {
      if (normalizeText(schedule?.device) !== normalizedDevice) {
        return false;
      }
      const scheduleStart = parseDate(schedule?.start_at);
      const scheduleEnd = parseDate(schedule?.end_at);
      return Boolean(scheduleStart && scheduleEnd && maintenanceStart < scheduleEnd && maintenanceEnd > scheduleStart);
    }),
  };
}

// 通过持久化辅助函数完成设备记录的新增或更新。
function upsertDevice(devices, form) {
  const normalizedCode = normalizeText(form?.code);
  if (!normalizedCode) {
    return Array.isArray(devices) ? devices.slice() : [];
  }

  // 先将表单标准化为可持久化记录，避免新增和更新逻辑重复拼字段。
  const nextDevice = {
    acquisition_enabled: normalizeText(form?.acquisition_enabled) || "启用",
    code: normalizedCode,
    location: normalizeText(form?.location),
    maintenance_end_at: normalizeText(form?.maintenance_end_at),
    maintenance_note: normalizeText(form?.maintenance_note),
    maintenance_start_at: normalizeText(form?.maintenance_start_at),
    maintenance_type: normalizeText(form?.maintenance_type),
    model: normalizeText(form?.model),
    name: normalizeText(form?.name),
    next_cal: normalizeText(form?.next_cal),
    owner: normalizeText(form?.owner),
    status: normalizeSafetyStatus(form?.status) || DEFAULT_DEVICE_STATUS,
    type: normalizeText(form?.type),
  };

  const deviceList = Array.isArray(devices) ? devices.map((device) => ({ ...device })) : [];
  const existingIndex = deviceList.findIndex((device) => normalizeText(device?.code) === normalizedCode);
  if (existingIndex >= 0) {
    // 命中同编码设备时执行覆盖更新。
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

  // append 版本始终追加新记录，不做编码去重判断。
  const deviceList = Array.isArray(devices) ? devices.map((device) => ({ ...device })) : [];
  deviceList.unshift({
    id: createId("device"),
    acquisition_enabled: normalizeText(form?.acquisition_enabled) || "启用",
    code: normalizedCode,
    location: normalizeText(form?.location),
    maintenance_end_at: normalizeText(form?.maintenance_end_at),
    maintenance_note: normalizeText(form?.maintenance_note),
    maintenance_start_at: normalizeText(form?.maintenance_start_at),
    maintenance_type: normalizeText(form?.maintenance_type),
    model: normalizeText(form?.model),
    name: normalizeText(form?.name),
    next_cal: normalizeText(form?.next_cal),
    owner: normalizeText(form?.owner),
    status: normalizeSafetyStatus(form?.status) || DEFAULT_DEVICE_STATUS,
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

// 试验类型下拉同时保留默认实验类型和当前设备中已有的自定义类型。
function buildTestTypeOptions(devices) {
  const defaults = [...Object.keys(TEST_PREFIX_MAP), "其他/自定义"];
  const existingTypes = (Array.isArray(devices) ? devices : [])
    .map((device) => normalizeText(device?.type))
    .filter(Boolean);
  return Array.from(new Set([...defaults, ...existingTypes]));
}

// 设备位置变化时，优先套用实验室到试验类型的预设映射。
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

// 点位搜索在名称、地址、数据类型、单位和备注几个字段上同时生效。
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

  // 新增点位时保持不可变更新，避免直接修改当前列表引用。
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
  CARE_DEVICE_STATUS,
  IDLE_DEVICE_STATUS,
  MAINTENANCE_DEVICE_STATUS,
  REPAIR_DEVICE_STATUS,
  appendPoint,
  appendDevice,
  buildDeviceForm,
  buildDeviceMetrics,
  buildDeviceRows,
  buildMaintenancePlanForm,
  buildLocationOptions,
  buildSelectedDevice,
  buildTestTypeOptions,
  buildVisiblePointRows,
  createConnectionForm,
  createDeviceForm,
  createMaintenanceForm,
  createMaintenancePlanForm,
  createPointForm,
  createPointRows,
  isDeviceInMaintenanceWindow,
  isScheduleExperimentRunning,
  normalizeMaintenancePlan,
  resolveStatusClass,
  resolveMaintenanceScheduleImpact,
  syncDeviceTypeWithLocation,
  upsertDevice,
};
