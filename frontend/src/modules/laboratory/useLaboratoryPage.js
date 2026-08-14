import { computed, nextTick, onBeforeUnmount, onMounted, ref, unref, watch } from "vue";

import { useScanInputFocus } from "@/composables/useScanInputFocus";
import { buildTemporalBoundaryState, temporalBoundaryHasElapsed } from "@/composables/temporalBoundaryClock";
import {
  HOST_INTERFACE_MODE_CHANGED_EVENT,
  HOST_INTERFACE_MODE_STORAGE_KEY,
} from "@/lib/hostInterfaceMode";
import { serverNowDate } from "@/lib/serverClock";
import {
  publishLaboratoryEndRequest,
  publishLaboratoryFixtureInstall,
  publishLaboratoryPauseRequest,
  publishLaboratoryReady,
  publishLaboratoryResumeRequest,
  publishLaboratoryStopRequest,
} from "@/lib/laboratoryMqApi";
import { readMasterLabs } from "@/lib/masterDataApi";
import { useStorageSnapshot } from "@/composables/useStorageSnapshot";
import { STORAGE_KEYS } from "@/lib/storageKeys";
import { resolveDeviceUnavailableReason } from "@/modules/schedule/model";
import {
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
  validateLaboratoryTrayScan,
} from "./model";
import {
  createDefaultLaboratoryConfig,
  normalizeSelectedLabName,
  readStoredLabName,
  resolveLaboratoryConfig,
  writeStoredLabName,
} from "./laboratoryConfig";
import {
  SWITCH_REVERTIBLE_TRAY_STATUSES,
  TASK_SWITCH_LOCKED_TRAY_STATUSES,
  formatErrorMessage,
  isResettableTrayStatus,
  normalizeText,
} from "./pageHelpers";
import { useLaboratoryAttendance } from "./useLaboratoryAttendance";
import { useLaboratoryRunningModal } from "./useLaboratoryRunningModal";
import { createLaboratoryDeviceInterface } from "./laboratoryDeviceInterface";
import { useLaboratoryRealtimeRefresh } from "./useLaboratoryRealtimeRefresh";
import { useLaboratoryFixtureConfirmation } from "./useLaboratoryFixtureConfirmation";
import { buildLaboratoryAxisContinuation } from "./laboratoryAxisContinuation";
import { useLaboratoryOperationPersistence } from "./useLaboratoryOperationPersistence";
import { useLaboratoryResetFlow } from "./useLaboratoryResetFlow";
import { completionConfirmationMatches, useLaboratoryCompletionFlow } from "./useLaboratoryCompletionFlow";
import { updateRunningExperimentClock } from "./laboratoryPresentation";
import { useSaltSprayPauseFlow } from "./useSaltSprayPauseFlow";
import { buildSaltSprayRunPresentation, findActivePause } from "./saltSprayPausePresentation";

const HEADER_ACTION_TARGET_SELECTOR = ".header-actions-before-logout";
const COMPLETION_CONFIRMATION_TIMEOUT_MS = 10_000;
function useLaboratoryPage(options = {}) {
  const now = options.now;
  const readNow = typeof now === "function" ? now : () => now || serverNowDate();
  const buildWorkbenchView = options.buildWorkbenchView || buildLaboratoryWorkbenchView;
  const updateRunningClock = options.updateRunningExperimentClock || updateRunningExperimentClock;
  const storage =
    options.storage ||
    useStorageSnapshot([
      STORAGE_KEYS.tasks,
      STORAGE_KEYS.schedules,
      STORAGE_KEYS.experiments,
      STORAGE_KEYS.experiment_runs,
      STORAGE_KEYS.experiment_run_pauses,
      STORAGE_KEYS.experiment_run_trays,
      STORAGE_KEYS.experiment_run_steps,
      STORAGE_KEYS.experiment_trays,
      STORAGE_KEYS.samples,
      STORAGE_KEYS.staging_events,
      STORAGE_KEYS.devices,
    ]);
  const loadSnapshot = options.loadSnapshot || storage.loadSnapshot;

  const loading = ref(false);
  const laboratoryConfig = ref(createDefaultLaboratoryConfig());
  const tasks = ref([]);
  const schedules = ref([]);
  const experiments = ref([]);
  const experimentRuns = ref([]);
  const experimentRunPauses = ref([]);
  const experimentRunTrays = ref([]);
  const experimentRunSteps = ref([]);
  const experimentTrays = ref([]);
  const samples = ref([]);
  const stagingEvents = ref([]);
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
  const fixtureConfirmHostless = ref(false);
  const readyModalOpen = ref(false);
  const confirmedModalOpen = ref(false);
  const laboratoryMqError = ref(null);
  const readyPublishRetryAvailable = ref(false);
  const resetConfirmModalOpen = ref(false);
  const resetDangerModalOpen = ref(false);
  const resetTarget = ref(null);
  const resetSubmitting = ref(false);
  const completionAwaitingConfirmation = ref(null);
  const completionConfirmationError = ref("");
  const completionSubmitting = ref(false);
  const runningModalVisible = ref(false);
  const completedRunningExperiment = ref(null);
  const axisReadySubmitting = ref(false);
  const axisReadyPendingKey = ref("");
  const tickNow = ref(readNow());
  const structuralNow = ref(tickNow.value);
  let temporalBoundaryState = null;
  let tickTimer = null;
  let completionConfirmationTimer = null;
  let latestSnapshotLoadRequest = 0;
  let ignoreNextSamplesUpdatedRefresh = () => {};
  let flushPendingRealtimeRefresh = () => false;
  let clearFixtureConfirmTimer = () => {};
  let clearFixtureConfirmSuccessTimer = () => {};
  let clearHostlessFixtureReadyTimer = () => {};

  const clearCompletionConfirmationTimer = () => {
    if (completionConfirmationTimer && typeof window !== "undefined") {
      window.clearTimeout(completionConfirmationTimer);
    }
    completionConfirmationTimer = null;
  };

  const getSelectedLabName = () => normalizeSelectedLabName(unref(options.selectedLabName));
  const {
    applyExperimentStartAttendance,
    attendanceLoggedIn,
    attendanceLoginError,
    attendanceLoginMode,
    attendanceLoginModalOpen,
    attendanceLoginPassword,
    attendanceLoginUsername,
    attendanceLogoutCountdown,
    attendanceLogoutPromptOpen,
    attendanceQrInputRef,
    attendanceQrPayload,
    attendanceSession,
    attendanceStatus,
    attendanceSubmitting,
    attendanceWorkStartedAt,
    closeAttendanceLogin,
    loadAttendanceSession,
    logoutAttendance,
    openAttendanceLogin,
    openAttendanceLogoutPrompt,
    resetAttendanceInteraction,
    runWithAttendance,
    setAttendanceLoginMode,
    startWorkForRunningExperiment,
    submitAttendanceLogin,
    submitAttendanceQrLogin,
  } = useLaboratoryAttendance({ laboratoryConfig, tickNow });

  const resetTemporalBoundaryState = () => {
    temporalBoundaryState = buildTemporalBoundaryState({
      devices: devices.value,
      now: tickNow.value,
      schedules: schedules.value,
    });
  };
  const refreshStructuralClock = () => {
    structuralNow.value = tickNow.value;
    resetTemporalBoundaryState();
  };
  resetTemporalBoundaryState();
  watch(tickNow, (currentNow) => {
    if (temporalBoundaryHasElapsed(temporalBoundaryState, currentNow)) {
      structuralNow.value = currentNow;
      resetTemporalBoundaryState();
    }
  });
  watch([
    tasks,
    schedules,
    experiments,
    experimentRuns,
    experimentRunPauses,
    experimentRunTrays,
    experimentRunSteps,
    experimentTrays,
    samples,
    stagingEvents,
    devices,
  ], refreshStructuralClock);

  const view = computed(() =>
    buildWorkbenchView({
      experiments: experiments.value,
      experimentRuns: experimentRuns.value,
      experimentRunSteps: experimentRunSteps.value,
      experimentRunTrays: experimentRunTrays.value,
      experimentTrays: experimentTrays.value,
      now: structuralNow.value,
      samples: samples.value,
      selectedTaskCode: selectedTaskCode.value,
      selectedTrayCode: selectedTrayCode.value,
      labCode: laboratoryConfig.value.labCode,
      labName: laboratoryConfig.value.labName,
      schedules: schedules.value,
      tasks: tasks.value,
    }),
  );

  const summary = computed(() => buildLaboratorySummary(view.value.scheduleRows, structuralNow.value));
  const currentTask = computed(() => view.value.currentTask);
  const selectedTask = computed(() => view.value.selectedTask);
  const checklist = computed(() => buildLaboratoryChecklist(currentTask.value).map((item) =>
    item.label === "执行人员"
      ? { ...item, value: normalizeText(attendanceStatus.value?.employeeName) || "-" }
      : item,
  ));
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
      return "设备维修中，禁止实验室操作";
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
      const trayFlowTask = view.value.trayFlowTask;
      const selectedTrayRow = view.value.selectedTrayRow;
      const targetLab = normalizeText(selectedTrayRow?.targetLab || selectedTrayRow?.target_lab || selectedTrayRow?.location);
      const currentLab = normalizeText(laboratoryConfig.value.labName);
      if (trayFlowTask && targetLab && currentLab && targetLab !== currentLab) {
        return `当前托盘已送至${targetLab}，${currentLab}暂不能开启实验流程。`;
      }
      return "请先在查看任务中选择一个任务，再开启实验流程。";
    }
    return "";
  });
  const runningExperiment = computed(() => updateRunningClock(view.value.runningExperiment, tickNow.value));
  const runningAttendanceStartKey = computed(() => {
    if (!runningExperiment.value?.active) {
      return "";
    }
    const runNo = normalizeText(runningExperiment.value?.runNo);
    const taskCode = normalizeText(runningExperiment.value?.taskCode || currentTask.value?.taskCode);
    const experimentCode = normalizeText(runningExperiment.value?.experimentCode || currentTask.value?.experimentCode);
    const labName = normalizeText(laboratoryConfig.value.labName);
    const employeeKey = attendanceLoggedIn.value ? normalizeText(attendanceSession.value?.username) : "";
    return [labName, employeeKey, runNo || `${taskCode}:${experimentCode}`].filter(Boolean).join("::");
  });
  const axisContinuation = computed(() => buildLaboratoryAxisContinuation({
    currentTask: currentTask.value,
    experimentRuns: experimentRuns.value,
    experimentRunSteps: experimentRunSteps.value,
    runningExperiment: runningExperiment.value,
    schedules: schedules.value,
  }));
  const currentAxisCompletion = computed(() => {
    const continuation = axisContinuation.value;
    return {
      axisCode: normalizeText(continuation.currentAxisCode),
      enabled: Boolean(continuation.hasAxisSteps && continuation.currentAxisCode),
    };
  });
  const axisTransitionKey = (continuation = {}) => [
    normalizeText(continuation.runNo),
    normalizeText(continuation.currentAxisCode),
  ].filter(Boolean).join("::");
  watch(
    () => [
      axisContinuation.value.runNo,
      axisContinuation.value.currentAxisCode,
      axisContinuation.value.currentStepStatus,
    ],
    ([runNo, currentAxisCode, currentStepStatus]) => {
      const currentKey = [normalizeText(runNo), normalizeText(currentAxisCode)].filter(Boolean).join("::");
      if (
        !currentKey
        || (axisReadyPendingKey.value && currentKey !== axisReadyPendingKey.value)
        || normalizeText(currentStepStatus) === "实验进行中"
      ) {
        axisReadyPendingKey.value = "";
      }
    },
  );
  const runningInteractionLocked = computed(() => runningExperiment.value.active);
  const startAttendanceWorkForRunningExperiment = () => {
    startWorkForRunningExperiment(runningAttendanceStartKey.value);
  };
  const operationLock = computed(() =>
    getLaboratoryOperationLock(view.value.allScheduleRows, currentTask.value, {
      code: laboratoryConfig.value.labCode,
      name: laboratoryConfig.value.labName,
    }),
  );
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
      const canCompareThroughSharedTrayLock =
        operationLock.value.sharedTray
        && !operationLock.value.sameLaboratory
        && state.canCompare
        && workflow.value.hasComparableTrayWithoutActiveOtherExperiment;
      return {
        canCompare: Boolean(canCompareThroughSharedTrayLock),
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
  const canResendReady = computed(() => {
    const readyTrayRows = (Array.isArray(currentTask.value?.trayRows) ? currentTask.value.trayRows : [])
      .filter((row) => String(row?.trayStatus || "").trim() === LAB_READY_STATUS);
    return (
      isMqttHostInterfaceMode()
      && Boolean(currentTask.value)
      && (readyPublishRetryAvailable.value || (Boolean(workflow.value.experimentConfirmed) && readyTrayRows.length > 0))
      && !runningInteractionLocked.value
      && !laboratoryUnderMaintenance.value
      && !operationLock.value.active
    );
  });
  const canRequestReady = computed(() => actionState.value.canMarkReady || canResendReady.value);
  const installActionLabel = computed(() => (canResendFixtureInstall.value ? "重新下发安装" : "安装样品"));
  const readyActionLabel = computed(() => {
    return canResendReady.value ? "重新下发准备" : "确认准备就绪";
  });
  const fixtureConfirmCopy = computed(() => (
    fixtureConfirmHostless.value
      ? {
          body: "该试验间无上位机通信，系统将在倒计时结束后本地自动确认夹具安装完成。",
          eyebrow: "本地自动确认",
          successBody: "准备就绪按钮已解锁，可继续确认实验准备状态。",
          successTitle: "夹具安装已自动确认完成",
        }
      : {
          body: "夹具安装信号已发送，正在等待上位机返回安装完成确认。",
          eyebrow: "等待上位机确认",
          successBody: "准备就绪按钮已解锁，可继续确认实验准备状态。",
          successTitle: "上位机已确认夹具安装完成",
        }
  ));
  const { focusScanInput } = useScanInputFocus(compareScanInputRef);
  const progressMessage = computed(() => buildLaboratoryProgressMessage(workflow.value, currentTask.value, laboratoryConfig.value.labName));
  const {
    clearRunningModalRestoreTimer,
    handleRunningModalActivity,
    hideRunningModal,
    showRunningModal,
  } = useLaboratoryRunningModal({
    completedRunningExperiment,
    confirmedModalOpen,
    experimentRuns,
    openAttendanceLogoutPrompt,
    readyModalOpen,
    runningExperiment,
    runningModalVisible,
  });
  const runningModalExperiment = computed(() => {
    const base = completedRunningExperiment.value?.active ? completedRunningExperiment.value : runningExperiment.value;
    const continuation = axisContinuation.value;
    const activeRun = currentTask.value?.activeRun || null;
    const saltSpray = normalizeText(laboratoryConfig.value.labCode) === "LAB_SALT" && base?.active && !base?.completed
      ? buildSaltSprayRunPresentation({
          activePause: findActivePause(experimentRunPauses.value, base?.runNo),
          activeRun,
          now: tickNow.value,
          runningExperiment: base,
        })
      : null;
    const locallyWaitingForStart = Boolean(
      axisReadyPendingKey.value
      && axisReadyPendingKey.value === axisTransitionKey(continuation)
      && (continuation.isAdjusting || continuation.isWaitingForStart),
    );
    return {
      ...base,
      ...(saltSpray || {}),
      activeRun,
      axisCompletedLabel: continuation.completedAxisCodes.length ? `已完成：${continuation.completedAxisCodes.join("、")}` : "已完成：暂无",
      axisContinuation: {
        ...continuation,
        isSubmittingReady: axisReadySubmitting.value,
        isWaitingForStart: continuation.isWaitingForStart || locallyWaitingForStart,
      },
      axisStatusLabel: locallyWaitingForStart
        ? `等待上位机启动 ${continuation.completedAxisCodes.length}/${continuation.completedAxisCodes.length + continuation.unfinishedAxisCodes.length}轴`
        : continuation.statusLabel,
      axisUnfinishedLabel: continuation.unfinishedAxisCodes.length ? `未完成：${continuation.unfinishedAxisCodes.join("、")}` : "未完成：暂无",
    };
  });
  const canCompleteCompare = computed(() => verifiedTrayCodes.value.length > 0);
  const canTeleportScheduleAction = ref(false);
  const canResetCurrentTask = computed(() => {
    const trayRows = Array.isArray(currentTask.value?.trayRows) ? currentTask.value.trayRows : [];
    return (
      trayRows.length > 0
      && trayRows.some((row) => isResettableTrayStatus(row?.trayStatus))
      && !runningInteractionLocked.value
      && !laboratoryUnderMaintenance.value
    );
  });

  const {
    clearLaboratoryMqError,
    ensureHostInterfaceModeSynced,
    getCurrentLabHostInterfaceCapabilities,
    isHostlessFixtureLab,
    isMqttHostInterfaceMode,
    publishLaboratoryMqSafely,
    usesMqttExperimentEnd,
  } = createLaboratoryDeviceInterface({
    confirmedModalOpen,
    fixtureConfirmModalOpen,
    laboratoryConfig,
    laboratoryMqError,
    onFixturePublishFailure: () => clearFixtureConfirmTimer(),
    readyPublishRetryAvailable,
  });
  const clearHostlessTimers = () => {
    clearHostlessFixtureReadyTimer();
  };
  const usesMqttCompletion = () => isMqttHostInterfaceMode() && usesMqttExperimentEnd();
  const saltSprayPauseFlow = useSaltSprayPauseFlow({
    currentTask,
    experimentRunPauses,
    experimentRuns,
    laboratoryConfig,
    refreshAuthoritativeState: () => load({ silent: true }),
    requestPause: (payload) => publishLaboratoryMqSafely(publishLaboratoryPauseRequest, payload, "暂停实验"),
    requestResume: (payload) => publishLaboratoryMqSafely(publishLaboratoryResumeRequest, payload, "继续实验"),
    requestStop: (payload) => publishLaboratoryMqSafely(publishLaboratoryStopRequest, payload, "停止实验"),
    runWithAttendance,
    runningExperiment,
    samples,
    stagingEvents,
  });

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
    fixtureConfirmHostless.value = false;
    laboratoryMqError.value = null;
    readyPublishRetryAvailable.value = false;
    readyModalOpen.value = false;
    confirmedModalOpen.value = false;
    resetConfirmModalOpen.value = false;
    resetDangerModalOpen.value = false;
    resetTarget.value = null;
    runningModalVisible.value = false;
    completedRunningExperiment.value = null;
    completionAwaitingConfirmation.value = null;
    completionConfirmationError.value = "";
    clearCompletionConfirmationTimer();
    resetAttendanceInteraction();
    clearRunningModalRestoreTimer();
    clearFixtureConfirmTimer();
    clearFixtureConfirmSuccessTimer();
    clearHostlessTimers();
    flushPendingRealtimeRefresh();
  };

  const syncHeaderActionTarget = () => {
    canTeleportScheduleAction.value = typeof document !== "undefined" && Boolean(document.querySelector(HEADER_ACTION_TARGET_SELECTOR));
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

  const resetCompareState = () => {
    compareScanCode.value = "";
    compareFeedback.value = null;
    verifiedTrayCodes.value = [];
  };

  const taskSelectionKey = (task) => String(task?.id || task?.experimentKey || task?.taskCode || "").trim();

  const taskHasSwitchRevertibleTrays = (task) =>
    (Array.isArray(task?.trayRows) ? task.trayRows : []).some((row) =>
      SWITCH_REVERTIBLE_TRAY_STATUSES.has(String(row?.trayStatus || row?.displayStatus || "").trim()),
    );
  const taskHasSwitchLockedTrays = (task) =>
    (Array.isArray(task?.trayRows) ? task.trayRows : []).some((row) =>
      TASK_SWITCH_LOCKED_TRAY_STATUSES.has(String(row?.trayStatus || row?.displayStatus || row?.lifecycleStatus || "").trim()),
    );
  const currentTaskSwitchLocked = computed(() => taskHasSwitchLockedTrays(currentTask.value));
  const canSelectTaskKey = (taskKey) => {
    const nextSelectionKey = String(taskKey ?? "").trim();
    const currentSelectionKey = taskSelectionKey(currentTask.value);
    const nextTask = view.value.scheduleRows.find((row) => taskSelectionKey(row) === nextSelectionKey);
    return (
      !runningInteractionLocked.value
      && Boolean(nextSelectionKey)
      && nextTask?.sequenceEligible !== false
      && (!currentTaskSwitchLocked.value || !currentSelectionKey || nextSelectionKey === currentSelectionKey)
    );
  };

  const buildCurrentSnapshotFallback = () => ({
    [STORAGE_KEYS.tasks]: tasks.value,
    [STORAGE_KEYS.schedules]: schedules.value,
    [STORAGE_KEYS.experiments]: experiments.value,
    [STORAGE_KEYS.experiment_runs]: experimentRuns.value,
    [STORAGE_KEYS.experiment_run_pauses]: experimentRunPauses.value,
    [STORAGE_KEYS.experiment_run_trays]: experimentRunTrays.value,
    [STORAGE_KEYS.experiment_run_steps]: experimentRunSteps.value,
    [STORAGE_KEYS.experiment_trays]: experimentTrays.value,
    [STORAGE_KEYS.samples]: samples.value,
    [STORAGE_KEYS.staging_events]: stagingEvents.value,
    [STORAGE_KEYS.devices]: devices.value,
  });

  const hasLoadedSnapshotData = () =>
    tasks.value.length > 0
    || schedules.value.length > 0
    || experiments.value.length > 0
    || experimentRuns.value.length > 0
    || experimentRunPauses.value.length > 0
    || experimentRunTrays.value.length > 0
    || experimentRunSteps.value.length > 0
    || experimentTrays.value.length > 0
    || samples.value.length > 0
    || stagingEvents.value.length > 0
    || devices.value.length > 0;

  const applySnapshotArray = (snapshot, key, target, { preserveInvalid = false } = {}) => {
    if (Array.isArray(snapshot?.[key])) {
      target.value = snapshot[key];
      return;
    }
    if (!preserveInvalid) {
      target.value = [];
    }
  };

  const load = async ({ silent = false } = {}) => {
    const loadRequest = ++latestSnapshotLoadRequest;
    const showBlockingLoading = !silent || !hasLoadedSnapshotData();
    if (showBlockingLoading) {
      loading.value = true;
    }
    try {
      const [snapshot, masterLabs] = await Promise.all([
        loadSnapshot(silent ? { fallbackSnapshot: buildCurrentSnapshotFallback() } : undefined),
        readMasterLabs().catch(() => []),
      ]);
      if (loadRequest !== latestSnapshotLoadRequest) {
        return;
      }
      const explicitLabName = getSelectedLabName();
      const nextConfig = resolveLaboratoryConfig(masterLabs, explicitLabName || readStoredLabName());
      if (normalizeText(laboratoryConfig.value.labName) !== normalizeText(nextConfig.labName)) {
        closeFullInteractionState();
      }
      laboratoryConfig.value = nextConfig;
      if (explicitLabName) {
        writeStoredLabName(nextConfig.labName);
      }
      const attendanceLoad = loadAttendanceSession(nextConfig.labName);
      const preserveInvalid = silent;
      applySnapshotArray(snapshot, STORAGE_KEYS.tasks, tasks, { preserveInvalid });
      applySnapshotArray(snapshot, STORAGE_KEYS.schedules, schedules, { preserveInvalid });
      applySnapshotArray(snapshot, STORAGE_KEYS.experiments, experiments, { preserveInvalid });
      applySnapshotArray(snapshot, STORAGE_KEYS.experiment_runs, experimentRuns, { preserveInvalid });
      applySnapshotArray(snapshot, STORAGE_KEYS.experiment_run_pauses, experimentRunPauses, { preserveInvalid });
      applySnapshotArray(snapshot, STORAGE_KEYS.experiment_run_trays, experimentRunTrays, { preserveInvalid });
      applySnapshotArray(snapshot, STORAGE_KEYS.experiment_run_steps, experimentRunSteps, { preserveInvalid });
      applySnapshotArray(snapshot, STORAGE_KEYS.experiment_trays, experimentTrays, { preserveInvalid });
      applySnapshotArray(snapshot, STORAGE_KEYS.samples, samples, { preserveInvalid });
      applySnapshotArray(snapshot, STORAGE_KEYS.staging_events, stagingEvents, { preserveInvalid });
      applySnapshotArray(snapshot, STORAGE_KEYS.devices, devices, { preserveInvalid });
      await attendanceLoad;
    } finally {
      if (showBlockingLoading) {
        loading.value = false;
      }
    }
  };

  const applyWithdrawResponse = (payload) => {
    if (Array.isArray(payload?.samples)) {
      samples.value = payload.samples;
    }
  };

  watch(
    [runningAttendanceStartKey, attendanceLoggedIn, attendanceWorkStartedAt],
    startAttendanceWorkForRunningExperiment,
    { flush: "post" },
  );

  const realtimeRefresh = useLaboratoryRealtimeRefresh({
    compareModalOpen,
    installModalOpen,
    load,
    readyModalOpen,
    resetConfirmModalOpen,
    resetDangerModalOpen,
    scheduleModalOpen,
    taskListModalOpen,
  });
  flushPendingRealtimeRefresh = realtimeRefresh.flushPendingRealtimeRefresh;
  ignoreNextSamplesUpdatedRefresh = realtimeRefresh.ignoreNextSamplesUpdatedRefresh;

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
        tickNow.value = readNow();
      }, 1000);
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
      window.removeEventListener("pointerdown", handleRunningModalActivity, true);
      window.removeEventListener("mousemove", handleRunningModalActivity, true);
      window.removeEventListener("wheel", handleRunningModalActivity, true);
      window.removeEventListener("touchstart", handleRunningModalActivity, true);
      window.removeEventListener("keydown", handleRunningModalActivity, true);
      window.removeEventListener("storage", handleHostInterfaceModeChanged);
      window.removeEventListener(HOST_INTERFACE_MODE_CHANGED_EVENT, handleHostInterfaceModeChanged);
    }
    clearCompletionConfirmationTimer();
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
    pendingTaskCode.value = taskSelectionKey(selectedTask.value || currentTask.value);
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
    await runWithAttendance(async () => {
      resetCompareState();
      compareModalOpen.value = true;
      await focusScanInput();
    });
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
  const {
    closeResetConfirm,
    closeResetDanger,
    confirmResetPrompt,
    confirmResetTask,
    openResetConfirm,
  } = useLaboratoryResetFlow({
    applyWithdrawResponse,
    canResetCurrentTask,
    clearHostlessTimers,
    clearLaboratoryMqError,
    currentTask,
    flushPendingRealtimeRefresh: () => flushPendingRealtimeRefresh(),
    ignoreNextSamplesUpdatedRefresh: () => ignoreNextSamplesUpdatedRefresh(),
    laboratoryMqError,
    load,
    resetConfirmModalOpen,
    resetCompareState,
    resetDangerModalOpen,
    resetSubmitting,
    resetTarget,
  });
  watch(
    () => getSelectedLabName(),
    () => {
      void load();
    },
  );
  const {
    buildFixtureInstallPayload,
    buildReadyPayload,
    persistCurrentTaskStep,
    persistFixtureReadyForTask,
    persistRunningExperimentCompletion,
  } = useLaboratoryOperationPersistence({
    applyExperimentStartAttendance,
    currentTask,
    experimentRunSteps,
    experimentRunTrays,
    experimentRuns,
    experiments,
    getCurrentTaskTrayCodesByStatus,
    getCurrentTaskTrayRowsByStatus,
    laboratoryConfig,
    samples,
    schedules,
    tasks,
    verifiedTrayCodes,
  });
  const {
    completeExperimentNow,
    confirmCompleteCurrentAxis,
  } = useLaboratoryCompletionFlow({
    axisContinuation,
    clearRunningModalRestoreTimer,
    completionAwaitingConfirmation,
    completionConfirmationError,
    completionSubmitting,
    completedRunningExperiment,
    currentTask,
    experimentRunSteps,
    experimentRunTrays,
    experimentRuns,
    experiments,
    flushPendingRealtimeRefresh: () => flushPendingRealtimeRefresh(),
    laboratoryConfig,
    load,
    persistRunningExperimentCompletion,
    requestMqttExperimentEnd: (payload) => publishLaboratoryMqSafely(
      publishLaboratoryEndRequest,
      payload,
      "立即结束实验",
    ),
    runWithAttendance,
    runningExperiment,
    runningModalVisible,
    samples,
    schedules,
    usesMqttCompletion,
  });
  watch(
    completionAwaitingConfirmation,
    (pending) => {
      clearCompletionConfirmationTimer();
      if (!pending || typeof window === "undefined") {
        return;
      }
      completionConfirmationTimer = window.setTimeout(() => {
        if (completionAwaitingConfirmation.value !== pending) {
          return;
        }
        completionAwaitingConfirmation.value = null;
        completionConfirmationError.value = "结束命令已发送，但 10 秒内未收到上位机结束确认。请确认设备状态后重试。";
        completionConfirmationTimer = null;
      }, COMPLETION_CONFIRMATION_TIMEOUT_MS);
    },
  );
  watch(
    [completionAwaitingConfirmation, experimentRuns, experimentRunSteps],
    ([pending, currentRuns, currentSteps]) => {
      if (!completionConfirmationMatches(pending, currentRuns, currentSteps)) {
        return;
      }
      completionAwaitingConfirmation.value = null;
      completionConfirmationError.value = "";
      clearCompletionConfirmationTimer();
    },
    { deep: true },
  );
  const fixtureConfirmation = useLaboratoryFixtureConfirmation({
    fixtureConfirmCountdown,
    fixtureConfirmHostless,
    fixtureConfirmModalOpen,
    fixtureConfirmSuccessModalOpen,
    flushPendingRealtimeRefresh: () => flushPendingRealtimeRefresh(),
    getCurrentLabHostInterfaceCapabilities,
    isMqttHostInterfaceMode,
    laboratoryMqError,
    persistFixtureReadyForTask,
    refreshAuthoritativeState: () => load({ silent: true }),
    workflow,
  });
  clearFixtureConfirmTimer = fixtureConfirmation.clearFixtureConfirmTimer;
  clearFixtureConfirmSuccessTimer = fixtureConfirmation.clearFixtureConfirmSuccessTimer;
  clearHostlessFixtureReadyTimer = fixtureConfirmation.clearHostlessFixtureReadyTimer;
  const { openFixtureConfirmPending, scheduleHostlessFixtureReady, startFixtureConfirmCountdown } = fixtureConfirmation;
  const confirmAxisAdjustmentReady = async () => {
    await runWithAttendance(async () => {
      const continuation = axisContinuation.value;
      const transitionKey = axisTransitionKey(continuation);
      if (!continuation.isAdjusting || !transitionKey || axisReadySubmitting.value || axisReadyPendingKey.value === transitionKey) {
        return;
      }
      axisReadySubmitting.value = true;
      const targetAxisCode = normalizeText(continuation.currentAxisCode);
      const runAxisCodes = Array.isArray(continuation.runAxisCodes) && continuation.runAxisCodes.length > 0
        ? continuation.runAxisCodes
        : [targetAxisCode].filter(Boolean);
      const payload = buildReadyPayload({
        axisBatchNo: continuation.axisBatchNo,
        axisCodes: runAxisCodes,
        currentAxisCode: targetAxisCode,
        runNo: continuation.runNo,
        scheduleId: continuation.scheduleId,
        subExperimentCode: continuation.subExperimentCode,
      });
      payload.axis_adjustment_ready = true;
      try {
        const published = await publishLaboratoryMqSafely(publishLaboratoryReady, payload, "准备就绪");
        if (published) {
          axisReadyPendingKey.value = transitionKey;
        }
      } catch (error) {
        if (axisReadyPendingKey.value === transitionKey) {
          axisReadyPendingKey.value = "";
        }
        laboratoryMqError.value = {
          detail: formatErrorMessage(error),
          title: "轴向准备就绪失败",
        };
      } finally {
        axisReadySubmitting.value = false;
      }
    });
  };
  const confirmCurrentAxisAction = async () => {
    if (axisContinuation.value.isAdjusting) {
      await confirmAxisAdjustmentReady();
      return;
    }
    if (axisContinuation.value.isWaitingForStart) {
      return;
    }
    await confirmCompleteCurrentAxis();
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
    void runWithAttendance(async () => {
      installModalOpen.value = true;
    });
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
    const targetTaskCode = currentTask.value?.taskCode || "";
    const isResend = !actionState.value.canInstallSample && canResendFixtureInstall.value;
    const targetTrayCodes = getCurrentTaskTrayCodesByStatus(isResend ? LAB_INSTALL_STATUS : LAB_COMPARE_STATUS);
    const payload = buildFixtureInstallPayload({ trayCodes: targetTrayCodes });
    const persistOperation = isResend ? Promise.resolve() : persistCurrentTaskStep(LAB_INSTALL_STATUS, "样品安装");
    installModalOpen.value = false;
    if (isHostlessFixtureLab()) {
      clearFixtureConfirmTimer();
      clearFixtureConfirmSuccessTimer();
      fixtureConfirmModalOpen.value = false;
      fixtureConfirmSuccessModalOpen.value = false;
      void persistOperation
        .then(() => scheduleHostlessFixtureReady({ taskCode: targetTaskCode, trayCodes: targetTrayCodes }))
        .catch((error) => {
          laboratoryMqError.value = {
            detail: formatErrorMessage(error),
            title: "夹具安装确认失败",
          };
        });
      return;
    }
    openFixtureConfirmPending();
    void persistOperation
      .then(() => publishLaboratoryMqSafely(publishLaboratoryFixtureInstall, payload, "夹具安装"))
      .then((published) => {
        if (published && !workflow.value.fixtureReadyDone) {
          startFixtureConfirmCountdown({ taskCode: targetTaskCode, trayCodes: targetTrayCodes });
        }
      })
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
    void runWithAttendance(async () => {
      readyModalOpen.value = true;
    });
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
  const confirmCurrentTask = () => {
    if (!pendingTaskCode.value || runningInteractionLocked.value) {
      return;
    }
    const previousTask = currentTask.value;
    const nextSelectionKey = String(pendingTaskCode.value || "").trim();
    const previousSelectionKey = taskSelectionKey(previousTask);
    if (currentTaskSwitchLocked.value && previousSelectionKey && previousSelectionKey !== nextSelectionKey) {
      pendingTaskCode.value = previousSelectionKey;
      return;
    }
    const pendingRevertKey = taskSelectionKey(pendingRevertTask.value);
    if (pendingRevertKey && pendingRevertKey === nextSelectionKey) {
      pendingRevertTask.value = null;
    } else if (previousSelectionKey && previousSelectionKey !== nextSelectionKey && taskHasSwitchRevertibleTrays(previousTask)) {
      pendingRevertTask.value = previousTask;
    }
    if (previousSelectionKey && previousSelectionKey !== nextSelectionKey) {
      clearHostlessTimers();
    }
    selectedTaskCode.value = pendingTaskCode.value;
    resetCompareState();
    taskListModalOpen.value = false;
    flushPendingRealtimeRefresh();
  };

  return {
    ...saltSprayPauseFlow,
    actionState,
    attendanceLoggedIn,
    attendanceLoginError,
    attendanceLoginMode,
    attendanceLoginModalOpen,
    attendanceLoginPassword,
    attendanceLoginUsername,
    attendanceQrInputRef,
    attendanceQrPayload,
    attendanceLogoutCountdown,
    attendanceLogoutPromptOpen,
    attendanceSession,
    attendanceStatus,
    attendanceSubmitting,
    canRequestFixtureInstall,
    canRequestReady,
    canTeleportScheduleAction,
    checklist,
    closeAttendanceLogin,
    completionAwaitingConfirmation,
    completionConfirmationError,
    completionSubmitting,
    currentAxisCompletion,
    compareFeedback,
    compareScanInputRef,
    closeCompare,
    closeConfirmed,
    closeInstall,
    fixtureConfirmCountdown,
    fixtureConfirmCopy,
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
      confirmCurrentTask,
      confirmCompare,
    confirmResetPrompt,
    confirmResetTask,
    confirmCurrentAxisAction,
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
    currentTaskSwitchLocked,
    selectedTask,
    hasLaboratoryTasks,
    completeExperimentNow,
    openCompare,
    openAttendanceLogin,
    openInstall,
    openReady,
    openResetConfirm,
    openScheduleBoard,
    openTaskList,
    logoutAttendance,
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
    resetSubmitting,
    runningExperiment,
    runningModalExperiment,
    runningModalVisible,
    scheduleModalOpen,
    scheduleRows: computed(() => view.value.scheduleRows),
    canSelectTaskKey,
    setPendingTaskCode: (taskKey) => {
      if (!canSelectTaskKey(taskKey)) {
        return;
      }
      pendingTaskCode.value = String(taskKey ?? "");
    },
    summary,
    submitCompareScan,
    submitAttendanceLogin,
    submitAttendanceQrLogin,
    setAttendanceLoginMode,
    selectedTrayCode,
    selectedTrayFlow: computed(() => view.value.selectedTrayFlow),
    selectedTrayRow: computed(() => view.value.selectedTrayRow),
    trayFlowTask: computed(() => view.value.trayFlowTask),
    setSelectedTrayCode: (trayCode) => {
      selectedTrayCode.value = String(trayCode ?? "");
    },
    taskListModalOpen,
    verifiedTrayCodes,
  };
}

export { useLaboratoryPage };
