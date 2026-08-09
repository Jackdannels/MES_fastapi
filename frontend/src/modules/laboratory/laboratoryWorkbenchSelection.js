import { serverNowDate } from "@/lib/serverClock";
import { formatDateKey, toTime } from "./laboratoryPresentation";
import {
  laboratoryRowHasStartedOperation,
  rowPartialAxisStatusMatchesCurrentExperiment,
  taskHasCurrentLaboratoryDispatch,
} from "./laboratoryTrayEligibility";

const normalizeText = (value) => String(value ?? "").trim();
const asArray = (value) => (Array.isArray(value) ? value : []);

const isAxisContinuationRow = (row) => {
  const axisProgress = row?.axisProgress;
  return asArray(axisProgress?.scheduledAxisCodes).length > 0
    && asArray(axisProgress?.totalRequiredAxisCodes).length > asArray(axisProgress?.scheduledAxisCodes).length
    && Number(axisProgress?.totalCompletedCount || 0) > 0
    && Number(axisProgress?.completedCount || 0) === 0;
};

const applyStrictScheduleSequence = (rows = []) => {
  const entries = asArray(rows).map((row, index) => {
    const completedTrayCodes = new Set(
      asArray(row?.allTrayRows)
        .filter((trayRow) => trayRow?.completedForCurrentExperiment === true)
        .map((trayRow) => normalizeText(trayRow?.trayCode))
        .filter(Boolean),
    );
    return {
      index,
      row,
      scheduledTrayCodes: asArray(row?.allTrayCodes)
        .map(normalizeText)
        .filter((trayCode) => trayCode && !completedTrayCodes.has(trayCode)),
    };
  });
  const claimedTrayCodes = new Set();
  const annotations = new Map();
  const forcedEligibleByIndex = new Map();
  entries.forEach(({ index, row, scheduledTrayCodes }) => {
    if (!normalizeText(row?.runNo)) {
      return;
    }
    const forcedTrayCodes = asArray(row?.activeRunTrayCodes)
      .map(normalizeText)
      .filter((trayCode) => trayCode && scheduledTrayCodes.includes(trayCode));
    forcedEligibleByIndex.set(index, forcedTrayCodes);
    forcedTrayCodes.forEach((trayCode) => claimedTrayCodes.add(trayCode));
  });
  entries.forEach(({ index, row, scheduledTrayCodes }) => {
    const forcedTrayCodes = forcedEligibleByIndex.get(index) || [];
    const eligibleTrayCodes = [
      ...forcedTrayCodes,
      ...scheduledTrayCodes.filter((trayCode) => !claimedTrayCodes.has(trayCode)),
    ];
    scheduledTrayCodes.forEach((trayCode) => claimedTrayCodes.add(trayCode));
    const eligibleTrayCodeSet = new Set(eligibleTrayCodes);
    annotations.set(index, {
      ...row,
      sequenceBlockedTrayCodes: scheduledTrayCodes.filter((trayCode) => !eligibleTrayCodeSet.has(trayCode)),
      sequenceEligible: scheduledTrayCodes.length === 0 || eligibleTrayCodes.length > 0,
      sequenceEligibleTrayCodes: eligibleTrayCodes,
    });
  });
  return entries.map(({ index, row }) => annotations.get(index) || row);
};

const scopeScheduleRowToEligibleTrays = (row) => {
  if (
    normalizeText(row?.runNo)
    || asArray(row?.axisCodes).length > 0
    || asArray(row?.sequenceBlockedTrayCodes).length === 0
  ) {
    return row;
  }
  const eligibleTrayCodeSet = new Set(asArray(row?.sequenceEligibleTrayCodes).map(normalizeText).filter(Boolean));
  if (!eligibleTrayCodeSet.size) {
    return row;
  }
  const trayRows = asArray(row?.trayRows).filter((trayRow) => eligibleTrayCodeSet.has(normalizeText(trayRow?.trayCode)));
  const allTrayRows = asArray(row?.allTrayRows).filter((trayRow) => (
    eligibleTrayCodeSet.has(normalizeText(trayRow?.trayCode))
    || trayRow?.completedForCurrentExperiment === true
  ));
  return {
    ...row,
    allTrayCodes: Array.from(new Set(allTrayRows.map((trayRow) => normalizeText(trayRow?.trayCode)).filter(Boolean))),
    allTrayRows,
    trayCodes: asArray(row?.sequenceEligibleTrayCodes),
    trayRows,
  };
};

const rowCanBeCurrentLaboratoryTask = (row) => {
  if (row?.sequenceEligible === false) {
    return false;
  }
  if (!isAxisContinuationRow(row)) {
    return true;
  }
  const scopedTrayRows = asArray(row?.allTrayRows).length > 0
    ? asArray(row?.allTrayRows)
    : asArray(row?.trayRows);
  return scopedTrayRows.length === 0
    || taskHasCurrentLaboratoryDispatch(row)
    || scopedTrayRows.some((trayRow) => rowPartialAxisStatusMatchesCurrentExperiment(trayRow, row));
};

const findTrayFlowContextTask = (scheduleRows, currentTask, selectedTrayCode) => {
  if (currentTask) {
    return currentTask;
  }
  const normalizedTrayCode = normalizeText(selectedTrayCode);
  if (!normalizedTrayCode) {
    return asArray(scheduleRows)[0] || null;
  }
  return asArray(scheduleRows).find((row) =>
    asArray(row?.trayCodes).includes(normalizedTrayCode)
    || asArray(row?.allTrayCodes).includes(normalizedTrayCode),
  ) || asArray(scheduleRows)[0] || null;
};

const selectLaboratoryOperationTask = ({ currentCandidateRows = [] }) =>
  asArray(currentCandidateRows).find((row) => normalizeText(row?.runNo))
  || asArray(currentCandidateRows).find((row) => laboratoryRowHasStartedOperation(row))
  || null;

function buildLaboratorySummary(scheduleRows = [], now = serverNowDate()) {
  const todayKey = formatDateKey(now);
  const nowTime = now instanceof Date ? now.getTime() : toTime(now);
  const todayRows = asArray(scheduleRows).filter((row) => formatDateKey(row?.startAt) === todayKey);
  return {
    todayPendingCount: todayRows.length,
    todayUndoneCount: todayRows.filter((row) => {
      const end = toTime(row?.endAt);
      return Number.isFinite(end) && end < nowTime;
    }).length,
  };
}

export {
  applyStrictScheduleSequence,
  buildLaboratorySummary,
  findTrayFlowContextTask,
  rowCanBeCurrentLaboratoryTask,
  scopeScheduleRowToEligibleTrays,
  selectLaboratoryOperationTask,
};
