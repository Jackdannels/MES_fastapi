import {
  APPEARANCE_PRE_EXPERIMENT_STOCKED_STATUS,
  APPEARANCE_STOCKED_STATUS,
  FLOW_STEP_INDEX_BY_KEY,
  FLOW_STEP_KEY_BY_LABEL,
  POST_EXPERIMENT_STAGING_SENT_STATUS,
  POST_EXPERIMENT_STAGING_STOCKED_STATUS,
  SAMPLE_FLOW_STEPS,
} from "./sampleFlow.constants";
import { buildLabDispatchStepLabel } from "./sampleFlow.experimentHelpers";
import { resolveExperimentRunStatus } from "./sampleFlow.experimentRuns";
import {
  buildSingleExperimentStatusLabel,
  experimentFlowStatusRank,
  resolveExperimentEvent,
  resolveLatestExperimentEventMap,
} from "./sampleFlow.experimentEvents";
import { normalizeText } from "./sampleFlow.shared";
import { normalizeLifecycleStatus } from "./sampleFlow.status";
import { firstNonEmptyArray } from "./sampleFlow.trayScope";
import {
  POST_EXPERIMENT_STAGING_SENT_IS_REGULAR_STAGING_STATUS,
  resolveExperimentRuntimeCutoffMap,
  resolveSingleTrayExperiment,
} from "./sampleFlow.runtimeEvidence";

function buildSingleExperimentTrayFlow(input, { effectiveInput, stepTimeMap, trayCode }) {
  const singleExperiment = resolveSingleTrayExperiment(input);
  const singleExperimentRuntimeCutoffTime = singleExperiment
    ? resolveExperimentRuntimeCutoffMap({
        orderedExperiments: [singleExperiment],
        samples: effectiveInput.samples,
        taskCode: effectiveInput.taskCode,
        trayCode: effectiveInput.trayCode,
      }).get(normalizeText(singleExperiment.code)) || 0
    : 0;
  const singleExperimentEvent = singleExperiment
    ? resolveExperimentEvent(
        resolveLatestExperimentEventMap({
          taskCode: effectiveInput.taskCode,
          trayCode: effectiveInput.trayCode,
          samples: effectiveInput.samples,
        }),
        singleExperiment,
      )
    : null;
  const singleExperimentRuntimeStatus = singleExperiment
    ? resolveExperimentRunStatus({
        experiment: singleExperiment,
        experimentCode: singleExperiment.code,
        experimentRuns: input.experimentRuns || input.experiment_runs,
        experimentRunSteps: firstNonEmptyArray(input.experimentRunSteps, input.experiment_run_steps),
        experimentRunTrays: firstNonEmptyArray(input.experimentRunTrays, input.experiment_run_trays),
        experiments: input.experiments,
        runtimeCutoffTime: singleExperimentRuntimeCutoffTime,
        schedules: input.schedules,
        taskCode: effectiveInput.taskCode,
        trayCode: effectiveInput.trayCode,
      })
    : "";
  const singleExperimentEventStatus = normalizeLifecycleStatus("", singleExperimentEvent?.status);
  let status = normalizeLifecycleStatus(effectiveInput.location, effectiveInput.status) || SAMPLE_FLOW_STEPS[0].label;
  const statusIsPostExperimentStaging = status === POST_EXPERIMENT_STAGING_SENT_STATUS
    || status === POST_EXPERIMENT_STAGING_STOCKED_STATUS;
  if (
    !statusIsPostExperimentStaging
    && singleExperimentEventStatus === "实验已完成"
    && experimentFlowStatusRank(singleExperimentEventStatus) >= experimentFlowStatusRank(status)
  ) {
    status = singleExperimentEventStatus;
  } else if (
    !statusIsPostExperimentStaging
    && singleExperimentRuntimeStatus
    && experimentFlowStatusRank(singleExperimentRuntimeStatus) >= experimentFlowStatusRank(status)
  ) {
    status = singleExperimentRuntimeStatus;
  }
  const singleExperimentRuntimeLifecycleStatus = normalizeLifecycleStatus("", singleExperimentRuntimeStatus);
  const singleExperimentCompleted = singleExperimentEventStatus === "实验已完成"
    || singleExperimentRuntimeLifecycleStatus === "实验已完成";
  const isPreExperimentAppearanceStatus = status === APPEARANCE_PRE_EXPERIMENT_STOCKED_STATUS;
  const shouldPlaceSingleAppearanceBeforeLab = isPreExperimentAppearanceStatus;
  const shouldShowSingleAppearance = status === APPEARANCE_STOCKED_STATUS
    || status === APPEARANCE_PRE_EXPERIMENT_STOCKED_STATUS;
  const baseSingleFlowSteps = shouldPlaceSingleAppearanceBeforeLab
    ? SAMPLE_FLOW_STEPS.flatMap((step) => step.key === "arrived_staging"
      ? [step, { key: "pre_experiment_appearance_storage", label: APPEARANCE_PRE_EXPERIMENT_STOCKED_STATUS }]
      : [step])
    : shouldShowSingleAppearance
      ? SAMPLE_FLOW_STEPS.flatMap((step) => step.key === "completed"
        ? [step, { key: "appearance_storage", label: APPEARANCE_STOCKED_STATUS }]
        : [step])
      : SAMPLE_FLOW_STEPS;
  const shouldShowSinglePostTestStagingSent = !POST_EXPERIMENT_STAGING_SENT_IS_REGULAR_STAGING_STATUS
    && (status === POST_EXPERIMENT_STAGING_SENT_STATUS || Boolean(stepTimeMap.get(POST_EXPERIMENT_STAGING_SENT_STATUS)));
  const singleFlowSteps = shouldShowSinglePostTestStagingSent
    ? baseSingleFlowSteps.flatMap((step) => step.key === "post_test_staging"
      ? [{ key: "post_test_staging_sent", label: POST_EXPERIMENT_STAGING_SENT_STATUS }, step]
      : [step])
    : baseSingleFlowSteps;
  const currentStepIndex = singleFlowSteps.findIndex((step) => step.label === status);
  const currentKey = currentStepIndex >= 0
    ? singleFlowSteps[currentStepIndex].key
    : FLOW_STEP_KEY_BY_LABEL.get(status) || SAMPLE_FLOW_STEPS[0].key;
  const currentIndex = currentStepIndex >= 0
    ? currentStepIndex
    : Math.max(0, singleFlowSteps.findIndex((step) => step.key === currentKey));
  const singleExperimentName = normalizeText(singleExperiment?.displayName || singleExperiment?.name);
  const singleExperimentIdentityName = normalizeText(singleExperiment?.name);
  const singleExperimentDestinationLab = normalizeText(effectiveInput.dispatchTargetLab)
    || normalizeText(singleExperiment?.destinationLab);
  const displayStatus = buildSingleExperimentStatusLabel(singleExperimentName, status);
  const holdUncompletedSingleExperiment = status === "厂家收回" && Boolean(singleExperimentName) && !singleExperimentCompleted;
  const preExperimentReturnedReachedIndex = FLOW_STEP_INDEX_BY_KEY.get("arrived_staging") ?? 3;
  const steps = singleFlowSteps.map((step, index) => {
    const label = buildSingleExperimentStatusLabel(singleExperimentName, step.label);
    const identityLabel = buildSingleExperimentStatusLabel(singleExperimentIdentityName || singleExperimentName, step.label);
    const displayLabel = step.key === "sent_to_lab" ? buildLabDispatchStepLabel(singleExperimentDestinationLab) : label;
    const active = step.key === currentKey;
    const reached = holdUncompletedSingleExperiment ? index <= preExperimentReturnedReachedIndex : index < currentIndex;
    const stepTimeLabel = step.label === APPEARANCE_PRE_EXPERIMENT_STOCKED_STATUS
      ? APPEARANCE_STOCKED_STATUS
      : step.label;
    const time = active || reached
      ? stepTimeMap.get(label) || stepTimeMap.get(identityLabel) || stepTimeMap.get(stepTimeLabel) || ""
      : "";
    return { ...step, label: displayLabel, time, active, reached };
  });
  const displayCurrentStatus = normalizeText(steps.find((step) => step.active)?.label) || displayStatus;
  return {
    canonicalStatus: displayStatus,
    trayCode,
    status: displayCurrentStatus,
    currentStatus: trayCode ? `当前托盘：${trayCode} | 当前状态：${displayCurrentStatus}` : `当前状态：${displayCurrentStatus}`,
    steps,
  };
}

export { buildSingleExperimentTrayFlow };
