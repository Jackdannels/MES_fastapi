import { formatLocalDateTime } from "@/lib/dateTime";
import { serverNowDate } from "@/lib/serverClock";

const normalizeText = (value) => String(value ?? "").trim();
const isUnavailableDeviceStatus = (status) => {
  const normalized = normalizeText(status);
  return ["维修", "保养", "停用", "禁用", "不可用"].some((keyword) => normalized.includes(keyword));
};
const isPlannedMaintenanceType = (type) => normalizeText(type).startsWith("计划");
const MAINTENANCE_SCHEDULE_CONFLICT_WARNING = "请先调整或删除该设备维修窗口内的排程";
const MAINTENANCE_START_TIME_WARNING = "开始时间不得早于当前时间";
const MAINTENANCE_END_TIME_WARNING = "结束时间必须晚于开始时间";
const maintenanceTypeToStatus = (type) => (normalizeText(type).includes("保养") ? "保养" : "维修");
const isRunningExperimentStatus = (status) => ["实验进行中", "实验中"].includes(normalizeText(status));
const parseTime = (value) => {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : null;
};
const toBusinessDateTimeValue = (value = serverNowDate()) => formatLocalDateTime(value);
const MAINTENANCE_RECORD_STATUS = "已结束";
const maintenanceRecordType = (value) => (normalizeText(value).includes("保养") ? "保养" : "维修");

const buildMaintenanceRecord = ({ device, endedAt, endMode }) => ({
  device_code: normalizeText(device?.code),
  device_name: normalizeText(device?.name) || normalizeText(device?.code),
  ended_at: toBusinessDateTimeValue(new Date(endedAt)),
  end_mode: normalizeText(endMode),
  id: `maintenance-record-${normalizeText(device?.code) || "device"}-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
  maintenance_note: normalizeText(device?.maintenance_note),
  maintenance_type: maintenanceRecordType(device?.maintenance_type),
  started_at: normalizeText(device?.maintenance_start_at),
  status: MAINTENANCE_RECORD_STATUS,
});

const clearMaintenanceFields = (device, { status, updatedAt }) => ({
  ...device,
  maintenance_end_at: "",
  maintenance_note: "",
  maintenance_start_at: "",
  maintenance_type: "",
  status,
  updated_at: toBusinessDateTimeValue(updatedAt),
});

const buildTimedMaintenanceStatusUpdates = (devices, maintenanceRecords, currentDate = serverNowDate()) => {
  const current = currentDate instanceof Date ? currentDate.getTime() : Date.parse(String(currentDate || ""));
  if (!Number.isFinite(current)) {
    return null;
  }
  let changed = false;
  const nextMaintenanceRecords = maintenanceRecords.map((record) => ({ ...record }));
  const nextDevices = devices.map((device) => {
    const startAt = parseTime(device?.maintenance_start_at);
    const endAt = parseTime(device?.maintenance_end_at);
    const maintenanceType = normalizeText(device?.maintenance_type);
    if (!startAt || !maintenanceType) {
      return { ...device };
    }
    if (startAt <= current && (!endAt || current <= endAt)) {
      const targetStatus = maintenanceTypeToStatus(maintenanceType);
      if (normalizeText(device?.status) === targetStatus) {
        return { ...device };
      }
      changed = true;
      return { ...device, status: targetStatus, updated_at: toBusinessDateTimeValue(currentDate) };
    }
    if (endAt && endAt < current) {
      changed = true;
      nextMaintenanceRecords.unshift(buildMaintenanceRecord({ device, endedAt: endAt, endMode: "自动结束" }));
      return clearMaintenanceFields(device, {
        status: normalizeText(device?.status) === "停用" ? "停用" : "可用",
        updatedAt: currentDate,
      });
    }
    return { ...device };
  });
  return changed ? { devices: nextDevices, maintenanceRecords: nextMaintenanceRecords } : null;
};

export {
  MAINTENANCE_END_TIME_WARNING,
  MAINTENANCE_SCHEDULE_CONFLICT_WARNING,
  MAINTENANCE_START_TIME_WARNING,
  buildMaintenanceRecord,
  buildTimedMaintenanceStatusUpdates,
  clearMaintenanceFields,
  isPlannedMaintenanceType,
  isRunningExperimentStatus,
  isUnavailableDeviceStatus,
  maintenanceTypeToStatus,
  normalizeText,
  parseTime,
  toBusinessDateTimeValue,
};
