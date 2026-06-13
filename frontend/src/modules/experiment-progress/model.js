import { RETURNED_STATUS, isExperimentCompletedStatus } from "@/lib/statusNormalization";

const normalizeText = (value) => String(value ?? "").trim();
const asArray = (value) => (Array.isArray(value) ? value : []);

const resolveTaskCode = (entry) => normalizeText(entry?.task_code || entry?.taskCode || entry?.task_no || entry?.taskNo || entry?.code);
const resolveExperimentCode = (entry) =>
  normalizeText(entry?.experiment_code || entry?.experimentCode || entry?.experiment_no || entry?.experimentNo || entry?.code);
const resolveTrayCode = (entry) => normalizeText(entry?.tray_code || entry?.trayCode || entry?.tray_no || entry?.trayNo || entry?.code);
const resolveRunStatus = (entry) => normalizeText(entry?.run_tray_status || entry?.runTrayStatus || entry?.status || entry?.state);
const isReturnedStatus = (value) => normalizeText(value) === RETURNED_STATUS;
const collectExperimentTrayCodes = ({ experimentTrays, experimentCode, taskCode }) =>
  new Set(
    asArray(experimentTrays)
      .filter((entry) => resolveTaskCode(entry) === taskCode && resolveExperimentCode(entry) === experimentCode)
      .map(resolveTrayCode)
      .filter(Boolean),
  );

const buildTrayExperimentCountMap = (experimentTrays) => {
  const countMap = new Map();
  asArray(experimentTrays).forEach((entry) => {
    const taskCode = resolveTaskCode(entry);
    const trayCode = resolveTrayCode(entry);
    const experimentCode = resolveExperimentCode(entry);
    if (!taskCode || !trayCode || !experimentCode) {
      return;
    }
    const key = `${taskCode}::${trayCode}`;
    const current = countMap.get(key) || new Set();
    current.add(experimentCode);
    countMap.set(key, current);
  });
  return countMap;
};

const trayExperimentRunIsCompleted = ({ experimentCode, experimentRunTrays = [], taskCode, trayCode }) =>
  asArray(experimentRunTrays).some((entry) =>
    resolveTaskCode(entry) === taskCode
    && resolveTrayCode(entry) === trayCode
    && resolveExperimentCode(entry) === experimentCode
    && (
      isExperimentCompletedStatus(resolveRunStatus(entry))
      || resolveRunStatus(entry) === "放置实验后暂存间"
      || resolveRunStatus(entry) === "送至外观检测间"
      || resolveRunStatus(entry) === "外观检测间存放"
      || resolveRunStatus(entry) === RETURNED_STATUS
    ),
  );

const sampleTouchesTray = (sample, trayCode) =>
  asArray(sample?.trays).some((tray) => resolveTrayCode(tray) === trayCode);

const trayHasReturnedStatus = ({ samples = [], taskCode, trayCode }) =>
  asArray(samples).some((sample) => {
    if (resolveTaskCode(sample) !== taskCode || !sampleTouchesTray(sample, trayCode)) {
      return false;
    }
    const trays = asArray(sample?.trays);
    const matchedTrayReturned = trays.some((tray) =>
      resolveTrayCode(tray) === trayCode
      && (isReturnedStatus(tray?.status) || isReturnedStatus(tray?.tray_status) || isReturnedStatus(tray?.trayStatus)),
    );
    if (matchedTrayReturned) {
      return true;
    }
    const matchedTrays = trays.filter((tray) => resolveTrayCode(tray) === trayCode);
    if (matchedTrays.some((tray) =>
      normalizeText(tray?.status || tray?.tray_status || tray?.trayStatus)
      && !isReturnedStatus(tray?.status)
      && !isReturnedStatus(tray?.tray_status)
      && !isReturnedStatus(tray?.trayStatus),
    )) {
      return false;
    }
    return false;
  });

const trayHasUnsharedCompletedStatus = ({ experimentTrays, samples = [], taskCode, trayCode }) => {
  const relationCount = buildTrayExperimentCountMap(experimentTrays).get(`${taskCode}::${trayCode}`)?.size || 0;
  if (relationCount > 1) {
    return false;
  }
  return asArray(samples).some((sample) => {
    if (resolveTaskCode(sample) !== taskCode || !sampleTouchesTray(sample, trayCode)) {
      return false;
    }
    return asArray(sample?.trays).some((tray) =>
        resolveTrayCode(tray) === trayCode && isExperimentCompletedStatus(tray?.status),
      );
  });
};

const experimentScopedTrayIsTerminal = ({
  experimentCode,
  experimentRunTrays = [],
  experimentTrays = [],
  samples = [],
  taskCode,
  trayCode,
}) =>
  trayExperimentRunIsCompleted({ experimentCode, experimentRunTrays, taskCode, trayCode })
  || trayHasReturnedStatus({ samples, taskCode, trayCode })
  || trayHasUnsharedCompletedStatus({ experimentTrays, samples, taskCode, trayCode });

const experimentScopeIsTerminal = ({
  experiments = [],
  experimentCode,
  experimentRunTrays = [],
  experimentTrays = [],
  samples = [],
  taskCode,
}) => {
  const normalizedTaskCode = normalizeText(taskCode);
  const normalizedExperimentCode = normalizeText(experimentCode);
  if (!normalizedTaskCode || !normalizedExperimentCode) {
    return false;
  }
  const experiment = asArray(experiments).find(
    (entry) => resolveTaskCode(entry) === normalizedTaskCode && resolveExperimentCode(entry) === normalizedExperimentCode,
  );
  const trayCodes = collectExperimentTrayCodes({
    experimentCode: normalizedExperimentCode,
    experimentTrays,
    taskCode: normalizedTaskCode,
  });
  if (!trayCodes.size) {
    return isExperimentCompletedStatus(experiment?.status);
  }
  return Array.from(trayCodes).every((trayCode) =>
    experimentScopedTrayIsTerminal({
      experimentCode: normalizedExperimentCode,
      experimentRunTrays,
      experimentTrays,
      samples,
      taskCode: normalizedTaskCode,
      trayCode,
    }),
  );
};

export {
  collectExperimentTrayCodes,
  experimentScopeIsTerminal,
  trayExperimentRunIsCompleted,
};
