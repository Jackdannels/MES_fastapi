import { formatLocalDateTime } from "@/lib/dateTime";
import { SAMPLES_UPDATED_EVENT } from "@/modules/samples/sampleEvents";
import {
  COMPLETED_EXPERIMENT_RUN_STATUSES,
  normalizeText,
  resolveSubExperimentCode,
} from "./pageHelpers";

function useLaboratoryCompletionFlow({
  axisContinuation,
  clearRunningModalRestoreTimer,
  completePromptVisible,
  completedRunningExperiment,
  currentTask,
  experimentRunSteps,
  experimentRunTrays,
  experimentRuns,
  experiments,
  flushPendingRealtimeRefresh,
  load,
  openAttendanceLogoutPrompt,
  persistRunningExperimentCompletion,
  runWithAttendance,
  runningExperiment,
  runningModalVisible,
  samples,
  scheduleCompletedRunningModalAutoClose,
  schedules,
}) {
  const completingRunningExperimentKeys = new Set();

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
    const effectiveAxisCode = normalizeText(axisCode);
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
        (experiment) => normalizeText(experiment?.task_code) === taskCode
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
      const hasCompletionSnapshot = Array.isArray(completionResult?.samples)
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
    await completeRunningExperiment();
  };

  const confirmCompleteCurrentAxis = async () => {
    await runWithAttendance(async () => {
      const continuation = axisContinuation.value;
      if (!continuation.currentAxisCode || (continuation.nextAxisCode && !continuation.canContinue)) {
        return;
      }
      await completeRunningExperiment({
        axisCode: continuation.currentAxisCode,
        keepModal: Boolean(continuation.nextAxisCode),
        nextAxisCode: continuation.nextAxisCode,
      });
    });
  };

  return {
    closeCompleteConfirm,
    confirmCompleteCurrentAxis,
    confirmCompleteExperiment,
    openCompleteConfirm,
  };
}

export { useLaboratoryCompletionFlow };
