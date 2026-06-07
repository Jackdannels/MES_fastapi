import { computed, nextTick, onBeforeUnmount, onMounted, ref, unref, watch } from "vue";

import { useScanInputFocus } from "@/composables/useScanInputFocus";
import {
  HOST_INTERFACE_MODE_CHANGED_EVENT,
  HOST_INTERFACE_MODE_STORAGE_KEY,
  HOST_INTERFACE_MODES,
  readHostInterfaceMode,
} from "@/lib/hostInterfaceMode";
import { syncHostInterfaceMode } from "@/lib/hostInterfaceModeApi";
import { completeLaboratoryExperiment, withdrawCurrentLaboratoryExperiment } from "@/lib/laboratoryApi";
import { formatLocalDateTime } from "@/lib/dateTime";
import { publishLaboratoryFixtureInstall, publishLaboratoryReady } from "@/lib/laboratoryMqApi";
import { readMasterLabs } from "@/lib/masterDataApi";
import { LABORATORY_OPTIONS } from "@/lib/moduleCatalog";
import { useStorageSnapshot } from "@/composables/useStorageSnapshot";
import { useStorageSnapshotRefresh } from "@/composables/useStorageSnapshotRefresh";
import { STORAGE_KEYS } from "@/lib/storageKeys";
import { SAMPLES_UPDATED_EVENT } from "@/modules/samples/sampleEvents";
import { resolveDeviceUnavailableReason } from "@/modules/schedule/model";
import {
  applyLaboratoryTaskStep,
  buildLaboratoryChecklist,
  buildLaboratoryProgressMessage,
  buildLaboratorySummary,
  buildLaboratoryWorkflowFromTask,
  buildLaboratoryWorkbenchView,
  LAB_COMPARE_STATUS,
  LAB_INSTALL_STATUS,
  LAB_READY_STATUS,
  getLaboratoryActionState,
  getLaboratoryOperationLock,
  revertLaboratoryTaskToPreviousStableState,
  SALT_SPRAY_LAB,
  validateLaboratoryTrayScan,
} from "./model";

const RUNNING_MODAL_RESTORE_MS = 10_000;
const HEADER_ACTION_TARGET_SELECTOR = ".header-actions-before-logout";
const RESETTABLE_TRAY_STATUSES = new Set([LAB_COMPARE_STATUS, LAB_INSTALL_STATUS, LAB_READY_STATUS]);
const SWITCH_REVERTIBLE_TRAY_STATUSES = new Set([LAB_COMPARE_STATUS, LAB_INSTALL_STATUS, LAB_READY_STATUS]);
const COMPLETED_EXPERIMENT_RUN_STATUSES = new Set(["实验完成", "实验已完成", "实验已经完成"]);
const SALT_SPRAY_LAB_ID = "salt-spray-lab-01";
const SALT_SPRAY_LAB_CODE = "LAB_SALT";
const LABORATORY_SELECTED_LAB_STORAGE_KEY = "mes_laboratory_selected_lab_v1";
const FIXTURE_CONFIRM_COUNTDOWN_SECONDS = 5;
const FIXTURE_CONFIRM_SUCCESS_MS = 1000;
const LABORATORY_SNAPSHOT_KEYS = new Set([
  STORAGE_KEYS.tasks,
  STORAGE_KEYS.schedules,
  STORAGE_KEYS.experiments,
  STORAGE_KEYS.experiment_runs,
  STORAGE_KEYS.experiment_run_trays,
  STORAGE_KEYS.experiment_trays,
  STORAGE_KEYS.samples,
  STORAGE_KEYS.devices,
]);

const normalizeText = (value) => String(value ?? "").trim();
const formatErrorMessage = (error) => normalizeText(error?.message || error) || "未知错误";

const STATIC_LAB_NAMES = LABORATORY_OPTIONS.map((option) => option.label);
const STATIC_LAB_CODES_BY_NAME = Object.freeze({
  "冲击一室": "LAB_IMPACT_1",
  "冲击二室": "LAB_IMPACT_2",
  "振动一室": "LAB_VIBRATION_1",
  "振动二室": "LAB_VIBRATION_2",
  "四综合实验室": "LAB_COMPREHENSIVE",
  "温度冲击一室": "LAB_TEMP_SHOCK_1",
  "温度冲击二室": "LAB_TEMP_SHOCK_2",
  "高低温湿热一室": "LAB_HOT_HUMID",
  "盐雾试验室": SALT_SPRAY_LAB_CODE,
  "霉菌试验室": "LAB_MOLD",
});

const createDefaultLaboratoryConfig = (labName = SALT_SPRAY_LAB) => ({
  labCode: STATIC_LAB_CODES_BY_NAME[labName] || (labName === SALT_SPRAY_LAB ? SALT_SPRAY_LAB_CODE : labName),
  labId: labName === SALT_SPRAY_LAB ? SALT_SPRAY_LAB_ID : (STATIC_LAB_CODES_BY_NAME[labName] || labName),
  labName,
  testTypeName: "",
});

const normalizeSelectedLabName = (value) => {
  const rawValue = Array.isArray(value) ? value[0] : value;
  return normalizeText(rawValue);
};

const readStoredLabName = () => {
  if (typeof window === "undefined") {
    return "";
  }
  return normalizeText(window.localStorage.getItem(LABORATORY_SELECTED_LAB_STORAGE_KEY));
};

const writeStoredLabName = (labName) => {
  const normalizedLabName = normalizeText(labName);
  if (!normalizedLabName || typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(LABORATORY_SELECTED_LAB_STORAGE_KEY, normalizedLabName);
};

const resolveLabId = (lab, labName) =>
  normalizeText(lab?.mqttLabId || lab?.mqtt_lab_id)
  || (normalizeText(lab?.code || lab?.lab_code) === SALT_SPRAY_LAB_CODE ? SALT_SPRAY_LAB_ID : normalizeText(lab?.code || lab?.lab_code))
  || (labName === SALT_SPRAY_LAB ? SALT_SPRAY_LAB_ID : (STATIC_LAB_CODES_BY_NAME[labName] || labName));
const resolveLabCode = (lab, labName) =>
  normalizeText(lab?.code || lab?.lab_code)
  || STATIC_LAB_CODES_BY_NAME[labName]
  || (labName === SALT_SPRAY_LAB ? SALT_SPRAY_LAB_CODE : normalizeText(labName));

const resolveLaboratoryConfig = (masterLabs = [], selectedLabName = "") => {
  const enabledLabs = (Array.isArray(masterLabs) ? masterLabs : []).filter((lab) => {
    if (Number(lab?.status ?? 1) === 0) {
      return false;
    }
    const type = normalizeText(lab?.type || lab?.lab_type);
    return !type || type === "实验室";
  });
  const requestedLabName = normalizeSelectedLabName(selectedLabName);
  const matchedRequestedLab = requestedLabName
    ? enabledLabs.find((lab) => normalizeText(lab?.name || lab?.lab_name) === requestedLabName)
    : null;
  const matchedLab =
    matchedRequestedLab
    || enabledLabs.find((lab) => normalizeText(lab?.code || lab?.lab_code) === SALT_SPRAY_LAB_CODE)
    || enabledLabs.find((lab) => normalizeText(lab?.name || lab?.lab_name) === SALT_SPRAY_LAB);
  if (!matchedLab) {
    const fallbackLabName = requestedLabName && STATIC_LAB_NAMES.includes(requestedLabName) ? requestedLabName : SALT_SPRAY_LAB;
    return createDefaultLaboratoryConfig(fallbackLabName);
  }
  const labName = normalizeText(matchedLab?.name || matchedLab?.lab_name);
  const resolvedLabName = labName || requestedLabName || SALT_SPRAY_LAB;
  return {
    labCode: resolveLabCode(matchedLab, resolvedLabName),
    labId: resolveLabId(matchedLab, resolvedLabName),
    labName: resolvedLabName,
    testTypeName: normalizeText(matchedLab?.testTypeName || matchedLab?.test_type_name || matchedLab?.testType || matchedLab?.test_type),
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
      STORAGE_KEYS.experiment_runs,
      STORAGE_KEYS.experiment_run_trays,
      STORAGE_KEYS.experiment_trays,
      STORAGE_KEYS.samples,
      STORAGE_KEYS.devices,
    ]);
  const loadSnapshot = options.loadSnapshot || storage.loadSnapshot;
  const persistSnapshot = options.persistSnapshot || storage.persistSnapshot || (async () => {});

  const loading = ref(false);
  const laboratoryConfig = ref(createDefaultLaboratoryConfig());
  const tasks = ref([]);
  const schedules = ref([]);
  const experiments = ref([]);
  const experimentRuns = ref([]);
  const experimentRunTrays = ref([]);
  const experimentTrays = ref([]);
  const samples = ref([]);
  const devices = ref([]);

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
  const laboratoryMqError = ref(null);
  const readyPublishRetryAvailable = ref(false);
  const resetConfirmModalOpen = ref(false);
  const resetDangerModalOpen = ref(false);
  const completePromptVisible = ref(false);
  const runningModalVisible = ref(false);
  const completedRunningExperiment = ref(null);
  const tickNow = ref(now || new Date());
  let tickTimer = null;
  let runningModalRestoreTimer = null;
  let fixtureConfirmTimer = null;
  let fixtureConfirmSuccessTimer = null;
  let samplesPersistQueue = null;
  let ignoreNextSamplesUpdatedLoad = false;
  const completingRunningExperimentKeys = new Set();
  let lastActiveRunningExperiment = null;
  let flushPendingStorageRefresh = () => false;
  let hasPendingSamplesRefresh = false;
  let hostInterfaceModeSync = null;

  const getSelectedLabName = () => normalizeSelectedLabName(unref(options.selectedLabName));

  const view = computed(() =>
    buildLaboratoryWorkbenchView({
      experiments: experiments.value,
      experimentRuns: experimentRuns.value,
      experimentRunTrays: experimentRunTrays.value,
      experimentTrays: experimentTrays.value,
      now: tickNow.value,
      samples: samples.value,
      selectedTaskCode: selectedTaskCode.value,
      selectedTrayCode: selectedTrayCode.value,
      labCode: laboratoryConfig.value.labCode,
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
  const selectedLabDevice = computed(() =>
    devices.value.find(
      (device) =>
        normalizeText(device?.code) === normalizeText(laboratoryConfig.value.labName)
        || normalizeText(device?.name) === normalizeText(laboratoryConfig.value.labName),
    ) || null,
  );
  const laboratoryMaintenanceNotice = computed(() => {
    const reason = resolveDeviceUnavailableReason(selectedLabDevice.value, tickNow.value);
    if (reason) {
      return "设备维护中，禁止实验室操作";
    }
    return "";
  });
  const laboratoryUnderMaintenance = computed(() => Boolean(laboratoryMaintenanceNotice.value));
  const laboratoryTaskNotice = computed(() => {
    if (laboratoryMaintenanceNotice.value) {
      return laboratoryMaintenanceNotice.value;
    }
    if (!hasLaboratoryTasks.value) {
      return `当前${laboratoryConfig.value.labName}暂无任务，请先在排程看板安排任务后再进行比对。`;
    }
    if (!currentTask.value || laboratoryUnderMaintenance.value) {
      return "请先在查看任务中选择一个任务，再开启实验流程。";
    }
    return "";
  });
  const runningExperiment = computed(() => view.value.runningExperiment);
  const runningInteractionLocked = computed(() => runningExperiment.value.active);
  const operationLock = computed(() => getLaboratoryOperationLock(view.value.scheduleRows, currentTask.value));
  const actionState = computed(() => {
    const state = getLaboratoryActionState(workflow.value);
    if (!currentTask.value || laboratoryUnderMaintenance.value) {
      return {
        canCompare: false,
        canInstallSample: false,
        canMarkReady: false,
      };
    }
    if (operationLock.value.active) {
      return {
        canCompare: false,
        canInstallSample: false,
        canMarkReady: false,
      };
    }
    return state;
  });
  const canResendFixtureInstall = computed(() =>
    isMqttHostInterfaceMode()
    && Boolean(currentTask.value)
    && Boolean(workflow.value.hasInstalledWaitingReady)
    && !workflow.value.fixtureReadyDone
    && !runningInteractionLocked.value
    && !laboratoryUnderMaintenance.value
    && !operationLock.value.active,
  );
  const canRequestFixtureInstall = computed(() => actionState.value.canInstallSample || canResendFixtureInstall.value);
  const canResendReady = computed(() =>
    isMqttHostInterfaceMode()
    && Boolean(currentTask.value)
    && (Boolean(workflow.value.experimentConfirmed) || readyPublishRetryAvailable.value)
    && !runningInteractionLocked.value
    && !laboratoryUnderMaintenance.value
    && !operationLock.value.active,
  );
  const canRequestReady = computed(() => actionState.value.canMarkReady || canResendReady.value);
  const installActionLabel = computed(() => (canResendFixtureInstall.value ? "重新下发安装" : "安装样品"));
  const readyActionLabel = computed(() => (canResendReady.value ? "重新下发准备" : "确认准备就绪"));
  const { focusScanInput } = useScanInputFocus(compareScanInputRef);
  const progressMessage = computed(() => buildLaboratoryProgressMessage(workflow.value, currentTask.value, laboratoryConfig.value.labName));
  const runningModalExperiment = computed(() =>
    completedRunningExperiment.value?.active ? completedRunningExperiment.value : runningExperiment.value,
  );
  const canCompleteCompare = computed(() => verifiedTrayCodes.value.length > 0);
  const canTeleportScheduleAction = ref(false);
  const canResetCurrentTask = computed(() => {
    const trayRows = Array.isArray(currentTask.value?.trayRows) ? currentTask.value.trayRows : [];
    return (
      trayRows.length > 0
      && trayRows.some((row) => RESETTABLE_TRAY_STATUSES.has(String(row?.trayStatus ?? "").trim()))
      && !runningInteractionLocked.value
      && !laboratoryUnderMaintenance.value
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

  const closeFullInteractionState = () => {
    selectedTaskCode.value = "";
    selectedTrayCode.value = "";
    pendingTaskCode.value = "";
    pendingRevertTask.value = null;
    compareScanCode.value = "";
    compareFeedback.value = null;
    verifiedTrayCodes.value = [];
    scheduleModalOpen.value = false;
    taskListModalOpen.value = false;
    compareModalOpen.value = false;
    installModalOpen.value = false;
    fixtureConfirmModalOpen.value = false;
    fixtureConfirmSuccessModalOpen.value = false;
    laboratoryMqError.value = null;
    readyPublishRetryAvailable.value = false;
    readyModalOpen.value = false;
    confirmedModalOpen.value = false;
    resetConfirmModalOpen.value = false;
    resetDangerModalOpen.value = false;
    completePromptVisible.value = false;
    runningModalVisible.value = false;
    completedRunningExperiment.value = null;
    clearRunningModalRestoreTimer();
    clearFixtureConfirmTimer();
    clearFixtureConfirmSuccessTimer();
    flushPendingRealtimeRefresh();
  };

  const syncHeaderActionTarget = () => {
    canTeleportScheduleAction.value = typeof document !== "undefined" && Boolean(document.querySelector(HEADER_ACTION_TARGET_SELECTOR));
  };

  const showRunningModal = () => {
    if (runningExperiment.value.active || completedRunningExperiment.value?.active) {
      runningModalVisible.value = true;
    }
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
    if (completedRunningExperiment.value?.active) {
      completedRunningExperiment.value = null;
      runningModalVisible.value = false;
      clearRunningModalRestoreTimer();
      return;
    }
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

  const runMatchesCompletedSnapshot = (run, runningSnapshot) => {
    const runNo = normalizeText(run?.run_no) || normalizeText(run?.id);
    if (normalizeText(runningSnapshot?.runNo) && runNo === normalizeText(runningSnapshot?.runNo)) {
      return true;
    }
    if (
      normalizeText(run?.task_code) !== normalizeText(runningSnapshot?.taskCode)
      || normalizeText(run?.experiment_code) !== normalizeText(runningSnapshot?.experimentCode)
    ) {
      return false;
    }
    const snapshotTrayCodes = new Set((runningSnapshot?.trayCodes || []).map(normalizeText).filter(Boolean));
    const runTrayCodes = new Set((Array.isArray(run?.tray_codes) ? run.tray_codes : []).map(normalizeText).filter(Boolean));
    return snapshotTrayCodes.size > 0 && Array.from(snapshotTrayCodes).every((trayCode) => runTrayCodes.has(trayCode));
  };

  const preserveExternallyCompletedRunningExperiment = (runningSnapshot) => {
    if (!runningSnapshot?.active) {
      return false;
    }
    const matchedCompletedRun = experimentRuns.value.find(
      (run) =>
        COMPLETED_EXPERIMENT_RUN_STATUSES.has(normalizeText(run?.status))
        && runMatchesCompletedSnapshot(run, runningSnapshot),
    );
    if (!matchedCompletedRun) {
      return false;
    }
    const completedAt = normalizeText(matchedCompletedRun?.ended_at) || normalizeText(matchedCompletedRun?.updated_at);
    completedRunningExperiment.value = {
      ...runningSnapshot,
      active: true,
      completed: true,
      countdownLabel: "实验已完成",
      endDateTimeLabel: completedAt || runningSnapshot.endDateTimeLabel,
      overdue: false,
      overdueLabel: "",
      remainingSeconds: 0,
      statusLabel: "实验已完成",
    };
    runningModalVisible.value = true;
    completePromptVisible.value = false;
    clearRunningModalRestoreTimer();
    return true;
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
        completedRunningExperiment.value = null;
        lastActiveRunningExperiment = { ...runningExperiment.value };
        readyModalOpen.value = false;
        confirmedModalOpen.value = false;
        showRunningModal();
        return;
      }
      if (preserveExternallyCompletedRunningExperiment(lastActiveRunningExperiment)) {
        lastActiveRunningExperiment = null;
        return;
      }
      lastActiveRunningExperiment = null;
      if (completedRunningExperiment.value?.active) {
        runningModalVisible.value = true;
        completePromptVisible.value = false;
        clearRunningModalRestoreTimer();
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
      void completeRunningExperiment({ keepModal: true }).catch((error) => {
        console.warn(error);
      });
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
      const explicitLabName = getSelectedLabName();
      const nextConfig = resolveLaboratoryConfig(masterLabs, explicitLabName || readStoredLabName());
      if (normalizeText(laboratoryConfig.value.labName) !== normalizeText(nextConfig.labName)) {
        closeFullInteractionState();
      }
      laboratoryConfig.value = nextConfig;
      if (explicitLabName) {
        writeStoredLabName(nextConfig.labName);
      }
      tasks.value = Array.isArray(snapshot?.[STORAGE_KEYS.tasks]) ? snapshot[STORAGE_KEYS.tasks] : [];
      schedules.value = Array.isArray(snapshot?.[STORAGE_KEYS.schedules]) ? snapshot[STORAGE_KEYS.schedules] : [];
      experiments.value = Array.isArray(snapshot?.[STORAGE_KEYS.experiments]) ? snapshot[STORAGE_KEYS.experiments] : [];
      experimentRuns.value = Array.isArray(snapshot?.[STORAGE_KEYS.experiment_runs]) ? snapshot[STORAGE_KEYS.experiment_runs] : [];
      experimentRunTrays.value = Array.isArray(snapshot?.[STORAGE_KEYS.experiment_run_trays]) ? snapshot[STORAGE_KEYS.experiment_run_trays] : [];
      experimentTrays.value = Array.isArray(snapshot?.[STORAGE_KEYS.experiment_trays]) ? snapshot[STORAGE_KEYS.experiment_trays] : [];
      samples.value = Array.isArray(snapshot?.[STORAGE_KEYS.samples]) ? snapshot[STORAGE_KEYS.samples] : [];
      devices.value = Array.isArray(snapshot?.[STORAGE_KEYS.devices]) ? snapshot[STORAGE_KEYS.devices] : [];
    } finally {
      loading.value = false;
    }
  };

  const applyWithdrawResponse = (payload) => {
    if (Array.isArray(payload?.samples)) {
      samples.value = payload.samples;
    }
  };

  const isLaboratoryRealtimeRefreshPaused = () => Boolean(
    scheduleModalOpen.value
    || taskListModalOpen.value
    || compareModalOpen.value
    || installModalOpen.value
    || readyModalOpen.value
    || resetConfirmModalOpen.value
    || resetDangerModalOpen.value
    || completePromptVisible.value
  );

  const flushPendingRealtimeRefresh = () => {
    const flushedStorage = flushPendingStorageRefresh();
    if (!hasPendingSamplesRefresh || isLaboratoryRealtimeRefreshPaused()) {
      return flushedStorage;
    }
    hasPendingSamplesRefresh = false;
    if (!flushedStorage) {
      void load();
    }
    return true;
  };

  const handleSamplesUpdated = () => {
    if (ignoreNextSamplesUpdatedLoad) {
      ignoreNextSamplesUpdatedLoad = false;
      return;
    }
    if (isLaboratoryRealtimeRefreshPaused()) {
      hasPendingSamplesRefresh = true;
      return;
    }
    hasPendingSamplesRefresh = false;
    void load();
  };

  const storageRefresh = useStorageSnapshotRefresh({
    keys: Array.from(LABORATORY_SNAPSHOT_KEYS),
    refresh: load,
    paused: isLaboratoryRealtimeRefreshPaused,
  });
  flushPendingStorageRefresh = storageRefresh.flushPendingRefresh;

  const handleHostInterfaceModeChanged = (event = {}) => {
    if (event?.type === "storage" && event?.key !== HOST_INTERFACE_MODE_STORAGE_KEY) {
      return;
    }
    void ensureHostInterfaceModeSynced().catch((error) => console.warn(error));
  };

  onMounted(() => {
    void nextTick().then(syncHeaderActionTarget);
    if (typeof window !== "undefined") {
      tickTimer = window.setInterval(() => {
        tickNow.value = now || new Date();
      }, 1000);
      window.addEventListener(SAMPLES_UPDATED_EVENT, handleSamplesUpdated);
      window.addEventListener("pointerdown", handleRunningModalActivity, true);
      window.addEventListener("mousemove", handleRunningModalActivity, true);
      window.addEventListener("wheel", handleRunningModalActivity, true);
      window.addEventListener("touchstart", handleRunningModalActivity, true);
      window.addEventListener("keydown", handleRunningModalActivity, true);
      window.addEventListener("storage", handleHostInterfaceModeChanged);
      window.addEventListener(HOST_INTERFACE_MODE_CHANGED_EVENT, handleHostInterfaceModeChanged);
    }
    void ensureHostInterfaceModeSynced().catch((error) => console.warn(error));
    void load();
  });

  onBeforeUnmount(() => {
    if (tickTimer && typeof window !== "undefined") {
      window.clearInterval(tickTimer);
      tickTimer = null;
    }
    if (typeof window !== "undefined") {
      window.removeEventListener(SAMPLES_UPDATED_EVENT, handleSamplesUpdated);
      window.removeEventListener("pointerdown", handleRunningModalActivity, true);
      window.removeEventListener("mousemove", handleRunningModalActivity, true);
      window.removeEventListener("wheel", handleRunningModalActivity, true);
      window.removeEventListener("touchstart", handleRunningModalActivity, true);
      window.removeEventListener("keydown", handleRunningModalActivity, true);
      window.removeEventListener("storage", handleHostInterfaceModeChanged);
      window.removeEventListener(HOST_INTERFACE_MODE_CHANGED_EVENT, handleHostInterfaceModeChanged);
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
    flushPendingRealtimeRefresh();
  };
  const openTaskList = () => {
    pendingTaskCode.value = currentTask.value?.experimentKey || currentTask.value?.taskCode || "";
    taskListModalOpen.value = true;
  };
  const closeTaskList = () => {
    taskListModalOpen.value = false;
    flushPendingRealtimeRefresh();
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
    flushPendingRealtimeRefresh();
  };
  const getCurrentTaskTrayCodesByStatus = (status) =>
    (Array.isArray(currentTask.value?.trayRows) ? currentTask.value.trayRows : [])
      .filter((row) => String(row?.trayStatus || "").trim() === String(status || "").trim())
      .map((row) => String(row?.trayCode || "").trim())
      .filter(Boolean);
  const getCurrentTaskTrayRowsByStatus = (status) =>
    (Array.isArray(currentTask.value?.trayRows) ? currentTask.value.trayRows : [])
      .filter((row) => String(row?.trayStatus || "").trim() === String(status || "").trim());
  const isMqttHostInterfaceMode = () => readHostInterfaceMode() === HOST_INTERFACE_MODES.mqtt;
  const ensureHostInterfaceModeSynced = async () => {
    if (!isMqttHostInterfaceMode()) {
      return;
    }
    hostInterfaceModeSync = hostInterfaceModeSync || syncHostInterfaceMode(HOST_INTERFACE_MODES.mqtt).finally(() => {
      hostInterfaceModeSync = null;
    });
    await hostInterfaceModeSync;
  };
  const clearLaboratoryMqError = () => {
    laboratoryMqError.value = null;
  };
  const publishLaboratoryMqSafely = async (publisher, payload, actionLabel) => {
    if (!isMqttHostInterfaceMode()) {
      return;
    }
    try {
      clearLaboratoryMqError();
      if (actionLabel === "准备就绪") {
        readyPublishRetryAvailable.value = false;
      }
      await ensureHostInterfaceModeSynced();
      await publisher(payload);
    } catch (error) {
      laboratoryMqError.value = {
        detail: formatErrorMessage(error),
        title: `${actionLabel}下发失败`,
      };
      if (actionLabel === "夹具安装") {
        clearFixtureConfirmTimer();
        fixtureConfirmModalOpen.value = false;
      }
      if (actionLabel === "准备就绪") {
        confirmedModalOpen.value = false;
        readyPublishRetryAvailable.value = true;
      }
    }
  };

  watch(
    () => getSelectedLabName(),
    () => {
      void load();
    },
  );
  const buildFixtureInstallPayload = () => {
    const comparedRows = getCurrentTaskTrayRowsByStatus(LAB_COMPARE_STATUS);
    const targetTrayRows = comparedRows.length > 0 ? comparedRows : getCurrentTaskTrayRowsByStatus(LAB_INSTALL_STATUS);
    return {
      experiment_code: currentTask.value?.experimentCode || "",
      lab_code: laboratoryConfig.value.labCode || laboratoryConfig.value.labId,
      sample_count: countTrayRowSamples(targetTrayRows),
      sample_type: "",
      task_code: currentTask.value?.taskCode || "",
    };
  };
  const buildReadyPayload = () => ({
    experiment_code: currentTask.value?.experimentCode || "",
    lab_code: laboratoryConfig.value.labCode || laboratoryConfig.value.labId,
    task_code: currentTask.value?.taskCode || "",
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
  const persistRunningExperimentCompletion = (payload) => {
    const writeCompletion = () => completeLaboratoryExperiment(payload);
    const persistOperation = samplesPersistQueue
      ? samplesPersistQueue.catch(() => {}).then(writeCompletion)
      : writeCompletion();
    const trackedOperation = persistOperation.finally(() => {
      if (samplesPersistQueue === trackedOperation) {
        samplesPersistQueue = null;
      }
    });
    samplesPersistQueue = trackedOperation;
    return persistOperation;
  };
  const persistCurrentTaskStep = async (nextStatus, historyAction, options = {}) => {
    const actionTime = formatLocalDateTime();
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
        ? revertLaboratoryTaskToPreviousStableState({
            currentTask: options.revertTask,
            now: actionTime,
            samples: samples.value,
          })
        : samples.value;
    let nextSamples = applyLaboratoryTaskStep({
      currentTask: currentTask.value,
      historyAction,
      nextStatus,
      now: actionTime,
      samples: baseSamples,
      targetTrayCodes,
    });
    if (nextStatus === LAB_INSTALL_STATUS) {
      nextSamples = clearFixtureReadyForTask({
        nextSamples,
        taskCode: currentTask.value?.taskCode,
        trayCodes: targetTrayCodes,
      });
    }
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
  const clearFixtureReadyForTask = ({ nextSamples, taskCode, trayCodes }) => {
    const targetTaskCode = String(taskCode || "").trim();
    const targetTrayCodes = new Set((Array.isArray(trayCodes) ? trayCodes : []).map((code) => String(code || "").trim()).filter(Boolean));
    if (!targetTaskCode || targetTrayCodes.size === 0) {
      return nextSamples;
    }
    return nextSamples.map((sample) => {
      if (String(sample?.task_code || "").trim() !== targetTaskCode || !Array.isArray(sample?.trays)) {
        return sample;
      }
      return {
        ...sample,
        trays: sample.trays.map((tray) => {
          if (!targetTrayCodes.has(String(tray?.tray_code || "").trim())) {
            return tray;
          }
          const nextTray = { ...tray };
          delete nextTray.fixtureReady;
          delete nextTray.fixture_ready;
          return nextTray;
        }),
      };
    });
  };
  const openFixtureConfirmSuccess = () => {
    clearFixtureConfirmTimer();
    clearFixtureConfirmSuccessTimer();
    fixtureConfirmModalOpen.value = false;
    fixtureConfirmSuccessModalOpen.value = true;
    if (typeof window === "undefined") {
      return;
    }
    fixtureConfirmSuccessTimer = window.setTimeout(() => {
      fixtureConfirmSuccessModalOpen.value = false;
      fixtureConfirmSuccessTimer = null;
      flushPendingRealtimeRefresh();
    }, FIXTURE_CONFIRM_SUCCESS_MS);
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
      if (isMqttHostInterfaceMode()) {
        fixtureConfirmModalOpen.value = false;
        flushPendingRealtimeRefresh();
        return;
      }
      openFixtureConfirmSuccess();
      void persistFixtureReadyForTask({ taskCode, trayCodes });
    }, 1000);
  };
  watch(
    () => workflow.value.fixtureReadyDone,
    (fixtureReadyDone) => {
      if (fixtureReadyDone && fixtureConfirmModalOpen.value && isMqttHostInterfaceMode()) {
        openFixtureConfirmSuccess();
      }
    },
  );
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
    flushPendingRealtimeRefresh();
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
    if (runningInteractionLocked.value || !canRequestFixtureInstall.value) {
      return;
    }
    installModalOpen.value = true;
  };
  const closeInstall = () => {
    installModalOpen.value = false;
    flushPendingRealtimeRefresh();
  };
  const confirmInstall = async () => {
    if (!canRequestFixtureInstall.value) {
      installModalOpen.value = false;
      return;
    }
    const payload = buildFixtureInstallPayload();
    const targetTaskCode = currentTask.value?.taskCode || "";
    const isResend = !actionState.value.canInstallSample && canResendFixtureInstall.value;
    const targetTrayCodes = getCurrentTaskTrayCodesByStatus(isResend ? LAB_INSTALL_STATUS : LAB_COMPARE_STATUS);
    const persistOperation = isResend ? Promise.resolve() : persistCurrentTaskStep(LAB_INSTALL_STATUS, "样品安装");
    installModalOpen.value = false;
    startFixtureConfirmCountdown({ taskCode: targetTaskCode, trayCodes: targetTrayCodes });
    void persistOperation
      .then(() => publishLaboratoryMqSafely(publishLaboratoryFixtureInstall, payload, "夹具安装"))
      .catch((error) => {
        laboratoryMqError.value = {
          detail: formatErrorMessage(error),
          title: "夹具安装下发失败",
        };
        clearFixtureConfirmTimer();
        fixtureConfirmModalOpen.value = false;
      });
  };
  const openReady = () => {
    if (runningInteractionLocked.value || !canRequestReady.value) {
      return;
    }
    readyModalOpen.value = true;
  };
  const closeReady = () => {
    readyModalOpen.value = false;
    flushPendingRealtimeRefresh();
  };
  const confirmReady = async () => {
    if (!canRequestReady.value) {
      readyModalOpen.value = false;
      return;
    }
    const payload = buildReadyPayload();
    if (actionState.value.canMarkReady) {
      await persistCurrentTaskStep(LAB_READY_STATUS, "实验确认");
    }
    readyModalOpen.value = false;
    confirmedModalOpen.value = true;
    void publishLaboratoryMqSafely(publishLaboratoryReady, payload, "准备就绪");
  };
  const closeConfirmed = () => {
    confirmedModalOpen.value = false;
    flushPendingRealtimeRefresh();
  };
  const openResetConfirm = () => {
    if (!canResetCurrentTask.value) {
      return;
    }
    resetConfirmModalOpen.value = true;
  };
  const closeResetConfirm = () => {
    resetConfirmModalOpen.value = false;
    flushPendingRealtimeRefresh();
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
    flushPendingRealtimeRefresh();
  };
  const confirmResetTask = async () => {
    if (!canResetCurrentTask.value) {
      resetDangerModalOpen.value = false;
      return;
    }
    const withdrawResult = await withdrawCurrentLaboratoryExperiment({
      experimentCode: currentTask.value?.experimentCode,
      reason: "试验间内撤回当前实验任务",
      taskCode: currentTask.value?.taskCode,
    });
    resetDangerModalOpen.value = false;
    resetCompareState();
    try {
      await load();
    } catch {
      // The withdraw API response is authoritative for the local tray flow.
    }
    applyWithdrawResponse(withdrawResult);
    if (typeof window !== "undefined") {
      ignoreNextSamplesUpdatedLoad = true;
      window.dispatchEvent(new CustomEvent(SAMPLES_UPDATED_EVENT));
    }
    flushPendingRealtimeRefresh();
  };
  const openCompleteConfirm = () => {
    if (!runningExperiment.value?.active) {
      return;
    }
    completePromptVisible.value = true;
  };
  const closeCompleteConfirm = () => {
    completePromptVisible.value = false;
    flushPendingRealtimeRefresh();
  };
  const completeRunningExperiment = async ({ keepModal = false } = {}) => {
    if (!runningExperiment.value?.active) {
      return;
    }
    const runningSnapshot = { ...runningExperiment.value };
    const taskCode = normalizeText(currentTask.value?.taskCode);
    const experimentCode = normalizeText(currentTask.value?.experimentCode);
    const completionKey = `${taskCode}::${experimentCode}`;
    if (!taskCode || !experimentCode || completingRunningExperimentKeys.has(completionKey)) {
      return;
    }
    completingRunningExperimentKeys.add(completionKey);
    const completedAt = formatLocalDateTime();
    const runningRunNo = normalizeText(runningExperiment.value?.runNo);
    const runningTrayCodes = (runningExperiment.value?.trayCodes || []).map(normalizeText).filter(Boolean);
    try {
      const completionResult = await persistRunningExperimentCompletion({
        completedAt,
        experimentCode,
        runNo: runningRunNo,
        taskCode,
        trayCodes: runningTrayCodes,
      });
      completedRunningExperiment.value = keepModal
        ? {
            ...runningSnapshot,
            active: true,
            completed: true,
            countdownLabel: "实验已完成",
            overdue: false,
            overdueLabel: "",
            remainingSeconds: 0,
            statusLabel: "实验已完成",
          }
        : null;
      const hasCompletionSnapshot =
        Array.isArray(completionResult?.samples)
        && Array.isArray(completionResult?.experiments)
        && Array.isArray(completionResult?.experimentRuns)
        && Array.isArray(completionResult?.schedules);
      if (hasCompletionSnapshot) {
        samples.value = completionResult.samples;
        experiments.value = completionResult.experiments;
        experimentRuns.value = completionResult.experimentRuns;
        if (Array.isArray(completionResult?.experimentRunTrays)) {
          experimentRunTrays.value = completionResult.experimentRunTrays;
        }
        schedules.value = completionResult.schedules;
      } else {
        await load();
      }
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent(SAMPLES_UPDATED_EVENT));
      }
      completePromptVisible.value = false;
      runningModalVisible.value = keepModal;
      clearRunningModalRestoreTimer();
      flushPendingRealtimeRefresh();
    } finally {
      completingRunningExperimentKeys.delete(completionKey);
    }
  };
  const confirmCompleteExperiment = async () => {
    await completeRunningExperiment();
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
    flushPendingRealtimeRefresh();
  };

  return {
    actionState,
    canRequestFixtureInstall,
    canRequestReady,
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
    installActionLabel,
    laboratoryMqError,
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
    readyActionLabel,
    recentTasks: computed(() => view.value.scheduleRows),
    resetConfirmModalOpen,
    resetDangerModalOpen,
    runningExperiment,
    runningModalExperiment,
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
