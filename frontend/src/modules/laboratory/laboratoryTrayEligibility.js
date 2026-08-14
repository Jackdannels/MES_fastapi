import { resolveLabRef, scheduleMatchesLab } from "@/lib/labIdentity";
import { isAxisPartialProgressStatus } from "@/modules/experiment-progress/axisProgress";
import { COMPLETED_EXPERIMENT_STATUSES } from "./scheduleCompletion";
import {
  APPEARANCE_STORAGE_STATUSES,
  EXPERIMENT_COMPLETED_STATUS,
  LAB_COMPARE_STATUS,
  LAB_INSTALL_STATUS,
  LAB_READY_STATUS,
  LAB_RESET_STATUS,
  PRE_DISPATCH_STATUSES,
  RUNNING_EXPERIMENT_STATUSES,
  UNIFIED_TRAY_FLOW_STATUS_RANK,
} from "./laboratoryConstants";

const normalizeText = (value) => String(value ?? "").trim();
const asArray = (value) => (Array.isArray(value) ? value : []);

const experimentHistoryStatusIsWithdrawal = (status) => normalizeText(status).startsWith("撤回至");

const resolveLaboratoryStatusRank = (value) => {
  const normalized = normalizeText(value);
  if (normalized === LAB_COMPARE_STATUS) {
    return 1;
  }
  if (normalized === LAB_INSTALL_STATUS) {
    return 2;
  }
  if (normalized === LAB_READY_STATUS) {
    return 3;
  }
  if (RUNNING_EXPERIMENT_STATUSES.has(normalized)) {
    return 4;
  }
  if (normalized === "实验已完成" || normalized === "实验后暂存间存放" || normalized === "厂家收回") {
    return 5;
  }
  return 0;
};

const resolveUnifiedTrayFlowRank = (status) => {
  const normalized = normalizeText(status);
  if (!normalized) {
    return -1;
  }
  const completedIndex = UNIFIED_TRAY_FLOW_STATUS_RANK.get(EXPERIMENT_COMPLETED_STATUS) ?? 9;
  if (normalized === "送至外观检测间") {
    return completedIndex + 0.1;
  }
  if (APPEARANCE_STORAGE_STATUSES.has(normalized)) {
    return completedIndex + 0.2;
  }
  return UNIFIED_TRAY_FLOW_STATUS_RANK.get(normalized) ?? -1;
};

const laboratoryOperationKey = (task) =>
  normalizeText(task?.experimentKey)
  || (normalizeText(task?.taskCode) && normalizeText(task?.experimentCode)
    ? `${normalizeText(task?.taskCode)}::${normalizeText(task?.experimentCode)}`
    : normalizeText(task?.id));

const trayHasExplicitLaboratoryWorkflowScope = (row) =>
  Boolean(
    normalizeText(row?.targetExperimentCode || row?.target_experiment_code)
    || normalizeText(row?.targetLab || row?.target_lab)
    || asArray(row?.experimentCodes).length === 1,
  );

const trayLaboratoryLocation = (row) => normalizeText(
  row?.currentLocation
  || row?.lifecycleLocation
  || row?.location,
);

const rowCompletedExperimentCodeSet = (row) =>
  new Set(asArray(row?.completedExperimentCodes).map((code) => normalizeText(code)).filter(Boolean));

const rowPartialAxisCompletionStatusLabels = (row) =>
  [
    row?.trayStatus,
    row?.displayStatus,
    row?.lifecycleStatus,
  ].map(normalizeText).filter((status) => isAxisPartialProgressStatus(status));

const rowHasPartialAxisCompletionStatus = (row) =>
  rowPartialAxisCompletionStatusLabels(row).length > 0;

const rowPartialAxisStatusMatchesCurrentExperiment = (row, currentTask) => {
  const currentExperimentName = normalizeText(currentTask?.experimentName);
  return Boolean(
    currentExperimentName
    && rowPartialAxisCompletionStatusLabels(row).some((status) => status.includes(currentExperimentName)),
  );
};

const rowHasCompletedAxisSubExperimentForOtherExperiment = (row, currentTask) => {
  const targetExperimentCode = normalizeText(row?.targetExperimentCode || row?.target_experiment_code);
  const currentExperimentCode = normalizeText(currentTask?.experimentCode);
  const experimentCodes = asArray(row?.experimentCodes).map((code) => normalizeText(code)).filter(Boolean);
  const hasCurrentExperiment = Boolean(currentExperimentCode && experimentCodes.includes(currentExperimentCode));
  if (
    !hasCurrentExperiment
    || rowCompletedExperimentCodeSet(row).has(currentExperimentCode)
    || !rowHasPartialAxisCompletionStatus(row)
    || row?.completedForCurrentExperiment === true
  ) {
    return false;
  }
  if (rowPartialAxisStatusMatchesCurrentExperiment(row, currentTask)) {
    return false;
  }
  if (targetExperimentCode) {
    return targetExperimentCode !== currentExperimentCode && experimentCodes.includes(targetExperimentCode);
  }
  return experimentCodes.some((experimentCode) => experimentCode !== currentExperimentCode)
    && !rowPartialAxisStatusMatchesCurrentExperiment(row, currentTask);
};

const rowHasUnfinishedDifferentTargetExperiment = (row, currentTask) => {
  const targetExperimentCode = normalizeText(row?.targetExperimentCode || row?.target_experiment_code);
  const currentExperimentCode = normalizeText(currentTask?.experimentCode);
  return Boolean(
    targetExperimentCode
    && currentExperimentCode
    && targetExperimentCode !== currentExperimentCode
    && !rowCompletedExperimentCodeSet(row).has(targetExperimentCode),
  );
};

const rowHasPreDispatchLifecycleStatus = (row) => {
  const lifecycleStatus = normalizeText(row?.lifecycleStatus);
  const displayStatus = normalizeText(row?.displayStatus);
  const trayStatus = normalizeText(row?.trayStatus);
  return PRE_DISPATCH_STATUSES.has(lifecycleStatus)
    || PRE_DISPATCH_STATUSES.has(displayStatus)
    || PRE_DISPATCH_STATUSES.has(trayStatus)
    || APPEARANCE_STORAGE_STATUSES.has(lifecycleStatus)
    || APPEARANCE_STORAGE_STATUSES.has(displayStatus)
    || APPEARANCE_STORAGE_STATUSES.has(trayStatus)
    || lifecycleStatus === "送至外观检测间"
    || displayStatus === "送至外观检测间"
    || trayStatus === "送至外观检测间";
};

const currentExperimentIsNextUnfinishedForTray = (row, currentTask) => {
  const currentExperimentCode = normalizeText(currentTask?.experimentCode);
  const experimentCodes = asArray(row?.experimentCodes).map((code) => normalizeText(code)).filter(Boolean);
  const currentIndex = experimentCodes.indexOf(currentExperimentCode);
  if (!currentExperimentCode || currentIndex < 0) {
    return false;
  }
  const completedCodes = rowCompletedExperimentCodeSet(row);
  if (completedCodes.has(currentExperimentCode)) {
    return false;
  }
  return experimentCodes.slice(0, currentIndex).every((experimentCode) => completedCodes.has(experimentCode));
};

const rowHasCurrentUnfinishedExperiment = (row, currentTask) => {
  const currentExperimentCode = normalizeText(currentTask?.experimentCode);
  const experimentCodes = asArray(row?.experimentCodes).map((code) => normalizeText(code)).filter(Boolean);
  return Boolean(
    currentExperimentCode
    && experimentCodes.includes(currentExperimentCode)
    && !rowCompletedExperimentCodeSet(row).has(currentExperimentCode)
    && row?.completedForCurrentExperiment !== true,
  );
};

const rowCanEnterCurrentExperimentAfterOtherCompletion = (row, currentTask) => {
  const targetExperimentCode = normalizeText(row?.targetExperimentCode || row?.target_experiment_code);
  const currentExperimentCode = normalizeText(currentTask?.experimentCode);
  const targetLab = normalizeText(row?.targetLab || row?.target_lab);
  const currentLab = normalizeText(currentTask?.device);
  const completedCodes = rowCompletedExperimentCodeSet(row);
  if (row?.completedForOtherExperiment !== true || !rowHasCurrentUnfinishedExperiment(row, currentTask)) {
    return false;
  }
  if (targetLab && currentLab && targetLab !== currentLab && !targetExperimentCode) {
    return false;
  }
  if (
    targetExperimentCode
    && currentExperimentCode
    && targetExperimentCode === currentExperimentCode
    && targetLab
    && currentLab
    && targetLab !== currentLab
  ) {
    return false;
  }
  if (
    targetExperimentCode
    && currentExperimentCode
    && targetExperimentCode !== currentExperimentCode
    && !completedCodes.has(targetExperimentCode)
    && !rowHasCompletedAxisSubExperimentForOtherExperiment(row, currentTask)
  ) {
    return false;
  }
  return true;
};

const rowCanUseCurrentExperimentAfterCompletedTarget = (row, currentTask) => {
  const currentExperimentCode = normalizeText(currentTask?.experimentCode);
  const targetExperimentCode = normalizeText(row?.targetExperimentCode || row?.target_experiment_code);
  const experimentCodes = asArray(row?.experimentCodes).map((code) => normalizeText(code)).filter(Boolean);
  const completedCodes = rowCompletedExperimentCodeSet(row);
  const currentExperimentIsUnfinished = Boolean(
    currentExperimentCode
    && experimentCodes.includes(currentExperimentCode)
    && !completedCodes.has(currentExperimentCode)
    && row?.completedForCurrentExperiment !== true,
  );
  const targetAllowsCurrentExperiment =
    !targetExperimentCode
    || targetExperimentCode === currentExperimentCode
    || completedCodes.has(targetExperimentCode);
  return Boolean(
    row
    && currentTask
    && row?.completedForOtherExperiment === true
    && currentExperimentIsUnfinished
    && targetAllowsCurrentExperiment
    && !rowHasPreDispatchLifecycleStatus(row)
  );
};

const taskHasDispatchValidationScope = (task) =>
  Boolean(normalizeText(task?.experimentCode) || normalizeText(task?.device));

const trayIsDispatchedToCurrentLaboratory = (row, currentTask) => {
  const trayStatus = normalizeText(row?.trayStatus) || normalizeText(row?.displayStatus);
  const targetExperimentCode = normalizeText(row?.targetExperimentCode || row?.target_experiment_code);
  const currentExperimentCode = normalizeText(currentTask?.experimentCode);
  const experimentCodes = asArray(row?.experimentCodes).map((code) => normalizeText(code)).filter(Boolean);
  const currentExperimentIndex = experimentCodes.indexOf(currentExperimentCode);
  const targetLab = normalizeText(row?.targetLab || row?.target_lab);
  const currentLab = normalizeText(currentTask?.device);
  const targetLabMatchesCurrent = Boolean(targetLab && currentLab && targetLab === currentLab);
  const hasCurrentExperimentRelation = Boolean(
    currentExperimentCode && experimentCodes.includes(currentExperimentCode),
  );
  const targetExperimentMatchesCurrent = Boolean(
    targetExperimentCode
    && currentExperimentCode
    && targetExperimentCode === currentExperimentCode,
  );
  const currentIsNextUnfinished = currentExperimentIsNextUnfinishedForTray(row, currentTask);
  const completedAxisSubExperimentForOtherExperiment = rowHasCompletedAxisSubExperimentForOtherExperiment(row, currentTask);
  const canEnterAfterOtherCompletion = rowCanEnterCurrentExperimentAfterOtherCompletion(row, currentTask);
  if (
    targetExperimentCode
    && currentExperimentCode
    && targetExperimentCode !== currentExperimentCode
    && row?.completedForOtherExperiment === true
    && row?.completedForCurrentExperiment !== true
    && currentIsNextUnfinished
    && rowCompletedExperimentCodeSet(row).has(targetExperimentCode)
  ) {
    return true;
  }
  if (completedAxisSubExperimentForOtherExperiment) {
    return true;
  }
  if (canEnterAfterOtherCompletion) {
    return true;
  }
  if (targetExperimentCode && currentExperimentCode && targetExperimentCode !== currentExperimentCode) {
    return false;
  }
  if (trayStatus !== LAB_RESET_STATUS) {
    return true;
  }
  if (targetExperimentMatchesCurrent) {
    return targetLab ? targetLabMatchesCurrent : Boolean(currentLab);
  }
  if (!targetExperimentCode && hasCurrentExperimentRelation) {
    if (targetLabMatchesCurrent) {
      return true;
    }
    if (targetLab) {
      return row?.completedForOtherExperiment === true && currentIsNextUnfinished;
    }
    return experimentCodes.length <= 1 || currentExperimentIndex === 0 || currentIsNextUnfinished || canEnterAfterOtherCompletion;
  }
  if (
    !targetExperimentCode
    && row?.completedForOtherExperiment === true
    && row?.completedForCurrentExperiment !== true
    && currentExperimentCode
    && currentIsNextUnfinished
  ) {
    return targetLabMatchesCurrent;
  }
  return false;
};

const trayHasInLaboratoryOccupancyStatus = (row) =>
  [
    row?.trayStatus,
    row?.displayStatus,
    row?.lifecycleStatus,
    row?.currentExperimentHistoryStatus,
    row?.latestExperimentHistoryStatus,
  ].some((status) => {
    const rank = resolveLaboratoryStatusRank(status);
    return rank >= 1 && rank < 5;
  });

const trayHasInLaboratoryOccupancyHistory = (row) =>
  [
    row?.currentExperimentHistoryStatus,
    row?.latestExperimentHistoryStatus,
  ].some((status) => {
    const rank = resolveLaboratoryStatusRank(status);
    return rank >= 1 && rank < 5;
  });

const trayIsOccupiedByDifferentLaboratory = (row, currentTask) => {
  if (!row || !currentTask || !trayHasInLaboratoryOccupancyStatus(row)) {
    return false;
  }
  const currentLab = normalizeText(currentTask?.device);
  const currentExperimentCode = normalizeText(currentTask?.experimentCode);
  const targetLab = normalizeText(row?.targetLab || row?.target_lab);
  const targetExperimentCode = normalizeText(row?.targetExperimentCode || row?.target_experiment_code);
  const currentLocation = trayLaboratoryLocation(row);
  const targetExperimentAlreadyCompleted = Boolean(
    targetExperimentCode
    && targetExperimentCode !== currentExperimentCode
    && rowCompletedExperimentCodeSet(row).has(targetExperimentCode),
  );
  if (targetExperimentAlreadyCompleted && !trayHasInLaboratoryOccupancyHistory(row)) {
    return false;
  }
  return Boolean(
    (targetLab && currentLab && targetLab !== currentLab)
    || (targetExperimentCode && currentExperimentCode && targetExperimentCode !== currentExperimentCode && targetLab && currentLab && targetLab !== currentLab)
    || (currentLocation && currentLab && currentLocation !== currentLab && (targetLab || targetExperimentCode)),
  );
};

const trayLocationMatchesCurrentLaboratory = (row, currentTask) => {
  const currentLab = normalizeText(currentTask?.device);
  const currentLocation = trayLaboratoryLocation(row);
  return !currentLab || !currentLocation || currentLocation === currentLab;
};

const trayCanUseImplicitLaboratoryWorkflowScope = (row, currentTask) =>
  trayHasExplicitLaboratoryWorkflowScope(row)
  || rowCanEnterCurrentExperimentAfterOtherCompletion(row, currentTask)
  || rowHasCompletedAxisSubExperimentForOtherExperiment(row, currentTask)
  || !trayLaboratoryLocation(row)
  || trayLocationMatchesCurrentLaboratory(row, currentTask);

const trayBelongsToCurrentLaboratoryWorkflow = (row, currentTask) =>
  !taskHasDispatchValidationScope(currentTask)
  || (
    trayIsDispatchedToCurrentLaboratory(row, currentTask)
    && trayCanUseImplicitLaboratoryWorkflowScope(row, currentTask)
  );

const taskHasWrongLaboratoryDispatch = (task) =>
  taskHasDispatchValidationScope(task)
  && asArray(task?.trayRows).some((row) => !trayIsDispatchedToCurrentLaboratory(row, task));

const taskHasCurrentLaboratoryDispatch = (task) =>
  asArray(task?.trayRows).some((row) => trayBelongsToCurrentLaboratoryWorkflow(row, task));

const trayLifecycleIsBeforeLaboratoryDispatch = (row) => {
  if (rowHasPreDispatchLifecycleStatus(row)) {
    return true;
  }
  const lifecycleStatus = normalizeText(row?.lifecycleStatus);
  if (!lifecycleStatus) {
    return false;
  }
  const rank = resolveUnifiedTrayFlowRank(lifecycleStatus);
  const sentToLabRank = resolveUnifiedTrayFlowRank(LAB_RESET_STATUS);
  return rank >= 0 && rank < sentToLabRank;
};

const isPreviousExperimentCompletionForCurrentTask = (row, currentTask) => {
  const trayStatus = normalizeText(row?.trayStatus) || normalizeText(row?.displayStatus);
  const currentExperimentStatus = normalizeText(currentTask?.status);
  const hasScopedOtherExperimentCompletion = row?.completedForOtherExperiment === true;
  return (
    COMPLETED_EXPERIMENT_STATUSES.has(trayStatus)
    && row?.completedForCurrentExperiment !== true
    && !COMPLETED_EXPERIMENT_STATUSES.has(currentExperimentStatus)
    && normalizeText(currentTask?.experimentCode)
    && asArray(row?.experimentCodes).length > 1
    && hasScopedOtherExperimentCompletion
  );
};

const trayIsCompletedForCurrentExperiment = (row, currentTask) => {
  const trayStatus = normalizeText(row?.trayStatus) || normalizeText(row?.displayStatus);
  return COMPLETED_EXPERIMENT_STATUSES.has(trayStatus) && !isPreviousExperimentCompletionForCurrentTask(row, currentTask);
};

const trayCanEnterCurrentExperimentAfterOtherCompletion = (row, currentTask) => {
  const targetExperimentCode = normalizeText(row?.targetExperimentCode || row?.target_experiment_code);
  const currentExperimentCode = normalizeText(currentTask?.experimentCode);
  const targetLab = normalizeText(row?.targetLab || row?.target_lab);
  const currentLab = normalizeText(currentTask?.device);
  const completedAxisSubExperimentForOtherExperiment = rowHasCompletedAxisSubExperimentForOtherExperiment(row, currentTask);
  const canEnterAfterOtherCompletion = rowCanEnterCurrentExperimentAfterOtherCompletion(row, currentTask);
  if (
    targetExperimentCode
    && currentExperimentCode
    && targetExperimentCode !== currentExperimentCode
    && !rowCompletedExperimentCodeSet(row).has(targetExperimentCode)
    && !completedAxisSubExperimentForOtherExperiment
  ) {
    return false;
  }
  if (targetLab && currentLab && targetLab !== currentLab && !targetExperimentCode) {
    return false;
  }
  if (completedAxisSubExperimentForOtherExperiment) {
    return true;
  }
  return canEnterAfterOtherCompletion;
};

const trayHasActiveRunForCurrentExperiment = (row, currentTask) => {
  if (!normalizeText(currentTask?.runNo)) {
    return false;
  }
  const activeRunTrayCodes = asArray(currentTask?.activeRunTrayCodes).map((trayCode) => normalizeText(trayCode)).filter(Boolean);
  if (!activeRunTrayCodes.length) {
    return true;
  }
  return activeRunTrayCodes.includes(normalizeText(row?.trayCode));
};

const rowHasRunningStatus = (row) =>
  RUNNING_EXPERIMENT_STATUSES.has(normalizeText(row?.trayStatus) || normalizeText(row?.displayStatus));

const rowHasReturnedStatus = (row) =>
  normalizeText(row?.trayStatus) === "厂家收回"
  || normalizeText(row?.displayStatus) === "厂家收回"
  || normalizeText(row?.lifecycleStatus) === "厂家收回";

const getRunningTrayRowsForCurrentTask = (currentTask) => {
  const runningTrayRows = asArray(currentTask?.trayRows).filter((row) => rowHasRunningStatus(row));
  if (!normalizeText(currentTask?.runNo)) {
    return [];
  }
  return runningTrayRows.filter((row) => trayHasActiveRunForCurrentExperiment(row, currentTask));
};

const resolveCurrentWorkflowTrayRank = (row, currentTask) => {
  if (isPreviousExperimentCompletionForCurrentTask(row, currentTask)) {
    return 0;
  }
  if (rowHasRunningStatus(row) && normalizeText(currentTask?.runNo) && !trayHasActiveRunForCurrentExperiment(row, currentTask)) {
    return 0;
  }
  return resolveLaboratoryStatusRank(row?.trayStatus);
};

const resolveTrayExperimentOperationState = (row, currentTask) => {
  const hasAuthoritativeActiveRun = rowHasRunningStatus(row) && trayHasActiveRunForCurrentExperiment(row, currentTask);
  if (hasAuthoritativeActiveRun) {
    return {
      active: true,
      belongsToCurrentWorkflow: true,
      rank: resolveLaboratoryStatusRank(row?.trayStatus),
      withdrawn: false,
    };
  }

  const withdrawn = experimentHistoryStatusIsWithdrawal(
    row?.currentExperimentHistoryStatus || row?.latestExperimentHistoryStatus,
  );
  const restoredToCurrentDispatch =
    normalizeText(row?.trayStatus || row?.displayStatus) === LAB_RESET_STATUS
    && normalizeText(row?.targetExperimentCode || row?.target_experiment_code) === normalizeText(currentTask?.experimentCode)
    && normalizeText(row?.targetLab || row?.target_lab) === normalizeText(currentTask?.device);
  if (withdrawn && !restoredToCurrentDispatch) {
    return {
      active: false,
      belongsToCurrentWorkflow: false,
      rank: 0,
      withdrawn: true,
    };
  }

  const belongsToCurrentWorkflow = trayBelongsToCurrentLaboratoryWorkflow(row, currentTask);
  const rank = belongsToCurrentWorkflow ? resolveCurrentWorkflowTrayRank(row, currentTask) : 0;
  return {
    active: belongsToCurrentWorkflow && rank >= 1 && rank < 5,
    belongsToCurrentWorkflow,
    rank,
    withdrawn: false,
  };
};

const laboratoryRowHasStartedOperation = (row) =>
  asArray(row?.trayRows).some((tray) => resolveTrayExperimentOperationState(tray, row).active);

const laboratoryOperationTrayCodeSet = (row) =>
  new Set(
    asArray(row?.trayRows)
      .filter((tray) => resolveTrayExperimentOperationState(tray, row).active)
      .map((tray) => normalizeText(tray?.trayCode))
      .filter(Boolean),
  );

const trayCanParticipateInSharedOperationLock = (row, currentTask) =>
  trayBelongsToCurrentLaboratoryWorkflow(row, currentTask)
  || (!trayHasExplicitLaboratoryWorkflowScope(row) && !trayLaboratoryLocation(row));

const laboratoryRowsShareTray = (left, right) => {
  const leftTrayCodes = laboratoryOperationTrayCodeSet(left);
  if (!leftTrayCodes.size) {
    return false;
  }
  return asArray(right?.trayRows).some((tray) =>
    trayCanParticipateInSharedOperationLock(tray, right)
    && leftTrayCodes.has(normalizeText(tray?.trayCode)),
  );
};

const resolveLaboratoryOperationLabRef = (currentTask = null, lab = null) => {
  const explicitLab = resolveLabRef(lab);
  const explicitName = normalizeText(explicitLab?.name);
  const explicitCode = normalizeText(explicitLab?.code);
  const explicitId = normalizeText(explicitLab?.id);
  if (explicitName || explicitCode || explicitId) {
    return explicitLab;
  }
  return resolveLabRef({
    code: currentTask?.labCode,
    device: currentTask?.device,
  });
};

const getLaboratoryOperationLock = (scheduleRows = [], currentTask = null, lab = null) => {
  const currentKey = laboratoryOperationKey(currentTask);
  const labRef = resolveLaboratoryOperationLabRef(currentTask, lab);
  const hasLabScope = Boolean(normalizeText(labRef?.name) || normalizeText(labRef?.code) || normalizeText(labRef?.id));
  const lockedRow = asArray(scheduleRows).find((row) => {
    const rowKey = laboratoryOperationKey(row);
    const sameLaboratory = hasLabScope && scheduleMatchesLab(row, labRef);
    const sharedTray = laboratoryRowsShareTray(row, currentTask);
    const matchesOperationScope =
      (!hasLabScope && !currentTask)
      || sameLaboratory
      || sharedTray;
    return (!currentKey || rowKey !== currentKey)
      && matchesOperationScope
      && laboratoryRowHasStartedOperation(row);
  });
  if (!lockedRow) {
    return { active: false };
  }
  const sameLaboratory = hasLabScope && scheduleMatchesLab(lockedRow, labRef);
  const sharedTray = laboratoryRowsShareTray(lockedRow, currentTask);
  return {
    active: true,
    experimentKey: laboratoryOperationKey(lockedRow),
    experimentName: normalizeText(lockedRow?.experimentName),
    sameLaboratory,
    sharedTray,
    taskCode: normalizeText(lockedRow?.taskCode),
  };
};

export {
  experimentHistoryStatusIsWithdrawal,
  getLaboratoryOperationLock,
  getRunningTrayRowsForCurrentTask,
  isPreviousExperimentCompletionForCurrentTask,
  laboratoryRowHasStartedOperation,
  resolveLaboratoryStatusRank,
  resolveTrayExperimentOperationState,
  resolveUnifiedTrayFlowRank,
  rowHasCompletedAxisSubExperimentForOtherExperiment,
  rowHasPartialAxisCompletionStatus,
  rowHasPreDispatchLifecycleStatus,
  rowHasReturnedStatus,
  rowHasUnfinishedDifferentTargetExperiment,
  rowPartialAxisCompletionStatusLabels,
  rowPartialAxisStatusMatchesCurrentExperiment,
  rowCanEnterCurrentExperimentAfterOtherCompletion,
  rowCanUseCurrentExperimentAfterCompletedTarget,
  taskHasCurrentLaboratoryDispatch,
  taskHasWrongLaboratoryDispatch,
  trayCanEnterCurrentExperimentAfterOtherCompletion,
  trayHasActiveRunForCurrentExperiment,
  trayIsCompletedForCurrentExperiment,
  trayIsDispatchedToCurrentLaboratory,
  trayIsOccupiedByDifferentLaboratory,
  trayLaboratoryLocation,
  trayLifecycleIsBeforeLaboratoryDispatch,
};
