import {
  APPEARANCE_STOCKED_STATUS,
  EXPERIMENT_FLOW_STATUS_LABELS,
  POST_EXPERIMENT_STAGING_SENT_STATUS,
  POST_EXPERIMENT_STAGING_STOCKED_STATUS,
} from "./sampleFlow.constants";
import {
  buildExperimentRouteSteps,
  buildLabDispatchStepLabel,
  experimentRequiresAppearanceInspection,
} from "./sampleFlow.experimentHelpers";
import { normalizeText } from "./sampleFlow.shared";
import { normalizeLifecycleStatus } from "./sampleFlow.status";
import { parseTimeValue } from "./sampleFlow.trayScope";
import {
  POST_EXPERIMENT_STAGING_SENT_IS_REGULAR_STAGING_STATUS,
  buildPendingAxisContinuationLabel,
} from "./sampleFlow.runtimeEvidence";

function buildCompletedTrayFlowState({
  arrivalIndex,
  completedExperiments,
  effectiveInput,
  experimentFlow,
  stepTimeMap,
  tools,
}) {
  const {
    completedExperimentTime,
    experimentCodeStatusLabel,
    experimentDisplayName,
    experimentIdentityName,
    experimentIdentityStatusLabel,
    experimentStatusLabel,
    pushStep,
    routeStepTimeAfter,
    steps,
  } = tools;
  let activeIndex = arrivalIndex;
  let currentStatus = "到货";
  const foldedExperimentResults = experimentFlow.filter((experiment) =>
    ["completed", "partial"].includes(normalizeText(experiment?.state)));
  if (foldedExperimentResults.some((experiment) => normalizeText(experiment?.state) === "partial")) {
    const resultIndexes = foldedExperimentResults.map((experiment, index) => {
      const state = normalizeText(experiment?.state);
      if (state === "partial") {
        const label = normalizeText(experiment?.routeStatus);
        return pushStep({
          key: `experiment-folded-partial-${index}`,
          label,
          reached: true,
          time: stepTimeMap.get(label) || normalizeText(experiment?.partialTime) || "",
        });
      }
      const label = experimentStatusLabel(experiment, index, "completed");
      const identityLabel = experimentIdentityStatusLabel(experiment, index, "completed");
      const codeLabel = experimentCodeStatusLabel(experiment, "completed");
      return pushStep({
        key: `experiment-folded-completed-${index}`,
        label,
        reached: true,
        time: stepTimeMap.get(label) || stepTimeMap.get(identityLabel) || stepTimeMap.get(codeLabel) || "",
      });
    });
    const normalizedFinalStatus = normalizeLifecycleStatus(effectiveInput.location, effectiveInput.status);
    const latestExperimentResultTime = resultIndexes.reduce(
      (latest, stepIndex) => Math.max(latest, parseTimeValue(steps[stepIndex]?.time)),
      0,
    );
    const postExperimentStagingTime = routeStepTimeAfter(POST_EXPERIMENT_STAGING_STOCKED_STATUS, latestExperimentResultTime);
    const hasPostExperimentStaging = Boolean(postExperimentStagingTime)
      || normalizedFinalStatus === POST_EXPERIMENT_STAGING_STOCKED_STATUS;
    const finalStatusIsStagingStocked = normalizedFinalStatus === POST_EXPERIMENT_STAGING_STOCKED_STATUS
      || (!hasPostExperimentStaging && normalizedFinalStatus === "已到达暂存间");
    const postTestStagingSentIndex = hasPostExperimentStaging ? -1 : pushStep({
      key: "route-folded-post-staging-sent",
      label: "送至暂存间",
      reached: finalStatusIsStagingStocked || normalizedFinalStatus === "厂家收回",
      time: routeStepTimeAfter("送至暂存间", latestExperimentResultTime),
    });
    const postTestStagingIndex = pushStep({
      key: "route-folded-post-staging",
      label: hasPostExperimentStaging ? POST_EXPERIMENT_STAGING_STOCKED_STATUS : "已到达暂存间",
      reached: finalStatusIsStagingStocked || normalizedFinalStatus === "厂家收回",
      time: hasPostExperimentStaging
        ? postExperimentStagingTime
        : routeStepTimeAfter("已到达暂存间", latestExperimentResultTime),
    });
    const foldedCompletedExperimentCodes = new Set(foldedExperimentResults
      .filter((experiment) => normalizeText(experiment?.state) === "completed")
      .map((experiment) => normalizeText(experiment?.code))
      .filter(Boolean));
    const pendingAxisContinuationLabels = new Set();
    foldedExperimentResults.forEach((experiment, index) => {
      if (normalizeText(experiment?.state) === "partial" && foldedCompletedExperimentCodes.has(normalizeText(experiment?.code))) {
        return;
      }
      const label = buildPendingAxisContinuationLabel(normalizeText(experiment?.routeStatus));
      if (!label || pendingAxisContinuationLabels.has(label)) {
        return;
      }
      pendingAxisContinuationLabels.add(label);
      pushStep({ key: `axis-folded-continuation-${index}`, label });
    });
    const returnedIndex = pushStep({ key: "route-folded-returned", label: "厂家收回", reached: false });
    if (normalizedFinalStatus === "厂家收回") {
      activeIndex = returnedIndex;
      currentStatus = "厂家收回";
      resultIndexes.forEach((stepIndex) => { steps[stepIndex].reached = true; });
      if (postTestStagingSentIndex >= 0) {
        steps[postTestStagingSentIndex].reached = true;
      }
      steps[postTestStagingIndex].reached = true;
    } else if (finalStatusIsStagingStocked) {
      activeIndex = postTestStagingIndex;
      currentStatus = "已到达暂存间";
      resultIndexes.forEach((stepIndex) => { steps[stepIndex].reached = true; });
    } else {
      activeIndex = resultIndexes.at(-1) ?? arrivalIndex;
      currentStatus = normalizeText(steps[activeIndex]?.label) || "到货";
    }
    return { activeIndex, currentStatus };
  }

  const completedMilestones = completedExperiments.slice(0, -1);
  completedMilestones.forEach((experiment, index) => {
    const label = experimentStatusLabel(experiment, index, "completed");
    const identityLabel = experimentIdentityStatusLabel(experiment, index, "completed");
    pushStep({
      key: `experiment-completed-${index}`,
      label,
      reached: true,
      time: stepTimeMap.get(label) || stepTimeMap.get(identityLabel) || "",
    });
  });
  const lastExperiment = completedExperiments.at(-1);
  const routeSteps = Array.isArray(lastExperiment?.routeSteps) && lastExperiment.routeSteps.length > 0
    ? lastExperiment.routeSteps.filter(Boolean)
    : buildExperimentRouteSteps();
  const latestCompletedTimeBeforeFinal = completedMilestones.reduce(
    (latest, experiment, index) => Math.max(latest, completedExperimentTime(experiment, index)),
    0,
  );
  const experimentName = experimentDisplayName(lastExperiment, completedExperiments.length - 1);
  const experimentIdentityNameText = experimentIdentityName(lastExperiment, completedExperiments.length - 1);
  const completedLabel = `${experimentName}${EXPERIMENT_FLOW_STATUS_LABELS.completed}`;
  const completedIdentityLabel = `${experimentIdentityNameText}${EXPERIMENT_FLOW_STATUS_LABELS.completed}`;
  const completedCodeLabel = experimentCodeStatusLabel(lastExperiment, "completed");
  const finalCompletedTime = Math.max(
    parseTimeValue(stepTimeMap.get(completedLabel)),
    parseTimeValue(stepTimeMap.get(completedIdentityLabel)),
    parseTimeValue(stepTimeMap.get(completedCodeLabel)),
  );
  const finalLabDestination = normalizeText(lastExperiment?.destinationLab) || normalizeText(effectiveInput.dispatchTargetLab);
  routeSteps.forEach((label, index) => {
    pushStep({
      key: `route-final-${index}`,
      label,
      displayLabel: label === "送至实验室" ? buildLabDispatchStepLabel(finalLabDestination) : label,
      timeLabel: label,
      reached: true,
      time: routeStepTimeAfter(label, latestCompletedTimeBeforeFinal, finalCompletedTime,
        label === "送至实验室" ? [buildLabDispatchStepLabel(finalLabDestination)] : []),
    });
  });
  const completedIndex = pushStep({
    key: "experiment-final-completed",
    label: completedLabel,
    time: stepTimeMap.get(completedLabel) || stepTimeMap.get(completedIdentityLabel) || stepTimeMap.get(completedCodeLabel) || "",
  });
  const normalizedFinalStatus = normalizeLifecycleStatus(effectiveInput.location, effectiveInput.status);
  const shouldShowFinalAppearance = experimentRequiresAppearanceInspection(lastExperiment)
    && (normalizedFinalStatus === APPEARANCE_STOCKED_STATUS || Boolean(stepTimeMap.get(APPEARANCE_STOCKED_STATUS)));
  const finalAppearanceIndexes = shouldShowFinalAppearance
    ? { stocked: pushStep({ key: "route-final-appearance-stocked", label: APPEARANCE_STOCKED_STATUS }) }
    : null;
  const shouldShowPostTestStagingSent = !POST_EXPERIMENT_STAGING_SENT_IS_REGULAR_STAGING_STATUS
    && (normalizedFinalStatus === POST_EXPERIMENT_STAGING_SENT_STATUS || Boolean(stepTimeMap.get(POST_EXPERIMENT_STAGING_SENT_STATUS)));
  const postTestStagingSentIndex = shouldShowPostTestStagingSent
    ? pushStep({ key: "route-final-post-staging-sent", label: POST_EXPERIMENT_STAGING_SENT_STATUS })
    : -1;
  const shouldShowPostTestStagingStocked = normalizedFinalStatus === POST_EXPERIMENT_STAGING_STOCKED_STATUS
    || Boolean(stepTimeMap.get(POST_EXPERIMENT_STAGING_STOCKED_STATUS));
  const postTestStagingIndex = shouldShowPostTestStagingStocked
    ? pushStep({ key: "route-final-post-staging-stocked", label: POST_EXPERIMENT_STAGING_STOCKED_STATUS })
    : -1;
  const returnedIndex = pushStep({ key: "route-final-returned", label: "厂家收回" });
  if (!POST_EXPERIMENT_STAGING_SENT_IS_REGULAR_STAGING_STATUS && normalizedFinalStatus === POST_EXPERIMENT_STAGING_SENT_STATUS) {
    activeIndex = postTestStagingSentIndex;
    steps[completedIndex].reached = true;
    currentStatus = POST_EXPERIMENT_STAGING_SENT_STATUS;
  } else if (normalizedFinalStatus === POST_EXPERIMENT_STAGING_STOCKED_STATUS) {
    activeIndex = postTestStagingIndex;
    steps[completedIndex].reached = true;
    if (postTestStagingSentIndex >= 0) {
      steps[postTestStagingSentIndex].reached = true;
    }
    currentStatus = POST_EXPERIMENT_STAGING_STOCKED_STATUS;
  } else if (normalizedFinalStatus === APPEARANCE_STOCKED_STATUS && finalAppearanceIndexes) {
    activeIndex = finalAppearanceIndexes.stocked;
    steps[completedIndex].reached = true;
    currentStatus = normalizedFinalStatus;
  } else if (normalizedFinalStatus === "厂家收回") {
    activeIndex = returnedIndex;
    steps[completedIndex].reached = true;
    if (finalAppearanceIndexes) {
      steps[finalAppearanceIndexes.stocked].reached = true;
    }
    if (postTestStagingSentIndex >= 0) {
      steps[postTestStagingSentIndex].reached = true;
    }
    if (postTestStagingIndex >= 0) {
      steps[postTestStagingIndex].reached = true;
    }
    currentStatus = normalizedFinalStatus;
  } else {
    activeIndex = completedIndex;
    currentStatus = completedLabel;
  }
  return { activeIndex, currentStatus };
}

export { buildCompletedTrayFlowState };
