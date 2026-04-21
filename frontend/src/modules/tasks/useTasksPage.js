// 负责任务受理页的新增、筛选、编辑和持久化流程。
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";

import { useDialogState } from "@/composables/useDialogState";
import { useStorageSnapshot } from "@/composables/useStorageSnapshot";
import { useTableControls } from "@/composables/useTableControls";
import { buildExperimentTypeOptions, buildExperimentTypeSummary, matchesExperimentTypeFilter } from "@/lib/experimentTypes";
import { TEST_PREFIX_MAP } from "@/lib/labs";
import { createTask, deleteTask as deleteTaskByApi, readTasks, resetTasks as resetTasksByApi, updateTask as updateTaskByApi } from "@/lib/tasksApi";
import { SAMPLES_UPDATED_EVENT } from "@/modules/samples/useSampleIntake";
import {
  STATUS_WAITING,
  buildFilterOptions,
  buildTaskCode,
  buildTaskEditForm,
  buildTaskMetrics,
  buildTaskRows,
  createTaskEditForm,
  createTaskIntakeForm,
  createRandomTaskIntakeForm,
  createTaskRecord,
  deleteTaskSnapshot,
  isTaskIntakeFormPristine,
  normalizeText,
  syncTaskSamples,
  updateTaskRecord,
} from "./model";
import { STORAGE_KEYS } from "@/lib/storageKeys";

const TASK_INTAKE_HASH = "#task-intake-modal";
const TASK_RESET_EVENT = "mes:open-task-reset";

// 将存储快照与弹窗、抽屉、表格状态连接起来，供任务页统一使用。
function useTasksPage() {
  const route = useRoute();
  const { loadSnapshot, persistSnapshot } = useStorageSnapshot([
    STORAGE_KEYS.tasks,
    STORAGE_KEYS.schedules,
    STORAGE_KEYS.samples,
    STORAGE_KEYS.streams,
    STORAGE_KEYS.experiments,
  ]);

  const rawTasks = ref([]);
  const rawSchedules = ref([]);
  const rawSamples = ref([]);
  const rawStreams = ref([]);
  const rawExperiments = ref([]);
  const loadError = ref("");
  const resetFeedback = ref("");
  const resetError = ref("");
  const resetting = ref(false);
  const intakeForm = ref(createTaskIntakeForm());
  const editForm = ref(createTaskEditForm());
  const intakeWarning = ref("");
  const editWarning = ref("");
  const intakeExperimentDraft = ref([]);
  const selectedTestType = ref("");
  const selectedStatus = ref("");

  const intakeModal = useDialogState();
  const intakeExperimentModal = useDialogState();
  const resetModal = useDialogState();
  const taskDrawer = useDialogState();

  const allRows = computed(() => buildTaskRows(rawTasks.value, rawSchedules.value, rawSamples.value, rawExperiments.value));
  const metrics = computed(() => buildTaskMetrics(allRows.value));
  const filterOptions = computed(() => buildFilterOptions(allRows.value));
  const intakeExperimentTypeOptions = computed(() =>
    buildExperimentTypeOptions(Object.keys(TEST_PREFIX_MAP), filterOptions.value.testTypeOptions),
  );
  const intakeExperimentSummary = computed(() => buildExperimentTypeSummary(intakeForm.value.test_types));
  const intakeExperimentDraftSummary = computed(() => buildExperimentTypeSummary(intakeExperimentDraft.value));

  const filteredRows = computed(() =>
    allRows.value.filter((row) => {
      // 两个下拉筛选先于表格搜索执行，缩小后续搜索数据集。
      if (!matchesExperimentTypeFilter(selectedTestType.value, row.testType, row.experimentSummary)) {
        return false;
      }
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

  const removeTaskHash = () => {
    // 关闭弹窗时清掉 hash，避免刷新或后退时重复拉起受理弹窗。
    if (typeof window === "undefined" || window.location.hash !== TASK_INTAKE_HASH) {
      return;
    }
    const url = `${window.location.pathname}${window.location.search}`;
    window.history.replaceState(null, "", url);
  };

  const openIntakeModal = () => {
    resetIntakeForm();
    intakeModal.openWith({ id: "task-intake-modal" });
  };

  const closeIntakeModal = () => {
    intakeModal.close();
    intakeExperimentModal.close();
    intakeExperimentDraft.value = [];
    removeTaskHash();
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
    const normalizedType = normalizeText(experimentType);
    if (!normalizedType) {
      return;
    }
    const currentTypes = Array.isArray(intakeExperimentDraft.value) ? [...intakeExperimentDraft.value] : [];
    const targetIndex = currentTypes.findIndex((entry) => normalizeText(entry) === normalizedType);
    if (targetIndex >= 0) {
      currentTypes.splice(targetIndex, 1);
    } else {
      currentTypes.push(normalizedType);
    }
    intakeExperimentDraft.value = currentTypes;
  };

  const confirmIntakeExperimentPicker = () => {
    intakeForm.value.test_types = Array.isArray(intakeExperimentDraft.value) ? [...intakeExperimentDraft.value] : [];
    intakeWarning.value = "";
    syncIntakeDerivedFields();
    closeIntakeExperimentPicker();
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
  };

  const openTaskDrawer = (row) => {
    editForm.value = buildTaskEditForm(row);
    editWarning.value = "";
    taskDrawer.openWith(row);
  };

  const closeTaskDrawer = () => {
    taskDrawer.close();
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
  };

  const submitTask = async () => {
    // 空白表单直接提交时自动填充随机演示数据，方便快速联调。
    if (isTaskIntakeFormPristine(intakeForm.value)) {
      intakeForm.value = createRandomTaskIntakeForm();
      syncIntakeDerivedFields();
    }

    if (!normalizeText(intakeForm.value.name)) {
      intakeWarning.value = "请填写任务名称";
      return;
    }
    if (intakeForm.value.test_types.length === 0) {
      intakeWarning.value = "请选择至少一个试验类型";
      return;
    }

    const nextTask = createTaskRecord(intakeForm.value, rawTasks.value);
    // 任务创建后立即同步样品编号，保持任务与样品侧数据一致。
    const nextSamples = syncTaskSamples(rawSamples.value, nextTask);
    try {
      await createTask(nextTask);
      rawTasks.value = [nextTask, ...rawTasks.value];
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
      rawTasks.value = await readTasks();
      loadError.value = "";
    } catch (error) {
      loadError.value = buildFailureMessage("任务已创建，但任务列表刷新失败，请刷新后确认", error);
    }
  };

  const saveDraft = async () => {
    await submitTask();
  };

  const updateTask = async () => {
    const { previousCode, tasks } = updateTaskRecord(rawTasks.value, editForm.value);
    const updatedTask = tasks.find((task) => normalizeText(task?.id) === normalizeText(editForm.value.id));
    if (!updatedTask) {
      return;
    }

    try {
      await updateTaskByApi(editForm.value.id, updatedTask);
      rawTasks.value = tasks;
    } catch (error) {
      editWarning.value = buildFailureMessage("任务更新失败，请稍后重试", error);
      return;
    }

    // 任务号或样品数变化后，需要同步样品侧的任务绑定和编号。
    const nextSamples = syncTaskSamples(rawSamples.value, updatedTask, previousCode);
    try {
      await persistRelated({
        [STORAGE_KEYS.samples]: nextSamples,
      });
    } catch (error) {
      closeTaskDrawer();
      loadError.value = buildFailureMessage("任务已更新，但关联数据保存失败，请刷新后确认", error);
      return;
    }

    closeTaskDrawer();
    try {
      rawTasks.value = await readTasks();
      loadError.value = "";
    } catch (error) {
      loadError.value = buildFailureMessage("任务已更新，但任务列表刷新失败，请刷新后确认", error);
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
      rawTasks.value = await readTasks();
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
    resetFeedback.value = "";
    try {
      const summary = await resetTasksByApi();
      resetModal.close();
      await loadTasksPage();
      resetFeedback.value = `任务数据已重置，共重建 ${summary.task_count} 个任务。`;
    } catch (error) {
      resetError.value = buildFailureMessage("任务重置失败，请稍后重试", error);
    } finally {
      resetting.value = false;
    }
  };

  const loadTasksPage = async () => {
    try {
      const [tasks, snapshot] = await Promise.all([readTasks(), loadSnapshot()]);
      rawTasks.value = Array.isArray(tasks) ? tasks : [];
      rawSchedules.value = Array.isArray(snapshot[STORAGE_KEYS.schedules]) ? snapshot[STORAGE_KEYS.schedules] : [];
      rawSamples.value = Array.isArray(snapshot[STORAGE_KEYS.samples]) ? snapshot[STORAGE_KEYS.samples] : [];
      rawStreams.value = Array.isArray(snapshot[STORAGE_KEYS.streams]) ? snapshot[STORAGE_KEYS.streams] : [];
      rawExperiments.value = Array.isArray(snapshot[STORAGE_KEYS.experiments]) ? snapshot[STORAGE_KEYS.experiments] : [];
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
    syncModalWithHash(route.hash || (typeof window !== "undefined" ? window.location.hash : ""));
  };

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
    window.addEventListener(SAMPLES_UPDATED_EVENT, loadTasksPage);
  });

  onBeforeUnmount(() => {
    window.removeEventListener("hashchange", handleHashChange);
    window.removeEventListener("mes:open-task-intake", handleOpenTaskIntake);
    window.removeEventListener(TASK_RESET_EVENT, handleOpenTaskReset);
    window.removeEventListener(SAMPLES_UPDATED_EVENT, loadTasksPage);
  });

  return {
    closeIntakeModal,
    closeResetModal,
    closeTaskDrawer,
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
    saveDraft,
    selectedRow: taskDrawer.payload,
    setCurrentPage,
    statusOptions: computed(() => filterOptions.value.statusOptions),
    closeIntakeExperimentPicker,
    confirmIntakeExperimentPicker,
    openIntakeExperimentPicker,
    sortDirection,
    sortKey,
    submitTask,
    taskDrawerOpen: taskDrawer.open,
    taskRows: visibleRows,
    testTypeOptions: computed(() => filterOptions.value.testTypeOptions),
    toggleIntakeExperimentType,
    toggleSort,
    updateTask,
    openTaskDrawer,
  };
}

export { useTasksPage };
