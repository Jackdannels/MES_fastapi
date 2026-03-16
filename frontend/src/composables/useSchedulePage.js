import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";

import { useDialogState } from "@/composables/useDialogState";
import { useStorageSnapshot } from "@/composables/useStorageSnapshot";
import { useTabState } from "@/composables/useTabState";
import {
  buildConflictRows,
  buildGanttRows,
  buildLabOptions,
  buildManualTaskOptions,
  buildRetentionInternalRows,
  buildScheduleEditForm,
  buildScheduleRows,
  buildSummaryCards,
  createManualScheduleForm,
  createScheduleEditForm,
  createScheduleRecord,
  deleteScheduleRecord,
  formatDateTime,
  isRetentionDevice,
  normalizeText,
  isManualScheduleSelectionLegal,
  resolveLegalManualScheduleState,
  resolveRetentionTimeState,
  updateScheduleRecord,
} from "@/lib/schedulePageModel";
import { STORAGE_KEYS } from "@/lib/storageKeys";

function useSchedulePage() {
  const { activeTab, setActiveTab } = useTabState("unpacking");
  const { loadSnapshot, persistSnapshot } = useStorageSnapshot([
    STORAGE_KEYS.devices,
    STORAGE_KEYS.samples,
    STORAGE_KEYS.schedules,
    STORAGE_KEYS.streams,
    STORAGE_KEYS.tasks,
  ]);

  const rawDevices = ref([]);
  const rawSamples = ref([]);
  const rawSchedules = ref([]);
  const rawStreams = ref([]);
  const rawTasks = ref([]);
  const scheduleForm = ref(createManualScheduleForm());
  const editForm = ref(createScheduleEditForm());
  const scheduleWarning = ref("");
  const editWarning = ref("");
  const scheduleSearch = ref("");
  const conflictSearch = ref("");
  const now = ref(new Date());

  const scheduleDrawer = useDialogState();
  const taskDetailModal = useDialogState();
  let clockTimer = null;

  const taskOptions = computed(() =>
    buildManualTaskOptions({
      activeTab: activeTab.value,
      samples: rawSamples.value,
      schedules: rawSchedules.value,
      tasks: rawTasks.value,
    }),
  );

  const selectedTaskOption = computed(
    () => taskOptions.value.find((option) => option.code === normalizeText(scheduleForm.value.task_code)) || null,
  );

  const manualLabOptions = computed(() =>
    buildLabOptions({
      activeTab: activeTab.value,
      selectedDevice: normalizeText(scheduleForm.value.device),
      testType: selectedTaskOption.value?.testType || "",
    }),
  );
  const ganttFilterDevice = computed(() =>
    retentionSelected.value ? "" : normalizeText(scheduleForm.value.device),
  );

  const scheduleRows = computed(() => buildScheduleRows({ schedules: rawSchedules.value, tasks: rawTasks.value, now: now.value }));
  const conflictRows = computed(() => buildConflictRows({ schedules: rawSchedules.value }));
  const retentionInternalRows = computed(() =>
    buildRetentionInternalRows({
      samples: rawSamples.value,
      schedules: rawSchedules.value,
      tasks: rawTasks.value,
      now: now.value,
    }),
  );
  const ganttView = computed(() =>
    buildGanttRows({
      devices: rawDevices.value,
      filterDevice: ganttFilterDevice.value,
      now: now.value,
      schedules: rawSchedules.value,
    }),
  );
  const summaryCards = computed(() => buildSummaryCards({ now: now.value, schedules: rawSchedules.value }));
  const currentTimeLabel = computed(() => formatDateTime(now.value));
  const retentionSelected = computed(() => isRetentionDevice(scheduleForm.value.device));
  const showRetentionPanel = computed(() => activeTab.value === "retention");
  const selectedTaskDetail = computed(() => {
    const scheduleId = normalizeText(taskDetailModal.payload.value?.id);
    if (!scheduleId) {
      return null;
    }

    const schedule = rawSchedules.value.find((entry) => normalizeText(entry?.id) === scheduleId);
    if (!schedule) {
      return null;
    }

    const task = rawTasks.value.find((entry) => normalizeText(entry?.code) === normalizeText(schedule?.task_code));
    return {
      code: normalizeText(schedule?.task_code),
      device: normalizeText(schedule?.device),
      estimatedEndAt: formatDateTime(schedule?.end_at),
      name: normalizeText(task?.name) || "-",
      plannedHours: normalizeText(schedule?.planned_hours) || "-",
      priority: normalizeText(task?.priority) || "-",
      source: normalizeText(task?.source) || "-",
      startAt: formatDateTime(schedule?.start_at),
      status: normalizeText(task?.status) || normalizeText(schedule?.status) || "-",
      testType: normalizeText(task?.test_type) || "-",
    };
  });

  const filteredScheduleRows = computed(() => {
    const query = normalizeText(scheduleSearch.value);
    if (!query) {
      return scheduleRows.value;
    }
    return scheduleRows.value.filter((row) =>
      [row.taskCode, row.device, row.startAt, row.endAt, row.rowStatus].some((value) =>
        normalizeText(value).includes(query),
      ),
    );
  });

  const filteredConflictRows = computed(() => {
    const query = normalizeText(conflictSearch.value);
    if (!query) {
      return conflictRows.value;
    }
    return conflictRows.value.filter((row) =>
      [row.taskCode, row.device, row.reason, row.impact, row.suggestion].some((value) =>
        normalizeText(value).includes(query),
      ),
    );
  });

  const persistAll = async (updates) => {
    if (Array.isArray(updates[STORAGE_KEYS.tasks])) {
      rawTasks.value = updates[STORAGE_KEYS.tasks];
    }
    if (Array.isArray(updates[STORAGE_KEYS.schedules])) {
      rawSchedules.value = updates[STORAGE_KEYS.schedules];
    }
    if (Array.isArray(updates[STORAGE_KEYS.streams])) {
      rawStreams.value = updates[STORAGE_KEYS.streams];
    }
    await persistSnapshot(updates);
  };

  const resetScheduleForm = () => {
    scheduleForm.value = createManualScheduleForm(now.value);
    scheduleWarning.value = "";
  };

  const syncManualScheduleLegality = () => {
    if (retentionSelected.value || normalizeText(scheduleForm.value.time_slot) === "custom") {
      return;
    }

    if (isManualScheduleSelectionLegal(scheduleForm.value, now.value)) {
      return;
    }

    Object.assign(scheduleForm.value, resolveLegalManualScheduleState(now.value));
  };

  const syncRetentionClock = () => {
    now.value = new Date();
    syncManualScheduleLegality();
    syncRetentionSelection();
  };

  const syncRetentionSelection = () => {
    if (!retentionSelected.value) {
      return;
    }

    Object.assign(scheduleForm.value, resolveRetentionTimeState(now.value));
  };

  const submitSchedule = async () => {
    const result = createScheduleRecord({
      form: scheduleForm.value,
      now: now.value,
      schedules: rawSchedules.value,
      streams: rawStreams.value,
      tasks: rawTasks.value,
    });
    if (result.error) {
      scheduleWarning.value = result.error;
      return;
    }

    scheduleWarning.value = "";
    await persistAll({
      [STORAGE_KEYS.schedules]: result.schedules,
      [STORAGE_KEYS.streams]: result.streams,
      [STORAGE_KEYS.tasks]: result.tasks,
    });
    resetScheduleForm();
  };

  const openScheduleDrawer = (scheduleId) => {
    const schedule = rawSchedules.value.find((entry) => normalizeText(entry?.id) === normalizeText(scheduleId));
    if (!schedule) {
      return;
    }
    editForm.value = buildScheduleEditForm(schedule);
    editWarning.value = "";
    scheduleDrawer.openWith({ id: scheduleId });
  };

  const closeScheduleDrawer = () => {
    scheduleDrawer.close();
    editForm.value = createScheduleEditForm();
    editWarning.value = "";
  };

  const openTaskDetailModal = (scheduleId) => {
    const schedule = rawSchedules.value.find((entry) => normalizeText(entry?.id) === normalizeText(scheduleId));
    if (!schedule) {
      return;
    }
    taskDetailModal.openWith({ id: scheduleId });
  };

  const closeTaskDetailModal = () => {
    taskDetailModal.close();
  };

  const saveSchedule = async () => {
    const result = updateScheduleRecord({
      form: editForm.value,
      now: now.value,
      schedules: rawSchedules.value,
      streams: rawStreams.value,
      tasks: rawTasks.value,
    });
    if (result.error) {
      editWarning.value = result.error;
      return;
    }

    editWarning.value = "";
    await persistAll({
      [STORAGE_KEYS.schedules]: result.schedules,
      [STORAGE_KEYS.streams]: result.streams,
      [STORAGE_KEYS.tasks]: result.tasks,
    });
    closeScheduleDrawer();
  };

  const removeSchedule = async () => {
    const result = deleteScheduleRecord({
      now: now.value,
      scheduleId: editForm.value.id,
      schedules: rawSchedules.value,
      streams: rawStreams.value,
      tasks: rawTasks.value,
    });
    await persistAll({
      [STORAGE_KEYS.schedules]: result.schedules,
      [STORAGE_KEYS.streams]: result.streams,
      [STORAGE_KEYS.tasks]: result.tasks,
    });
    closeScheduleDrawer();
  };

  const loadSchedulePage = async () => {
    const snapshot = await loadSnapshot();
    rawDevices.value = Array.isArray(snapshot[STORAGE_KEYS.devices]) ? snapshot[STORAGE_KEYS.devices] : [];
    rawSamples.value = Array.isArray(snapshot[STORAGE_KEYS.samples]) ? snapshot[STORAGE_KEYS.samples] : [];
    rawSchedules.value = Array.isArray(snapshot[STORAGE_KEYS.schedules]) ? snapshot[STORAGE_KEYS.schedules] : [];
    rawStreams.value = Array.isArray(snapshot[STORAGE_KEYS.streams]) ? snapshot[STORAGE_KEYS.streams] : [];
    rawTasks.value = Array.isArray(snapshot[STORAGE_KEYS.tasks]) ? snapshot[STORAGE_KEYS.tasks] : [];
    resetScheduleForm();
  };

  watch(activeTab, () => {
    const validTask = taskOptions.value.some((option) => option.code === normalizeText(scheduleForm.value.task_code));
    if (!validTask) {
      scheduleForm.value.task_code = "";
      scheduleForm.value.device = "";
    }
    scheduleWarning.value = "";
  });

  watch(
    () => scheduleForm.value.task_code,
    () => {
      scheduleForm.value.device = "";
      scheduleWarning.value = "";
    },
  );

  watch(
    () => scheduleForm.value.device,
    () => {
      syncRetentionSelection();
      scheduleWarning.value = "";
    },
  );

  watch(
    () => scheduleForm.value.time_slot,
    (nextSlot) => {
      if (nextSlot !== "custom") {
        scheduleForm.value.custom_start = "";
        scheduleForm.value.custom_end = "";
      }
    },
  );

  onMounted(() => {
    void loadSchedulePage();
    clockTimer = window.setInterval(syncRetentionClock, 1000);
  });

  onBeforeUnmount(() => {
    if (clockTimer) {
      window.clearInterval(clockTimer);
    }
  });

  const buildEditLabOptions = (selectedDevice, taskCode) => {
    const task = rawTasks.value.find((item) => normalizeText(item?.code) === normalizeText(taskCode));
    return buildLabOptions({
      activeTab: "unpacking",
      selectedDevice,
      testType: normalizeText(task?.test_type),
    });
  };

  return {
    buildEditLabOptions,
    activeTab,
    closeScheduleDrawer,
    closeTaskDetailModal,
    conflictRows: filteredConflictRows,
    conflictSearch,
    currentTimeLabel,
    editForm,
    editWarning,
    ganttView,
    manualLabOptions,
    openTaskDetailModal,
    openScheduleDrawer,
    removeSchedule,
    retentionInternalRows,
    retentionSelected,
    saveSchedule,
    scheduleDrawerOpen: scheduleDrawer.open,
    selectedTaskDetail,
    taskDetailModalOpen: taskDetailModal.open,
    scheduleForm,
    scheduleRows: filteredScheduleRows,
    scheduleSearch,
    scheduleWarning,
    selectedSchedule: scheduleDrawer.payload,
    setActiveTab,
    showRetentionPanel,
    submitSchedule,
    summaryCards,
    taskOptions,
    resetScheduleForm,
  };
}

export { useSchedulePage };
