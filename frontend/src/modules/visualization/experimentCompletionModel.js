import { isAxisProgressIncomplete, resolveAxisProgress } from "@/modules/experiment-progress/axisProgress";
import { normalizeLifecycleStatus } from "@/modules/samples/samplesFlowModel";
import { asArray, normalizeText, resolveExperimentCode, resolveTaskCode, resolveTrayCode } from "./sharedModel";

const COMPLETED_EXPERIMENT_STATUSES = new Set(["实验已完成", "实验已经完成", "实验完成"]);
const EXPERIMENT_TRAY_TERMINAL_STATUSES = new Set([
  ...COMPLETED_EXPERIMENT_STATUSES,
  "实验后暂存间存放",
  "厂家收回",
]);
const resolveRelationStatus = (relation) =>
  normalizeText(relation?.run_tray_status || relation?.runTrayStatus || relation?.status);
const resolveRelationExperimentName = (experiment) =>
  normalizeText(
    experiment?.experiment_name
    || experiment?.experimentName
    || experiment?.name
    || experiment?.experiment_type
    || experiment?.experimentType,
  );
const parseExperimentHistoryDetail = (detail) => {
  const parts = normalizeText(detail).split("/").map(normalizeText);
  if (parts.length < 3) {
    return null;
  }
  return {
    experimentName: parts[1],
    status: parts.slice(2).join(" / "),
    taskCode: parts[0],
  };
};
const escapeRegExp = (value) => normalizeText(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const entryMatchesTrayCode = (entry, trayCode) => {
  const normalizedTrayCode = normalizeText(trayCode);
  if (!normalizedTrayCode) {
    return false;
  }
  const structuredTrayCode = resolveTrayCode(entry);
  if (structuredTrayCode) {
    return structuredTrayCode === normalizedTrayCode;
  }
  const detail = normalizeText(entry?.detail);
  if (!detail) {
    return false;
  }
  const escaped = escapeRegExp(normalizedTrayCode);
  return new RegExp(`(^|[^A-Za-z0-9_-])${escaped}($|[^A-Za-z0-9_-])`).test(detail);
};
const historyEntryAppliesToTray = (entry, sample, trayCode) => {
  const sampleTrayCodes = asArray(sample?.trays).map(resolveTrayCode).filter(Boolean);
  const matchedTrayCodes = sampleTrayCodes.filter((code) => entryMatchesTrayCode(entry, code));
  if (matchedTrayCodes.length > 0) {
    return matchedTrayCodes.includes(normalizeText(trayCode));
  }
  return sampleTrayCodes.length <= 1;
};
const sampleHasCompletedExperiment = (sample, relation) => {
  const taskCode = resolveTaskCode(relation);
  const experimentName = resolveRelationExperimentName(relation?.experiment);
  const trayCode = resolveTrayCode(relation);
  if (!taskCode || !experimentName) {
    return false;
  }
  return asArray(sample?.history).some((entry) => {
    if (!historyEntryAppliesToTray(entry, sample, trayCode)) {
      return false;
    }
    const parsed = parseExperimentHistoryDetail(entry?.detail);
    return parsed?.taskCode === taskCode
      && parsed?.experimentName === experimentName
    && normalizeLifecycleStatus("", parsed?.status) === "实验已完成";
  });
};
const relationHasIncompleteAxisProgress = ({
  experimentRuns = [],
  experimentRunSteps = [],
  experimentRunTrays = [],
  experiments = [],
  relation,
  schedules = [],
}) => isAxisProgressIncomplete(resolveAxisProgress({
  experiment: relation?.experiment,
  experimentCode: resolveExperimentCode(relation),
  experimentRuns,
  experimentRunSteps,
  experimentRunTrays,
  experiments,
  schedules,
  taskCode: resolveTaskCode(relation),
  trayCode: resolveTrayCode(relation),
}));
const relationIsCompletedByRunTray = ({
  experimentRuns = [],
  experimentRunSteps = [],
  experimentRunTrays,
  experiments = [],
  relation,
  schedules = [],
}) => {
  const axisProgressIncomplete = relationHasIncompleteAxisProgress({
    experimentRuns,
    experimentRunSteps,
    experimentRunTrays,
    experiments,
    relation,
    schedules,
  });
  return asArray(experimentRunTrays).some((entry) => {
    if (
      resolveTaskCode(entry) !== resolveTaskCode(relation)
      || resolveExperimentCode(entry) !== resolveExperimentCode(relation)
      || resolveTrayCode(entry) !== resolveTrayCode(relation)
    ) {
      return false;
    }
    const status = normalizeLifecycleStatus("", resolveRelationStatus(entry));
    if (status === "厂家收回") {
      return true;
    }
    return EXPERIMENT_TRAY_TERMINAL_STATUSES.has(status) && !axisProgressIncomplete;
  });
};
const sampleTrayIsReturned = ({ sample, relation }) => {
  const trayCode = resolveTrayCode(relation);
  const trays = asArray(sample?.trays);
  const targetTray = trays.find((tray) => resolveTrayCode(tray) === trayCode);
  if (targetTray && normalizeLifecycleStatus("", normalizeText(targetTray?.status)) === "厂家收回") {
    return true;
  }
  if (targetTray && normalizeText(targetTray?.status)) {
    return false;
  }
  if (normalizeLifecycleStatus(sample?.location, normalizeText(sample?.status)) !== "厂家收回") {
    return false;
  }
  if (trays.length <= 1) {
    return Boolean(targetTray);
  }
  return trays.every((tray) => normalizeLifecycleStatus("", normalizeText(tray?.status)) === "厂家收回");
};
const relationIsCompletedForSample = ({
  experimentRuns = [],
  experimentRunSteps = [],
  experimentRunTrays = [],
  experiments = [],
  sample,
  relation,
  schedules = [],
}) => {
  const axisProgressIncomplete = relationHasIncompleteAxisProgress({
    experimentRuns,
    experimentRunSteps,
    experimentRunTrays,
    experiments,
    relation,
    schedules,
  });
  return relationIsCompletedByRunTray({
    experimentRuns,
    experimentRunSteps,
    experimentRunTrays,
    experiments,
    relation,
    schedules,
  })
    || sampleTrayIsReturned({ sample, relation })
    || (!axisProgressIncomplete && sampleHasCompletedExperiment(sample, relation));
};

export {
  COMPLETED_EXPERIMENT_STATUSES,
  EXPERIMENT_TRAY_TERMINAL_STATUSES,
  entryMatchesTrayCode,
  relationIsCompletedForSample,
  relationIsCompletedByRunTray,
  relationHasIncompleteAxisProgress,
  resolveRelationStatus,
  sampleHasCompletedExperiment,
  sampleTrayIsReturned,
};
