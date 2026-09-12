import { normalizeText } from "./sampleFlow.shared";
import {
  asArray,
  parseTimeValue,
  resolveEntryExperimentCode,
  resolveEntryTaskCode,
  resolveEntryTrayCode,
} from "./sampleFlow.trayScope";

const MOLD_CANCELED_STATUS = "实验已取消";
const MOLD_CANCEL_RECOVERY_STATUS = "霉菌取消后恢复处理中";
const MOLD_CANCEL_RECOVERY_PHASE = "mold_cancel_recovery";
const COMPLETED_EXPERIMENT_STATUSES = new Set(["实验已完成", "实验完成", "实验已经完成"]);
const ACTIVE_EXPERIMENT_ROUTE_STATUSES = new Set([
  "送至实验室",
  "已到达实验室",
  "工装夹具安装",
  "实验准备就绪",
  "实验进行中",
  "实验中",
]);
const SINGLE_EXPERIMENT_FOLD_KEYS = new Set([
  "sent_to_staging",
  "arrived_staging",
  "sent_to_lab",
  "arrived_lab",
  "fixture_install",
  "ready",
  "running",
  "completed",
]);

const experimentDisplayName = (experiment = {}) => normalizeText(
  experiment?.displayName
  || experiment?.experiment_name
  || experiment?.experimentName
  || experiment?.name,
);

const relationTime = (relation = {}) => normalizeText(
  relation?.ended_at
  || relation?.endedAt
  || relation?.updated_at
  || relation?.updatedAt
  || relation?.time,
);

const isMoldExperiment = (experiment = {}, relation = {}) => [
  experimentDisplayName(experiment),
  experiment?.required_device,
  experiment?.requiredDevice,
  relation?.device,
  relation?.lab_code,
  relation?.labCode,
].map(normalizeText).some((value) => value.includes("霉菌") || value === "LAB_MOLD");

const findCancellationInsertionIndex = (steps, resultIndex) => {
  const stagingDispatchIndex = steps.findIndex((step) => (
    normalizeText(step?.key) === "sent_to_staging"
    || normalizeText(step?.label) === "送至暂存间"
  ));
  if (stagingDispatchIndex >= 0) {
    return stagingDispatchIndex;
  }
  const lastIndex = resultIndex >= 0 ? resultIndex - 1 : steps.length - 1;
  for (let index = lastIndex; index >= 0; index -= 1) {
    const label = normalizeText(steps[index]?.label);
    if (label === "送至霉菌试验室" || label === "送至实验室") {
      return index;
    }
  }
  return resultIndex >= 0 ? resultIndex : Math.max(0, steps.length - 1);
};

const findOccurredEventInsertionIndex = (steps, eventTime, fallbackIndex) => {
  const timestamp = parseTimeValue(eventTime);
  if (!timestamp) {
    return fallbackIndex;
  }
  let latestPrior = null;
  let earliestLater = null;
  steps.forEach((step, index) => {
    if (!step?.reached && !step?.active) {
      return;
    }
    const stepTime = parseTimeValue(step?.time);
    if (!stepTime) {
      return;
    }
    if (stepTime <= timestamp) {
      if (!latestPrior || stepTime > latestPrior.time || (stepTime === latestPrior.time && index > latestPrior.index)) {
        latestPrior = { index, time: stepTime };
      }
      return;
    }
    if (!earliestLater || stepTime < earliestLater.time || (stepTime === earliestLater.time && index < earliestLater.index)) {
      earliestLater = { index, time: stepTime };
    }
  });
  const foundationalEndIndex = steps.reduce((latest, step, index) => (
    ["in_transit", "arrival", "arrived"].includes(normalizeText(step?.key))
      ? Math.max(latest, index + 1)
      : latest
  ), 0);
  let insertionIndex = fallbackIndex;
  if (latestPrior && (!earliestLater || latestPrior.index < earliestLater.index)) {
    insertionIndex = latestPrior.index + 1;
  } else if (earliestLater) {
    insertionIndex = earliestLater.index;
  } else if (latestPrior) {
    insertionIndex = latestPrior.index + 1;
  }
  return Math.max(foundationalEndIndex, insertionIndex);
};

const foundationalMilestoneTime = (input, trayCode, kind) => {
  const aliases = kind === "arrival"
    ? new Set(["到货", "任务已确认入库"])
    : new Set(["运输中", "样品运输中", "样品分装托盘"]);
  const times = [];
  asArray(input.samples).forEach((sample) => {
    const sampleTrayCodes = Array.from(new Set(
      asArray(sample?.trays).map(resolveEntryTrayCode).filter(Boolean),
    ));
    if (!sampleTrayCodes.includes(trayCode)) {
      return;
    }
    asArray(sample?.history).forEach((entry) => {
      const entryTrayCode = resolveEntryTrayCode(entry);
      if ((entryTrayCode && entryTrayCode !== trayCode) || (!entryTrayCode && sampleTrayCodes.length !== 1)) {
        return;
      }
      if (![entry?.status, entry?.action].map(normalizeText).some((value) => aliases.has(value))) {
        return;
      }
      const time = relationTime(entry);
      if (time) {
        times.push(time);
      }
    });
  });
  return times.sort((left, right) => Date.parse(left) - Date.parse(right))[0] || "";
};

const restoreFoundationalSteps = (steps, endIndex, input, trayCode) => {
  steps.slice(0, endIndex).forEach((step) => {
    const key = normalizeText(step?.key);
    const isTransport = key === "in_transit";
    const isArrival = key === "arrival" || key === "arrived";
    if (!isTransport && !isArrival) {
      return;
    }
    step.reached = true;
    step.time = normalizeText(step?.time)
      || foundationalMilestoneTime(input, trayCode, isArrival ? "arrival" : "transport");
  });
};

const foldCurrentMoldAttempt = (steps, cancellationStep, recoveryStep, resultStep) => {
  const resultKey = normalizeText(resultStep?.key);
  const multiMatch = resultKey.match(/^experiment-current-(\d+)$/);
  const multiRoutePrefix = multiMatch ? `route-${multiMatch[1]}-` : "";
  const usesSingleTemplate = SINGLE_EXPERIMENT_FOLD_KEYS.has(resultKey);
  if (!multiRoutePrefix && !usesSingleTemplate) {
    return false;
  }

  const foldedSteps = new Set();
  steps.forEach((step) => {
    const key = normalizeText(step?.key);
    if (
      step === resultStep
      || (usesSingleTemplate && SINGLE_EXPERIMENT_FOLD_KEYS.has(key))
      || (multiRoutePrefix && key.startsWith(multiRoutePrefix))
    ) {
      foldedSteps.add(step);
    }
  });
  const firstFoldedIndex = steps.findIndex((step) => foldedSteps.has(step));
  if (firstFoldedIndex < 0) {
    return false;
  }
  const foldedSummarySteps = new Set([cancellationStep, recoveryStep].filter(Boolean));
  const insertionIndex = steps
    .slice(0, firstFoldedIndex)
    .filter((step) => !foldedSummarySteps.has(step) && !foldedSteps.has(step))
    .length;
  const retainedSteps = steps.filter((step) => !foldedSummarySteps.has(step) && !foldedSteps.has(step));
  retainedSteps.splice(insertionIndex, 0, ...foldedSummarySteps);
  steps.splice(0, steps.length, ...retainedSteps);
  return true;
};

const trayTargetExperimentCode = (input, trayCode) => {
  for (const sample of asArray(input.samples)) {
    for (const tray of asArray(sample?.trays)) {
      if (resolveEntryTrayCode(tray) !== trayCode) {
        continue;
      }
      const experimentCode = normalizeText(tray?.target_experiment_code || tray?.targetExperimentCode);
      if (experimentCode) {
        return experimentCode;
      }
    }
  }
  return "";
};

const relationIsAfter = (candidate, reference, relations) => {
  const candidateTime = parseTimeValue(relationTime(candidate));
  const referenceTime = parseTimeValue(relationTime(reference));
  if (candidateTime && referenceTime) {
    return candidateTime > referenceTime;
  }
  return relations.indexOf(candidate) > relations.indexOf(reference);
};

const decorateMoldCancellationSteps = (flow, input = {}) => {
  const taskCode = normalizeText(input.taskCode);
  const trayCode = normalizeText(input.trayCode);
  const experiments = asArray(input.experiments);
  const runTrayRelations = asArray(input.experimentRunTrays || input.experiment_run_trays);
  const experimentMap = new Map(experiments.map((experiment) => [
    resolveEntryExperimentCode(experiment),
    experiment,
  ]));
  const latestCancellationByExperiment = new Map();

  runTrayRelations.forEach((relation) => {
    const relationTaskCode = resolveEntryTaskCode(relation);
    const relationTrayCode = resolveEntryTrayCode(relation);
    const experimentCode = resolveEntryExperimentCode(relation);
    const experiment = experimentMap.get(experimentCode) || {};
    if (
      relationTaskCode !== taskCode
      || relationTrayCode !== trayCode
      || normalizeText(relation?.run_tray_status || relation?.runTrayStatus || relation?.status) !== MOLD_CANCELED_STATUS
      || !isMoldExperiment(experiment, relation)
    ) {
      return;
    }
    const current = latestCancellationByExperiment.get(experimentCode);
    if (!current || Date.parse(relationTime(relation)) >= Date.parse(relationTime(current))) {
      latestCancellationByExperiment.set(experimentCode, relation);
    }
  });

  if (!latestCancellationByExperiment.size) {
    return flow;
  }

  const steps = asArray(flow?.steps).map((step) => ({ ...step }));
  const insertedCancellationByExperiment = new Map();
  latestCancellationByExperiment.forEach((relation, experimentCode) => {
    const experiment = experimentMap.get(experimentCode) || {};
    const moldName = experimentDisplayName(experiment) || "霉菌试验";
    const cancelLabel = `${moldName}已取消`;
    if (steps.some((step) => normalizeText(step?.label) === cancelLabel)) {
      return;
    }
    const resultIndex = steps.findIndex((step) => {
      const label = normalizeText(step?.label);
      return label.startsWith(moldName) && (label.endsWith("未完成") || label.endsWith("已完成") || label.endsWith("进行中"));
    });
    const fallbackInsertionIndex = findCancellationInsertionIndex(steps, resultIndex);
    const insertionIndex = findOccurredEventInsertionIndex(
      steps,
      relationTime(relation),
      fallbackInsertionIndex,
    );
    const resultStep = resultIndex >= 0 ? steps[resultIndex] : null;
    const cancellationStep = {
      active: false,
      key: `mold-canceled-${normalizeText(relation?.run_no || relation?.runNo || relation?.id) || experimentCode}`,
      label: cancelLabel,
      reached: true,
      time: relationTime(relation),
    };
    steps.splice(insertionIndex, 0, cancellationStep);
    insertedCancellationByExperiment.set(experimentCode, { cancellationStep, moldName, resultStep });
  });

  const latestCancellationEntry = Array.from(latestCancellationByExperiment.entries()).reduce((latest, entry) => {
    if (!latest) {
      return entry;
    }
    const currentTime = Date.parse(relationTime(entry[1])) || 0;
    const latestTime = Date.parse(relationTime(latest[1])) || 0;
    return currentTime >= latestTime ? entry : latest;
  }, null);
  const latestCancellationExperimentCode = normalizeText(latestCancellationEntry?.[0]);
  const latestCancellationRelation = latestCancellationEntry?.[1] || null;
  const latestCancellationRunNo = normalizeText(
    latestCancellationRelation?.run_no
    || latestCancellationRelation?.runNo
    || latestCancellationRelation?.id,
  );
  const latestCancellationTime = Date.parse(relationTime(latestCancellationRelation)) || 0;

  const recoveryEvents = asArray(input.stagingEvents || input.staging_events)
    .filter((event) => {
      if (resolveEntryTaskCode(event) !== taskCode || resolveEntryTrayCode(event) !== trayCode) {
        return false;
      }
      const phase = normalizeText(event?.appearance_phase || event?.appearancePhase);
      const eventExperimentCode = normalizeText(
        event?.source_experiment_code
        || event?.sourceExperimentCode
        || event?.experiment_code
        || event?.experimentCode
        || event?.target_experiment_code
        || event?.targetExperimentCode,
      );
      if (eventExperimentCode !== latestCancellationExperimentCode) {
        return false;
      }
      const eventTime = Date.parse(relationTime(event)) || 0;
      if (!eventTime || eventTime <= latestCancellationTime) {
        return false;
      }
      if (phase === MOLD_CANCEL_RECOVERY_PHASE) {
        const sourceRunNo = normalizeText(
          event?.source_run_no
          || event?.sourceRunNo
          || event?.recovery_cycle_id
          || event?.recoveryCycleId
          || event?.run_no
          || event?.runNo,
        );
        return Boolean(latestCancellationRunNo && sourceRunNo === latestCancellationRunNo);
      }
      return phase === "post_experiment";
    })
    .sort((left, right) => Date.parse(relationTime(left)) - Date.parse(relationTime(right)));
  const latestRecoveryEvent = recoveryEvents.at(-1) || null;
  const latestRecoveryStateEvent = recoveryEvents.findLast((event) => (
    ["stock_in", "stock_out_withdraw"].includes(normalizeText(event?.action))
  )) || null;
  let recoveryStep = null;
  let recoveryOutboundStep = null;
  if (latestRecoveryEvent) {
    const sourceExperimentCode = normalizeText(
      latestRecoveryEvent?.source_experiment_code
      || latestRecoveryEvent?.sourceExperimentCode
      || latestRecoveryEvent?.experiment_code
      || latestRecoveryEvent?.experimentCode
      || latestRecoveryEvent?.target_experiment_code
      || latestRecoveryEvent?.targetExperimentCode,
    );
    const cancellationEntry = insertedCancellationByExperiment.get(sourceExperimentCode)
      || Array.from(insertedCancellationByExperiment.values()).at(-1);
    const cancellationIndex = steps.indexOf(cancellationEntry?.cancellationStep);
    recoveryStep = {
      active: false,
      key: `mold-cancel-recovery-${normalizeText(latestRecoveryEvent?.recovery_cycle_id || latestRecoveryEvent?.source_run_no || latestRecoveryEvent?.id)}`,
      label: "霉菌取消后恢复处理",
      reached: ["stock_out", "stock_out_withdraw"].includes(normalizeText(latestRecoveryEvent?.action)),
      time: relationTime(latestRecoveryStateEvent || latestRecoveryEvent),
    };
    const fallbackRecoveryIndex = cancellationIndex >= 0 ? cancellationIndex + 1 : 2;
    const occurredInsertionIndex = findOccurredEventInsertionIndex(
      steps,
      relationTime(latestRecoveryEvent),
      fallbackRecoveryIndex,
    );
    const recoveryEventTime = parseTimeValue(relationTime(latestRecoveryEvent));
    const recoveryAction = normalizeText(latestRecoveryEvent?.action);
    const recoveryTargetType = normalizeText(latestRecoveryEvent?.target_type || latestRecoveryEvent?.targetType);
    const recoveryTargetLab = normalizeText(latestRecoveryEvent?.target_lab || latestRecoveryEvent?.targetLab);
    const recoveryTargetsStaging = recoveryTargetType === "staging" || recoveryTargetLab.includes("暂存间");
    const outboundAtSameTimeIndex = recoveryAction === "stock_out" && recoveryEventTime
      ? steps.findIndex((step) => {
          if (parseTimeValue(step?.time) !== recoveryEventTime) {
            return false;
          }
          const label = normalizeText(step?.label);
          return recoveryTargetsStaging
            ? label === "送至暂存间"
            : label === "送至实验室" || (label.startsWith("送至") && label.includes(recoveryTargetLab));
        })
      : -1;
    const recoveryInsertionIndex = outboundAtSameTimeIndex >= 0
      ? Math.min(occurredInsertionIndex, outboundAtSameTimeIndex)
      : occurredInsertionIndex;
    recoveryOutboundStep = outboundAtSameTimeIndex >= 0 ? steps[outboundAtSameTimeIndex] : null;
    steps.splice(recoveryInsertionIndex, 0, recoveryStep);
  }

  const latestRecoveryAction = normalizeText(latestRecoveryEvent?.action);
  const latestRecoveryTargetType = normalizeText(latestRecoveryEvent?.target_type || latestRecoveryEvent?.targetType);
  const latestRecoveryTargetLab = normalizeText(latestRecoveryEvent?.target_lab || latestRecoveryEvent?.targetLab);
  const recoveryDispatchedDirectlyToLab = latestRecoveryAction === "stock_out"
    && latestRecoveryTargetType !== "staging"
    && !latestRecoveryTargetLab.includes("暂存间");
  if (recoveryStep && recoveryOutboundStep && recoveryDispatchedDirectlyToLab) {
    const outboundKey = normalizeText(recoveryOutboundStep?.key);
    const multiRouteMatch = outboundKey.match(/^(route-\d+-)/);
    const routePrefix = multiRouteMatch?.[1] || "";
    const inferredStagingSteps = steps.filter((step) => {
      const key = normalizeText(step?.key);
      const label = normalizeText(step?.label);
      const belongsToOutboundRoute = routePrefix
        ? key.startsWith(routePrefix)
        : ["sent_to_staging", "arrived_staging"].includes(key);
      return belongsToOutboundRoute
        && !normalizeText(step?.time)
        && (label === "送至暂存间" || label === "已到达暂存间");
    });
    if (inferredStagingSteps.length) {
      const inferredStagingSet = new Set(inferredStagingSteps);
      const retainedSteps = steps.filter((step) => !inferredStagingSet.has(step));
      const recoveryIndex = retainedSteps.indexOf(recoveryStep);
      inferredStagingSteps.forEach((step) => {
        step.active = false;
        step.reached = true;
        step.time = "";
      });
      retainedSteps.splice(recoveryIndex >= 0 ? recoveryIndex + 1 : 0, 0, ...inferredStagingSteps);
      steps.splice(0, steps.length, ...retainedSteps);
    }
  }

  const cancellationIsCurrent = [input.status, input.flowStatus, input.flow_status]
    .map(normalizeText)
    .includes(MOLD_CANCELED_STATUS);
  if (!recoveryStep && cancellationIsCurrent) {
    const cancellationEntry = insertedCancellationByExperiment.get(latestCancellationExperimentCode)
      || Array.from(insertedCancellationByExperiment.values()).at(-1);
    const cancellationIndex = steps.indexOf(cancellationEntry?.cancellationStep);
    recoveryStep = {
      active: false,
      key: `mold-cancel-recovery-pending-${latestCancellationRunNo || latestCancellationExperimentCode}`,
      label: "霉菌取消后恢复处理",
      reached: false,
      time: "",
    };
    steps.splice(cancellationIndex >= 0 ? cancellationIndex + 1 : 2, 0, recoveryStep);
  }
  const recoveryIsCurrent = [input.status, input.flowStatus, input.flow_status]
    .map(normalizeText)
    .includes(MOLD_CANCEL_RECOVERY_STATUS)
    && recoveryStep
    && ["stock_in", "stock_out_withdraw"].includes(normalizeText(latestRecoveryEvent?.action));
  const currentCancellation = insertedCancellationByExperiment.get(latestCancellationExperimentCode);
  const currentCancellationStep = currentCancellation?.cancellationStep;
  if ((cancellationIsCurrent || recoveryIsCurrent) && currentCancellationStep) {
    foldCurrentMoldAttempt(
      steps,
      currentCancellationStep,
      recoveryStep,
      currentCancellation?.resultStep,
    );
  }

  const selectedExperimentCode = trayTargetExperimentCode(input, trayCode)
    || normalizeText(input.currentExperimentCode);
  const lifecycleStatus = normalizeText(input.status || input.flowStatus || input.flow_status);
  const activeNewMoldCycle =
    !cancellationIsCurrent
    && !recoveryIsCurrent
    && selectedExperimentCode === latestCancellationExperimentCode
    && (
      ACTIVE_EXPERIMENT_ROUTE_STATUSES.has(lifecycleStatus)
      || (lifecycleStatus.startsWith("送至") && lifecycleStatus.endsWith("试验室"))
    );
  const completedAfterCancellation = runTrayRelations.some((relation) => (
    resolveEntryTaskCode(relation) === taskCode
    && resolveEntryTrayCode(relation) === trayCode
    && resolveEntryExperimentCode(relation) === latestCancellationExperimentCode
    && COMPLETED_EXPERIMENT_STATUSES.has(
      normalizeText(relation?.run_tray_status || relation?.runTrayStatus || relation?.status),
    )
    && relationIsAfter(relation, latestCancellationRelation, runTrayRelations)
  ));
  const currentMoldIsCompleted =
    selectedExperimentCode === latestCancellationExperimentCode
    && COMPLETED_EXPERIMENT_STATUSES.has(lifecycleStatus)
    && steps.some((step) => step.label === `${currentCancellation?.moldName}已完成`
      && (step.active || step.reached)
      && parseTimeValue(step.time) > parseTimeValue(relationTime(latestCancellationRelation)));
  const unfinishedLabel = `${currentCancellation?.moldName || "霉菌试验"}未完成`;
  const existingUnfinishedStep = steps.find((step) => normalizeText(step?.label) === unfinishedLabel);
  const shouldShowUnfinished = !activeNewMoldCycle && !completedAfterCancellation && !currentMoldIsCompleted;
  if (shouldShowUnfinished && currentCancellationStep) {
    if (existingUnfinishedStep) {
      existingUnfinishedStep.active = false;
      existingUnfinishedStep.reached = false;
      existingUnfinishedStep.time = "";
    } else if (steps.includes(currentCancellation?.resultStep)) {
      currentCancellation.resultStep.active = false;
      currentCancellation.resultStep.label = unfinishedLabel;
      currentCancellation.resultStep.reached = false;
      currentCancellation.resultStep.time = "";
    } else {
      const unfinishedStep = {
          active: false,
          key: `mold-unfinished-${latestCancellationExperimentCode}`,
          label: unfinishedLabel,
          reached: false,
          time: "",
      };
      const unfinishedAnchor = recoveryStep || currentCancellationStep;
      const anchorIndex = steps.indexOf(unfinishedAnchor);
      steps.splice(anchorIndex >= 0 ? anchorIndex + 1 : steps.length, 0, unfinishedStep);
    }
  } else if (existingUnfinishedStep) {
    steps.splice(steps.indexOf(existingUnfinishedStep), 1);
  }

  if (recoveryIsCurrent) {
    steps.forEach((step) => {
      step.active = false;
    });
    const recoveryIndex = steps.indexOf(recoveryStep);
    restoreFoundationalSteps(steps, recoveryIndex, input, trayCode);
    steps.slice(0, recoveryIndex).forEach((step) => {
      if (normalizeText(step?.key).startsWith("mold-canceled-")) {
        step.reached = true;
      }
    });
    steps.slice(recoveryIndex + 1).forEach((step) => {
      step.active = false;
      step.reached = false;
    });
    recoveryStep.active = true;
    recoveryStep.reached = true;
    return {
      ...flow,
      canonicalStatus: MOLD_CANCEL_RECOVERY_STATUS,
      currentStatus: `${trayCode ? `当前托盘：${trayCode} | ` : ""}当前状态：${recoveryStep.label}`,
      status: recoveryStep.label,
      steps,
    };
  }
  if (!cancellationIsCurrent) {
    return { ...flow, steps };
  }
  steps.forEach((step) => {
    step.active = false;
  });
  if (!currentCancellationStep) {
    return { ...flow, steps };
  }
  const currentCancellationIndex = steps.indexOf(currentCancellationStep);
  restoreFoundationalSteps(steps, currentCancellationIndex, input, trayCode);
  steps.slice(currentCancellationIndex + 1).forEach((step) => {
    step.active = false;
    step.reached = false;
  });
  currentCancellationStep.active = true;
  currentCancellationStep.reached = true;
  const currentStatus = normalizeText(currentCancellationStep.label);
  return {
    ...flow,
    canonicalStatus: MOLD_CANCELED_STATUS,
    currentStatus: `${trayCode ? `当前托盘：${trayCode} | ` : ""}当前状态：${currentStatus}`,
    status: currentStatus,
    steps,
  };
};

export { decorateMoldCancellationSteps };
