import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";

import { useScanInputFocus } from "@/composables/useScanInputFocus";
import { publishLaboratoryFixtureInstall, publishLaboratoryReady } from "@/lib/laboratoryMqApi";
import { readMasterLabs } from "@/lib/masterDataApi";
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
  revertLaboratoryTaskToPreDispatch,
  resetLaboratoryExperimentTrays,
  SALT_SPRAY_LAB,
  validateLaboratoryTrayScan,
} from "./model";

const RUNNING_MODAL_RESTORE_MS = 10_000;
const HEADER_ACTION_TARGET_SELECTOR = ".header-actions-before-logout";
const RESETTABLE_TRAY_STATUSES = new Set([LAB_COMPARE_STATUS, LAB_INSTALL_STATUS, LAB_READY_STATUS]);
const SWITCH_REVERTIBLE_TRAY_STATUSES = new Set([LAB_COMPARE_STATUS, LAB_INSTALL_STATUS, LAB_READY_STATUS]);
const SALT_SPRAY_LAB_ID = "salt-spray-lab-01";
const FIXTURE_CONFIRM_COUNTDOWN_SECONDS = 3;
const FIXTURE_CONFIRM_SUCCESS_MS = 1000;

const normalizeText = (value) => String(value ?? "").trim();

const createDefaultLaboratoryConfig = () => ({
  labId: SALT_SPRAY_LAB_ID,
  labName: SALT_SPRAY_LAB,
});

const resolveLaboratoryConfig = (masterLabs = []) => {
  const enabledLabs = (Array.isArray(masterLabs) ? masterLabs : []).filter((lab) => {
    if (Number(lab?.status ?? 1) === 0) {
      return false;
    }
    const type = normalizeText(lab?.type || lab?.lab_type);
    return !type || type === "实验室";
  });
  const matchedLab =
    enabledLabs.find((lab) => normalizeText(lab?.code || lab?.lab_code) === "LAB_SALT")
    || enabledLabs.find((lab) => normalizeText(lab?.name || lab?.lab_name) === SALT_SPRAY_LAB);
  if (!matchedLab) {
    return createDefaultLaboratoryConfig();
  }
  const labName = normalizeText(matchedLab?.name || matchedLab?.lab_name);
  return {
    labId: normalizeText(matchedLab?.mqttLabId || matchedLab?.mqtt_lab_id) || SALT_SPRAY_LAB_ID,
    labName: labName || SALT_SPRAY_LAB,
  };
};

const countTrayRowSamples = (trayRows) =>
  (Array.isArray(trayRows) ? trayRows : []).reduce((total, row) => {
    const sampleCodes = Array.isArray(row?.sampleCodes) ? row.sampleCodes : [];
    const quantity = Number(row?.quantity);
    return total + (sampleCodes.length || (Number.isFinite(quantity) && quantity > 0 ? quantity : 1));
  }, 0);

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
  const laboratoryConfig = ref(createDefaultLaboratoryConfig());
  const tasks = ref([]);
  const schedules = ref([]);
  const experiments = ref([]);
  const experimentTrays = ref([]);
  const samples = ref([]);

  const selectedTaskCode = ref("");
  const selectedTrayCode = ref("");
  const pendingTaskCode = ref("");
  const pendingRevertTask = ref(null);
  const compareScanCode = ref("");
  const compareScanInputRef = ref(null);
  const compareFeedback = ref(null);
  const verifiedTrayCodes = ref([]);
  const scheduleModalOpen = ref(false);
  const taskListModalOpen = ref(false);
  const compareModalOpen = ref(false);
  const installModalOpen = ref(false);
  const fixtureConfirmModalOpen = ref(false);
  const fixtureConfirmSuccessModalOpen = ref(false);
  const fixtureConfirmCountdown = ref(0);
  const readyModalOpen = ref(false);
  const confirmedModalOpen = ref(false);
  const resetConfirmModalOpen = ref(false);
  const resetDangerModalOpen = ref(false);
  const completePromptVisible = ref(false);
  const runningModalVisible = ref(false);
  const tickNow = ref(now || new Date());
  let tickTimer = null;
  let runningModalRestoreTimer = null;
  let fixtureConfirmTimer = null;
  let fixtureConfirmSuccessTimer = null;
  let samplesPersistQueue = null;

  const view = computed(() =>
    buildSaltSprayLaboratoryView({
      experiments: experiments.value,
      experimentTrays: experimentTrays.value,
      now: tickNow.value,
      samples: samples.value,
      selectedTaskCode: selectedTaskCode.value,
      selectedTrayCode: selectedTrayCode.value,
      labName: laboratoryConfig.value.labName,
      schedules: schedules.value,
      tasks: tasks.value,
    }),
  );

  const summary = computed(() => buildLaboratorySummary(view.value.scheduleRows, now || new Date()));
  const currentTask = computed(() => view.value.currentTask);
  const checklist = computed(() => buildLaboratoryChecklist(currentTask.value));
  const workflow = computed(() => buildLaboratoryWorkflowFromTask(currentTask.value));
  const hasLaboratoryTasks = computed(() => view.value.scheduleRows.length > 0);
  const laboratoryTaskNotice = computed(() => {
    if (!hasLaboratoryTasks.value) {
      return `当前${laboratoryConfig.value.labName}暂无任务，请先在排程看板安排任务后再进行比对。`;
    }
    if (!currentTask.value) {
      return "请先在查看任务中选择一个任务，再开启实验流程。";
    }
    return "";
  });
  const actionState = computed(() => {
    const state = getLaboratoryActionState(workflow.value);
    if (!currentTask.value) {
      return {
        canCompare: false,
        canInstallSample: false,
        canMarkReady: false,
      };
    }
    return state;
  });
  const { focusScanInput } = useScanInputFocus(compareScanInputRef);
  const progressMessage = computed(() => buildLaboratoryProgressMessage(workflow.value, currentTask.value));
  const runningExperiment = computed(() => view.value.runningExperiment);
  const canCompleteCompare = computed(() => verifiedTrayCodes.value.length > 0);
  const canTeleportScheduleAction = ref(false);
  const runningInteractionLocked = computed(() => runningExperiment.value.active);
  const canResetCurrentTask = computed(() => {
    const trayRows = Array.isArray(currentTask.value?.trayRows) ? currentTask.value.trayRows : [];
    return (
      trayRows.length > 0
      && trayRows.every((row) => RESETTABLE_TRAY_STATUSES.has(String(row?.trayStatus ?? "").trim()))
      && !runningInteractionLocked.value
    );
  });

  const clearRunningModalRestoreTimer = () => {
    if (runningModalRestoreTimer && typeof window !== "undefined") {
      window.clearTimeout(runningModalRestoreTimer);
      runningModalRestoreTimer = null;
    }
  };
  const clearFixtureConfirmTimer = () => {
    if (fixtureConfirmTimer && typeof window !== "undefined") {
      window.clearInterval(fixtureConfirmTimer);
      fixtureConfirmTimer = null;
    }
  };
  const clearFixtureConfirmSuccessTimer = () => {
    if (fixtureConfirmSuccessTimer && typeof window !== "undefined") {
      window.clearTimeout(fixtureConfirmSuccessTimer);
      fixtureConfirmSuccessTimer = null;
    }
  };

  const syncHeaderActionTarget = () => {
    canTeleportScheduleAction.value = typeof document !== "undefined" && Boolean(document.querySelector(HEADER_ACTION_TARGET_SELECTOR));
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

  const taskSelectionKey = (task) => String(task?.experimentKey || task?.id || task?.taskCode || "").trim();

  const taskHasSwitchRevertibleTrays = (task) =>
    (Array.isArray(task?.trayRows) ? task.trayRows : []).some((row) =>
      SWITCH_REVERTIBLE_TRAY_STATUSES.has(String(row?.trayStatus || row?.displayStatus || "").trim()),
    );

  const load = async () => {
    loading.value = true;
    try {
      const [snapshot, masterLabs] = await Promise.all([
        loadSnapshot(),
        readMasterLabs().catch(() => []),
      ]);
      laboratoryConfig.value = resolveLaboratoryConfig(masterLabs);
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
    void nextTick().then(syncHeaderActionTarget);
    if (typeof window !== "undefined") {
      tickTimer = window.setInterval(() => {
        tickNow.value = now || new Date();
      }, 1000);
      window.addEventListener(SAMPLES_UPDATED_EVENT, load);
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
      window.removeEventListener(SAMPLES_UPDATED_EVENT, load);
      window.removeEventListener("pointerdown", handleRunningModalActivity, true);
      window.removeEventListener("mousemove", handleRunningModalActivity, true);
      window.removeEventListener("wheel", handleRunningModalActivity, true);
      window.removeEventListener("touchstart", handleRunningModalActivity, true);
      window.removeEventListener("keydown", handleRunningModalActivity, true);
    }
    clearRunningModalRestoreTimer();
    clearFixtureConfirmTimer();
    clearFixtureConfirmSuccessTimer();
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
    pendingTaskCode.value = currentTask.value?.experimentKey || currentTask.value?.taskCode || "";
    taskListModalOpen.value = true;
  };
  const closeTaskList = () => {
    taskListModalOpen.value = false;
  };
  const openCompare = async () => {
    if (runningInteractionLocked.value || !actionState.value.canCompare) {
      return;
    }
    resetCompareState();
    compareModalOpen.value = true;
    await focusScanInput();
  };
  const closeCompare = () => {
    compareModalOpen.value = false;
  };
  const getCurrentTaskTrayCodesByStatus = (status) =>
    (Array.isArray(currentTask.value?.trayRows) ? currentTask.value.trayRows : [])
      .filter((row) => String(row?.trayStatus || "").trim() === String(status || "").trim())
      .map((row) => String(row?.trayCode || "").trim())
      .filter(Boolean);
  const getCurrentTaskTrayRowsByStatus = (status) =>
    (Array.isArray(currentTask.value?.trayRows) ? currentTask.value.trayRows : [])
      .filter((row) => String(row?.trayStatus || "").trim() === String(status || "").trim());
  const publishLaboratoryMqSafely = async (publisher, payload) => {
    try {
      await publisher(payload);
    } catch (error) {
      console.warn(error);
    }
  };
  const buildFixtureInstallPayload = () => {
    const targetTrayRows = getCurrentTaskTrayRowsByStatus(LAB_COMPARE_STATUS);
    return {
      labId: laboratoryConfig.value.labId,
      sampleCount: countTrayRowSamples(targetTrayRows),
      sampleType: "",
      taskId: currentTask.value?.taskCode || "",
    };
  };
  const buildReadyPayload = () => ({
    labId: laboratoryConfig.value.labId,
    taskId: currentTask.value?.taskCode || "",
  });
  const persistSamples = (nextSamples) => {
    const writeSamples = () =>
      persistSnapshot({
        [STORAGE_KEYS.samples]: nextSamples,
      });
    const persistOperation = samplesPersistQueue
      ? samplesPersistQueue.catch(() => {}).then(writeSamples)
      : writeSamples();
    const trackedOperation = persistOperation.finally(() => {
      if (samplesPersistQueue === trackedOperation) {
        samplesPersistQueue = null;
      }
    });
    samplesPersistQueue = trackedOperation;
    return persistOperation;
  };
  const persistCurrentTaskStep = async (nextStatus, historyAction, options = {}) => {
    const actionTime = new Date().toISOString();
    const targetTrayCodes =
      nextStatus === LAB_COMPARE_STATUS
        ? verifiedTrayCodes.value
        : nextStatus === LAB_INSTALL_STATUS
          ? getCurrentTaskTrayCodesByStatus(LAB_COMPARE_STATUS)
          : nextStatus === LAB_READY_STATUS
            ? getCurrentTaskTrayCodesByStatus(LAB_INSTALL_STATUS)
            : currentTask.value?.trayCodes;
    const baseSamples =
      options.revertTask && nextStatus === LAB_COMPARE_STATUS
        ? revertLaboratoryTaskToPreDispatch({
            currentTask: options.revertTask,
            now: actionTime,
            samples: samples.value,
          })
        : samples.value;
    const nextSamples = applyLaboratoryTaskStep({
      currentTask: currentTask.value,
      historyAction,
      nextStatus,
      now: actionTime,
      samples: baseSamples,
      targetTrayCodes,
    });
    samples.value = nextSamples;
    await persistSamples(nextSamples);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(SAMPLES_UPDATED_EVENT));
    }
  };
  const persistFixtureReadyForTask = async ({ taskCode, trayCodes }) => {
    const targetTaskCode = String(taskCode || "").trim();
    const targetTrayCodes = new Set((Array.isArray(trayCodes) ? trayCodes : []).map((code) => String(code || "").trim()).filter(Boolean));
    if (!targetTaskCode || targetTrayCodes.size === 0) {
      return;
    }
    const nextSamples = samples.value.map((sample) => {
      if (String(sample?.task_code || "").trim() !== targetTaskCode || !Array.isArray(sample?.trays)) {
        return sample;
      }
      return {
        ...sample,
        trays: sample.trays.map((tray) =>
          targetTrayCodes.has(String(tray?.tray_code || "").trim()) && String(tray?.status || "").trim() === LAB_INSTALL_STATUS
            ? { ...tray, fixtureReady: true, fixture_ready: true }
            : tray,
        ),
      };
    });
    samples.value = nextSamples;
    await persistSamples(nextSamples);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(SAMPLES_UPDATED_EVENT));
    }
  };
  const startFixtureConfirmCountdown = ({ taskCode, trayCodes }) => {
    clearFixtureConfirmTimer();
    clearFixtureConfirmSuccessTimer();
    fixtureConfirmSuccessModalOpen.value = false;
    fixtureConfirmCountdown.value = FIXTURE_CONFIRM_COUNTDOWN_SECONDS;
    fixtureConfirmModalOpen.value = true;
    if (typeof window === "undefined") {
      return;
    }
    fixtureConfirmTimer = window.setInterval(() => {
      fixtureConfirmCountdown.value = Math.max(0, fixtureConfirmCountdown.value - 1);
      if (fixtureConfirmCountdown.value > 0) {
        return;
      }
      clearFixtureConfirmTimer();
      fixtureConfirmModalOpen.value = false;
      fixtureConfirmSuccessModalOpen.value = true;
      fixtureConfirmSuccessTimer = window.setTimeout(() => {
        fixtureConfirmSuccessModalOpen.value = false;
        fixtureConfirmSuccessTimer = null;
      }, FIXTURE_CONFIRM_SUCCESS_MS);
      void persistFixtureReadyForTask({ taskCode, trayCodes });
    }, 1000);
  };
  const confirmCompare = async () => {
    if (!currentTask.value || !canCompleteCompare.value) {
      return;
    }
    const revertTask = pendingRevertTask.value;
    compareModalOpen.value = false;
    await persistCurrentTaskStep(LAB_COMPARE_STATUS, "任务比对", { revertTask });
    if (revertTask && taskSelectionKey(pendingRevertTask.value) === taskSelectionKey(revertTask)) {
      pendingRevertTask.value = null;
    }
    resetCompareState();
  };
  const submitCompareScan = () => {
    if (!currentTask.value) {
      compareFeedback.value = {
        guidance: "当前实验室暂无可比对任务，请先选择任务。",
        message: "无法比对",
        ok: false,
        tone: "error",
      };
      compareScanCode.value = "";
      return;
    }
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
    if (runningInteractionLocked.value || !actionState.value.canInstallSample) {
      return;
    }
    installModalOpen.value = true;
  };
  const closeInstall = () => {
    installModalOpen.value = false;
  };
  const confirmInstall = async () => {
    if (!actionState.value.canInstallSample) {
      installModalOpen.value = false;
      return;
    }
    const payload = buildFixtureInstallPayload();
    const targetTaskCode = currentTask.value?.taskCode || "";
    const targetTrayCodes = getCurrentTaskTrayCodesByStatus(LAB_COMPARE_STATUS);
    await persistCurrentTaskStep(LAB_INSTALL_STATUS, "样品安装");
    installModalOpen.value = false;
    startFixtureConfirmCountdown({ taskCode: targetTaskCode, trayCodes: targetTrayCodes });
    void publishLaboratoryMqSafely(publishLaboratoryFixtureInstall, payload);
  };
  const openReady = () => {
    if (runningInteractionLocked.value || !actionState.value.canMarkReady) {
      return;
    }
    readyModalOpen.value = true;
  };
  const closeReady = () => {
    readyModalOpen.value = false;
  };
  const confirmReady = async () => {
    if (!actionState.value.canMarkReady) {
      readyModalOpen.value = false;
      return;
    }
    const payload = buildReadyPayload();
    await persistCurrentTaskStep(LAB_READY_STATUS, "实验确认");
    readyModalOpen.value = false;
    confirmedModalOpen.value = true;
    void publishLaboratoryMqSafely(publishLaboratoryReady, payload);
  };
  const closeConfirmed = () => {
    confirmedModalOpen.value = false;
  };
  const openResetConfirm = () => {
    if (!canResetCurrentTask.value) {
      return;
    }
    resetConfirmModalOpen.value = true;
  };
  const closeResetConfirm = () => {
    resetConfirmModalOpen.value = false;
  };
  const confirmResetPrompt = () => {
    if (!canResetCurrentTask.value) {
      resetConfirmModalOpen.value = false;
      return;
    }
    resetConfirmModalOpen.value = false;
    resetDangerModalOpen.value = true;
  };
  const closeResetDanger = () => {
    resetDangerModalOpen.value = false;
  };
  const confirmResetTask = async () => {
    if (!canResetCurrentTask.value) {
      resetDangerModalOpen.value = false;
      return;
    }
    const nextSamples = resetLaboratoryExperimentTrays({
      currentTask: currentTask.value,
      now: new Date().toISOString(),
      samples: samples.value,
    });
    samples.value = nextSamples;
    await persistSamples(nextSamples);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(SAMPLES_UPDATED_EVENT));
    }
    resetDangerModalOpen.value = false;
    resetCompareState();
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
    await persistSamples(nextSamples);
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
    const previousTask = currentTask.value;
    const nextSelectionKey = String(pendingTaskCode.value || "").trim();
    const previousSelectionKey = taskSelectionKey(previousTask);
    const pendingRevertKey = taskSelectionKey(pendingRevertTask.value);
    if (pendingRevertKey && pendingRevertKey === nextSelectionKey) {
      pendingRevertTask.value = null;
    } else if (previousSelectionKey && previousSelectionKey !== nextSelectionKey && taskHasSwitchRevertibleTrays(previousTask)) {
      pendingRevertTask.value = previousTask;
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
    compareScanInputRef,
    closeCompare,
    closeConfirmed,
    closeInstall,
    fixtureConfirmCountdown,
    fixtureConfirmModalOpen,
    fixtureConfirmSuccessModalOpen,
    closeReady,
    closeResetConfirm,
    closeResetDanger,
    closeScheduleBoard,
      closeTaskList,
      canResetCurrentTask,
      compareScanCode,
      compareModalOpen,
      completePromptVisible,
      confirmCurrentTask,
      confirmCompare,
    confirmResetPrompt,
    confirmResetTask,
    confirmCompleteExperiment,
    confirmInstall,
    confirmReady,
    confirmedModalOpen,
    hideRunningModal,
    installModalOpen,
    labName: computed(() => laboratoryConfig.value.labName),
    loading,
    canCompleteCompare,
    runningInteractionLocked,
    currentTask,
    hasLaboratoryTasks,
    openCompare,
    openCompleteConfirm,
    openInstall,
    openReady,
    openResetConfirm,
    openScheduleBoard,
    openTaskList,
    showRunningModal,
    currentTaskFlow: computed(() => view.value.currentTaskFlow),
    currentExperimentTrayRows: computed(() => view.value.currentExperimentTrayRows),
    pendingTaskCode,
    progressMessage,
    laboratoryTaskNotice,
    readyModalOpen,
    recentTasks: computed(() => view.value.scheduleRows),
    resetConfirmModalOpen,
    resetDangerModalOpen,
    runningExperiment,
    runningModalVisible,
    scheduleModalOpen,
    scheduleRows: computed(() => view.value.scheduleRows),
    setPendingTaskCode: (taskKey) => {
      pendingTaskCode.value = String(taskKey ?? "");
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
