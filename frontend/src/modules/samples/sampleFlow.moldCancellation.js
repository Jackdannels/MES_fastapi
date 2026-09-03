import { normalizeText } from "./sampleFlow.shared";
import { asArray, resolveEntryExperimentCode, resolveEntryTaskCode, resolveEntryTrayCode } from "./sampleFlow.trayScope";

const MOLD_CANCELED_STATUS = "实验已取消";

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

  const cancellationIsCurrent = [input.status, input.flowStatus, input.flow_status]
    .map(normalizeText)
    .includes(MOLD_CANCELED_STATUS);
  if (!cancellationIsCurrent) {
    return { ...flow, steps };
  }
  steps.forEach((step) => {
    step.active = false;
  });
  const currentCancellationEntry = Array.from(latestCancellationByExperiment.entries()).reduce((latest, entry) => {
    if (!latest) {
      return entry;
    }
    const currentTime = Date.parse(relationTime(entry[1])) || 0;
    const latestTime = Date.parse(relationTime(latest[1])) || 0;
    return currentTime >= latestTime ? entry : latest;
  }, null);
  const currentCancellation = insertedCancellationByExperiment.get(currentCancellationEntry?.[0]);
  const currentCancellationStep = currentCancellation?.cancellationStep;
  if (!currentCancellationStep) {
    return { ...flow, steps };
  }
  if (currentCancellation.resultStep) {
    currentCancellation.resultStep.label = `${currentCancellation.moldName}未完成`;
  }
  const currentCancellationIndex = steps.indexOf(currentCancellationStep);
  steps.slice(0, currentCancellationIndex).forEach((step) => {
    if (["in_transit", "arrival"].includes(normalizeText(step?.key))) {
      step.reached = true;
    }
  });
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
