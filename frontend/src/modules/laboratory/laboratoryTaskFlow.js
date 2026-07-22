import { isAxisPartialProgressStatus } from "@/modules/experiment-progress/axisProgress";
import { WITHDRAWAL_ACTIONS } from "@/modules/samples/sampleFlow.constants";
import { normalizeLifecycleStatus } from "@/modules/samples/samplesFlowModel";
import {
  STATUS_COMPLETED,
  STATUS_RETENTION,
  STATUS_RUNNING,
  STATUS_SCHEDULED,
  STATUS_WAITING,
} from "@/modules/tasks/model";
import {
  COMPLETED_EXPERIMENT_STATUSES,
  COMPLETED_TRAY_STATUSES,
  historyEntryAppliesToTray,
  resolveTrayCode,
} from "./scheduleCompletion";
import {
  EXPERIMENT_COMPLETED_STATUS,
  LABORATORY_TASK_FLOW_INDEX,
  LABORATORY_TASK_FLOW_STEPS,
  LAB_COMPARE_STATUS,
  LAB_RESET_STATUS,
  RUNNING_EXPERIMENT_STATUSES,
} from "./laboratoryConstants";
import {
  getRunningTrayRowsForCurrentTask,
  isPreviousExperimentCompletionForCurrentTask,
  resolveLaboratoryStatusRank,
  rowCanEnterCurrentExperimentAfterOtherCompletion,
  rowCanUseCurrentExperimentAfterCompletedTarget,
  rowHasCompletedAxisSubExperimentForOtherExperiment,
  rowHasReturnedStatus,
  trayHasActiveRunForCurrentExperiment,
  trayIsDispatchedToCurrentLaboratory,
} from "./laboratoryTrayEligibility";
import { toTime } from "./laboratoryPresentation";

const normalizeText = (value) => String(value ?? "").trim();
const asArray = (value) => (Array.isArray(value) ? value : []);

const isCompletedAxisStatusLabel = (label) => /已完成\s+\d+\/\d+轴$/.test(normalizeText(label));
const parsePartialAxisStatusLabelCounts = (label) => {
  const match = normalizeText(label).match(/部分完成\s+(\d+)\/(\d+)轴$/);
  return match
    ? { completed: Number(match[1]), total: Number(match[2]) }
    : null;
};
const parsePartialAxisExperimentName = (label) => {
  const match = normalizeText(label).match(/^(.+?)部分完成\s+\d+\/\d+轴$/);
  return normalizeText(match?.[1]);
};
const experimentNameMatches = (experiment, experimentName) =>
  normalizeText(experiment?.experiment_name || experiment?.experimentName || experiment?.name) === normalizeText(experimentName);
const experimentCodeMatches = (experiment, experimentCode) =>
  normalizeText(experiment?.experiment_code || experiment?.experimentCode || experiment?.code) === normalizeText(experimentCode);
const experimentTaskMatches = (experiment, taskCode) => {
  const normalizedTaskCode = normalizeText(taskCode);
  return !normalizedTaskCode || normalizeText(experiment?.task_code || experiment?.taskCode) === normalizedTaskCode;
};
const runTrayStatusIsCompleted = (runTray) =>
  COMPLETED_EXPERIMENT_STATUSES.has(normalizeLifecycleStatus("", normalizeText(runTray?.run_tray_status || runTray?.runTrayStatus || runTray?.status)));
const historyEntryMarksCompletedExperiment = (entry) =>
  !WITHDRAWAL_ACTIONS.has(normalizeText(entry?.action))
  && !normalizeText(entry?.detail).includes(" / 撤回至")
  && COMPLETED_EXPERIMENT_STATUSES.has(normalizeLifecycleStatus("", normalizeText(entry?.status)));
const historyDetailMentionsExperiment = (entry, taskCode, experimentName) => {
  const detail = normalizeText(entry?.detail);
  const normalizedExperimentName = normalizeText(experimentName);
  if (!detail || !normalizedExperimentName) {
    return false;
  }
  const normalizedTaskCode = normalizeText(taskCode);
  return (!normalizedTaskCode || detail.includes(normalizedTaskCode)) && detail.includes(normalizedExperimentName);
};
const historyEntryMarksPartialAxisStatus = (entry, taskCode, axisStatus, axisExperimentName) => {
  const status = normalizeText(entry?.status);
  const detail = normalizeText(entry?.detail);
  const normalizedTaskCode = normalizeText(taskCode);
  const taskMatches = !normalizedTaskCode || detail.includes(normalizedTaskCode);
  return (
    status === axisStatus
    || detail.includes(axisStatus)
    || (
      taskMatches
      && normalizeText(axisExperimentName)
      && detail.includes(axisExperimentName)
      && isAxisPartialProgressStatus(status || detail)
    )
  );
};

const selectedTrayAxisPartialStatusIsSupersededByLaterExperimentCompletion = ({
  axisStatus = "",
  experimentRuns = [],
  experimentRunTrays = [],
  experiments = [],
  samples = [],
  taskCode = "",
  trayCode = "",
} = {}) => {
  const normalizedAxisStatus = normalizeText(axisStatus);
  const normalizedTrayCode = normalizeText(trayCode);
  const normalizedTaskCode = normalizeText(taskCode);
  if (!isAxisPartialProgressStatus(normalizedAxisStatus) || !normalizedTrayCode) {
    return false;
  }
  const axisExperimentName = parsePartialAxisExperimentName(normalizedAxisStatus);
  if (!axisExperimentName) {
    return false;
  }
  const taskExperiments = asArray(experiments).filter((experiment) => experimentTaskMatches(experiment, normalizedTaskCode));
  const axisExperimentCodes = new Set(
    taskExperiments
      .filter((experiment) => experimentNameMatches(experiment, axisExperimentName))
      .map((experiment) => normalizeText(experiment?.experiment_code || experiment?.experimentCode || experiment?.code))
      .filter(Boolean),
  );
  const runByNo = new Map(
    asArray(experimentRuns)
      .filter((run) => !normalizedTaskCode || normalizeText(run?.task_code || run?.taskCode) === normalizedTaskCode)
      .map((run) => [normalizeText(run?.run_no || run?.runNo), run]),
  );
  const partialTimes = [];
  const laterCompletedTimes = [];
  asArray(samples).forEach((sample) => {
    if (normalizedTaskCode && normalizeText(sample?.task_code || sample?.taskCode) !== normalizedTaskCode) {
      return;
    }
    const sampleTrayCodes = asArray(sample?.trays).map(resolveTrayCode).filter(Boolean);
    if (sampleTrayCodes.length > 0 && !sampleTrayCodes.includes(normalizedTrayCode)) {
      return;
    }
    asArray(sample?.history).forEach((entry) => {
      if (!historyEntryAppliesToTray(entry, sampleTrayCodes, normalizedTrayCode)) {
        return;
      }
      const entryTime = toTime(entry?.time || entry?.updated_at || entry?.created_at);
      if (!Number.isFinite(entryTime)) {
        return;
      }
      if (historyEntryMarksPartialAxisStatus(entry, normalizedTaskCode, normalizedAxisStatus, axisExperimentName)) {
        partialTimes.push(entryTime);
        return;
      }
      if (!historyEntryMarksCompletedExperiment(entry)) {
        return;
      }
      const completedDifferentExperiment = taskExperiments.some((experiment) =>
        !experimentNameMatches(experiment, axisExperimentName)
        && historyDetailMentionsExperiment(entry, normalizedTaskCode, normalizeText(experiment?.experiment_name || experiment?.experimentName || experiment?.name)),
      );
      if (completedDifferentExperiment) {
        laterCompletedTimes.push(entryTime);
      }
    });
  });
  asArray(experimentRunTrays).forEach((runTray) => {
    if (
      normalizeText(runTray?.tray_code || runTray?.trayCode) !== normalizedTrayCode
      || (normalizedTaskCode && normalizeText(runTray?.task_code || runTray?.taskCode) !== normalizedTaskCode)
      || !runTrayStatusIsCompleted(runTray)
    ) {
      return;
    }
    const experimentCode = normalizeText(runTray?.experiment_code || runTray?.experimentCode);
    const runNo = normalizeText(runTray?.run_no || runTray?.runNo);
    const run = runByNo.get(runNo);
    const endedTime = toTime(runTray?.ended_at || runTray?.endedAt || run?.ended_at || run?.endedAt);
    if (!Number.isFinite(endedTime)) {
      return;
    }
    if (axisExperimentCodes.has(experimentCode)) {
      partialTimes.push(endedTime);
      return;
    }
    const completedExperiment = taskExperiments.find((experiment) => experimentCodeMatches(experiment, experimentCode));
    if (completedExperiment && !experimentNameMatches(completedExperiment, axisExperimentName)) {
      laterCompletedTimes.push(endedTime);
    }
  });
  const partialTime = partialTimes.reduce((latest, time) => Math.max(latest, time), -Infinity);
  if (!Number.isFinite(partialTime)) {
    return false;
  }
  return laterCompletedTimes.some((time) => time > partialTime);
};

const activateLatestCompletedExperimentStep = (flow) => {
  const steps = asArray(flow?.steps);
  const latestCompleted = steps.reduce((latest, step, index) => {
    const stepLabel = normalizeText(step?.label);
    const isCompletedExperimentStep =
      normalizeText(step?.key).startsWith("experiment-completed-")
      || (
        stepLabel
        && stepLabel.endsWith(EXPERIMENT_COMPLETED_STATUS)
        && !isCompletedAxisStatusLabel(stepLabel)
      );
    if (!isCompletedExperimentStep) {
      return latest;
    }
    const stepTime = toTime(step?.time);
    if (!latest || stepTime > latest.time || (stepTime === latest.time && index > latest.index)) {
      return { index, label: normalizeText(step?.label), time: stepTime };
    }
    return latest;
  }, null);
  if (!latestCompleted?.label) {
    return flow;
  }
  return {
    ...flow,
    canonicalStatus: latestCompleted.label,
    currentStatus: `当前托盘：${normalizeText(flow?.trayCode)} | 当前状态：${latestCompleted.label}`,
    status: latestCompleted.label,
    steps: steps.map((step, index) => ({
      ...step,
      active: index === latestCompleted.index,
      reached: index <= latestCompleted.index ? true : Boolean(step?.reached) && index < latestCompleted.index,
    })),
  };
};

const resolveLaboratoryTaskAxisStatusLabel = (axisProgress = null) => {
  const statusLabel = normalizeText(axisProgress?.statusLabel);
  const totalStatusLabel = normalizeText(axisProgress?.totalStatusLabel);
  return isCompletedAxisStatusLabel(statusLabel) ? totalStatusLabel || statusLabel : statusLabel || totalStatusLabel;
};

const buildLaboratoryTaskFlow = (status = STATUS_WAITING, axisProgress = null) => {
  const currentStatus = LABORATORY_TASK_FLOW_INDEX.has(status) ? status : STATUS_WAITING;
  const activeIndex = LABORATORY_TASK_FLOW_INDEX.get(currentStatus) ?? 0;
  const axisStatusLabel = resolveLaboratoryTaskAxisStatusLabel(axisProgress);
  return {
    axisStatusLabel,
    currentStatus,
    steps: LABORATORY_TASK_FLOW_STEPS.map((step, index) => ({
      ...step,
      active: index === activeIndex,
      reached: index <= activeIndex,
    })),
  };
};

const rowIsTerminalForCurrentTask = (row) =>
  row?.completedForCurrentExperiment === true || rowHasReturnedStatus(row);

const taskHasExperimentProgress = (currentTask) => {
  const axisProgress = currentTask?.axisProgress;
  if (
    Number(axisProgress?.completedCount || 0) > 0
    || Number(axisProgress?.totalCompletedCount || 0) > 0
  ) {
    return true;
  }
  return asArray(currentTask?.allTrayRows).some(rowIsTerminalForCurrentTask);
};

const resolveLaboratoryTaskStatus = (currentTask) => {
  if (!currentTask) {
    return STATUS_WAITING;
  }
  const scopedTrayRows = asArray(currentTask?.allTrayRows).length > 0
    ? asArray(currentTask?.allTrayRows)
    : asArray(currentTask?.trayRows);
  if (scopedTrayRows.length > 0 && scopedTrayRows.every(rowIsTerminalForCurrentTask)) {
    return scopedTrayRows.every(rowHasReturnedStatus) ? STATUS_RETENTION : STATUS_COMPLETED;
  }
  if (getRunningTrayRowsForCurrentTask(currentTask).length > 0) {
    return STATUS_RUNNING;
  }
  if (taskHasExperimentProgress(currentTask)) {
    return STATUS_RUNNING;
  }
  return STATUS_SCHEDULED;
};

const resolveSelectedTrayFlowStatus = (row, currentTask) => {
  const lifecycleStatus = normalizeText(row?.lifecycleStatus);
  const displayStatus = normalizeText(row?.displayStatus);
  const trayStatus = normalizeText(row?.trayStatus);
  const axisPartialStatus = [displayStatus, trayStatus].find((status) => isAxisPartialProgressStatus(status)) || "";
  if (axisPartialStatus && lifecycleStatus === LAB_COMPARE_STATUS) {
    return axisPartialStatus;
  }
  if (RUNNING_EXPERIMENT_STATUSES.has(lifecycleStatus) && !trayHasActiveRunForCurrentExperiment(row, currentTask)) {
    return displayStatus || trayStatus || lifecycleStatus;
  }
  return lifecycleStatus || displayStatus || trayStatus;
};

const trayHasCurrentExperimentFlowContext = (row, currentTask) => {
  if (!row || !currentTask) {
    return false;
  }
  const currentExperimentCode = normalizeText(currentTask?.experimentCode);
  const targetExperimentCode = normalizeText(row?.targetExperimentCode || row?.target_experiment_code);
  const canEnterAfterOtherCompletion = rowCanEnterCurrentExperimentAfterOtherCompletion(row, currentTask);
  const completedAxisSubExperimentForOtherExperiment = rowHasCompletedAxisSubExperimentForOtherExperiment(row, currentTask);
  const dispatchedToCurrentLaboratory = trayIsDispatchedToCurrentLaboratory(row, currentTask);
  const canUseCurrentExperimentAfterCompletedTarget = rowCanUseCurrentExperimentAfterCompletedTarget(row, currentTask);
  if (targetExperimentCode) {
    return !currentExperimentCode
      || targetExperimentCode === currentExperimentCode
      || canEnterAfterOtherCompletion
      || completedAxisSubExperimentForOtherExperiment
      || dispatchedToCurrentLaboratory
      || canUseCurrentExperimentAfterCompletedTarget;
  }
  if (
    canEnterAfterOtherCompletion
    || completedAxisSubExperimentForOtherExperiment
    || dispatchedToCurrentLaboratory
    || canUseCurrentExperimentAfterCompletedTarget
  ) {
    return true;
  }
  if (row?.completedForCurrentExperiment === true || trayHasActiveRunForCurrentExperiment(row, currentTask)) {
    return true;
  }
  const trayStatus = normalizeText(row?.trayStatus) || normalizeText(row?.displayStatus);
  const trayStatusRank = resolveLaboratoryStatusRank(trayStatus);
  if (trayStatusRank > 0 && trayStatusRank < 5 && !isPreviousExperimentCompletionForCurrentTask(row, currentTask)) {
    return true;
  }
  const lifecycleStatus = normalizeLifecycleStatus(
    normalizeText(row?.lifecycleLocation) || normalizeText(row?.currentLocation),
    normalizeText(row?.lifecycleStatus),
  );
  if (
    COMPLETED_TRAY_STATUSES.has(lifecycleStatus)
    && row?.completedForOtherExperiment === true
    && row?.completedForCurrentExperiment !== true
  ) {
    return false;
  }
  if (
    row?.completedForOtherExperiment === true
    && row?.completedForCurrentExperiment !== true
    && row?.hasCurrentExperimentHistory !== true
  ) {
    return false;
  }
  const targetLab = normalizeText(row?.targetLab || row?.target_lab);
  const currentLab = normalizeText(currentTask?.device);
  if (trayStatus === LAB_RESET_STATUS && targetLab && currentLab && targetLab === currentLab) {
    return true;
  }
  return trayStatusRank > 0 && trayStatusRank < 5 && !isPreviousExperimentCompletionForCurrentTask(row, currentTask);
};

const trayHasCurrentExperimentDisplayDispatch = (row, currentTask) => {
  if (!row || !currentTask) {
    return false;
  }
  const currentExperimentCode = normalizeText(currentTask?.experimentCode);
  const currentLab = normalizeText(currentTask?.device);
  const targetExperimentCode = normalizeText(row?.targetExperimentCode || row?.target_experiment_code);
  const targetLab = normalizeText(row?.targetLab || row?.target_lab);
  if (targetExperimentCode && currentExperimentCode && targetExperimentCode === currentExperimentCode) {
    return !targetLab || !currentLab || targetLab === currentLab;
  }
  if (targetLab && currentLab && targetLab === currentLab && (!targetExperimentCode || targetExperimentCode === currentExperimentCode)) {
    return true;
  }
  if (row?.hasCurrentExperimentHistory === true || normalizeText(row?.currentExperimentHistoryStatus)) {
    return true;
  }
  if (trayHasActiveRunForCurrentExperiment(row, currentTask)) {
    return true;
  }
  const currentLocation = normalizeText(row?.lifecycleLocation) || normalizeText(row?.currentLocation);
  const flowStatus = resolveSelectedTrayFlowStatus(row, currentTask);
  return Boolean(
    currentLab
    && currentLocation === currentLab
    && resolveLaboratoryStatusRank(flowStatus) > 0
    && !isPreviousExperimentCompletionForCurrentTask(row, currentTask)
  );
};

export {
  activateLatestCompletedExperimentStep,
  buildLaboratoryTaskFlow,
  parsePartialAxisExperimentName,
  parsePartialAxisStatusLabelCounts,
  resolveLaboratoryTaskAxisStatusLabel,
  resolveLaboratoryTaskStatus,
  resolveSelectedTrayFlowStatus,
  selectedTrayAxisPartialStatusIsSupersededByLaterExperimentCompletion,
  trayHasCurrentExperimentDisplayDispatch,
  trayHasCurrentExperimentFlowContext,
};
