import { parseBusinessDateTimeToMs } from "@/lib/dateTime";
import {
  COMPLETED_EXPERIMENT_STATUSES,
  relationIsCompleted,
  resolveRelationExperimentCode,
  resolveRelationRunNo,
  resolveRelationStatus,
  resolveRelationTaskCode,
  resolveRelationTrayCode,
  resolveRunDevice,
  resolveRunExperimentCode,
  resolveRunNo,
  resolveRunScheduleId,
  resolveRunStatus,
  resolveRunTaskCode,
  resolveSubExperimentCode,
} from "./scheduleCompletion";

const normalizeText = (value) => String(value ?? "").trim();
const asArray = (value) => (Array.isArray(value) ? value : []);
const toTime = (value) => parseBusinessDateTimeToMs(value);

const RUNNING_EXPERIMENT_RUN_STATUSES = new Set(["实验进行中", "实验中", "实验暂停"]);

const buildExperimentTrayCodeMap = (experimentTrays) => {
  const trayMap = new Map();
  asArray(experimentTrays).forEach((entry) => {
    const taskCode = normalizeText(entry?.task_code);
    const experimentCode = normalizeText(entry?.experiment_code);
    const trayCode = normalizeText(entry?.tray_code);
    if (!taskCode || !experimentCode || !trayCode) {
      return;
    }
    const key = `${taskCode}::${experimentCode}`;
    const current = trayMap.get(key) || [];
    if (!current.includes(trayCode)) {
      current.push(trayCode);
    }
    trayMap.set(key, current);
  });
  return trayMap;
};

const buildExperimentCodesByTrayCode = (experimentTrayCodeMap) => {
  const trayMap = new Map();
  experimentTrayCodeMap.forEach((trayCodes, experimentKey) => {
    const experimentCode = normalizeText(String(experimentKey).split("::")[1]);
    if (!experimentCode) {
      return;
    }
    asArray(trayCodes).forEach((trayCode) => {
      const normalizedTrayCode = normalizeText(trayCode);
      if (!normalizedTrayCode) {
        return;
      }
      const current = trayMap.get(normalizedTrayCode) || [];
      if (!current.includes(experimentCode)) {
        current.push(experimentCode);
      }
      trayMap.set(normalizedTrayCode, current);
    });
  });
  return trayMap;
};

const buildCompletedScheduleTrayCodeSet = ({ experimentRuns = [], experimentRunTrays = [], schedule = null }) => {
  const taskCode = normalizeText(schedule?.task_code);
  const experimentCode = normalizeText(schedule?.experiment_code);
  const scheduleId = normalizeText(schedule?.id || schedule?.schedule_id || schedule?.scheduleId);
  const subExperimentCode = resolveSubExperimentCode(schedule);
  if (!taskCode || !experimentCode || (!scheduleId && !subExperimentCode)) {
    return new Set();
  }
  const runByNo = new Map(
    asArray(experimentRuns)
      .map((run) => [resolveRunNo(run), run])
      .filter(([runNo]) => Boolean(runNo)),
  );
  return new Set(
    asArray(experimentRunTrays)
      .filter((relation) => {
        if (
          resolveRelationTaskCode(relation) !== taskCode
          || resolveRelationExperimentCode(relation) !== experimentCode
          || !relationIsCompleted(relation)
        ) {
          return false;
        }
        if (subExperimentCode) {
          return resolveSubExperimentCode(relation) === subExperimentCode;
        }
        const relationRun = runByNo.get(resolveRelationRunNo(relation));
        return scheduleId && resolveRunScheduleId(relationRun) === scheduleId;
      })
      .map(resolveRelationTrayCode)
      .filter(Boolean),
  );
};

const buildCompletedExperimentCodesByTrayCode = ({ experimentRunTrays = [], taskCode }) => {
  const normalizedTaskCode = normalizeText(taskCode);
  const completedCodesByTrayCode = new Map();
  asArray(experimentRunTrays).forEach((relation) => {
    if (resolveRelationTaskCode(relation) !== normalizedTaskCode || !relationIsCompleted(relation)) {
      return;
    }
    const trayCode = resolveRelationTrayCode(relation);
    const experimentCode = resolveRelationExperimentCode(relation);
    if (!trayCode || !experimentCode) {
      return;
    }
    const existing = completedCodesByTrayCode.get(trayCode) || new Set();
    existing.add(experimentCode);
    completedCodesByTrayCode.set(trayCode, existing);
  });
  return completedCodesByTrayCode;
};

const buildCompletedExperimentRecordCodesByTrayCode = ({ currentExperimentCode = "", experimentRecordMap, experimentTrayCodeMap, taskCode }) => {
  const normalizedTaskCode = normalizeText(taskCode);
  const normalizedCurrentExperimentCode = normalizeText(currentExperimentCode);
  const completedCodesByTrayCode = new Map();
  experimentTrayCodeMap.forEach((trayCodes, experimentKey) => {
    const [entryTaskCode, experimentCode] = String(experimentKey).split("::");
    if (normalizeText(entryTaskCode) !== normalizedTaskCode || !normalizeText(experimentCode)) {
      return;
    }
    const experiment = experimentRecordMap?.get(experimentKey);
    if (!COMPLETED_EXPERIMENT_STATUSES.has(normalizeText(experiment?.status))) {
      return;
    }
    if (normalizeText(experimentCode) === normalizedCurrentExperimentCode) {
      return;
    }
    asArray(trayCodes).forEach((trayCode) => {
      const normalizedTrayCode = normalizeText(trayCode);
      if (!normalizedTrayCode) {
        return;
      }
      const existing = completedCodesByTrayCode.get(normalizedTrayCode) || new Set();
      existing.add(experimentCode);
      completedCodesByTrayCode.set(normalizedTrayCode, existing);
    });
  });
  return completedCodesByTrayCode;
};

const findActiveExperimentRun = ({ device, experimentCode, experimentRuns, scheduleId = "", taskCode }) => {
  const normalizedDevice = normalizeText(device);
  const normalizedExperimentCode = normalizeText(experimentCode);
  const normalizedScheduleId = normalizeText(scheduleId);
  const normalizedTaskCode = normalizeText(taskCode);
  const matchedRuns = asArray(experimentRuns)
    .filter(
      (run) =>
        resolveRunTaskCode(run) === normalizedTaskCode
        && resolveRunExperimentCode(run) === normalizedExperimentCode
        && (!normalizedScheduleId || !resolveRunScheduleId(run) || resolveRunScheduleId(run) === normalizedScheduleId)
        && (!normalizedDevice || !resolveRunDevice(run) || resolveRunDevice(run) === normalizedDevice)
        && RUNNING_EXPERIMENT_RUN_STATUSES.has(resolveRunStatus(run))
    )
    .sort((left, right) => (toTime(right?.started_at) || 0) - (toTime(left?.started_at) || 0));
  return matchedRuns[0] || null;
};

const findActiveExperimentRunTrayRelations = ({ device, experimentCode, experimentRuns, experimentRunTrays, scheduleId = "", taskCode }) => {
  const normalizedDevice = normalizeText(device);
  const normalizedExperimentCode = normalizeText(experimentCode);
  const normalizedScheduleId = normalizeText(scheduleId);
  const normalizedTaskCode = normalizeText(taskCode);
  const runByNo = new Map(
    asArray(experimentRuns)
      .map((run) => [resolveRunNo(run), run])
      .filter(([runNo]) => Boolean(runNo)),
  );
  return asArray(experimentRunTrays)
    .filter((relation) => {
      if (
        resolveRelationTaskCode(relation) !== normalizedTaskCode
        || resolveRelationExperimentCode(relation) !== normalizedExperimentCode
        || !RUNNING_EXPERIMENT_RUN_STATUSES.has(resolveRelationStatus(relation))
      ) {
        return false;
      }
      const run = runByNo.get(resolveRelationRunNo(relation));
      if (!run || !RUNNING_EXPERIMENT_RUN_STATUSES.has(resolveRunStatus(run))) {
        return false;
      }
      if (normalizedScheduleId && run && resolveRunScheduleId(run) && resolveRunScheduleId(run) !== normalizedScheduleId) {
        return false;
      }
      return !normalizedDevice || !run || !resolveRunDevice(run) || resolveRunDevice(run) === normalizedDevice;
    })
    .sort((left, right) => (toTime(right?.started_at || right?.startedAt) || 0) - (toTime(left?.started_at || left?.startedAt) || 0));
};

const buildActiveOtherExperimentRunLocks = ({
  currentExperimentCode,
  experimentMap,
  experimentRuns,
  experimentRunTrays,
  taskCode,
  trayCode,
}) => {
  const normalizedCurrentExperimentCode = normalizeText(currentExperimentCode);
  const normalizedTaskCode = normalizeText(taskCode);
  const normalizedTrayCode = normalizeText(trayCode);
  if (!normalizedTaskCode || !normalizedTrayCode || !normalizedCurrentExperimentCode) {
    return [];
  }

  const runByNo = new Map(
    asArray(experimentRuns)
      .map((run) => [resolveRunNo(run), run])
      .filter(([runNo]) => Boolean(runNo)),
  );
  const locksByKey = new Map();
  const pushLock = ({ experimentCode, relation = null, run = null }) => {
    const normalizedExperimentCode = normalizeText(experimentCode);
    if (!normalizedExperimentCode || normalizedExperimentCode === normalizedCurrentExperimentCode) {
      return;
    }
    const runNo = resolveRunNo(run) || resolveRelationRunNo(relation);
    const key = `${runNo || "run"}::${normalizedExperimentCode}`;
    if (locksByKey.has(key)) {
      return;
    }
    locksByKey.set(key, {
      device: resolveRunDevice(run),
      experimentCode: normalizedExperimentCode,
      experimentName: normalizeText(experimentMap?.get(`${normalizedTaskCode}::${normalizedExperimentCode}`)) || normalizedExperimentCode,
      runNo,
      trayCode: normalizedTrayCode,
    });
  };

  asArray(experimentRunTrays).forEach((relation) => {
    if (
      resolveRelationTaskCode(relation) !== normalizedTaskCode
      || resolveRelationTrayCode(relation) !== normalizedTrayCode
      || !RUNNING_EXPERIMENT_RUN_STATUSES.has(resolveRelationStatus(relation))
    ) {
      return;
    }
    const run = runByNo.get(resolveRelationRunNo(relation));
    if (run && !RUNNING_EXPERIMENT_RUN_STATUSES.has(resolveRunStatus(run))) {
      return;
    }
    pushLock({ experimentCode: resolveRelationExperimentCode(relation), relation, run });
  });

  const runKeysWithTrayRelations = new Set(
    asArray(experimentRunTrays)
      .filter((relation) =>
        resolveRelationTaskCode(relation) === normalizedTaskCode
        && resolveRelationRunNo(relation)
      )
      .map((relation) => `${resolveRelationRunNo(relation)}::${resolveRelationExperimentCode(relation)}`),
  );

  asArray(experimentRuns).forEach((run) => {
    const runNo = resolveRunNo(run);
    const experimentCode = resolveRunExperimentCode(run);
    if (
      resolveRunTaskCode(run) !== normalizedTaskCode
      || !RUNNING_EXPERIMENT_RUN_STATUSES.has(resolveRunStatus(run))
      || runKeysWithTrayRelations.has(`${runNo}::${experimentCode}`)
      || !asArray(run?.tray_codes || run?.trayCodes).map(normalizeText).includes(normalizedTrayCode)
    ) {
      return;
    }
    pushLock({ experimentCode, run });
  });

  return Array.from(locksByKey.values());
};

export {
  RUNNING_EXPERIMENT_RUN_STATUSES,
  buildActiveOtherExperimentRunLocks,
  buildCompletedExperimentCodesByTrayCode,
  buildCompletedExperimentRecordCodesByTrayCode,
  buildCompletedScheduleTrayCodeSet,
  buildExperimentCodesByTrayCode,
  buildExperimentTrayCodeMap,
  findActiveExperimentRun,
  findActiveExperimentRunTrayRelations,
};
