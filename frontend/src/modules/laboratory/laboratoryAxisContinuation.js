import {
  normalizeText,
  scheduleAxisCodes,
  stepAxisCode,
  stepRunNo,
  stepStatus,
} from "./pageHelpers";

function buildLaboratoryAxisContinuation({
  currentTask,
  experimentRuns,
  experimentRunSteps,
  runningExperiment,
  schedules,
}) {
  const activeRunNo = normalizeText(runningExperiment?.runNo);
  const taskCode = normalizeText(currentTask?.taskCode);
  const experimentCode = normalizeText(currentTask?.experimentCode);
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
  const currentRun = experimentRuns.find((run) => {
    const runNo = normalizeText(run?.run_no || run?.runNo || run?.id);
    return runNo === activeRunNo;
  });
  const currentRunScheduleId = normalizeText(currentRun?.schedule_id || currentRun?.scheduleId);
  const currentRunSchedule = schedules.find(
    (schedule) => normalizeText(schedule?.id || schedule?.schedule_id || schedule?.scheduleId) === currentRunScheduleId,
  );
  const steps = experimentRunSteps
    .filter((step) => stepRunNo(step) === activeRunNo)
    .sort((left, right) => Number(left?.step_no ?? left?.stepNo ?? 0) - Number(right?.step_no ?? right?.stepNo ?? 0));
  const runningStepIndex = steps.findIndex((step) => stepStatus(step) === "实验进行中");
  const currentIndex = runningStepIndex >= 0
    ? runningStepIndex
    : steps.findIndex((step) => stepStatus(step) !== "实验已完成");
  const currentStep = currentIndex >= 0 ? steps[currentIndex] : null;
  const nextStep = currentIndex >= 0
    ? steps.slice(currentIndex + 1).find((step) => stepStatus(step) !== "实验已完成")
    : null;
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
  const baseState = {
    completedAxisCodes,
    currentAxisCode,
    hasAxisSteps,
    nextAxisCode,
    statusLabel,
    unfinishedAxisCodes,
  };
  if (!currentAxisCode || !nextAxisCode) {
    return { ...baseState, canContinue: false };
  }
  const currentTaskAxisCodes = scheduleAxisCodes(currentTask);
  const currentRunAxisCodes = scheduleAxisCodes(currentRun);
  const currentRunScheduleAxisCodes = scheduleAxisCodes(currentRunSchedule);
  if (
    currentTaskAxisCodes.length > 1
    && normalizeText(currentTask?.id) === currentRunScheduleId
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
  const currentSchedule = schedules.find(
    (schedule) => normalizeText(schedule?.task_code) === taskCode
      && normalizeText(schedule?.experiment_code) === experimentCode
      && scheduleAxisCodes(schedule).includes(currentAxisCode),
  );
  const nextSchedule = schedules.find(
    (schedule) => normalizeText(schedule?.task_code) === taskCode
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
}

export { buildLaboratoryAxisContinuation };
