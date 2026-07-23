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

const isFutureAxisContinuationRow = (row, nowTime) =>
  (toTime(row?.startAt) || 0) > nowTime && isAxisContinuationRow(row);

const rowCanBeCurrentLaboratoryTask = (row) => {
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

const selectLaboratoryOperationTask = ({ currentCandidateRows = [], nowTime = 0 }) =>
  asArray(currentCandidateRows).find((row) => normalizeText(row?.runNo))
  || asArray(currentCandidateRows).find((row) => !isFutureAxisContinuationRow(row, nowTime) && laboratoryRowHasStartedOperation(row))
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
  buildLaboratorySummary,
  findTrayFlowContextTask,
  rowCanBeCurrentLaboratoryTask,
  selectLaboratoryOperationTask,
};
