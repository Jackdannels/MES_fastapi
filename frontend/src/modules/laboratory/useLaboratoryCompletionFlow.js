import { formatLocalDateTime } from "@/lib/dateTime";
import { SAMPLES_UPDATED_EVENT } from "@/modules/samples/sampleEvents";
import {
  COMPLETED_EXPERIMENT_RUN_STATUSES,
  normalizeText,
  resolveSubExperimentCode,
} from "./pageHelpers";

const completionRowRunNo = (row) => normalizeText(row?.run_no || row?.runNo || row?.id);
const completionRowTaskCode = (row) => normalizeText(row?.task_code || row?.taskCode || row?.task_no || row?.taskNo);
const completionRowExperimentCode = (row) => normalizeText(
  row?.experiment_code || row?.experimentCode || row?.experiment_no || row?.experimentNo,
);

const completionRowMatchesRequest = (row, pending) => {
  const pendingRunNo = normalizeText(pending?.runNo);
  if (pendingRunNo) {
    return completionRowRunNo(row) === pendingRunNo;
  }
  return completionRowTaskCode(row) === normalizeText(pending?.taskCode)
    && completionRowExperimentCode(row) === normalizeText(pending?.experimentCode);
};

const completionConfirmationMatches = (pending, experimentRuns, experimentRunSteps) => {
  if (!pending) {
    return false;
  }
  const axisCode = normalizeText(pending.axisCode);
  if (axisCode && (Array.isArray(experimentRunSteps) ? experimentRunSteps : []).some(
    (step) => completionRowMatchesRequest(step, pending)
      && normalizeText(step?.axis_code || step?.axisCode) === axisCode
      && COMPLETED_EXPERIMENT_RUN_STATUSES.has(normalizeText(step?.status)),
  )) {
    return true;
  }
  return (Array.isArray(experimentRuns) ? experimentRuns : []).some(
    (run) => completionRowMatchesRequest(run, pending)
      && COMPLETED_EXPERIMENT_RUN_STATUSES.has(normalizeText(run?.status)),
  );
};

function useLaboratoryCompletionFlow({
  axisContinuation,
  clearRunningModalRestoreTimer,
  completionAwaitingConfirmation = { value: null },
  completionConfirmationError = { value: "" },
  completionSubmitting,
  completedRunningExperiment,
  currentTask,
  experimentRunSteps,
  experimentRunTrays,
  experimentRuns,
  experiments,
  flushPendingRealtimeRefresh,
  laboratoryConfig,
  load,
  persistRunningExperimentCompletion,
  requestMqttExperimentEnd = async () => false,
  runWithAttendance,
  runningExperiment,
  runningModalVisible,
  samples,
  schedules,
  usesMqttCompletion = () => false,
}) {
  const completingRunningExperimentKeys = new Set();

  const completeRunningExperiment = async ({ axisCode = "", keepModal = false, nextAxisCode = "" } = {}) => {
    if (!runningExperiment.value?.active || completionAwaitingConfirmation.value) {
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
    completionConfirmationError.value = "";
    completionSubmitting.value = true;
    const completedAt = formatLocalDateTime();
    const runningRunNo = normalizeText(runningExperiment.value?.runNo);
    const runningTrayCodes = (runningExperiment.value?.trayCodes || []).map(normalizeText).filter(Boolean);
    const subExperimentCode = resolveSubExperimentCode(runningExperiment.value) || resolveSubExperimentCode(currentTask.value);
    try {
      if (usesMqttCompletion()) {
        const published = await requestMqttExperimentEnd({
          axis_code: effectiveAxisCode,
          experiment_code: experimentCode,
          lab_code: normalizeText(laboratoryConfig?.value?.labCode || laboratoryConfig?.value?.labId),
          next_axis_code: normalizeText(nextAxisCode),
          run_no: runningRunNo,
          sub_experiment_code: subExperimentCode,
          task_code: taskCode,
        });
        if (published) {
          completionAwaitingConfirmation.value = {
            axisCode: effectiveAxisCode,
            experimentCode,
            nextAxisCode: normalizeText(nextAxisCode),
            requestedAt: Date.now(),
            runNo: runningRunNo,
            taskCode,
          };
          flushPendingRealtimeRefresh();
        }
        return;
      }
      const completionResult = await persistRunningExperimentCompletion({
        axisCode: effectiveAxisCode,
        completedAt,
        experimentCode,
        nextAxisCode,
        runNo: runningRunNo,
        subExperimentCode,
        taskCode,
        trayCodes: runningTrayCodes,
      });
      const experimentCompleted = (Array.isArray(completionResult?.experiments) ? completionResult.experiments : []).some(
        (experiment) => normalizeText(experiment?.task_code) === taskCode
          && normalizeText(experiment?.experiment_code) === experimentCode
          && COMPLETED_EXPERIMENT_RUN_STATUSES.has(normalizeText(experiment?.status)),
      );
      const continuingNextAxisInSchedule = keepModal && Boolean(normalizeText(nextAxisCode));
      completedRunningExperiment.value = !continuingNextAxisInSchedule && (!effectiveAxisCode || experimentCompleted)
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
      runningModalVisible.value = Boolean(completedRunningExperiment.value?.active)
        || keepModal
        || Boolean(effectiveAxisCode && !experimentCompleted);
      clearRunningModalRestoreTimer();
      flushPendingRealtimeRefresh();
    } finally {
      completingRunningExperimentKeys.delete(completionKey);
      completionSubmitting.value = false;
    }
  };

  const completeExperimentNow = async () => {
    if (!runningExperiment.value?.active || completionAwaitingConfirmation.value) {
      return;
    }
    await runWithAttendance(async () => {
      await completeRunningExperiment();
    });
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
    completeExperimentNow,
    confirmCompleteCurrentAxis,
  };
}

export { completionConfirmationMatches, useLaboratoryCompletionFlow };
