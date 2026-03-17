// 负责排程表单、看板状态、甘特行数据和持久化流程。
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
} from "./model";
import { STORAGE_KEYS } from "@/lib/storageKeys";

// 统一管理创建、编辑和查看排程记录所需的响应式状态。
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

  // 可选实验室由当前页签、任务试验类型以及已选设备共同决定。
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
    // 详情弹窗只取排程与任务交集字段，避免把整条记录暴露给视图层。
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
      // 排程表搜索覆盖任务号、实验室、时间段和状态四类文本。
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
    // 只同步本页关心的任务、排程和数据流，设备/样品保持原样。
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
    // 固定时段如果已经落到非法时间片，会自动纠正到最近合法时段。
    if (retentionSelected.value || normalizeText(scheduleForm.value.time_slot) === "custom") {
      return;
    }

    if (isManualScheduleSelectionLegal(scheduleForm.value, now.value)) {
      return;
    }

    Object.assign(scheduleForm.value, resolveLegalManualScheduleState(now.value));
  };

  const syncRetentionClock = () => {
    // 页面上的当前时间、留样默认时间和合法性检查都跟随秒级时钟更新。
    now.value = new Date();
    syncManualScheduleLegality();
    syncRetentionSelection();
  };

  const syncRetentionSelection = () => {
    // 一旦切到暂存间设备，开始/结束时间立即回填为“此刻”。
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

    // 新建排程后同时同步任务状态和流记录，并重置手动排程表单。
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
    // 编辑抽屉字段通过 model 层统一反向映射，避免页面手拼时间字段。
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

    // 编辑成功后沿用与新建相同的快照同步路径。
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
    // 切页签后如果当前任务不再可选，清空任务和实验室选择。
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
