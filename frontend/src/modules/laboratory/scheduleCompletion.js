import { normalizeAxisCodes } from "@/lib/axisCodes";
import { parseBusinessDateTimeToMs } from "@/lib/dateTime";
import { experimentScopeIsTerminal } from "@/modules/experiment-progress/model";

const COMPLETED_EXPERIMENT_STATUSES = new Set(["实验已完成", "实验已经完成", "实验完成"]);
const COMPLETED_TRAY_STATUSES = new Set(["实验已完成", "实验已经完成", "实验完成", "实验后暂存间存放", "厂家收回"]);
const EXPERIMENT_TRAY_TERMINAL_STATUSES = new Set([
  ...COMPLETED_EXPERIMENT_STATUSES,
  "实验后暂存间存放",
  "厂家收回",
]);

const normalizeText = (value) => String(value ?? "").trim();
const asArray = (value) => (Array.isArray(value) ? value : []);
const uniqueValues = (values = []) => {
  const seen = new Set();
  return asArray(values).filter((value) => {
    const normalized = normalizeText(value);
    if (!normalized || seen.has(normalized)) {
      return false;
    }
    seen.add(normalized);
    return true;
  });
};

const resolveSubExperimentCode = (value = {}) =>
  normalizeText(value?.subExperimentCode ?? value?.sub_experiment_code ?? value?.sub_experiment_no ?? value?.subExperimentNo);
const escapeRegExp = (value) => normalizeText(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const resolveTrayCode = (entry) => normalizeText(entry?.tray_code || entry?.trayCode || entry?.tray_no || entry?.trayNo || entry?.code);
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
const historyEntryAppliesToTray = (entry, sampleTrayCodes, trayCode) => {
  const matchedTrayCodes = asArray(sampleTrayCodes).filter((code) => entryMatchesTrayCode(entry, code));
  if (matchedTrayCodes.length > 0) {
    return matchedTrayCodes.includes(normalizeText(trayCode));
  }
  return asArray(sampleTrayCodes).length <= 1;
};

const findExperimentRecord = ({ experiments, experimentCode, taskCode }) =>
  asArray(experiments).find(
    (experiment) =>
      normalizeText(experiment?.task_code) === normalizeText(taskCode)
      && normalizeText(experiment?.experiment_code) === normalizeText(experimentCode),
  ) || null;

const parseExperimentHistoryDetail = (detail, taskCode) => {
  const segments = String(detail ?? "")
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

const resolveRunNo = (run) => normalizeText(run?.run_no || run?.runNo || run?.id);
const resolveRunTaskCode = (run) => normalizeText(run?.task_code || run?.taskCode || run?.task_no || run?.taskNo);
const resolveRunExperimentCode = (run) =>
  normalizeText(run?.experiment_code || run?.experimentCode || run?.experiment_no || run?.experimentNo);
const resolveRunDevice = (run) => normalizeText(run?.device || run?.device_name || run?.deviceName || run?.lab_name || run?.labName);
const resolveRunScheduleId = (run) => normalizeText(run?.schedule_id || run?.scheduleId);
const resolveRunStatus = (run) => normalizeText(run?.status || run?.run_status || run?.runStatus);
const resolveRelationRunNo = (relation) => normalizeText(relation?.run_no || relation?.runNo);
const resolveRelationTaskCode = (relation) => normalizeText(relation?.task_code || relation?.taskCode || relation?.task_no || relation?.taskNo);
const resolveRelationExperimentCode = (relation) =>
  normalizeText(relation?.experiment_code || relation?.experimentCode || relation?.experiment_no || relation?.experimentNo);
const resolveRelationTrayCode = (relation) => normalizeText(relation?.tray_code || relation?.trayCode || relation?.tray_no || relation?.trayNo);
const resolveRelationStatus = (relation) => normalizeText(relation?.run_tray_status || relation?.runTrayStatus || relation?.status);
const relationIsCompleted = (relation) =>
  EXPERIMENT_TRAY_TERMINAL_STATUSES.has(normalizeText(relation?.status))
  || EXPERIMENT_TRAY_TERMINAL_STATUSES.has(normalizeText(relation?.run_tray_status))
  || EXPERIMENT_TRAY_TERMINAL_STATUSES.has(normalizeText(relation?.runTrayStatus));

const stepAxisCode = (step) => normalizeText(step?.axis_code || step?.axisCode);
const stepRunNo = (step) => normalizeText(step?.run_no || step?.runNo);
const stepTaskCode = (step) => normalizeText(step?.task_code || step?.taskCode || step?.task_no || step?.taskNo);
const stepExperimentCode = (step) => normalizeText(step?.experiment_code || step?.experimentCode || step?.experiment_no || step?.experimentNo);
const stepSubExperimentCode = (step) =>
  normalizeText(step?.sub_experiment_code || step?.subExperimentCode || step?.sub_experiment_no || step?.subExperimentNo);
const stepIsCompleted = (step) => COMPLETED_EXPERIMENT_STATUSES.has(normalizeText(step?.status || step?.step_status || step?.stepStatus));

const buildScheduleTrayCodeSet = ({ experimentTrays, experimentCode, taskCode }) =>
  new Set(
    asArray(experimentTrays)
      .filter(
        (entry) =>
          normalizeText(entry?.task_code) === normalizeText(taskCode)
          && normalizeText(entry?.experiment_code) === normalizeText(experimentCode),
      )
      .map((entry) => normalizeText(entry?.tray_code))
      .filter(Boolean),
  );

const buildTrayExperimentCodeMap = (experimentTrays) => {
  const trayMap = new Map();
  asArray(experimentTrays).forEach((entry) => {
    const trayCode = normalizeText(entry?.tray_code);
    const experimentCode = normalizeText(entry?.experiment_code);
    if (!trayCode || !experimentCode) {
      return;
    }
    const current = trayMap.get(trayCode) || new Set();
    current.add(experimentCode);
    trayMap.set(trayCode, current);
  });
  return trayMap;
};

const collectScheduleSamples = ({ experimentTrays, samples, schedule }) => {
  const taskCode = normalizeText(schedule?.task_code);
  const experimentCode = normalizeText(schedule?.experiment_code);
  const scopedTrayCodes = buildScheduleTrayCodeSet({ experimentTrays, experimentCode, taskCode });
  const matchedSamples = asArray(samples).filter((sample) => {
    if (normalizeText(sample?.task_code) !== taskCode) {
      return false;
    }
    if (!scopedTrayCodes.size) {
      return true;
    }
    return asArray(sample?.trays).some((tray) => scopedTrayCodes.has(normalizeText(tray?.tray_code)));
  });

  return { matchedSamples, scopedTrayCodes, taskCode };
};

const buildScheduleAxisProgressTrayCodes = ({ experimentRuns = [], experimentRunTrays = [], schedule }) => {
  const taskCode = normalizeText(schedule?.task_code);
  const experimentCode = normalizeText(schedule?.experiment_code);
  const scheduleId = normalizeText(schedule?.id || schedule?.schedule_id || schedule?.scheduleId);
  const subExperimentCode = resolveSubExperimentCode(schedule);
  const matchingRunNos = new Set(
    asArray(experimentRuns)
      .filter((run) =>
        resolveRunTaskCode(run) === taskCode
        && resolveRunExperimentCode(run) === experimentCode
        && (!scheduleId || resolveRunScheduleId(run) === scheduleId)
        && (!subExperimentCode || resolveSubExperimentCode(run) === subExperimentCode),
      )
      .map(resolveRunNo)
      .filter(Boolean),
  );
  return uniqueValues([
    ...asArray(experimentRuns)
      .filter((run) => matchingRunNos.has(resolveRunNo(run)))
      .flatMap((run) => asArray(run?.tray_codes ?? run?.trayCodes).map(normalizeText)),
    ...asArray(experimentRunTrays)
      .filter((relation) =>
        resolveRelationTaskCode(relation) === taskCode
        && resolveRelationExperimentCode(relation) === experimentCode
        && (!subExperimentCode || !resolveSubExperimentCode(relation) || resolveSubExperimentCode(relation) === subExperimentCode)
        && (!matchingRunNos.size || matchingRunNos.has(resolveRelationRunNo(relation))),
      )
      .map(resolveRelationTrayCode),
  ].filter(Boolean));
};

const buildAxisProgressForSchedule = ({
  experiment,
  experimentRunSteps = [],
  experimentRuns = [],
  experimentRunTrays = [],
  experimentName,
  schedule,
  trayCodes = [],
}) => {
  const taskCode = normalizeText(schedule?.task_code);
  const experimentCode = normalizeText(schedule?.experiment_code);
  const scheduleId = normalizeText(schedule?.id || schedule?.schedule_id || schedule?.scheduleId);
  const subExperimentCode = resolveSubExperimentCode(schedule);
  const requiredAxisCodes = normalizeAxisCodes(experiment?.axis_codes ?? experiment?.axisCodes);
  const scheduledAxisCodes = normalizeAxisCodes(schedule?.axis_codes ?? schedule?.axisCodes);
  const scheduleRunAxisCodes = uniqueValues(
    asArray(experimentRuns)
      .filter((run) =>
        resolveRunTaskCode(run) === taskCode
        && resolveRunExperimentCode(run) === experimentCode
        && scheduleId
        && resolveRunScheduleId(run) === scheduleId,
      )
      .flatMap((run) => normalizeAxisCodes(run?.axis_codes ?? run?.axisCodes)),
  );
  const axisCodes = scheduledAxisCodes.length > 0
    ? scheduledAxisCodes
    : scheduleRunAxisCodes.length > 0
      ? scheduleRunAxisCodes
      : requiredAxisCodes;
  if (axisCodes.length === 0) {
    return null;
  }
  const runScopes = new Map(
    asArray(experimentRuns)
      .map((run) => [
        resolveRunNo(run),
        {
          experimentCode: resolveRunExperimentCode(run),
          scheduleId: resolveRunScheduleId(run),
          subExperimentCode: resolveSubExperimentCode(run),
          taskCode: resolveRunTaskCode(run),
        },
      ])
      .filter(([runNo]) => Boolean(runNo)),
  );
  const runTrayCodeMap = new Map();
  const addRunTrayCode = (runNo, trayCode) => {
    const normalizedRunNo = normalizeText(runNo);
    const normalizedTrayCode = normalizeText(trayCode);
    if (!normalizedRunNo || !normalizedTrayCode) {
      return;
    }
    const existing = runTrayCodeMap.get(normalizedRunNo) || new Set();
    existing.add(normalizedTrayCode);
    runTrayCodeMap.set(normalizedRunNo, existing);
  };
  asArray(experimentRuns)
    .filter((run) => resolveRunTaskCode(run) === taskCode && resolveRunExperimentCode(run) === experimentCode)
    .forEach((run) => {
      const runNo = resolveRunNo(run);
      asArray(run?.tray_codes ?? run?.trayCodes).forEach((trayCode) => addRunTrayCode(runNo, trayCode));
    });
  asArray(experimentRunTrays)
    .filter((relation) =>
      resolveRelationTaskCode(relation) === taskCode
      && resolveRelationExperimentCode(relation) === experimentCode,
    )
    .forEach((relation) => addRunTrayCode(resolveRelationRunNo(relation), resolveRelationTrayCode(relation)));

  const stepMatchesProgressScope = (step, includeScheduleScope) => {
    const stepRunScope = runScopes.get(stepRunNo(step));
    if (includeScheduleScope && scheduleId && stepRunScope?.scheduleId && stepRunScope.scheduleId !== scheduleId) {
      return false;
    }
    if (includeScheduleScope && subExperimentCode && stepSubExperimentCode(step) && stepSubExperimentCode(step) !== subExperimentCode) {
      return false;
    }
    if (includeScheduleScope && subExperimentCode && stepRunScope?.subExperimentCode && stepRunScope.subExperimentCode !== subExperimentCode) {
      return false;
    }
    const directTaskCode = stepTaskCode(step);
    const directExperimentCode = stepExperimentCode(step);
    if (directTaskCode || directExperimentCode) {
      return directTaskCode === taskCode && directExperimentCode === experimentCode;
    }
    return stepRunScope?.taskCode === taskCode && stepRunScope?.experimentCode === experimentCode;
  };
  const stepMatchesTrayScope = (step, trayCode) => {
    const normalizedTrayCode = normalizeText(trayCode);
    if (!normalizedTrayCode) {
      return true;
    }
    if (resolveTrayCode(step) === normalizedTrayCode) {
      return true;
    }
    return runTrayCodeMap.get(stepRunNo(step))?.has(normalizedTrayCode) === true;
  };
  const completedAxisCodesForScope = (requiredCodes, trayCode, includeScheduleScope) => requiredCodes.filter((axisCode) =>
    asArray(experimentRunSteps).some((step) => {
      if (!stepIsCompleted(step) || stepAxisCode(step) !== axisCode) {
        return false;
      }
      return stepMatchesProgressScope(step, includeScheduleScope) && stepMatchesTrayScope(step, trayCode);
    }),
  );
  const scopedTrayCodes = uniqueValues(asArray(trayCodes).map(normalizeText).filter(Boolean));
  const perTrayAxisProgress = scopedTrayCodes.length > 0
    ? scopedTrayCodes.map((trayCode) => ({
        completedAxisCodes: completedAxisCodesForScope(axisCodes, trayCode, true),
        totalCompletedAxisCodes: completedAxisCodesForScope(requiredAxisCodes, trayCode, false),
        trayCode,
      }))
    : [];
  const representativeAxisProgress = perTrayAxisProgress.reduce((selected, progress) => {
    if (!selected || progress.completedAxisCodes.length < selected.completedAxisCodes.length) {
      return progress;
    }
    return selected;
  }, null);
  const representativeTotalAxisProgress = perTrayAxisProgress.reduce((selected, progress) => {
    if (!selected || progress.totalCompletedAxisCodes.length < selected.totalCompletedAxisCodes.length) {
      return progress;
    }
    return selected;
  }, null);
  const completedAxisCodes = representativeAxisProgress?.completedAxisCodes || completedAxisCodesForScope(axisCodes, "", true);
  const totalCompletedAxisCodes = representativeTotalAxisProgress?.totalCompletedAxisCodes || completedAxisCodesForScope(requiredAxisCodes, "", false);
  const remainingAxisCodes = axisCodes.filter((axisCode) => !completedAxisCodes.includes(axisCode));
  const totalRemainingAxisCodes = requiredAxisCodes.filter((axisCode) => !totalCompletedAxisCodes.includes(axisCode));
  const completedCount = completedAxisCodes.length;
  const totalCount = axisCodes.length;
  const totalCompletedCount = totalCompletedAxisCodes.length;
  const totalRequiredCount = requiredAxisCodes.length;
  const labelPrefix = normalizeText(experimentName) || normalizeText(experiment?.experiment_name) || normalizeText(experiment?.experiment_type) || "当前试验";
  const statusLabel = completedCount > 0 && completedCount < totalCount
    ? `${labelPrefix}部分完成 ${completedCount}/${totalCount}轴`
    : completedCount === totalCount
      ? `${labelPrefix}已完成 ${completedCount}/${totalCount}轴`
      : "";
  const totalStatusLabel = totalCompletedCount > 0 && totalCompletedCount < totalRequiredCount
    ? `${labelPrefix}部分完成 ${totalCompletedCount}/${totalRequiredCount}轴`
    : totalCompletedCount === totalRequiredCount && totalRequiredCount > 0
      ? `${labelPrefix}已完成 ${totalCompletedCount}/${totalRequiredCount}轴`
      : "";
  return {
    completedAxisCodes,
    completedCount,
    remainingAxisCodes,
    requiredAxisCodes: axisCodes,
    scheduledAxisCodes,
    scheduleRunAxisCodes,
    statusLabel,
    totalCount,
    totalCompletedAxisCodes,
    totalCompletedCount,
    totalRemainingAxisCodes,
    totalRequiredAxisCodes: requiredAxisCodes,
    totalRequiredCount,
    totalStatusLabel,
  };
};

const scheduleRunCompletionCoversSchedule = ({ experimentRuns = [], experimentRunTrays = [], schedule, scopedTrayCodes = new Set() }) => {
  const taskCode = normalizeText(schedule?.task_code);
  const experimentCode = normalizeText(schedule?.experiment_code);
  const scheduleId = normalizeText(schedule?.id || schedule?.schedule_id || schedule?.scheduleId);
  const subExperimentCode = resolveSubExperimentCode(schedule);
  const scheduleRuns = asArray(experimentRuns).filter((run) =>
    resolveRunTaskCode(run) === taskCode
    && resolveRunExperimentCode(run) === experimentCode
    && (!scheduleId || resolveRunScheduleId(run) === scheduleId),
  );
  const scheduleRunNos = new Set(scheduleRuns.map(resolveRunNo).filter(Boolean));
  const completedRunTrayCodes = new Set(
    asArray(experimentRunTrays)
      .filter((relation) => {
        if (
          resolveRelationTaskCode(relation) !== taskCode
          || resolveRelationExperimentCode(relation) !== experimentCode
          || !relationIsCompleted(relation)
        ) {
          return false;
        }
        const relationSubExperimentCode = resolveSubExperimentCode(relation);
        const relationIsReturned = normalizeText(resolveRelationStatus(relation)) === "厂家收回";
        if (subExperimentCode) {
          return relationSubExperimentCode === subExperimentCode || (relationIsReturned && !relationSubExperimentCode);
        }
        return !scheduleRunNos.size || scheduleRunNos.has(resolveRelationRunNo(relation));
      })
      .map(resolveRelationTrayCode)
      .filter(Boolean),
  );
  const scopedCodes = Array.from(scopedTrayCodes).filter(Boolean);
  if (scopedCodes.length > 0) {
    if (scopedCodes.every((trayCode) => completedRunTrayCodes.has(trayCode))) {
      return true;
    }
    const completedRunTrayCodesFromRuns = new Set(
      scheduleRuns
        .filter((run) => COMPLETED_EXPERIMENT_STATUSES.has(resolveRunStatus(run)))
        .flatMap((run) => asArray(run?.tray_codes ?? run?.trayCodes).map(normalizeText))
        .filter(Boolean),
    );
    return completedRunTrayCodesFromRuns.size > 0
      && scopedCodes.every((trayCode) => completedRunTrayCodesFromRuns.has(trayCode));
  }
  return completedRunTrayCodes.size > 0 || scheduleRuns.some((run) => COMPLETED_EXPERIMENT_STATUSES.has(resolveRunStatus(run)));
};

const scheduleExperimentIsCompleted = ({ experiments, experimentRuns = [], experimentRunSteps = [], experimentRunTrays = [], experimentTrays, samples, schedule }) => {
  const taskCode = normalizeText(schedule?.task_code);
  const experimentCode = normalizeText(schedule?.experiment_code);
  if (!taskCode) {
    return false;
  }

  const { matchedSamples, scopedTrayCodes } = collectScheduleSamples({ experimentTrays, samples, schedule });
  const axisProgressTrayCodes = buildScheduleAxisProgressTrayCodes({ experimentRuns, experimentRunTrays, schedule });
  const experiment = findExperimentRecord({ experiments, experimentCode, taskCode });
  const axisProgress = buildAxisProgressForSchedule({
    experiment,
    experimentName: normalizeText(experiment?.experiment_name) || normalizeText(experiment?.experiment_type),
    experimentRuns,
    experimentRunSteps,
    experimentRunTrays,
    schedule,
    trayCodes: axisProgressTrayCodes,
  });
  if (axisProgress?.remainingAxisCodes?.length > 0) {
    return false;
  }
  if (axisProgress?.requiredAxisCodes?.length > 0) {
    return scheduleRunCompletionCoversSchedule({ experimentRuns, experimentRunTrays, schedule, scopedTrayCodes });
  }
  if (COMPLETED_EXPERIMENT_STATUSES.has(normalizeText(experiment?.status)) && scopedTrayCodes.size === 0) {
    return true;
  }
  if (experimentScopeIsTerminal({ experiments, experimentCode, experimentRunTrays, experimentTrays, samples, taskCode })) {
    return true;
  }
  if (matchedSamples.length === 0) {
    return false;
  }

  const trayExperimentCodeMap = buildTrayExperimentCodeMap(experimentTrays);
  const hasSharedScopedTray = Array.from(scopedTrayCodes).some((trayCode) => (trayExperimentCodeMap.get(trayCode)?.size || 0) > 1);
  if (experimentCode && hasSharedScopedTray) {
    return false;
  }

  const experimentName = normalizeText(experiment?.experiment_name);
  if (experimentName) {
    const latestHistoryByTray = new Map();
    matchedSamples.forEach((sample) => {
      const sampleTrayCodes = asArray(sample?.trays)
        .map(resolveTrayCode)
        .filter((trayCode) => !scopedTrayCodes.size || scopedTrayCodes.has(trayCode));
      asArray(sample?.history).forEach((entry) => {
        const parsed = parseExperimentHistoryDetail(entry?.detail, taskCode);
        if (!parsed || parsed.experimentName !== experimentName) {
          return;
        }
        const eventTime = parseBusinessDateTimeToMs(entry?.time) || 0;
        const targetTrayCodes = sampleTrayCodes.filter((trayCode) => historyEntryAppliesToTray(entry, sampleTrayCodes, trayCode));
        targetTrayCodes.forEach((trayCode) => {
          const existing = latestHistoryByTray.get(trayCode);
          if (!existing || eventTime >= existing.time) {
            latestHistoryByTray.set(trayCode, { status: parsed.status, time: eventTime });
          }
        });
      });
    });

    if (latestHistoryByTray.size > 0) {
      const requiredTrayCodes = scopedTrayCodes.size ? Array.from(scopedTrayCodes) : Array.from(latestHistoryByTray.keys());
      return requiredTrayCodes.length > 0
        && requiredTrayCodes.every((trayCode) => COMPLETED_TRAY_STATUSES.has(latestHistoryByTray.get(trayCode)?.status));
    }
  }

  const statuses = [];
  matchedSamples.forEach((sample) => {
    const sampleTrays = asArray(sample?.trays);
    if (!sampleTrays.length && !scopedTrayCodes.size) {
      const sampleStatus = normalizeText(sample?.status);
      if (sampleStatus) {
        statuses.push(sampleStatus);
      }
      return;
    }
    sampleTrays.forEach((tray) => {
      const trayCode = normalizeText(tray?.tray_code);
      if (scopedTrayCodes.size && !scopedTrayCodes.has(trayCode)) {
        return;
      }
      const status = normalizeText(tray?.status) || normalizeText(sample?.status);
      if (status) {
        statuses.push(status);
      }
    });
  });

  return statuses.length > 0 && statuses.every((status) => COMPLETED_TRAY_STATUSES.has(status));
};

export {
  COMPLETED_EXPERIMENT_STATUSES,
  COMPLETED_TRAY_STATUSES,
  buildAxisProgressForSchedule,
  buildScheduleAxisProgressTrayCodes,
  entryMatchesTrayCode,
  historyEntryAppliesToTray,
  parseExperimentHistoryDetail,
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
  resolveTrayCode,
  scheduleExperimentIsCompleted,
  stepAxisCode,
  stepExperimentCode,
  stepIsCompleted,
  stepRunNo,
  stepTaskCode,
};
