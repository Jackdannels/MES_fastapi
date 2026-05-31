// 负责任务受理页的新增、筛选、编辑和持久化流程。
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";

import { useDialogState } from "@/composables/useDialogState";
import { useStorageSnapshot } from "@/composables/useStorageSnapshot";
import { useStorageSnapshotRefresh } from "@/composables/useStorageSnapshotRefresh";
import { useTableControls } from "@/composables/useTableControls";
import { buildExperimentTypeOptions, buildExperimentTypeSummary, collectExperimentTypes, matchesExperimentTypeFilter } from "@/lib/experimentTypes";
import { TEST_PREFIX_MAP } from "@/lib/labs";
import { readMasterTestTypes } from "@/lib/masterDataApi";
import { SNAPSHOT_UPDATED_EVENT } from "@/lib/storageApi";
import { createTask, deleteTask as deleteTaskByApi, readTasks, resetTasks as resetTasksByApi, updateTask as updateTaskByApi } from "@/lib/tasksApi";
import { SAMPLES_UPDATED_EVENT } from "@/modules/samples/useSampleIntake";
import {
  buildFilterOptions,
  buildTaskCode,
  buildTaskEditForm,
  buildTaskMetrics,
  buildTaskRows,
  buildTaskSampleCodes,
  createTaskEditForm,
  createTaskIntakeForm,
  createTaskRecord,
  deleteTaskSnapshot,
  normalizeText,
  applyTaskSampleCodes,
  splitSampleCodeText,
  syncTaskSamples,
  updateTaskRecord,
  validateSampleCodeDraft,
  validateTaskSampleCount,
  validateTaskTextFields,
} from "./model";
import { STORAGE_KEYS } from "@/lib/storageKeys";

const TASK_INTAKE_HASH = "#task-intake-modal";
const TASK_RESET_EVENT = "mes:open-task-reset";
const RESET_FEEDBACK_DISMISS_MS = 10000;

// 将存储快照与弹窗、抽屉、表格状态连接起来，供任务页统一使用。
function useTasksPage() {
  const route = useRoute();
  const { loadSnapshot, persistSnapshot } = useStorageSnapshot([
    STORAGE_KEYS.tasks,
    STORAGE_KEYS.schedules,
    STORAGE_KEYS.samples,
    STORAGE_KEYS.streams,
    STORAGE_KEYS.experiments,
    STORAGE_KEYS.experiment_trays,
    STORAGE_KEYS.experiment_samples,
  ]);

  const rawTasks = ref([]);
  const rawSchedules = ref([]);
  const rawSamples = ref([]);
  const rawStreams = ref([]);
  const rawExperiments = ref([]);
  const rawExperimentTrays = ref([]);
  const rawExperimentSamples = ref([]);
  const masterTestTypes = ref([]);
  const loadError = ref("");
  const resetFeedback = ref("");
  const resetError = ref("");
  const resetting = ref(false);
  const intakeForm = ref(createTaskIntakeForm());
  const editForm = ref(createTaskEditForm());
  const intakeWarning = ref("");
  const editWarning = ref("");
  const sampleCodesDraft = ref("");
  const sampleCodesWarning = ref("");
  const intakeExperimentDraft = ref([]);
  const editExperimentDraft = ref([]);
  const scheduledExperimentRemovalDraft = ref(null);
  const savedIntakeDraft = ref(null);
  const selectedTestType = ref("");
  const selectedStatus = ref("");

  const intakeModal = useDialogState();
  const intakeExperimentModal = useDialogState();
  const editExperimentModal = useDialogState();
  const sampleCodesModal = useDialogState();
  const scheduledExperimentRemovalModal = useDialogState();
  const resetModal = useDialogState();
  const taskDrawer = useDialogState();
  let resetFeedbackTimer = null;
  let flushPendingStorageRefresh = () => false;
  let hasPendingSamplesRefresh = false;

  const allRows = computed(() => buildTaskRows(rawTasks.value, rawSchedules.value, rawSamples.value, rawExperiments.value));
  const metrics = computed(() => buildTaskMetrics(allRows.value));
  const filterOptions = computed(() => buildFilterOptions(allRows.value));
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
  const intakeExperimentSummary = computed(() => buildExperimentTypeSummary(intakeForm.value.test_types));
  const intakeExperimentDraftSummary = computed(() => buildExperimentTypeSummary(intakeExperimentDraft.value));
  const editExperimentSummary = computed(() => buildExperimentTypeSummary(editForm.value.test_types));
  const editExperimentDraftSummary = computed(() => buildExperimentTypeSummary(editExperimentDraft.value));
  const intakeSampleCodePreview = computed(() =>
    buildTaskSampleCodes(intakeForm.value.code, intakeForm.value.sample_count, []).slice(0, 5)
  );
  const taskDetailSampleCodes = computed(() => {
    const taskCode = normalizeText(editForm.value.code);
    if (!taskCode) {
      return [];
    }
    return rawSamples.value
      .filter((sample) => normalizeText(sample?.task_code) === taskCode)
      .map((sample) => normalizeText(sample?.code))
      .filter(Boolean)
      .sort((left, right) => left.localeCompare(right, "zh-Hans-CN", { numeric: true, sensitivity: "base" }));
  });
  const taskDetailSampleCodePreview = computed(() => taskDetailSampleCodes.value.slice(0, 5));

  const typeFilteredRows = computed(() =>
    allRows.value.filter((row) => {
      // 实验类型先限定任务范围，状态选项和后续搜索都基于这个范围。
      return matchesExperimentTypeFilter(selectedTestType.value, row.testType, row.experimentSummary);
    }),
  );

  const scopedStatusOptions = computed(() => buildFilterOptions(typeFilteredRows.value).statusOptions);

  const filteredRows = computed(() =>
    typeFilteredRows.value.filter((row) => {
      if (selectedStatus.value && row.displayStatus !== selectedStatus.value) {
        return false;
      }
      return true;
    }),
  );

  const { currentPage, pageCount, query, sortDirection, sortKey, visibleRows } = useTableControls({
    rows: filteredRows,
    searchFields: ["code", "name", "source", "experimentSummary", "testType", "displayStatus", "displayStatusLabel"],
    pageSize: 8,
  });

  const toggleSort = (nextKey) => {
    // 排序行为与其他页面保持一致：同列切换方向，换列恢复升序。
    if (sortKey.value === nextKey) {
      sortDirection.value = sortDirection.value === "asc" ? "desc" : "asc";
      return;
    }
    sortKey.value = nextKey;
    sortDirection.value = "asc";
  };

  const setCurrentPage = (page) => {
    currentPage.value = page;
  };

  const syncIntakeDerivedFields = () => {
    intakeForm.value.test_type = intakeExperimentSummary.value;
    // 任务编号统一按 SYLU-年月-序号生成，月份优先跟随期望完成时间。
    const nextCode = buildTaskCode(
      intakeForm.value.test_type,
      rawTasks.value,
      intakeForm.value.due_at || intakeForm.value.arrival_at || new Date(),
    );
    intakeForm.value.code = nextCode;
  };

  const resetIntakeForm = () => {
    intakeForm.value = createTaskIntakeForm();
    intakeExperimentDraft.value = [];
    intakeExperimentModal.close();
    intakeWarning.value = "";
    syncIntakeDerivedFields();
  };

  const cloneIntakeForm = (form) => ({
    ...createTaskIntakeForm(),
    ...(form && typeof form === "object" ? form : {}),
    test_types: Array.isArray(form?.test_types) ? [...form.test_types] : [],
  });

  const restoreIntakeDraft = () => {
    if (!savedIntakeDraft.value) {
      resetIntakeForm();
      return;
    }
    intakeForm.value = cloneIntakeForm(savedIntakeDraft.value);
    intakeExperimentDraft.value = [];
    intakeExperimentModal.close();
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

  const openIntakeModal = () => {
    restoreIntakeDraft();
    intakeModal.openWith({ id: "task-intake-modal" });
  };

  const closeIntakeModal = () => {
    intakeModal.close();
    intakeExperimentModal.close();
    intakeExperimentDraft.value = [];
    removeTaskHash();
    flushPendingRealtimeRefresh();
  };

  const toggleExperimentDraftType = (draftRef, experimentType) => {
    const normalizedType = normalizeText(experimentType);
    if (!normalizedType) {
      return;
    }
    const currentTypes = Array.isArray(draftRef.value) ? [...draftRef.value] : [];
    const targetIndex = currentTypes.findIndex((entry) => normalizeText(entry) === normalizedType);
    if (targetIndex >= 0) {
      currentTypes.splice(targetIndex, 1);
    } else {
      currentTypes.push(normalizedType);
    }
    draftRef.value = currentTypes;
  };

  const openIntakeExperimentPicker = () => {
    intakeExperimentDraft.value = Array.isArray(intakeForm.value.test_types) ? [...intakeForm.value.test_types] : [];
    intakeExperimentModal.openWith({ id: "task-intake-test-types-modal" });
  };

  const closeIntakeExperimentPicker = () => {
    intakeExperimentModal.close();
    intakeExperimentDraft.value = [];
  };

  const toggleIntakeExperimentType = (experimentType) => {
    toggleExperimentDraftType(intakeExperimentDraft, experimentType);
  };

  const confirmIntakeExperimentPicker = () => {
    intakeForm.value.test_types = Array.isArray(intakeExperimentDraft.value) ? [...intakeExperimentDraft.value] : [];
    intakeWarning.value = "";
    syncIntakeDerivedFields();
    closeIntakeExperimentPicker();
  };

  const sanitizeIntakeContactInfo = (event) => {
    const digits = normalizeText(event?.target?.value).replace(/\D/g, "").slice(0, 15);
    intakeForm.value.contact_info = digits;
    if (event?.target) {
      event.target.value = digits;
    }
  };

  const openEditExperimentPicker = () => {
    editExperimentDraft.value = Array.isArray(editForm.value.test_types) ? [...editForm.value.test_types] : [];
    editExperimentModal.openWith({ id: "task-edit-test-types-modal" });
  };

  const closeEditExperimentPicker = () => {
    editExperimentModal.close();
    editExperimentDraft.value = [];
  };

  const toggleEditExperimentType = (experimentType) => {
    toggleExperimentDraftType(editExperimentDraft, experimentType);
  };

  const confirmEditExperimentPicker = () => {
    editForm.value.test_types = Array.isArray(editExperimentDraft.value) ? [...editExperimentDraft.value] : [];
    editForm.value.test_type = buildExperimentTypeSummary(editForm.value.test_types);
    editWarning.value = "";
    closeEditExperimentPicker();
  };

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
    sampleCodesModal.close();
    scheduledExperimentRemovalModal.close();
    editExperimentDraft.value = [];
    sampleCodesDraft.value = "";
    sampleCodesWarning.value = "";
    scheduledExperimentRemovalDraft.value = null;
    flushPendingRealtimeRefresh();
  };

  const openSampleCodesEditor = () => {
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

  const buildFailureMessage = (prefix, error) => {
    const detail = normalizeText(error instanceof Error ? error.message : "");
    return detail ? `${prefix}，${detail}` : prefix;
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

  const isStorageConfirmedStatus = (value) => ["到货", "已入库"].includes(normalizeText(value));

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

  const readAllTasks = () => readTasks({ includeArchived: true });

  const persistRelated = async (updates) => {
    // 任务已切到独立 API，当前只把关联集合继续写回快照桥接层。
    await persistSnapshot(updates);
    if (Array.isArray(updates[STORAGE_KEYS.schedules])) {
      rawSchedules.value = updates[STORAGE_KEYS.schedules];
    }
    if (Array.isArray(updates[STORAGE_KEYS.samples])) {
      rawSamples.value = updates[STORAGE_KEYS.samples];
    }
    if (Array.isArray(updates[STORAGE_KEYS.streams])) {
      rawStreams.value = updates[STORAGE_KEYS.streams];
    }
    if (Array.isArray(updates[STORAGE_KEYS.experiment_trays])) {
      rawExperimentTrays.value = updates[STORAGE_KEYS.experiment_trays];
    }
    if (Array.isArray(updates[STORAGE_KEYS.experiment_samples])) {
      rawExperimentSamples.value = updates[STORAGE_KEYS.experiment_samples];
    }
  };

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

  const closeScheduledExperimentRemovalConfirm = () => {
    scheduledExperimentRemovalModal.close();
    scheduledExperimentRemovalDraft.value = null;
  };

  const performTaskUpdate = async (draft, options = {}) => {
    const { previousCode, tasks, updatedTask, affectedCodes = new Set(), experimentTypesChanged = false } = draft;
    const confirmRemoval = Boolean(options.confirmRemoveScheduledExperiments);

    try {
      await updateTaskByApi(
        editForm.value.id,
        confirmRemoval
          ? { ...updatedTask, confirm_remove_scheduled_experiments: true }
          : updatedTask,
      );
      rawTasks.value = tasks;
    } catch (error) {
      editWarning.value = buildFailureMessage("任务更新失败，请稍后重试", error);
      return;
    }

    // 任务号或样品数变化后，需要同步样品侧的任务绑定和编号。
    const syncedSamples = syncTaskSamples(rawSamples.value, updatedTask, previousCode, { preserveExistingCodes: true });
    const nextSamples = experimentTypesChanged
      ? resetSamplesForExperimentTypeChange(syncedSamples, taskCodeOf(updatedTask))
      : syncedSamples;
    const relatedUpdates = {
      [STORAGE_KEYS.samples]: nextSamples,
    };
    if (experimentTypesChanged) {
      const taskCodesToClean = new Set([previousCode, taskCodeOf(updatedTask)].map((code) => normalizeText(code)).filter(Boolean));
      relatedUpdates[STORAGE_KEYS.schedules] = rawSchedules.value.filter(
        (schedule) => !taskCodesToClean.has(taskCodeOf(schedule)),
      );
      relatedUpdates[STORAGE_KEYS.experiment_trays] = rawExperimentTrays.value.filter(
        (entry) => !taskCodesToClean.has(taskCodeOf(entry)),
      );
      relatedUpdates[STORAGE_KEYS.experiment_samples] = rawExperimentSamples.value.filter(
        (entry) => !taskCodesToClean.has(taskCodeOf(entry)),
      );
    } else if (affectedCodes.size > 0) {
      const taskCodesToClean = new Set([previousCode, taskCodeOf(updatedTask)].map((code) => normalizeText(code)).filter(Boolean));
      relatedUpdates[STORAGE_KEYS.schedules] = rawSchedules.value.filter(
        (schedule) => !(taskCodesToClean.has(taskCodeOf(schedule)) && affectedCodes.has(experimentCodeOf(schedule))),
      );
      relatedUpdates[STORAGE_KEYS.experiment_trays] = rawExperimentTrays.value.filter(
        (entry) => !(taskCodesToClean.has(taskCodeOf(entry)) && affectedCodes.has(experimentCodeOf(entry))),
      );
      relatedUpdates[STORAGE_KEYS.experiment_samples] = rawExperimentSamples.value.filter(
        (entry) => !(taskCodesToClean.has(taskCodeOf(entry)) && affectedCodes.has(experimentCodeOf(entry))),
      );
    }
    try {
      await persistRelated(relatedUpdates);
    } catch (error) {
      closeTaskDrawer();
      loadError.value = buildFailureMessage("任务已更新，但关联数据保存失败，请刷新后确认", error);
      return;
    }

    closeTaskDrawer();
    closeScheduledExperimentRemovalConfirm();
    try {
      await loadTasksPage();
      loadError.value = "";
    } catch (error) {
      loadError.value = buildFailureMessage("任务已更新，但任务列表刷新失败，请刷新后确认", error);
    }
  };

  const updateTask = async () => {
    if (Array.isArray(editForm.value.test_types)) {
      editForm.value.test_type = buildExperimentTypeSummary(editForm.value.test_types);
    }
    if (!Array.isArray(editForm.value.test_types) || editForm.value.test_types.length === 0) {
      editWarning.value = "请选择至少一个试验类型";
      return;
    }
    const sampleCountWarning = validateTaskSampleCount(editForm.value.sample_count);
    if (sampleCountWarning) {
      editWarning.value = sampleCountWarning;
      return;
    }
    const { previousCode, tasks } = updateTaskRecord(rawTasks.value, editForm.value);
    const updatedTask = tasks.find((task) => normalizeText(task?.id) === normalizeText(editForm.value.id));
    if (!updatedTask) {
      return;
    }
    const originalTask = rawTasks.value.find((task) => normalizeText(task?.id) === normalizeText(editForm.value.id));
    const originalTypes = collectExperimentTypes(originalTask?.test_types, originalTask?.test_type);
    const nextTypes = collectExperimentTypes(updatedTask?.test_types, updatedTask?.test_type);
    const experimentTypesChanged = !arraysEqual(originalTypes, nextTypes);
    if (experimentTypesChanged && taskStorageConfirmed(originalTask, rawSamples.value)) {
      editWarning.value = "该任务样品已在接驳区确认到货，不允许更改实验类型";
      return;
    }

    const scheduledRemoval = experimentTypesChanged
      ? resolveScheduledExperimentRemoval(taskCodeOf(originalTask), nextTypes)
      : { affectedCodes: new Set(), schedules: [] };
    const normalizedUpdatedTask = experimentTypesChanged
      ? {
          ...updatedTask,
          status: "待排程",
          transfer_status: "未入库",
          tray_codes: [],
        }
      : updatedTask;
    const normalizedTasks = experimentTypesChanged
      ? tasks.map((task) => (normalizeText(task?.id) === normalizeText(editForm.value.id) ? normalizedUpdatedTask : task))
      : tasks;
    const draft = {
      previousCode,
      tasks: normalizedTasks,
      updatedTask: normalizedUpdatedTask,
      affectedCodes: scheduledRemoval.affectedCodes,
      experimentTypesChanged,
    };
    if (experimentTypesChanged) {
      scheduledExperimentRemovalDraft.value = draft;
      scheduledExperimentRemovalModal.openWith({
        id: "task-scheduled-removal-confirm",
        schedules: scheduledRemoval.schedules,
      });
      return;
    }

    await performTaskUpdate(draft);
  };

  const confirmScheduledExperimentRemoval = async () => {
    if (!scheduledExperimentRemovalDraft.value) {
      closeScheduledExperimentRemovalConfirm();
      return;
    }
    await performTaskUpdate(scheduledExperimentRemovalDraft.value, { confirmRemoveScheduledExperiments: true });
  };

  const saveSampleCodes = async () => {
    const taskCode = normalizeText(editForm.value.code);
    const taskId = normalizeText(editForm.value.id);
    const codes = splitSampleCodeText(sampleCodesDraft.value);
    const warning = validateSampleCodeDraft({
      codes,
      samples: rawSamples.value,
      taskCode,
    });
    if (warning) {
      sampleCodesWarning.value = warning;
      return;
    }
    const originalTask = rawTasks.value.find((task) => normalizeText(task?.id) === taskId);
    if (!originalTask) {
      sampleCodesWarning.value = "当前任务不存在，请刷新后重试";
      return;
    }

    const updatedTask = {
      ...originalTask,
      sample_count: codes.length,
      updated_at: new Date().toISOString(),
    };
    try {
      await updateTaskByApi(taskId, updatedTask);
      rawTasks.value = rawTasks.value.map((task) => (normalizeText(task?.id) === taskId ? updatedTask : task));
    } catch (error) {
      sampleCodesWarning.value = buildFailureMessage("样品编号保存失败，请稍后重试", error);
      return;
    }

    const currentCodes = taskDetailSampleCodes.value;
    const sampleCodeMap = new Map();
    currentCodes.forEach((code, index) => {
      const nextCode = normalizeText(codes[index]);
      const currentCode = normalizeText(code);
      if (currentCode && nextCode && currentCode !== nextCode) {
        sampleCodeMap.set(currentCode, nextCode);
      }
    });
    const currentCodeSet = new Set(currentCodes.map((code) => normalizeText(code)).filter(Boolean));
    const nextCodeSet = new Set(codes.map((code) => normalizeText(code)).filter(Boolean));
    const nextSamples = applyTaskSampleCodes(rawSamples.value, updatedTask, codes);
    const nextExperimentSamples = rawExperimentSamples.value.map((entry) => {
      if (normalizeText(entry?.task_code) !== taskCode) {
        return entry;
      }
      const currentCode = normalizeText(entry?.sample_code);
      const nextCode = sampleCodeMap.get(currentCode) || currentCode;
      return nextCode ? { ...entry, sample_code: nextCode } : entry;
    }).filter((entry) => {
      if (normalizeText(entry?.task_code) !== taskCode) {
        return true;
      }
      const sampleCode = normalizeText(entry?.sample_code);
      return !currentCodeSet.has(sampleCode) || nextCodeSet.has(sampleCode);
    });
    try {
      await persistRelated({
        [STORAGE_KEYS.samples]: nextSamples,
        [STORAGE_KEYS.experiment_samples]: nextExperimentSamples,
      });
    } catch (error) {
      sampleCodesWarning.value = buildFailureMessage("样品编号已更新任务数量，但样品数据保存失败，请刷新后确认", error);
      return;
    }

    editForm.value.sample_count = String(codes.length);
    closeSampleCodesEditor();
    try {
      await loadTasksPage();
      loadError.value = "";
    } catch (error) {
      loadError.value = buildFailureMessage("样品编号已保存，但任务列表刷新失败，请刷新后确认", error);
    }
  };

  const deleteTask = async () => {
    // 删除动作会连带清理该任务关联的排程、样品和数据流快照。
    const nextSnapshot = deleteTaskSnapshot(
      {
        samples: rawSamples.value,
        schedules: rawSchedules.value,
        streams: rawStreams.value,
        tasks: rawTasks.value,
      },
      editForm.value.id,
    );

    try {
      await deleteTaskByApi(editForm.value.id);
      rawTasks.value = nextSnapshot.tasks;
    } catch (error) {
      editWarning.value = buildFailureMessage("任务删除失败，请稍后重试", error);
      return;
    }

    try {
      await persistRelated({
        [STORAGE_KEYS.schedules]: nextSnapshot.schedules,
        [STORAGE_KEYS.samples]: nextSnapshot.samples,
        [STORAGE_KEYS.streams]: nextSnapshot.streams,
      });
    } catch (error) {
      closeTaskDrawer();
      loadError.value = buildFailureMessage("任务已删除，但关联数据保存失败，请刷新后确认", error);
      return;
    }

    closeTaskDrawer();
    try {
      rawTasks.value = await readAllTasks();
      loadError.value = "";
    } catch (error) {
      loadError.value = buildFailureMessage("任务已删除，但任务列表刷新失败，请刷新后确认", error);
    }
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
      await loadTasksPage();
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent(SNAPSHOT_UPDATED_EVENT, {
          detail: { source: "tasks", reason: "reset" },
        }));
      }
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
        loadSnapshot(),
        readMasterTestTypes().catch(() => []),
      ]);
      rawTasks.value = Array.isArray(tasks) ? tasks : [];
      rawSchedules.value = Array.isArray(snapshot[STORAGE_KEYS.schedules]) ? snapshot[STORAGE_KEYS.schedules] : [];
      rawSamples.value = Array.isArray(snapshot[STORAGE_KEYS.samples]) ? snapshot[STORAGE_KEYS.samples] : [];
      rawStreams.value = Array.isArray(snapshot[STORAGE_KEYS.streams]) ? snapshot[STORAGE_KEYS.streams] : [];
      rawExperiments.value = Array.isArray(snapshot[STORAGE_KEYS.experiments]) ? snapshot[STORAGE_KEYS.experiments] : [];
      rawExperimentTrays.value = Array.isArray(snapshot[STORAGE_KEYS.experiment_trays]) ? snapshot[STORAGE_KEYS.experiment_trays] : [];
      rawExperimentSamples.value = Array.isArray(snapshot[STORAGE_KEYS.experiment_samples]) ? snapshot[STORAGE_KEYS.experiment_samples] : [];
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

  const isRealtimeRefreshPaused = () => Boolean(
    intakeModal.open.value
    || intakeExperimentModal.open.value
    || editExperimentModal.open.value
    || sampleCodesModal.open.value
    || scheduledExperimentRemovalModal.open.value
    || resetModal.open.value
    || (taskDrawer.open.value && isTaskEditFormDirty())
  );

  const flushPendingRealtimeRefresh = () => {
    const flushedStorage = flushPendingStorageRefresh();
    if (!hasPendingSamplesRefresh || isRealtimeRefreshPaused()) {
      return flushedStorage;
    }
    hasPendingSamplesRefresh = false;
    if (!flushedStorage) {
      void loadTasksPage();
    }
    return true;
  };

  const handleSamplesUpdated = () => {
    if (isRealtimeRefreshPaused()) {
      hasPendingSamplesRefresh = true;
      return;
    }
    hasPendingSamplesRefresh = false;
    void loadTasksPage();
  };

  const storageRefresh = useStorageSnapshotRefresh({
    keys: [
      STORAGE_KEYS.tasks,
      STORAGE_KEYS.schedules,
      STORAGE_KEYS.samples,
      STORAGE_KEYS.streams,
      STORAGE_KEYS.experiments,
      STORAGE_KEYS.experiment_trays,
      STORAGE_KEYS.experiment_samples,
    ],
    refresh: loadTasksPage,
    paused: isRealtimeRefreshPaused,
  });
  flushPendingStorageRefresh = storageRefresh.flushPendingRefresh;

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
    window.addEventListener(TASK_RESET_EVENT, handleOpenTaskReset);
    window.addEventListener(SAMPLES_UPDATED_EVENT, handleSamplesUpdated);
    document.addEventListener("pointerdown", handleDocumentPointerDown);
  });

  onBeforeUnmount(() => {
    clearResetFeedbackTimer();
    window.removeEventListener("hashchange", handleHashChange);
    window.removeEventListener("mes:open-task-intake", handleOpenTaskIntake);
    window.removeEventListener(TASK_RESET_EVENT, handleOpenTaskReset);
    window.removeEventListener(SAMPLES_UPDATED_EVENT, handleSamplesUpdated);
    document.removeEventListener("pointerdown", handleDocumentPointerDown);
  });

  return {
    closeIntakeModal,
    closeResetModal,
    closeScheduledExperimentRemovalConfirm,
    closeSampleCodesEditor,
    closeTaskDrawer,
    confirmScheduledExperimentRemoval,
    currentPage,
    deleteTask,
    editForm,
    editWarning,
    filterStatus: selectedStatus,
    filterTestType: selectedTestType,
    intakeForm,
    intakeExperimentDraft,
    intakeExperimentDraftSummary,
    intakeExperimentModalOpen: intakeExperimentModal.open,
    intakeExperimentSummary,
    intakeExperimentTypeOptions,
    intakeModalOpen: intakeModal.open,
    intakeSampleCodePreview,
    intakeWarning,
    loadError,
    metrics,
    pageCount,
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
    openIntakeExperimentPicker,
    openEditExperimentPicker,
    openSampleCodesEditor,
    sortDirection,
    sortKey,
    submitTask,
    taskDrawerOpen: taskDrawer.open,
    taskDetailSampleCodePreview,
    taskDetailSampleCodes,
    taskRows: visibleRows,
    testTypeOptions: computed(() => filterOptions.value.testTypeOptions),
    toggleIntakeExperimentType,
    toggleEditExperimentType,
    toggleSort,
    updateTask,
    openTaskDrawer,
  };
}

export { useTasksPage };
