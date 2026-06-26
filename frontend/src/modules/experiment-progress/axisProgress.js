import { isExperimentCompletedStatus } from "@/lib/statusNormalization";

const normalizeText = (value) => String(value ?? "").trim();
const asArray = (value) => (Array.isArray(value) ? value : []);

const parseAxisCodes = (value) => {
  if (Array.isArray(value)) {
    return value.map(normalizeText).filter(Boolean);
  }
  const normalized = normalizeText(value);
  if (!normalized) {
    return [];
  }
  try {
    const parsed = JSON.parse(normalized);
    if (Array.isArray(parsed)) {
      return parsed.map(normalizeText).filter(Boolean);
    }
  } catch {
    // Fall through to delimiter parsing for legacy text values.
  }
  return normalized.split(/[,，/、\s]+/).map(normalizeText).filter(Boolean);
};

const uniqueAxisCodes = (values = []) => {
  const seen = new Set();
  return values.filter((value) => {
    const normalized = normalizeText(value);
    if (!normalized || seen.has(normalized)) {
      return false;
    }
    seen.add(normalized);
    return true;
  });
};

const resolveTaskCode = (entry) => normalizeText(entry?.task_code || entry?.taskCode || entry?.task_no || entry?.taskNo || entry?.code);
const resolveExperimentCode = (entry) =>
  normalizeText(entry?.experiment_code || entry?.experimentCode || entry?.experiment_no || entry?.experimentNo || entry?.code);
const resolveTrayCode = (entry) => normalizeText(entry?.tray_code || entry?.trayCode || entry?.tray_no || entry?.trayNo || entry?.code);
const resolveRunNo = (entry) => normalizeText(entry?.run_no || entry?.runNo || entry?.id);
const resolveAxisCode = (entry) => normalizeText(entry?.axis_code || entry?.axisCode);
const resolveSubExperimentCode = (entry) =>
  normalizeText(entry?.sub_experiment_code || entry?.subExperimentCode || entry?.sub_experiment_no || entry?.subExperimentNo);

const entryMatchesTaskExperiment = (entry, taskCode, experimentCode) =>
  (!taskCode || resolveTaskCode(entry) === taskCode)
  && (!experimentCode || resolveExperimentCode(entry) === experimentCode);

const entryMatchesSubExperiment = (entry, subExperimentCode) => {
  const normalizedSubExperimentCode = normalizeText(subExperimentCode);
  return !normalizedSubExperimentCode || resolveSubExperimentCode(entry) === normalizedSubExperimentCode;
};

const requiredAxisCodesForExperiment = ({ experiment, experiments = [], schedules = [], taskCode = "", experimentCode = "", subExperimentCode = "" } = {}) => {
  const normalizedTaskCode = normalizeText(taskCode);
  const normalizedExperimentCode = normalizeText(experimentCode) || resolveExperimentCode(experiment);
  const normalizedSubExperimentCode = normalizeText(subExperimentCode);
  if (normalizedSubExperimentCode) {
    const scheduledAxes = uniqueAxisCodes(
      asArray(schedules)
        .filter((entry) =>
          entryMatchesTaskExperiment(entry, normalizedTaskCode, normalizedExperimentCode)
          && entryMatchesSubExperiment(entry, normalizedSubExperimentCode),
        )
        .flatMap((entry) => parseAxisCodes(entry?.axis_codes || entry?.axisCodes)),
    );
    if (scheduledAxes.length > 0) {
      return scheduledAxes;
    }
  }
  const matchedExperiment = experiment || asArray(experiments).find((entry) =>
    entryMatchesTaskExperiment(entry, normalizedTaskCode, normalizedExperimentCode),
  );
  const experimentAxes = parseAxisCodes(matchedExperiment?.axis_codes || matchedExperiment?.axisCodes);
  if (experimentAxes.length > 0) {
    return uniqueAxisCodes(experimentAxes);
  }
  return uniqueAxisCodes(
    asArray(schedules)
      .filter((entry) =>
        entryMatchesTaskExperiment(entry, normalizedTaskCode, normalizedExperimentCode)
        && entryMatchesSubExperiment(entry, normalizedSubExperimentCode),
      )
      .flatMap((entry) => parseAxisCodes(entry?.axis_codes || entry?.axisCodes)),
  );
};

const runMatchesTray = (run, trayCode) => {
  const normalizedTrayCode = normalizeText(trayCode);
  if (!normalizedTrayCode) {
    return true;
  }
  const trayCodes = [
    ...parseAxisCodes(run?.tray_codes || run?.trayCodes),
    resolveTrayCode(run),
  ].filter(Boolean);
  return trayCodes.length === 0 || trayCodes.includes(normalizedTrayCode);
};

const collectTrayRunNos = ({ experimentCode = "", experimentRuns = [], experimentRunTrays = [], subExperimentCode = "", taskCode = "", trayCode = "" } = {}) => {
  const normalizedTaskCode = normalizeText(taskCode);
  const normalizedExperimentCode = normalizeText(experimentCode);
  const normalizedTrayCode = normalizeText(trayCode);
  const normalizedSubExperimentCode = normalizeText(subExperimentCode);
  return new Set([
    ...asArray(experimentRunTrays)
      .filter((entry) =>
        entryMatchesTaskExperiment(entry, normalizedTaskCode, normalizedExperimentCode)
        && entryMatchesSubExperiment(entry, normalizedSubExperimentCode)
        && (!normalizedTrayCode || resolveTrayCode(entry) === normalizedTrayCode),
      )
      .map(resolveRunNo),
    ...asArray(experimentRuns)
      .filter((entry) =>
        entryMatchesTaskExperiment(entry, normalizedTaskCode, normalizedExperimentCode)
        && entryMatchesSubExperiment(entry, normalizedSubExperimentCode)
        && runMatchesTray(entry, normalizedTrayCode),
      )
      .map(resolveRunNo),
  ].filter(Boolean));
};

const resolveAxisProgress = ({
  experiment,
  experimentCode = "",
  experimentRuns = [],
  experimentRunSteps = [],
  experimentRunTrays = [],
  experiments = [],
  schedules = [],
  subExperimentCode = "",
  taskCode = "",
  trayCode = "",
} = {}) => {
  const normalizedTaskCode = normalizeText(taskCode);
  const normalizedExperimentCode = normalizeText(experimentCode) || resolveExperimentCode(experiment);
  const normalizedSubExperimentCode = normalizeText(subExperimentCode);
  const requiredAxisCodes = requiredAxisCodesForExperiment({
    experiment,
    experimentCode: normalizedExperimentCode,
    experiments,
    schedules,
    subExperimentCode: normalizedSubExperimentCode,
    taskCode: normalizedTaskCode,
  });
  const totalCount = requiredAxisCodes.length;
  if (!totalCount) {
    return {
      axisAware: false,
      completedAxisCodes: [],
      completedCount: 0,
      isComplete: false,
      requiredAxisCodes: [],
      totalCount: 0,
    };
  }
  const runNos = collectTrayRunNos({
    experimentCode: normalizedExperimentCode,
    experimentRuns,
    experimentRunTrays,
    subExperimentCode: normalizedSubExperimentCode,
    taskCode: normalizedTaskCode,
    trayCode,
  });
  const requiredAxisCodeSet = new Set(requiredAxisCodes);
  const completedRunAxisCodes = asArray(experimentRuns)
    .filter((run) =>
      entryMatchesTaskExperiment(run, normalizedTaskCode, normalizedExperimentCode)
      && entryMatchesSubExperiment(run, normalizedSubExperimentCode)
      && runNos.has(resolveRunNo(run))
      && isExperimentCompletedStatus(run?.status || run?.run_status || run?.runStatus),
    )
    .flatMap((run) => parseAxisCodes(run?.axis_codes || run?.axisCodes))
    .filter((axisCode) => requiredAxisCodeSet.has(axisCode));
  const completedAxisCodes = uniqueAxisCodes(
    [
      ...asArray(experimentRunSteps)
        .filter((step) =>
          entryMatchesTaskExperiment(step, normalizedTaskCode, normalizedExperimentCode)
          && entryMatchesSubExperiment(step, normalizedSubExperimentCode)
          && (!runNos.size || runNos.has(resolveRunNo(step)))
          && requiredAxisCodeSet.has(resolveAxisCode(step))
          && isExperimentCompletedStatus(step?.status || step?.step_status || step?.stepStatus),
        )
        .map(resolveAxisCode),
      ...completedRunAxisCodes,
    ],
  );
  const completedCount = completedAxisCodes.length;
  return {
    axisAware: true,
    completedAxisCodes,
    completedCount,
    isComplete: completedCount >= totalCount,
    requiredAxisCodes,
    totalCount,
  };
};

const isAxisProgressIncomplete = (progress) => Boolean(progress?.axisAware) && !progress?.isComplete;

const buildAxisPartialProgressStatus = (experimentName, progress) => {
  const name = normalizeText(experimentName);
  if (!name || !isAxisProgressIncomplete(progress) || Number(progress?.completedCount || 0) <= 0) {
    return "";
  }
  return `${name}部分完成 ${progress.completedCount}/${progress.totalCount}轴`;
};

const isAxisPartialProgressStatus = (status) => /部分完成\s+\d+\/\d+轴$/.test(normalizeText(status));

export {
  buildAxisPartialProgressStatus,
  isAxisPartialProgressStatus,
  isAxisProgressIncomplete,
  parseAxisCodes,
  requiredAxisCodesForExperiment,
  resolveAxisProgress,
};
