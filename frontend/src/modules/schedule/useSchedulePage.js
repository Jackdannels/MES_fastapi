// 负责排程表单、看板状态、甘特行数据和持久化流程。
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";

import { useDialogState } from "@/composables/useDialogState";
import { useStorageSnapshot } from "@/composables/useStorageSnapshot";
import { useStorageSnapshotRefresh } from "@/composables/useStorageSnapshotRefresh";
import { normalizeAxisCodes } from "@/lib/axisCodes";
import { formatLocalDateTime } from "@/lib/dateTime";
import {
  analyzeTaskTrayConflict,
  AXIS_CODE_OPTIONS,
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
  isDeviceUnavailableForSchedule,
  normalizeText,
  resolveDeviceUnavailableReason,
  isManualScheduleSelectionLegal,
  PLANNED_DURATION_MAX_DAYS,
  PLANNED_DURATION_MAX_HOURS,
  resolveLegalManualScheduleState,
  resolveAxisScheduleDeviceLock,
  resolveScheduleTimes,
  STATUS_SCHEDULED,
  toLocalDateValue,
  toLocalTimeValue,
  updateScheduleRecord,
} from "./model";
import { filterActiveTasks } from "@/lib/taskArchive";
import { scheduleMatchesLab } from "@/lib/labIdentity";
import { readMasterLabs } from "@/lib/masterDataApi";
import { RUNNING_SCHEDULE_RESCHEDULE_MESSAGE } from "@/lib/runningExperimentGuards";
import { writeStorageSchedulePatch } from "@/lib/storageApi";
import { STORAGE_KEYS } from "@/lib/storageKeys";
import { SAMPLES_UPDATED_EVENT } from "@/modules/samples/sampleEvents";

// 统一管理创建、编辑和查看排程记录所需的响应式状态。

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
  const ganttOverflowModal = useDialogState();
  const scheduleConflictModal = useDialogState();
  const exceptionModal = useDialogState();
  const pendingScheduleDraft = ref(null);
  const scheduleFormWatchSuspended = ref(false);
  const ignoredStorageRequestIds = ref(new Set());
  let schedulePatchRequestSeq = 0;
  let clockTimer = null;
  let flushPendingStorageRefresh = () => false;
  let hasPendingSamplesRefresh = false;

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

  const taskOptions = computed(() =>
    buildManualTaskOptions({
      experiments: rawExperiments.value,
      experimentRunSteps: rawExperimentRunSteps.value,
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
      experimentRunSteps: rawExperimentRunSteps.value,
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
  const axisOptionByCode = new Map(AXIS_CODE_OPTIONS.map((option) => [option.code, option]));
  const buildScheduleAxisOption = (axisCode) => {
    const normalizedAxisCode = normalizeText(axisCode).toLowerCase();
    return axisOptionByCode.get(normalizedAxisCode) || {
      code: normalizedAxisCode,
      label: normalizedAxisCode.toUpperCase(),
      testId: normalizedAxisCode.replace("+", "plus").replace("-", "minus"),
    };
  };
  const scheduleAxisRequirementOptions = computed(() => {
    const axisCodes = normalizeAxisCodes(selectedExperimentOption.value?.axisCodes);
    return axisCodes.map(buildScheduleAxisOption);
  });
  const scheduleCompletedAxisOptions = computed(() => {
    const completedAxisCodes = normalizeAxisCodes(selectedExperimentOption.value?.completedAxisCodes);
    return completedAxisCodes.map(buildScheduleAxisOption);
  });
  const scheduleAxisOptions = computed(() => {
    const remainingAxisCodes = normalizeAxisCodes(selectedExperimentOption.value?.remainingAxisCodes);
    return remainingAxisCodes.map(buildScheduleAxisOption);
  });
  const scheduleAxisCodes = computed(() => {
    return normalizeAxisCodes(scheduleForm.value.axis_codes);
  });
  const scheduleAxisDisplayOptions = computed(() => scheduleAxisCodes.value.map(buildScheduleAxisOption));
  const showAxisSelector = computed(() =>
    Boolean(
      selectedExperimentOption.value?.supportsAxisScheduling &&
      (scheduleAxisRequirementOptions.value.length > 0 || scheduleAxisOptions.value.length > 0),
    ),
  );
  const lockedAxisScheduleDevice = computed(() =>
    resolveAxisScheduleDeviceLock({
      experimentCode: scheduleForm.value.experiment_code,
      experiments: rawExperiments.value,
      form: scheduleForm.value,
      schedules: activeSchedules.value,
    }),
  );
  const selectedAxisLabel = computed(() =>
    scheduleAxisCodes.value
      .map((code) => normalizeText(code).toUpperCase())
      .filter(Boolean)
      .join(" / "),
  );
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

  const findDevice = (deviceCode) =>
    rawDevices.value.find((entry) => normalizeText(entry?.code) === normalizeText(deviceCode));
  const resolveMasterLabName = (lab) =>
    normalizeText(lab?.name || lab?.labName || lab?.lab_name || lab?.code || lab?.labCode || lab?.lab_code);
  const resolveMasterLabCode = (lab) => normalizeText(lab?.code || lab?.labCode || lab?.lab_code);
  const resolveMasterLabId = (lab) => lab?.lab_id ?? lab?.labId ?? lab?.id ?? "";
  const findMasterLabByOptionValue = (value) => {
    const normalizedValue = normalizeText(value);
    if (!normalizedValue) {
      return null;
    }
    return (
      masterLabs.value.find((lab) => {
        const labName = resolveMasterLabName(lab);
        const labCode = resolveMasterLabCode(lab);
        return labName === normalizedValue || labCode === normalizedValue;
      }) || null
    );
  };
  const buildLabIdentity = (value) => {
    const lab = findMasterLabByOptionValue(value);
    return {
      lab_code: resolveMasterLabCode(lab),
      lab_id: resolveMasterLabId(lab),
    };
  };
  const syncLabIdentityToForm = (form, optionItems = []) => {
    const selectedDevice = normalizeText(form?.device);
    if (!form || !selectedDevice) {
      if (form) {
        form.lab_code = "";
        form.lab_id = "";
      }
      return;
    }
    const option = (Array.isArray(optionItems) ? optionItems : [])
      .find((entry) => normalizeText(entry?.value) === selectedDevice);
    const identity = option || buildLabIdentity(selectedDevice);
    form.lab_code = normalizeText(identity?.lab_code ?? identity?.labCode);
    form.lab_id = identity?.lab_id ?? identity?.labId ?? "";
  };
  const buildUnavailableLabTitle = (deviceCode, device) => {
    const name = normalizeText(deviceCode);
    if (!name || !isDeviceUnavailableForSchedule(device, now.value)) {
      return "";
    }
    const reason = resolveDeviceUnavailableReason(device, now.value);
    if (reason === "disabled") {
      return `${name}已停用，暂不可排程`;
    }
    if (reason === "unavailable") {
      return `${name}不可用，暂不可排程`;
    }
    const startAt = normalizeText(device?.maintenance_start_at ?? device?.maintenanceStartAt);
    const endAt = normalizeText(device?.maintenance_end_at ?? device?.maintenanceEndAt);
    const range = startAt || endAt ? `（${formatDateTime(startAt)} - ${formatDateTime(endAt)}）` : "";
    return `${name}维护中，暂不可排程${range}`;
  };
  const buildLabOptionItems = ({ options, selectedDevice = "" }) =>
    (Array.isArray(options) ? options : []).map((option) => {
      const value = normalizeText(option);
      const device = findDevice(value);
      const disabled = normalizeText(selectedDevice) !== value && isDeviceUnavailableForSchedule(device, now.value);
      const title = disabled ? buildUnavailableLabTitle(value, device) : "";
      const identity = buildLabIdentity(value);
      return {
        disabled,
        label: value,
        lab_code: identity.lab_code,
        lab_id: identity.lab_id,
        title,
        value,
      };
    });
  const buildMaintenanceLabNotice = (options = []) => {
    const disabledOptions = (Array.isArray(options) ? options : [])
      .filter((option) => option?.disabled && normalizeText(option?.title));
    if (disabledOptions.length === 0) {
      return "";
    }
    if (disabledOptions.length === 1) {
      return normalizeText(disabledOptions[0]?.title);
    }
    const groupedBySuffix = [];
    disabledOptions.forEach((option) => {
      const label = normalizeText(option?.label);
      const title = normalizeText(option?.title);
      const suffix = label && title.startsWith(label) ? title.slice(label.length) : "";
      if (!suffix) {
        groupedBySuffix.push({ raw: title });
        return;
      }
      const group = groupedBySuffix.find((entry) => entry.suffix === suffix);
      if (group) {
        group.labels.push(label);
        return;
      }
      groupedBySuffix.push({ labels: [label], suffix });
    });
    return groupedBySuffix
      .map((group) => group.raw || `${group.labels.join("、")}${group.suffix}`)
      .join("；");
  };

  // 可选实验室由当前页签、任务试验类型以及已选设备共同决定。
  const manualLabOptionItems = computed(() =>
    buildLabOptionItems({
      options: buildLabOptions({
        masterLabs: masterLabs.value,
        selectedDevice: normalizeText(scheduleForm.value.device),
        testType: selectedExperimentOption.value?.requiredDevice || selectedTaskOption.value?.testType || "",
      }).filter((option) => !lockedAxisScheduleDevice.value || normalizeText(option) === lockedAxisScheduleDevice.value),
      selectedDevice: normalizeText(scheduleForm.value.device),
    }),
  );
  const manualLabOptions = computed(() =>
    manualLabOptionItems.value.filter((option) => !option.disabled).map((option) => option.value),
  );
  const maintenanceLabNotice = computed(() =>
    buildMaintenanceLabNotice(manualLabOptionItems.value),
  );
  const manualTimeSlotOptions = computed(() =>
    buildManualTimeSlotOptions({
      device: scheduleForm.value.device,
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

  const resetScheduleForm = () => {
    scheduleForm.value = createManualScheduleForm(now.value);
    scheduleWarning.value = "";
  };

  const clearScheduleAxes = () => {
    scheduleForm.value.axis_codes = [];
    scheduleForm.value.axis_batch_no = "";
  };

  const toggleScheduleAxis = (axisCode) => {
    const normalizedAxisCode = normalizeText(axisCode).toLowerCase();
    if (!normalizedAxisCode) {
      return;
    }
    const selectableAxisCodes = new Set(scheduleAxisOptions.value.map((option) => option.code));
    if (!selectableAxisCodes.has(normalizedAxisCode)) {
      return;
    }
    const selected = new Set(scheduleAxisCodes.value);
    if (selected.has(normalizedAxisCode)) {
      selected.delete(normalizedAxisCode);
    } else {
      selected.add(normalizedAxisCode);
    }
    scheduleForm.value.axis_codes = scheduleAxisOptions.value
      .map((option) => option.code)
      .filter((code) => selected.has(code));
    scheduleWarning.value = "";
  };

  const isScheduleAxisSelected = (axisCode) => scheduleAxisCodes.value.includes(normalizeText(axisCode).toLowerCase());

  const openExceptionModal = () => {
    exceptionModal.openWith();
  };

  const closeExceptionModal = () => {
    exceptionModal.close();
    flushPendingRealtimeRefresh();
  };

  const replaceScheduleForm = async (nextForm) => {
    scheduleFormWatchSuspended.value = true;
    scheduleForm.value = nextForm;
    await nextTick();
    scheduleFormWatchSuspended.value = false;
  };

  const normalizeDurationValue = (value, fallback, unit = "hours") => {
    const parsed = Number.parseFloat(String(value ?? "").trim());
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return fallback;
    }
    const max = unit === "days" ? PLANNED_DURATION_MAX_DAYS : PLANNED_DURATION_MAX_HOURS;
    return Math.min(parsed, max);
  };

  const normalizeDayDurationValue = (value) => {
    return Math.min(PLANNED_DURATION_MAX_DAYS, Math.max(0.5, Math.round(value * 2) / 2));
  };

  const normalizeHourDurationValue = (value) => {
    return Math.min(PLANNED_DURATION_MAX_HOURS, Math.max(0.5, Math.round(value * 2) / 2));
  };

  const clampFormDurationValue = (form) => {
    const unit = normalizeText(form?.planned_duration_unit) || "hours";
    const max = unit === "days" ? PLANNED_DURATION_MAX_DAYS : PLANNED_DURATION_MAX_HOURS;
    const parsed = Number.parseFloat(String(form?.planned_hours ?? "").trim());
    if (Number.isFinite(parsed) && parsed > max) {
      form.planned_hours = max;
    }
  };

  const setDurationUnit = (formRef, nextUnit) => {
    const form = formRef.value;
    const currentUnit = normalizeText(form?.planned_duration_unit) || "hours";
    if (currentUnit === nextUnit) {
      return;
    }
    const currentValue = normalizeDurationValue(form?.planned_hours, currentUnit === "days" ? 0.5 : 3.5, currentUnit);
    form.planned_duration_unit = nextUnit;
    if (nextUnit === "days") {
      form.planned_hours = normalizeDayDurationValue(Math.ceil(currentValue / 12) / 2);
      return;
    }
    form.planned_hours = normalizeHourDurationValue(currentValue * 24);
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
        experimentRunSteps: rawExperimentRunSteps.value,
        samples: rawSamples.value,
        schedules,
        tasks: rawTasks.value,
      })[0]?.code || "";

    await replaceScheduleForm({
      ...baseForm,
      experiment_code: nextExperimentCode,
      task_code: taskCode,
    });
    clearScheduleAxes();
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
    await replaceScheduleForm(buildScheduleRescheduleForm(schedule));
    scheduleWarning.value = "";
    closeTaskDetailModal();
  };

  const loadSchedulePage = async ({ resetForm: shouldResetForm = true } = {}) => {
    try {
      const [snapshot, loadedMasterLabs] = await Promise.all([
        loadSnapshot({ fallbackSnapshot: buildSnapshotFallback() }),
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

  const refreshSchedulePageWithoutReset = () => {
    void loadSchedulePage({ resetForm: false });
  };

  const isRealtimeRefreshPaused = () => Boolean(
    scheduleDrawer.open.value
    || taskDetailModal.open.value
    || scheduleConflictModal.open.value
    || exceptionModal.open.value
  );

  const flushPendingRealtimeRefresh = () => {
    const flushedStorage = flushPendingStorageRefresh();
    if (!hasPendingSamplesRefresh || isRealtimeRefreshPaused()) {
      return flushedStorage;
    }
    hasPendingSamplesRefresh = false;
    if (!flushedStorage) {
      refreshSchedulePageWithoutReset();
    }
    return true;
  };

  const handleSamplesUpdated = () => {
    if (isRealtimeRefreshPaused()) {
      hasPendingSamplesRefresh = true;
      return;
    }
    hasPendingSamplesRefresh = false;
    refreshSchedulePageWithoutReset();
  };

  const storageRefresh = useStorageSnapshotRefresh({
    keys: [
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
    ],
    refresh: () => loadSchedulePage({ resetForm: false }),
    paused: isRealtimeRefreshPaused,
    debounceMs: 100,
    ignoreSource: "schedule-page",
    ignoreRequestIds: () => ignoredStorageRequestIds.value,
  });
  flushPendingStorageRefresh = storageRefresh.flushPendingRefresh;

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

  watch(
    () => scheduleForm.value.task_code,
    () => {
      if (scheduleFormWatchSuspended.value) {
        return;
      }
      const firstExperimentCode = experimentOptions.value[0]?.code || "";
      scheduleForm.value.experiment_code = firstExperimentCode;
      scheduleForm.value.device = "";
      scheduleForm.value.lab_code = "";
      scheduleForm.value.lab_id = "";
      clearScheduleAxes();
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
      scheduleForm.value.lab_code = "";
      scheduleForm.value.lab_id = "";
      clearScheduleAxes();
      scheduleWarning.value = "";
    },
  );

  watch(
    () => scheduleAxisOptions.value.map((option) => option.code).join("\u0001"),
    () => {
      if (scheduleFormWatchSuspended.value) {
        return;
      }
      clearScheduleAxes();
    },
    { immediate: true },
  );

  const syncAutoSelectedScheduleDevice = () => {
    if (scheduleFormWatchSuspended.value) {
      return;
    }
    const availableLabs = manualLabOptionItems.value
      .filter((option) => !option.disabled)
      .filter((option) => normalizeText(option?.value));
    const currentDevice = normalizeText(scheduleForm.value.device);
    if (currentDevice && availableLabs.some((option) => normalizeText(option.value) === currentDevice)) {
      return;
    }
    if (availableLabs.length === 1) {
      scheduleForm.value.device = normalizeText(availableLabs[0].value);
      syncLabIdentityToForm(scheduleForm.value, availableLabs);
      return;
    }
    if (currentDevice) {
      scheduleForm.value.device = "";
      scheduleForm.value.lab_code = "";
      scheduleForm.value.lab_id = "";
    }
  };

  watch(
    () => [scheduleForm.value.experiment_code, manualLabOptions.value.join("\u0001")],
    syncAutoSelectedScheduleDevice,
  );

  watch(
    () => scheduleForm.value.device,
    () => {
      syncLabIdentityToForm(scheduleForm.value, manualLabOptionItems.value);
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
    () => {
      clampFormDurationValue(scheduleForm.value);
    },
  );

  watch(
    () => scheduleForm.value.planned_hours,
    () => {
      clampFormDurationValue(scheduleForm.value);
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
    () => {
      clampFormDurationValue(editForm.value);
    },
  );

  watch(
    () => editForm.value.planned_hours,
    () => {
      clampFormDurationValue(editForm.value);
    },
  );

  onMounted(() => {
    void loadSchedulePage();
    clockTimer = window.setInterval(syncRetentionClock, 1000);
    window.addEventListener(SAMPLES_UPDATED_EVENT, handleSamplesUpdated);
  });

  onBeforeUnmount(() => {
    if (clockTimer) {
      window.clearInterval(clockTimer);
    }
    window.removeEventListener(SAMPLES_UPDATED_EVENT, handleSamplesUpdated);
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
