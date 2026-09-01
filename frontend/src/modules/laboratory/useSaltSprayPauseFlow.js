import { computed, onBeforeUnmount, ref, watch } from "vue";

import { COMPLETED_EXPERIMENT_RUN_STATUSES, normalizeText } from "./pageHelpers";
import { findActivePause } from "./saltSprayPausePresentation";

const SALT_SPRAY_LAB_CODE = "LAB_SALT";
const CONTROL_CONFIRMATION_TIMEOUT_MS = 16_000;
const ABNORMAL_TERMINATION_STATUSES = new Set(["实验异常终止", "异常终止"]);

const resolveRunNo = (row) => normalizeText(row?.run_no || row?.runNo || row?.id);

function useSaltSprayPauseFlow({
  currentTask,
  experimentRunPauses,
  experimentRuns,
  laboratoryConfig,
  refreshAuthoritativeState,
  requestPause,
  requestResume,
  requestStop,
  runWithAttendance,
  runningExperiment,
  samples,
  stagingEvents,
}) {
  const pauseModalOpen = ref(false);
  const stopModalOpen = ref(false);
  const pauseReason = ref("");
  const stopReason = ref("");
  const controlSubmitting = ref(false);
  const controlAwaitingConfirmation = ref(null);
  const controlConfirmationError = ref("");
  const simulationSubmitting = ref(false);
  let confirmationTimer = null;

  const isSaltSprayLaboratory = computed(() => normalizeText(laboratoryConfig.value?.labCode) === SALT_SPRAY_LAB_CODE);
  const activeRun = computed(() => {
    const runningRunNo = normalizeText(runningExperiment.value?.runNo);
    return (Array.isArray(experimentRuns.value) ? experimentRuns.value : []).find(
      (run) => resolveRunNo(run) === runningRunNo,
    ) || currentTask.value?.activeRun || null;
  });
  const activePause = computed(() => findActivePause(experimentRunPauses.value, runningExperiment.value?.runNo));
  const isPaused = computed(() => normalizeText(activeRun.value?.status || currentTask.value?.runStatus) === "实验暂停");
  const pauseTrayCodes = computed(() => (runningExperiment.value?.trayCodes || []).map((trayCode) => normalizeText(trayCode)).filter(Boolean));
  const activePauseInspectionTrayCodes = computed(() => {
    const values = activePause.value?.inspection_tray_codes || activePause.value?.inspectionTrayCodes || [];
    return (Array.isArray(values) ? values : []).map(normalizeText).filter(Boolean);
  });
  const canResume = computed(() => {
    if (!isPaused.value || controlAwaitingConfirmation.value || controlSubmitting.value) {
      return false;
    }
    const pauseNo = normalizeText(activePause.value?.pause_no || activePause.value?.pauseNo);
    const runNo = normalizeText(runningExperiment.value?.runNo);
    const selectedTrays = activePauseInspectionTrayCodes.value;
    if (!pauseNo || !runNo || !selectedTrays.length) {
      return false;
    }
    return selectedTrays.every((trayCode) => {
      const matchingEvents = (Array.isArray(stagingEvents.value) ? stagingEvents.value : [])
        .map((event, index) => ({ event, index }))
        .filter(({ event }) => normalizeText(event?.room) === "appearance"
          && normalizeText(event?.appearance_phase || event?.appearancePhase) === "mid_experiment"
          && normalizeText(event?.run_no || event?.runNo) === runNo
          && normalizeText(event?.pause_no || event?.pauseNo) === pauseNo
          && normalizeText(event?.tray_code || event?.trayCode) === trayCode)
        .sort((left, right) => {
          const leftTime = Date.parse(left.event?.time || "") || 0;
          const rightTime = Date.parse(right.event?.time || "") || 0;
          return leftTime - rightTime || left.index - right.index;
        });
      const latest = matchingEvents.at(-1)?.event;
      const returnedByEvent = normalizeText(latest?.action) === "stock_out"
        && normalizeText(latest?.target_lab_code || latest?.targetLabCode) === SALT_SPRAY_LAB_CODE;
      const returnedBySample = (Array.isArray(samples.value) ? samples.value : []).some((sample) =>
        normalizeText(sample?.location) === "盐雾试验室"
        && (Array.isArray(sample?.trays) ? sample.trays : []).some((tray) =>
          normalizeText(tray?.tray_code || tray?.trayCode || tray?.code) === trayCode
          && normalizeText(tray?.status) === "等待恢复实验",
        ),
      );
      return returnedByEvent && returnedBySample;
    });
  });

  const clearConfirmationTimer = () => {
    if (confirmationTimer && typeof window !== "undefined") {
      window.clearTimeout(confirmationTimer);
    }
    confirmationTimer = null;
  };

  const closePauseModal = () => {
    if (!controlSubmitting.value) {
      pauseModalOpen.value = false;
    }
  };
  const closeStopModal = () => {
    if (!controlSubmitting.value) {
      stopModalOpen.value = false;
    }
  };
  const openPauseModal = () => {
    if (!isSaltSprayLaboratory.value || isPaused.value || controlAwaitingConfirmation.value) {
      return;
    }
    pauseReason.value = "中途外观检查";
    controlConfirmationError.value = "";
    pauseModalOpen.value = true;
  };
  const openStopModal = () => {
    if (!isSaltSprayLaboratory.value || !isPaused.value || controlAwaitingConfirmation.value) {
      return;
    }
    stopReason.value = "";
    controlConfirmationError.value = "";
    stopModalOpen.value = true;
  };
  const commonPayload = () => ({
    experiment_code: normalizeText(currentTask.value?.experimentCode || runningExperiment.value?.experimentCode),
    lab_code: SALT_SPRAY_LAB_CODE,
    run_no: normalizeText(runningExperiment.value?.runNo),
    task_code: normalizeText(currentTask.value?.taskCode || runningExperiment.value?.taskCode),
  });
  const activePauseNo = () => normalizeText(activePause.value?.pause_no || activePause.value?.pauseNo);
  const startAwaitingConfirmation = (action, commandResult = null) => {
    controlAwaitingConfirmation.value = {
      action,
      pauseNo: normalizeText(commandResult?.pauseNo || commandResult?.pause_no || commandResult?.payload?.pause_no),
      requestedAt: Date.now(),
      runNo: normalizeText(runningExperiment.value?.runNo),
    };
    clearConfirmationTimer();
    if (typeof window !== "undefined") {
      confirmationTimer = window.setTimeout(() => {
        if (controlAwaitingConfirmation.value?.action !== action) {
          return;
        }
        controlAwaitingConfirmation.value = null;
        controlConfirmationError.value = `${action === "pause" ? "暂停" : action === "resume" ? "恢复" : "停止"}命令已发送，但 16 秒内未收到上位机确认。请确认设备状态后重试。`;
        confirmationTimer = null;
      }, CONTROL_CONFIRMATION_TIMEOUT_MS);
    }
  };
  const publishControl = async (action, publisher, payload) => {
    if (controlSubmitting.value || controlAwaitingConfirmation.value) {
      return;
    }
    controlConfirmationError.value = "";
    controlSubmitting.value = true;
    try {
      const commandResult = await publisher(payload);
      if (commandResult) {
        startAwaitingConfirmation(action, commandResult);
        await refreshAuthoritativeState();
      }
    } catch (error) {
      controlConfirmationError.value = error instanceof Error ? error.message : String(error || "命令发送失败");
    } finally {
      controlSubmitting.value = false;
    }
  };
  const canSimulatePauseConfirmation = computed(() => import.meta.env.DEV
    && isSaltSprayLaboratory.value
    && controlAwaitingConfirmation.value?.action === "pause"
    && Boolean(normalizeText(controlAwaitingConfirmation.value?.pauseNo))
    && !simulationSubmitting.value);
  const simulatePauseConfirmation = async () => {
    if (!canSimulatePauseConfirmation.value) {
      return;
    }
    simulationSubmitting.value = true;
    controlConfirmationError.value = "";
    const pending = controlAwaitingConfirmation.value;
    try {
      const response = await fetch("/api/mq/laboratory/events/experiment-paused", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        credentials: "include",
        body: JSON.stringify({
          event_id: `dev-pause-${Date.now()}`,
          experiment_code: normalizeText(currentTask.value?.experimentCode || runningExperiment.value?.experimentCode),
          lab_code: SALT_SPRAY_LAB_CODE,
          pause_no: normalizeText(pending.pauseNo),
          run_no: normalizeText(pending.runNo),
          task_code: normalizeText(currentTask.value?.taskCode || runningExperiment.value?.taskCode),
        }),
      });
      if (!response.ok) {
        const detail = await response.json().catch(() => ({}));
        throw new Error(normalizeText(detail?.detail) || `HTTP ${response.status}`);
      }
      await refreshAuthoritativeState();
    } catch (error) {
      controlConfirmationError.value = `模拟暂停确认失败：${error instanceof Error ? error.message : String(error || "未知错误")}`;
    } finally {
      simulationSubmitting.value = false;
    }
  };

  const confirmPause = async () => {
    if (!pauseTrayCodes.value.length || !normalizeText(pauseReason.value)) {
      return;
    }
    await runWithAttendance(async () => {
      pauseModalOpen.value = false;
      await publishControl("pause", requestPause, {
        ...commonPayload(),
        pause_reason: normalizeText(pauseReason.value),
      });
    });
  };
  const requestContinue = async () => {
    if (!canResume.value) {
      return;
    }
    const pauseNo = activePauseNo();
    if (!pauseNo) {
      controlConfirmationError.value = "未找到当前暂停记录，暂不能继续实验。";
      return;
    }
    await runWithAttendance(async () => publishControl("resume", requestResume, {
      ...commonPayload(),
      pause_no: pauseNo,
    }));
  };
  const confirmStop = async () => {
    if (!normalizeText(stopReason.value)) {
      return;
    }
    const pauseNo = activePauseNo();
    if (!pauseNo) {
      controlConfirmationError.value = "未找到当前暂停记录，暂不能提前结束实验。";
      return;
    }
    await runWithAttendance(async () => {
      stopModalOpen.value = false;
      await publishControl("stop", requestStop, {
        ...commonPayload(),
        pause_no: pauseNo,
        termination_reason: normalizeText(stopReason.value),
        termination_type: "completion_criteria",
      });
    });
  };

  watch([controlAwaitingConfirmation, experimentRuns], ([pending, runs]) => {
    if (!pending) {
      return;
    }
    const run = (Array.isArray(runs) ? runs : []).find((row) => resolveRunNo(row) === pending.runNo);
    const status = normalizeText(run?.status);
    const confirmed = pending.action === "pause"
      ? status === "实验暂停"
      : pending.action === "resume"
        ? status === "实验进行中" || status === "实验中"
        : COMPLETED_EXPERIMENT_RUN_STATUSES.has(status) || ABNORMAL_TERMINATION_STATUSES.has(status);
    if (!confirmed) {
      return;
    }
    controlAwaitingConfirmation.value = null;
    controlConfirmationError.value = "";
    clearConfirmationTimer();
  }, { deep: true });

  onBeforeUnmount(clearConfirmationTimer);

  return {
    activePause,
    activePauseInspectionTrayCodes,
    activeRun,
    canSimulatePauseConfirmation,
    canResume,
    closePauseModal,
    closeStopModal,
    confirmPause,
    confirmStop,
    controlAwaitingConfirmation,
    controlConfirmationError,
    controlSubmitting,
    isPaused,
    isSaltSprayLaboratory,
    openPauseModal,
    openStopModal,
    pauseModalOpen,
    pauseReason,
    pauseTrayCodes,
    requestContinue,
    simulatePauseConfirmation,
    simulationSubmitting,
    stopModalOpen,
    stopReason,
  };
}

export { useSaltSprayPauseFlow };
