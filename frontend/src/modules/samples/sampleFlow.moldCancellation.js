import { normalizeText } from "./sampleFlow.shared";
import { asArray, resolveEntryExperimentCode, resolveEntryTaskCode, resolveEntryTrayCode } from "./sampleFlow.trayScope";

const MOLD_CANCELED_STATUS = "实验已取消";
const MOLD_CANCEL_RECOVERY_STATUS = "霉菌取消后恢复处理中";
const MOLD_CANCEL_RECOVERY_PHASE = "mold_cancel_recovery";

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

const decorateMoldCancellationSteps = (flow, input = {}) => {
  const taskCode = normalizeText(input.taskCode);
  const trayCode = normalizeText(input.trayCode);
  const experiments = asArray(input.experiments);
  const experimentMap = new Map(experiments.map((experiment) => [
    resolveEntryExperimentCode(experiment),
    experiment,
  ]));
  const latestCancellationByExperiment = new Map();

  asArray(input.experimentRunTrays || input.experiment_run_trays).forEach((relation) => {
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
    const insertionIndex = findCancellationInsertionIndex(steps, resultIndex);
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
  let recoveryStep = null;
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
      reached: normalizeText(latestRecoveryEvent?.action) === "stock_out",
      time: relationTime(latestRecoveryEvent),
    };
    steps.splice(cancellationIndex >= 0 ? cancellationIndex + 1 : 2, 0, recoveryStep);
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
    && normalizeText(latestRecoveryEvent?.action) === "stock_in";
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
  const currentCancellation = insertedCancellationByExperiment.get(latestCancellationEntry?.[0]);
  const currentCancellationStep = currentCancellation?.cancellationStep;
  if (!currentCancellationStep) {
    return { ...flow, steps };
  }
  if (currentCancellation.resultStep) {
    currentCancellation.resultStep.label = `${currentCancellation.moldName}未完成`;
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
