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
  buildManualTimeSlotOptions,
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
  STATUS_SCHEDULED,
  toLocalDateValue,
  toLocalTimeValue,
  updateScheduleRecord,
} from "./model";
import { filterActiveTasks } from "@/lib/taskArchive";
import { STORAGE_KEYS } from "@/lib/storageKeys";

// 统一管理创建、编辑和查看排程记录所需的响应式状态。
function useSchedulePage() {
  const { loadSnapshot, persistSnapshot } = useStorageSnapshot([
    STORAGE_KEYS.conflicts,
    STORAGE_KEYS.devices,
    STORAGE_KEYS.experiments,
    STORAGE_KEYS.experiment_trays,
    STORAGE_KEYS.samples,
    STORAGE_KEYS.schedules,
    STORAGE_KEYS.streams,
    STORAGE_KEYS.tasks,
  ]);

  const rawDevices = ref([]);
  const rawConflicts = ref([]);
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
  const ganttWindowOffsetDays = ref(0);

  const scheduleDrawer = useDialogState();
  const taskDetailModal = useDialogState();
  const scheduleConflictModal = useDialogState();
  const exceptionModal = useDialogState();
  const pendingScheduleDraft = ref(null);
  const scheduleFormWatchSuspended = ref(false);
  let clockTimer = null;

  const buildFailureMessage = (prefix, error) => {
    const detail = normalizeText(error instanceof Error ? error.message : "");
    return detail ? `${prefix}，${detail}` : prefix;
  };

  const activeTaskCodes = computed(() => {
    if (!rawTasks.value.length) {
      return null;
    }
    return new Set(filterActiveTasks(rawTasks.value, rawSamples.value).map((task) => normalizeText(task?.code)).filter(Boolean));
  });
  const activeSchedules = computed(() => {
    if (!activeTaskCodes.value) {
      return rawSchedules.value;
    }
    return rawSchedules.value.filter((schedule) => activeTaskCodes.value.has(normalizeText(schedule?.task_code)));
  });

  const taskOptions = computed(() =>
    buildManualTaskOptions({
      experiments: rawExperiments.value,
      experimentTrays: rawExperimentTrays.value,
      samples: rawSamples.value,
      schedules: activeSchedules.value,
      tasks: rawTasks.value,
    }),
  );

  const experimentOptions = computed(() =>
    buildExperimentOptions({
      taskCode: scheduleForm.value.task_code,
      experiments: rawExperiments.value,
      samples: rawSamples.value,
      schedules: activeSchedules.value,
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
  const manualTimeSlotOptions = computed(() =>
    buildManualTimeSlotOptions({
      now: now.value,
      scheduleDate: scheduleForm.value.schedule_date,
      schedules: activeSchedules.value,
    }),
  );

  const scheduleRows = computed(() => buildScheduleRows({
    experimentTrays: rawExperimentTrays.value,
    experiments: rawExperiments.value,
    samples: rawSamples.value,
    schedules: activeSchedules.value,
    tasks: rawTasks.value,
    now: now.value,
  }));
  const conflictRows = computed(() => buildConflictRows({ schedules: activeSchedules.value, samples: rawSamples.value, tasks: rawTasks.value }));
  const pendingExceptionRows = computed(() =>
    rawConflicts.value.filter(
      (entry) => normalizeText(entry?.type) === "schedule_missed_start" && normalizeText(entry?.status) === "pending",
    ),
  );
  const pendingExceptionCount = computed(() => pendingExceptionRows.value.length);
  const ganttStartDate = computed(() => {
    const date = new Date(now.value.getFullYear(), now.value.getMonth(), now.value.getDate());
    date.setDate(date.getDate() + ganttWindowOffsetDays.value);
    return date;
  });
  const canShowPreviousGanttWindow = computed(() => ganttWindowOffsetDays.value > 0);
  const canResetGanttWindow = computed(() => ganttWindowOffsetDays.value !== 0);
  const resolveCustomStartMinTime = (form) => {
    if (normalizeText(form?.time_slot) !== "custom") {
      return "";
    }
    const selectedDate = normalizeText(form?.schedule_date);
    if (!selectedDate || selectedDate !== toLocalDateValue(now.value)) {
      return "";
    }
    return toLocalTimeValue(now.value);
  };
  const scheduleCustomStartMinTime = computed(() => resolveCustomStartMinTime(scheduleForm.value));
  const editCustomStartMinTime = computed(() => resolveCustomStartMinTime(editForm.value));
  const getTodayStart = () => new Date(now.value.getFullYear(), now.value.getMonth(), now.value.getDate());
  const getGanttDateOffset = (dateValue) => {
    const target = new Date(`${dateValue}T00:00:00`);
    if (Number.isNaN(target.getTime())) {
      return 0;
    }
    return Math.max(0, Math.floor((target.getTime() - getTodayStart().getTime()) / (24 * 60 * 60 * 1000)));
  };
  const getDeviceScheduleDateKeys = (device) => {
    const normalizedDevice = normalizeText(device);
    const todayKey = toLocalDateValue(now.value);
    return Array.from(
      new Set(
        activeSchedules.value
          .filter(
            (schedule) =>
              normalizeText(schedule?.device) === normalizedDevice &&
              normalizeText(schedule?.status) === STATUS_SCHEDULED &&
              !isRetentionDevice(schedule?.device),
          )
          .map((schedule) => {
            const startAt = new Date(schedule?.start_at);
            return Number.isNaN(startAt.getTime()) ? "" : toLocalDateValue(startAt);
          })
          .filter((dateKey) => dateKey && dateKey >= todayKey),
      ),
    ).sort();
  };
  const getDeviceScheduleNavigation = (device) => {
    const dateKeys = getDeviceScheduleDateKeys(device);
    const currentKey = toLocalDateValue(ganttStartDate.value);
    return {
      canNext: dateKeys.some((dateKey) => dateKey > currentKey),
      canPrevious: dateKeys.some((dateKey) => dateKey < currentKey),
      hasSchedules: dateKeys.length > 0,
    };
  };
  const ganttView = computed(() =>
    buildGanttRows({
      devices: rawDevices.value,
      experiments: rawExperiments.value,
      experimentTrays: rawExperimentTrays.value,
      now: now.value,
      samples: rawSamples.value,
      schedules: activeSchedules.value,
      selectedTaskCode: normalizeText(scheduleForm.value.task_code),
      startDate: ganttStartDate.value,
      tasks: rawTasks.value,
    }),
  );
  const taskScheduledOverlays = computed(() =>
    buildTaskScheduledOverlays({
      experimentCode: scheduleForm.value.experiment_code,
      experimentTrays: rawExperimentTrays.value,
      experiments: rawExperiments.value,
      samples: rawSamples.value,
      schedules: activeSchedules.value,
      tasks: rawTasks.value,
      taskCode: scheduleForm.value.task_code,
    }),
  );
  const summaryCards = computed(() =>
    buildSummaryCards({
      experimentTrays: rawExperimentTrays.value,
      now: now.value,
      samples: rawSamples.value,
      schedules: activeSchedules.value,
      tasks: rawTasks.value,
    }),
  );
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

  const exceptionActionLabel = computed(() =>
    pendingExceptionCount.value > 0 ? `异常处理 ${pendingExceptionCount.value}` : "异常处理",
  );

  const persistAll = async (updates) => {
    // 只同步本页关心的任务、排程和数据流，设备/样品保持原样。
    if (Array.isArray(updates[STORAGE_KEYS.experiments])) {
      rawExperiments.value = updates[STORAGE_KEYS.experiments];
    }
    if (Array.isArray(updates[STORAGE_KEYS.conflicts])) {
      rawConflicts.value = updates[STORAGE_KEYS.conflicts];
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

  const openExceptionModal = () => {
    exceptionModal.openWith();
  };

  const closeExceptionModal = () => {
    exceptionModal.close();
  };

  const replaceScheduleForm = async (nextForm) => {
    scheduleFormWatchSuspended.value = true;
    scheduleForm.value = nextForm;
    await nextTick();
    scheduleFormWatchSuspended.value = false;
  };

  const normalizeDurationValue = (value, fallback) => {
    const parsed = Number.parseFloat(String(value ?? "").trim());
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  };

  const normalizeDayDurationValue = (value) => {
    return Math.max(0.5, Math.round(value * 2) / 2);
  };

  const setDurationUnit = (formRef, nextUnit) => {
    const form = formRef.value;
    const currentUnit = normalizeText(form?.planned_duration_unit) || "hours";
    if (currentUnit === nextUnit) {
      return;
    }
    const currentValue = normalizeDurationValue(form?.planned_hours, currentUnit === "days" ? 0.5 : 3.5);
    form.planned_duration_unit = nextUnit;
    if (nextUnit === "days") {
      form.planned_hours = normalizeDayDurationValue(Math.ceil(currentValue / 12) / 2);
      return;
    }
    form.planned_hours = Math.max(0.5, currentValue * 24);
  };

  const setScheduleDurationUnit = (unit) => {
    setDurationUnit(scheduleForm, unit);
  };

  const setEditDurationUnit = (unit) => {
    setDurationUnit(editForm, unit);
  };

  const resetScheduleFormForTask = async ({ taskCode, schedules }) => {
    const baseForm = createManualScheduleForm(now.value);
    const nextExperimentCode =
      buildExperimentOptions({
        taskCode,
        experiments: rawExperiments.value,
        samples: rawSamples.value,
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
    const resolved = resolveScheduleTimes(scheduleForm.value, now.value, activeSchedules.value);
    if (!resolved.error) {
      candidate.start_at = resolved.startAt.toISOString();
      candidate.end_at = resolved.endAt.toISOString();
      candidate.planned_hours = resolved.plannedHours;
      const taskConflict = analyzeTaskTrayConflict({
        candidate,
        experimentTrays: rawExperimentTrays.value,
        experiments: rawExperiments.value,
        schedules: activeSchedules.value,
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

  const showPreviousGanttWindow = () => {
    ganttWindowOffsetDays.value = Math.max(0, ganttWindowOffsetDays.value - 3);
  };

  const showNextGanttWindow = () => {
    ganttWindowOffsetDays.value += 3;
  };

  const resetGanttWindow = () => {
    ganttWindowOffsetDays.value = 0;
  };

  const jumpDeviceSchedule = (device, direction) => {
    const dateKeys = getDeviceScheduleDateKeys(device);
    const currentKey = toLocalDateValue(ganttStartDate.value);
    const targetKey = direction === "previous"
      ? dateKeys.filter((dateKey) => dateKey < currentKey).at(-1)
      : dateKeys.find((dateKey) => dateKey > currentKey);
    if (!targetKey) {
      return;
    }
    ganttWindowOffsetDays.value = getGanttDateOffset(targetKey);
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
    try {
      const snapshot = await loadSnapshot();
      rawConflicts.value = Array.isArray(snapshot[STORAGE_KEYS.conflicts]) ? snapshot[STORAGE_KEYS.conflicts] : [];
      rawDevices.value = Array.isArray(snapshot[STORAGE_KEYS.devices]) ? snapshot[STORAGE_KEYS.devices] : [];
      rawExperiments.value = Array.isArray(snapshot[STORAGE_KEYS.experiments]) ? snapshot[STORAGE_KEYS.experiments] : [];
      rawExperimentTrays.value = Array.isArray(snapshot[STORAGE_KEYS.experiment_trays]) ? snapshot[STORAGE_KEYS.experiment_trays] : [];
      rawSamples.value = Array.isArray(snapshot[STORAGE_KEYS.samples]) ? snapshot[STORAGE_KEYS.samples] : [];
      rawSchedules.value = Array.isArray(snapshot[STORAGE_KEYS.schedules]) ? snapshot[STORAGE_KEYS.schedules] : [];
      rawStreams.value = Array.isArray(snapshot[STORAGE_KEYS.streams]) ? snapshot[STORAGE_KEYS.streams] : [];
      rawTasks.value = Array.isArray(snapshot[STORAGE_KEYS.tasks]) ? snapshot[STORAGE_KEYS.tasks] : [];
      resetScheduleForm();
    } catch (error) {
      scheduleWarning.value = buildFailureMessage("排程数据加载失败，请稍后重试", error);
    }
  };

  const acknowledgeException = async (conflictId) => {
    const normalizedConflictId = normalizeText(conflictId);
    if (!normalizedConflictId) {
      return;
    }
    const timestamp = new Date().toISOString();
    const nextConflicts = rawConflicts.value.map((entry) =>
      normalizeText(entry?.id) === normalizedConflictId
        ? {
            ...entry,
            acknowledged_at: timestamp,
            status: "acknowledged",
          }
        : entry,
    );
    await persistAll({
      [STORAGE_KEYS.conflicts]: nextConflicts,
    });
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

  watch(
    () => scheduleForm.value.planned_duration_unit,
    (unit) => {
      if (unit === "days") {
        scheduleForm.value.planned_hours = normalizeDayDurationValue(Number(scheduleForm.value.planned_hours) || 0.5);
      }
    },
  );

  watch(
    () => editForm.value.time_slot,
    (nextSlot) => {
      if (nextSlot !== "custom") {
        editForm.value.custom_start = "";
        editForm.value.custom_end = "";
      }
    },
  );

  watch(
    () => editForm.value.planned_duration_unit,
    (unit) => {
      if (unit === "days") {
        editForm.value.planned_hours = normalizeDayDurationValue(Number(editForm.value.planned_hours) || 0.5);
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
    acknowledgeException,
    cancelScheduleConflict,
    canResetGanttWindow,
    canShowPreviousGanttWindow,
    closeExceptionModal,
    closeScheduleDrawer,
    closeTaskDetailModal,
    confirmScheduleConflict,
    conflictRows: filteredConflictRows,
    conflictSearch,
    editForm,
    editCustomStartMinTime,
    editWarning,
    exceptionActionLabel,
    exceptionModalOpen: exceptionModal.open,
    experimentOptions,
    ganttView,
    getDeviceScheduleNavigation,
    jumpDeviceSchedule,
    resetGanttWindow,
    showNextGanttWindow,
    showPreviousGanttWindow,
    manualLabOptions,
    manualTimeSlotOptions,
    openTaskDetailModal,
    openExceptionModal,
    openScheduleDrawer,
    pendingExceptionCount,
    pendingExceptionRows,
    removeSchedule,
    removeTaskDetailSchedule,
    rescheduleFromTaskDetail,
    saveSchedule,
    setEditDurationUnit,
    setScheduleDurationUnit,
    scheduleConflictDetail: scheduleConflictModal.payload,
    scheduleConflictOpen: scheduleConflictModal.open,
    scheduleDrawerOpen: scheduleDrawer.open,
    selectedTaskDetail,
    taskDetailModalOpen: taskDetailModal.open,
    taskScheduledOverlays,
    scheduleForm,
    scheduleCustomStartMinTime,
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
