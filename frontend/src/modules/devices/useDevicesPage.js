// 负责设备台账状态、维护表单、维护计划和点位管理流程。
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";

import { useDialogState } from "@/composables/useDialogState";
import { useStorageSnapshot } from "@/composables/useStorageSnapshot";
import { useTableControls } from "@/composables/useTableControls";
import { STORAGE_KEYS } from "@/lib/storageKeys";
import { resolveTransferConfirmedAt } from "@/lib/transferArrivalTime";
import { resolveTaskStatus, STATUS_WAITING } from "@/modules/schedule/model";
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
  resolveMaintenanceScheduleImpact,
  syncDeviceTypeWithLocation,
  upsertDevice,
} from "./model";

const normalizeText = (value) => String(value ?? "").trim();
const isUnavailableDeviceStatus = (status) => {
  const normalized = normalizeText(status);
  return ["维护", "维修", "停用", "禁用", "不可用"].some((keyword) => normalized.includes(keyword));
};
const toLocalDateTimeValue = (value = new Date()) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
};

// 将设备存储记录转换为页面所需的表格、表单、抽屉和弹窗状态。
function useDevicesPage() {
  const { loadSnapshot, persistSnapshot } = useStorageSnapshot([
    STORAGE_KEYS.conflicts,
    STORAGE_KEYS.devices,
    STORAGE_KEYS.experiments,
    STORAGE_KEYS.experiment_trays,
    STORAGE_KEYS.samples,
    STORAGE_KEYS.schedules,
    STORAGE_KEYS.tasks,
  ]);
  const rawConflicts = ref([]);
  const rawDevices = ref([]);
  const rawExperiments = ref([]);
  const rawExperimentTrays = ref([]);
  const rawSamples = ref([]);
  const rawSchedules = ref([]);
  const rawTasks = ref([]);
  const deviceForm = ref(createDeviceForm());
  const selectedDevice = ref(buildSelectedDevice());
  const maintenanceForm = ref(createMaintenanceForm());
  const maintenancePlanForm = ref(createMaintenancePlanForm());
  const maintenancePlanDevice = ref(null);
  const maintenanceConflictDetail = ref(null);
  const pointForm = ref(createPointForm());
  const connectionForm = ref(createConnectionForm());
  const pointRows = ref(createPointRows());
  const pointQuery = ref("");
  const deviceDrawer = useDialogState();
  const editDeviceModal = useDialogState();
  const maintenancePlanModal = useDialogState();
  const maintenanceConflictModal = useDialogState();
  const pointModal = useDialogState();
  const now = ref(new Date());
  let deviceClockTimer = null;

  const baseRows = computed(() =>
    buildDeviceRows(rawDevices.value, rawSchedules.value, now.value, rawSamples.value, rawExperimentTrays.value),
  );
  const metrics = computed(() => buildDeviceMetrics(baseRows.value));
  const locationOptions = computed(() => buildLocationOptions(rawDevices.value));
  const testTypeOptions = computed(() => buildTestTypeOptions(rawDevices.value));
  const visiblePointRows = computed(() => buildVisiblePointRows(pointRows.value, pointQuery.value));

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

  const persistDevices = async (nextDevices) => {
    rawDevices.value = nextDevices;
    await persistSnapshot({
      [STORAGE_KEYS.devices]: nextDevices,
    });
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
    detail: `${normalizeText(schedule?.device) || "对应试验间"}在排程期间维护，已自动删除`,
    device: normalizeText(schedule?.device),
    experiment_code: normalizeText(schedule?.experiment_code),
    id: `device-maintenance-${normalizeText(schedule?.id) || Date.now()}`,
    reason: `${normalizeText(schedule?.device) || "对应试验间"}在排程期间维护，已自动删除`,
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

  const buildMaintenancePlanUpdates = ({ conflictingSchedules = [], deviceCode, form, timestamp }) => {
    const removedScheduleIds = new Set(conflictingSchedules.map((schedule) => normalizeText(schedule?.id)).filter(Boolean));
    const removedExperimentKeys = new Set(
      conflictingSchedules.map((schedule) => `${normalizeText(schedule?.task_code)}::${normalizeText(schedule?.experiment_code)}`),
    );
    const { samplesByTaskCode, taskByCode } = buildTransferConfirmedContext();
    const nextDevices = rawDevices.value.map((device) => {
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
      if (Number.isFinite(startAt) && Number.isFinite(endAt) && startAt <= current && current <= endAt) {
        nextDevice.status = MAINTENANCE_DEVICE_STATUS;
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
        unscheduled_since: confirmedAt?.toISOString() || "",
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
        unscheduled_since: confirmedAt?.toISOString() || "",
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
    const timestamp = toLocalDateTimeValue(new Date());
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
    deviceDrawer.openWith(nextSelected);
  };

  const closeDeviceDrawer = () => {
    deviceDrawer.close();
  };

  const openEditDevice = (row) => {
    deviceForm.value = buildDeviceForm(row);
    editDeviceModal.openWith({ code: normalizeText(row?.code) });
  };

  const closeEditDevice = () => {
    editDeviceModal.close();
  };

  const saveEditedDevice = async () => {
    const previousDevice = rawDevices.value.find((device) => normalizeText(device?.code) === normalizeText(deviceForm.value?.code));
    const changedToUnavailable =
      isUnavailableDeviceStatus(deviceForm.value?.status) && normalizeText(previousDevice?.status) !== normalizeText(deviceForm.value?.status);
    if (changedToUnavailable) {
      const conflictingSchedules = rawSchedules.value.filter((schedule) => normalizeText(schedule?.device) === normalizeText(deviceForm.value?.code));
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
    maintenancePlanModal.openWith(selected);
  };

  const closeMaintenancePlan = () => {
    maintenancePlanModal.close();
    maintenancePlanDevice.value = null;
    maintenancePlanForm.value = createMaintenancePlanForm();
  };

  const saveMaintenancePlan = async () => {
    const deviceCode = normalizeText(maintenancePlanDevice.value?.code);
    if (!deviceCode) {
      return;
    }
    const impact = resolveMaintenanceScheduleImpact({
      deviceCode,
      endAt: maintenancePlanForm.value.endAt,
      schedules: rawSchedules.value,
      startAt: maintenancePlanForm.value.startAt,
    });
    if (impact.conflictingSchedules.length > 0) {
      maintenanceConflictDetail.value = {
        conflictingSchedules: impact.conflictingSchedules,
        deviceCode,
        form: { ...maintenancePlanForm.value },
      };
      maintenanceConflictModal.openWith(maintenanceConflictDetail.value);
      return;
    }
    await persistMaintenancePlan({ deviceCode, form: maintenancePlanForm.value });
    closeMaintenancePlan();
  };

  const confirmMaintenanceConflict = async () => {
    const detail = maintenanceConflictDetail.value;
    if (!detail) {
      maintenanceConflictModal.close();
      return;
    }
    if (detail.mode === "deviceStatus") {
      const timestamp = toLocalDateTimeValue(new Date());
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
  };

  const cancelMaintenanceConflict = () => {
    maintenanceConflictDetail.value = null;
    maintenanceConflictModal.close();
  };

  const openPointModal = () => {
    pointModal.openWith({ id: "point-modal" });
  };

  const closePointModal = () => {
    pointModal.close();
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
    rawExperimentTrays.value = Array.isArray(snapshot[STORAGE_KEYS.experiment_trays])
      ? snapshot[STORAGE_KEYS.experiment_trays]
      : [];
    rawSamples.value = Array.isArray(snapshot[STORAGE_KEYS.samples]) ? snapshot[STORAGE_KEYS.samples] : [];
    rawSchedules.value = Array.isArray(snapshot[STORAGE_KEYS.schedules]) ? snapshot[STORAGE_KEYS.schedules] : [];
    rawTasks.value = Array.isArray(snapshot[STORAGE_KEYS.tasks]) ? snapshot[STORAGE_KEYS.tasks] : [];
  };

  watch(
    () => deviceForm.value.location,
    () => {
      syncFormTypeWithLocation();
    },
  );

  const syncDeviceClock = () => {
    now.value = new Date();
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
    closeDeviceDrawer,
    closeEditDevice,
    closeMaintenancePlan,
    closePointModal,
    confirmMaintenanceConflict,
    connectionForm,
    createNewDevice,
    deviceDrawerOpen: deviceDrawer.open,
    deviceForm,
    deviceRows: visibleRows,
    editDeviceOpen: editDeviceModal.open,
    locationOptions,
    maintenanceConflictDetail,
    maintenanceConflictOpen: maintenanceConflictModal.open,
    maintenanceForm,
    maintenancePlanForm,
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
    saveCurrentDevice,
    saveEditedDevice,
    saveMaintenancePlan,
    savePoint,
    selectedDevice,
    sortDirection,
    sortKey,
    testTypeOptions,
    toggleSort,
  };
}

export { useDevicesPage };
