// 构建样品流转列表、暂存视图和更新辅助逻辑。
import {
  APPEARANCE_PRE_EXPERIMENT_STOCKED_STATUS,
  APPEARANCE_STOCKED_STATUS,
  DETAIL_STATUS_OPTIONS,
  EXPERIMENT_FLOW_STATUS_LABELS,
  FLOW_STEP_INDEX_BY_KEY,
  FLOW_STEP_KEY_BY_LABEL,
  POST_EXPERIMENT_STAGING_SENT_STATUS,
  POST_EXPERIMENT_STAGING_STOCKED_STATUS,
  RUNNING_EXPERIMENT_RUN_STATUSES,
  SAMPLE_FLOW_STEPS,
  TRAY_STATUS_OPTIONS,
  WITHDRAWAL_ACTIONS,
} from "./sampleFlow.constants";
import { normalizeText } from "./sampleFlow.shared";
import {
  asArray,
  entryMatchesTrayCode,
  entryTimeValue,
  firstNonEmptyArray,
  getSampleTrayList,
  parseTimeValue,
  resolveEntryTaskCode,
  resolveEntryTrayCode,
  resolveFlowStatusRank,
  uniqueNormalizedTexts,
} from "./sampleFlow.trayScope";
import {
  isAmbiguousStagingStatus,
  isAppearanceInspectionStatus,
  isPostRetentionLocation,
  normalizeLifecycleStatus,
  normalizeSamplesSnapshot,
  resolveFlowStatusByLocation,
  syncTrayStatusToSampleStatus,
} from "./sampleFlow.status";
import {
  buildExperimentRouteSteps,
  buildLabDispatchStepLabel,
  experimentRequiresAppearanceInspection,
  findCompletedExperimentHistoryEntry,
  hasExperimentEnteredLabFlow,
  latestWithdrawalHistoryEntry,
  parseExperimentHistoryDetail,
  parseRetainedCompletedExperimentBeforeWithdrawal,
  parseWithdrawalRestoreTarget,
  resolveLabDestinationName,
} from "./sampleFlow.experimentHelpers";
import { buildOrderedTrayExperiments } from "./sampleFlow.experimentOrder";
import {
  resolveCompletedExperimentRuntime,
  resolveExperimentRunEntry,
  resolveExperimentRunStatus,
} from "./sampleFlow.experimentRuns";
import { synchronizeSamplesForTrayCodes } from "./sampleFlow.sampleCollection";
import {
  hidePendingFlowStepTimes,
  normalizeHistoryFlowLabel,
  setLatestFlowTime,
} from "./sampleFlow.flowTimeHelpers";
import { resolveEffectiveTrayLifecycleStatus } from "./sampleFlow.trayLifecycle";
import {
  buildSingleExperimentStatusLabel,
  chooseExperimentStatus,
  experimentFlowStatusRank,
  resolveExperimentEvent,
  resolveLatestExperimentEventMap,
} from "./sampleFlow.experimentEvents";
import { buildSamplesTrayOverviewView } from "./sampleFlow.trayOverviewView";
import { buildSamplesFlowView } from "./sampleFlow.samplesListView";
import { buildSamplesStagingView } from "./sampleFlow.stagingView";
import {
  dispatchStagingSamples,
  submitSamplesBatchIntake,
  updateSampleDetail,
  updateTrayStatus,
} from "./sampleFlow.commands";
import { isAxisPartialProgressStatus } from "@/modules/experiment-progress/axisProgress";

const APPEARANCE_SENT_STATUS_LABEL = "送至外观检测间";
const POST_EXPERIMENT_STAGING_SENT_IS_REGULAR_STAGING_STATUS = POST_EXPERIMENT_STAGING_SENT_STATUS === "送至暂存间";
const NORMAL_STAGING_DISPLAY_STATUS = "放置暂存间";

const resolveSingleTrayExperiment = (input = {}) => {
  const orderedExperiments = buildOrderedTrayExperiments({
    taskCode: input.taskCode,
    trayCode: input.trayCode,
    experiments: input.experiments,
    experimentTrays: input.experimentTrays,
    schedules: input.schedules,
  });
  return orderedExperiments.length === 1 ? orderedExperiments[0] : null;
};

const resolveTrayDispatchTarget = (input = {}) => {
  const normalizedTaskCode = normalizeText(input.taskCode);
  const normalizedTrayCode = normalizeText(input.trayCode);
  if (!normalizedTaskCode || !normalizedTrayCode) {
    return { targetLab: "", targetExperimentCode: "" };
  }

  let targetLab = "";
  let targetExperimentCode = "";
  let latestHistoryMatch = null;

  asArray(input.samples).forEach((sample) => {
    if (resolveEntryTaskCode(sample) !== normalizedTaskCode) {
      return;
    }
    asArray(sample?.trays).forEach((tray) => {
      if (resolveEntryTrayCode(tray) !== normalizedTrayCode) {
        return;
      }
      const trayTargetLab = normalizeText(tray?.target_lab || tray?.targetLab);
      if (trayTargetLab) {
        targetLab = trayTargetLab;
      }
      targetExperimentCode = targetExperimentCode
        || normalizeText(tray?.target_experiment_code || tray?.targetExperimentCode);
    });
    asArray(sample?.history).forEach((entry) => {
      const detail = normalizeText(entry?.detail);
      if (!entryMatchesTrayCode(entry, normalizedTrayCode)) {
        return;
      }
      const eventTargetLab = resolveLabDestinationName(
        entry?.target_lab,
        entry?.targetLab,
        entry?.location,
        entry?.location_desc,
        entry?.locationDesc,
        detail,
      );
      if (!eventTargetLab) {
        return;
      }
      const eventTime = entryTimeValue(entry);
      if (!latestHistoryMatch || eventTime >= latestHistoryMatch.time) {
        latestHistoryMatch = { targetLab: eventTargetLab, time: eventTime };
      }
    });
  });

  return {
    targetLab: targetLab || latestHistoryMatch?.targetLab || "",
    targetExperimentCode,
  };
};

const resolveLatestWithdrawalRestoreTarget = ({ taskCode, trayCode, samples = [] } = {}) => {
  const normalizedTaskCode = normalizeText(taskCode);
  const normalizedTrayCode = normalizeText(trayCode);
  if (!normalizedTaskCode || !normalizedTrayCode) {
    return null;
  }

  return asArray(samples).reduce((latest, sample) => {
    if (resolveEntryTaskCode(sample) !== normalizedTaskCode) {
      return latest;
    }
    const touchesTray = getSampleTrayList(sample).some((tray) => resolveEntryTrayCode(tray) === normalizedTrayCode);
    if (!touchesTray) {
      return latest;
    }
    const withdrawal = latestWithdrawalHistoryEntry(sample?.history);
    const restoreTarget = withdrawal
      ? parseWithdrawalRestoreTarget(withdrawal.entry?.detail, normalizedTaskCode)
      : null;
    if (!restoreTarget) {
      return latest;
    }
    if (!latest || withdrawal.time >= latest.time) {
      return { ...restoreTarget, time: withdrawal.time };
    }
    return latest;
  }, null);
};

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
  const singleExperimentAxisRuntimeStatus = orderedExperiments.length === 1
    ? resolveExperimentRunStatus({
      experiment: orderedExperiments[0],
      experimentCode: orderedExperiments[0].code,
      experimentRuns: input.experimentRuns || input.experiment_runs,
      experimentRunSteps: firstNonEmptyArray(input.experimentRunSteps, input.experiment_run_steps),
      experimentRunTrays: firstNonEmptyArray(input.experimentRunTrays, input.experiment_run_trays),
      experiments: orderedExperiments,
      schedules: input.schedules,
      taskCode,
      trayCode,
    })
    : "";
  if (orderedExperiments.length <= 1 && !isAxisPartialProgressStatus(singleExperimentAxisRuntimeStatus)) {
    return [];
  }

  const normalizedStatus = resolveEffectiveTrayLifecycleStatus(input) || normalizeLifecycleStatus(input.location, input.status);
  const trayIsReturned = normalizedStatus === "厂家收回";
  const dispatchTarget = resolveTrayDispatchTarget(input);
  const experimentEventMap = resolveLatestExperimentEventMap({
    taskCode,
    trayCode,
    samples: input.samples,
  });
  const targetLabExperimentCode = normalizeText(dispatchTarget.targetLab)
    ? normalizeText(
      orderedExperiments.find((experiment) => normalizeText(experiment.destinationLab) === normalizeText(dispatchTarget.targetLab))?.code,
    )
    : "";
  const inputCurrentExperimentCode = normalizeText(input.currentExperimentCode);
  const dispatchTargetExperimentCode = normalizeText(dispatchTarget.targetExperimentCode);
  const trayTargetExperimentCode =
    dispatchTargetExperimentCode
    || (input.preferCurrentExperimentCode && inputCurrentExperimentCode ? "" : targetLabExperimentCode);
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
    const runtimeStatus = resolveExperimentRunStatus({
      experiment,
      experimentCode: experiment.code,
      experimentRuns: input.experimentRuns || input.experiment_runs,
      experimentRunSteps: firstNonEmptyArray(input.experimentRunSteps, input.experiment_run_steps),
      experimentRunTrays: firstNonEmptyArray(input.experimentRunTrays, input.experiment_run_trays),
      experiments: orderedExperiments,
      schedules: input.schedules,
      taskCode,
      trayCode,
    });
    return RUNNING_EXPERIMENT_RUN_STATUSES.has(runtimeStatus) || isAxisPartialProgressStatus(runtimeStatus);
  });
  const explicitIndex = explicitExperimentCode
    ? orderedExperiments.findIndex((experiment) => experiment.code === explicitExperimentCode)
    : -1;
  const experimentStatusMap = new Map(
    orderedExperiments.map((experiment) => {
      const event = resolveExperimentEvent(experimentEventMap, experiment);
      const runtimeStatus = resolveExperimentRunStatus({
        experiment,
        experimentCode: experiment.code,
        experimentRuns: input.experimentRuns || input.experiment_runs,
        experimentRunSteps: firstNonEmptyArray(input.experimentRunSteps, input.experiment_run_steps),
        experimentRunTrays: firstNonEmptyArray(input.experimentRunTrays, input.experiment_run_trays),
        experiments: orderedExperiments,
        schedules: input.schedules,
        taskCode,
        trayCode,
      });
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
        runtimeStatus: explicitRuntimeStatus,
        fallbackStatus,
        recordStatus: "",
      })];
    }),
  );
  const completedExperiments = orderedExperiments
    .map((experiment) => {
      const event = resolveExperimentEvent(experimentEventMap, experiment);
      const eventStatus = normalizeLifecycleStatus("", normalizeText(event?.status));
      const runtimeCompleted = resolveCompletedExperimentRuntime({
        experiment,
        experimentCode: experiment.code,
        experimentRuns: input.experimentRuns || input.experiment_runs,
        experimentRunSteps: firstNonEmptyArray(input.experimentRunSteps, input.experiment_run_steps),
        experimentRunTrays: firstNonEmptyArray(input.experimentRunTrays, input.experiment_run_trays),
        experiments: orderedExperiments,
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
  const completedExperimentIndexes = completedExperiments
    .map((experiment) => orderedExperiments.findIndex((orderedExperiment) => orderedExperiment.code === experiment.code))
    .filter((index) => index >= 0);
  const hasCompletedExperimentBeforeExplicit =
    explicitIndex >= 0 && completedExperimentIndexes.some((index) => index < explicitIndex);
  const unfinishedExperiments = orderedExperiments.filter((experiment) => !completedCodeSet.has(experiment.code));
  const startedUnfinishedExperiments = unfinishedExperiments.filter((experiment) =>
    hasExperimentEnteredLabFlow(experimentStatusMap.get(experiment.code)),
  );
  const partialAxisExperiments = startedUnfinishedExperiments.filter((experiment) =>
    isAxisPartialProgressStatus(experimentStatusMap.get(experiment.code)),
  );
  const startedUnfinishedCodeSet = new Set(startedUnfinishedExperiments.map((experiment) => experiment.code));
  const explicitExperiment =
    explicitIndex >= 0
    && !completedCodeSet.has(orderedExperiments[explicitIndex]?.code)
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
    && startedUnfinishedExperiments.length === 0
    && !hasExperimentEnteredLabFlow(experimentStatusMap.get(explicitUnfinishedExperiment.code))
      ? explicitUnfinishedExperiment
      : null;
  const appearanceRequiredUnstartedExperiment =
    normalizedStatusIsAppearanceInspection
    && !explicitExperimentCode
    && startedUnfinishedExperiments.length === 0
      ? unfinishedExperiments.find((experiment) => experimentRequiresAppearanceInspection(experiment))
      : null;
  const currentExperiment =
    explicitExperiment
    || explicitUnstartedReturnedExperiment
    || explicitUnstartedAfterOtherCompletion
    || explicitUnstartedAppearanceExperiment
    || startedUnfinishedExperiments[0]
    || appearanceRequiredUnstartedExperiment
    || unfinishedExperiments[0]
    || null;
  const currentExperimentStatus = currentExperiment ? experimentStatusMap.get(currentExperiment.code) : "";
  const currentExperimentIsAxisPartial = isAxisPartialProgressStatus(currentExperimentStatus);
  const isSyntheticUnstartedCurrent =
    (Boolean(explicitUnstartedReturnedExperiment) || normalizedStatus === "厂家收回" || normalizeLifecycleStatus("", normalizedStatus) === "实验已完成")
    && startedUnfinishedExperiments.length === 0
    && !explicitExperiment;
  const shouldSuppressGuessedNextLab =
    (Boolean(input.suppressGuessedDestinationLab) || isSyntheticUnstartedCurrent)
    && normalizeLifecycleStatus("", normalizedStatus) === "实验已完成"
    && completedExperiments.length > 0
    && !trayTargetExperimentCode
    && !inputCurrentExperimentCode;

  if (!currentExperiment) {
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
    explicitUnstartedAfterOtherCompletion && currentExperiment.code === explicitUnstartedAfterOtherCompletion.code
      ? (hasCompletedExperimentBeforeExplicit ? normalizedStatus : "送至实验室")
      : experimentStatusMap.get(currentExperiment.code) || routeStatusFallback;
  const currentExperimentEvent = currentExperiment ? resolveExperimentEvent(experimentEventMap, currentExperiment) : null;
  const currentExperimentHasRunningEvent = RUNNING_EXPERIMENT_RUN_STATUSES.has(
    normalizeLifecycleStatus("", normalizeText(currentExperimentEvent?.status)),
  );
  const currentExperimentUnstarted =
    (
      Boolean(explicitUnstartedReturnedExperiment)
      || normalizedStatus === "厂家收回"
      || normalizeLifecycleStatus("", normalizedStatus) === "实验已完成"
      || normalizedStatusIsAppearanceInspection
    )
    && startedUnfinishedExperiments.length === 0
    && !explicitExperiment
    || (
      !normalizeText(routeStatus)
      && !hasExperimentEnteredLabFlow(experimentStatusMap.get(currentExperiment.code))
      && !currentExperimentHasRunningEvent
    );
  const orderedFlowExperiments = [
    ...completedExperiments,
    ...partialAxisExperiments.filter((experiment) => experiment.code !== currentExperiment.code),
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
    if (completedCodeSet.has(experiment.code)) {
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

const buildTrayFlowTimeMap = (input = {}) => {
  const taskCode = normalizeText(input.taskCode);
  const trayCode = normalizeText(input.trayCode);
  const timeMap = new Map();
  const timeSourceMap = new Map();
  const timeHistoryMap = new Map();
  const recordLatestFlowTime = (label, time, source = "history") =>
    setLatestFlowTime(timeMap, label, time, timeSourceMap, source, timeHistoryMap);
  if (!trayCode) {
    timeMap.timeHistoryMap = timeHistoryMap;
    return timeMap;
  }

  (Array.isArray(input.samples) ? input.samples : []).forEach((sample) => {
    if (taskCode && normalizeText(sample?.task_code) !== taskCode) {
      return;
    }
    const trayEntries = asArray(sample?.trays).filter((tray) => normalizeText(tray?.tray_code) === trayCode);
    if (trayEntries.length === 0) {
      return;
    }
    const historyEntries = asArray(sample?.history);
    const latestWithdrawal = latestWithdrawalHistoryEntry(historyEntries);
    const latestWithdrawalEntry = latestWithdrawal?.entry || null;
    const restoreTarget = latestWithdrawalEntry
      ? parseWithdrawalRestoreTarget(latestWithdrawalEntry?.detail, taskCode)
      : null;
    const latestWithdrawalRank = latestWithdrawalEntry
      ? resolveFlowStatusRank(latestWithdrawalEntry?.location, restoreTarget?.status || latestWithdrawalEntry?.status)
      : -1;
    const shouldIgnoreHistoryTime = (entry, label, entryLocation) => {
      if (!latestWithdrawal) {
        return false;
      }
      const entryTime = entryTimeValue(entry);
      if (entryTime >= latestWithdrawal.time) {
        return false;
      }
      const labelRank = resolveFlowStatusRank(entryLocation, label);
      return labelRank > latestWithdrawalRank;
    };
    if (latestWithdrawalEntry) {
      const withdrawalTime = latestWithdrawalEntry?.time
        || latestWithdrawalEntry?.updated_at
        || latestWithdrawalEntry?.created_at
        || latestWithdrawalEntry?.timestamp;
      if (restoreTarget?.experimentName && restoreTarget.status === "实验已完成") {
        const restoredCompletedEntry = findCompletedExperimentHistoryEntry(
          historyEntries,
          taskCode,
          restoreTarget.experimentName,
          latestWithdrawal.time,
        );
        setLatestFlowTime(
          timeMap,
          `${restoreTarget.experimentName}${EXPERIMENT_FLOW_STATUS_LABELS.completed}`,
          restoredCompletedEntry?.entry?.time || withdrawalTime,
          timeSourceMap,
          "history",
          timeHistoryMap,
        );
      } else {
        const restoreLabel = normalizeHistoryFlowLabel(
          restoreTarget?.status || latestWithdrawalEntry?.status,
          latestWithdrawalEntry?.location,
        );
        const withdrawalTimeSource = [APPEARANCE_STOCKED_STATUS, APPEARANCE_PRE_EXPERIMENT_STOCKED_STATUS].includes(restoreLabel)
          ? "withdrawal"
          : "history";
        recordLatestFlowTime(restoreLabel, withdrawalTime, withdrawalTimeSource);
      }
    }

    trayEntries.forEach((tray) => {
      const rawTrayStatus = normalizeText(tray?.status || tray?.tray_status || tray?.trayStatus);
      if (!rawTrayStatus) {
        return;
      }
      const trayStatus = normalizeLifecycleStatus(sample?.location, rawTrayStatus);
      const trayStatusLabel = isPostRetentionLocation(sample?.location) && isAmbiguousStagingStatus(trayStatus)
        ? POST_EXPERIMENT_STAGING_STOCKED_STATUS
        : trayStatus;
      if (trayStatusLabel === APPEARANCE_SENT_STATUS_LABEL) {
        return;
      }
      recordLatestFlowTime(trayStatusLabel, tray?.updated_at, "fallback");
    });

    historyEntries.forEach((entry) => {
      const time = entry?.time || entry?.updated_at || entry?.created_at || entry?.timestamp;
      const withdrawalEntry = WITHDRAWAL_ACTIONS.has(normalizeText(entry?.action));
      const statusLabel = normalizeHistoryFlowLabel(entry?.status, entry?.location);
      const actionLabel = normalizeHistoryFlowLabel(entry?.action, entry?.location);
      const detailLabel = normalizeHistoryFlowLabel(entry?.detail, entry?.location);
      const hasPostTestStagingLabel = [statusLabel, actionLabel, detailLabel].some((label) =>
        label === POST_EXPERIMENT_STAGING_SENT_STATUS || label === POST_EXPERIMENT_STAGING_STOCKED_STATUS,
      );
      const actualAppearanceStorage =
        statusLabel === APPEARANCE_STOCKED_STATUS
        && normalizeText(entry?.location).includes("外观检测间");
      (withdrawalEntry ? [] : [statusLabel, actionLabel, detailLabel]).forEach((label) => {
        if (hasPostTestStagingLabel && label === "已到达暂存间") {
          return;
        }
        if (label === APPEARANCE_SENT_STATUS_LABEL) {
          return;
        }
        if (!label || (!actualAppearanceStorage && shouldIgnoreHistoryTime(entry, label, entry?.location))) {
          return;
        }
        recordLatestFlowTime(label, time);
      });
      const experimentEvent = parseExperimentHistoryDetail(entry?.detail, taskCode);
      if (experimentEvent) {
        const currentTime = entryTimeValue(entry);
        if (latestWithdrawal && currentTime < latestWithdrawal.time) {
          const retainedCompleted = parseRetainedCompletedExperimentBeforeWithdrawal(
            entry,
            taskCode,
            latestWithdrawalEntry,
            restoreTarget,
          );
          if (retainedCompleted) {
            setLatestFlowTime(
              timeMap,
              `${retainedCompleted.experimentName}${EXPERIMENT_FLOW_STATUS_LABELS.completed}`,
              time,
              timeSourceMap,
              "history",
              timeHistoryMap,
            );
          }
          return;
        }
        const experimentStatus = normalizeLifecycleStatus("", experimentEvent.status);
        if (experimentStatus === "实验进行中" || experimentStatus === "实验中") {
          recordLatestFlowTime(`${experimentEvent.experimentName}${EXPERIMENT_FLOW_STATUS_LABELS.running}`, time);
        }
        if (experimentStatus === "实验已完成" || experimentStatus === "实验完成") {
          recordLatestFlowTime(`${experimentEvent.experimentName}${EXPERIMENT_FLOW_STATUS_LABELS.completed}`, time);
        }
      }
    });
  });

  const orderedExperiments = buildOrderedTrayExperiments({
    taskCode,
    trayCode,
    experiments: input.experiments,
    experimentTrays: input.experimentTrays,
    schedules: input.schedules,
  });
  orderedExperiments.forEach((experiment) => {
    const matchedRun = resolveExperimentRunEntry({
      experimentCode: experiment.code,
      experimentRuns: input.experimentRuns || input.experiment_runs,
      experimentRunTrays: firstNonEmptyArray(input.experimentRunTrays, input.experiment_run_trays),
      taskCode,
      trayCode,
    });
    const runStatus = normalizeLifecycleStatus("", matchedRun?.status);
    const statusKey = RUNNING_EXPERIMENT_RUN_STATUSES.has(runStatus)
      ? "running"
      : runStatus === "实验已完成" || runStatus === "实验完成"
        ? "completed"
        : "";
    if (!statusKey) {
      return;
    }
    const time = statusKey === "completed"
      ? normalizeText(matchedRun?.ended_at || matchedRun?.endedAt || matchedRun?.updated_at || matchedRun?.updatedAt)
      : normalizeText(matchedRun?.started_at || matchedRun?.startedAt || matchedRun?.updated_at || matchedRun?.updatedAt);
    if (!time) {
      return;
    }
    const suffix = EXPERIMENT_FLOW_STATUS_LABELS[statusKey];
    uniqueNormalizedTexts([
      experiment.displayName,
      experiment.name,
      experiment.code,
      ...(Array.isArray(experiment.aliases) ? experiment.aliases : []),
    ]).forEach((name) => {
      recordLatestFlowTime(`${name}${suffix}`, time, "runtime");
    });
  });

  timeMap.timeHistoryMap = timeHistoryMap;
  return timeMap;
};

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
    const routeStepTimeAfter = (label, floorTime = 0, ceilingTime = 0) => {
      const timeLabels = label === APPEARANCE_PRE_EXPERIMENT_STOCKED_STATUS
        ? [APPEARANCE_PRE_EXPERIMENT_STOCKED_STATUS, APPEARANCE_STOCKED_STATUS]
        : [label];
      const matchingTimes = timeLabels.flatMap((timeLabel) => asArray(stepTimeHistoryMap.get(timeLabel)))
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

    if (activeExperiment) {
      const pushExperimentStep = (experiment, index) => {
        const state = normalizeText(experiment?.state);
        if (state === "partial" && normalizeText(experiment?.routeStatus)) {
          return pushStep({
            key: `experiment-partial-${index}`,
            label: normalizeText(experiment.routeStatus),
            reached: true,
            time: stepTimeMap.get(experiment.routeStatus) || "",
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
      const completedExperimentTimesBeforeCurrent = experimentsBeforeCurrent.map((experiment, index) =>
        normalizeText(experiment?.state) === "partial" ? 0 : completedExperimentTime(experiment, index),
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
      const shouldShowPartialAxisStaging =
        Boolean(partialAxisStatus)
        && isAmbiguousStagingStatus(currentLifecycleStatus)
        && !isPostRetentionLocation(effectiveInput.location);
      const partialAxisFollowUpStatus =
        partialAxisStatus
        && !shouldShowPartialAxisStaging
        && currentLifecycleStatus
        && !["实验已完成", "实验完成", "实验进行中", "实验中"].includes(currentLifecycleStatus)
          ? currentLifecycleStatus
          : "";
      if (partialAxisFollowUpStatus) {
        normalizedRouteStatus = partialAxisFollowUpStatus;
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
      const inputCurrentExperimentCode = normalizeText(effectiveInput.currentExperimentCode);
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
            reached: Boolean(partialAxisFollowUpStatus || shouldShowPartialAxisStaging),
          })
        : -1;
      const routeIndexes = routeSteps.map((label, index) =>
        pushStep({
          key: `route-${currentExperimentIndex}-${index}`,
          label,
          displayLabel: label === "送至实验室" ? buildLabDispatchStepLabel(currentLabDestination) : label,
          timeLabel: label,
          time: routeStepTimeAfter(label, latestCompletedTimeBeforeCurrent),
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
      const partialAxisStagingIndex = shouldShowPartialAxisStaging
        ? pushStep({
            key: `route-partial-axis-staging-${currentExperimentIndex}`,
            label: NORMAL_STAGING_DISPLAY_STATUS,
            time: stepTimeMap.get(NORMAL_STAGING_DISPLAY_STATUS) || stepTimeMap.get("已到达暂存间") || "",
          })
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

      experimentsAfterCurrent.forEach((experiment, index) => {
        pushExperimentStep(experiment, index + experimentsBeforeCurrent.length + 1);
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
      const partialAxisIncompleteLabels = uniqueNormalizedTexts([
        ...experimentsBeforeCurrent.map((experiment, index) =>
          normalizeText(experiment?.state) === "partial"
            ? `${experimentDisplayName(experiment, index)}未全部完成`
            : "",
        ),
        partialAxisStatus ? `${experimentName}未全部完成` : "",
      ]);
      partialAxisIncompleteLabels.forEach((label, index) => {
        pushStep({
          key: `route-partial-axis-incomplete-${currentExperimentIndex}-${index}`,
          label,
        });
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
        if (shouldShowPartialAxisStaging) {
          currentStatus = NORMAL_STAGING_DISPLAY_STATUS;
          activeIndex = partialAxisStagingIndex;
          if (partialAxisIndex >= 0) {
            steps[partialAxisIndex].reached = true;
          }
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
        if (latestCompletedIndex !== undefined) {
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
          time: routeStepTimeAfter(label, latestCompletedTimeBeforeFinal, finalCompletedTime),
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

    steps[transportIndex].active = activeIndex === transportIndex;
    steps[transportIndex].reached = activeIndex !== transportIndex;
    steps[arrivalIndex].active = activeIndex === arrivalIndex;
    steps[arrivalIndex].reached = activeIndex !== arrivalIndex && activeIndex !== transportIndex;
    if (steps[activeIndex]) {
      steps[activeIndex].active = true;
    }
    hidePendingFlowStepTimes(steps);
    const displayCurrentStatus = normalizeText(steps[activeIndex]?.label) || currentStatus;

    return {
      canonicalStatus: currentStatus,
      trayCode,
      status: displayCurrentStatus,
      currentStatus: trayCode ? `当前托盘：${trayCode} | 当前状态：${displayCurrentStatus}` : `当前状态：${displayCurrentStatus}`,
      steps,
    };
  }

  const singleExperiment = resolveSingleTrayExperiment(input);
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
  SAMPLE_FLOW_STEPS,
  DETAIL_STATUS_OPTIONS,
  buildTrayFlowView,
  buildSamplesFlowView,
  buildSamplesTrayOverviewView,
  buildSamplesStagingView,
  dispatchStagingSamples,
  getSampleTrayList,
  normalizeLifecycleStatus,
  normalizeSamplesSnapshot,
  resolveFlowStatusByLocation,
  synchronizeSamplesForTrayCodes,
  submitSamplesBatchIntake,
  syncTrayStatusToSampleStatus,
  TRAY_STATUS_OPTIONS,
  updateTrayStatus,
  updateSampleDetail,
};
