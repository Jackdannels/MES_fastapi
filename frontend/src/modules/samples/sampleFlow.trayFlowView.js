import {
  APPEARANCE_PRE_EXPERIMENT_STOCKED_STATUS,
  APPEARANCE_STOCKED_STATUS,
  EXPERIMENT_FLOW_STATUS_LABELS,
  FLOW_STEP_INDEX_BY_KEY,
  FLOW_STEP_KEY_BY_LABEL,
  POST_EXPERIMENT_STAGING_SENT_STATUS,
  POST_EXPERIMENT_STAGING_STOCKED_STATUS,
  SAMPLE_FLOW_STEPS,
} from "./sampleFlow.constants";
import { normalizeText } from "./sampleFlow.shared";
import {
  asArray,
  firstNonEmptyArray,
  parseTimeValue,
  uniqueNormalizedTexts,
} from "./sampleFlow.trayScope";
import {
  isAmbiguousStagingStatus,
  isAppearanceInspectionStatus,
  isPostRetentionLocation,
  normalizeLifecycleStatus,
} from "./sampleFlow.status";
import {
  buildExperimentRouteSteps,
  buildLabDispatchStepLabel,
  experimentRequiresAppearanceInspection,
} from "./sampleFlow.experimentHelpers";
import { buildOrderedTrayExperiments } from "./sampleFlow.experimentOrder";
import { resolveExperimentRunStatus } from "./sampleFlow.experimentRuns";
import { hidePendingFlowStepTimes } from "./sampleFlow.flowTimeHelpers";
import { resolveEffectiveTrayLifecycleStatus } from "./sampleFlow.trayLifecycle";
import {
  buildSingleExperimentStatusLabel,
  experimentFlowStatusRank,
  resolveExperimentEvent,
  resolveLatestExperimentEventMap,
} from "./sampleFlow.experimentEvents";
import { isAxisPartialProgressStatus } from "@/modules/experiment-progress/axisProgress";
import { buildTrayFlowTimeMap } from "./sampleFlow.flowTimeMap";
import {
  APPEARANCE_SENT_STATUS_LABEL,
  PARTIAL_AXIS_STABLE_CURRENT_STATUSES,
  POST_EXPERIMENT_STAGING_SENT_IS_REGULAR_STAGING_STATUS,
  buildPendingAxisContinuationLabel,
  resolveExperimentRuntimeCutoffMap,
  resolveLatestWithdrawalRestoreTarget,
  resolveSingleTrayExperiment,
} from "./sampleFlow.runtimeEvidence";
import { buildTrayExperimentFlow } from "./sampleFlow.trayExperimentFlow";

function buildTrayFlowView(input = {}) {
  const effectiveStatus = resolveEffectiveTrayLifecycleStatus(input);
  const effectiveInput =
    effectiveStatus && effectiveStatus !== normalizeLifecycleStatus(input.location, input.status)
      ? {
          ...input,
          location: effectiveStatus === "厂家收回" ? "厂家收回" : input.location,
          status: effectiveStatus,
        }
      : input;
  const stepTimeMap = buildTrayFlowTimeMap(input);
  const stepTimeHistoryMap = stepTimeMap.timeHistoryMap instanceof Map ? stepTimeMap.timeHistoryMap : new Map();
  const experimentFlow = Array.isArray(effectiveInput.experimentFlow) && effectiveInput.experimentFlow.length > 0
    ? effectiveInput.experimentFlow
    : buildTrayExperimentFlow(effectiveInput);
  const trayCode = normalizeText(effectiveInput.trayCode);
  if (experimentFlow.length > 0) {
    const latestWithdrawalRestoreTarget = resolveLatestWithdrawalRestoreTarget({
      taskCode: effectiveInput.taskCode,
      trayCode,
      samples: effectiveInput.samples,
    });
    const suppressInferredAppearanceReached =
      latestWithdrawalRestoreTarget
      && normalizeLifecycleStatus("", latestWithdrawalRestoreTarget.status) !== "实验已完成";
    const currentExperimentIndex = experimentFlow.findIndex((item) => normalizeText(item?.state) === "current");
    const activeExperiment = currentExperimentIndex >= 0 ? experimentFlow[currentExperimentIndex] : null;
    const completedExperiments = experimentFlow.filter((item) => normalizeText(item?.state) === "completed");
    const originalExperimentOrderMap = new Map(
      buildOrderedTrayExperiments({
        taskCode: effectiveInput.taskCode,
        trayCode,
        experiments: effectiveInput.experiments,
        experimentTrays: firstNonEmptyArray(effectiveInput.experimentTrays, effectiveInput.experiment_trays),
        schedules: effectiveInput.schedules,
      }).map((experiment, index) => [normalizeText(experiment?.code), index]),
    );
    const activeExperimentOriginalIndex = originalExperimentOrderMap.get(normalizeText(activeExperiment?.code)) ?? -1;
    const hasCompletedExperimentBeforeActiveInOriginalOrder =
      activeExperimentOriginalIndex >= 0
      && completedExperiments.some((experiment) => {
        const completedOriginalIndex = originalExperimentOrderMap.get(normalizeText(experiment?.code)) ?? -1;
        return completedOriginalIndex >= 0 && completedOriginalIndex < activeExperimentOriginalIndex;
      });
    const experimentsBeforeCurrent = currentExperimentIndex >= 0 ? experimentFlow.slice(0, currentExperimentIndex) : [];
    const experimentsAfterCurrent = currentExperimentIndex >= 0 ? experimentFlow.slice(currentExperimentIndex + 1) : [];
    const steps = [];

    const pushStep = (step) => {
      const rawLabel = normalizeText(step?.timeLabel || step?.label);
      const label = normalizeText(step?.displayLabel || step?.label);
      const hasExplicitTime = Object.prototype.hasOwnProperty.call(step || {}, "time");
      const stepPayload = { ...(step || {}) };
      delete stepPayload.displayLabel;
      delete stepPayload.timeLabel;
      steps.push({
        active: false,
        reached: false,
        ...stepPayload,
        label,
        time: hasExplicitTime ? normalizeText(step?.time) : stepTimeMap.get(rawLabel) || "",
      });
      return steps.length - 1;
    };
    const experimentDisplayName = (experiment, index) =>
      normalizeText(experiment?.displayName) || normalizeText(experiment?.name) || `实验${index + 1}`;
    const experimentIdentityName = (experiment, index) => normalizeText(experiment?.name) || `实验${index + 1}`;
    const experimentStatusLabel = (experiment, index, statusKey) =>
      `${experimentDisplayName(experiment, index)}${EXPERIMENT_FLOW_STATUS_LABELS[statusKey] || EXPERIMENT_FLOW_STATUS_LABELS.pending}`;
    const experimentIdentityStatusLabel = (experiment, index, statusKey) =>
      `${experimentIdentityName(experiment, index)}${EXPERIMENT_FLOW_STATUS_LABELS[statusKey] || EXPERIMENT_FLOW_STATUS_LABELS.pending}`;
    const experimentCodeStatusLabel = (experiment, statusKey) =>
      `${normalizeText(experiment?.code)}${EXPERIMENT_FLOW_STATUS_LABELS[statusKey] || EXPERIMENT_FLOW_STATUS_LABELS.pending}`;
    const completedExperimentTime = (experiment, index) => Math.max(
      parseTimeValue(stepTimeMap.get(experimentStatusLabel(experiment, index, "completed"))),
      parseTimeValue(stepTimeMap.get(experimentIdentityStatusLabel(experiment, index, "completed"))),
      parseTimeValue(stepTimeMap.get(experimentCodeStatusLabel(experiment, "completed"))),
    );
    const routeStepTimeAfter = (label, floorTime = 0, ceilingTime = 0, contextLabels = []) => {
      const baseTimeLabels = label === APPEARANCE_PRE_EXPERIMENT_STOCKED_STATUS
        ? [APPEARANCE_PRE_EXPERIMENT_STOCKED_STATUS, APPEARANCE_STOCKED_STATUS]
        : [label];
      const contextualTimeLabels = uniqueNormalizedTexts(asArray(contextLabels))
        .filter((timeLabel) => timeLabel && !baseTimeLabels.includes(timeLabel));
      const findMatchingTime = (timeLabels) => timeLabels.flatMap((timeLabel) => asArray(stepTimeHistoryMap.get(timeLabel)))
        .filter((time) => {
          const parsedTime = parseTimeValue(time);
          if (floorTime && parsedTime <= floorTime) {
            return false;
          }
          if (ceilingTime && parsedTime >= ceilingTime) {
            return false;
          }
          return parsedTime > 0;
        })
        .sort((left, right) => parseTimeValue(right) - parseTimeValue(left));
      const contextualMatchingTimes = findMatchingTime(contextualTimeLabels);
      if (contextualMatchingTimes.length > 0) {
        return contextualMatchingTimes[0];
      }
      if (label === "送至实验室" && contextualTimeLabels.length > 0) {
        return "";
      }
      const timeLabels = baseTimeLabels;
      const matchingTimes = findMatchingTime(timeLabels);
      if (matchingTimes.length > 0) {
        return matchingTimes[0];
      }
      const time = timeLabels.map((timeLabel) => stepTimeMap.get(timeLabel)).find(Boolean) || "";
      const parsedTime = parseTimeValue(time);
      if (!floorTime) {
        if (ceilingTime && parsedTime >= ceilingTime) {
          return "";
        }
        return time;
      }
      if (parsedTime <= floorTime) {
        return "";
      }
      if (ceilingTime && parsedTime >= ceilingTime) {
        return "";
      }
      return time;
    };

    const transportIndex = pushStep({ key: "in_transit", label: "样品运输中" });
    const arrivalIndex = pushStep({ key: "arrival", label: "到货" });

    let currentStatus = "到货";
    let activeIndex = arrivalIndex;
    let reorderExperimentSteps = null;

    if (activeExperiment) {
      const pushExperimentStep = (experiment, index) => {
        const state = normalizeText(experiment?.state);
        if (state === "partial" && normalizeText(experiment?.routeStatus)) {
          return pushStep({
            key: `experiment-partial-${index}`,
            label: normalizeText(experiment.routeStatus),
            reached: true,
            time: stepTimeMap.get(experiment.routeStatus) || normalizeText(experiment?.partialTime) || "",
          });
        }
        const labelState = state === "current" && experiment?.unstarted ? "pending" : state;
        const label = experimentStatusLabel(experiment, index, labelState);
        const identityLabel = experimentIdentityStatusLabel(experiment, index, labelState);
        const codeLabel = experimentCodeStatusLabel(experiment, labelState);
        return pushStep({
          key: `experiment-${state || "pending"}-${index}`,
          label,
          reached: state === "completed",
          time: stepTimeMap.get(label) || stepTimeMap.get(identityLabel) || stepTimeMap.get(codeLabel) || "",
        });
      };
      const completedStepIndexes = [];
      const completedAppearanceIndexes = [];
      const currentLifecycleStatus = normalizeLifecycleStatus(effectiveInput.location, effectiveInput.status);
      const hasActualAppearanceMilestone =
        [APPEARANCE_STOCKED_STATUS, APPEARANCE_PRE_EXPERIMENT_STOCKED_STATUS].includes(currentLifecycleStatus)
        || Boolean(stepTimeMap.get(APPEARANCE_STOCKED_STATUS));
      const currentLifecycleCanUsePartialProgressFloor =
        ["送至实验室", "已到达实验室", "工装夹具安装", "实验准备就绪", "实验进行中", "实验中"].includes(currentLifecycleStatus);
      const completedExperimentTimesBeforeCurrent = experimentsBeforeCurrent.map((experiment, index) =>
        normalizeText(experiment?.state) === "partial"
          ? (
              currentLifecycleCanUsePartialProgressFloor
                ? parseTimeValue(stepTimeMap.get(normalizeText(experiment?.routeStatus)))
                : 0
            )
          : completedExperimentTime(experiment, index),
      );
      experimentsBeforeCurrent.forEach((experiment, index) => {
        completedStepIndexes.push(pushExperimentStep(experiment, index));
        const completedTime = completedExperimentTimesBeforeCurrent[index] || 0;
        const nextCompletedTime = completedExperimentTimesBeforeCurrent
          .slice(index + 1)
          .find((time) => time > completedTime) || 0;
        const appearanceTime = routeStepTimeAfter(APPEARANCE_STOCKED_STATUS, completedTime, nextCompletedTime);
        const currentAppearanceStatusBelongsToLatestCompleted =
          hasActualAppearanceMilestone
          && !appearanceTime
          && index === experimentsBeforeCurrent.length - 1
          && currentLifecycleStatus === APPEARANCE_STOCKED_STATUS;
        if (
          experimentRequiresAppearanceInspection(experiment)
          && (appearanceTime || currentAppearanceStatusBelongsToLatestCompleted)
        ) {
          completedAppearanceIndexes.push({
            stocked: pushStep({
              key: `route-completed-appearance-stocked-${index}`,
              label: APPEARANCE_STOCKED_STATUS,
              time: appearanceTime,
            }),
          });
        }
      });
      const latestCompletedTimeBeforeCurrent = completedExperimentTimesBeforeCurrent.reduce(
        (latest, time) => Math.max(latest, time),
        0,
      );
      const explicitRouteStatus = normalizeText(activeExperiment?.routeStatus);
      const lifecycleRouteStatus = normalizeLifecycleStatus(effectiveInput.location, effectiveInput.status);
      let normalizedRouteStatus = explicitRouteStatus
        ? isAxisPartialProgressStatus(explicitRouteStatus)
          ? explicitRouteStatus
          : normalizeLifecycleStatus(effectiveInput.location, explicitRouteStatus)
        : activeExperiment?.unstarted && !lifecycleRouteStatus
          ? ""
          : lifecycleRouteStatus;
      const partialAxisStatus = isAxisPartialProgressStatus(normalizedRouteStatus)
        ? normalizedRouteStatus
        : "";
      if (normalizedRouteStatus === APPEARANCE_SENT_STATUS_LABEL) {
        normalizedRouteStatus = completedStepIndexes.length > 0 ? "实验已完成" : "";
      }
      const shouldShowPartialAxisStaging =
        Boolean(partialAxisStatus)
        && isAmbiguousStagingStatus(currentLifecycleStatus)
        && !isPostRetentionLocation(effectiveInput.location);
      const partialAxisFollowUpStatus =
        partialAxisStatus
        && !shouldShowPartialAxisStaging
        && currentLifecycleStatus
        && !PARTIAL_AXIS_STABLE_CURRENT_STATUSES.has(currentLifecycleStatus)
          ? currentLifecycleStatus
          : "";
      if (partialAxisFollowUpStatus) {
        normalizedRouteStatus = partialAxisFollowUpStatus;
      }
      const shouldPlaceAppearanceBeforeLab =
        normalizedRouteStatus === APPEARANCE_PRE_EXPERIMENT_STOCKED_STATUS;
      if (shouldPlaceAppearanceBeforeLab) {
        normalizedRouteStatus = APPEARANCE_PRE_EXPERIMENT_STOCKED_STATUS;
      }
      const isPreExperimentAppearanceStatus =
        shouldPlaceAppearanceBeforeLab;
      const isPostCompletionAppearanceStatus =
        isAppearanceInspectionStatus(normalizedRouteStatus) && !isPreExperimentAppearanceStatus;
      const baseRouteSteps = Array.isArray(activeExperiment?.routeSteps) && activeExperiment.routeSteps.length > 0
        ? activeExperiment.routeSteps.filter(Boolean)
        : buildExperimentRouteSteps();
      const routeSteps = shouldPlaceAppearanceBeforeLab
        ? baseRouteSteps.flatMap((label) =>
          label === "已到达暂存间"
            ? [label, APPEARANCE_PRE_EXPERIMENT_STOCKED_STATUS]
            : [label],
        )
        : baseRouteSteps;
      const inputCurrentExperimentCode = normalizeText(effectiveInput.currentExperimentCode);
      const shouldKeepPreferredCurrentDispatch =
        Boolean(effectiveInput.preferCurrentExperimentCode)
        && inputCurrentExperimentCode
        && inputCurrentExperimentCode === normalizeText(activeExperiment?.code);
      if (
        normalizedRouteStatus === "送至实验室"
        && completedStepIndexes.length > 0
        && latestCompletedTimeBeforeCurrent > 0
        && hasCompletedExperimentBeforeActiveInOriginalOrder
        && !shouldKeepPreferredCurrentDispatch
        && !routeStepTimeAfter(normalizedRouteStatus, latestCompletedTimeBeforeCurrent)
      ) {
        normalizedRouteStatus = "实验已完成";
      }
      const routeStatusIndex = routeSteps.findIndex((label) => label === normalizedRouteStatus);
      const suppressRouteDestinationLab = Boolean(activeExperiment?.suppressDestinationLab);
      const shouldUseExperimentDestinationLab =
        !suppressRouteDestinationLab
        && (
          activeExperiment?.useExperimentDestinationLab
          || (
          activeExperiment?.unstarted
          && (normalizedRouteStatus === "实验已完成" || normalizedRouteStatus === "实验完成")
          )
        );
      const dispatchTargetLab = normalizeText(effectiveInput.dispatchTargetLab);
      const activeExperimentDestinationLab = suppressRouteDestinationLab ? "" : normalizeText(activeExperiment?.destinationLab);
      const dispatchTargetMatchesCompletedExperiment = completedExperiments.some(
        (experiment) => normalizeText(experiment?.destinationLab) === dispatchTargetLab,
      );
      const currentLabDestination = shouldUseExperimentDestinationLab
        ? activeExperimentDestinationLab || dispatchTargetLab
        : suppressRouteDestinationLab
          ? ""
          : inputCurrentExperimentCode
          && inputCurrentExperimentCode === normalizeText(activeExperiment?.code)
          && dispatchTargetMatchesCompletedExperiment
          ? activeExperimentDestinationLab || dispatchTargetLab
          : dispatchTargetLab || activeExperimentDestinationLab;
      const partialAxisIndex = partialAxisStatus
        ? pushStep({
            key: `experiment-partial-axis-${currentExperimentIndex}`,
            label: partialAxisStatus,
            reached: Boolean(
              isAxisPartialProgressStatus(effectiveInput.status)
              || partialAxisFollowUpStatus
              || shouldShowPartialAxisStaging,
            ),
          })
        : -1;
      const routeIndexes = routeSteps.map((label, index) =>
        pushStep({
          key: `route-${currentExperimentIndex}-${index}`,
          label,
          displayLabel: label === "送至实验室" ? buildLabDispatchStepLabel(currentLabDestination) : label,
          timeLabel: label,
          time: routeStepTimeAfter(label, latestCompletedTimeBeforeCurrent, 0, label === "送至实验室"
            ? [buildLabDispatchStepLabel(currentLabDestination)]
            : []),
        }),
      );
      const experimentName = experimentDisplayName(activeExperiment, currentExperimentIndex);
      const experimentIdentityNameText = experimentIdentityName(activeExperiment, currentExperimentIndex);
      const currentExperimentLabel = `${experimentName}${activeExperiment?.unstarted ? EXPERIMENT_FLOW_STATUS_LABELS.pending : EXPERIMENT_FLOW_STATUS_LABELS.running}`;
      const currentExperimentIdentityLabel = `${experimentIdentityNameText}${activeExperiment?.unstarted ? EXPERIMENT_FLOW_STATUS_LABELS.pending : EXPERIMENT_FLOW_STATUS_LABELS.running}`;
      const currentExperimentCodeLabel = experimentCodeStatusLabel(activeExperiment, activeExperiment?.unstarted ? "pending" : "running");
      const currentExperimentIndexInSteps = pushStep({
        key: `experiment-current-${currentExperimentIndex}`,
        label: currentExperimentLabel,
        time: stepTimeMap.get(currentExperimentLabel) || stepTimeMap.get(currentExperimentIdentityLabel) || stepTimeMap.get(currentExperimentCodeLabel) || "",
      });
      const partialAxisStagingRouteIndex = shouldShowPartialAxisStaging
        ? routeSteps.findIndex((label) => label === "已到达暂存间")
        : -1;
      const activeExperimentCanOwnCompletedRoute =
        !activeExperiment?.unstarted || inputCurrentExperimentCode === normalizeText(activeExperiment?.code);
      const shouldShowActiveAppearance =
        isPostCompletionAppearanceStatus
        && !activeExperiment?.unstarted
        && activeExperimentCanOwnCompletedRoute;
      const activeAppearanceIndexes = shouldShowActiveAppearance
        ? {
            stocked: pushStep({ key: `route-appearance-stocked-${currentExperimentIndex}`, label: APPEARANCE_STOCKED_STATUS }),
          }
        : null;
      const stableAppearanceIndexes =
        isPostCompletionAppearanceStatus
        && !completedAppearanceIndexes.at(-1)
        && !activeAppearanceIndexes
          ? {
              stocked: pushStep({ key: `route-stable-appearance-stocked-${currentExperimentIndex}`, label: APPEARANCE_STOCKED_STATUS }),
            }
          : null;

      const experimentsAfterCurrentIndexes = [];
      experimentsAfterCurrent.forEach((experiment, index) => {
        experimentsAfterCurrentIndexes.push(pushExperimentStep(experiment, index + experimentsBeforeCurrent.length + 1));
      });
      const shouldShowPostTestStagingSent =
        !POST_EXPERIMENT_STAGING_SENT_IS_REGULAR_STAGING_STATUS
        && (
          normalizedRouteStatus === POST_EXPERIMENT_STAGING_SENT_STATUS
          || Boolean(stepTimeMap.get(POST_EXPERIMENT_STAGING_SENT_STATUS))
        );
      const postTestStagingSentIndex = shouldShowPostTestStagingSent
        ? pushStep({
            key: `route-post-staging-sent-${currentExperimentIndex}`,
            label: POST_EXPERIMENT_STAGING_SENT_STATUS,
          })
        : -1;
      const shouldShowPostTestStagingStocked =
        normalizedRouteStatus === POST_EXPERIMENT_STAGING_STOCKED_STATUS;
      const postTestStagingIndex = shouldShowPostTestStagingStocked
        ? pushStep({
            key: `route-post-staging-stocked-${currentExperimentIndex}`,
            label: POST_EXPERIMENT_STAGING_STOCKED_STATUS,
          })
        : -1;
      const pendingAxisContinuationIndexes = [];
      const pendingAxisContinuationLabels = new Set();
      experimentFlow.forEach((experiment, index) => {
        const status = normalizeText(experiment?.routeStatus);
        const label = buildPendingAxisContinuationLabel(status);
        if (!label || pendingAxisContinuationLabels.has(label)) {
          return;
        }
        pendingAxisContinuationLabels.add(label);
        pendingAxisContinuationIndexes.push(pushStep({
          key: `axis-continuation-${index}`,
          label,
        }));
      });
      const returnedIndex = pushStep({
        key: `route-returned-${currentExperimentIndex}`,
        label: "厂家收回",
      });
      const latestCompletedAppearanceIndexes = completedAppearanceIndexes.at(-1) || null;
      const latestCompletedAppearancePosition = completedAppearanceIndexes.length - 1;
      const latestCompletedExperimentBeforeCurrent = experimentsBeforeCurrent.at(-1) || null;
      const latestCompletedExperimentRequiresAppearance = experimentRequiresAppearanceInspection(latestCompletedExperimentBeforeCurrent);
      const markCompletedAppearanceReached = (untilPosition = completedAppearanceIndexes.length) => {
        completedAppearanceIndexes.slice(0, Math.max(0, untilPosition)).forEach((indexes) => {
          if (!suppressInferredAppearanceReached || normalizeText(steps[indexes.stocked]?.time)) {
            steps[indexes.stocked].reached = true;
          }
        });
      };
      const markPostTestStagingSentReached = () => {
        if (postTestStagingSentIndex >= 0) {
          steps[postTestStagingSentIndex].reached = true;
        }
      };
      const markPostTestStagingStockedReached = () => {
        if (postTestStagingIndex >= 0) {
          steps[postTestStagingIndex].reached = true;
        }
      };

      if (
        isPostCompletionAppearanceStatus
        && completedStepIndexes.at(-1) !== undefined
        && !latestCompletedExperimentRequiresAppearance
      ) {
        const latestCompletedIndex = completedStepIndexes.at(-1);
        currentStatus = steps[latestCompletedIndex].label;
        activeIndex = latestCompletedIndex;
        completedStepIndexes.forEach((stepIndex) => {
          steps[stepIndex].reached = true;
        });
        markCompletedAppearanceReached();
      } else if (
        normalizedRouteStatus === APPEARANCE_STOCKED_STATUS
        && latestCompletedAppearanceIndexes
        && latestCompletedExperimentRequiresAppearance
      ) {
        currentStatus = normalizedRouteStatus;
        activeIndex = latestCompletedAppearanceIndexes.stocked;
        completedStepIndexes.forEach((stepIndex) => {
          steps[stepIndex].reached = true;
        });
        markCompletedAppearanceReached(latestCompletedAppearancePosition);
      } else if (normalizedRouteStatus === APPEARANCE_STOCKED_STATUS && stableAppearanceIndexes) {
        currentStatus = normalizedRouteStatus;
        activeIndex = stableAppearanceIndexes.stocked;
        completedStepIndexes.forEach((stepIndex) => {
          steps[stepIndex].reached = true;
        });
        markCompletedAppearanceReached();
      } else if (routeStatusIndex >= 0) {
        currentStatus = normalizedRouteStatus;
        activeIndex = routeIndexes[routeStatusIndex];
        if (partialAxisIndex >= 0) {
          steps[partialAxisIndex].reached = true;
        }
        markCompletedAppearanceReached();
        routeIndexes.forEach((stepIndex, index) => {
          if (index < routeStatusIndex) {
            steps[stepIndex].reached = true;
          }
        });
      } else if (activeExperiment?.unstarted && !normalizedRouteStatus) {
        currentStatus = currentExperimentLabel;
        activeIndex = currentExperimentIndexInSteps;
      } else if (isAxisPartialProgressStatus(normalizedRouteStatus)) {
        currentStatus = normalizedRouteStatus;
        activeIndex = partialAxisIndex >= 0 ? partialAxisIndex : currentExperimentIndexInSteps;
        markCompletedAppearanceReached();
        routeIndexes.forEach((stepIndex) => {
          steps[stepIndex].reached = true;
        });
        steps[currentExperimentIndexInSteps].reached = true;
        if (shouldShowPartialAxisStaging) {
          currentStatus = "已到达暂存间";
          activeIndex = partialAxisStagingRouteIndex >= 0
            ? routeIndexes[partialAxisStagingRouteIndex]
            : activeIndex;
          if (partialAxisIndex >= 0) {
            steps[partialAxisIndex].reached = true;
          }
          routeIndexes.forEach((stepIndex, index) => {
            if (index < partialAxisStagingRouteIndex) {
              steps[stepIndex].reached = true;
            }
          });
        }
      } else if (normalizedRouteStatus === "实验进行中" || normalizedRouteStatus === "实验中") {
        currentStatus = `${experimentName}${EXPERIMENT_FLOW_STATUS_LABELS.running}`;
        activeIndex = currentExperimentIndexInSteps;
        if (partialAxisIndex >= 0) {
          steps[partialAxisIndex].reached = true;
        }
        markCompletedAppearanceReached();
        routeIndexes.forEach((stepIndex) => {
          steps[stepIndex].reached = true;
        });
      } else if (normalizedRouteStatus === "实验已完成" || normalizedRouteStatus === "实验完成") {
        const latestCompletedIndex = completedStepIndexes.at(-1);
        markCompletedAppearanceReached();
        if (activeExperiment?.explicitCompletedCurrent && activeExperimentCanOwnCompletedRoute && !activeExperiment?.unstarted) {
          const completedLabel = `${experimentName}${EXPERIMENT_FLOW_STATUS_LABELS.completed}`;
          const completedIdentityLabel = `${experimentIdentityNameText}${EXPERIMENT_FLOW_STATUS_LABELS.completed}`;
          const completedCodeLabel = experimentCodeStatusLabel(activeExperiment, "completed");
          completedStepIndexes.forEach((stepIndex) => {
            steps[stepIndex].reached = true;
          });
          steps[currentExperimentIndexInSteps].label = completedLabel;
          steps[currentExperimentIndexInSteps].time =
            steps[currentExperimentIndexInSteps].time
            || stepTimeMap.get(completedLabel)
            || stepTimeMap.get(completedIdentityLabel)
            || stepTimeMap.get(completedCodeLabel)
            || "";
          currentStatus = completedLabel;
          activeIndex = currentExperimentIndexInSteps;
          routeIndexes.forEach((stepIndex) => {
            steps[stepIndex].reached = true;
          });
        } else if (latestCompletedIndex !== undefined) {
          currentStatus = steps[latestCompletedIndex].label;
          activeIndex = latestCompletedIndex;
        } else {
          const completedLabel = `${experimentName}${EXPERIMENT_FLOW_STATUS_LABELS.completed}`;
          const completedIdentityLabel = `${experimentIdentityNameText}${EXPERIMENT_FLOW_STATUS_LABELS.completed}`;
          const completedCodeLabel = experimentCodeStatusLabel(activeExperiment, "completed");
          steps[currentExperimentIndexInSteps].label = completedLabel;
          steps[currentExperimentIndexInSteps].time =
            steps[currentExperimentIndexInSteps].time
            || stepTimeMap.get(completedLabel)
            || stepTimeMap.get(completedIdentityLabel)
            || stepTimeMap.get(completedCodeLabel)
            || "";
          currentStatus = completedLabel;
          activeIndex = currentExperimentIndexInSteps;
          routeIndexes.forEach((stepIndex) => {
            steps[stepIndex].reached = true;
          });
        }
      } else if (
        !POST_EXPERIMENT_STAGING_SENT_IS_REGULAR_STAGING_STATUS
        && normalizedRouteStatus === POST_EXPERIMENT_STAGING_SENT_STATUS
      ) {
        currentStatus = normalizedRouteStatus;
        activeIndex = postTestStagingSentIndex;
        markCompletedAppearanceReached();
        routeIndexes.forEach((stepIndex) => {
          steps[stepIndex].reached = true;
        });
        steps[currentExperimentIndexInSteps].reached = true;
      } else if (normalizedRouteStatus === POST_EXPERIMENT_STAGING_STOCKED_STATUS) {
        currentStatus = normalizedRouteStatus;
        activeIndex = postTestStagingIndex;
        markCompletedAppearanceReached();
        routeIndexes.forEach((stepIndex) => {
          steps[stepIndex].reached = true;
        });
        steps[currentExperimentIndexInSteps].reached = true;
        markPostTestStagingSentReached();
      } else if (normalizedRouteStatus === APPEARANCE_STOCKED_STATUS && activeAppearanceIndexes) {
        currentStatus = normalizedRouteStatus;
        activeIndex = activeAppearanceIndexes.stocked;
        routeIndexes.forEach((stepIndex) => {
          steps[stepIndex].reached = true;
        });
        steps[currentExperimentIndexInSteps].reached = true;
        markCompletedAppearanceReached();
      } else if (normalizedRouteStatus === "厂家收回") {
        currentStatus = normalizedRouteStatus;
        activeIndex = returnedIndex;
        markCompletedAppearanceReached();
        if (activeExperiment?.unstarted) {
          routeIndexes.forEach((stepIndex, index) => {
            if (index <= 1) {
              steps[stepIndex].reached = true;
            }
          });
        } else {
          routeIndexes.forEach((stepIndex) => {
            steps[stepIndex].reached = true;
          });
          steps[currentExperimentIndexInSteps].reached = true;
          markPostTestStagingSentReached();
          markPostTestStagingStockedReached();
        }
      } else if (normalizedRouteStatus === "样品运输中") {
        currentStatus = normalizedRouteStatus;
        activeIndex = transportIndex;
      } else {
        currentStatus = normalizedRouteStatus || "到货";
        activeIndex = arrivalIndex;
      }
      if (partialAxisIndex >= 0) {
        reorderExperimentSteps = () => {
          const partialTime = parseTimeValue(steps[partialAxisIndex]?.time);
          const postPartialStagingIndexes = new Set();
          const routeOrderMap = new Map(routeIndexes.map((stepIndex, index) => [stepIndex, index]));
          const afterCurrentExperimentOrderMap = new Map(
            experimentsAfterCurrentIndexes.map((stepIndex, index) => [stepIndex, index]),
          );
          const shouldTreatStagingAsPostPartial =
            ["送至暂存间", "已到达暂存间", "厂家收回"].includes(currentLifecycleStatus)
            || routeIndexes.some((stepIndex, index) =>
              ["送至暂存间", "已到达暂存间"].includes(routeSteps[index])
              && partialTime > 0
              && parseTimeValue(steps[stepIndex]?.time) > partialTime,
            );
          if (shouldTreatStagingAsPostPartial) {
            routeIndexes.forEach((stepIndex, index) => {
              if (["送至暂存间", "已到达暂存间"].includes(routeSteps[index])) {
                postPartialStagingIndexes.add(stepIndex);
              }
            });
          }
          const rankStep = (step, index) => {
            if (index === partialAxisIndex) {
              return 6000;
            }
            if (index === currentExperimentIndexInSteps) {
              return 5000;
            }
            if (postPartialStagingIndexes.has(index)) {
              return 7000 + (routeOrderMap.get(index) ?? 0);
            }
            if (afterCurrentExperimentOrderMap.has(index)) {
              return 8000 + (afterCurrentExperimentOrderMap.get(index) ?? 0);
            }
            if (pendingAxisContinuationIndexes.includes(index)) {
              return 8500 + pendingAxisContinuationIndexes.indexOf(index);
            }
            if (index === returnedIndex) {
              return 9000;
            }
            if (routeOrderMap.has(index)) {
              return 4000 + (routeOrderMap.get(index) ?? 0);
            }
            return index;
          };
          steps.sort((left, right) => {
            const leftIndex = Number(left?.__flowOrderIndex);
            const rightIndex = Number(right?.__flowOrderIndex);
            return rankStep(left, leftIndex) - rankStep(right, rightIndex);
          });
          steps.forEach((step) => {
            delete step.__flowOrderIndex;
          });
        };
        steps.forEach((step, index) => {
          step.__flowOrderIndex = index;
        });
      }
    } else {
      const foldedExperimentResults = experimentFlow.filter((experiment) =>
        ["completed", "partial"].includes(normalizeText(experiment?.state)),
      );
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
        const postExperimentStagingTime = routeStepTimeAfter(
          POST_EXPERIMENT_STAGING_STOCKED_STATUS,
          latestExperimentResultTime,
        );
        const hasPostExperimentStaging = Boolean(postExperimentStagingTime)
          || normalizedFinalStatus === POST_EXPERIMENT_STAGING_STOCKED_STATUS;
        const finalStatusIsStagingStocked =
          normalizedFinalStatus === POST_EXPERIMENT_STAGING_STOCKED_STATUS
          || (!hasPostExperimentStaging && normalizedFinalStatus === "已到达暂存间");
        const postTestStagingSentIndex = hasPostExperimentStaging
          ? -1
          : pushStep({
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
        const foldedCompletedExperimentCodes = new Set(
          foldedExperimentResults
            .filter((experiment) => normalizeText(experiment?.state) === "completed")
            .map((experiment) => normalizeText(experiment?.code))
            .filter(Boolean),
        );
        const pendingAxisContinuationLabels = new Set();
        foldedExperimentResults.forEach((experiment, index) => {
          if (
            normalizeText(experiment?.state) === "partial" &&
            foldedCompletedExperimentCodes.has(normalizeText(experiment?.code))
          ) {
            return;
          }
          const status = normalizeText(experiment?.routeStatus);
          const label = buildPendingAxisContinuationLabel(status);
          if (!label || pendingAxisContinuationLabels.has(label)) {
            return;
          }
          pendingAxisContinuationLabels.add(label);
          pushStep({
            key: `axis-folded-continuation-${index}`,
            label,
          });
        });
        const returnedIndex = pushStep({
          key: "route-folded-returned",
          label: "厂家收回",
          reached: false,
        });
        if (normalizedFinalStatus === "厂家收回") {
          activeIndex = returnedIndex;
          currentStatus = "厂家收回";
          resultIndexes.forEach((stepIndex) => {
            steps[stepIndex].reached = true;
          });
          if (postTestStagingSentIndex >= 0) {
            steps[postTestStagingSentIndex].reached = true;
          }
          steps[postTestStagingIndex].reached = true;
        } else if (finalStatusIsStagingStocked) {
          activeIndex = postTestStagingIndex;
          currentStatus = "已到达暂存间";
          resultIndexes.forEach((stepIndex) => {
            steps[stepIndex].reached = true;
          });
        } else {
          activeIndex = resultIndexes.at(-1) ?? arrivalIndex;
          currentStatus = normalizeText(steps[activeIndex]?.label) || "到货";
        }
      } else {
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
          time: routeStepTimeAfter(label, latestCompletedTimeBeforeFinal, finalCompletedTime, label === "送至实验室"
            ? [buildLabDispatchStepLabel(finalLabDestination)]
            : []),
        });
      });
      const completedIndex = pushStep({
        key: "experiment-final-completed",
        label: completedLabel,
        time: stepTimeMap.get(completedLabel) || stepTimeMap.get(completedIdentityLabel) || stepTimeMap.get(completedCodeLabel) || "",
      });
      const normalizedFinalStatus = normalizeLifecycleStatus(effectiveInput.location, effectiveInput.status);
      const shouldShowFinalAppearance =
        experimentRequiresAppearanceInspection(lastExperiment)
        && (
          normalizedFinalStatus === APPEARANCE_STOCKED_STATUS
          || Boolean(stepTimeMap.get(APPEARANCE_STOCKED_STATUS))
        );
      const finalAppearanceIndexes = shouldShowFinalAppearance
        ? {
            stocked: pushStep({ key: "route-final-appearance-stocked", label: APPEARANCE_STOCKED_STATUS }),
          }
        : null;
      const shouldShowPostTestStagingSent =
        !POST_EXPERIMENT_STAGING_SENT_IS_REGULAR_STAGING_STATUS
        && (
          normalizedFinalStatus === POST_EXPERIMENT_STAGING_SENT_STATUS
          || Boolean(stepTimeMap.get(POST_EXPERIMENT_STAGING_SENT_STATUS))
        );
      const postTestStagingSentIndex = shouldShowPostTestStagingSent
        ? pushStep({
            key: "route-final-post-staging-sent",
            label: POST_EXPERIMENT_STAGING_SENT_STATUS,
          })
        : -1;
      const shouldShowPostTestStagingStocked =
        normalizedFinalStatus === POST_EXPERIMENT_STAGING_STOCKED_STATUS
        || Boolean(stepTimeMap.get(POST_EXPERIMENT_STAGING_STOCKED_STATUS));
      const postTestStagingIndex = shouldShowPostTestStagingStocked
        ? pushStep({
            key: "route-final-post-staging-stocked",
            label: POST_EXPERIMENT_STAGING_STOCKED_STATUS,
          })
        : -1;
      const returnedIndex = pushStep({
        key: "route-final-returned",
        label: "厂家收回",
      });
      if (
        !POST_EXPERIMENT_STAGING_SENT_IS_REGULAR_STAGING_STATUS
        && normalizedFinalStatus === POST_EXPERIMENT_STAGING_SENT_STATUS
      ) {
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
      }
    }

    steps[transportIndex].active = activeIndex === transportIndex;
    steps[transportIndex].reached = activeIndex !== transportIndex;
    steps[arrivalIndex].active = activeIndex === arrivalIndex;
    steps[arrivalIndex].reached = activeIndex !== arrivalIndex && activeIndex !== transportIndex;
    if (steps[activeIndex]) {
      steps[activeIndex].active = true;
    }
    if (typeof reorderExperimentSteps === "function") {
      reorderExperimentSteps();
    }
    hidePendingFlowStepTimes(steps);
    const displayCurrentStatus = normalizeText(steps.find((step) => step.active)?.label) || currentStatus;

    return {
      canonicalStatus: currentStatus,
      trayCode,
      status: displayCurrentStatus,
      currentStatus: trayCode ? `当前托盘：${trayCode} | 当前状态：${displayCurrentStatus}` : `当前状态：${displayCurrentStatus}`,
      steps,
    };
  }

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
  const statusIsPostExperimentStaging =
    status === POST_EXPERIMENT_STAGING_SENT_STATUS
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
  const singleExperimentCompleted =
    singleExperimentEventStatus === "实验已完成" || singleExperimentRuntimeLifecycleStatus === "实验已完成";
  const isPreExperimentAppearanceStatus = status === APPEARANCE_PRE_EXPERIMENT_STOCKED_STATUS;
  const shouldPlaceSingleAppearanceBeforeLab =
    isPreExperimentAppearanceStatus;
  const shouldShowSingleAppearance =
    status === APPEARANCE_STOCKED_STATUS
    || status === APPEARANCE_PRE_EXPERIMENT_STOCKED_STATUS;
  const baseSingleFlowSteps = shouldPlaceSingleAppearanceBeforeLab
    ? SAMPLE_FLOW_STEPS.flatMap((step) =>
        step.key === "arrived_staging"
          ? [
              step,
              {
                key: "pre_experiment_appearance_storage",
                label: APPEARANCE_PRE_EXPERIMENT_STOCKED_STATUS,
              },
            ]
          : [step],
      )
    : shouldShowSingleAppearance
    ? SAMPLE_FLOW_STEPS.flatMap((step) =>
        step.key === "completed"
          ? [
              step,
              { key: "appearance_storage", label: APPEARANCE_STOCKED_STATUS },
            ]
          : [step],
      )
    : SAMPLE_FLOW_STEPS;
  const shouldShowSinglePostTestStagingSent =
    !POST_EXPERIMENT_STAGING_SENT_IS_REGULAR_STAGING_STATUS
    && (
      status === POST_EXPERIMENT_STAGING_SENT_STATUS
      || Boolean(stepTimeMap.get(POST_EXPERIMENT_STAGING_SENT_STATUS))
    );
  const singleFlowSteps = shouldShowSinglePostTestStagingSent
    ? baseSingleFlowSteps.flatMap((step) =>
        step.key === "post_test_staging"
          ? [
              { key: "post_test_staging_sent", label: POST_EXPERIMENT_STAGING_SENT_STATUS },
              step,
            ]
          : [step],
      )
    : baseSingleFlowSteps;
  const currentStepIndex = singleFlowSteps.findIndex((step) => step.label === status);
  const currentKey = currentStepIndex >= 0 ? singleFlowSteps[currentStepIndex].key : FLOW_STEP_KEY_BY_LABEL.get(status) || SAMPLE_FLOW_STEPS[0].key;
  const currentIndex = currentStepIndex >= 0 ? currentStepIndex : Math.max(0, singleFlowSteps.findIndex((step) => step.key === currentKey));
  const singleExperimentName = normalizeText(singleExperiment?.displayName || singleExperiment?.name);
  const singleExperimentIdentityName = normalizeText(singleExperiment?.name);
  const singleExperimentDestinationLab = normalizeText(effectiveInput.dispatchTargetLab) || normalizeText(singleExperiment?.destinationLab);
  const displayStatus = buildSingleExperimentStatusLabel(singleExperimentName, status);
  const holdUncompletedSingleExperiment =
    status === "厂家收回" && Boolean(singleExperimentName) && !singleExperimentCompleted;
  const preExperimentReturnedReachedIndex = FLOW_STEP_INDEX_BY_KEY.get("arrived_staging") ?? 3;

  const steps = singleFlowSteps.map((step, index) => {
      const label = buildSingleExperimentStatusLabel(singleExperimentName, step.label);
      const identityLabel = buildSingleExperimentStatusLabel(singleExperimentIdentityName || singleExperimentName, step.label);
      const displayLabel = step.key === "sent_to_lab" ? buildLabDispatchStepLabel(singleExperimentDestinationLab) : label;
      const active = step.key === currentKey;
      const reached = holdUncompletedSingleExperiment ? index <= preExperimentReturnedReachedIndex : index < currentIndex;
      const stepTimeLabel = step.label === APPEARANCE_PRE_EXPERIMENT_STOCKED_STATUS ? APPEARANCE_STOCKED_STATUS : step.label;
      const time = active || reached ? stepTimeMap.get(label) || stepTimeMap.get(identityLabel) || stepTimeMap.get(stepTimeLabel) || "" : "";
      return {
        ...step,
        label: displayLabel,
        time,
        active,
        reached,
      };
    });
  const displayCurrentStatus =
    normalizeText(steps.find((step) => step.active)?.label) || displayStatus;

  return {
    canonicalStatus: displayStatus,
    trayCode,
    status: displayCurrentStatus,
    currentStatus: trayCode ? `当前托盘：${trayCode} | 当前状态：${displayCurrentStatus}` : `当前状态：${displayCurrentStatus}`,
    steps,
  };
}

export {
  buildTrayFlowView,
};
