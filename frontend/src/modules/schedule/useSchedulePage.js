// 负责排程表单、看板状态、甘特行数据和持久化流程。
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";

import { useDialogState } from "@/composables/useDialogState";
import { useStorageSnapshot } from "@/composables/useStorageSnapshot";
import {
  analyzeTaskTrayConflict,
  buildConflictRows,
  buildExperimentOptions,
  buildGanttRows,
  buildLabOptions,
  buildManualTaskOptions,
  buildScheduleEditForm,
  buildScheduleRescheduleForm,
  buildScheduleRows,
  buildSummaryCards,
  buildTaskScheduledOverlays,
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
  resolveScheduleTimes,
  updateScheduleRecord,
} from "./model";
import { STORAGE_KEYS } from "@/lib/storageKeys";

// 统一管理创建、编辑和查看排程记录所需的响应式状态。
function useSchedulePage() {
  const { loadSnapshot, persistSnapshot } = useStorageSnapshot([
    STORAGE_KEYS.devices,
    STORAGE_KEYS.experiments,
    STORAGE_KEYS.experiment_trays,
    STORAGE_KEYS.samples,
    STORAGE_KEYS.schedules,
    STORAGE_KEYS.streams,
    STORAGE_KEYS.tasks,
  ]);

  const rawDevices = ref([]);
  const rawExperiments = ref([]);
  const rawExperimentTrays = ref([]);
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
  const scheduleConflictModal = useDialogState();
  const pendingScheduleDraft = ref(null);
  const scheduleFormWatchSuspended = ref(false);
  let clockTimer = null;

  const taskOptions = computed(() =>
    buildManualTaskOptions({
      experiments: rawExperiments.value,
      experimentTrays: rawExperimentTrays.value,
      schedules: rawSchedules.value,
      tasks: rawTasks.value,
    }),
  );

  const experimentOptions = computed(() =>
    buildExperimentOptions({
      taskCode: scheduleForm.value.task_code,
      experiments: rawExperiments.value,
      schedules: rawSchedules.value,
      tasks: rawTasks.value,
    }),
  );

  const selectedTaskOption = computed(
    () => taskOptions.value.find((option) => option.code === normalizeText(scheduleForm.value.task_code)) || null,
  );
  const selectedExperimentOption = computed(
    () =>
      experimentOptions.value.find((option) => option.code === normalizeText(scheduleForm.value.experiment_code)) || null,
  );

  // 可选实验室由当前页签、任务试验类型以及已选设备共同决定。
  const manualLabOptions = computed(() =>
    buildLabOptions({
      selectedDevice: normalizeText(scheduleForm.value.device),
      testType: selectedExperimentOption.value?.requiredDevice || selectedTaskOption.value?.testType || "",
    }),
  );

  const scheduleRows = computed(() => buildScheduleRows({
    experiments: rawExperiments.value,
    schedules: rawSchedules.value,
    tasks: rawTasks.value,
    now: now.value,
  }));
  const conflictRows = computed(() => buildConflictRows({ schedules: rawSchedules.value }));
  const ganttView = computed(() =>
    buildGanttRows({
      devices: rawDevices.value,
      experiments: rawExperiments.value,
      experimentTrays: rawExperimentTrays.value,
      now: now.value,
      samples: rawSamples.value,
      schedules: rawSchedules.value,
      selectedTaskCode: normalizeText(scheduleForm.value.task_code),
      tasks: rawTasks.value,
    }),
  );
  const taskScheduledOverlays = computed(() =>
    buildTaskScheduledOverlays({
      experimentCode: scheduleForm.value.experiment_code,
      experimentTrays: rawExperimentTrays.value,
      experiments: rawExperiments.value,
      schedules: rawSchedules.value,
      taskCode: scheduleForm.value.task_code,
    }),
  );
  const summaryCards = computed(() => buildSummaryCards({ now: now.value, schedules: rawSchedules.value }));
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
      experimentCode: normalizeText(schedule?.experiment_code),
      experimentLabel:
        normalizeText(
          rawExperiments.value.find((entry) => normalizeText(entry?.experiment_code) === normalizeText(schedule?.experiment_code))?.experiment_name,
        ) || "-",
      name: normalizeText(task?.name) || "-",
      plannedHours: normalizeText(schedule?.planned_hours) || "-",
      priority: normalizeText(task?.priority) || "-",
      source: normalizeText(task?.source) || "-",
      scheduleId: normalizeText(schedule?.id),
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
      // 排程表搜索覆盖任务号、实验号、实验室、时间段和状态文本。
      [row.taskCode, row.experimentCode, row.experimentLabel, row.device, row.startAt, row.endAt, row.rowStatus].some((value) =>
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
    if (Array.isArray(updates[STORAGE_KEYS.experiments])) {
      rawExperiments.value = updates[STORAGE_KEYS.experiments];
    }
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

  const replaceScheduleForm = async (nextForm) => {
    scheduleFormWatchSuspended.value = true;
    scheduleForm.value = nextForm;
    await nextTick();
    scheduleFormWatchSuspended.value = false;
  };

  const resetScheduleFormForTask = async ({ taskCode, schedules }) => {
    const baseForm = createManualScheduleForm(now.value);
    const nextExperimentCode =
      buildExperimentOptions({
        taskCode,
        experiments: rawExperiments.value,
        schedules,
        tasks: rawTasks.value,
      })[0]?.code || "";

    await replaceScheduleForm({
      ...baseForm,
      experiment_code: nextExperimentCode,
      task_code: taskCode,
    });
    scheduleWarning.value = "";
  };

  const syncManualScheduleLegality = () => {
    // 固定时段如果已经落到非法时间片，会自动纠正到最近合法时段。
    if (normalizeText(scheduleForm.value.time_slot) === "custom") {
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
  };

  const submitSchedule = async () => {
    const candidate = {
      device: normalizeText(scheduleForm.value.device),
      experiment_code: normalizeText(scheduleForm.value.experiment_code),
      task_code: normalizeText(scheduleForm.value.task_code),
    };
    const resolved = resolveScheduleTimes(scheduleForm.value, now.value);
    if (!resolved.error) {
      candidate.start_at = resolved.startAt.toISOString();
      candidate.end_at = resolved.endAt.toISOString();
      candidate.planned_hours = resolved.plannedHours;
      const taskConflict = analyzeTaskTrayConflict({
        candidate,
        experimentTrays: rawExperimentTrays.value,
        experiments: rawExperiments.value,
        schedules: rawSchedules.value,
      });
      if (taskConflict) {
        pendingScheduleDraft.value = { ...scheduleForm.value };
        scheduleConflictModal.openWith(taskConflict);
        scheduleWarning.value = "";
        return;
      }
    }

    const result = createScheduleRecord({
      experiments: rawExperiments.value,
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
      [STORAGE_KEYS.experiments]: result.experiments,
      [STORAGE_KEYS.schedules]: result.schedules,
      [STORAGE_KEYS.streams]: result.streams,
      [STORAGE_KEYS.tasks]: result.tasks,
    });
    await resetScheduleFormForTask({
      schedules: result.schedules,
      taskCode: normalizeText(scheduleForm.value.task_code),
    });
  };

  const confirmScheduleConflict = async () => {
    const draft = pendingScheduleDraft.value;
    if (!draft) {
      scheduleConflictModal.close();
      return;
    }

    const result = createScheduleRecord({
      experiments: rawExperiments.value,
      form: draft,
      now: now.value,
      schedules: rawSchedules.value,
      streams: rawStreams.value,
      tasks: rawTasks.value,
    });
    if (result.error) {
      scheduleWarning.value = result.error;
      scheduleConflictModal.close();
      pendingScheduleDraft.value = null;
      return;
    }

    scheduleWarning.value = "";
    await persistAll({
      [STORAGE_KEYS.experiments]: result.experiments,
      [STORAGE_KEYS.schedules]: result.schedules,
      [STORAGE_KEYS.streams]: result.streams,
      [STORAGE_KEYS.tasks]: result.tasks,
    });
    pendingScheduleDraft.value = null;
    scheduleConflictModal.close();
    await resetScheduleFormForTask({
      schedules: result.schedules,
      taskCode: normalizeText(draft.task_code),
    });
  };

  const cancelScheduleConflict = () => {
    pendingScheduleDraft.value = null;
    scheduleConflictModal.close();
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
      experiments: rawExperiments.value,
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
      [STORAGE_KEYS.experiments]: result.experiments,
      [STORAGE_KEYS.schedules]: result.schedules,
      [STORAGE_KEYS.streams]: result.streams,
      [STORAGE_KEYS.tasks]: result.tasks,
    });
    closeScheduleDrawer();
  };

  const removeSchedule = async () => {
    const result = deleteScheduleRecord({
      experiments: rawExperiments.value,
      now: now.value,
      scheduleId: editForm.value.id,
      schedules: rawSchedules.value,
      streams: rawStreams.value,
      tasks: rawTasks.value,
    });
    await persistAll({
      [STORAGE_KEYS.experiments]: result.experiments,
      [STORAGE_KEYS.schedules]: result.schedules,
      [STORAGE_KEYS.streams]: result.streams,
      [STORAGE_KEYS.tasks]: result.tasks,
    });
    closeScheduleDrawer();
  };

  const removeTaskDetailSchedule = async () => {
    const scheduleId = normalizeText(taskDetailModal.payload.value?.id);
    if (!scheduleId) {
      closeTaskDetailModal();
      return;
    }
    const result = deleteScheduleRecord({
      experiments: rawExperiments.value,
      now: now.value,
      scheduleId,
      schedules: rawSchedules.value,
      streams: rawStreams.value,
      tasks: rawTasks.value,
    });
    await persistAll({
      [STORAGE_KEYS.experiments]: result.experiments,
      [STORAGE_KEYS.schedules]: result.schedules,
      [STORAGE_KEYS.streams]: result.streams,
      [STORAGE_KEYS.tasks]: result.tasks,
    });
    closeTaskDetailModal();
  };

  const rescheduleFromTaskDetail = async () => {
    const scheduleId = normalizeText(taskDetailModal.payload.value?.id);
    const schedule = rawSchedules.value.find((entry) => normalizeText(entry?.id) === scheduleId);
    if (!schedule) {
      closeTaskDetailModal();
      return;
    }

    const result = deleteScheduleRecord({
      experiments: rawExperiments.value,
      now: now.value,
      scheduleId,
      schedules: rawSchedules.value,
      streams: rawStreams.value,
      tasks: rawTasks.value,
    });
    await persistAll({
      [STORAGE_KEYS.experiments]: result.experiments,
      [STORAGE_KEYS.schedules]: result.schedules,
      [STORAGE_KEYS.streams]: result.streams,
      [STORAGE_KEYS.tasks]: result.tasks,
    });
    await replaceScheduleForm(buildScheduleRescheduleForm(schedule));
    scheduleWarning.value = "";
    closeTaskDetailModal();
  };

  const loadSchedulePage = async () => {
    const snapshot = await loadSnapshot();
    rawDevices.value = Array.isArray(snapshot[STORAGE_KEYS.devices]) ? snapshot[STORAGE_KEYS.devices] : [];
    rawExperiments.value = Array.isArray(snapshot[STORAGE_KEYS.experiments]) ? snapshot[STORAGE_KEYS.experiments] : [];
    rawExperimentTrays.value = Array.isArray(snapshot[STORAGE_KEYS.experiment_trays]) ? snapshot[STORAGE_KEYS.experiment_trays] : [];
    rawSamples.value = Array.isArray(snapshot[STORAGE_KEYS.samples]) ? snapshot[STORAGE_KEYS.samples] : [];
    rawSchedules.value = Array.isArray(snapshot[STORAGE_KEYS.schedules]) ? snapshot[STORAGE_KEYS.schedules] : [];
    rawStreams.value = Array.isArray(snapshot[STORAGE_KEYS.streams]) ? snapshot[STORAGE_KEYS.streams] : [];
    rawTasks.value = Array.isArray(snapshot[STORAGE_KEYS.tasks]) ? snapshot[STORAGE_KEYS.tasks] : [];
    resetScheduleForm();
  };

  watch(
    () => scheduleForm.value.task_code,
    () => {
      if (scheduleFormWatchSuspended.value) {
        return;
      }
      const firstExperimentCode = experimentOptions.value[0]?.code || "";
      scheduleForm.value.experiment_code = firstExperimentCode;
      scheduleForm.value.device = "";
      scheduleWarning.value = "";
    },
  );

  watch(
    () => scheduleForm.value.experiment_code,
    () => {
      if (scheduleFormWatchSuspended.value) {
        return;
      }
      scheduleForm.value.device = "";
      scheduleWarning.value = "";
    },
  );

  watch(
    () => scheduleForm.value.device,
    () => {
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
    const schedule = rawSchedules.value.find((item) => normalizeText(item?.id) === normalizeText(editForm.value.id));
    const task = rawTasks.value.find((item) => normalizeText(item?.code) === normalizeText(taskCode));
    const experiment = rawExperiments.value.find(
      (item) =>
        normalizeText(item?.task_code) === normalizeText(taskCode) &&
        normalizeText(item?.experiment_code) === normalizeText(schedule?.experiment_code || editForm.value.experiment_code),
    );
    return buildLabOptions({
      selectedDevice,
      testType: normalizeText(experiment?.required_device) || normalizeText(task?.test_type),
    });
  };

  return {
    buildEditLabOptions,
    cancelScheduleConflict,
    closeScheduleDrawer,
    closeTaskDetailModal,
    confirmScheduleConflict,
    conflictRows: filteredConflictRows,
    conflictSearch,
    editForm,
    editWarning,
    experimentOptions,
    ganttView,
    manualLabOptions,
    openTaskDetailModal,
    openScheduleDrawer,
    removeSchedule,
    removeTaskDetailSchedule,
    rescheduleFromTaskDetail,
    saveSchedule,
    scheduleConflictDetail: scheduleConflictModal.payload,
    scheduleConflictOpen: scheduleConflictModal.open,
    scheduleDrawerOpen: scheduleDrawer.open,
    selectedTaskDetail,
    taskDetailModalOpen: taskDetailModal.open,
    taskScheduledOverlays,
    scheduleForm,
    scheduleRows: filteredScheduleRows,
    scheduleSearch,
    scheduleWarning,
    selectedSchedule: scheduleDrawer.payload,
    submitSchedule,
    summaryCards,
    taskOptions,
    resetScheduleForm,
  };
}

export { useSchedulePage };
