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
  completionAwaitingConfirmation = { value: null },
  completionConfirmationError = { value: "" },
  completionSubmitting,
  currentTask,
  flushPendingRealtimeRefresh,
  laboratoryConfig,
  requestMqttExperimentEnd = async () => false,
  runWithAttendance,
  runningExperiment,
}) {
  const completingRunningExperimentKeys = new Set();

  const completeRunningExperiment = async ({ axisCode = "", nextAxisCode = "" } = {}) => {
    if (!runningExperiment.value?.active || completionAwaitingConfirmation.value) {
      return;
    }
    const effectiveAxisCode = normalizeText(axisCode);
    const taskCode = normalizeText(currentTask.value?.taskCode);
    const experimentCode = normalizeText(currentTask.value?.experimentCode);
    const completionKey = `${taskCode}::${experimentCode}`;
    if (!taskCode || !experimentCode || completingRunningExperimentKeys.has(completionKey)) {
      return;
    }
    completingRunningExperimentKeys.add(completionKey);
    completionConfirmationError.value = "";
    completionSubmitting.value = true;
    const runningRunNo = normalizeText(runningExperiment.value?.runNo);
    const subExperimentCode = resolveSubExperimentCode(runningExperiment.value) || resolveSubExperimentCode(currentTask.value);
    try {
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
