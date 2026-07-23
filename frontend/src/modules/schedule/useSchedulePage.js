import { computed, onBeforeUnmount, onMounted, ref } from "vue";

import { useDialogState } from "@/composables/useDialogState";
import { useStorageSnapshot } from "@/composables/useStorageSnapshot";
import { normalizeAxisCodes } from "@/lib/axisCodes";
import { formatLocalDateTime } from "@/lib/dateTime";
import { serverNowDate } from "@/lib/serverClock";
import {
  analyzeTaskTrayConflict,
  buildConflictRows,
  buildGanttRows,
  buildLabOptions,
  buildScheduleEditForm,
  buildScheduleRescheduleForm,
  buildScheduleRows,
  buildSummaryCards,
  buildTaskScheduledOverlays,
  createScheduleEditForm,
  createScheduleRecord,
  deleteScheduleRecord,
  formatDateTime,
  isRetentionDevice,
  normalizeText,
  PLANNED_DURATION_MAX_DAYS,
  PLANNED_DURATION_MAX_HOURS,
  resolveScheduleTimes,
  STATUS_SCHEDULED,
  toLocalDateValue,
  updateScheduleRecord,
} from "./model";
import { filterActiveTasks } from "@/lib/taskArchive";
import { scheduleMatchesLab } from "@/lib/labIdentity";
import { readMasterLabs } from "@/lib/masterDataApi";
import { RUNNING_SCHEDULE_RESCHEDULE_MESSAGE } from "@/lib/runningExperimentGuards";
import { writeStorageSchedulePatch } from "@/lib/storageApi";
import { STORAGE_KEYS } from "@/lib/storageKeys";
import { useScheduleFormState } from "./useScheduleFormState";
import { useScheduleRealtime } from "./useScheduleRealtime";

function useSchedulePage() {
  const { loadSnapshot } = useStorageSnapshot([
    STORAGE_KEYS.conflicts,
    STORAGE_KEYS.devices,
    STORAGE_KEYS.experiments,
    STORAGE_KEYS.experiment_runs,
    STORAGE_KEYS.experiment_run_steps,
    STORAGE_KEYS.experiment_run_trays,
    STORAGE_KEYS.experiment_trays,
    STORAGE_KEYS.samples,
    STORAGE_KEYS.schedules,
    STORAGE_KEYS.streams,
    STORAGE_KEYS.tasks,
  ]);

  const rawDevices = ref([]);
  const rawConflicts = ref([]);
  const rawExperiments = ref([]);
  const rawExperimentRuns = ref([]);
  const rawExperimentRunSteps = ref([]);
  const rawExperimentRunTrays = ref([]);
  const rawExperimentTrays = ref([]);
  const rawSamples = ref([]);
  const rawSchedules = ref([]);
  const rawStreams = ref([]);
  const rawTasks = ref([]);
  const masterLabs = ref([]);
  const scheduleSearch = ref("");
  const conflictSearch = ref("");
  const now = ref(serverNowDate());
  const ganttWindowOffsetDays = ref(0);

  const scheduleDrawer = useDialogState();
  const taskDetailModal = useDialogState();
  const ganttOverflowModal = useDialogState();
  const scheduleConflictModal = useDialogState();
  const exceptionModal = useDialogState();
  const pendingScheduleDraft = ref(null);
  const ignoredStorageRequestIds = ref(new Set());
  let schedulePatchRequestSeq = 0;
  let clockTimer = null;

  const buildFailureMessage = (prefix, error) => {
    const detail = normalizeText(error instanceof Error ? error.message : "");
    return detail ? `${prefix}，${detail}` : prefix;
  };

  const buildSnapshotFallback = () => ({
    [STORAGE_KEYS.conflicts]: rawConflicts.value,
    [STORAGE_KEYS.devices]: rawDevices.value,
    [STORAGE_KEYS.experiments]: rawExperiments.value,
    [STORAGE_KEYS.experiment_trays]: rawExperimentTrays.value,
    [STORAGE_KEYS.experiment_run_steps]: rawExperimentRunSteps.value,
    [STORAGE_KEYS.samples]: rawSamples.value,
    [STORAGE_KEYS.schedules]: rawSchedules.value,
    [STORAGE_KEYS.streams]: rawStreams.value,
    [STORAGE_KEYS.tasks]: rawTasks.value,
  });

  const applySnapshotArray = (snapshot, key, target) => {
    if (Array.isArray(snapshot?.[key])) {
      target.value = snapshot[key];
    }
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

  const {
    buildLabOptionItems,
    editCustomStartMinTime,
    editForm,
    editWarning,
    experimentOptions,
    isScheduleAxisSelected,
    maintenanceLabNotice,
    manualLabOptionItems,
    manualLabOptions,
    manualTimeSlotOptions,
    resetScheduleForm,
    resetScheduleFormForTask,
    replaceScheduleForm,
    scheduleAxisCodes,
    scheduleAxisDisplayOptions,
    scheduleAxisOptions,
    scheduleAxisRequirementOptions,
    scheduleCompletedAxisOptions,
    scheduleCustomStartMinTime,
    scheduleForm,
    scheduleWarning,
    selectedAxisLabel,
    selectedExperimentOption,
    selectedTaskOption,
    setEditDurationUnit,
    setScheduleDurationUnit,
    showAxisSelector,
    syncLabIdentityToForm,
    syncManualScheduleLegality,
    taskOptions,
    toggleScheduleAxis,
  } = useScheduleFormState({
    activeSchedules,
    masterLabs,
    now,
    rawDevices,
    rawExperiments,
    rawExperimentRunSteps,
    rawExperimentTrays,
    rawSamples,
    rawTasks,
  });

  const normalizeScheduleAxisCodes = (schedule) =>
    normalizeAxisCodes(schedule?.axis_codes ?? schedule?.axisCodes);
  const uniqueTextList = (values) => {
    const seen = new Set();
    return (Array.isArray(values) ? values : [])
      .map(normalizeText)
      .filter((value) => {
        if (!value || seen.has(value)) {
          return false;
        }
        seen.add(value);
        return true;
      });
  };
  const formatMergedPlannedHours = (schedules) => {
    const values = (Array.isArray(schedules) ? schedules : []).map((schedule) => Number.parseFloat(schedule?.planned_hours));
    if (values.length > 0 && values.every((value) => Number.isFinite(value))) {
      return String(Math.round(values.reduce((sum, value) => sum + value, 0) * 100) / 100);
    }
    return uniqueTextList((Array.isArray(schedules) ? schedules : []).map((schedule) => schedule?.planned_hours)).join(" / ") || "-";
  };
  const findExperimentLabel = (experimentCode) =>
    normalizeText(
      rawExperiments.value.find((entry) => normalizeText(entry?.experiment_code) === normalizeText(experimentCode))?.experiment_name,
    );

  const scheduleRows = computed(() => buildScheduleRows({
    experimentTrays: rawExperimentTrays.value,
    experiments: rawExperiments.value,
    samples: rawSamples.value,
    schedules: activeSchedules.value,
    tasks: rawTasks.value,
    now: now.value,
  }));
  const conflictRows = computed(() =>
    buildConflictRows({
      experimentTrays: rawExperimentTrays.value,
      experiments: rawExperiments.value,
      samples: rawSamples.value,
      schedules: activeSchedules.value,
      tasks: rawTasks.value,
    }),
  );
  const pendingExceptionRows = computed(() =>
    rawConflicts.value.filter(
      (entry) => normalizeText(entry?.status) === "pending",
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
              scheduleMatchesLab(schedule, { code: normalizedDevice, name: normalizedDevice }) &&
              normalizeText(schedule?.status) === STATUS_SCHEDULED &&
              !isRetentionDevice(schedule),
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
      masterLabs: masterLabs.value,
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
      experiments: rawExperiments.value,
      now: now.value,
      samples: rawSamples.value,
      schedules: activeSchedules.value,
      tasks: rawTasks.value,
    }),
  );
  const selectedTaskDetail = computed(() => {
    const payload = taskDetailModal.payload.value || {};
    const scheduleId = normalizeText(payload?.id);
    const scheduleIds = uniqueTextList([
      ...(Array.isArray(payload?.ids) ? payload.ids : []),
      ...(Array.isArray(payload?.scheduleIds) ? payload.scheduleIds : []),
      scheduleId,
    ]);
    if (!scheduleId) {
      return null;
    }

    const schedules = rawSchedules.value
      .filter((entry) => scheduleIds.includes(normalizeText(entry?.id)))
      .sort((left, right) => String(left?.start_at || "").localeCompare(String(right?.start_at || "")));
    const schedule = schedules[0];
    if (!schedule || schedules.length === 0) {
      return null;
    }

    const task = rawTasks.value.find((entry) => normalizeText(entry?.code) === normalizeText(schedule?.task_code));
    const axisLabel = normalizeAxisCodes(uniqueTextList(schedules.flatMap(normalizeScheduleAxisCodes)))
      .map((code) => code.toUpperCase())
      .join(" / ");
    const startAt = schedules
      .map((entry) => normalizeText(entry?.start_at))
      .filter(Boolean)
      .sort()[0] || schedule?.start_at;
    const endAt = schedules
      .map((entry) => normalizeText(entry?.end_at))
      .filter(Boolean)
      .sort()
      .at(-1) || schedule?.end_at;
    const experimentCodes = uniqueTextList(schedules.map((entry) => entry?.experiment_code));
    const experimentLabels = uniqueTextList(experimentCodes.map(findExperimentLabel));
    // 详情弹窗只取排程与任务交集字段，避免把整条记录暴露给视图层。
    return {
      axisLabel: axisLabel || "-",
      code: normalizeText(schedule?.task_code),
      device: uniqueTextList(schedules.map((entry) => entry?.device)).join(" / ") || "-",
      estimatedEndAt: formatDateTime(endAt),
      experimentCode: experimentCodes.join(" / ") || "-",
      experimentLabel: experimentLabels.join(" / ") || "-",
      name: normalizeText(task?.name) || "-",
      plannedHours: formatMergedPlannedHours(schedules),
      priority: normalizeText(task?.priority) || "-",
      source: normalizeText(task?.source) || "-",
      scheduleId: normalizeText(schedule?.id),
      scheduleIds,
      startAt: formatDateTime(startAt),
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
      [row.taskCode, row.experimentCode, row.experimentLabel, row.axisLabel, row.device, row.startAt, row.endAt, row.rowStatus].some((value) =>
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
    const requestId = `schedule-page-${Date.now()}-${schedulePatchRequestSeq += 1}`;
    ignoredStorageRequestIds.value.add(requestId);
    try {
      await writeStorageSchedulePatch(buildSchedulePatch(updates), { source: "schedule-page", requestId });
    } finally {
      window.setTimeout(() => {
        ignoredStorageRequestIds.value.delete(requestId);
      }, 5000);
    }

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
  };

  const schedulePatchRowKey = (key, row) => {
    if (!row || typeof row !== "object") {
      return "";
    }
    if (key === STORAGE_KEYS.tasks) {
      return normalizeText(row.code || row.id);
    }
    if (key === STORAGE_KEYS.experiments) {
      return `${normalizeText(row.task_code || row.taskCode)}::${normalizeText(row.experiment_code || row.experimentCode)}`;
    }
    if (key === STORAGE_KEYS.schedules) {
      return normalizeText(row.id) || [
        normalizeText(row.task_code || row.taskCode),
        normalizeText(row.experiment_code || row.experimentCode),
        normalizeText(row.device),
      ].join("::");
    }
    return normalizeText(row.id);
  };

  const currentRowsForPatchKey = (key) => {
    if (key === STORAGE_KEYS.conflicts) {
      return rawConflicts.value;
    }
    if (key === STORAGE_KEYS.experiments) {
      return rawExperiments.value;
    }
    if (key === STORAGE_KEYS.schedules) {
      return rawSchedules.value;
    }
    if (key === STORAGE_KEYS.streams) {
      return rawStreams.value;
    }
    if (key === STORAGE_KEYS.tasks) {
      return rawTasks.value;
    }
    return [];
  };

  const buildSchedulePatch = (updates) => {
    const patch = { deletes: {}, upserts: {} };
    [STORAGE_KEYS.conflicts, STORAGE_KEYS.experiments, STORAGE_KEYS.schedules, STORAGE_KEYS.streams, STORAGE_KEYS.tasks].forEach((key) => {
      if (!Array.isArray(updates?.[key])) {
        return;
      }
      const currentRows = currentRowsForPatchKey(key);
      const currentByKey = new Map(
        (Array.isArray(currentRows) ? currentRows : [])
          .map((row) => [schedulePatchRowKey(key, row), row])
          .filter(([rowKey]) => rowKey),
      );
      const nextByKey = new Map(
        updates[key]
          .map((row) => [schedulePatchRowKey(key, row), row])
          .filter(([rowKey]) => rowKey),
      );
      const upserts = [];
      nextByKey.forEach((row, rowKey) => {
        if (JSON.stringify(currentByKey.get(rowKey) || null) !== JSON.stringify(row)) {
          upserts.push(row);
        }
      });
      const deletes = [...currentByKey.keys()].filter((rowKey) => !nextByKey.has(rowKey));
      if (upserts.length > 0) {
        patch.upserts[key] = upserts;
      }
      if (deletes.length > 0) {
        patch.deletes[key] = deletes;
      }
    });
    return patch;
  };

  const openExceptionModal = () => {
    exceptionModal.openWith();
  };

  const closeExceptionModal = () => {
    exceptionModal.close();
    flushPendingRealtimeRefresh();
  };

  const syncRetentionClock = () => {
    // 页面上的当前时间、留样默认时间和合法性检查都跟随秒级时钟更新。
    now.value = serverNowDate();
    syncManualScheduleLegality();
  };

  const submitSchedule = async () => {
    syncLabIdentityToForm(scheduleForm.value, manualLabOptionItems.value);
    if (showAxisSelector.value && scheduleAxisCodes.value.length === 0) {
      scheduleWarning.value = "请选择轴向";
      return;
    }
    const candidate = {
      device: normalizeText(scheduleForm.value.device),
      experiment_code: normalizeText(scheduleForm.value.experiment_code),
      lab_code: normalizeText(scheduleForm.value.lab_code),
      lab_id: scheduleForm.value.lab_id,
      task_code: normalizeText(scheduleForm.value.task_code),
    };
    const resolved = resolveScheduleTimes(scheduleForm.value, now.value, activeSchedules.value);
    if (!resolved.error) {
      candidate.start_at = formatLocalDateTime(resolved.startAt);
      candidate.end_at = formatLocalDateTime(resolved.endAt);
      candidate.planned_hours = resolved.plannedHours;
      const taskConflict = analyzeTaskTrayConflict({
        candidate,
        experimentTrays: rawExperimentTrays.value,
        experiments: rawExperiments.value,
        samples: rawSamples.value,
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
      devices: rawDevices.value,
      experiments: rawExperiments.value,
      experimentRunSteps: rawExperimentRunSteps.value,
      experimentTrays: rawExperimentTrays.value,
      form: scheduleForm.value,
      now: now.value,
      samples: rawSamples.value,
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
    try {
      await persistAll({
        [STORAGE_KEYS.experiments]: result.experiments,
        [STORAGE_KEYS.schedules]: result.schedules,
        [STORAGE_KEYS.streams]: result.streams,
        [STORAGE_KEYS.tasks]: result.tasks,
      });
    } catch (error) {
      scheduleWarning.value = buildFailureMessage("排程保存失败，请稍后重试", error);
      return;
    }
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
    syncLabIdentityToForm(draft, buildLabOptionItems({
      options: buildLabOptions({
        masterLabs: masterLabs.value,
        selectedDevice: normalizeText(draft.device),
        testType: selectedExperimentOption.value?.requiredDevice || selectedTaskOption.value?.testType || "",
      }),
      selectedDevice: normalizeText(draft.device),
    }));

    const result = createScheduleRecord({
      devices: rawDevices.value,
      experiments: rawExperiments.value,
      experimentRunSteps: rawExperimentRunSteps.value,
      experimentTrays: rawExperimentTrays.value,
      form: draft,
      now: now.value,
      samples: rawSamples.value,
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
    try {
      await persistAll({
        [STORAGE_KEYS.experiments]: result.experiments,
        [STORAGE_KEYS.schedules]: result.schedules,
        [STORAGE_KEYS.streams]: result.streams,
        [STORAGE_KEYS.tasks]: result.tasks,
      });
    } catch (error) {
      scheduleWarning.value = buildFailureMessage("排程保存失败，请稍后重试", error);
      return;
    }
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
    flushPendingRealtimeRefresh();
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
    flushPendingRealtimeRefresh();
  };

  const openTaskDetailModal = (scheduleId, scheduleIds = []) => {
    const normalizedScheduleIds = uniqueTextList([
      ...(Array.isArray(scheduleIds) ? scheduleIds : []),
      scheduleId,
    ]);
    const schedule = rawSchedules.value.find((entry) => normalizedScheduleIds.includes(normalizeText(entry?.id)));
    if (!schedule) {
      return;
    }
    editWarning.value = "";
    taskDetailModal.openWith({ id: normalizeText(scheduleId) || normalizedScheduleIds[0], ids: normalizedScheduleIds });
  };

  const openGanttOverflowModal = (segment) => {
    const items = Array.isArray(segment?.allItems) ? segment.allItems : Array.isArray(segment?.items) ? segment.items : [];
    if (items.length === 0) {
      return;
    }
    ganttOverflowModal.openWith({
      items,
      title: normalizeText(segment?.title),
    });
  };

  const closeGanttOverflowModal = () => {
    ganttOverflowModal.close();
  };

  const openGanttOverflowTask = (scheduleId, scheduleIds = []) => {
    closeGanttOverflowModal();
    openTaskDetailModal(scheduleId, scheduleIds);
  };

  const closeTaskDetailModal = () => {
    taskDetailModal.close();
    flushPendingRealtimeRefresh();
  };

  const saveSchedule = async () => {
    syncLabIdentityToForm(editForm.value, buildEditLabOptionItems(editForm.value.device, editForm.value.task_code));
    const result = updateScheduleRecord({
      devices: rawDevices.value,
      experiments: rawExperiments.value,
      experimentRuns: rawExperimentRuns.value,
      experimentRunSteps: rawExperimentRunSteps.value,
      experimentRunTrays: rawExperimentRunTrays.value,
      experimentTrays: rawExperimentTrays.value,
      form: editForm.value,
      now: now.value,
      samples: rawSamples.value,
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
      experimentRuns: rawExperimentRuns.value,
      experimentRunSteps: rawExperimentRunSteps.value,
      experimentRunTrays: rawExperimentRunTrays.value,
      experimentTrays: rawExperimentTrays.value,
      experiments: rawExperiments.value,
      now: now.value,
      samples: rawSamples.value,
      scheduleId: editForm.value.id,
      schedules: rawSchedules.value,
      streams: rawStreams.value,
      tasks: rawTasks.value,
    });
    if (result.error) {
      editWarning.value = result.error;
      return;
    }
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
      experimentRuns: rawExperimentRuns.value,
      experimentRunSteps: rawExperimentRunSteps.value,
      experimentRunTrays: rawExperimentRunTrays.value,
      experimentTrays: rawExperimentTrays.value,
      experiments: rawExperiments.value,
      now: now.value,
      samples: rawSamples.value,
      scheduleId,
      schedules: rawSchedules.value,
      streams: rawStreams.value,
      tasks: rawTasks.value,
    });
    if (result.error) {
      editWarning.value = result.error;
      return;
    }
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
      experimentRuns: rawExperimentRuns.value,
      experimentRunSteps: rawExperimentRunSteps.value,
      experimentRunTrays: rawExperimentRunTrays.value,
      experimentTrays: rawExperimentTrays.value,
      experiments: rawExperiments.value,
      now: now.value,
      samples: rawSamples.value,
      scheduleId,
      schedules: rawSchedules.value,
      streams: rawStreams.value,
      tasks: rawTasks.value,
    });
    if (result.error) {
      editWarning.value = RUNNING_SCHEDULE_RESCHEDULE_MESSAGE;
      return;
    }
    await persistAll({
      [STORAGE_KEYS.experiments]: result.experiments,
      [STORAGE_KEYS.schedules]: result.schedules,
      [STORAGE_KEYS.streams]: result.streams,
      [STORAGE_KEYS.tasks]: result.tasks,
    });
    await replaceScheduleForm(buildScheduleRescheduleForm(schedule, now.value));
    scheduleWarning.value = "";
    closeTaskDetailModal();
  };

  const loadSchedulePage = async ({ resetForm: shouldResetForm = true } = {}) => {
    try {
      const [snapshot, loadedMasterLabs] = await Promise.all([
        loadSnapshot({ fallbackSnapshot: buildSnapshotFallback(), reconcileScheduleExceptions: true }),
        readMasterLabs().catch(() => []),
      ]);
      masterLabs.value = Array.isArray(loadedMasterLabs) ? loadedMasterLabs : [];
      applySnapshotArray(snapshot, STORAGE_KEYS.conflicts, rawConflicts);
      applySnapshotArray(snapshot, STORAGE_KEYS.devices, rawDevices);
      applySnapshotArray(snapshot, STORAGE_KEYS.experiments, rawExperiments);
      applySnapshotArray(snapshot, STORAGE_KEYS.experiment_runs, rawExperimentRuns);
      applySnapshotArray(snapshot, STORAGE_KEYS.experiment_run_steps, rawExperimentRunSteps);
      applySnapshotArray(snapshot, STORAGE_KEYS.experiment_run_trays, rawExperimentRunTrays);
      applySnapshotArray(snapshot, STORAGE_KEYS.experiment_trays, rawExperimentTrays);
      applySnapshotArray(snapshot, STORAGE_KEYS.samples, rawSamples);
      applySnapshotArray(snapshot, STORAGE_KEYS.schedules, rawSchedules);
      applySnapshotArray(snapshot, STORAGE_KEYS.streams, rawStreams);
      applySnapshotArray(snapshot, STORAGE_KEYS.tasks, rawTasks);
      if (shouldResetForm) {
        resetScheduleForm();
      }
    } catch (error) {
      masterLabs.value = [];
      scheduleWarning.value = buildFailureMessage("排程数据加载失败，请稍后重试", error);
    }
  };

  const { flushPendingRealtimeRefresh } = useScheduleRealtime({
    exceptionModal,
    ignoredStorageRequestIds,
    loadSchedulePage,
    scheduleConflictModal,
    scheduleDrawer,
    taskDetailModal,
  });

  const acknowledgeException = async (conflictId) => {
    const normalizedConflictId = normalizeText(conflictId);
    if (!normalizedConflictId) {
      return;
    }
    const timestamp = formatLocalDateTime();
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
      masterLabs: masterLabs.value,
      selectedDevice,
      testType: normalizeText(experiment?.required_device) || normalizeText(task?.test_type),
    });
  };
  const buildEditLabOptionItems = (selectedDevice, taskCode) =>
    buildLabOptionItems({
      options: buildEditLabOptions(selectedDevice, taskCode),
      selectedDevice,
    });

  return {
    buildEditLabOptions,
    buildEditLabOptionItems,
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
    ganttOverflowDetail: ganttOverflowModal.payload,
    ganttOverflowOpen: ganttOverflowModal.open,
    getDeviceScheduleNavigation,
    jumpDeviceSchedule,
    resetGanttWindow,
    showNextGanttWindow,
    showPreviousGanttWindow,
    manualLabOptions,
    manualLabOptionItems,
    manualTimeSlotOptions,
    openTaskDetailModal,
    openExceptionModal,
    openGanttOverflowModal,
    openGanttOverflowTask,
    openScheduleDrawer,
    pendingExceptionCount,
    pendingExceptionRows,
    PLANNED_DURATION_MAX_DAYS,
    PLANNED_DURATION_MAX_HOURS,
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
    scheduleAxisRequirementOptions,
    scheduleCompletedAxisOptions,
    scheduleAxisOptions,
    scheduleAxisDisplayOptions,
    isScheduleAxisSelected,
    maintenanceLabNotice,
    selectedSchedule: scheduleDrawer.payload,
    submitSchedule,
    summaryCards,
    taskOptions,
    selectedAxisLabel,
    showAxisSelector,
    toggleScheduleAxis,
    closeGanttOverflowModal,
    resetScheduleForm,
  };
}

export { useSchedulePage };
