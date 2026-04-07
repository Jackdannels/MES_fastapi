import { computed, onMounted, ref, watch } from "vue";

import { useStorageSnapshot } from "@/composables/useStorageSnapshot";
import { STORAGE_KEYS } from "@/lib/storageKeys";
import { SAMPLES_UPDATED_EVENT } from "@/modules/samples/useSampleIntake";
import {
  applyLaboratoryTaskStep,
  buildLaboratoryChecklist,
  buildLaboratoryProgressMessage,
  buildLaboratorySummary,
  buildLaboratoryWorkflowFromTask,
  buildSaltSprayLaboratoryView,
  LAB_COMPARE_STATUS,
  LAB_INSTALL_STATUS,
  LAB_READY_STATUS,
  getLaboratoryActionState,
  validateLaboratoryTrayScan,
} from "./model";

function useLaboratoryPage(options = {}) {
  const now = options.now;
  const storage =
    options.storage ||
    useStorageSnapshot([
      STORAGE_KEYS.tasks,
      STORAGE_KEYS.schedules,
      STORAGE_KEYS.experiments,
      STORAGE_KEYS.experiment_trays,
      STORAGE_KEYS.samples,
    ]);
  const loadSnapshot = options.loadSnapshot || storage.loadSnapshot;
  const persistSnapshot = options.persistSnapshot || storage.persistSnapshot || (async () => {});

  const loading = ref(false);
  const tasks = ref([]);
  const schedules = ref([]);
  const experiments = ref([]);
  const experimentTrays = ref([]);
  const samples = ref([]);

  const selectedTaskCode = ref("");
  const selectedTrayCode = ref("");
  const pendingTaskCode = ref("");
  const compareScanCode = ref("");
  const compareFeedback = ref(null);
  const verifiedTrayCodes = ref([]);
  const scheduleModalOpen = ref(false);
  const taskListModalOpen = ref(false);
  const compareModalOpen = ref(false);
  const installModalOpen = ref(false);
  const readyModalOpen = ref(false);
  const confirmedModalOpen = ref(false);

  const view = computed(() =>
    buildSaltSprayLaboratoryView({
      experiments: experiments.value,
      experimentTrays: experimentTrays.value,
      now: now || new Date(),
      samples: samples.value,
      selectedTaskCode: selectedTaskCode.value,
      selectedTrayCode: selectedTrayCode.value,
      schedules: schedules.value,
      tasks: tasks.value,
    }),
  );

  const summary = computed(() => buildLaboratorySummary(view.value.scheduleRows, now || new Date()));
  const currentTask = computed(() => view.value.currentTask);
  const checklist = computed(() => buildLaboratoryChecklist(currentTask.value));
  const workflow = computed(() => buildLaboratoryWorkflowFromTask(currentTask.value));
  const actionState = computed(() => getLaboratoryActionState(workflow.value));
  const progressMessage = computed(() => buildLaboratoryProgressMessage(workflow.value, currentTask.value));
  const canCompleteCompare = computed(() => verifiedTrayCodes.value.length > 0);
  const canTeleportScheduleAction = computed(() => typeof document !== "undefined" && Boolean(document.querySelector(".header-actions")));

  watch(
    () => view.value.currentExperimentTrayRows,
    (trayRows) => {
      const trayList = Array.isArray(trayRows) ? trayRows : [];
      const normalizedSelectedTrayCode = String(selectedTrayCode.value || "").trim();
      if (!trayList.length) {
        selectedTrayCode.value = "";
        return;
      }
      if (!trayList.some((row) => String(row?.trayCode || "").trim() === normalizedSelectedTrayCode)) {
        selectedTrayCode.value = String(trayList[0]?.trayCode || "").trim();
      }
    },
    { deep: true, immediate: true },
  );

  const resetCompareState = () => {
    compareScanCode.value = "";
    compareFeedback.value = null;
    verifiedTrayCodes.value = [];
  };

  const load = async () => {
    loading.value = true;
    try {
      const snapshot = await loadSnapshot();
      tasks.value = Array.isArray(snapshot?.[STORAGE_KEYS.tasks]) ? snapshot[STORAGE_KEYS.tasks] : [];
      schedules.value = Array.isArray(snapshot?.[STORAGE_KEYS.schedules]) ? snapshot[STORAGE_KEYS.schedules] : [];
      experiments.value = Array.isArray(snapshot?.[STORAGE_KEYS.experiments]) ? snapshot[STORAGE_KEYS.experiments] : [];
      experimentTrays.value = Array.isArray(snapshot?.[STORAGE_KEYS.experiment_trays]) ? snapshot[STORAGE_KEYS.experiment_trays] : [];
      samples.value = Array.isArray(snapshot?.[STORAGE_KEYS.samples]) ? snapshot[STORAGE_KEYS.samples] : [];
    } finally {
      loading.value = false;
    }
  };

  onMounted(() => {
    void load();
  });

  const openScheduleBoard = () => {
    scheduleModalOpen.value = true;
  };
  const closeScheduleBoard = () => {
    scheduleModalOpen.value = false;
  };
  const openTaskList = () => {
    pendingTaskCode.value = currentTask.value?.taskCode || "";
    taskListModalOpen.value = true;
  };
  const closeTaskList = () => {
    taskListModalOpen.value = false;
  };
  const openCompare = () => {
    resetCompareState();
    compareModalOpen.value = true;
  };
  const closeCompare = () => {
    compareModalOpen.value = false;
  };
  const persistCurrentTaskStep = async (nextStatus, historyAction) => {
    const nextSamples = applyLaboratoryTaskStep({
      currentTask: currentTask.value,
      historyAction,
      nextStatus,
      now: new Date().toISOString(),
      samples: samples.value,
    });
    samples.value = nextSamples;
    await persistSnapshot({
      [STORAGE_KEYS.samples]: nextSamples,
    });
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(SAMPLES_UPDATED_EVENT));
    }
  };
  const confirmCompare = async () => {
    if (!canCompleteCompare.value) {
      return;
    }
    await persistCurrentTaskStep(LAB_COMPARE_STATUS, "任务比对");
    compareModalOpen.value = false;
    resetCompareState();
  };
  const submitCompareScan = () => {
    const result = validateLaboratoryTrayScan({
      allScheduleRows: view.value.allScheduleRows,
      currentTask: currentTask.value,
      scanCode: compareScanCode.value,
      scheduleRows: view.value.scheduleRows,
    });
    compareFeedback.value = result;
    if (result.ok && !verifiedTrayCodes.value.includes(result.trayCode)) {
      verifiedTrayCodes.value = [...verifiedTrayCodes.value, result.trayCode];
    }
    compareScanCode.value = "";
  };
  const openInstall = () => {
    installModalOpen.value = true;
  };
  const closeInstall = () => {
    installModalOpen.value = false;
  };
  const confirmInstall = async () => {
    await persistCurrentTaskStep(LAB_INSTALL_STATUS, "样品安装");
    installModalOpen.value = false;
  };
  const openReady = () => {
    readyModalOpen.value = true;
  };
  const closeReady = () => {
    readyModalOpen.value = false;
  };
  const confirmReady = async () => {
    await persistCurrentTaskStep(LAB_READY_STATUS, "实验确认");
    readyModalOpen.value = false;
    confirmedModalOpen.value = true;
  };
  const closeConfirmed = () => {
    confirmedModalOpen.value = false;
  };
  const confirmCurrentTask = () => {
    if (!pendingTaskCode.value) {
      return;
    }
    selectedTaskCode.value = pendingTaskCode.value;
    resetCompareState();
    taskListModalOpen.value = false;
  };

  return {
    actionState,
    canTeleportScheduleAction,
    checklist,
    compareFeedback,
    closeCompare,
    closeConfirmed,
    closeInstall,
    closeReady,
    closeScheduleBoard,
    closeTaskList,
    compareScanCode,
    compareModalOpen,
    confirmCurrentTask,
    confirmCompare,
    confirmInstall,
    confirmReady,
    confirmedModalOpen,
    installModalOpen,
    loading,
    canCompleteCompare,
    currentTask,
    openCompare,
    openInstall,
    openReady,
    openScheduleBoard,
    openTaskList,
    currentTaskFlow: computed(() => view.value.currentTaskFlow),
    currentExperimentTrayRows: computed(() => view.value.currentExperimentTrayRows),
    pendingTaskCode,
    progressMessage,
    readyModalOpen,
    recentTasks: computed(() => view.value.scheduleRows),
    scheduleModalOpen,
    scheduleRows: computed(() => view.value.scheduleRows),
    setPendingTaskCode: (taskCode) => {
      pendingTaskCode.value = String(taskCode ?? "");
    },
    summary,
    submitCompareScan,
    selectedTrayCode,
    selectedTrayFlow: computed(() => view.value.selectedTrayFlow),
    selectedTrayRow: computed(() => view.value.selectedTrayRow),
    setSelectedTrayCode: (trayCode) => {
      selectedTrayCode.value = String(trayCode ?? "");
    },
    taskListModalOpen,
    verifiedTrayCodes,
  };
}

export { useLaboratoryPage };
