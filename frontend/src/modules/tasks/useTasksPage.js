// 负责任务受理页的新增、筛选、编辑和持久化流程。
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { serverNowDate, serverNowMs } from "@/lib/serverClock";
import { useRoute } from "vue-router";

import { useDialogState } from "@/composables/useDialogState";
import { useStorageSnapshot } from "@/composables/useStorageSnapshot";
import { buildExperimentTypeOptions, buildExperimentTypeSummary, collectExperimentTypes } from "@/lib/experimentTypes";
import { formatLocalDateTime, parseBusinessDateTimeToMs } from "@/lib/dateTime";
import { TEST_PREFIX_MAP } from "@/lib/labs";
import { readMasterTestTypes } from "@/lib/masterDataApi";
import { notifyStorageSnapshotUpdated } from "@/lib/storageApi";
import {
  acceptExternalTaskIntake as acceptExternalTaskIntakeByApi,
  createTask,
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
  syncTaskSamples,
  validateTaskSampleCount,
  validateTaskTextFields,
} from "./model";
import { STORAGE_KEYS } from "@/lib/storageKeys";
import { useTasksTableView } from "./useTasksTableView";
import { useTaskExperimentPickers } from "./useTaskExperimentPickers";
import { useTasksPersistence } from "./useTasksPersistence";
import { useTasksRealtime } from "./useTasksRealtime";
import { useTaskMutationWorkflow } from "./useTaskMutationWorkflow";

const TASK_INTAKE_HASH = "#task-intake-modal";
const TASK_RESET_EVENT = "mes:open-task-reset";
const EXTERNAL_TASK_INTAKE_EVENT = "mes:open-external-task-intake";
const RESET_FEEDBACK_DISMISS_MS = 10000;

// 将存储快照与弹窗、抽屉、表格状态连接起来，供任务页统一使用。
function useTasksPage() {
  const route = useRoute();
  const { loadSnapshot, persistSnapshot } = useStorageSnapshot([
    STORAGE_KEYS.tasks,
    STORAGE_KEYS.external_task_intakes,
    STORAGE_KEYS.schedules,
    STORAGE_KEYS.samples,
    STORAGE_KEYS.streams,
    STORAGE_KEYS.experiments,
    STORAGE_KEYS.experiment_trays,
    STORAGE_KEYS.experiment_samples,
    STORAGE_KEYS.experiment_runs,
    STORAGE_KEYS.experiment_run_trays,
  ]);

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

  const syncIntakeDerivedFields = () => {
    intakeForm.value.test_type = intakeExperimentPlainSummary.value;
    // 任务编号统一按 SYLU-年月-序号生成，月份优先跟随期望完成时间。
    const nextCode = buildTaskCode(
      intakeForm.value.test_type,
      [...rawTasks.value, ...rawExternalTaskIntakes.value],
      intakeForm.value.due_at || intakeForm.value.arrival_at || serverNowDate(),
    );
    intakeForm.value.code = nextCode;
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

  const openTaskDrawer = (row) => {
    editForm.value = buildTaskEditForm(row);
    editWarning.value = "";
    sampleCodesWarning.value = "";
    taskDrawer.openWith(row);
  };

  const closeTaskDrawer = () => {
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
    if (isTaskDetailLocked.value) {
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
      selectedExternalTaskIntake.value = null;
      await loadTasksPage();
    } catch (error) {
      externalAcceptanceError.value = buildFailureMessage("外部委托受理失败，请稍后重试", error);
    } finally {
      acceptingExternalTask.value = false;
    }
  };

  const taskCodeOf = (task) => normalizeText(task?.task_code || task?.code || task?.taskNo || task?.id);

  const experimentCodeOf = (entry) => normalizeText(entry?.experiment_code || entry?.experimentCode);

  const experimentLabelOf = (entry) =>
    normalizeText(entry?.experiment_name || entry?.experiment_type || entry?.required_device);

  const arraysEqual = (left, right) => {
    const leftItems = collectExperimentTypes(left);
    const rightItems = collectExperimentTypes(right);
    return leftItems.length === rightItems.length && leftItems.every((item, index) => item === rightItems[index]);
  };

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

  const taskHasSelectedExperiments = (task) => {
    const taskCode = taskCodeOf(task);
    if (rawExperiments.value.some((experiment) => taskCodeOf(experiment) === taskCode)) {
      return true;
    }
    return collectExperimentTypes(task?.test_types, task?.test_type).length > 0;
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

  const resetSamplesForExperimentTypeChange = (samples, taskCode) =>
    (Array.isArray(samples) ? samples : []).map((sample) => {
      if (taskCodeOf(sample) !== taskCode) {
        return sample;
      }
      const history = Array.isArray(sample?.history)
        ? sample.history.filter((entry) => !["样品分装托盘", "任务已确认入库", "任务重新载装", "任务重新入库"].includes(normalizeText(entry?.action)))
        : sample?.history;
      return {
        ...sample,
        status: "运输中",
        flow_status: "运输中",
        location: "",
        trays: [],
        ...(Array.isArray(sample?.history) ? { history } : {}),
      };
    });

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
    applySnapshotArray,
    buildSnapshotFallback,
    persistRelated,
    readAllTasks,
  } = useTasksPersistence({
    persistSnapshot,
    rawExperimentRunTrays,
    rawExperimentRuns,
    rawExperimentSamples,
    rawExperimentTrays,
    rawExperiments,
    rawExternalTaskIntakes,
    rawSamples,
    rawSchedules,
    rawStreams,
  });
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
    experimentCodeOf,
    isTaskDetailLocked,
    loadError,
    loadTasksPage: (...args) => loadTasksPage(...args),
    persistRelated,
    rawExperimentRuns,
    rawExperimentRunTrays,
    rawExperiments,
    rawExperimentSamples,
    rawExperimentTrays,
    rawSamples,
    rawSchedules,
    rawStreams,
    rawTasks,
    readAllTasks,
    resolveScheduledExperimentRemoval,
    resetSamplesForExperimentTypeChange,
    sampleCodesDraft,
    sampleCodesWarning,
    sampleCountChanged,
    scheduledExperimentRemovalDraft,
    scheduledExperimentRemovalModal,
    taskCodeOf,
    taskDetailSampleCodes,
    taskHasSelectedExperiments,
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
    // 任务创建后立即同步样品编号，保持任务与样品侧数据一致。
    const nextSamples = syncTaskSamples(rawSamples.value, nextTask);
    try {
      await createTask(nextTask);
      rawTasks.value = [nextTask, ...rawTasks.value];
      savedIntakeDraft.value = null;
      closeIntakeModal();
      resetIntakeForm();
    } catch (error) {
      intakeWarning.value = buildFailureMessage("任务提交失败，请稍后重试", error);
      return;
    }

    try {
      await persistRelated({
        [STORAGE_KEYS.samples]: nextSamples,
      });
    } catch (error) {
      loadError.value = buildFailureMessage("任务已创建，但关联数据保存失败，请刷新后确认", error);
      return;
    }

    try {
      rawTasks.value = await readAllTasks();
      loadError.value = "";
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
      notifyStorageSnapshotUpdated(buildSnapshotFallback(), { source: "tasks", reason: "reset" });
      await loadTasksPage();
      showResetFeedback(`任务数据已重置，共重建 ${summary.task_count} 个任务。`);
    } catch (error) {
      resetError.value = buildFailureMessage("任务重置失败，请稍后重试", error);
    } finally {
      resetting.value = false;
    }
  };

  const loadTasksPage = async () => {
    try {
      const [tasks, snapshot, testTypes] = await Promise.all([
        readAllTasks(),
        loadSnapshot({ fallbackSnapshot: buildSnapshotFallback() }),
        readMasterTestTypes().catch(() => []),
      ]);
      rawTasks.value = Array.isArray(tasks) ? tasks : [];
      applySnapshotArray(snapshot, STORAGE_KEYS.external_task_intakes, rawExternalTaskIntakes);
      applySnapshotArray(snapshot, STORAGE_KEYS.schedules, rawSchedules);
      applySnapshotArray(snapshot, STORAGE_KEYS.samples, rawSamples);
      applySnapshotArray(snapshot, STORAGE_KEYS.streams, rawStreams);
      applySnapshotArray(snapshot, STORAGE_KEYS.experiments, rawExperiments);
      applySnapshotArray(snapshot, STORAGE_KEYS.experiment_trays, rawExperimentTrays);
      applySnapshotArray(snapshot, STORAGE_KEYS.experiment_samples, rawExperimentSamples);
      applySnapshotArray(snapshot, STORAGE_KEYS.experiment_runs, rawExperimentRuns);
      applySnapshotArray(snapshot, STORAGE_KEYS.experiment_run_trays, rawExperimentRunTrays);
      masterTestTypes.value = Array.isArray(testTypes) ? testTypes : [];
      loadError.value = "";
      if (taskDrawer.open.value) {
        const selectedTaskCode = normalizeText(taskDrawer.payload.value?.code || editForm.value.code);
        const selectedRow = buildTaskRows(rawTasks.value, rawSchedules.value, rawSamples.value, rawExperiments.value).find(
          (row) => normalizeText(row?.code) === selectedTaskCode,
        );
        if (selectedRow) {
          taskDrawer.openWith(selectedRow);
          editForm.value = buildTaskEditForm(selectedRow);
          editWarning.value = "";
        }
      }
    } catch (error) {
      loadError.value = buildFailureMessage("任务数据加载失败，请检查网络后重试", error);
    }
    syncIntakeDerivedFields();
    syncModalWithHash(typeof window !== "undefined" ? window.location.hash : route.hash || "");
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
      "priority",
      "sample_count",
      "sample_type",
      "due_at",
      "remark",
    ].some((field) => normalizeText(editForm.value[field]) !== normalizeText(baseline[field]))
      || currentTypes.length !== baselineTypes.length
      || currentTypes.some((type, index) => type !== baselineTypes[index]);
  };

  const { flushPendingRealtimeRefresh } = useTasksRealtime({
    editAxisModal,
    editExperimentModal,
    intakeAxisModal,
    intakeExperimentModal,
    intakeModal,
    isTaskEditFormDirty,
    loadTasksPage,
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

  watch([selectedStatus, selectedTestType], () => {
    // 过滤条件变化时回到第一页，避免当前页码失效。
    currentPage.value = 1;
  });

  watch(selectedTestType, () => {
    if (selectedStatus.value && !scopedStatusOptions.value.includes(selectedStatus.value)) {
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
    window.addEventListener("hashchange", handleHashChange);
    window.addEventListener("mes:open-task-intake", handleOpenTaskIntake);
    window.addEventListener(EXTERNAL_TASK_INTAKE_EVENT, handleOpenExternalTaskIntake);
    window.addEventListener(TASK_RESET_EVENT, handleOpenTaskReset);
    document.addEventListener("pointerdown", handleDocumentPointerDown);
  });

  onBeforeUnmount(() => {
    clearResetFeedbackTimer();
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
