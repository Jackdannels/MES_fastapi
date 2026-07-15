// 负责设备台账状态、维保表单、维保计划和点位管理流程。
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";

import { useDialogState } from "@/composables/useDialogState";
import { useStorageSnapshot } from "@/composables/useStorageSnapshot";
import { useStorageSnapshotRefresh } from "@/composables/useStorageSnapshotRefresh";
import { useTableControls } from "@/composables/useTableControls";
import { formatLocalDateTime } from "@/lib/dateTime";
import { labIdentityMatches, scheduleMatchesLab } from "@/lib/labIdentity";
import { STORAGE_KEYS } from "@/lib/storageKeys";
import { resolveTransferConfirmedAt } from "@/lib/transferArrivalTime";
import { revertLaboratoryTaskToPreviousStableState } from "@/modules/laboratory/model";
import { resolveTaskStatus, STATUS_COMPLETED, STATUS_WAITING } from "@/modules/schedule/model";
import {
  MAINTENANCE_DEVICE_STATUS,
  appendDevice,
  appendPoint,
  buildDeviceForm,
  buildDeviceMetrics,
  buildDeviceRows,
  buildLocationOptions,
  buildMaintenancePlanForm,
  buildSelectedDevice,
  buildTestTypeOptions,
  buildVisiblePointRows,
  createConnectionForm,
  createDeviceForm,
  createMaintenanceForm,
  createMaintenancePlanForm,
  createPointForm,
  createPointRows,
  normalizeMaintenancePlan,
  resolveStatusClass,
  resolveMaintenanceScheduleImpact,
  syncDeviceTypeWithLocation,
  upsertDevice,
} from "./model";

const normalizeText = (value) => String(value ?? "").trim();
const isUnavailableDeviceStatus = (status) => {
  const normalized = normalizeText(status);
  return ["维修", "保养", "停用", "禁用", "不可用"].some((keyword) => normalized.includes(keyword));
};
const isPlannedMaintenanceType = (type) => normalizeText(type).startsWith("计划");
const MAINTENANCE_SCHEDULE_CONFLICT_WARNING = "请先调整或删除该设备维修窗口内的排程";
const MAINTENANCE_END_TIME_WARNING = "结束时间必须晚于开始时间";
const maintenanceTypeToStatus = (type) => (normalizeText(type).includes("保养") ? "保养" : "维修");
const isRunningExperimentStatus = (status) => ["实验进行中", "实验中"].includes(normalizeText(status));
const parseTime = (value) => {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : null;
};
const toBusinessDateTimeValue = (value = new Date()) => formatLocalDateTime(value);
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

// 将设备存储记录转换为页面所需的表格、表单、抽屉和弹窗状态。
function useDevicesPage() {
  const { loadSnapshot, persistSnapshot } = useStorageSnapshot([
    STORAGE_KEYS.conflicts,
    STORAGE_KEYS.devices,
    STORAGE_KEYS.experiments,
    STORAGE_KEYS.experiment_runs,
    STORAGE_KEYS.experiment_run_trays,
    STORAGE_KEYS.experiment_trays,
    STORAGE_KEYS.maintenance_records,
    STORAGE_KEYS.samples,
    STORAGE_KEYS.schedules,
    STORAGE_KEYS.tasks,
  ]);
  const rawConflicts = ref([]);
  const rawDevices = ref([]);
  const rawExperiments = ref([]);
  const rawExperimentRuns = ref([]);
  const rawExperimentRunTrays = ref([]);
  const rawExperimentTrays = ref([]);
  const rawMaintenanceRecords = ref([]);
  const rawSamples = ref([]);
  const rawSchedules = ref([]);
  const rawTasks = ref([]);
  const deviceForm = ref(createDeviceForm());
  const selectedDevice = ref(buildSelectedDevice());
  const maintenanceForm = ref(createMaintenanceForm());
  const maintenancePlanForm = ref(createMaintenancePlanForm());
  const maintenancePlanDevice = ref(null);
  const maintenancePlanWarning = ref("");
  const maintenanceConflictDetail = ref(null);
  const pointForm = ref(createPointForm());
  const connectionForm = ref(createConnectionForm());
  const pointRows = ref(createPointRows());
  const pointQuery = ref("");
  const deviceDrawer = useDialogState();
  const editDeviceModal = useDialogState();
  const maintenancePlanModal = useDialogState();
  const maintenanceConflictModal = useDialogState();
  const runningRepairChoiceModal = useDialogState();
  const pointModal = useDialogState();
  const runningRepairChoiceDetail = ref(null);
  const now = ref(new Date());
  let deviceClockTimer = null;
  let flushPendingStorageRefresh = () => false;

  const baseRows = computed(() =>
    buildDeviceRows(rawDevices.value, rawSchedules.value, now.value, rawSamples.value, rawExperimentTrays.value, rawExperimentRuns.value),
  );
  const maintenanceRecordDeviceFilter = ref("");
  const maintenanceRecordRows = computed(() => {
    const deviceCode = normalizeText(maintenanceRecordDeviceFilter.value);
    return rawMaintenanceRecords.value
      .filter((record) => !deviceCode || normalizeText(record?.device_code) === deviceCode)
      .map((record) => ({ ...record }))
      .sort((left, right) => (parseTime(right?.ended_at) || 0) - (parseTime(left?.ended_at) || 0));
  });
  const metrics = computed(() => buildDeviceMetrics(baseRows.value));
  const locationOptions = computed(() => buildLocationOptions(rawDevices.value));
  const maintenancePlanIsPlanned = computed(() => isPlannedMaintenanceType(maintenancePlanForm.value.type));
  const testTypeOptions = computed(() => buildTestTypeOptions(rawDevices.value));
  const visiblePointRows = computed(() => buildVisiblePointRows(pointRows.value, pointQuery.value));
  const editDeviceStatusClass = computed(() => resolveStatusClass(deviceForm.value.status));
  const hasFuturePlannedMaintenance = computed(() => {
    const startAt = parseTime(deviceForm.value.maintenance_start_at);
    return Boolean(
      isPlannedMaintenanceType(deviceForm.value.maintenance_type)
      && startAt
      && startAt > now.value.getTime(),
    );
  });
  const hasActivePlannedMaintenance = computed(() => {
    const startAt = parseTime(deviceForm.value.maintenance_start_at);
    const endAt = parseTime(deviceForm.value.maintenance_end_at);
    const current = now.value.getTime();
    return Boolean(
      isPlannedMaintenanceType(deviceForm.value.maintenance_type)
      && startAt
      && startAt <= current
      && (!endAt || current <= endAt),
    );
  });
  const canSetDeviceAvailable = computed(
    () => hasFuturePlannedMaintenance.value || hasActivePlannedMaintenance.value || !["空闲", "工作中"].includes(normalizeText(deviceForm.value.status)),
  );
  const deviceLifecycleActionLabel = computed(() => {
    if (hasFuturePlannedMaintenance.value) {
      return "取消计划";
    }
    return hasActivePlannedMaintenance.value ? "提前结束" : "设为可用";
  });

  const { query, sortDirection, sortKey, visibleRows } = useTableControls({
    rows: baseRows,
    searchFields: ["code", "name", "type", "status", "location"],
    pageSize: 100,
  });

  const toggleSort = (nextKey) => {
    // 设备表格采用单列排序，重复点击同一列时切换方向。
    if (sortKey.value === nextKey) {
      sortDirection.value = sortDirection.value === "asc" ? "desc" : "asc";
      return;
    }
    sortKey.value = nextKey;
    sortDirection.value = "asc";
  };

  const syncFormTypeWithLocation = () => {
    const mappedType = syncDeviceTypeWithLocation(deviceForm.value.location, deviceForm.value.type);
    if (mappedType) {
      deviceForm.value.type = mappedType;
    }
  };

  const persistDevices = async (nextDevices, nextMaintenanceRecords = rawMaintenanceRecords.value) => {
    rawDevices.value = nextDevices;
    rawMaintenanceRecords.value = nextMaintenanceRecords;
    await persistSnapshot({
      [STORAGE_KEYS.devices]: nextDevices,
      [STORAGE_KEYS.maintenance_records]: nextMaintenanceRecords,
    });
  };

  const buildTimedMaintenanceStatusUpdates = (currentDate = new Date()) => {
    const current = currentDate instanceof Date ? currentDate.getTime() : Date.parse(String(currentDate || ""));
    if (!Number.isFinite(current)) {
      return null;
    }
    let changed = false;
    const nextMaintenanceRecords = rawMaintenanceRecords.value.map((record) => ({ ...record }));
    const nextDevices = rawDevices.value.map((device) => {
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
        return {
          ...device,
          status: targetStatus,
          updated_at: toBusinessDateTimeValue(currentDate),
        };
      }
      if (endAt && endAt < current) {
        changed = true;
        nextMaintenanceRecords.unshift(buildMaintenanceRecord({
          device,
          endedAt: endAt,
          endMode: "自动结束",
        }));
        return clearMaintenanceFields(device, {
          status: normalizeText(device?.status) === "停用" ? "停用" : "可用",
          updatedAt: currentDate,
        });
      }
      return { ...device };
    });
    return changed ? { devices: nextDevices, maintenanceRecords: nextMaintenanceRecords } : null;
  };

  const syncTimedMaintenanceStatuses = async (currentDate = new Date()) => {
    const updates = buildTimedMaintenanceStatusUpdates(currentDate);
    if (!updates) {
      return;
    }
    await persistDevices(updates.devices, updates.maintenanceRecords);
  };

  const saveCurrentDevice = async () => {
    const nextDevices = upsertDevice(rawDevices.value, deviceForm.value);
    await persistDevices(nextDevices);
  };

  const createNewDevice = async () => {
    const nextDevices = appendDevice(rawDevices.value, deviceForm.value);
    await persistDevices(nextDevices);
  };

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
    const taskByCode = new Map(rawTasks.value.map((task) => [normalizeText(task?.code || task?.task_code), task]));
    const samplesByTaskCode = new Map();
    rawSamples.value.forEach((sample) => {
      const taskCode = normalizeText(sample?.task_code);
      if (!taskCode) {
        return;
      }
      samplesByTaskCode.set(taskCode, [...(samplesByTaskCode.get(taskCode) || []), sample]);
    });
    return { samplesByTaskCode, taskByCode };
  };

  const rawDevicesIncludingMaintenanceTarget = (deviceCode) => {
    const normalizedDeviceCode = normalizeText(deviceCode);
    const deviceList = rawDevices.value.map((device) => ({ ...device }));
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
    const removedExperimentKeys = new Set(
      conflictingSchedules.map((schedule) => `${normalizeText(schedule?.task_code)}::${normalizeText(schedule?.experiment_code)}`),
    );
    const { samplesByTaskCode, taskByCode } = buildTransferConfirmedContext();
    const nextDevices = rawDevicesIncludingMaintenanceTarget(deviceCode).map((device) => {
      if (normalizeText(device?.code) !== normalizeText(deviceCode)) {
        return { ...device };
      }
      const plan = normalizeMaintenancePlan(form);
      const nextDevice = {
        ...device,
        ...plan,
      };
      const startAt = Date.parse(plan.maintenance_start_at);
      const endAt = Date.parse(plan.maintenance_end_at);
      const current = Date.parse(timestamp);
      const inTimedWindow = Number.isFinite(startAt) && (!Number.isFinite(endAt) || current <= endAt) && startAt <= current;
      if (inTimedWindow) {
        nextDevice.status = maintenanceTypeToStatus(plan.maintenance_type) || MAINTENANCE_DEVICE_STATUS;
      }
      return nextDevice;
    });
    const nextSchedules = rawSchedules.value.filter((schedule) => !removedScheduleIds.has(normalizeText(schedule?.id)));
    const nextExperiments = rawExperiments.value.map((experiment) => {
      const key = `${normalizeText(experiment?.task_code)}::${normalizeText(experiment?.experiment_code)}`;
      if (!removedExperimentKeys.has(key)) {
        return { ...experiment };
      }
      const taskCode = normalizeText(experiment?.task_code);
      const confirmedAt = resolveTransferConfirmedAt({
        samples: samplesByTaskCode.get(taskCode),
        task: taskByCode.get(taskCode),
      });
      return {
        ...experiment,
        status: STATUS_WAITING,
        unscheduled_since: confirmedAt ? formatLocalDateTime(confirmedAt) : "",
        updated_at: timestamp,
      };
    });
    const nextTasks = rawTasks.value.map((task) => ({
      ...task,
      status: resolveTaskStatus(task, nextSchedules, rawSamples.value, new Date(timestamp), rawExperimentTrays.value),
    }));
    const nextConflicts = [
      ...rawConflicts.value.map((entry) => ({ ...entry })),
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

  const findExperimentBySchedule = (schedule) =>
    rawExperiments.value.find(
      (experiment) =>
        normalizeText(experiment?.task_code) === normalizeText(schedule?.task_code)
        && normalizeText(experiment?.experiment_code) === normalizeText(schedule?.experiment_code),
    );

  const resolveScheduleTrayCodes = (schedule) => {
    const scheduleTrayCodes = (Array.isArray(schedule?.tray_codes) ? schedule.tray_codes : [])
      .map(normalizeText)
      .filter(Boolean);
    if (scheduleTrayCodes.length > 0) {
      return scheduleTrayCodes;
    }
    const taskCode = normalizeText(schedule?.task_code);
    const experimentCode = normalizeText(schedule?.experiment_code);
    const scopedCodes = rawExperimentTrays.value
      .filter(
        (entry) =>
          normalizeText(entry?.task_code) === taskCode
          && normalizeText(entry?.experiment_code) === experimentCode,
      )
      .map((entry) => normalizeText(entry?.tray_code))
      .filter(Boolean);
    if (scopedCodes.length > 0) {
      return scopedCodes;
    }
    return rawSamples.value
      .filter((sample) => normalizeText(sample?.task_code) === taskCode)
      .flatMap((sample) => (Array.isArray(sample?.trays) ? sample.trays : []))
      .map((tray) => normalizeText(tray?.tray_code))
      .filter(Boolean);
  };

  const resolveDeviceRef = (deviceCode) =>
    rawDevices.value.find((device) => normalizeText(device?.code) === normalizeText(deviceCode))
    || { code: normalizeText(deviceCode), name: normalizeText(deviceCode) };

  const scheduleHasRunningTray = (schedule, deviceRef) => {
    const taskCode = normalizeText(schedule?.task_code);
    const trayCodes = new Set(resolveScheduleTrayCodes(schedule));
    return rawSamples.value.some((sample) => {
      if (normalizeText(sample?.task_code) !== taskCode || !labIdentityMatches(sample, deviceRef)) {
        return false;
      }
      return (Array.isArray(sample?.trays) ? sample.trays : []).some((tray) => {
        const trayCode = normalizeText(tray?.tray_code);
        if (trayCodes.size > 0 && !trayCodes.has(trayCode)) {
          return false;
        }
        return isRunningExperimentStatus(tray?.status) || isRunningExperimentStatus(sample?.status);
      });
    });
  };

  const findRunningSchedulesForDevice = (deviceCode) => {
    const deviceRef = resolveDeviceRef(deviceCode);
    return rawExperimentRuns.value.length > 0
      ? rawExperimentRuns.value
          .filter((run) => labIdentityMatches(run, deviceRef) && isRunningExperimentStatus(run?.status))
          .map((run) => {
            const matchedSchedule = rawSchedules.value.find(
              (schedule) =>
                scheduleMatchesLab(schedule, deviceRef)
                && normalizeText(schedule?.task_code) === normalizeText(run?.task_code)
                && normalizeText(schedule?.experiment_code) === normalizeText(run?.experiment_code),
            );
            return {
              ...(matchedSchedule || {}),
              device: normalizeText(run?.device) || normalizeText(matchedSchedule?.device),
              experiment_code: normalizeText(run?.experiment_code) || normalizeText(matchedSchedule?.experiment_code),
              id: normalizeText(matchedSchedule?.id) || normalizeText(run?.schedule_id),
              run_no: normalizeText(run?.run_no) || normalizeText(run?.id),
              task_code: normalizeText(run?.task_code) || normalizeText(matchedSchedule?.task_code),
              tray_codes: Array.isArray(run?.tray_codes) ? run.tray_codes : [],
            };
          })
      : rawSchedules.value.filter(
          (schedule) => scheduleMatchesLab(schedule, deviceRef) && scheduleHasRunningTray(schedule, deviceRef),
        );
  };

  const buildLaboratoryTaskFromSchedule = (schedule) => {
    const experiment = findExperimentBySchedule(schedule);
    return {
      experimentName:
        normalizeText(schedule?.experiment_name)
        || normalizeText(experiment?.experiment_name)
        || normalizeText(schedule?.experiment_code)
        || "-",
      taskCode: normalizeText(schedule?.task_code),
      trayCodes: resolveScheduleTrayCodes(schedule),
    };
  };

  const completeRunningScheduleSamples = ({ samples, schedule, timestamp }) => {
    const taskCode = normalizeText(schedule?.task_code);
    const trayCodes = new Set(resolveScheduleTrayCodes(schedule));
    const experimentName = normalizeText(schedule?.experiment_name) || normalizeText(schedule?.experiment_code) || "-";
    return samples.map((sample) => {
      if (normalizeText(sample?.task_code) !== taskCode) {
        return sample;
      }
      let changed = false;
      const nextTrays = (Array.isArray(sample?.trays) ? sample.trays : []).map((tray) => {
        const trayCode = normalizeText(tray?.tray_code);
        if (trayCodes.size > 0 && !trayCodes.has(trayCode)) {
          return { ...tray };
        }
        changed = true;
        return {
          ...tray,
          status: STATUS_COMPLETED,
          updated_at: timestamp,
        };
      });
      if (!changed) {
        return { ...sample, trays: nextTrays };
      }
      const nextSample = {
        ...sample,
        flow_status: STATUS_COMPLETED,
        status: STATUS_COMPLETED,
        trays: nextTrays,
        updated_at: timestamp,
      };
      nextSample.history = [
        {
          action: "实验完成",
          detail: `${taskCode} / ${experimentName} / ${STATUS_COMPLETED}`,
          id: `device-repair-complete-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          location: normalizeText(nextSample.location),
          status: STATUS_COMPLETED,
          time: timestamp,
        },
        ...(Array.isArray(sample?.history) ? sample.history : []),
      ];
      return nextSample;
    });
  };

  const buildRunningRepairUpdates = ({ form, mode, runningSchedules = [], timestamp }) => {
    const runningScheduleIds = new Set(runningSchedules.map((schedule) => normalizeText(schedule?.id)).filter(Boolean));
    const runningExperimentKeys = new Set(
      runningSchedules.map((schedule) => `${normalizeText(schedule?.task_code)}::${normalizeText(schedule?.experiment_code)}`),
    );
    const runningRunNos = new Set(
      runningSchedules.map((schedule) => normalizeText(schedule?.run_no)).filter(Boolean),
    );
    const deviceCode = normalizeText(maintenancePlanDevice.value?.code);
    const plan = normalizeMaintenancePlan(form);
    const nextDevices = rawDevicesIncludingMaintenanceTarget(deviceCode).map((device) =>
      normalizeText(device?.code) === deviceCode
        ? {
            ...device,
            ...plan,
            status: maintenanceTypeToStatus(plan.maintenance_type),
            updated_at: timestamp,
          }
        : { ...device },
    );
    const nextSchedules = rawSchedules.value.filter((schedule) => !runningScheduleIds.has(normalizeText(schedule?.id)));
    let nextSamples = rawSamples.value.map((sample) => ({ ...sample }));
    runningSchedules.forEach((schedule) => {
      const currentTask = buildLaboratoryTaskFromSchedule(schedule);
      nextSamples =
        mode === "complete"
          ? completeRunningScheduleSamples({
              samples: nextSamples,
              schedule,
              timestamp,
            })
          : revertLaboratoryTaskToPreviousStableState({
              allowRunningRevert: true,
              currentTask,
              now: timestamp,
              samples: nextSamples,
            });
    });
    const nextExperiments = rawExperiments.value.map((experiment) => {
      const key = `${normalizeText(experiment?.task_code)}::${normalizeText(experiment?.experiment_code)}`;
      if (!runningExperimentKeys.has(key)) {
        return { ...experiment };
      }
      return mode === "complete"
        ? {
            ...experiment,
            actual_end_time: timestamp,
            status: STATUS_COMPLETED,
            updated_at: timestamp,
          }
        : {
            ...experiment,
            status: STATUS_WAITING,
            unscheduled_since: timestamp,
            updated_at: timestamp,
          };
    });
    const nextTasks = rawTasks.value.map((task) => ({
      ...task,
      status: resolveTaskStatus(task, nextSchedules, nextSamples, new Date(timestamp), rawExperimentTrays.value),
    }));
    const nextExperimentRuns =
      mode === "complete"
        ? rawExperimentRuns.value.map((run) => {
            const runNo = normalizeText(run?.run_no) || normalizeText(run?.id);
            const key = `${normalizeText(run?.task_code)}::${normalizeText(run?.experiment_code)}`;
            if (!runningRunNos.has(runNo) && !runningExperimentKeys.has(key)) {
              return { ...run };
            }
            return {
              ...run,
              ended_at: timestamp,
              status: STATUS_COMPLETED,
              updated_at: timestamp,
            };
          })
        : rawExperimentRuns.value.filter((run) => {
            const runNo = normalizeText(run?.run_no) || normalizeText(run?.id);
            const key = `${normalizeText(run?.task_code)}::${normalizeText(run?.experiment_code)}`;
            return !runningRunNos.has(runNo) && !runningExperimentKeys.has(key);
          });
    const nextExperimentRunTrays =
      mode === "complete"
        ? rawExperimentRunTrays.value.map((relation) => {
            const runNo = normalizeText(relation?.run_no) || normalizeText(relation?.runNo);
            const key = `${normalizeText(relation?.task_code)}::${normalizeText(relation?.experiment_code)}`;
            if (!runningRunNos.has(runNo) && !runningExperimentKeys.has(key)) {
              return { ...relation };
            }
            return {
              ...relation,
              ended_at: timestamp,
              run_tray_status: STATUS_COMPLETED,
              status: STATUS_COMPLETED,
              updated_at: timestamp,
            };
          })
        : rawExperimentRunTrays.value.filter((relation) => {
            const runNo = normalizeText(relation?.run_no) || normalizeText(relation?.runNo);
            const key = `${normalizeText(relation?.task_code)}::${normalizeText(relation?.experiment_code)}`;
            return !runningRunNos.has(runNo) && !runningExperimentKeys.has(key);
          });
    return {
      [STORAGE_KEYS.devices]: nextDevices,
      [STORAGE_KEYS.experiments]: nextExperiments,
      [STORAGE_KEYS.experiment_runs]: nextExperimentRuns,
      [STORAGE_KEYS.experiment_run_trays]: nextExperimentRunTrays,
      [STORAGE_KEYS.samples]: nextSamples,
      [STORAGE_KEYS.schedules]: nextSchedules,
      [STORAGE_KEYS.tasks]: nextTasks,
    };
  };

  const buildUnavailableDeviceStatusUpdates = ({ conflictingSchedules = [], form, timestamp }) => {
    const deviceCode = normalizeText(form?.code);
    const removedScheduleIds = new Set(conflictingSchedules.map((schedule) => normalizeText(schedule?.id)).filter(Boolean));
    const removedExperimentKeys = new Set(
      conflictingSchedules.map((schedule) => `${normalizeText(schedule?.task_code)}::${normalizeText(schedule?.experiment_code)}`),
    );
    const { samplesByTaskCode, taskByCode } = buildTransferConfirmedContext();
    const nextDevices = upsertDevice(rawDevices.value, form);
    const nextSchedules = rawSchedules.value.filter((schedule) => !removedScheduleIds.has(normalizeText(schedule?.id)));
    const nextExperiments = rawExperiments.value.map((experiment) => {
      const key = `${normalizeText(experiment?.task_code)}::${normalizeText(experiment?.experiment_code)}`;
      if (!removedExperimentKeys.has(key)) {
        return { ...experiment };
      }
      const taskCode = normalizeText(experiment?.task_code);
      const confirmedAt = resolveTransferConfirmedAt({
        samples: samplesByTaskCode.get(taskCode),
        task: taskByCode.get(taskCode),
      });
      return {
        ...experiment,
        status: STATUS_WAITING,
        unscheduled_since: confirmedAt ? formatLocalDateTime(confirmedAt) : "",
        updated_at: timestamp,
      };
    });
    const nextTasks = rawTasks.value.map((task) => ({
      ...task,
      status: resolveTaskStatus(task, nextSchedules, rawSamples.value, new Date(timestamp), rawExperimentTrays.value),
    }));
    const nextConflicts = [
      ...rawConflicts.value.map((entry) => ({ ...entry })),
      ...conflictingSchedules.map((schedule) => buildMaintenanceException({ schedule, timestamp })),
    ];
    return {
      [STORAGE_KEYS.conflicts]: nextConflicts,
      [STORAGE_KEYS.devices]: nextDevices.map((device) =>
        normalizeText(device?.code) === deviceCode ? { ...device, updated_at: timestamp } : device,
      ),
      [STORAGE_KEYS.experiments]: nextExperiments,
      [STORAGE_KEYS.schedules]: nextSchedules,
      [STORAGE_KEYS.tasks]: nextTasks,
    };
  };

  const persistMaintenancePlan = async ({ conflictingSchedules = [], deviceCode, form }) => {
    const timestamp = toBusinessDateTimeValue(new Date());
    const updates = buildMaintenancePlanUpdates({ conflictingSchedules, deviceCode, form, timestamp });
    rawConflicts.value = updates[STORAGE_KEYS.conflicts];
    rawDevices.value = updates[STORAGE_KEYS.devices];
    rawExperiments.value = updates[STORAGE_KEYS.experiments];
    rawSchedules.value = updates[STORAGE_KEYS.schedules];
    rawTasks.value = updates[STORAGE_KEYS.tasks];
    await persistSnapshot(updates);
  };

  const openDeviceDrawer = (row) => {
    const nextSelected = buildSelectedDevice(row ?? deviceForm.value);
    selectedDevice.value = nextSelected;
    maintenanceForm.value = createMaintenanceForm(row ?? deviceForm.value);
    maintenanceRecordDeviceFilter.value = normalizeText(row?.code);
    deviceDrawer.openWith(nextSelected);
  };

  const closeDeviceDrawer = () => {
    deviceDrawer.close();
    maintenanceRecordDeviceFilter.value = "";
    flushPendingStorageRefresh();
  };

  const openEditDevice = (row) => {
    deviceForm.value = buildDeviceForm(row);
    editDeviceModal.openWith({ code: normalizeText(row?.code) });
  };

  const closeEditDevice = () => {
    editDeviceModal.close();
    flushPendingStorageRefresh();
  };

  const saveEditedDevice = async () => {
    const previousDevice = rawDevices.value.find((device) => normalizeText(device?.code) === normalizeText(deviceForm.value?.code));
    const changedToUnavailable =
      isUnavailableDeviceStatus(deviceForm.value?.status) && normalizeText(previousDevice?.status) !== normalizeText(deviceForm.value?.status);
    if (changedToUnavailable) {
      const deviceRef = resolveDeviceRef(deviceForm.value?.code);
      const conflictingSchedules = rawSchedules.value.filter((schedule) => scheduleMatchesLab(schedule, deviceRef));
      if (conflictingSchedules.length > 0) {
        maintenanceConflictDetail.value = {
          conflictingSchedules,
          deviceCode: normalizeText(deviceForm.value?.code),
          form: { ...deviceForm.value },
          mode: "deviceStatus",
        };
        maintenanceConflictModal.openWith(maintenanceConflictDetail.value);
        return;
      }
    }
    await saveCurrentDevice();
    closeEditDevice();
  };

  const openMaintenancePlan = (row) => {
    const selected = buildSelectedDevice(row);
    selectedDevice.value = selected;
    maintenancePlanDevice.value = row;
    maintenancePlanForm.value = buildMaintenancePlanForm(row);
    maintenancePlanWarning.value = "";
    maintenancePlanModal.openWith(selected);
  };

  const closeMaintenancePlan = () => {
    maintenancePlanModal.close();
    maintenancePlanDevice.value = null;
    maintenancePlanForm.value = createMaintenancePlanForm();
    maintenancePlanWarning.value = "";
    flushPendingStorageRefresh();
  };

  const saveMaintenancePlan = async () => {
    maintenancePlanWarning.value = "";
    const deviceCode = normalizeText(maintenancePlanDevice.value?.code);
    if (!deviceCode) {
      return;
    }
    const timestamp = toBusinessDateTimeValue(new Date());
    const form = { ...maintenancePlanForm.value };
    const runningSchedules = findRunningSchedulesForDevice(deviceCode);
    if (runningSchedules.length > 0) {
      if (normalizeText(form.type) !== "维修") {
        maintenancePlanWarning.value = `设备正在运行无法进行${normalizeText(form.type) || "该操作"}`;
        return;
      }
      form.startAt = timestamp;
      runningRepairChoiceDetail.value = {
        deviceCode,
        form,
        runningSchedules,
      };
      runningRepairChoiceModal.openWith(runningRepairChoiceDetail.value);
      return;
    }
    if (!isPlannedMaintenanceType(form.type)) {
      form.startAt = timestamp;
      form.endAt = "";
    } else if (!normalizeText(form.startAt)) {
      maintenancePlanWarning.value = "请选择开始时间";
      return;
    }
    const startAt = parseTime(form.startAt);
    const endAt = parseTime(form.endAt);
    if (normalizeText(form.endAt) && (!endAt || !startAt || endAt <= startAt)) {
      maintenancePlanWarning.value = MAINTENANCE_END_TIME_WARNING;
      return;
    }
    const impact = resolveMaintenanceScheduleImpact({
      deviceCode,
      endAt: form.endAt,
      schedules: rawSchedules.value,
      startAt: form.startAt,
    });
    if (impact.conflictingSchedules.length > 0) {
      maintenancePlanWarning.value = MAINTENANCE_SCHEDULE_CONFLICT_WARNING;
      return;
    }
    await persistMaintenancePlan({ deviceCode, form });
    closeMaintenancePlan();
  };

  const closeRunningRepairChoice = () => {
    runningRepairChoiceDetail.value = null;
    runningRepairChoiceModal.close();
    flushPendingStorageRefresh();
  };

  const persistRunningRepairChoice = async (mode) => {
    const detail = runningRepairChoiceDetail.value;
    if (!detail) {
      runningRepairChoiceModal.close();
      return;
    }
    const timestamp = toBusinessDateTimeValue(new Date());
    const updates = buildRunningRepairUpdates({
      form: {
        ...detail.form,
        startAt: timestamp,
      },
      mode,
      runningSchedules: detail.runningSchedules,
      timestamp,
    });
    rawDevices.value = updates[STORAGE_KEYS.devices];
    rawExperiments.value = updates[STORAGE_KEYS.experiments];
    rawExperimentRuns.value = updates[STORAGE_KEYS.experiment_runs];
    rawExperimentRunTrays.value = updates[STORAGE_KEYS.experiment_run_trays];
    rawSamples.value = updates[STORAGE_KEYS.samples];
    rawSchedules.value = updates[STORAGE_KEYS.schedules];
    rawTasks.value = updates[STORAGE_KEYS.tasks];
    await persistSnapshot(updates);
    closeRunningRepairChoice();
    closeMaintenancePlan();
  };

  const confirmRunningRepairReschedule = () => persistRunningRepairChoice("reschedule");

  const confirmRunningRepairComplete = () => persistRunningRepairChoice("complete");

  const setDeviceAvailable = async () => {
    const deviceCode = normalizeText(deviceForm.value?.code);
    if (!deviceCode || !canSetDeviceAvailable.value) {
      return;
    }
    const endedAt = new Date();
    const nextMaintenanceRecords = [
      buildMaintenanceRecord({
        device: rawDevices.value.find((device) => normalizeText(device?.code) === deviceCode),
        endedAt,
        endMode: hasFuturePlannedMaintenance.value ? "取消计划" : "提前结束",
      }),
      ...rawMaintenanceRecords.value.map((record) => ({ ...record })),
    ];
    const nextDevices = rawDevices.value.map((device) =>
      normalizeText(device?.code) === deviceCode
        ? clearMaintenanceFields(device, { status: "可用", updatedAt: endedAt })
        : { ...device },
    );
    await persistDevices(nextDevices, nextMaintenanceRecords);
    closeEditDevice();
  };

  const confirmMaintenanceConflict = async () => {
    const detail = maintenanceConflictDetail.value;
    if (!detail) {
      maintenanceConflictModal.close();
      return;
    }
    if (detail.mode === "deviceStatus") {
      const timestamp = toBusinessDateTimeValue(new Date());
      const updates = buildUnavailableDeviceStatusUpdates({
        conflictingSchedules: detail.conflictingSchedules,
        form: detail.form,
        timestamp,
      });
      rawConflicts.value = updates[STORAGE_KEYS.conflicts];
      rawDevices.value = updates[STORAGE_KEYS.devices];
      rawExperiments.value = updates[STORAGE_KEYS.experiments];
      rawSchedules.value = updates[STORAGE_KEYS.schedules];
      rawTasks.value = updates[STORAGE_KEYS.tasks];
      await persistSnapshot(updates);
      maintenanceConflictDetail.value = null;
      maintenanceConflictModal.close();
      closeEditDevice();
      flushPendingStorageRefresh();
      return;
    }
    await persistMaintenancePlan({
      conflictingSchedules: detail.conflictingSchedules,
      deviceCode: detail.deviceCode,
      form: detail.form,
    });
    maintenanceConflictDetail.value = null;
    maintenanceConflictModal.close();
    closeMaintenancePlan();
    flushPendingStorageRefresh();
  };

  const cancelMaintenanceConflict = () => {
    maintenanceConflictDetail.value = null;
    maintenanceConflictModal.close();
    flushPendingStorageRefresh();
  };

  const openPointModal = () => {
    pointModal.openWith({ id: "point-modal" });
  };

  const closePointModal = () => {
    pointModal.close();
    flushPendingStorageRefresh();
  };

  const savePoint = () => {
    const nextPoints = appendPoint(pointRows.value, pointForm.value);
    if (nextPoints.length === pointRows.value.length) {
      return;
    }
    pointRows.value = nextPoints;
    pointForm.value = createPointForm();
    closePointModal();
  };

  const loadDevicesPage = async () => {
    const snapshot = await loadSnapshot();
    rawConflicts.value = Array.isArray(snapshot[STORAGE_KEYS.conflicts]) ? snapshot[STORAGE_KEYS.conflicts] : [];
    rawDevices.value = Array.isArray(snapshot[STORAGE_KEYS.devices]) ? snapshot[STORAGE_KEYS.devices] : [];
    rawExperiments.value = Array.isArray(snapshot[STORAGE_KEYS.experiments]) ? snapshot[STORAGE_KEYS.experiments] : [];
    rawExperimentRuns.value = Array.isArray(snapshot[STORAGE_KEYS.experiment_runs]) ? snapshot[STORAGE_KEYS.experiment_runs] : [];
    rawExperimentRunTrays.value = Array.isArray(snapshot[STORAGE_KEYS.experiment_run_trays]) ? snapshot[STORAGE_KEYS.experiment_run_trays] : [];
    rawExperimentTrays.value = Array.isArray(snapshot[STORAGE_KEYS.experiment_trays])
      ? snapshot[STORAGE_KEYS.experiment_trays]
      : [];
    rawMaintenanceRecords.value = Array.isArray(snapshot[STORAGE_KEYS.maintenance_records]) ? snapshot[STORAGE_KEYS.maintenance_records] : [];
    rawSamples.value = Array.isArray(snapshot[STORAGE_KEYS.samples]) ? snapshot[STORAGE_KEYS.samples] : [];
    rawSchedules.value = Array.isArray(snapshot[STORAGE_KEYS.schedules]) ? snapshot[STORAGE_KEYS.schedules] : [];
    rawTasks.value = Array.isArray(snapshot[STORAGE_KEYS.tasks]) ? snapshot[STORAGE_KEYS.tasks] : [];
    await syncTimedMaintenanceStatuses(now.value);
  };

  const isRealtimeRefreshPaused = () => Boolean(
    deviceDrawer.open.value
    || editDeviceModal.open.value
    || maintenancePlanModal.open.value
    || maintenanceConflictModal.open.value
    || runningRepairChoiceModal.open.value
    || pointModal.open.value
  );

  const storageRefresh = useStorageSnapshotRefresh({
    keys: [
      STORAGE_KEYS.conflicts,
      STORAGE_KEYS.devices,
      STORAGE_KEYS.experiments,
      STORAGE_KEYS.experiment_runs,
      STORAGE_KEYS.experiment_run_trays,
      STORAGE_KEYS.experiment_trays,
      STORAGE_KEYS.maintenance_records,
      STORAGE_KEYS.samples,
      STORAGE_KEYS.schedules,
      STORAGE_KEYS.tasks,
    ],
    refresh: loadDevicesPage,
    paused: isRealtimeRefreshPaused,
    debounceMs: 100,
  });
  flushPendingStorageRefresh = storageRefresh.flushPendingRefresh;

  watch(
    () => deviceForm.value.location,
    () => {
      syncFormTypeWithLocation();
    },
  );

  const syncDeviceClock = () => {
    const currentDate = new Date();
    now.value = currentDate;
    void syncTimedMaintenanceStatuses(currentDate);
  };

  onMounted(() => {
    syncDeviceClock();
    deviceClockTimer = window.setInterval(syncDeviceClock, 1000);
    loadDevicesPage();
  });

  onBeforeUnmount(() => {
    if (deviceClockTimer) {
      window.clearInterval(deviceClockTimer);
      deviceClockTimer = null;
    }
  });

  return {
    cancelMaintenanceConflict,
    canSetDeviceAvailable,
    closeRunningRepairChoice,
    closeDeviceDrawer,
    closeEditDevice,
    closeMaintenancePlan,
    closePointModal,
    confirmMaintenanceConflict,
    confirmRunningRepairComplete,
    confirmRunningRepairReschedule,
    connectionForm,
    createNewDevice,
    deviceDrawerOpen: deviceDrawer.open,
    deviceForm,
    deviceLifecycleActionLabel,
    deviceRows: visibleRows,
    editDeviceStatusClass,
    editDeviceOpen: editDeviceModal.open,
    locationOptions,
    maintenanceConflictDetail,
    maintenanceConflictOpen: maintenanceConflictModal.open,
    maintenanceForm,
    maintenanceRecordDeviceFilter,
    maintenanceRecordRows,
    maintenancePlanForm,
    maintenancePlanIsPlanned,
    maintenancePlanWarning,
    maintenancePlanOpen: maintenancePlanModal.open,
    metrics,
    openDeviceDrawer,
    openEditDevice,
    openMaintenancePlan,
    openPointModal,
    pointForm,
    pointModalOpen: pointModal.open,
    pointQuery,
    pointRows: visiblePointRows,
    query,
    runningRepairChoiceDetail,
    runningRepairChoiceOpen: runningRepairChoiceModal.open,
    saveCurrentDevice,
    saveEditedDevice,
    saveMaintenancePlan,
    savePoint,
    selectedDevice,
    setDeviceAvailable,
    sortDirection,
    sortKey,
    testTypeOptions,
    toggleSort,
  };
}

export { useDevicesPage };
