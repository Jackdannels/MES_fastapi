import { normalizeAxisCodes } from "@/lib/axisCodes";
import { isAxisPartialProgressStatus } from "@/modules/experiment-progress/axisProgress";
import {
  COMPLETED_EXPERIMENT_STATUSES,
  historyEntryAppliesToTray,
  relationIsCompleted,
  resolveRelationExperimentCode,
  resolveRelationRunNo,
  resolveRelationTaskCode,
  resolveRelationTrayCode,
  resolveRunExperimentCode,
  resolveRunNo,
  resolveRunStatus,
  resolveRunTaskCode,
  resolveTrayCode,
  stepAxisCode,
  stepExperimentCode,
  stepIsCompleted,
  stepRunNo,
  stepTaskCode,
} from "./scheduleCompletion";
import {
  resolveLaboratoryStatusRank,
  rowCanEnterCurrentExperimentAfterOtherCompletion,
  rowCanUseCurrentExperimentAfterCompletedTarget,
  rowHasPartialAxisCompletionStatus,
  rowHasReturnedStatus,
  trayIsDispatchedToCurrentLaboratory,
  trayLifecycleIsBeforeLaboratoryDispatch,
} from "./laboratoryTrayEligibility";
import { toTime, uniqueValues } from "./laboratoryPresentation";
import { trayHasCurrentExperimentFlowContext } from "./laboratoryTaskFlow";

const normalizeText = (value) => String(value ?? "").trim();
const asArray = (value) => (Array.isArray(value) ? value : []);

const selectedTrayHasCompletedAxisRunEvidence = ({ experimentRunTrays = [], flowContextTask = null, selectedTrayRow = null }) => {
  const taskCode = normalizeText(flowContextTask?.taskCode);
  const experimentCode = normalizeText(flowContextTask?.experimentCode);
  const trayCode = normalizeText(selectedTrayRow?.trayCode);
  if (!taskCode || !experimentCode || !trayCode) {
    return false;
  }
  return asArray(experimentRunTrays).some((relation) =>
    resolveRelationTaskCode(relation) === taskCode
    && resolveRelationExperimentCode(relation) === experimentCode
    && resolveRelationTrayCode(relation) === trayCode
    && relationIsCompleted(relation),
  );
};

const resolveSelectedTrayPartialAxisEvidenceStatus = ({
  experimentRuns = [],
  experimentRunSteps = [],
  experimentRunTrays = [],
  experiments = [],
  flowContextTask = null,
  samples = [],
  selectedTrayRow = null,
} = {}) => {
  const taskCode = normalizeText(flowContextTask?.taskCode);
  const trayCode = normalizeText(selectedTrayRow?.trayCode);
  if (!taskCode || !trayCode) {
    return "";
  }
  const sampleTrayMatches = (sample) => {
    const sampleTrayCodes = asArray(sample?.trays).map(resolveTrayCode).filter(Boolean);
    return !sampleTrayCodes.length || sampleTrayCodes.includes(trayCode);
  };
  const historyCandidates = [];
  asArray(samples).forEach((sample) => {
    if (normalizeText(sample?.task_code || sample?.taskCode) !== taskCode || !sampleTrayMatches(sample)) {
      return;
    }
    asArray(sample?.history).forEach((entry) => {
      if (!historyEntryAppliesToTray(entry, asArray(sample?.trays).map(resolveTrayCode).filter(Boolean), trayCode)) {
        return;
      }
      const status = normalizeText(entry?.status);
      const detail = normalizeText(entry?.detail);
      const partialStatus = [status, detail].find((value) => isAxisPartialProgressStatus(value)) || "";
      if (!partialStatus) {
        return;
      }
      historyCandidates.push({
        status: partialStatus,
        time: toTime(entry?.time || entry?.updated_at || entry?.created_at) || 0,
      });
    });
  });
  if (historyCandidates.length > 0) {
    historyCandidates.sort((left, right) => left.time - right.time);
    return historyCandidates[historyCandidates.length - 1].status;
  }

  const experimentByCode = new Map(
    asArray(experiments)
      .filter((experiment) => normalizeText(experiment?.task_code || experiment?.taskCode) === taskCode)
      .map((experiment) => [
        normalizeText(experiment?.experiment_code || experiment?.experimentCode || experiment?.code),
        experiment,
      ])
      .filter(([experimentCode]) => Boolean(experimentCode)),
  );
  const runByNo = new Map(
    asArray(experimentRuns)
      .filter((run) => normalizeText(run?.task_code || run?.taskCode) === taskCode)
      .map((run) => [resolveRunNo(run), run])
      .filter(([runNo]) => Boolean(runNo)),
  );
  const completedAxisCodesByExperiment = new Map();
  const runNosForTray = new Set();
  asArray(experimentRunTrays).forEach((relation) => {
    if (
      resolveRelationTaskCode(relation) !== taskCode
      || resolveRelationTrayCode(relation) !== trayCode
      || !relationIsCompleted(relation)
    ) {
      return;
    }
    const runNo = resolveRelationRunNo(relation);
    if (runNo) {
      runNosForTray.add(runNo);
    }
  });
  asArray(experimentRuns).forEach((run) => {
    if (
      resolveRunTaskCode(run) === taskCode
      && asArray(run?.tray_codes || run?.trayCodes).map(normalizeText).includes(trayCode)
      && COMPLETED_EXPERIMENT_STATUSES.has(resolveRunStatus(run))
    ) {
      const runNo = resolveRunNo(run);
      if (runNo) {
        runNosForTray.add(runNo);
      }
    }
  });
  runNosForTray.forEach((runNo) => {
    const run = runByNo.get(runNo);
    const experimentCode = resolveRunExperimentCode(run);
    const axisCodes = normalizeAxisCodes(run?.axis_codes ?? run?.axisCodes);
    if (!experimentCode || axisCodes.length === 0) {
      return;
    }
    const current = completedAxisCodesByExperiment.get(experimentCode) || new Set();
    axisCodes.forEach((axisCode) => current.add(axisCode));
    completedAxisCodesByExperiment.set(experimentCode, current);
  });
  asArray(experimentRunSteps).forEach((step) => {
    const runNo = stepRunNo(step);
    const experimentCode = stepExperimentCode(step);
    if (
      stepTaskCode(step) !== taskCode
      || !runNosForTray.has(runNo)
      || !experimentCode
      || !stepIsCompleted(step)
    ) {
      return;
    }
    const axisCode = stepAxisCode(step);
    if (!axisCode) {
      return;
    }
    const current = completedAxisCodesByExperiment.get(experimentCode) || new Set();
    current.add(axisCode);
    completedAxisCodesByExperiment.set(experimentCode, current);
  });
  for (const [experimentCode, completedAxisCodes] of completedAxisCodesByExperiment.entries()) {
    const experiment = experimentByCode.get(experimentCode);
    const requiredAxisCodes = normalizeAxisCodes(experiment?.axis_codes ?? experiment?.axisCodes);
    if (requiredAxisCodes.length > 0 && completedAxisCodes.size > 0 && completedAxisCodes.size < requiredAxisCodes.length) {
      const experimentName = normalizeText(experiment?.experiment_name || experiment?.experimentName || experiment?.name);
      return experimentName ? `${experimentName}部分完成 ${completedAxisCodes.size}/${requiredAxisCodes.length}轴` : "";
    }
  }
  return "";
};

const buildActiveAxisProgressTrayCodes = ({ baseTrayCodes = [], currentTaskContext = null, trayRows = [] }) => {
  const unfinishedWorkflowTrayCodes = asArray(trayRows)
    .filter((row) => {
      if (!row || row?.completedForCurrentExperiment === true || rowHasReturnedStatus(row)) {
        return false;
      }
      if (trayLifecycleIsBeforeLaboratoryDispatch(row)) {
        return false;
      }
      const currentExperimentCode = normalizeText(currentTaskContext?.experimentCode);
      const experimentCodes = asArray(row?.experimentCodes).map((code) => normalizeText(code)).filter(Boolean);
      const hasCurrentExperimentRelation = Boolean(
        currentExperimentCode && experimentCodes.includes(currentExperimentCode),
      );
      const targetExperimentCode = normalizeText(row?.targetExperimentCode || row?.target_experiment_code);
      const targetLab = normalizeText(row?.targetLab || row?.target_lab);
      const currentLab = normalizeText(currentTaskContext?.device);
      const pointsToOtherExperiment = Boolean(
        targetExperimentCode && currentExperimentCode && targetExperimentCode !== currentExperimentCode,
      );
      const pointsToOtherLab = Boolean(targetLab && currentLab && targetLab !== currentLab);
      if (hasCurrentExperimentRelation) {
        if ((pointsToOtherExperiment || pointsToOtherLab) && row?.completedForOtherExperiment !== true) {
          return false;
        }
        return row?.completedForOtherExperiment === true
          || rowHasPartialAxisCompletionStatus(row)
          || resolveLaboratoryStatusRank(row?.trayStatus || row?.displayStatus || row?.lifecycleStatus) > 0;
      }
      return trayHasCurrentExperimentFlowContext(row, currentTaskContext)
        || trayIsDispatchedToCurrentLaboratory(row, currentTaskContext)
        || rowCanEnterCurrentExperimentAfterOtherCompletion(row, currentTaskContext)
        || rowCanUseCurrentExperimentAfterCompletedTarget(row, currentTaskContext);
    })
    .map((row) => normalizeText(row?.trayCode))
    .filter(Boolean);
  return uniqueValues([
    ...asArray(baseTrayCodes).map(normalizeText).filter(Boolean),
    ...unfinishedWorkflowTrayCodes,
  ]);
};

export {
  buildActiveAxisProgressTrayCodes,
  resolveSelectedTrayPartialAxisEvidenceStatus,
  selectedTrayHasCompletedAxisRunEvidence,
};
