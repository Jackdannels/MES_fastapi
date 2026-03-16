import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";

import { useDialogState } from "@/composables/useDialogState";
import { useStorageSnapshot } from "@/composables/useStorageSnapshot";
import { useTableControls } from "@/composables/useTableControls";
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
} from "@/lib/tasksPageModel";
import { STORAGE_KEYS } from "@/lib/storageKeys";

const TASK_INTAKE_HASH = "#task-intake-modal";

function useTasksPage() {
  const route = useRoute();
  const { loadSnapshot, persistSnapshot } = useStorageSnapshot([
    STORAGE_KEYS.tasks,
    STORAGE_KEYS.schedules,
    STORAGE_KEYS.samples,
    STORAGE_KEYS.streams,
  ]);

  const rawTasks = ref([]);
  const rawSchedules = ref([]);
  const rawSamples = ref([]);
  const rawStreams = ref([]);
  const intakeForm = ref(createTaskIntakeForm());
  const editForm = ref(createTaskEditForm());
  const intakeWarning = ref("");
  const editWarning = ref("");
  const selectedTestType = ref("");
  const selectedStatus = ref("");
  const intakeRequiredDeviceAutoValue = ref("");

  const intakeModal = useDialogState();
  const taskDrawer = useDialogState();

  const allRows = computed(() => buildTaskRows(rawTasks.value, rawSchedules.value));
  const metrics = computed(() => buildTaskMetrics(allRows.value));
  const filterOptions = computed(() => buildFilterOptions(allRows.value));

  const filteredRows = computed(() =>
    allRows.value.filter((row) => {
      if (selectedTestType.value && row.testType !== selectedTestType.value) {
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
    searchFields: ["code", "name", "source", "requiredDevice", "testType", "displayStatus"],
    pageSize: 8,
  });

  const toggleSort = (nextKey) => {
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
    const nextCode = buildTaskCode(intakeForm.value.test_type, rawTasks.value);
    intakeForm.value.code = nextCode;

    if (
      !normalizeText(intakeForm.value.required_device) ||
      normalizeText(intakeForm.value.required_device) === normalizeText(intakeRequiredDeviceAutoValue.value)
    ) {
      intakeForm.value.required_device = intakeForm.value.test_type || "";
      intakeRequiredDeviceAutoValue.value = intakeForm.value.test_type || "";
    }
  };

  const resetIntakeForm = () => {
    intakeForm.value = createTaskIntakeForm();
    intakeWarning.value = "";
    intakeRequiredDeviceAutoValue.value = "";
    syncIntakeDerivedFields();
  };

  const removeTaskHash = () => {
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
    removeTaskHash();
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

  const persistAll = async (updates) => {
    if (Array.isArray(updates[STORAGE_KEYS.tasks])) {
      rawTasks.value = updates[STORAGE_KEYS.tasks];
    }
    if (Array.isArray(updates[STORAGE_KEYS.schedules])) {
      rawSchedules.value = updates[STORAGE_KEYS.schedules];
    }
    if (Array.isArray(updates[STORAGE_KEYS.samples])) {
      rawSamples.value = updates[STORAGE_KEYS.samples];
    }
    if (Array.isArray(updates[STORAGE_KEYS.streams])) {
      rawStreams.value = updates[STORAGE_KEYS.streams];
    }
    await persistSnapshot(updates);
  };

  const submitTask = async () => {
    if (isTaskIntakeFormPristine(intakeForm.value)) {
      intakeForm.value = createRandomTaskIntakeForm();
      syncIntakeDerivedFields();
    }

    if (!normalizeText(intakeForm.value.name)) {
      intakeWarning.value = "请填写任务名称";
      return;
    }

    const nextTask = createTaskRecord(intakeForm.value, rawTasks.value);
    const nextTasks = [nextTask, ...rawTasks.value];
    const nextSamples = syncTaskSamples(rawSamples.value, nextTask);

    await persistAll({
      [STORAGE_KEYS.tasks]: nextTasks,
      [STORAGE_KEYS.samples]: nextSamples,
    });

    closeIntakeModal();
    resetIntakeForm();
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

    const nextSamples = syncTaskSamples(rawSamples.value, updatedTask, previousCode);
    await persistAll({
      [STORAGE_KEYS.tasks]: tasks,
      [STORAGE_KEYS.samples]: nextSamples,
    });
    closeTaskDrawer();
  };

  const deleteTask = async () => {
    const nextSnapshot = deleteTaskSnapshot(
      {
        samples: rawSamples.value,
        schedules: rawSchedules.value,
        streams: rawStreams.value,
        tasks: rawTasks.value,
      },
      editForm.value.id,
    );

    await persistAll({
      [STORAGE_KEYS.tasks]: nextSnapshot.tasks,
      [STORAGE_KEYS.schedules]: nextSnapshot.schedules,
      [STORAGE_KEYS.samples]: nextSnapshot.samples,
      [STORAGE_KEYS.streams]: nextSnapshot.streams,
    });
    closeTaskDrawer();
  };

  const loadTasksPage = async () => {
    const snapshot = await loadSnapshot();
    rawTasks.value = Array.isArray(snapshot[STORAGE_KEYS.tasks]) ? snapshot[STORAGE_KEYS.tasks] : [];
    rawSchedules.value = Array.isArray(snapshot[STORAGE_KEYS.schedules]) ? snapshot[STORAGE_KEYS.schedules] : [];
    rawSamples.value = Array.isArray(snapshot[STORAGE_KEYS.samples]) ? snapshot[STORAGE_KEYS.samples] : [];
    rawStreams.value = Array.isArray(snapshot[STORAGE_KEYS.streams]) ? snapshot[STORAGE_KEYS.streams] : [];
    syncIntakeDerivedFields();
    syncModalWithHash(route.hash || (typeof window !== "undefined" ? window.location.hash : ""));
  };

  watch(
    () => intakeForm.value.test_type,
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
  });

  onBeforeUnmount(() => {
    window.removeEventListener("hashchange", handleHashChange);
    window.removeEventListener("mes:open-task-intake", handleOpenTaskIntake);
  });

  return {
    closeIntakeModal,
    closeTaskDrawer,
    currentPage,
    deleteTask,
    editForm,
    editWarning,
    filterStatus: selectedStatus,
    filterTestType: selectedTestType,
    intakeForm,
    intakeModalOpen: intakeModal.open,
    intakeWarning,
    metrics,
    pageCount,
    query,
    saveDraft,
    selectedRow: taskDrawer.payload,
    setCurrentPage,
    statusOptions: computed(() => filterOptions.value.statusOptions),
    submitTask,
    taskDrawerOpen: taskDrawer.open,
    taskRows: visibleRows,
    testTypeOptions: computed(() => filterOptions.value.testTypeOptions),
    toggleSort,
    updateTask,
    openTaskDrawer,
  };
}

export { useTasksPage };
