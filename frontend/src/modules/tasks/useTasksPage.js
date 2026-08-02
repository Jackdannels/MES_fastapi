// 负责任务受理页的新增、筛选、编辑和持久化流程。
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { serverNowDate, serverNowMs } from "@/lib/serverClock";
import { useRoute } from "vue-router";

import { useDialogState } from "@/composables/useDialogState";
import { buildExperimentTypeOptions, buildExperimentTypeSummary, collectExperimentTypes } from "@/lib/experimentTypes";
import { formatLocalDateTime, parseBusinessDateTimeToMs } from "@/lib/dateTime";
import { TEST_PREFIX_MAP } from "@/lib/labs";
import { readMasterTestTypes } from "@/lib/masterDataApi";
import { notifyStorageSnapshotUpdated } from "@/lib/storageApi";
import {
  acceptExternalTaskIntake as acceptExternalTaskIntakeByApi,
  createTask,
  readExternalTaskIntakes,
  readNextTaskCode,
  readTaskDetail,
  readTaskPage,
  resetTasks as resetTasksByApi,
} from "@/lib/tasksApi";
import {
  buildTaskCode,
  buildTaskEditForm,
  buildExperimentTypeAxisSummary,
  buildTaskRows,
  buildTaskSampleCodes,
  DEFAULT_AXIS_CODES,
  STATUS_COMPLETED,
  STATUS_RUNNING,
  createTaskEditForm,
  createTaskIntakeForm,
  createTaskRecord,
  formatAxisCodeLabel,
  normalizeAxisCodesByTestType,
  normalizeText,
  normalizeTaskSampleCount,
  validateTaskSampleCount,
  validateTaskTextFields,
} from "./model";
import { useTasksTableView } from "./useTasksTableView";
import { useTaskExperimentPickers } from "./useTaskExperimentPickers";
import { useTasksRealtime } from "./useTasksRealtime";
import { useTaskMutationWorkflow } from "./useTaskMutationWorkflow";

const TASK_INTAKE_HASH = "#task-intake-modal";
const TASK_RESET_EVENT = "mes:open-task-reset";
const EXTERNAL_TASK_INTAKE_EVENT = "mes:open-external-task-intake";
const RESET_FEEDBACK_DISMISS_MS = 10000;

const taskCodeOf = (task) => normalizeText(task?.task_code || task?.code || task?.taskNo || task?.id);
const isStorageConfirmedStatus = (value) => normalizeText(value) === "到货";

const taskStorageConfirmed = (task, samples) => {
  const taskCode = taskCodeOf(task);
  if (isStorageConfirmedStatus(task?.transfer_status || task?.transferStatus)) {
    return true;
  }
  return (Array.isArray(samples) ? samples : []).some((sample) => {
    if (taskCodeOf(sample) !== taskCode) {
      return false;
    }
    if (isStorageConfirmedStatus(sample?.status) || isStorageConfirmedStatus(sample?.flow_status)) {
      return true;
    }
    return (Array.isArray(sample?.trays) ? sample.trays : []).some((tray) =>
      isStorageConfirmedStatus(tray?.status || tray?.tray_status || tray?.trayStatus),
    );
  });
};

const taskHasSavedAllocation = (task, samples) => {
  if ((Array.isArray(task?.tray_codes) ? task.tray_codes : []).some((trayCode) => normalizeText(trayCode))) {
    return true;
  }
  const taskCode = taskCodeOf(task);
  const taskSamples = (Array.isArray(samples) ? samples : []).filter((sample) => taskCodeOf(sample) === taskCode);
  return taskSamples.length > 0
    && taskSamples.every((sample) => Array.isArray(sample?.trays) && sample.trays.length > 0);
};

const taskSampleCountLocked = (task, samples) => (
  taskStorageConfirmed(task, samples) || taskHasSavedAllocation(task, samples)
);

// 将存储快照与弹窗、抽屉、表格状态连接起来，供任务页统一使用。
function useTasksPage() {
  const route = useRoute();

  const rawTasks = ref([]);
  const rawExternalTaskIntakes = ref([]);
  const rawSchedules = ref([]);
  const rawSamples = ref([]);
  const rawStreams = ref([]);
  const rawExperiments = ref([]);
  const rawExperimentTrays = ref([]);
  const rawExperimentSamples = ref([]);
  const rawExperimentRuns = ref([]);
  const rawExperimentRunTrays = ref([]);
  const masterTestTypes = ref([]);
  const loadError = ref("");
  const resetFeedback = ref("");
  const resetError = ref("");
  const resetting = ref(false);
  const acceptingExternalTask = ref(false);
  const externalAcceptanceError = ref("");
  const selectedExternalTaskIntake = ref(null);
  const intakeForm = ref(createTaskIntakeForm());
  const editForm = ref(createTaskEditForm());
  const intakeWarning = ref("");
  const intakeDueAtMin = ref("");
  const editDueAtMin = ref("");
  const editWarning = ref("");
  const sampleCodesDraft = ref("");
  const sampleCodesWarning = ref("");
  const intakeExperimentDraft = ref([]);
  const intakeAxisDraftByTestType = ref({});
  const intakeAxisPickerType = ref("");
  const intakeAxisPickerCodes = ref([]);
  const editExperimentDraft = ref([]);
  const editAxisDraftByTestType = ref({});
  const editAxisPickerType = ref("");
  const editAxisPickerCodes = ref([]);
  const scheduledExperimentRemovalDraft = ref(null);
  const savedIntakeDraft = ref(null);
  const selectedTestType = ref("");
  const selectedStatus = ref("");
  const taskServerMetrics = ref({});
  const taskServerPageCount = ref(1);
  const taskServerStatusOptions = ref([]);
  const taskServerTestTypeOptions = ref([]);

  const intakeModal = useDialogState();
  const intakeExperimentModal = useDialogState();
  const intakeAxisModal = useDialogState();
  const editExperimentModal = useDialogState();
  const editAxisModal = useDialogState();
  const sampleCodesModal = useDialogState();
  const scheduledExperimentRemovalModal = useDialogState();
  const resetModal = useDialogState();
  const externalAcceptanceModal = useDialogState();
  const taskDrawer = useDialogState();
  let resetFeedbackTimer = null;
  let nextTaskCodeRequest = 0;
  const nextTaskCodeCache = new Map();
  let taskSearchRefreshTimer = 0;
  let queryPageResetPending = false;
  let taskDetailRequest = 0;
  let taskScopeRequest = 0;
  let taskPageRequest = 0;

  const {
    currentPage,
    externalTaskIntakeRows,
    metrics,
    pageCount,
    query,
    scopedStatusOptions,
    setCurrentPage,
    sortDirection,
    sortKey,
    testTypeOptions,
    toggleSort,
    visibleRows,
  } = useTasksTableView({
    rawExperiments,
    rawExternalTaskIntakes,
    rawSamples,
    rawSchedules,
    rawTasks,
    serverMetrics: taskServerMetrics,
    serverPageCount: taskServerPageCount,
    serverPagination: true,
    serverStatusOptions: taskServerStatusOptions,
    serverTestTypeOptions: taskServerTestTypeOptions,
    selectedStatus,
    selectedTestType,
  });
  const selectedExternalSampleCodePreview = computed(() => {
    const row = selectedExternalTaskIntake.value;
    return row ? buildTaskSampleCodes(row.code, row.sampleCount, []).slice(0, 5) : [];
  });
  const masterTestTypeOptions = computed(() =>
    buildExperimentTypeOptions(
      masterTestTypes.value
        .map((entry) => normalizeText(entry?.name || entry?.testTypeName))
        .filter(Boolean),
    ),
  );
  const experimentTypeOptions = computed(() =>
    buildExperimentTypeOptions(
      masterTestTypeOptions.value.length > 0 ? masterTestTypeOptions.value : Object.keys(TEST_PREFIX_MAP),
    ),
  );
  const intakeExperimentTypeOptions = experimentTypeOptions;
  const editExperimentTypeOptions = experimentTypeOptions;
  const intakeExperimentPlainSummary = computed(() => buildExperimentTypeSummary(intakeForm.value.test_types));
  const intakeExperimentSummary = computed(() =>
    buildExperimentTypeAxisSummary(intakeForm.value.test_types, intakeForm.value.axis_codes_by_test_type)
  );
  const intakeExperimentDraftSummary = computed(() =>
    buildExperimentTypeAxisSummary(intakeExperimentDraft.value, intakeAxisDraftByTestType.value)
  );
  const intakeExperimentDraftAxisSummary = intakeExperimentDraftSummary;
  const editExperimentSummary = computed(() =>
    buildExperimentTypeAxisSummary(editForm.value.test_types, editForm.value.axis_codes_by_test_type)
  );
  const editExperimentDraftSummary = computed(() =>
    buildExperimentTypeAxisSummary(editExperimentDraft.value, editAxisDraftByTestType.value)
  );
  const intakeSampleCodePreview = computed(() =>
    buildTaskSampleCodes(intakeForm.value.code, intakeForm.value.sample_count, []).slice(0, 5)
  );
  const taskDetailSampleCodes = computed(() => {
    const taskCode = normalizeText(editForm.value.code);
    if (!taskCode) {
      return [];
    }
    const codes = rawSamples.value
      .filter((sample) => normalizeText(sample?.task_code) === taskCode)
      .map((sample) => normalizeText(sample?.code))
      .filter(Boolean)
      .sort((left, right) => left.localeCompare(right, "zh-Hans-CN", { numeric: true, sensitivity: "base" }));
    const plannedCount = normalizeTaskSampleCount(editForm.value.sample_count, codes.length);
    if (plannedCount <= 0) {
      return [];
    }
    if (codes.length >= plannedCount) {
      return codes.slice(0, plannedCount);
    }
    const codeSet = new Set(codes);
    const generatedCodes = buildTaskSampleCodes(taskCode, plannedCount, [])
      .filter((code) => !codeSet.has(code));
    return codes.concat(generatedCodes).slice(0, plannedCount);
  });
  const taskDetailSampleCodePreview = computed(() => taskDetailSampleCodes.value.slice(0, 5));
  const isCompletedTaskDetail = computed(() => normalizeText(editForm.value.status) === STATUS_COMPLETED);
  const isRunningTaskDetail = computed(() => normalizeText(editForm.value.status) === STATUS_RUNNING);
  const isTaskDetailLocked = computed(() => isCompletedTaskDetail.value || isRunningTaskDetail.value);
  const isTaskSampleCountLocked = computed(() => {
    const taskId = normalizeText(editForm.value.id);
    const taskCode = normalizeText(editForm.value.code);
    const task = rawTasks.value.find((entry) => (
      normalizeText(entry?.id) === taskId || taskCodeOf(entry) === taskCode
    ));
    return Boolean(task && taskSampleCountLocked(task, rawSamples.value));
  });
  const isTaskSampleCodesLocked = computed(() => {
    const taskId = normalizeText(editForm.value.id);
    const taskCode = normalizeText(editForm.value.code);
    const task = rawTasks.value.find((entry) => (
      normalizeText(entry?.id) === taskId || taskCodeOf(entry) === taskCode
    ));
    return Boolean(task && taskStorageConfirmed(task, rawSamples.value));
  });

  const refreshNextTaskCode = async () => {
    const requestId = ++nextTaskCodeRequest;
    const reference = String(
      intakeForm.value.due_at || intakeForm.value.arrival_at || serverNowDate().toISOString(),
    );
    const cachedCode = nextTaskCodeCache.get(reference);
    if (cachedCode) {
      intakeForm.value.code = cachedCode;
      return;
    }
    try {
      const code = await readNextTaskCode(reference);
      if (requestId === nextTaskCodeRequest && code) {
        nextTaskCodeCache.set(reference, code);
        intakeForm.value.code = code;
      }
    } catch (_error) {
      // Keep the immediate page-local preview. The create API still performs the
      // authoritative uniqueness check if the sequence changes concurrently.
    }
  };

  const syncIntakeDerivedFields = () => {
    intakeForm.value.test_type = intakeExperimentPlainSummary.value;
    // 任务编号统一按 SYLU-年月-序号生成，月份优先跟随期望完成时间。
    const nextCode = buildTaskCode(
      intakeForm.value.test_type,
      [...rawTasks.value, ...rawExternalTaskIntakes.value],
      intakeForm.value.due_at || intakeForm.value.arrival_at || serverNowDate(),
    );
    intakeForm.value.code = nextCode;
    void refreshNextTaskCode();
  };

  const resetIntakeForm = () => {
    intakeForm.value = createTaskIntakeForm();
    intakeExperimentDraft.value = [];
    intakeAxisDraftByTestType.value = {};
    intakeAxisPickerType.value = "";
    intakeAxisPickerCodes.value = [];
    intakeExperimentModal.close();
    intakeAxisModal.close();
    intakeWarning.value = "";
    syncIntakeDerivedFields();
  };

  const cloneIntakeForm = (form) => ({
    ...createTaskIntakeForm(),
    ...(form && typeof form === "object" ? form : {}),
    test_types: Array.isArray(form?.test_types) ? [...form.test_types] : [],
    axis_codes_by_test_type: normalizeAxisCodesByTestType(
      form?.axis_codes_by_test_type || form?.axisCodesByTestType,
      form?.test_types,
    ),
  });

  const restoreIntakeDraft = () => {
    if (!savedIntakeDraft.value) {
      resetIntakeForm();
      return;
    }
    intakeForm.value = cloneIntakeForm(savedIntakeDraft.value);
    intakeExperimentDraft.value = [];
    intakeAxisDraftByTestType.value = {};
    intakeAxisPickerType.value = "";
    intakeAxisPickerCodes.value = [];
    intakeExperimentModal.close();
    intakeAxisModal.close();
    intakeWarning.value = "";
    syncIntakeDerivedFields();
  };

  const removeTaskHash = () => {
    // 关闭弹窗时清掉 hash，避免刷新或后退时重复拉起受理弹窗。
    if (typeof window === "undefined" || window.location.hash !== TASK_INTAKE_HASH) {
      return;
    }
    const url = `${window.location.pathname}${window.location.search}`;
    window.history.replaceState(null, "", url);
  };

  const refreshIntakeDueAtMin = () => {
    const nextSelectableMinute = new Date(Math.ceil(serverNowMs() / 60_000) * 60_000);
    intakeDueAtMin.value = formatLocalDateTime(nextSelectableMinute, { includeSeconds: false }).replace(" ", "T");
  };

  const refreshEditDueAtMin = () => {
    const nextSelectableMinute = new Date(Math.ceil(serverNowMs() / 60_000) * 60_000);
    editDueAtMin.value = formatLocalDateTime(nextSelectableMinute, { includeSeconds: false }).replace(" ", "T");
  };

  const openIntakeModal = () => {
    refreshIntakeDueAtMin();
    restoreIntakeDraft();
    intakeModal.openWith({ id: "task-intake-modal" });
  };

  const closeIntakeModal = () => {
    intakeModal.close();
    intakeExperimentModal.close();
    intakeAxisModal.close();
    intakeExperimentDraft.value = [];
    intakeAxisDraftByTestType.value = {};
    intakeAxisPickerType.value = "";
    intakeAxisPickerCodes.value = [];
    removeTaskHash();
    flushPendingRealtimeRefresh();
  };

  const sanitizeIntakeContactInfo = (event) => {
    const digits = normalizeText(event?.target?.value).replace(/\D/g, "").slice(0, 15);
    intakeForm.value.contact_info = digits;
    if (event?.target) {
      event.target.value = digits;
    }
  };

  const sanitizeEditContactInfo = (event) => {
    const digits = normalizeText(event?.target?.value).replace(/\D/g, "").slice(0, 15);
    editForm.value.contact_info = digits;
    if (event?.target) {
      event.target.value = digits;
    }
  };

  const {
    closeEditAxisPicker,
    closeEditExperimentPicker,
    closeIntakeAxisPicker,
    closeIntakeExperimentPicker,
    confirmEditAxisPicker,
    confirmEditExperimentPicker,
    confirmIntakeAxisPicker,
    confirmIntakeExperimentPicker,
    openEditExperimentPicker,
    openIntakeExperimentPicker,
    removeEditAxisExperiment,
    toggleEditAxisCode,
    toggleEditExperimentType,
    toggleIntakeAxisCode,
    toggleIntakeExperimentType,
  } = useTaskExperimentPickers({
    editAxisDraftByTestType,
    editAxisModal,
    editAxisPickerCodes,
    editAxisPickerType,
    editExperimentDraft,
    editExperimentModal,
    editForm,
    editWarning,
    intakeAxisDraftByTestType,
    intakeAxisModal,
    intakeAxisPickerCodes,
    intakeAxisPickerType,
    intakeExperimentDraft,
    intakeExperimentModal,
    intakeForm,
    intakeWarning,
    isTaskDetailLocked,
    syncIntakeDerivedFields,
  });

  const openResetModal = () => {
    resetError.value = "";
    resetModal.openWith({ id: "task-reset-modal" });
  };

  const closeResetModal = () => {
    if (resetting.value) {
      return;
    }
    resetModal.close();
    resetError.value = "";
    flushPendingRealtimeRefresh();
  };

  const replaceTaskScopedRows = (targetRef, rows, taskCode) => {
    if (!Array.isArray(rows)) {
      return;
    }
    const normalizedTaskCode = normalizeText(taskCode);
    const retained = targetRef.value.filter((entry) => taskCodeOf(entry) !== normalizedTaskCode);
    targetRef.value = [...retained, ...rows];
  };

  const applyTaskDetailPayload = (payload, taskCode) => {
    const safePayload = payload && typeof payload === "object" ? payload : {};
    const taskExistsOnPage = rawTasks.value.some((entry) => taskCodeOf(entry) === normalizeText(taskCode));
    if (taskExistsOnPage && safePayload.task && typeof safePayload.task === "object") {
      replaceTaskScopedRows(rawTasks, [safePayload.task], taskCode);
    }
    replaceTaskScopedRows(rawSamples, safePayload.samples, taskCode);
    replaceTaskScopedRows(rawExperiments, safePayload.experiments, taskCode);
    replaceTaskScopedRows(rawSchedules, safePayload.schedules, taskCode);
    replaceTaskScopedRows(rawExperimentTrays, safePayload.experimentTrays, taskCode);
    replaceTaskScopedRows(rawExperimentSamples, safePayload.experimentSamples, taskCode);
    replaceTaskScopedRows(rawExperimentRuns, safePayload.experimentRuns, taskCode);
    replaceTaskScopedRows(rawExperimentRunTrays, safePayload.experimentRunTrays, taskCode);
  };

  const loadTaskDetailScope = async (taskCode) => {
    const scopeRequest = ++taskScopeRequest;
    const payload = await readTaskDetail(taskCode);
    if (scopeRequest !== taskScopeRequest) {
      return null;
    }
    applyTaskDetailPayload(payload, taskCode);
    const safePayload = payload && typeof payload === "object" ? payload : {};
    const detailRows = safePayload.task
      ? buildTaskRows(
        [safePayload.task],
        Array.isArray(safePayload.schedules) ? safePayload.schedules : [],
        Array.isArray(safePayload.samples) ? safePayload.samples : [],
        Array.isArray(safePayload.experiments) ? safePayload.experiments : [],
      )
      : [];
    return detailRows[0];
  };

  const openTaskDrawer = async (row) => {
    const detailRequest = ++taskDetailRequest;
    refreshEditDueAtMin();
    editForm.value = buildTaskEditForm(row);
    editWarning.value = "";
    sampleCodesWarning.value = "";
    taskDrawer.openWith(row);
    try {
      const detailedRow = await loadTaskDetailScope(row.code);
      const selectedTaskCode = normalizeText(taskDrawer.payload.value?.code || editForm.value.code);
      if (
        detailedRow
        && detailRequest === taskDetailRequest
        && taskDrawer.open.value
        && selectedTaskCode === normalizeText(row.code)
        && !isTaskEditFormDirty()
      ) {
        taskDrawer.openWith(detailedRow);
        editForm.value = buildTaskEditForm(detailedRow);
      }
    } catch (error) {
      editWarning.value = buildFailureMessage("任务详情加载失败，请稍后重试", error);
    }
  };

  const closeTaskDrawer = () => {
    taskDetailRequest += 1;
    taskScopeRequest += 1;
    taskDrawer.close();
    editExperimentModal.close();
    editAxisModal.close();
    sampleCodesModal.close();
    scheduledExperimentRemovalModal.close();
    editExperimentDraft.value = [];
    editAxisDraftByTestType.value = {};
    editAxisPickerType.value = "";
    editAxisPickerCodes.value = [];
    sampleCodesDraft.value = "";
    sampleCodesWarning.value = "";
    scheduledExperimentRemovalDraft.value = null;
    flushPendingRealtimeRefresh();
  };

  const openSampleCodesEditor = () => {
    if (isTaskDetailLocked.value || isTaskSampleCodesLocked.value) {
      return;
    }
    const taskCode = normalizeText(editForm.value.code);
    if (!taskCode) {
      return;
    }
    sampleCodesWarning.value = "";
    const currentCodes = taskDetailSampleCodes.value;
    const fallbackCodes = buildTaskSampleCodes(taskCode, editForm.value.sample_count, []);
    sampleCodesDraft.value = (currentCodes.length > 0 ? currentCodes : fallbackCodes).join("\n");
    sampleCodesModal.openWith({ id: "task-sample-codes-modal", taskCode });
  };

  const closeSampleCodesEditor = () => {
    sampleCodesModal.close();
    sampleCodesDraft.value = "";
    sampleCodesWarning.value = "";
    flushPendingRealtimeRefresh();
  };

  const syncModalWithHash = (hashValue) => {
    // 允许通过 URL hash 或全局事件直接打开任务受理弹窗。
    if (normalizeText(hashValue) === TASK_INTAKE_HASH) {
      openIntakeModal();
      return;
    }
    intakeModal.close();
  };

  const handleHashChange = () => {
    if (typeof window === "undefined") {
      return;
    }
    syncModalWithHash(window.location.hash);
  };

  const handleOpenTaskIntake = () => {
    openIntakeModal();
  };

  const handleOpenTaskReset = () => {
    openResetModal();
  };

  const openExternalAcceptanceModal = () => {
    selectedExternalTaskIntake.value = null;
    externalAcceptanceError.value = "";
    externalAcceptanceModal.openWith({ id: "external-task-intake-modal" });
  };

  const closeExternalAcceptanceModal = () => {
    if (acceptingExternalTask.value) {
      return;
    }
    selectedExternalTaskIntake.value = null;
    externalAcceptanceError.value = "";
    externalAcceptanceModal.close();
  };

  const openExternalTaskIntakeDetail = (row) => {
    selectedExternalTaskIntake.value = row ? { ...row } : null;
    externalAcceptanceError.value = "";
  };

  const postponeExternalTaskIntake = () => {
    if (acceptingExternalTask.value) {
      return;
    }
    selectedExternalTaskIntake.value = null;
    externalAcceptanceError.value = "";
  };

  const handleOpenExternalTaskIntake = () => {
    openExternalAcceptanceModal();
    // Pending LIMS intakes can arrive long after this page was mounted. Refresh
    // only that lightweight collection when the user opens the dialog, while
    // preserving the last known list if the request temporarily fails.
    void readExternalTaskIntakes()
      .then((externalIntakes) => {
        if (Array.isArray(externalIntakes)) {
          rawExternalTaskIntakes.value = externalIntakes;
        }
      })
      .catch(() => {});
  };

  const buildFailureMessage = (prefix, error) => {
    const detail = normalizeText(error instanceof Error ? error.message : "");
    return detail ? `${prefix}，${detail}` : prefix;
  };

  const acceptExternalTaskIntake = async () => {
    const intakeId = normalizeText(selectedExternalTaskIntake.value?.intakeId || selectedExternalTaskIntake.value?.id);
    if (!intakeId || acceptingExternalTask.value) {
      return;
    }
    acceptingExternalTask.value = true;
    externalAcceptanceError.value = "";
    try {
      await acceptExternalTaskIntakeByApi(intakeId);
      rawExternalTaskIntakes.value = rawExternalTaskIntakes.value.filter(
        (entry) => normalizeText(entry?.intakeId || entry?.intake_id || entry?.id) !== intakeId,
      );
      selectedExternalTaskIntake.value = null;
      await loadTasksPage();
    } catch (error) {
      externalAcceptanceError.value = buildFailureMessage("外部委托受理失败，请稍后重试", error);
    } finally {
      acceptingExternalTask.value = false;
    }
  };

  const experimentCodeOf = (entry) => normalizeText(entry?.experiment_code || entry?.experimentCode);

  const experimentLabelOf = (entry) =>
    normalizeText(entry?.experiment_name || entry?.experiment_type || entry?.required_device);

  const arraysEqual = (left, right) => {
    const leftItems = collectExperimentTypes(left);
    const rightItems = collectExperimentTypes(right);
    return leftItems.length === rightItems.length && leftItems.every((item, index) => item === rightItems[index]);
  };

  const sampleCountChanged = (originalTask, updatedTask) => {
    const taskCode = taskCodeOf(originalTask);
    const relatedSampleCount = rawSamples.value.filter((sample) => taskCodeOf(sample) === taskCode).length;
    const originalCount = normalizeTaskSampleCount(originalTask?.sample_count, relatedSampleCount);
    const nextCount = normalizeTaskSampleCount(updatedTask?.sample_count, originalCount);
    return originalCount !== nextCount;
  };

  const isRetentionSchedule = (schedule) => normalizeText(schedule?.device).includes("暂存间");

  const resolveAffectedExperimentCodes = (taskCode, nextExperimentTypes) => {
    const taskExperiments = rawExperiments.value.filter((experiment) => taskCodeOf(experiment) === taskCode);
    const nextTypes = collectExperimentTypes(nextExperimentTypes);
    const remainingTypeCounts = new Map();
    nextTypes.forEach((type) => {
      remainingTypeCounts.set(type, (remainingTypeCounts.get(type) || 0) + 1);
    });
    const affected = new Set();
    taskExperiments.forEach((experiment) => {
      const code = experimentCodeOf(experiment);
      if (!code) {
        return;
      }
      const label = experimentLabelOf(experiment);
      const remainingCount = remainingTypeCounts.get(label) || 0;
      if (remainingCount > 0) {
        remainingTypeCounts.set(label, remainingCount - 1);
      } else {
        affected.add(code);
      }
    });
    return affected;
  };

  const resolveScheduledExperimentRemoval = (taskCode, nextExperimentTypes) => {
    const affectedCodes = resolveAffectedExperimentCodes(taskCode, nextExperimentTypes);
    const schedules = rawSchedules.value.filter((schedule) => taskCodeOf(schedule) === taskCode && !isRetentionSchedule(schedule));
    return {
      affectedCodes,
      schedules,
    };
  };

  const clearResetFeedbackTimer = () => {
    if (resetFeedbackTimer) {
      window.clearTimeout(resetFeedbackTimer);
      resetFeedbackTimer = null;
    }
  };

  const clearResetFeedback = () => {
    clearResetFeedbackTimer();
    resetFeedback.value = "";
  };

  const showResetFeedback = (message) => {
    clearResetFeedbackTimer();
    resetFeedback.value = message;
    resetFeedbackTimer = window.setTimeout(() => {
      resetFeedback.value = "";
      resetFeedbackTimer = null;
    }, RESET_FEEDBACK_DISMISS_MS);
  };

  const handleDocumentPointerDown = (event) => {
    if (!resetFeedback.value) {
      return;
    }
    const target = event.target;
    if (target instanceof Element && target.closest('[data-testid="task-reset-feedback"]')) {
      return;
    }
    clearResetFeedback();
  };

  const {
    closeScheduledExperimentRemovalConfirm,
    confirmScheduledExperimentRemoval,
    deleteTask,
    saveSampleCodes,
    updateTask,
  } = useTaskMutationWorkflow({
    arraysEqual,
    buildFailureMessage,
    closeSampleCodesEditor,
    closeTaskDrawer,
    editForm,
    editWarning,
    isTaskDetailLocked,
    loadError,
    loadTasksPage: (...args) => loadTasksPage(...args),
    rawExperimentRuns,
    rawExperimentRunTrays,
    rawExperiments,
    rawSamples,
    rawSchedules,
    rawStreams,
    rawTasks,
    resolveScheduledExperimentRemoval,
    sampleCodesDraft,
    sampleCodesWarning,
    sampleCountChanged,
    scheduledExperimentRemovalDraft,
    scheduledExperimentRemovalModal,
    taskCodeOf,
    taskDetailSampleCodes,
    taskSampleCountLocked,
    taskStorageConfirmed,
  });
  const submitTask = async () => {
    const textWarning = validateTaskTextFields(intakeForm.value, { requireContact: true });
    if (textWarning) {
      intakeWarning.value = textWarning;
      return;
    }
    if (intakeForm.value.test_types.length === 0) {
      intakeWarning.value = "请选择至少一个试验类型";
      return;
    }
    const sampleCountWarning = validateTaskSampleCount(intakeForm.value.sample_count);
    if (sampleCountWarning) {
      intakeWarning.value = sampleCountWarning;
      return;
    }
    const dueAtTime = parseBusinessDateTimeToMs(intakeForm.value.due_at);
    if (Number.isFinite(dueAtTime) && dueAtTime < serverNowMs()) {
      intakeWarning.value = "期望完成时间不能早于当前时间";
      return;
    }

    const nextTask = createTaskRecord(intakeForm.value, rawTasks.value);
    try {
      await createTask(nextTask);
      rawTasks.value = [nextTask, ...rawTasks.value];
      nextTaskCodeCache.clear();
      savedIntakeDraft.value = null;
      closeIntakeModal();
      resetIntakeForm();
    } catch (error) {
      intakeWarning.value = buildFailureMessage("任务提交失败，请稍后重试", error);
      return;
    }

    try {
      currentPage.value = 1;
      await loadTasksPage();
      if (loadError.value) {
        loadError.value = "任务已创建，但任务列表刷新失败，请刷新后确认";
      }
    } catch (error) {
      loadError.value = buildFailureMessage("任务已创建，但任务列表刷新失败，请刷新后确认", error);
    }
  };

  const saveDraft = async () => {
    syncIntakeDerivedFields();
    const textWarning = validateTaskTextFields(intakeForm.value);
    if (textWarning) {
      intakeWarning.value = textWarning;
      return;
    }
    savedIntakeDraft.value = cloneIntakeForm(intakeForm.value);
    intakeWarning.value = "任务草稿已保存";
  };

  const resetTasks = async () => {
    if (resetting.value) {
      return;
    }

    resetting.value = true;
    resetError.value = "";
    clearResetFeedback();
    try {
      const summary = await resetTasksByApi();
      resetModal.close();
      notifyStorageSnapshotUpdated({}, { source: "tasks", reason: "reset" });
      await loadTasksPage();
      showResetFeedback(`任务数据已重置，共重建 ${summary.task_count} 个任务。`);
    } catch (error) {
      resetError.value = buildFailureMessage("任务重置失败，请稍后重试", error);
    } finally {
      resetting.value = false;
    }
  };

  const loadTasksPage = async () => {
    const pageRequest = ++taskPageRequest;
    try {
      const payload = await readTaskPage({
        page: currentPage.value,
        pageSize: 8,
        query: query.value,
        sortDirection: sortDirection.value,
        sortKey: sortKey.value,
        status: selectedStatus.value,
        testType: selectedTestType.value,
      });
      if (pageRequest !== taskPageRequest) {
        return;
      }
      const safePayload = payload && typeof payload === "object" ? payload : {};
      if (Array.isArray(safePayload.tasks)) rawTasks.value = safePayload.tasks;
      if (Array.isArray(safePayload.samples)) rawSamples.value = safePayload.samples;
      if (Array.isArray(safePayload.experiments)) rawExperiments.value = safePayload.experiments;
      if (Array.isArray(safePayload.schedules)) rawSchedules.value = safePayload.schedules;
      rawStreams.value = [];
      rawExperimentTrays.value = [];
      rawExperimentSamples.value = [];
      rawExperimentRuns.value = [];
      rawExperimentRunTrays.value = [];
      taskServerPageCount.value = Math.max(1, Number(safePayload.totalPages || 1));
      taskServerMetrics.value = safePayload.metrics && typeof safePayload.metrics === "object" ? safePayload.metrics : {};
      taskServerStatusOptions.value = Array.isArray(safePayload.statusOptions) ? safePayload.statusOptions : [];
      taskServerTestTypeOptions.value = Array.isArray(safePayload.testTypeOptions) ? safePayload.testTypeOptions : [];
      const responsePage = Number.parseInt(String(safePayload.currentPage || currentPage.value), 10);
      if (Number.isFinite(responsePage) && responsePage > 0 && responsePage !== currentPage.value) {
        currentPage.value = responsePage;
      }
      loadError.value = "";
      if (taskDrawer.open.value) {
        const selectedTaskCode = normalizeText(taskDrawer.payload.value?.code || editForm.value.code);
        const editWasDirty = isTaskEditFormDirty();
        const selectedRow = await loadTaskDetailScope(selectedTaskCode);
        const currentTaskCode = normalizeText(taskDrawer.payload.value?.code || editForm.value.code);
        if (
          selectedRow
          && taskDrawer.open.value
          && currentTaskCode === selectedTaskCode
          && !editWasDirty
          && !isTaskEditFormDirty()
        ) {
          taskDrawer.openWith(selectedRow);
          editForm.value = buildTaskEditForm(selectedRow);
          editWarning.value = "";
        }
      }
    } catch (error) {
      if (pageRequest === taskPageRequest) {
        loadError.value = buildFailureMessage("任务数据加载失败，请检查网络后重试", error);
      }
    }
    if (pageRequest !== taskPageRequest) {
      return;
    }
    syncIntakeDerivedFields();
    syncModalWithHash(typeof window !== "undefined" ? window.location.hash : route.hash || "");
  };

  const loadTaskSupportingData = async () => {
    const [externalIntakes, testTypes] = await Promise.all([
      readExternalTaskIntakes().catch(() => []),
      readMasterTestTypes().catch(() => []),
    ]);
    rawExternalTaskIntakes.value = Array.isArray(externalIntakes) ? externalIntakes : [];
    masterTestTypes.value = Array.isArray(testTypes) ? testTypes : [];
  };

  const isTaskEditFormDirty = () => {
    if (!taskDrawer.open.value || !taskDrawer.payload.value) {
      return false;
    }
    const baseline = buildTaskEditForm(taskDrawer.payload.value);
    const currentTypes = Array.isArray(editForm.value.test_types) ? editForm.value.test_types.map(normalizeText) : [];
    const baselineTypes = Array.isArray(baseline.test_types) ? baseline.test_types.map(normalizeText) : [];
    return [
      "name",
      "source",
      "contact",
      "contact_info",
      "priority",
      "sample_count",
      "sample_type",
      "due_at",
      "remark",
    ].some((field) => normalizeText(editForm.value[field]) !== normalizeText(baseline[field]))
      || currentTypes.length !== baselineTypes.length
      || currentTypes.some((type, index) => type !== baselineTypes[index]);
  };

  const refreshTasksPage = async (keys = []) => {
    await loadTasksPage();
    if (Array.isArray(keys) && keys.includes("mes.external_task_intakes")) {
      await loadTaskSupportingData();
    }
  };

  const { flushPendingRealtimeRefresh } = useTasksRealtime({
    editAxisModal,
    editExperimentModal,
    intakeAxisModal,
    intakeExperimentModal,
    intakeModal,
    isTaskEditFormDirty,
    loadTasksPage: refreshTasksPage,
    resetModal,
    sampleCodesModal,
    scheduledExperimentRemovalModal,
    taskDrawer,
  });
  watch(
    () => intakeForm.value.test_types.join(" / "),
    () => {
      syncIntakeDerivedFields();
    },
  );

  watch(
    () => intakeForm.value.due_at,
    () => {
      syncIntakeDerivedFields();
    },
  );

  watch(
    () => intakeForm.value.source,
    () => {
      if (!normalizeText(intakeForm.value.client)) {
        intakeForm.value.client = "内部部门";
      }
    },
  );

  const scheduleTaskPageRefresh = () => {
    void loadTasksPage();
  };

  watch(query, () => {
    queryPageResetPending = currentPage.value !== 1;
    currentPage.value = 1;
    window.clearTimeout(taskSearchRefreshTimer);
    taskSearchRefreshTimer = window.setTimeout(scheduleTaskPageRefresh, 250);
  });

  watch([selectedStatus, selectedTestType], () => {
    currentPage.value = 1;
    scheduleTaskPageRefresh();
  });

  watch([currentPage, sortKey, sortDirection], () => {
    if (queryPageResetPending) {
      queryPageResetPending = false;
      return;
    }
    scheduleTaskPageRefresh();
  });

  watch(selectedTestType, () => {
    if (selectedStatus.value) {
      selectedStatus.value = "";
    }
  });

  watch(
    () => route.hash,
    (nextHash) => {
      syncModalWithHash(nextHash);
    },
    { immediate: true },
  );

  onMounted(() => {
    void loadTasksPage();
    void loadTaskSupportingData();
    window.addEventListener("hashchange", handleHashChange);
    window.addEventListener("mes:open-task-intake", handleOpenTaskIntake);
    window.addEventListener(EXTERNAL_TASK_INTAKE_EVENT, handleOpenExternalTaskIntake);
    window.addEventListener(TASK_RESET_EVENT, handleOpenTaskReset);
    document.addEventListener("pointerdown", handleDocumentPointerDown);
  });

  onBeforeUnmount(() => {
    clearResetFeedbackTimer();
    window.clearTimeout(taskSearchRefreshTimer);
    window.removeEventListener("hashchange", handleHashChange);
    window.removeEventListener("mes:open-task-intake", handleOpenTaskIntake);
    window.removeEventListener(EXTERNAL_TASK_INTAKE_EVENT, handleOpenExternalTaskIntake);
    window.removeEventListener(TASK_RESET_EVENT, handleOpenTaskReset);
    document.removeEventListener("pointerdown", handleDocumentPointerDown);
  });

  return {
    acceptExternalTaskIntake,
    acceptingExternalTask,
    closeExternalAcceptanceModal,
    closeIntakeAxisPicker,
    closeIntakeModal,
    closeResetModal,
    closeScheduledExperimentRemovalConfirm,
    closeSampleCodesEditor,
    closeTaskDrawer,
    closeEditAxisPicker,
    confirmIntakeAxisPicker,
    confirmEditAxisPicker,
    confirmScheduledExperimentRemoval,
    currentPage,
    deleteTask,
    editDueAtMin,
    editForm,
    editWarning,
    externalAcceptanceError,
    externalAcceptanceModalOpen: externalAcceptanceModal.open,
    externalTaskIntakeRows,
    filterStatus: selectedStatus,
    filterTestType: selectedTestType,
    defaultAxisCodes: DEFAULT_AXIS_CODES,
    formatAxisCodeLabel,
    intakeForm,
    intakeAxisModalOpen: intakeAxisModal.open,
    intakeAxisPickerCodes,
    intakeAxisPickerType,
    intakeExperimentDraft,
    intakeExperimentDraftAxisSummary,
    intakeExperimentDraftSummary,
    intakeExperimentModalOpen: intakeExperimentModal.open,
    intakeExperimentSummary,
    intakeExperimentTypeOptions,
    intakeDueAtMin,
    isCompletedTaskDetail,
    isRunningTaskDetail,
    isTaskDetailLocked,
    isTaskSampleCountLocked,
    isTaskSampleCodesLocked,
    intakeModalOpen: intakeModal.open,
    intakeSampleCodePreview,
    intakeWarning,
    loadError,
    metrics,
    pageCount,
    postponeExternalTaskIntake,
    query,
    resetError,
    resetFeedback,
    resetModalOpen: resetModal.open,
    resetTasks,
    resetting,
    scheduledExperimentRemovalModalOpen: scheduledExperimentRemovalModal.open,
    sampleCodesDraft,
    sampleCodesModalOpen: sampleCodesModal.open,
    sampleCodesWarning,
    sanitizeEditContactInfo,
    sanitizeIntakeContactInfo,
    saveDraft,
    saveSampleCodes,
    selectedRow: taskDrawer.payload,
    selectedExternalTaskIntake,
    selectedExternalSampleCodePreview,
    setCurrentPage,
    statusOptions: scopedStatusOptions,
    closeIntakeExperimentPicker,
    closeEditExperimentPicker,
    confirmIntakeExperimentPicker,
    confirmEditExperimentPicker,
    editExperimentDraft,
    editExperimentDraftSummary,
    editExperimentModalOpen: editExperimentModal.open,
    editExperimentSummary,
    editExperimentTypeOptions,
    editAxisModalOpen: editAxisModal.open,
    editAxisPickerCodes,
    editAxisPickerType,
    openIntakeExperimentPicker,
    openIntakeModal,
    openExternalTaskIntakeDetail,
    openEditExperimentPicker,
    openSampleCodesEditor,
    sortDirection,
    sortKey,
    submitTask,
    taskDrawerOpen: taskDrawer.open,
    taskDetailSampleCodePreview,
    taskDetailSampleCodes,
    taskRows: visibleRows,
    testTypeOptions,
    toggleIntakeAxisCode,
    toggleIntakeExperimentType,
    toggleEditAxisCode,
    toggleEditExperimentType,
    removeEditAxisExperiment,
    toggleSort,
    updateTask,
    openTaskDrawer,
  };
}

export { useTasksPage };
