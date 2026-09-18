// 负责设备台账状态、维保表单和维保计划流程。
import { computed, ref, watch } from "vue";

import { useDialogState } from "@/composables/useDialogState";
import { useStorageSnapshot } from "@/composables/useStorageSnapshot";
import { useStorageSnapshotRefresh } from "@/composables/useStorageSnapshotRefresh";
import { useTableControls } from "@/composables/useTableControls";
import { serverNowDate } from "@/lib/serverClock";
import { scheduleMatchesLab } from "@/lib/labIdentity";
import { STORAGE_KEYS } from "@/lib/storageKeys";
import {
  appendDevice,
  buildDeviceForm,
  buildDeviceMetrics,
  buildDeviceRows,
  buildLocationOptions,
  buildMaintenancePlanForm,
  buildSelectedDevice,
  buildTestTypeOptions,
  createDeviceForm,
  createMaintenanceForm,
  createMaintenancePlanForm,
  resolveStatusClass,
  resolveMaintenanceScheduleImpact,
  syncDeviceTypeWithLocation,
  upsertDevice,
} from "./model";
import {
  MAINTENANCE_END_TIME_WARNING,
  MAINTENANCE_SCHEDULE_CONFLICT_WARNING,
  MAINTENANCE_START_TIME_WARNING,
  buildMaintenanceRecord,
  buildTimedMaintenanceStatusUpdates,
  clearMaintenanceFields,
  isPlannedMaintenanceType,
  isUnavailableDeviceStatus,
  normalizeText,
  parseTime,
  toBusinessDateTimeValue,
} from "./deviceMaintenanceRules";
import { useDeviceClock } from "./useDeviceClock";
import { createDeviceRunningRepair } from "./deviceRunningRepair";
import { createDeviceMaintenanceSchedule } from "./deviceMaintenanceSchedule";
import { publishDeviceFaultCancelRequest } from "@/lib/laboratoryMqApi";
import { resolveLaboratoryRouteKey } from "@/lib/labs";

// 将设备存储记录转换为页面所需的表格、表单、抽屉和弹窗状态。
function useDevicesPageEngine() {
  const { loadSnapshot, persistRunningRepair, persistSnapshot } = useStorageSnapshot([
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
  const deviceDrawer = useDialogState();
  const editDeviceModal = useDialogState();
  const maintenancePlanModal = useDialogState();
  const maintenanceConflictModal = useDialogState();
  const runningRepairChoiceModal = useDialogState();
  const runningRepairChoiceDetail = ref(null);
  const runningRepairChoiceWarning = ref("");
  const runningRepairSubmitting = ref(false);
  const runningRepairPending = ref(false);
  const runningRepairConfirmed = ref(false);
  const runningRepairReason = ref("");
  const now = ref(serverNowDate());
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
  const maintenancePlanStartMin = computed(() => {
    const minute = 60 * 1000;
    const nextSelectableTime = new Date(Math.ceil(now.value.getTime() / minute) * minute);
    return toBusinessDateTimeValue(nextSelectableTime).replace(" ", "T").slice(0, 16);
  });
  const maintenancePlanEndMin = computed(() => {
    const currentMinimum = parseTime(maintenancePlanStartMin.value);
    const startAt = parseTime(maintenancePlanForm.value.startAt);
    const endMinimum = startAt === null
      ? currentMinimum
      : Math.max(currentMinimum, startAt + 60 * 1000);
    return toBusinessDateTimeValue(new Date(endMinimum)).replace(" ", "T").slice(0, 16);
  });
  const testTypeOptions = computed(() => buildTestTypeOptions(rawDevices.value));
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
    () => !rawExperimentRuns.value.some((run) => ["实验进行中", "实验中", "实验暂停"].includes(normalizeText(run.status)) && scheduleMatchesLab(run, deviceForm.value))
      && (hasFuturePlannedMaintenance.value || hasActivePlannedMaintenance.value || !["空闲", "工作中"].includes(normalizeText(deviceForm.value.status))),
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
    await persistSnapshot({
      [STORAGE_KEYS.devices]: nextDevices,
      [STORAGE_KEYS.maintenance_records]: nextMaintenanceRecords,
    });
    rawDevices.value = nextDevices;
    rawMaintenanceRecords.value = nextMaintenanceRecords;
  };

  const syncTimedMaintenanceStatuses = async (currentDate = serverNowDate()) => {
    const updates = buildTimedMaintenanceStatusUpdates(rawDevices.value, rawMaintenanceRecords.value, currentDate);
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

  const maintenanceSchedule = createDeviceMaintenanceSchedule({
    maintenancePlanDevice,
    state: { rawConflicts, rawDevices, rawExperiments, rawExperimentTrays, rawSamples, rawSchedules, rawTasks },
  });
  const {
    buildMaintenancePlanUpdates,
    buildUnavailableDeviceStatusUpdates,
    rawDevicesIncludingMaintenanceTarget,
  } = maintenanceSchedule;

  const {
    findRunningSchedulesForDevice,
    resolveDeviceRef,
  } = createDeviceRunningRepair({
    maintenancePlanDevice,
    rawDevicesIncludingMaintenanceTarget,
    state: {
      rawDevices,
      rawExperiments,
      rawExperimentRuns,
      rawExperimentRunTrays,
      rawExperimentTrays,
      rawSamples,
      rawSchedules,
      rawTasks,
    },
  });

  const persistMaintenancePlan = async ({ conflictingSchedules = [], deviceCode, form }) => {
    const timestamp = toBusinessDateTimeValue(serverNowDate());
    const updates = buildMaintenancePlanUpdates({ conflictingSchedules, deviceCode, form, timestamp });
    await persistSnapshot(updates);
    rawDevices.value = updates[STORAGE_KEYS.devices];
    if (updates[STORAGE_KEYS.schedules]) {
      rawConflicts.value = updates[STORAGE_KEYS.conflicts];
      rawExperiments.value = updates[STORAGE_KEYS.experiments];
      rawSchedules.value = updates[STORAGE_KEYS.schedules];
      rawTasks.value = updates[STORAGE_KEYS.tasks];
    }
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
    const timestamp = toBusinessDateTimeValue(serverNowDate());
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
      runningRepairChoiceWarning.value = "";
      runningRepairPending.value = false;
      runningRepairConfirmed.value = false;
      runningRepairReason.value = normalizeText(form.note);
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
    const existingStartAt = parseTime(maintenancePlanDevice.value?.maintenanceStartAt);
    const unchangedExistingPlan = startAt !== null
      && startAt === existingStartAt
      && normalizeText(form.type) === normalizeText(maintenancePlanDevice.value?.maintenanceType);
    if (
      isPlannedMaintenanceType(form.type)
      && (startAt === null || startAt < serverNowDate().getTime())
      && !unchangedExistingPlan
    ) {
      maintenancePlanWarning.value = MAINTENANCE_START_TIME_WARNING;
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
    try {
      await persistMaintenancePlan({ deviceCode, form });
    } catch (error) {
      maintenancePlanWarning.value = normalizeText(error?.message) || "维保保存失败，请重试";
      return;
    }
    closeMaintenancePlan();
  };

  const closeRunningRepairChoice = () => {
    if (runningRepairSubmitting.value) return;
    if (runningRepairPending.value) closeMaintenancePlan();
    runningRepairPending.value = false;
    runningRepairChoiceDetail.value = null;
    runningRepairChoiceWarning.value = "";
    runningRepairChoiceModal.close();
    flushPendingStorageRefresh();
  };

  const persistRunningRepairChoice = async (mode) => {
    if (runningRepairSubmitting.value || runningRepairPending.value) return;
    const detail = runningRepairChoiceDetail.value;
    if (!detail) {
      runningRepairChoiceModal.close();
      return;
    }
    runningRepairChoiceWarning.value = "";
    if (mode === "complete") {
      try {
        await persistRunningRepair({
          deviceCode: detail.deviceCode,
          maintenanceNote: detail.form?.note,
          targets: detail.runningSchedules,
        });
        await loadDevicesPage();
      } catch (error) {
        runningRepairChoiceWarning.value = normalizeText(error?.message) || "维修操作失败，请刷新后重试";
        return;
      }
      closeRunningRepairChoice();
      closeMaintenancePlan();
      return;
    }
    if (!normalizeText(runningRepairReason.value)) {
      runningRepairChoiceWarning.value = "请填写设备故障原因";
      return;
    }
    runningRepairSubmitting.value = true;
    try {
      for (const target of detail.runningSchedules) {
        const labCode = resolveLaboratoryRouteKey(target.lab_code || target.device || detail.deviceCode);
        if (!target.run_no || !labCode.startsWith("LAB_")) throw new Error("当前运行缺少批次或实验室编码，请刷新后重试");
        await publishDeviceFaultCancelRequest({
          task_code: target.task_code, experiment_code: target.experiment_code,
          run_no: target.run_no, lab_code: labCode, cancel_reason: normalizeText(runningRepairReason.value),
        });
      }
      runningRepairPending.value = true;
      runningRepairChoiceWarning.value = "设备故障取消请求已发送，等待上位机确认。确认前不得移动样品；原运行及已收到结果将保留。可关闭此窗口，确认后页面会更新。";
    } catch (error) {
      runningRepairChoiceWarning.value = normalizeText(error?.message) || "故障取消请求失败，请刷新后重试";
    } finally {
      runningRepairSubmitting.value = false;
    }
  };

  const confirmRunningRepairReschedule = () => persistRunningRepairChoice("reschedule");

  const confirmRunningRepairComplete = () => persistRunningRepairChoice("complete");

  const setDeviceAvailable = async () => {
    const deviceCode = normalizeText(deviceForm.value?.code);
    if (!deviceCode || !canSetDeviceAvailable.value) {
      return;
    }
    if (findRunningSchedulesForDevice(deviceCode).length) return;
    const endedAt = serverNowDate();
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
      const timestamp = toBusinessDateTimeValue(serverNowDate());
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
    if (runningRepairPending.value && runningRepairChoiceDetail.value?.runningSchedules.every((target) =>
      rawExperimentRuns.value.some((run) => normalizeText(run.run_no || run.id) === normalizeText(target.run_no) && run.status === "设备故障试验取消"))) {
      runningRepairConfirmed.value = true;
      runningRepairChoiceWarning.value = "上位机已确认：设备故障试验取消，本次运行记录已保留。可继续比对下一试验或扫码入库；本次结果及待补齐状态可在归档报告中查看。";
    }
    await syncTimedMaintenanceStatuses(now.value);
  };

  const isRealtimeRefreshPaused = () => !runningRepairPending.value && Boolean(
    deviceDrawer.open.value
    || editDeviceModal.open.value
    || maintenancePlanModal.open.value
    || maintenanceConflictModal.open.value
    || runningRepairChoiceModal.open.value
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

  watch(
    () => maintenancePlanForm.value.type,
    (type) => {
      maintenancePlanWarning.value = "";
      if (isPlannedMaintenanceType(type)) {
        return;
      }
      maintenancePlanForm.value.startAt = "";
      maintenancePlanForm.value.endAt = "";
    },
    { flush: "sync" },
  );

  watch(
    () => [
      maintenancePlanForm.value.type,
      maintenancePlanForm.value.startAt,
      maintenancePlanForm.value.endAt,
    ],
    ([type, startValue, endValue]) => {
      if (!isPlannedMaintenanceType(type) || !normalizeText(startValue) || !normalizeText(endValue)) {
        return;
      }
      const startAt = parseTime(startValue);
      const endAt = parseTime(endValue);
      if (!startAt || !endAt || endAt <= startAt) {
        maintenancePlanForm.value.endAt = "";
      }
    },
  );

  useDeviceClock({ loadDevicesPage, now, syncTimedMaintenanceStatuses });

  return {
    cancelMaintenanceConflict,
    canSetDeviceAvailable,
    closeRunningRepairChoice,
    closeDeviceDrawer,
    closeEditDevice,
    closeMaintenancePlan,
    confirmMaintenanceConflict,
    confirmRunningRepairComplete,
    confirmRunningRepairReschedule,
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
    maintenancePlanEndMin,
    maintenancePlanStartMin,
    maintenancePlanIsPlanned,
    maintenancePlanWarning,
    maintenancePlanOpen: maintenancePlanModal.open,
    metrics,
    openDeviceDrawer,
    openEditDevice,
    openMaintenancePlan,
    query,
    runningRepairChoiceDetail,
    runningRepairChoiceOpen: runningRepairChoiceModal.open,
    runningRepairChoiceWarning,
    runningRepairSubmitting,
    runningRepairPending,
    runningRepairConfirmed,
    runningRepairReason,
    saveCurrentDevice,
    saveEditedDevice,
    saveMaintenancePlan,
    selectedDevice,
    setDeviceAvailable,
    sortDirection,
    sortKey,
    testTypeOptions,
    toggleSort,
  };
}

export { useDevicesPageEngine };
