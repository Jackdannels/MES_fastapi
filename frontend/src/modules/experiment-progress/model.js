import { RETURNED_STATUS, isExperimentCompletedStatus } from "@/lib/statusNormalization";

const normalizeText = (value) => String(value ?? "").trim();
const asArray = (value) => (Array.isArray(value) ? value : []);

const resolveTaskCode = (entry) => normalizeText(entry?.task_code || entry?.taskCode || entry?.task_no || entry?.taskNo || entry?.code);
const resolveExperimentCode = (entry) =>
  normalizeText(entry?.experiment_code || entry?.experimentCode || entry?.experiment_no || entry?.experimentNo || entry?.code);
const resolveTrayCode = (entry) => normalizeText(entry?.tray_code || entry?.trayCode || entry?.tray_no || entry?.trayNo || entry?.code);
const resolveRunStatus = (entry) => normalizeText(entry?.run_tray_status || entry?.runTrayStatus || entry?.status || entry?.state);
const isReturnedStatus = (value) => normalizeText(value) === RETURNED_STATUS;
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
const entryAppliesToTray = (entry, sample, trayCode) => {
  const sampleTrayCodes = asArray(sample?.trays).map(resolveTrayCode).filter(Boolean);
  const matchedTrayCodes = sampleTrayCodes.filter((code) => entryMatchesTrayCode(entry, code));
  if (matchedTrayCodes.length > 0) {
    return matchedTrayCodes.includes(normalizeText(trayCode));
  }
  return sampleTrayCodes.length <= 1;
};
const resolveExperimentName = (experiment) =>
  normalizeText(
    experiment?.experiment_name
    || experiment?.experimentName
    || experiment?.name
    || experiment?.experiment_type
    || experiment?.experimentType,
  );

const parseExperimentHistoryDetail = (detail, taskCode) => {
  const segments = normalizeText(detail)
    .split(" / ")
    .map((segment) => normalizeText(segment))
    .filter(Boolean);
  if (segments.length < 3 || segments[0] !== normalizeText(taskCode)) {
    return null;
  }
  return {
    experimentName: segments[1],
    status: segments[2],
  };
};

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

const sampleHistoryHasCompletedExperiment = ({ experimentCode, experimentName, sample, taskCode, trayCode }) =>
  sampleTouchesTray(sample, trayCode)
  && asArray(sample?.history).some((entry) => {
    if (!entryAppliesToTray(entry, sample, trayCode)) {
      return false;
    }
    const parsed = parseExperimentHistoryDetail(entry?.detail, taskCode);
    if (parsed && normalizeText(parsed.experimentName) === normalizeText(experimentName)) {
      return isExperimentCompletedStatus(parsed.status);
    }
    return (
      experimentCode
      && resolveExperimentCode(entry) === experimentCode
      && isExperimentCompletedStatus(entry?.status)
    );
  });

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
    const sampleReturned =
      isReturnedStatus(sample?.status)
      || isReturnedStatus(sample?.flow_status)
      || isReturnedStatus(sample?.flowStatus)
      || isReturnedStatus(sample?.location);
    if (!sampleReturned) {
      return false;
    }
    if (matchedTrays.some((tray) =>
      normalizeText(tray?.status || tray?.tray_status || tray?.trayStatus)
      && !isReturnedStatus(tray?.status)
      && !isReturnedStatus(tray?.tray_status)
      && !isReturnedStatus(tray?.trayStatus),
    )) {
      return false;
    }
    return trays.length <= 1 || trays.every((tray) =>
      isReturnedStatus(tray?.status) || isReturnedStatus(tray?.tray_status) || isReturnedStatus(tray?.trayStatus),
    );
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
    return isExperimentCompletedStatus(sample?.status)
      || asArray(sample?.trays).some((tray) =>
        resolveTrayCode(tray) === trayCode && isExperimentCompletedStatus(tray?.status),
      );
  });
};

const experimentScopedTrayIsTerminal = ({
  experimentCode,
  experimentName = "",
  experimentRunTrays = [],
  experimentTrays = [],
  samples = [],
  taskCode,
  trayCode,
}) =>
  trayExperimentRunIsCompleted({ experimentCode, experimentRunTrays, taskCode, trayCode })
  || asArray(samples).some((sample) =>
    sampleHistoryHasCompletedExperiment({ experimentCode, experimentName, sample, taskCode, trayCode }),
  )
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
  const experimentName = resolveExperimentName(experiment);
  return Array.from(trayCodes).every((trayCode) =>
    experimentScopedTrayIsTerminal({
      experimentCode: normalizedExperimentCode,
      experimentName,
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
