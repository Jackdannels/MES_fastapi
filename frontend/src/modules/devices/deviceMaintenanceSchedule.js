import { formatLocalDateTime } from "@/lib/dateTime";
import { STORAGE_KEYS } from "@/lib/storageKeys";
import { resolveTransferConfirmedAt } from "@/lib/transferArrivalTime";
import { resolveTaskStatus, STATUS_WAITING } from "@/modules/schedule/model";
import {
  MAINTENANCE_DEVICE_STATUS,
  buildDeviceForm,
  normalizeMaintenancePlan,
  upsertDevice,
} from "./model";
import { maintenanceTypeToStatus, normalizeText } from "./deviceMaintenanceRules";

function createDeviceMaintenanceSchedule({ maintenancePlanDevice, state }) {
  const buildMaintenanceException = ({ schedule, timestamp }) => ({
    acknowledged_at: "",
    created_at: timestamp,
    detail: `${normalizeText(schedule?.device) || "对应试验间"}在排程期间维修，已自动删除`,
    device: normalizeText(schedule?.device),
    experiment_code: normalizeText(schedule?.experiment_code),
    id: `device-maintenance-${normalizeText(schedule?.id) || Date.now()}`,
    reason: `${normalizeText(schedule?.device) || "对应试验间"}在排程期间维修，已自动删除`,
    schedule_id: normalizeText(schedule?.id),
    status: "pending",
    task_code: normalizeText(schedule?.task_code),
    type: "device_maintenance_schedule_removed",
  });

  const buildTransferConfirmedContext = () => {
    const taskByCode = new Map(state.rawTasks.value.map((task) => [normalizeText(task?.code || task?.task_code), task]));
    const samplesByTaskCode = new Map();
    state.rawSamples.value.forEach((sample) => {
      const taskCode = normalizeText(sample?.task_code);
      if (taskCode) {
        samplesByTaskCode.set(taskCode, [...(samplesByTaskCode.get(taskCode) || []), sample]);
      }
    });
    return { samplesByTaskCode, taskByCode };
  };

  const rawDevicesIncludingMaintenanceTarget = (deviceCode) => {
    const normalizedDeviceCode = normalizeText(deviceCode);
    const deviceList = state.rawDevices.value.map((device) => ({ ...device }));
    if (!normalizedDeviceCode || deviceList.some((device) => normalizeText(device?.code) === normalizedDeviceCode)) {
      return deviceList;
    }
    const targetForm = buildDeviceForm(maintenancePlanDevice.value);
    if (normalizeText(targetForm.code) !== normalizedDeviceCode) {
      return deviceList;
    }
    const [targetDevice] = upsertDevice([], { ...targetForm, status: "可用" });
    return targetDevice ? [...deviceList, targetDevice] : deviceList;
  };

  const buildMaintenancePlanUpdates = ({ conflictingSchedules = [], deviceCode, form, timestamp }) => {
    const removedScheduleIds = new Set(conflictingSchedules.map((schedule) => normalizeText(schedule?.id)).filter(Boolean));
    const removedExperimentKeys = new Set(conflictingSchedules.map((schedule) =>
      `${normalizeText(schedule?.task_code)}::${normalizeText(schedule?.experiment_code)}`));
    const { samplesByTaskCode, taskByCode } = buildTransferConfirmedContext();
    const nextDevices = rawDevicesIncludingMaintenanceTarget(deviceCode).map((device) => {
      if (normalizeText(device?.code) !== normalizeText(deviceCode)) {
        return { ...device };
      }
      const plan = normalizeMaintenancePlan(form);
      const nextDevice = { ...device, ...plan };
      const startAt = Date.parse(plan.maintenance_start_at);
      const endAt = Date.parse(plan.maintenance_end_at);
      const current = Date.parse(timestamp);
      const inTimedWindow = Number.isFinite(startAt) && (!Number.isFinite(endAt) || current <= endAt) && startAt <= current;
      if (inTimedWindow) {
        nextDevice.status = maintenanceTypeToStatus(plan.maintenance_type) || MAINTENANCE_DEVICE_STATUS;
      }
      return nextDevice;
    });
    const nextSchedules = state.rawSchedules.value.filter((schedule) => !removedScheduleIds.has(normalizeText(schedule?.id)));
    const nextExperiments = state.rawExperiments.value.map((experiment) => {
      const key = `${normalizeText(experiment?.task_code)}::${normalizeText(experiment?.experiment_code)}`;
      if (!removedExperimentKeys.has(key)) {
        return { ...experiment };
      }
      const taskCode = normalizeText(experiment?.task_code);
      const confirmedAt = resolveTransferConfirmedAt({ samples: samplesByTaskCode.get(taskCode), task: taskByCode.get(taskCode) });
      return { ...experiment, status: STATUS_WAITING, unscheduled_since: confirmedAt ? formatLocalDateTime(confirmedAt) : "", updated_at: timestamp };
    });
    const nextTasks = state.rawTasks.value.map((task) => ({
      ...task,
      status: resolveTaskStatus(task, nextSchedules, state.rawSamples.value, new Date(timestamp), state.rawExperimentTrays.value),
    }));
    const nextConflicts = [
      ...state.rawConflicts.value.map((entry) => ({ ...entry })),
      ...conflictingSchedules.map((schedule) => buildMaintenanceException({ schedule, timestamp })),
    ];
    return {
      [STORAGE_KEYS.conflicts]: nextConflicts,
      [STORAGE_KEYS.devices]: nextDevices,
      [STORAGE_KEYS.experiments]: nextExperiments,
      [STORAGE_KEYS.schedules]: nextSchedules,
      [STORAGE_KEYS.tasks]: nextTasks,
    };
  };

  const buildUnavailableDeviceStatusUpdates = ({ conflictingSchedules = [], form, timestamp }) => {
    const deviceCode = normalizeText(form?.code);
    const updates = buildMaintenancePlanUpdates({ conflictingSchedules, deviceCode, form, timestamp });
    const nextDevices = upsertDevice(state.rawDevices.value, form);
    return {
      ...updates,
      [STORAGE_KEYS.devices]: nextDevices.map((device) =>
        normalizeText(device?.code) === deviceCode ? { ...device, updated_at: timestamp } : device),
    };
  };

  return { buildMaintenancePlanUpdates, buildUnavailableDeviceStatusUpdates, rawDevicesIncludingMaintenanceTarget };
}

export { createDeviceMaintenanceSchedule };
