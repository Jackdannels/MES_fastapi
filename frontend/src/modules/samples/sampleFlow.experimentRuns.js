import { RUNNING_EXPERIMENT_RUN_STATUSES } from "./sampleFlow.constants";
import { normalizeText } from "./sampleFlow.shared";
import { normalizeLifecycleStatus } from "./sampleFlow.status";
import {
  asArray,
  compareText,
  entryTimeValue,
  resolveEntryExperimentCode,
  resolveEntryTaskCode,
  resolveEntryTrayCode,
} from "./sampleFlow.trayScope";
import { experimentRunTimeValue } from "./sampleFlow.experimentHelpers";

const resolveRunNo = (run) => normalizeText(run?.run_no || run?.runNo || run?.id);

const resolveExperimentRunTrayEntryForRun = ({ experimentCode, experimentRunTrays = [], run, taskCode, trayCode }) => {
  const normalizedExperimentCode = normalizeText(experimentCode);
  const normalizedRunNo = resolveRunNo(run);
  const normalizedTaskCode = normalizeText(taskCode);
  const normalizedTrayCode = normalizeText(trayCode);
  if (!normalizedExperimentCode || !normalizedTaskCode || !normalizedTrayCode || !normalizedRunNo) {
    return null;
  }
  return asArray(experimentRunTrays)
    .filter((relation) =>
      normalizeText(relation?.run_no || relation?.runNo) === normalizedRunNo
      && resolveEntryTaskCode(relation) === normalizedTaskCode
      && resolveEntryExperimentCode(relation) === normalizedExperimentCode
      && resolveEntryTrayCode(relation) === normalizedTrayCode,
    )
    .sort((left, right) =>
      entryTimeValue(right) - entryTimeValue(left)
      || compareText(right?.id, left?.id),
    )[0] || null;
};

const hasExperimentRunTrayRowsForRun = ({ experimentCode = "", experimentRunTrays = [], run, taskCode = "" }) => {
  const normalizedRunNo = resolveRunNo(run);
  const normalizedExperimentCode = normalizeText(experimentCode);
  const normalizedTaskCode = normalizeText(taskCode);
  return Boolean(normalizedRunNo) && asArray(experimentRunTrays).some(
    (relation) =>
      normalizeText(relation?.run_no || relation?.runNo) === normalizedRunNo
      && (!normalizedTaskCode || resolveEntryTaskCode(relation) === normalizedTaskCode)
      && (!normalizedExperimentCode || resolveEntryExperimentCode(relation) === normalizedExperimentCode),
  );
};

const mergeRunWithTrayStatus = (run, relation) => {
  if (!relation) {
    return run;
  }
  return {
    ...run,
    ended_at: relation?.ended_at || relation?.endedAt || run?.ended_at || run?.endedAt,
    endedAt: relation?.endedAt || relation?.ended_at || run?.endedAt || run?.ended_at,
    started_at: relation?.started_at || relation?.startedAt || run?.started_at || run?.startedAt,
    startedAt: relation?.startedAt || relation?.started_at || run?.startedAt || run?.started_at,
    status: normalizeText(relation?.run_tray_status || relation?.runTrayStatus || relation?.status) || run?.status,
    updated_at: relation?.updated_at || relation?.updatedAt || run?.updated_at || run?.updatedAt,
    updatedAt: relation?.updatedAt || relation?.updated_at || run?.updatedAt || run?.updated_at,
  };
};

const resolveExperimentRunEntry = ({ experimentCode, experimentRuns = [], experimentRunTrays = [], taskCode, trayCode }) => {
  const normalizedExperimentCode = normalizeText(experimentCode);
  const normalizedTaskCode = normalizeText(taskCode);
  const normalizedTrayCode = normalizeText(trayCode);
  if (!normalizedExperimentCode || !normalizedTaskCode) {
    return null;
  }
  const runMatches = asArray(experimentRuns)
    .map((run) => {
      if (
        resolveEntryTaskCode(run) !== normalizedTaskCode
        || resolveEntryExperimentCode(run) !== normalizedExperimentCode
      ) {
        return null;
      }
      const trayRelation = resolveExperimentRunTrayEntryForRun({
        experimentCode: normalizedExperimentCode,
        experimentRunTrays,
        run,
        taskCode: normalizedTaskCode,
        trayCode: normalizedTrayCode,
      });
      if (trayRelation) {
        return mergeRunWithTrayStatus(run, trayRelation);
      }
      if (hasExperimentRunTrayRowsForRun({ experimentCode: normalizedExperimentCode, experimentRunTrays, run, taskCode: normalizedTaskCode })) {
        return null;
      }
      return null;
    })
    .filter(Boolean);
  const relationOnlyMatches = normalizedTrayCode
    ? asArray(experimentRunTrays)
      .filter((relation) =>
        resolveEntryTaskCode(relation) === normalizedTaskCode
        && resolveEntryExperimentCode(relation) === normalizedExperimentCode
        && resolveEntryTrayCode(relation) === normalizedTrayCode,
      )
      .map((relation) => mergeRunWithTrayStatus({
        experiment_code: normalizedExperimentCode,
        run_no: relation?.run_no || relation?.runNo,
        task_code: normalizedTaskCode,
      }, relation))
    : [];
  return [...runMatches, ...relationOnlyMatches]
    .sort((left, right) =>
      experimentRunTimeValue(right) - experimentRunTimeValue(left)
      || entryTimeValue(right) - entryTimeValue(left)
      || compareText(right?.run_no || right?.id, left?.run_no || left?.id),
    )[0];
};

const resolveExperimentRunStatus = ({ experimentCode, experimentRuns = [], experimentRunTrays = [], taskCode, trayCode }) => {
  const matchedRun = resolveExperimentRunEntry({ experimentCode, experimentRuns, experimentRunTrays, taskCode, trayCode });
  const rawRunStatus = normalizeText(matchedRun?.status);
  if (!rawRunStatus) {
    return "";
  }
  const runStatus = normalizeLifecycleStatus("", rawRunStatus);
  return RUNNING_EXPERIMENT_RUN_STATUSES.has(runStatus) ? "实验进行中" : runStatus;
};

const resolveCompletedExperimentRuntime = ({ experimentCode, experimentRuns = [], experimentRunTrays = [], taskCode, trayCode }) => {
  const matchedRun = resolveExperimentRunEntry({ experimentCode, experimentRuns, experimentRunTrays, taskCode, trayCode });
  const runStatus = normalizeLifecycleStatus("", matchedRun?.status);
  if (runStatus !== "实验已完成") {
    return null;
  }
  return {
    status: runStatus,
    time: experimentRunTimeValue(matchedRun),
  };
};

export {
  resolveCompletedExperimentRuntime,
  resolveExperimentRunEntry,
  resolveExperimentRunStatus,
};
