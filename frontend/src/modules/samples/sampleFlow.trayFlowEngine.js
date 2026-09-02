import {
  APPEARANCE_PRE_EXPERIMENT_STOCKED_STATUS,
  APPEARANCE_STOCKED_STATUS,
  EXPERIMENT_FLOW_STATUS_LABELS,
  POST_EXPERIMENT_STAGING_SENT_STATUS,
  POST_EXPERIMENT_STAGING_STOCKED_STATUS,
} from "./sampleFlow.constants";
import { normalizeText } from "./sampleFlow.shared";
import { firstNonEmptyArray, parseTimeValue } from "./sampleFlow.trayScope";
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
import { hidePendingFlowStepTimes } from "./sampleFlow.flowTimeHelpers";
import { resolveEffectiveTrayLifecycleStatus } from "./sampleFlow.trayLifecycle";
import { isAxisPartialProgressStatus } from "@/modules/experiment-progress/axisProgress";
import { resolveSaltSprayPauseRemark } from "@/lib/saltSprayPauseDisplay";
import { buildTrayFlowTimeMap } from "./sampleFlow.flowTimeMap";
import {
  APPEARANCE_SENT_STATUS_LABEL,
  PARTIAL_AXIS_STABLE_CURRENT_STATUSES,
  POST_EXPERIMENT_STAGING_SENT_IS_REGULAR_STAGING_STATUS,
  buildPendingAxisContinuationLabel,
  resolveLatestWithdrawalRestoreTarget,
} from "./sampleFlow.runtimeEvidence";
import { buildTrayExperimentFlow } from "./sampleFlow.trayExperimentFlow";
import { buildSingleExperimentTrayFlow } from "./sampleFlow.trayFlowSingle";
import { createTrayFlowStepTools } from "./sampleFlow.trayFlowStepHelpers";
import { buildCompletedTrayFlowState } from "./sampleFlow.trayFlowCompleted";

function buildTrayFlowEngine(input = {}) {
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
  const displayRemark = resolveSaltSprayPauseRemark({
    experimentRunPauses: input.experimentRunPauses || input.experiment_run_pauses,
    experimentRuns: input.experimentRuns || input.experiment_runs,
    experimentRunTrays: input.experimentRunTrays || input.experiment_run_trays,
    trayCode,
  });
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
    } = createTrayFlowStepTools(stepTimeMap, stepTimeHistoryMap);

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
      const completedState = buildCompletedTrayFlowState({
        arrivalIndex,
        completedExperiments,
        effectiveInput,
        experimentFlow,
        stepTimeMap,
        tools: {
          completedExperimentTime,
          experimentCodeStatusLabel,
          experimentDisplayName,
          experimentIdentityName,
          experimentIdentityStatusLabel,
          experimentStatusLabel,
          pushStep,
          routeStepTimeAfter,
          steps,
        },
      });
      activeIndex = completedState.activeIndex;
      currentStatus = completedState.currentStatus;
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
      displayRemark,
      trayCode,
      status: displayCurrentStatus,
      currentStatus: `${trayCode ? `当前托盘：${trayCode} | ` : ""}当前状态：${displayCurrentStatus}${displayRemark ? ` | 备注：${displayRemark}` : ""}`,
      steps,
    };
  }

  const singleFlow = buildSingleExperimentTrayFlow(input, { effectiveInput, stepTimeMap, trayCode });
  return {
    ...singleFlow,
    displayRemark,
    currentStatus: `${singleFlow.currentStatus}${displayRemark ? ` | 备注：${displayRemark}` : ""}`,
  };
}

export { buildTrayFlowEngine };
