import { computed, nextTick, onBeforeUnmount, onMounted, ref, unref, watch } from "vue";

import { useScanInputFocus } from "@/composables/useScanInputFocus";
import {
  HOST_INTERFACE_MODE_CHANGED_EVENT,
  HOST_INTERFACE_MODE_STORAGE_KEY,
  HOST_INTERFACE_MODES,
  readHostInterfaceMode,
} from "@/lib/hostInterfaceMode";
import { syncHostInterfaceMode } from "@/lib/hostInterfaceModeApi";
import { getLabHostInterfaceCapabilities } from "@/lib/labHostInterfaceCapabilities";
import {
  applyLaboratoryOperation,
  completeLaboratoryExperiment,
  startLaboratoryExperiment,
  withdrawCurrentLaboratoryExperiment,
} from "@/lib/laboratoryApi";
import {
  loginLaboratoryAttendance,
  logoutLaboratoryAttendance,
  markLaboratoryAttendanceWorkStarted,
  readLaboratoryAttendanceSession,
} from "@/lib/attendanceApi";
import { canonicalAxisCode, normalizeAxisCodes } from "@/lib/axisCodes";
import { formatLocalDateTime } from "@/lib/dateTime";
import { publishLaboratoryFixtureInstall, publishLaboratoryReady } from "@/lib/laboratoryMqApi";
import { readMasterLabs } from "@/lib/masterDataApi";
import { LABORATORY_OPTIONS } from "@/lib/moduleCatalog";
import { useStorageSnapshot } from "@/composables/useStorageSnapshot";
import { useStorageSnapshotRefresh } from "@/composables/useStorageSnapshotRefresh";
import { STORAGE_KEYS } from "@/lib/storageKeys";
import { SAMPLES_UPDATED_EVENT } from "@/modules/samples/sampleEvents";
import { isAxisPartialProgressStatus } from "@/modules/experiment-progress/axisProgress";
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
  SALT_SPRAY_LAB,
  validateLaboratoryTrayScan,
} from "./model";

const RUNNING_MODAL_RESTORE_MS = 10_000;
const COMPLETED_RUNNING_MODAL_AUTO_CLOSE_MS = 60_000;
const HEADER_ACTION_TARGET_SELECTOR = ".header-actions-before-logout";
const RESETTABLE_TRAY_STATUSES = new Set([LAB_COMPARE_STATUS, LAB_INSTALL_STATUS, LAB_READY_STATUS]);
const SWITCH_REVERTIBLE_TRAY_STATUSES = new Set([LAB_COMPARE_STATUS, LAB_INSTALL_STATUS, LAB_READY_STATUS]);
const TASK_SWITCH_LOCKED_TRAY_STATUSES = new Set([LAB_COMPARE_STATUS, LAB_INSTALL_STATUS, LAB_READY_STATUS, "实验进行中", "实验中"]);
const COMPLETED_EXPERIMENT_RUN_STATUSES = new Set(["实验完成", "实验已完成", "实验已经完成"]);
const SALT_SPRAY_LAB_ID = "salt-spray-lab-01";
const SALT_SPRAY_LAB_CODE = "LAB_SALT";
const LABORATORY_SELECTED_LAB_STORAGE_KEY = "mes_laboratory_selected_lab_v1";
const FIXTURE_CONFIRM_COUNTDOWN_SECONDS = 5;
const FIXTURE_CONFIRM_SUCCESS_MS = 1000;
const ATTENDANCE_LOGOUT_COUNTDOWN_SECONDS = 30;
const LABORATORY_SNAPSHOT_KEYS = new Set([
  STORAGE_KEYS.tasks,
  STORAGE_KEYS.schedules,
  STORAGE_KEYS.experiments,
  STORAGE_KEYS.experiment_runs,
  STORAGE_KEYS.experiment_run_trays,
  STORAGE_KEYS.experiment_run_steps,
  STORAGE_KEYS.experiment_trays,
  STORAGE_KEYS.samples,
  STORAGE_KEYS.devices,
]);

const normalizeText = (value) => String(value ?? "").trim();
const formatFlowTimeForAttendance = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "--:--";
  }
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
};
const formatAttendanceDuration = (elapsedSeconds) => {
  const seconds = Math.max(0, Math.floor(Number(elapsedSeconds) || 0));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
};
const isResettableTrayStatus = (status) => {
  const normalized = normalizeText(status);
  return RESETTABLE_TRAY_STATUSES.has(normalized) || isAxisPartialProgressStatus(normalized);
};
const formatErrorMessage = (error) => normalizeText(error?.message || error) || "未知错误";
const generateExperimentRunNo = () => `run-${Date.now()}-${Math.floor(Math.random() * 1000).toString().padStart(3, "0")}`;
const stepAxisCode = (step) => canonicalAxisCode(step?.axis_code || step?.axisCode);
const stepRunNo = (step) => normalizeText(step?.run_no || step?.runNo);
const stepStatus = (step) => normalizeText(step?.status || step?.step_status || step?.stepStatus);
const scheduleAxisCodes = (schedule) => normalizeAxisCodes(schedule?.axis_codes ?? schedule?.axisCodes);
const resolveSubExperimentCode = (value = {}) =>
  normalizeText(value?.subExperimentCode ?? value?.sub_experiment_code ?? value?.sub_experiment_no ?? value?.subExperimentNo);

const STATIC_LAB_CODES_BY_NAME = Object.freeze({
  "冲击一室": "LAB_IMPACT_1",
  "冲击二室": "LAB_IMPACT_2",
  "振动一室": "LAB_VIBRATION_1",
  "振动二室": "LAB_VIBRATION_2",
  "四综合实验室": "LAB_COMPREHENSIVE",
  "温度冲击一室": "LAB_TEMP_SHOCK_1",
  "温度冲击二室": "LAB_TEMP_SHOCK_2",
  "高低温湿热一室": "LAB_HOT_HUMID",
  "高低温湿热二室": "LAB_HOT_HUMID_2",
  "盐雾试验室": SALT_SPRAY_LAB_CODE,
  "霉菌试验室": "LAB_MOLD",
});
const STATIC_LAB_NAMES = Array.from(new Set([
  ...LABORATORY_OPTIONS.map((option) => option.label),
  ...Object.keys(STATIC_LAB_CODES_BY_NAME),
]));

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
      STORAGE_KEYS.experiment_run_steps,
      STORAGE_KEYS.experiment_trays,
      STORAGE_KEYS.samples,
      STORAGE_KEYS.devices,
    ]);
  const loadSnapshot = options.loadSnapshot || storage.loadSnapshot;

  const loading = ref(false);
  const laboratoryConfig = ref(createDefaultLaboratoryConfig());
  const tasks = ref([]);
  const schedules = ref([]);
  const experiments = ref([]);
  const experimentRuns = ref([]);
  const experimentRunTrays = ref([]);
  const experimentRunSteps = ref([]);
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
  const fixtureConfirmHostless = ref(false);
  const readyModalOpen = ref(false);
  const confirmedModalOpen = ref(false);
  const laboratoryMqError = ref(null);
  const readyPublishRetryAvailable = ref(false);
  const resetConfirmModalOpen = ref(false);
  const resetDangerModalOpen = ref(false);
  const completePromptVisible = ref(false);
  const runningModalVisible = ref(false);
  const completedRunningExperiment = ref(null);
  const attendanceSession = ref({ active: false });
  const attendanceLoginModalOpen = ref(false);
  const attendanceLoginUsername = ref("");
  const attendanceLoginPassword = ref("");
  const attendanceLoginError = ref("");
  const attendanceSubmitting = ref(false);
  const attendanceLogoutPromptOpen = ref(false);
  const attendanceLogoutCountdown = ref(ATTENDANCE_LOGOUT_COUNTDOWN_SECONDS);
  const tickNow = ref(now || new Date());
  let tickTimer = null;
  let runningModalRestoreTimer = null;
  let completedRunningModalAutoCloseTimer = null;
  let fixtureConfirmTimer = null;
  let fixtureConfirmSuccessTimer = null;
  let hostlessFixtureReadyTimer = null;
  let hostlessStartTimer = null;
  let attendanceLogoutTimer = null;
  let attendanceSessionLoadPromise = null;
  let attendanceWorkStartPendingKey = "";
  let optimisticAttendanceWorkStartedAt = "";
  let suppressNextAttendanceWorkStart = false;
  let pendingAttendanceAction = null;
  let samplesPersistQueue = null;
  let ignoreNextSamplesUpdatedLoad = false;
  const completingRunningExperimentKeys = new Set();
  let lastActiveRunningExperiment = null;
  let flushPendingStorageRefresh = () => false;
  let hasPendingSamplesRefresh = false;
  let hostInterfaceModeSync = null;

  const getSelectedLabName = () => normalizeSelectedLabName(unref(options.selectedLabName));
  const attendanceLoggedIn = computed(() => Boolean(attendanceSession.value?.active && normalizeText(attendanceSession.value?.username)));
  const attendanceWorkStartedAt = computed(() => normalizeText(attendanceSession.value?.workStartedAt || attendanceSession.value?.work_started_at));
  const attendanceStatus = computed(() => {
    if (!attendanceLoggedIn.value) {
      return {
        detail: "请先登录后操作",
        employeeName: "未登录",
      };
    }
    const loggedInAt = normalizeText(attendanceSession.value?.loggedInAt || attendanceSession.value?.logged_in_at);
    const workStartedAt = attendanceWorkStartedAt.value;
    const workStartedTime = workStartedAt ? new Date(workStartedAt).getTime() : Number.NaN;
    const elapsedSeconds = Number.isNaN(workStartedTime)
      ? 0
      : Math.floor((tickNow.value.getTime() - workStartedTime) / 1000);
    return {
      detail: `${loggedInAt ? formatFlowTimeForAttendance(loggedInAt) : "--:--"} 登录 / 当前 ${formatAttendanceDuration(elapsedSeconds)}`,
      employeeName: normalizeText(attendanceSession.value?.employeeName || attendanceSession.value?.employee_name || attendanceSession.value?.username),
    };
  });

  const view = computed(() =>
    buildLaboratoryWorkbenchView({
      experiments: experiments.value,
      experimentRuns: experimentRuns.value,
      experimentRunSteps: experimentRunSteps.value,
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
  const selectedTask = computed(() => view.value.selectedTask);
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
  const runningExperiment = computed(() => view.value.runningExperiment);
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
  const axisContinuation = computed(() => {
    const activeRunNo = normalizeText(runningExperiment.value?.runNo);
    const taskCode = normalizeText(currentTask.value?.taskCode);
    const experimentCode = normalizeText(currentTask.value?.experimentCode);
    const emptyState = {
      canContinue: false,
      completedAxisCodes: [],
      currentAxisCode: "",
      hasAxisSteps: false,
      nextAxisCode: "",
      statusLabel: "",
      unfinishedAxisCodes: [],
    };
    if (!activeRunNo || !taskCode || !experimentCode) {
      return emptyState;
    }
    const currentRun = experimentRuns.value.find((run) => {
      const runNo = normalizeText(run?.run_no || run?.runNo || run?.id);
      return runNo === activeRunNo;
    });
    const currentRunScheduleId = normalizeText(currentRun?.schedule_id || currentRun?.scheduleId);
    const currentRunSchedule = schedules.value.find(
      (schedule) => normalizeText(schedule?.id || schedule?.schedule_id || schedule?.scheduleId) === currentRunScheduleId,
    );
    const steps = experimentRunSteps.value
      .filter((step) => stepRunNo(step) === activeRunNo)
      .sort((left, right) => Number(left?.step_no ?? left?.stepNo ?? 0) - Number(right?.step_no ?? right?.stepNo ?? 0));
    const runningStepIndex = steps.findIndex((step) => stepStatus(step) === "实验进行中");
    const currentIndex = runningStepIndex >= 0 ? runningStepIndex : steps.findIndex((step) => stepStatus(step) !== "实验已完成");
    const currentStep = currentIndex >= 0 ? steps[currentIndex] : null;
    const nextStep = currentIndex >= 0 ? steps.slice(currentIndex + 1).find((step) => stepStatus(step) !== "实验已完成") : null;
    const currentAxisCode = stepAxisCode(currentStep);
    const nextAxisCode = stepAxisCode(nextStep);
    const completedAxisCodes = steps
      .filter((step) => stepStatus(step) === "实验已完成")
      .map(stepAxisCode)
      .filter(Boolean);
    const unfinishedAxisCodes = steps
      .filter((step) => stepStatus(step) !== "实验已完成")
      .map(stepAxisCode)
      .filter(Boolean);
    const completedCount = completedAxisCodes.length;
    const totalCount = steps.length;
    const statusLabel = totalCount > 0 ? `实验进行中 ${completedCount}/${totalCount}轴` : "";
    const hasAxisSteps = Boolean(currentAxisCode && totalCount > 0);
    const baseState = { completedAxisCodes, currentAxisCode, hasAxisSteps, nextAxisCode, statusLabel, unfinishedAxisCodes };
    if (!currentAxisCode || !nextAxisCode) {
      return { ...baseState, canContinue: false };
    }
    const currentTaskAxisCodes = scheduleAxisCodes(currentTask.value);
    const currentRunAxisCodes = scheduleAxisCodes(currentRun);
    const currentRunScheduleAxisCodes = scheduleAxisCodes(currentRunSchedule);
    if (
      currentTaskAxisCodes.length > 1
      && normalizeText(currentTask.value?.id) === currentRunScheduleId
      && currentTaskAxisCodes.includes(currentAxisCode)
      && currentTaskAxisCodes.includes(nextAxisCode)
    ) {
      return { ...baseState, canContinue: true };
    }
    if (
      currentRunAxisCodes.length > 1
      && currentRunScheduleAxisCodes.length > 1
      && currentRunAxisCodes.includes(currentAxisCode)
      && currentRunAxisCodes.includes(nextAxisCode)
      && currentRunScheduleAxisCodes.includes(currentAxisCode)
      && currentRunScheduleAxisCodes.includes(nextAxisCode)
    ) {
      return { ...baseState, canContinue: true };
    }
    if (
      currentRunScheduleAxisCodes.length > 1
      && currentRunScheduleAxisCodes.includes(currentAxisCode)
      && currentRunScheduleAxisCodes.includes(nextAxisCode)
    ) {
      return { ...baseState, canContinue: true };
    }
    const currentSchedule = schedules.value.find(
      (schedule) =>
        normalizeText(schedule?.task_code) === taskCode
        && normalizeText(schedule?.experiment_code) === experimentCode
        && scheduleAxisCodes(schedule).includes(currentAxisCode),
    );
    const nextSchedule = schedules.value.find(
      (schedule) =>
        normalizeText(schedule?.task_code) === taskCode
        && normalizeText(schedule?.experiment_code) === experimentCode
        && scheduleAxisCodes(schedule).includes(nextAxisCode),
    );
    if (
      currentSchedule
      && currentSchedule === nextSchedule
      && scheduleAxisCodes(currentSchedule).includes(currentAxisCode)
      && scheduleAxisCodes(currentSchedule).includes(nextAxisCode)
    ) {
      return { ...baseState, canContinue: true };
    }
    return { ...baseState, canContinue: false };
  });
  const currentAxisCompletion = computed(() => {
    const continuation = axisContinuation.value;
    return {
      axisCode: normalizeText(continuation.currentAxisCode),
      enabled: Boolean(continuation.hasAxisSteps && continuation.currentAxisCode),
    };
  });
  const runningInteractionLocked = computed(() => runningExperiment.value.active);
  const startAttendanceWorkForRunningExperiment = () => {
    const startKey = runningAttendanceStartKey.value;
    if (suppressNextAttendanceWorkStart) {
      suppressNextAttendanceWorkStart = false;
      return;
    }
    if (optimisticAttendanceWorkStartedAt && attendanceWorkStartedAt.value) {
      return;
    }
    optimisticAttendanceWorkStartedAt = "";
    if (!startKey || !attendanceLoggedIn.value || attendanceWorkStartedAt.value || attendanceWorkStartPendingKey === startKey) {
      return;
    }
    attendanceWorkStartPendingKey = startKey;
    void markLaboratoryAttendanceWorkStarted(laboratoryConfig.value.labName)
      .then((session) => {
        attendanceSession.value = session;
      })
      .catch((error) => {
        attendanceLoginError.value = formatErrorMessage(error);
        attendanceWorkStartPendingKey = "";
      });
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
  const readyActionLabel = computed(() => {
    if (canResendReady.value && isHostlessMqttLab()) {
      return "重试启动实验";
    }
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
  const runningModalExperiment = computed(() => {
    const base = completedRunningExperiment.value?.active ? completedRunningExperiment.value : runningExperiment.value;
    const continuation = axisContinuation.value;
    return {
      ...base,
      axisCompletedLabel: continuation.completedAxisCodes.length ? `已完成：${continuation.completedAxisCodes.join("、")}` : "已完成：暂无",
      axisContinuation: continuation,
      axisStatusLabel: continuation.statusLabel,
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

  const clearRunningModalRestoreTimer = () => {
    if (runningModalRestoreTimer && typeof window !== "undefined") {
      window.clearTimeout(runningModalRestoreTimer);
      runningModalRestoreTimer = null;
    }
  };
  const clearCompletedRunningModalAutoCloseTimer = () => {
    if (completedRunningModalAutoCloseTimer && typeof window !== "undefined") {
      window.clearTimeout(completedRunningModalAutoCloseTimer);
      completedRunningModalAutoCloseTimer = null;
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
  const clearHostlessFixtureReadyTimer = () => {
    if (hostlessFixtureReadyTimer && typeof window !== "undefined") {
      window.clearTimeout(hostlessFixtureReadyTimer);
      hostlessFixtureReadyTimer = null;
    }
  };
  const clearHostlessStartTimer = () => {
    if (hostlessStartTimer && typeof window !== "undefined") {
      window.clearTimeout(hostlessStartTimer);
      hostlessStartTimer = null;
    }
  };
  const clearHostlessTimers = () => {
    clearHostlessFixtureReadyTimer();
    clearHostlessStartTimer();
  };
  const clearAttendanceLogoutTimer = () => {
    if (attendanceLogoutTimer && typeof window !== "undefined") {
      window.clearInterval(attendanceLogoutTimer);
      attendanceLogoutTimer = null;
    }
  };

  const loadAttendanceSession = async (labName = laboratoryConfig.value.labName) => {
    const normalizedLabName = normalizeText(labName);
    if (!normalizedLabName) {
      attendanceSession.value = { active: false };
      return;
    }
    const loadPromise = (async () => {
      try {
        attendanceSession.value = await readLaboratoryAttendanceSession(normalizedLabName);
      } catch {
        attendanceSession.value = { active: false, labName: normalizedLabName };
      }
    })();
    attendanceSessionLoadPromise = loadPromise;
    try {
      await loadPromise;
    } finally {
      if (attendanceSessionLoadPromise === loadPromise) {
        attendanceSessionLoadPromise = null;
      }
    }
  };

  const openAttendanceLogin = () => {
    attendanceLoginError.value = "";
    attendanceLoginPassword.value = "";
    attendanceLoginModalOpen.value = true;
  };

  const closeAttendanceLogin = () => {
    attendanceLoginModalOpen.value = false;
    pendingAttendanceAction = null;
  };

  const runWithAttendance = async (action) => {
    if (attendanceLoggedIn.value) {
      await action();
      return;
    }
    if (attendanceSessionLoadPromise) {
      await attendanceSessionLoadPromise;
    }
    if (attendanceLoggedIn.value) {
      await action();
      return;
    }
    pendingAttendanceAction = action;
    openAttendanceLogin();
  };

  const submitAttendanceLogin = async () => {
    if (attendanceSubmitting.value) {
      return;
    }
    attendanceLoginError.value = "";
    attendanceSubmitting.value = true;
    try {
      attendanceSession.value = await loginLaboratoryAttendance({
        labName: laboratoryConfig.value.labName,
        password: attendanceLoginPassword.value,
        username: attendanceLoginUsername.value,
      });
      attendanceLoginModalOpen.value = false;
      attendanceLoginPassword.value = "";
      const action = pendingAttendanceAction;
      pendingAttendanceAction = null;
      if (typeof action === "function") {
        await action();
      }
    } catch (error) {
      attendanceLoginError.value = formatErrorMessage(error) || "试验间登录失败";
    } finally {
      attendanceSubmitting.value = false;
    }
  };

  const startAttendanceWorkOptimistically = (startedAt = "") => {
    const normalizedStartedAt = normalizeText(startedAt);
    if (!attendanceLoggedIn.value || attendanceWorkStartedAt.value || !normalizedStartedAt) {
      return null;
    }
    const previousSession = { ...(attendanceSession.value || {}) };
    attendanceSession.value = {
      ...previousSession,
      active: true,
      labName: normalizeText(previousSession.labName || previousSession.lab_name) || laboratoryConfig.value.labName,
      workStartedAt: normalizedStartedAt,
    };
    optimisticAttendanceWorkStartedAt = normalizedStartedAt;
    suppressNextAttendanceWorkStart = true;
    return previousSession;
  };

  const rollbackOptimisticAttendanceWork = (previousSession, startedAt = "") => {
    if (!previousSession) {
      return;
    }
    const normalizedStartedAt = normalizeText(startedAt);
    if (normalizeText(attendanceSession.value?.workStartedAt || attendanceSession.value?.work_started_at) !== normalizedStartedAt) {
      return;
    }
    attendanceSession.value = previousSession;
    optimisticAttendanceWorkStartedAt = "";
    suppressNextAttendanceWorkStart = false;
  };

  const logoutAttendance = async (reason = "manual") => {
    clearAttendanceLogoutTimer();
    attendanceLogoutPromptOpen.value = false;
    attendanceLogoutCountdown.value = ATTENDANCE_LOGOUT_COUNTDOWN_SECONDS;
    attendanceSession.value = await logoutLaboratoryAttendance({
      labName: laboratoryConfig.value.labName,
      reason,
    });
  };

  const openAttendanceLogoutPrompt = () => {
    if (!attendanceLoggedIn.value || typeof window === "undefined") {
      return;
    }
    clearAttendanceLogoutTimer();
    attendanceLogoutCountdown.value = ATTENDANCE_LOGOUT_COUNTDOWN_SECONDS;
    attendanceLogoutPromptOpen.value = true;
    attendanceLogoutTimer = window.setInterval(() => {
      attendanceLogoutCountdown.value = Math.max(0, attendanceLogoutCountdown.value - 1);
      if (attendanceLogoutCountdown.value > 0) {
        return;
      }
      void logoutAttendance("completion-timeout").catch((error) => {
        attendanceLoginError.value = formatErrorMessage(error);
      });
    }, 1000);
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
    fixtureConfirmHostless.value = false;
    laboratoryMqError.value = null;
    readyPublishRetryAvailable.value = false;
    readyModalOpen.value = false;
    confirmedModalOpen.value = false;
    resetConfirmModalOpen.value = false;
    resetDangerModalOpen.value = false;
    completePromptVisible.value = false;
    runningModalVisible.value = false;
    completedRunningExperiment.value = null;
    attendanceLoginModalOpen.value = false;
    attendanceLogoutPromptOpen.value = false;
    pendingAttendanceAction = null;
    clearRunningModalRestoreTimer();
    clearFixtureConfirmTimer();
    clearFixtureConfirmSuccessTimer();
    clearHostlessTimers();
    clearAttendanceLogoutTimer();
    clearCompletedRunningModalAutoCloseTimer();
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
  const scheduleCompletedRunningModalAutoClose = () => {
    clearCompletedRunningModalAutoCloseTimer();
    if (!completedRunningExperiment.value?.active || typeof window === "undefined") {
      return;
    }
    completedRunningModalAutoCloseTimer = window.setTimeout(() => {
      completedRunningExperiment.value = null;
      runningModalVisible.value = false;
      completedRunningModalAutoCloseTimer = null;
    }, COMPLETED_RUNNING_MODAL_AUTO_CLOSE_MS);
  };

  const hideRunningModal = () => {
    if (completedRunningExperiment.value?.active) {
      completedRunningExperiment.value = null;
      runningModalVisible.value = false;
      clearCompletedRunningModalAutoCloseTimer();
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
    openAttendanceLogoutPrompt();
    scheduleCompletedRunningModalAutoClose();
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
    return (
      !runningInteractionLocked.value
      && Boolean(nextSelectionKey)
      && (!currentTaskSwitchLocked.value || !currentSelectionKey || nextSelectionKey === currentSelectionKey)
    );
  };

  const buildCurrentSnapshotFallback = () => ({
    [STORAGE_KEYS.tasks]: tasks.value,
    [STORAGE_KEYS.schedules]: schedules.value,
    [STORAGE_KEYS.experiments]: experiments.value,
    [STORAGE_KEYS.experiment_runs]: experimentRuns.value,
    [STORAGE_KEYS.experiment_run_trays]: experimentRunTrays.value,
    [STORAGE_KEYS.experiment_run_steps]: experimentRunSteps.value,
    [STORAGE_KEYS.experiment_trays]: experimentTrays.value,
    [STORAGE_KEYS.samples]: samples.value,
    [STORAGE_KEYS.devices]: devices.value,
  });

  const hasLoadedSnapshotData = () =>
    tasks.value.length > 0
    || schedules.value.length > 0
    || experiments.value.length > 0
    || experimentRuns.value.length > 0
    || experimentRunTrays.value.length > 0
    || experimentRunSteps.value.length > 0
    || experimentTrays.value.length > 0
    || samples.value.length > 0
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
    const showBlockingLoading = !silent || !hasLoadedSnapshotData();
    if (showBlockingLoading) {
      loading.value = true;
    }
    try {
      const [snapshot, masterLabs] = await Promise.all([
        loadSnapshot(silent ? { fallbackSnapshot: buildCurrentSnapshotFallback() } : undefined),
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
      const attendanceLoad = loadAttendanceSession(nextConfig.labName);
      const preserveInvalid = silent;
      applySnapshotArray(snapshot, STORAGE_KEYS.tasks, tasks, { preserveInvalid });
      applySnapshotArray(snapshot, STORAGE_KEYS.schedules, schedules, { preserveInvalid });
      applySnapshotArray(snapshot, STORAGE_KEYS.experiments, experiments, { preserveInvalid });
      applySnapshotArray(snapshot, STORAGE_KEYS.experiment_runs, experimentRuns, { preserveInvalid });
      applySnapshotArray(snapshot, STORAGE_KEYS.experiment_run_trays, experimentRunTrays, { preserveInvalid });
      applySnapshotArray(snapshot, STORAGE_KEYS.experiment_run_steps, experimentRunSteps, { preserveInvalid });
      applySnapshotArray(snapshot, STORAGE_KEYS.experiment_trays, experimentTrays, { preserveInvalid });
      applySnapshotArray(snapshot, STORAGE_KEYS.samples, samples, { preserveInvalid });
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
      void load({ silent: true });
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
    void load({ silent: true });
  };

  watch(
    [runningAttendanceStartKey, attendanceLoggedIn, attendanceWorkStartedAt],
    startAttendanceWorkForRunningExperiment,
    { flush: "post" },
  );

  const storageRefresh = useStorageSnapshotRefresh({
    keys: Array.from(LABORATORY_SNAPSHOT_KEYS),
    refresh: () => load({ silent: true }),
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
    clearHostlessTimers();
    clearAttendanceLogoutTimer();
    clearCompletedRunningModalAutoCloseTimer();
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
  const getCurrentResettableTrayCodes = () =>
    Array.from(new Set(
      (Array.isArray(currentTask.value?.trayRows) ? currentTask.value.trayRows : [])
        .filter((row) => isResettableTrayStatus(row?.trayStatus))
        .map((row) => String(row?.trayCode || "").trim())
        .filter(Boolean),
    ));
  const getCurrentTaskTrayRowsByStatus = (status) =>
    (Array.isArray(currentTask.value?.trayRows) ? currentTask.value.trayRows : [])
      .filter((row) => String(row?.trayStatus || "").trim() === String(status || "").trim());
  const isMqttHostInterfaceMode = () => readHostInterfaceMode() === HOST_INTERFACE_MODES.mqtt;
  const getCurrentLabHostInterfaceCapabilities = () =>
    getLabHostInterfaceCapabilities({
      hostInterfaceMode: readHostInterfaceMode(),
      labCode: laboratoryConfig.value.labCode || laboratoryConfig.value.labId,
      labName: laboratoryConfig.value.labName,
    });
  const isHostlessMqttLab = () => getCurrentLabHostInterfaceCapabilities().hostless;
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
  const buildReadyPayload = () => {
    const axisCodes = scheduleAxisCodes(currentTask.value);
    const subExperimentCode = resolveSubExperimentCode(currentTask.value);
    const payload = {
      experiment_code: currentTask.value?.experimentCode || "",
      lab_code: laboratoryConfig.value.labCode || laboratoryConfig.value.labId,
      schedule_id: currentTask.value?.id || "",
      task_code: currentTask.value?.taskCode || "",
    };
    const axisBatchNo = currentTask.value?.axis_batch_no || currentTask.value?.axisBatchNo || "";
    if (axisBatchNo) {
      payload.axis_batch_no = axisBatchNo;
    }
    if (axisCodes.length > 0) {
      payload.axis_codes = axisCodes;
      payload.current_axis_code = axisCodes[0];
    }
    if (subExperimentCode) {
      payload.sub_experiment_code = subExperimentCode;
    }
    return payload;
  };
  const applyOperationResponse = (payload = {}) => {
    if (Array.isArray(payload?.tasks)) {
      tasks.value = payload.tasks;
    }
    if (Array.isArray(payload?.samples)) {
      samples.value = payload.samples;
    }
    if (Array.isArray(payload?.schedules)) {
      schedules.value = payload.schedules;
    }
    if (Array.isArray(payload?.experiments)) {
      experiments.value = payload.experiments;
    }
  };
  const applyExperimentStartResponse = (payload = {}) => {
    if (payload?.attendanceSession && typeof payload.attendanceSession === "object") {
      attendanceSession.value = payload.attendanceSession;
      optimisticAttendanceWorkStartedAt = normalizeText(
        payload.attendanceSession.workStartedAt || payload.attendanceSession.work_started_at,
      ) || optimisticAttendanceWorkStartedAt;
    }
    if (Array.isArray(payload?.tasks)) {
      tasks.value = payload.tasks;
    }
    if (Array.isArray(payload?.samples)) {
      samples.value = payload.samples;
    }
    if (Array.isArray(payload?.schedules)) {
      schedules.value = payload.schedules;
    }
    if (Array.isArray(payload?.experiments)) {
      experiments.value = payload.experiments;
    }
    if (Array.isArray(payload?.experimentRuns)) {
      experimentRuns.value = payload.experimentRuns;
    }
    if (Array.isArray(payload?.experimentRunTrays)) {
      experimentRunTrays.value = payload.experimentRunTrays;
    }
    if (Array.isArray(payload?.experimentRunSteps)) {
      experimentRunSteps.value = payload.experimentRunSteps;
    }
  };
  const queueLaboratoryOperation = (operation) => {
    const persistOperation = samplesPersistQueue
      ? samplesPersistQueue.catch(() => {}).then(operation)
      : operation();
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
  const operationTypeForStatus = (nextStatus) => {
    const normalizedStatus = normalizeText(nextStatus);
    if (normalizedStatus === LAB_COMPARE_STATUS) {
      return "compare";
    }
    if (normalizedStatus === LAB_INSTALL_STATUS) {
      return "install";
    }
    if (normalizedStatus === LAB_READY_STATUS) {
      return "ready";
    }
    return "";
  };
  const persistCurrentTaskStep = async (nextStatus, options = {}) => {
    const normalizedOptions = options && typeof options === "object" && !Array.isArray(options) ? options : {};
    const trayCodeOverride = normalizedOptions.trayCodes || null;
    const actionTime = formatLocalDateTime();
    const targetTrayCodes =
      Array.isArray(trayCodeOverride)
        ? trayCodeOverride
        : nextStatus === LAB_COMPARE_STATUS
        ? verifiedTrayCodes.value
        : nextStatus === LAB_INSTALL_STATUS
          ? getCurrentTaskTrayCodesByStatus(LAB_COMPARE_STATUS)
          : nextStatus === LAB_READY_STATUS
            ? getCurrentTaskTrayCodesByStatus(LAB_INSTALL_STATUS)
            : currentTask.value?.trayCodes;
    const operationType = operationTypeForStatus(nextStatus);
    if (!operationType || !currentTask.value) {
      return;
    }
    const payload = await queueLaboratoryOperation(() =>
      applyLaboratoryOperation({
        experimentCode: currentTask.value?.experimentCode,
        labCode: laboratoryConfig.value.labCode || laboratoryConfig.value.labId,
        labName: laboratoryConfig.value.labName,
        occurredAt: actionTime,
        operationType,
        subExperimentCode: resolveSubExperimentCode(currentTask.value),
        taskCode: currentTask.value?.taskCode,
        trayCodes: targetTrayCodes,
      }),
    );
    applyOperationResponse(payload);
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
    const payload = await queueLaboratoryOperation(() =>
      applyLaboratoryOperation({
        experimentCode: currentTask.value?.experimentCode,
        labCode: laboratoryConfig.value.labCode || laboratoryConfig.value.labId,
        labName: laboratoryConfig.value.labName,
        operationType: "fixtureReady",
        taskCode: targetTaskCode,
        trayCodes: Array.from(targetTrayCodes),
      }),
    );
    applyOperationResponse(payload);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent(SAMPLES_UPDATED_EVENT));
    }
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
    fixtureConfirmHostless.value = false;
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
  const scheduleHostlessFixtureReady = ({ taskCode, trayCodes }) => {
    const capabilities = getCurrentLabHostInterfaceCapabilities();
    clearHostlessFixtureReadyTimer();
    clearFixtureConfirmTimer();
    clearFixtureConfirmSuccessTimer();
    if (!capabilities.hostless) {
      return;
    }
    const confirmFixtureReady = () => {
      hostlessFixtureReadyTimer = null;
      clearFixtureConfirmTimer();
      void persistFixtureReadyForTask({ taskCode, trayCodes })
        .then(() => {
          openFixtureConfirmSuccess();
        })
        .catch((error) => {
          laboratoryMqError.value = {
            detail: formatErrorMessage(error),
            title: "夹具安装确认失败",
          };
        });
    };
    if (typeof window === "undefined" || capabilities.fixtureReadyDelayMs <= 0) {
      confirmFixtureReady();
      return;
    }
    fixtureConfirmHostless.value = true;
    fixtureConfirmSuccessModalOpen.value = false;
    fixtureConfirmCountdown.value = Math.ceil(capabilities.fixtureReadyDelayMs / 1000);
    fixtureConfirmModalOpen.value = true;
    fixtureConfirmTimer = window.setInterval(() => {
      fixtureConfirmCountdown.value = Math.max(0, fixtureConfirmCountdown.value - 1);
      if (fixtureConfirmCountdown.value <= 0) {
        clearFixtureConfirmTimer();
      }
    }, 1000);
    hostlessFixtureReadyTimer = window.setTimeout(confirmFixtureReady, capabilities.fixtureReadyDelayMs);
  };
  const scheduleHostlessExperimentStart = ({
    axisBatchNo = "",
    axisCodes = [],
    currentAxisCode = "",
    experimentCode,
    plannedEndAt = "",
    plannedHours = null,
        runNo = "",
        scheduleId = "",
    subExperimentCode = "",
    taskCode,
    trayCodes = [],
  }) => {
    const capabilities = getCurrentLabHostInterfaceCapabilities();
    clearHostlessStartTimer();
    if (!capabilities.hostless) {
      return;
    }
    const startExperiment = () => {
      hostlessStartTimer = null;
      const startedAt = formatLocalDateTime();
      suppressNextAttendanceWorkStart = true;
      const previousAttendanceSession = startAttendanceWorkOptimistically(startedAt);
      void startLaboratoryExperiment({
        axisBatchNo,
        axisCodes,
        currentAxisCode,
        experimentCode,
        labCode: laboratoryConfig.value.labCode || laboratoryConfig.value.labId,
        labName: laboratoryConfig.value.labName,
        plannedEndAt,
        plannedHours,
        runNo,
        scheduleId,
        startedAt,
        subExperimentCode,
        taskCode,
        trayCodes,
      })
        .then((payload) => {
          applyExperimentStartResponse(payload);
          if (typeof window !== "undefined") {
            window.dispatchEvent(new CustomEvent(SAMPLES_UPDATED_EVENT));
          }
        })
        .catch((error) => {
          rollbackOptimisticAttendanceWork(previousAttendanceSession, startedAt);
          suppressNextAttendanceWorkStart = false;
          laboratoryMqError.value = {
            detail: formatErrorMessage(error),
            title: "实验启动失败",
          };
        });
    };
    if (typeof window === "undefined" || capabilities.startDelayMs <= 0) {
      startExperiment();
      return;
    }
    hostlessStartTimer = window.setTimeout(startExperiment, capabilities.startDelayMs);
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
    const payload = buildFixtureInstallPayload();
    const targetTaskCode = currentTask.value?.taskCode || "";
    const isResend = !actionState.value.canInstallSample && canResendFixtureInstall.value;
    const targetTrayCodes = getCurrentTaskTrayCodesByStatus(isResend ? LAB_INSTALL_STATUS : LAB_COMPARE_STATUS);
    const persistOperation = isResend ? Promise.resolve() : persistCurrentTaskStep(LAB_INSTALL_STATUS, "样品安装");
    installModalOpen.value = false;
    if (isHostlessMqttLab()) {
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
    if (isHostlessMqttLab()) {
      const currentAxisCodes = scheduleAxisCodes(currentTask.value);
      scheduleHostlessExperimentStart({
        axisBatchNo: currentTask.value?.axis_batch_no || currentTask.value?.axisBatchNo || "",
        axisCodes: currentAxisCodes,
        currentAxisCode: currentAxisCodes[0] || "",
        experimentCode: currentTask.value?.experimentCode || payload.experiment_code,
        plannedEndAt: currentTask.value?.endAt || "",
        runNo: generateExperimentRunNo(),
        scheduleId: currentTask.value?.id || "",
        subExperimentCode: resolveSubExperimentCode(currentTask.value),
        taskCode: currentTask.value?.taskCode || payload.task_code,
        trayCodes: getCurrentTaskTrayCodesByStatus(LAB_READY_STATUS),
      });
      return;
    }
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
    clearHostlessTimers();
    const withdrawResult = await withdrawCurrentLaboratoryExperiment({
      experimentCode: currentTask.value?.experimentCode,
      reason: "试验间内撤回当前实验任务",
      taskCode: currentTask.value?.taskCode,
      trayCodes: getCurrentResettableTrayCodes(),
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
    void runWithAttendance(async () => {
      completePromptVisible.value = true;
    });
  };
  const closeCompleteConfirm = () => {
    completePromptVisible.value = false;
    flushPendingRealtimeRefresh();
  };
  const completeRunningExperiment = async ({ axisCode = "", keepModal = false, nextAxisCode = "" } = {}) => {
    if (!runningExperiment.value?.active) {
      return;
    }
    const effectiveAxisCode = normalizeText(axisCode) || (currentAxisCompletion.value.enabled ? currentAxisCompletion.value.axisCode : "");
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
        axisCode: effectiveAxisCode,
        completedAt,
        experimentCode,
        nextAxisCode,
        runNo: runningRunNo,
        subExperimentCode: resolveSubExperimentCode(runningExperiment.value) || resolveSubExperimentCode(currentTask.value),
        taskCode,
        trayCodes: runningTrayCodes,
      });
      const experimentCompleted = (Array.isArray(completionResult?.experiments) ? completionResult.experiments : []).some(
        (experiment) =>
          normalizeText(experiment?.task_code) === taskCode
          && normalizeText(experiment?.experiment_code) === experimentCode
          && COMPLETED_EXPERIMENT_RUN_STATUSES.has(normalizeText(experiment?.status)),
      );
      const continuingNextAxisInSchedule = keepModal && Boolean(normalizeText(nextAxisCode));
      completedRunningExperiment.value = keepModal && !continuingNextAxisInSchedule && (!effectiveAxisCode || experimentCompleted)
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
        if (Array.isArray(completionResult?.experimentRunSteps)) {
          experimentRunSteps.value = completionResult.experimentRunSteps;
        }
        schedules.value = completionResult.schedules;
      } else {
        await load();
      }
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent(SAMPLES_UPDATED_EVENT));
      }
      completePromptVisible.value = false;
      runningModalVisible.value = keepModal || Boolean(effectiveAxisCode && !experimentCompleted);
      if (!continuingNextAxisInSchedule) {
        openAttendanceLogoutPrompt();
        scheduleCompletedRunningModalAutoClose();
      }
      clearRunningModalRestoreTimer();
      flushPendingRealtimeRefresh();
    } finally {
      completingRunningExperimentKeys.delete(completionKey);
    }
  };
  const confirmCompleteExperiment = async () => {
    if (currentAxisCompletion.value.enabled) {
      await completeRunningExperiment({ axisCode: currentAxisCompletion.value.axisCode });
      return;
    }
    await completeRunningExperiment();
  };
  const confirmCompleteAxisAndContinue = async () => {
    const continuation = axisContinuation.value;
    if (!continuation.canContinue) {
      return;
    }
    await completeRunningExperiment({
      axisCode: continuation.currentAxisCode,
      keepModal: true,
      nextAxisCode: continuation.nextAxisCode,
    });
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
    actionState,
    attendanceLoggedIn,
    attendanceLoginError,
    attendanceLoginModalOpen,
    attendanceLoginPassword,
    attendanceLoginUsername,
    attendanceLogoutCountdown,
    attendanceLogoutPromptOpen,
    attendanceSession,
    attendanceStatus,
    attendanceSubmitting,
    canRequestFixtureInstall,
    canRequestReady,
    canTeleportScheduleAction,
    checklist,
    closeCompleteConfirm,
    closeAttendanceLogin,
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
      completePromptVisible,
      confirmCurrentTask,
      confirmCompare,
    confirmResetPrompt,
    confirmResetTask,
    confirmCompleteAxisAndContinue,
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
    currentTaskSwitchLocked,
    selectedTask,
    hasLaboratoryTasks,
    openCompare,
    openAttendanceLogin,
    openCompleteConfirm,
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
