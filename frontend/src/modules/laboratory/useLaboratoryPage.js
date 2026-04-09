import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";

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

const RUNNING_MODAL_RESTORE_MS = 10_000;

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
  const completePromptVisible = ref(false);
  const runningModalVisible = ref(false);
  const tickNow = ref(now || new Date());
  let tickTimer = null;
  let runningModalRestoreTimer = null;

  const view = computed(() =>
    buildSaltSprayLaboratoryView({
      experiments: experiments.value,
      experimentTrays: experimentTrays.value,
      now: tickNow.value,
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
  const runningExperiment = computed(() => view.value.runningExperiment);
  const canCompleteCompare = computed(() => verifiedTrayCodes.value.length > 0);
  const canTeleportScheduleAction = computed(() => typeof document !== "undefined" && Boolean(document.querySelector(".header-actions")));
  const runningInteractionLocked = computed(() => runningExperiment.value.active);

  const clearRunningModalRestoreTimer = () => {
    if (runningModalRestoreTimer && typeof window !== "undefined") {
      window.clearTimeout(runningModalRestoreTimer);
      runningModalRestoreTimer = null;
    }
  };

  const showRunningModal = () => {
    runningModalVisible.value = true;
    clearRunningModalRestoreTimer();
  };

  const scheduleRunningModalRestore = () => {
    clearRunningModalRestoreTimer();
    if (!runningExperiment.value.active || runningModalVisible.value || typeof window === "undefined") {
      return;
    }
    runningModalRestoreTimer = window.setTimeout(() => {
      runningModalVisible.value = true;
      runningModalRestoreTimer = null;
    }, RUNNING_MODAL_RESTORE_MS);
  };

  const hideRunningModal = () => {
    if (!runningExperiment.value.active) {
      return;
    }
    runningModalVisible.value = false;
    scheduleRunningModalRestore();
  };

  const handleRunningModalActivity = () => {
    if (!runningExperiment.value.active || runningModalVisible.value) {
      return;
    }
    scheduleRunningModalRestore();
  };

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

  watch(
    () => runningExperiment.value.active,
    (active) => {
      if (active) {
        showRunningModal();
        return;
      }
      runningModalVisible.value = false;
      completePromptVisible.value = false;
      clearRunningModalRestoreTimer();
    },
    { immediate: true },
  );

  watch(
    () => runningExperiment.value.remainingSeconds,
    (remainingSeconds) => {
      if (!runningExperiment.value.active || remainingSeconds > 0) {
        return;
      }
      completePromptVisible.value = true;
    },
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
    if (typeof window !== "undefined") {
      tickTimer = window.setInterval(() => {
        tickNow.value = now || new Date();
      }, 1000);
      window.addEventListener("pointerdown", handleRunningModalActivity, true);
      window.addEventListener("mousemove", handleRunningModalActivity, true);
      window.addEventListener("wheel", handleRunningModalActivity, true);
      window.addEventListener("touchstart", handleRunningModalActivity, true);
      window.addEventListener("keydown", handleRunningModalActivity, true);
    }
    void load();
  });

  onBeforeUnmount(() => {
    if (tickTimer && typeof window !== "undefined") {
      window.clearInterval(tickTimer);
      tickTimer = null;
    }
    if (typeof window !== "undefined") {
      window.removeEventListener("pointerdown", handleRunningModalActivity, true);
      window.removeEventListener("mousemove", handleRunningModalActivity, true);
      window.removeEventListener("wheel", handleRunningModalActivity, true);
      window.removeEventListener("touchstart", handleRunningModalActivity, true);
      window.removeEventListener("keydown", handleRunningModalActivity, true);
    }
    clearRunningModalRestoreTimer();
  });

  const openScheduleBoard = () => {
    if (runningInteractionLocked.value) {
      return;
    }
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
    if (runningInteractionLocked.value) {
      return;
    }
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
    if (runningInteractionLocked.value) {
      return;
    }
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
    if (runningInteractionLocked.value) {
      return;
    }
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
  const openCompleteConfirm = () => {
    if (!runningExperiment.value?.active) {
      return;
    }
    completePromptVisible.value = true;
  };
  const closeCompleteConfirm = () => {
    completePromptVisible.value = false;
  };
  const confirmCompleteExperiment = async () => {
    if (!runningExperiment.value?.active) {
      return;
    }
    const nextSamples = applyLaboratoryTaskStep({
      currentTask: {
        ...currentTask.value,
        trayCodes: runningExperiment.value.trayCodes,
      },
      historyAction: "实验完成",
      nextStatus: "实验已完成",
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
    completePromptVisible.value = false;
    clearRunningModalRestoreTimer();
  };
  const confirmCurrentTask = () => {
    if (!pendingTaskCode.value || runningInteractionLocked.value) {
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
    closeCompleteConfirm,
    compareFeedback,
    closeCompare,
    closeConfirmed,
    closeInstall,
    closeReady,
    closeScheduleBoard,
      closeTaskList,
      compareScanCode,
      compareModalOpen,
      completePromptVisible,
      confirmCurrentTask,
      confirmCompare,
    confirmCompleteExperiment,
    confirmInstall,
    confirmReady,
    confirmedModalOpen,
    hideRunningModal,
    installModalOpen,
    loading,
    canCompleteCompare,
    runningInteractionLocked,
    currentTask,
    openCompare,
    openCompleteConfirm,
    openInstall,
    openReady,
    openScheduleBoard,
    openTaskList,
    showRunningModal,
    currentTaskFlow: computed(() => view.value.currentTaskFlow),
    currentExperimentTrayRows: computed(() => view.value.currentExperimentTrayRows),
    pendingTaskCode,
    progressMessage,
    readyModalOpen,
    recentTasks: computed(() => view.value.scheduleRows),
    runningExperiment,
    runningModalVisible,
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
