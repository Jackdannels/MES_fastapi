import { RUNNING_EXPERIMENT_RUN_STATUSES } from "./sampleFlow.constants";
import { normalizeText } from "./sampleFlow.shared";
import { firstNonEmptyArray } from "./sampleFlow.trayScope";
import {
  isAppearanceInspectionStatus,
  normalizeLifecycleStatus,
} from "./sampleFlow.status";
import {
  buildExperimentRouteSteps,
  experimentRequiresAppearanceInspection,
  hasExperimentEnteredLabFlow,
} from "./sampleFlow.experimentHelpers";
import { buildOrderedTrayExperiments } from "./sampleFlow.experimentOrder";
import {
  resolveCompletedExperimentRuntime,
  resolveExperimentRunStatus,
} from "./sampleFlow.experimentRuns";
import { resolveEffectiveTrayLifecycleStatus } from "./sampleFlow.trayLifecycle";
import {
  chooseExperimentStatus,
  resolveExperimentEvent,
  resolveLatestExperimentEventMap,
} from "./sampleFlow.experimentEvents";
import { isAxisPartialProgressStatus } from "@/modules/experiment-progress/axisProgress";
import {
  PARTIAL_AXIS_STABLE_CURRENT_STATUSES,
  partialAxisStatusMatchesExperiment,
  resolveCurrentTrayStatusTime,
  resolveExperimentRuntimeCutoffMap,
  resolveExperimentRuntimeFlowEvent,
  resolveLatestWithdrawalRestoreTarget,
  resolveTrayDispatchTarget,
} from "./sampleFlow.runtimeEvidence";

const buildTrayExperimentFlow = (input = {}) => {
  const taskCode = normalizeText(input.taskCode);
  const trayCode = normalizeText(input.trayCode);
  const orderedExperiments = buildOrderedTrayExperiments({
    taskCode,
    trayCode,
    experiments: input.experiments,
    experimentTrays: input.experimentTrays,
    schedules: input.schedules,
  });
  const runtimeCutoffTimeByExperimentCode = resolveExperimentRuntimeCutoffMap({
    orderedExperiments,
    samples: input.samples,
    taskCode,
    trayCode,
  });
  const runtimeCutoffTimeForExperiment = (experiment) =>
    runtimeCutoffTimeByExperimentCode.get(normalizeText(experiment?.code)) || 0;
  const singleExperimentAxisRuntimeStatus = orderedExperiments.length === 1
    ? resolveExperimentRunStatus({
      experiment: orderedExperiments[0],
      experimentCode: orderedExperiments[0].code,
      experimentRuns: input.experimentRuns || input.experiment_runs,
      experimentRunSteps: firstNonEmptyArray(input.experimentRunSteps, input.experiment_run_steps),
      experimentRunTrays: firstNonEmptyArray(input.experimentRunTrays, input.experiment_run_trays),
      experiments: orderedExperiments,
      runtimeCutoffTime: runtimeCutoffTimeForExperiment(orderedExperiments[0]),
      schedules: input.schedules,
      taskCode,
      trayCode,
    })
    : "";
  if (orderedExperiments.length <= 1 && !isAxisPartialProgressStatus(singleExperimentAxisRuntimeStatus)) {
    return [];
  }

  const normalizedStatus = resolveEffectiveTrayLifecycleStatus(input) || normalizeLifecycleStatus(input.location, input.status);
  const normalizedStatusTime = resolveCurrentTrayStatusTime(input, normalizedStatus);
  const trayIsReturned = normalizedStatus === "厂家收回";
  const rawInputCurrentExperimentCode = normalizeText(input.currentExperimentCode);
  const inputCurrentExperimentCode =
    input.suppressGuessedDestinationLab && normalizeLifecycleStatus("", normalizedStatus) === "实验已完成"
      ? ""
      : rawInputCurrentExperimentCode;
  const dispatchTarget = resolveTrayDispatchTarget(input);
  const effectiveDispatchTarget =
    input.preferCurrentExperimentCode && inputCurrentExperimentCode
      ? {
          targetLab: normalizeText(input.dispatchTargetLab) || normalizeText(dispatchTarget.targetLab),
          targetExperimentCode: inputCurrentExperimentCode,
        }
      : dispatchTarget;
  const experimentEventMap = resolveLatestExperimentEventMap({
    taskCode,
    trayCode,
    samples: input.samples,
  });
  const targetLabExperimentCode = normalizeText(effectiveDispatchTarget.targetLab)
    ? normalizeText(
      orderedExperiments.find((experiment) => normalizeText(experiment.destinationLab) === normalizeText(effectiveDispatchTarget.targetLab))?.code,
    )
    : "";
  const dispatchTargetExperimentCode = normalizeText(effectiveDispatchTarget.targetExperimentCode);
  const trayTargetExperimentCode =
    dispatchTargetExperimentCode || targetLabExperimentCode;
  const trayTargetExperiment = trayTargetExperimentCode
    ? orderedExperiments.find((experiment) => experiment.code === trayTargetExperimentCode)
    : null;
  const trayTargetEventStatus = trayTargetExperiment
    ? normalizeLifecycleStatus("", normalizeText(resolveExperimentEvent(experimentEventMap, trayTargetExperiment)?.status))
    : "";
  const trayTargetRuntimeStatus = trayTargetExperiment
    ? resolveExperimentRunStatus({
        experiment: trayTargetExperiment,
        experimentCode: trayTargetExperiment.code,
        experimentRuns: input.experimentRuns || input.experiment_runs,
        experimentRunSteps: firstNonEmptyArray(input.experimentRunSteps, input.experiment_run_steps),
        experimentRunTrays: firstNonEmptyArray(input.experimentRunTrays, input.experiment_run_trays),
        experiments: orderedExperiments,
        runtimeCutoffTime: runtimeCutoffTimeForExperiment(trayTargetExperiment),
        schedules: input.schedules,
        taskCode,
        trayCode,
      })
    : "";
  const trayTargetAlreadyCompleted =
    normalizeLifecycleStatus("", trayTargetRuntimeStatus) === "实验已完成"
    || trayTargetEventStatus === "实验已完成";
  const explicitExperimentCode =
    trayTargetExperimentCode && !trayTargetAlreadyCompleted
      ? trayTargetExperimentCode
      : inputCurrentExperimentCode;
  const explicitFromInputCurrent =
    Boolean(inputCurrentExperimentCode) && inputCurrentExperimentCode === explicitExperimentCode;
  const explicitFromTrayTarget =
    Boolean(trayTargetExperimentCode)
    && explicitExperimentCode === trayTargetExperimentCode;
  const hasRunningRuntimeExperiment = !trayIsReturned && orderedExperiments.some((experiment) => {
    const runtimeStatus = resolveExperimentRuntimeFlowEvent({
      experiment,
      experimentRuns: input.experimentRuns || input.experiment_runs,
      experimentRunSteps: firstNonEmptyArray(input.experimentRunSteps, input.experiment_run_steps),
      experimentRunTrays: firstNonEmptyArray(input.experimentRunTrays, input.experiment_run_trays),
      experiments: orderedExperiments,
      runtimeCutoffTime: runtimeCutoffTimeForExperiment(experiment),
      schedules: input.schedules,
      taskCode,
      trayCode,
    })?.status || "";
    return RUNNING_EXPERIMENT_RUN_STATUSES.has(runtimeStatus) || isAxisPartialProgressStatus(runtimeStatus);
  });
  const explicitIndex = explicitExperimentCode
    ? orderedExperiments.findIndex((experiment) => experiment.code === explicitExperimentCode)
    : -1;
  const experimentRuntimeEventMap = new Map(
    orderedExperiments.map((experiment) => [
      experiment.code,
      resolveExperimentRuntimeFlowEvent({
        experiment,
        experimentRuns: input.experimentRuns || input.experiment_runs,
        experimentRunSteps: firstNonEmptyArray(input.experimentRunSteps, input.experiment_run_steps),
        experimentRunTrays: firstNonEmptyArray(input.experimentRunTrays, input.experiment_run_trays),
        experiments: orderedExperiments,
        runtimeCutoffTime: runtimeCutoffTimeForExperiment(experiment),
        schedules: input.schedules,
        taskCode,
        trayCode,
      }),
    ]),
  );
  const experimentStatusMap = new Map(
    orderedExperiments.map((experiment) => {
      const event = resolveExperimentEvent(experimentEventMap, experiment);
      const runtimeStatus = experimentRuntimeEventMap.get(experiment.code)?.status || "";
      const rawEventStatus = normalizeText(event?.status);
      const rawEventIsUnscopedRunning =
        RUNNING_EXPERIMENT_RUN_STATUSES.has(normalizeLifecycleStatus("", rawEventStatus))
        && event?.trayScoped !== true;
      const eventStatus =
        (trayIsReturned || rawEventIsUnscopedRunning)
          ? ""
          : rawEventStatus;
      const runtimeStatusForFlow =
        trayIsReturned
        && (
          RUNNING_EXPERIMENT_RUN_STATUSES.has(runtimeStatus)
          || runtimeStatus === "厂家收回"
        )
          ? ""
          : runtimeStatus;
      const normalizedStatusIsCompleted = normalizeLifecycleStatus("", normalizedStatus) === "实验已完成";
      const suppressInputCurrentFallback =
        hasRunningRuntimeExperiment && explicitFromInputCurrent && !explicitFromTrayTarget;
      const normalizedStatusIsRunning = RUNNING_EXPERIMENT_RUN_STATUSES.has(normalizeLifecycleStatus("", normalizedStatus));
      const hasTrayScopedRunningEvidence =
        RUNNING_EXPERIMENT_RUN_STATUSES.has(runtimeStatusForFlow)
        || (
          RUNNING_EXPERIMENT_RUN_STATUSES.has(normalizeLifecycleStatus("", rawEventStatus))
          && event?.trayScoped === true
        );
      const fallbackStatus =
        experiment.code === explicitExperimentCode
        && !suppressInputCurrentFallback
        && normalizedStatus !== "厂家收回"
        && !(normalizedStatusIsCompleted && !event)
        && (!isAxisPartialProgressStatus(normalizedStatus) || partialAxisStatusMatchesExperiment(normalizedStatus, experiment))
        && (!normalizedStatusIsRunning || hasTrayScopedRunningEvidence || explicitFromInputCurrent)
          ? normalizedStatus
          : "";
      const explicitRuntimeStatus =
        RUNNING_EXPERIMENT_RUN_STATUSES.has(runtimeStatusForFlow)
        || isAxisPartialProgressStatus(runtimeStatusForFlow)
        || experiment.code === explicitExperimentCode
        || !explicitExperimentCode
          ? runtimeStatusForFlow
          : "";
      return [experiment.code, chooseExperimentStatus({
        eventStatus,
        eventTime: event?.time,
        runtimeStatus: explicitRuntimeStatus,
        runtimeTime: experimentRuntimeEventMap.get(experiment.code)?.timeValue,
        fallbackStatus,
        fallbackTime: fallbackStatus ? normalizedStatusTime : 0,
        recordStatus: "",
      })];
    }),
  );
  const completedExperiments = orderedExperiments
    .map((experiment) => {
      const event = resolveExperimentEvent(experimentEventMap, experiment);
      const eventStatus = normalizeLifecycleStatus("", normalizeText(event?.status));
      const runtimeStatus = experimentRuntimeEventMap.get(experiment.code)?.status || "";
      if (isAxisPartialProgressStatus(runtimeStatus)) {
        return null;
      }
      const runtimeCompleted = resolveCompletedExperimentRuntime({
        experiment,
        experimentCode: experiment.code,
        experimentRuns: input.experimentRuns || input.experiment_runs,
        experimentRunSteps: firstNonEmptyArray(input.experimentRunSteps, input.experiment_run_steps),
        experimentRunTrays: firstNonEmptyArray(input.experimentRunTrays, input.experiment_run_trays),
        experiments: orderedExperiments,
        runtimeCutoffTime: runtimeCutoffTimeForExperiment(experiment),
        schedules: input.schedules,
        taskCode,
        trayCode,
      });
      if (eventStatus !== "实验已完成" && !runtimeCompleted) {
        return null;
      }
      return {
        code: experiment.code,
        name: experiment.name,
        displayName: experiment.displayName,
        experiment_name: experiment.experiment_name,
        experimentName: experiment.experimentName,
        experiment_type: experiment.experiment_type,
        experimentType: experiment.experimentType,
        test_type: experiment.test_type,
        testType: experiment.testType,
        required_device: experiment.required_device,
        requiredDevice: experiment.requiredDevice,
        destinationLab: experiment.destinationLab,
        aliases: experiment.aliases,
        state: "completed",
        completedAt: Math.max(Number(event?.time) || 0, Number(runtimeCompleted?.time) || 0),
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.completedAt - right.completedAt);
  const completedCodeSet = new Set(completedExperiments.map((experiment) => experiment.code));
  const unfinishedExperiments = orderedExperiments.filter((experiment) => !completedCodeSet.has(experiment.code));
  const normalizedStatusIsCompleted = normalizeLifecycleStatus("", normalizedStatus) === "实验已完成";
  const explicitCompletedExperiment =
    Boolean(input.preferCurrentExperimentCode)
    && explicitExperimentCode
    && explicitIndex >= 0
    && normalizedStatusIsCompleted
    && completedCodeSet.has(orderedExperiments[explicitIndex]?.code)
      ? orderedExperiments[explicitIndex]
      : null;
  const startedUnfinishedExperiments = unfinishedExperiments.filter((experiment) =>
    hasExperimentEnteredLabFlow(experimentStatusMap.get(experiment.code)),
  );
  const partialAxisExperiments = startedUnfinishedExperiments.filter((experiment) =>
    isAxisPartialProgressStatus(experimentStatusMap.get(experiment.code)),
  );
  const latestCompletedExperimentTime = completedExperiments.reduce(
    (latest, experiment) => Math.max(latest, Number(experiment?.completedAt) || 0),
    0,
  );
  const activePartialAxisExperiments = partialAxisExperiments.filter((experiment) => {
    if (!latestCompletedExperimentTime) {
      return true;
    }
    const partialAt = Number(experimentRuntimeEventMap.get(experiment.code)?.timeValue) || 0;
    if (!partialAt || partialAt >= latestCompletedExperimentTime) {
      return true;
    }
    const currentLifecycleStatus = normalizeLifecycleStatus("", normalizedStatus);
    const currentStatusKeepsPartial =
      isAxisPartialProgressStatus(normalizedStatus)
      && partialAxisStatusMatchesExperiment(normalizedStatus, experiment);
    const selectedLabFlowKeepsPartial =
      explicitExperimentCode === experiment.code
      && PARTIAL_AXIS_STABLE_CURRENT_STATUSES.has(currentLifecycleStatus)
      && currentLifecycleStatus !== "实验已完成";
    return currentStatusKeepsPartial || selectedLabFlowKeepsPartial;
  });
  const historicalPartialAxisCodeSet = new Set(
    partialAxisExperiments
      .filter((experiment) => !activePartialAxisExperiments.some((activeExperiment) => activeExperiment.code === experiment.code))
      .map((experiment) => experiment.code),
  );
  const currentStartedUnfinishedExperiments = startedUnfinishedExperiments.filter((experiment) =>
    !historicalPartialAxisCodeSet.has(experiment.code),
  );
  const currentUnfinishedExperiments = unfinishedExperiments.filter((experiment) =>
    !historicalPartialAxisCodeSet.has(experiment.code),
  );
  const startedUnfinishedCodeSet = new Set(startedUnfinishedExperiments.map((experiment) => experiment.code));
  const explicitExperiment =
    explicitIndex >= 0
    && !completedCodeSet.has(orderedExperiments[explicitIndex]?.code)
    && !historicalPartialAxisCodeSet.has(orderedExperiments[explicitIndex]?.code)
    && hasExperimentEnteredLabFlow(experimentStatusMap.get(orderedExperiments[explicitIndex]?.code))
      ? orderedExperiments[explicitIndex]
      : null;
  const explicitUnfinishedExperiment =
    explicitIndex >= 0
    && !completedCodeSet.has(orderedExperiments[explicitIndex]?.code)
      ? orderedExperiments[explicitIndex]
      : null;
  const explicitUnstartedReturnedExperiment =
    normalizedStatus === "厂家收回"
    && explicitIndex >= 0
    && !completedCodeSet.has(orderedExperiments[explicitIndex]?.code)
    && !hasExperimentEnteredLabFlow(experimentStatusMap.get(orderedExperiments[explicitIndex]?.code))
      ? orderedExperiments[explicitIndex]
      : null;
  const latestWithdrawalRestoreTarget = resolveLatestWithdrawalRestoreTarget({
    taskCode,
    trayCode,
    samples: input.samples,
  });
  const normalizedStatusIsAppearanceInspection = isAppearanceInspectionStatus(
    normalizeLifecycleStatus("", normalizedStatus),
  );
  const explicitUnstartedAfterOtherCompletion =
    explicitUnfinishedExperiment
    && normalizeLifecycleStatus("", normalizedStatus) === "实验已完成"
    && completedExperiments.length > 0
    && !latestWithdrawalRestoreTarget
    && !hasExperimentEnteredLabFlow(experimentStatusMap.get(explicitUnfinishedExperiment.code))
      ? explicitUnfinishedExperiment
      : null;
  const explicitUnstartedAppearanceExperiment =
    explicitUnfinishedExperiment
    && normalizedStatusIsAppearanceInspection
    && !hasExperimentEnteredLabFlow(experimentStatusMap.get(explicitUnfinishedExperiment.code))
      ? explicitUnfinishedExperiment
      : null;
  const appearanceRequiredUnstartedExperiment =
    normalizedStatusIsAppearanceInspection
    && !explicitExperimentCode
    && startedUnfinishedExperiments.length === 0
      ? unfinishedExperiments.find((experiment) => experimentRequiresAppearanceInspection(experiment))
      : null;
  const statusMatchedPartialAxisExperiment =
    isAxisPartialProgressStatus(normalizedStatus)
      ? partialAxisExperiments.find((experiment) => partialAxisStatusMatchesExperiment(normalizedStatus, experiment))
      : null;
  const partialAxisExperimentTime = (experiment) => {
    const runtimeTime = Number(experimentRuntimeEventMap.get(experiment.code)?.timeValue) || 0;
    const eventTime = Number(resolveExperimentEvent(experimentEventMap, experiment)?.time) || 0;
    return Math.max(runtimeTime, eventTime);
  };
  const latestActivePartialAxisExperiment =
    isAxisPartialProgressStatus(normalizedStatus) && activePartialAxisExperiments.length > 0
      ? activePartialAxisExperiments.slice().sort((left, right) => {
        const leftTime = partialAxisExperimentTime(left);
        const rightTime = partialAxisExperimentTime(right);
        if (leftTime !== rightTime) {
          return rightTime - leftTime;
        }
        const leftIndex = orderedExperiments.findIndex((experiment) => experiment.code === left.code);
        const rightIndex = orderedExperiments.findIndex((experiment) => experiment.code === right.code);
        return rightIndex - leftIndex;
      })[0]
      : null;
  const explicitExperimentStatus = explicitExperiment
    ? normalizeText(experimentStatusMap.get(explicitExperiment.code))
    : "";
  const latestActivePartialAxisExperimentStatus = latestActivePartialAxisExperiment
    ? normalizeText(experimentStatusMap.get(latestActivePartialAxisExperiment.code))
    : "";
  const latestPartialAxisExperimentOverridesExplicit =
    explicitExperiment
    && latestActivePartialAxisExperiment
    && latestActivePartialAxisExperiment.code !== explicitExperiment.code
    && isAxisPartialProgressStatus(explicitExperimentStatus)
    && isAxisPartialProgressStatus(latestActivePartialAxisExperimentStatus)
    && partialAxisExperimentTime(latestActivePartialAxisExperiment) > partialAxisExperimentTime(explicitExperiment);
  const shouldStayOnHistoricalCompletedFlow =
    Boolean(input.suppressGuessedDestinationLab)
    && normalizeLifecycleStatus("", normalizedStatus) === "实验已完成"
    && completedExperiments.length > 0
    && !trayTargetExperimentCode
    && !inputCurrentExperimentCode;
  const currentExperiment =
    shouldStayOnHistoricalCompletedFlow
      ? null
      : explicitCompletedExperiment
        || (
          latestPartialAxisExperimentOverridesExplicit
            ? latestActivePartialAxisExperiment
            : explicitExperiment
        )
        || explicitUnstartedReturnedExperiment
        || explicitUnstartedAfterOtherCompletion
        || explicitUnstartedAppearanceExperiment
        || latestActivePartialAxisExperiment
        || statusMatchedPartialAxisExperiment
        || currentStartedUnfinishedExperiments[0]
        || appearanceRequiredUnstartedExperiment
        || currentUnfinishedExperiments[0]
        || null;
  const isSyntheticUnstartedCurrent =
    (Boolean(explicitUnstartedReturnedExperiment) || normalizedStatus === "厂家收回" || normalizeLifecycleStatus("", normalizedStatus) === "实验已完成")
    && currentStartedUnfinishedExperiments.length === 0
    && !explicitExperiment;
  const shouldSuppressGuessedNextLab =
    (Boolean(input.suppressGuessedDestinationLab) || isSyntheticUnstartedCurrent)
    && normalizeLifecycleStatus("", normalizedStatus) === "实验已完成"
    && completedExperiments.length > 0
    && !trayTargetExperimentCode
    && !inputCurrentExperimentCode;
  const overwrittenRuntimePartialAxisExperiments = unfinishedExperiments
    .filter((experiment) => {
      const runtimeStatus = normalizeText(experimentRuntimeEventMap.get(experiment.code)?.status);
      return isAxisPartialProgressStatus(runtimeStatus)
        && !isAxisPartialProgressStatus(experimentStatusMap.get(experiment.code));
    })
    .map((experiment) => ({
      ...experiment,
      partialAt: experimentRuntimeEventMap.get(experiment.code)?.timeValue || 0,
      routeStatus: experimentRuntimeEventMap.get(experiment.code)?.status || "",
      state: "partial",
    }));

  if (!currentExperiment) {
    const historicalPartialExperiments = [
      ...partialAxisExperiments.map((experiment) => ({
        ...experiment,
        partialAt: experimentRuntimeEventMap.get(experiment.code)?.timeValue || 0,
        routeStatus: experimentStatusMap.get(experiment.code),
        state: "partial",
      })),
      ...overwrittenRuntimePartialAxisExperiments,
    ];
    if (historicalPartialExperiments.length > 0) {
      const latestByExperimentCode = new Map();
      [...completedExperiments, ...historicalPartialExperiments].forEach((experiment) => {
        const experimentCode = normalizeText(experiment?.code);
        const experimentState = normalizeText(experiment?.state) === "partial" ? "partial" : "completed";
        const experimentKey = `${experimentCode}::${experimentState}::${normalizeText(experiment?.routeStatus)}`;
        const experimentTime = Number(experiment?.completedAt || experiment?.partialAt || 0);
        const existing = latestByExperimentCode.get(experimentKey);
        const existingTime = Number(existing?.completedAt || existing?.partialAt || 0);
        if (!existing || experimentTime >= existingTime) {
          latestByExperimentCode.set(experimentKey, experiment);
        }
      });
      return Array.from(latestByExperimentCode.values()).sort((left, right) => {
        const leftTime = Number(left?.completedAt || left?.partialAt || 0);
        const rightTime = Number(right?.completedAt || right?.partialAt || 0);
        if (leftTime && rightTime && leftTime !== rightTime) {
          return leftTime - rightTime;
        }
        const leftIndex = orderedExperiments.findIndex((experiment) => experiment.code === left.code);
        const rightIndex = orderedExperiments.findIndex((experiment) => experiment.code === right.code);
        return leftIndex - rightIndex;
      }).map((experiment) => ({
        code: experiment.code,
        name: experiment.name,
        displayName: experiment.displayName,
        experiment_name: experiment.experiment_name,
        experimentName: experiment.experimentName,
        experiment_type: experiment.experiment_type,
        experimentType: experiment.experimentType,
        test_type: experiment.test_type,
        testType: experiment.testType,
        required_device: experiment.required_device,
        requiredDevice: experiment.requiredDevice,
        destinationLab: experiment.destinationLab,
        aliases: experiment.aliases,
        partialTime: normalizeText(experiment?.partialTime),
        routeStatus: normalizeText(experiment?.routeStatus),
        state: normalizeText(experiment?.state) === "partial" ? "partial" : "completed",
      }));
    }
    return completedExperiments.map((experiment, index) => ({
      code: experiment.code,
      name: experiment.name,
      displayName: experiment.displayName,
      experiment_name: experiment.experiment_name,
      experimentName: experiment.experimentName,
      experiment_type: experiment.experiment_type,
      experimentType: experiment.experimentType,
      test_type: experiment.test_type,
      testType: experiment.testType,
      required_device: experiment.required_device,
      requiredDevice: experiment.requiredDevice,
      destinationLab: experiment.destinationLab,
      aliases: experiment.aliases,
      state: "completed",
      routeSteps: index === completedExperiments.length - 1 ? buildExperimentRouteSteps() : [],
      routeStatus: index === completedExperiments.length - 1 ? "实验已完成" : "",
    }));
  }

  const routeStatusFallback = RUNNING_EXPERIMENT_RUN_STATUSES.has(normalizeLifecycleStatus("", normalizedStatus))
    ? ""
    : normalizedStatus;
  const routeStatus =
    explicitCompletedExperiment && currentExperiment.code === explicitCompletedExperiment.code
      ? "实验已完成"
      : explicitUnstartedAfterOtherCompletion && currentExperiment.code === explicitUnstartedAfterOtherCompletion.code
      ? normalizedStatus
      : experimentStatusMap.get(currentExperiment.code) || routeStatusFallback;
  const currentExperimentEvent = currentExperiment ? resolveExperimentEvent(experimentEventMap, currentExperiment) : null;
  const currentExperimentHasRunningEvent = RUNNING_EXPERIMENT_RUN_STATUSES.has(
    normalizeLifecycleStatus("", normalizeText(currentExperimentEvent?.status)),
  );
  const currentExperimentUnstarted =
    explicitCompletedExperiment && currentExperiment.code === explicitCompletedExperiment.code
      ? false
      : (
      Boolean(explicitUnstartedReturnedExperiment)
      || Boolean(explicitUnstartedAppearanceExperiment)
      || normalizedStatus === "厂家收回"
      || normalizeLifecycleStatus("", normalizedStatus) === "实验已完成"
      || normalizedStatusIsAppearanceInspection
    )
    && currentStartedUnfinishedExperiments.length === 0
    && !explicitExperiment
    || (
      !normalizeText(routeStatus)
      && !hasExperimentEnteredLabFlow(experimentStatusMap.get(currentExperiment.code))
      && !currentExperimentHasRunningEvent
    );
  const historicalFlowExperiments = [
    ...completedExperiments.filter((experiment) => experiment.code !== currentExperiment.code),
    ...partialAxisExperiments
      .filter((experiment) => experiment.code !== currentExperiment.code)
      .map((experiment) => ({
        ...experiment,
        partialAt: experimentRuntimeEventMap.get(experiment.code)?.timeValue || 0,
        routeStatus: experimentStatusMap.get(experiment.code),
        state: "partial",
      })),
    ...overwrittenRuntimePartialAxisExperiments,
  ].sort((left, right) => {
    const leftTime = Number(left?.completedAt || left?.partialAt || 0);
    const rightTime = Number(right?.completedAt || right?.partialAt || 0);
    if (leftTime && rightTime && leftTime !== rightTime) {
      return leftTime - rightTime;
    }
    const leftIndex = orderedExperiments.findIndex((experiment) => experiment.code === left.code);
    const rightIndex = orderedExperiments.findIndex((experiment) => experiment.code === right.code);
    return leftIndex - rightIndex;
  });
  const orderedFlowExperiments = [
    ...historicalFlowExperiments,
    currentExperiment,
    ...startedUnfinishedExperiments.filter((experiment) =>
      experiment.code !== currentExperiment.code
      && !partialAxisExperiments.some((partialExperiment) => partialExperiment.code === experiment.code),
    ),
    ...unfinishedExperiments.filter(
      (experiment) =>
        experiment.code !== currentExperiment.code && !startedUnfinishedCodeSet.has(experiment.code),
    ),
  ];

  return orderedFlowExperiments.map((experiment) => {
    if (completedCodeSet.has(experiment.code) && experiment.code !== currentExperiment.code) {
      return {
        code: experiment.code,
        name: experiment.name,
        displayName: experiment.displayName,
        experiment_name: experiment.experiment_name,
        experimentName: experiment.experimentName,
        experiment_type: experiment.experiment_type,
        experimentType: experiment.experimentType,
        test_type: experiment.test_type,
        testType: experiment.testType,
        required_device: experiment.required_device,
        requiredDevice: experiment.requiredDevice,
        destinationLab: experiment.destinationLab,
        aliases: experiment.aliases,
        state: "completed",
      };
    }
    if (normalizeText(experiment?.state) === "partial" && normalizeText(experiment?.routeStatus)) {
      return {
        code: experiment.code,
        name: experiment.name,
        displayName: experiment.displayName,
        experiment_name: experiment.experiment_name,
        experimentName: experiment.experimentName,
        experiment_type: experiment.experiment_type,
        experimentType: experiment.experimentType,
        test_type: experiment.test_type,
        testType: experiment.testType,
        required_device: experiment.required_device,
        requiredDevice: experiment.requiredDevice,
        destinationLab: experiment.destinationLab,
        aliases: experiment.aliases,
        routeStatus: experiment.routeStatus,
        state: "partial",
      };
    }
    if (experiment.code === currentExperiment.code) {
      return {
        code: currentExperiment.code,
        name: currentExperiment.name,
        displayName: currentExperiment.displayName,
        experiment_name: currentExperiment.experiment_name,
        experimentName: currentExperiment.experimentName,
        experiment_type: currentExperiment.experiment_type,
        experimentType: currentExperiment.experimentType,
        test_type: currentExperiment.test_type,
        testType: currentExperiment.testType,
        required_device: currentExperiment.required_device,
        requiredDevice: currentExperiment.requiredDevice,
        destinationLab: currentExperiment.destinationLab,
        aliases: currentExperiment.aliases,
        explicitCompletedCurrent: Boolean(
          explicitCompletedExperiment
          && currentExperiment.code === explicitCompletedExperiment.code,
        ),
        state: "current",
        unstarted: currentExperimentUnstarted,
        suppressDestinationLab: shouldSuppressGuessedNextLab,
        useExperimentDestinationLab: Boolean(
          explicitUnstartedAfterOtherCompletion
          && currentExperiment.code === explicitUnstartedAfterOtherCompletion.code,
        ),
        routeSteps: buildExperimentRouteSteps(),
        routeStatus,
      };
    }
    const experimentStatus = experimentStatusMap.get(experiment.code);
    if (isAxisPartialProgressStatus(experimentStatus)) {
      return {
        code: experiment.code,
        name: experiment.name,
        displayName: experiment.displayName,
        experiment_name: experiment.experiment_name,
        experimentName: experiment.experimentName,
        experiment_type: experiment.experiment_type,
        experimentType: experiment.experimentType,
        test_type: experiment.test_type,
        testType: experiment.testType,
        required_device: experiment.required_device,
        requiredDevice: experiment.requiredDevice,
        destinationLab: experiment.destinationLab,
        aliases: experiment.aliases,
        routeStatus: experimentStatus,
        state: "partial",
      };
    }
    return {
      code: experiment.code,
      name: experiment.name,
      displayName: experiment.displayName,
      experiment_name: experiment.experiment_name,
      experimentName: experiment.experimentName,
      experiment_type: experiment.experiment_type,
      experimentType: experiment.experimentType,
      test_type: experiment.test_type,
      testType: experiment.testType,
      required_device: experiment.required_device,
      requiredDevice: experiment.requiredDevice,
      destinationLab: experiment.destinationLab,
      aliases: experiment.aliases,
      state: "pending",
    };
  });
};

export {
  buildTrayExperimentFlow,
};
