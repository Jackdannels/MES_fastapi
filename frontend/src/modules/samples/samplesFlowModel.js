// 构建样品流转列表、暂存视图和更新辅助逻辑。
import { formatLocalDateTime } from "@/lib/dateTime";
import { isReturnedTrayStatus } from "@/lib/taskArchive";
import {
  APPEARANCE_SENT_STATUS,
  APPEARANCE_STOCKED_STATUS,
  DETAIL_STATUS_OPTIONS,
  EXPERIMENT_FLOW_STATUS_LABELS,
  FLOW_STEP_INDEX_BY_KEY,
  FLOW_STEP_KEY_BY_LABEL,
  RUNNING_EXPERIMENT_RUN_STATUSES,
  SAMPLE_FLOW_STEPS,
  TEST_LAB_OPTIONS,
  TRAY_STATUS_OPTIONS,
} from "./sampleFlow.constants";
import { normalizeText } from "./sampleFlow.shared";
import {
  asArray,
  compareText,
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
  normalizeLabels,
  normalizeLifecycleStatus,
  normalizeSampleRecord,
  normalizeSamplesSnapshot,
  resolveFlowStatusByLocation,
  syncTrayStatusToSampleStatus,
} from "./sampleFlow.status";
import {
  buildExperimentRouteSteps,
  buildLabDispatchStepLabel,
  experimentRequiresAppearanceInspection,
  findCompletedExperimentHistoryEntry,
  generateId,
  hasExperimentEnteredLabFlow,
  latestWithdrawalHistoryEntry,
  parseCodeList,
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
import {
  compareValue,
  filterSamplesForActiveTasks,
  resolveStatusClass,
} from "./sampleFlow.sampleTableHelpers";
import {
  appendSampleHistory,
  cloneSampleCollection,
  resolveSampleStatus,
  synchronizeSamplesForTrayCodes,
} from "./sampleFlow.sampleCollection";
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
  if (orderedExperiments.length <= 1) {
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
  const trayTargetExperimentCode = dispatchTargetExperimentCode || targetLabExperimentCode;
  const trayTargetExperiment = trayTargetExperimentCode
    ? orderedExperiments.find((experiment) => experiment.code === trayTargetExperimentCode)
    : null;
  const trayTargetEventStatus = trayTargetExperiment
    ? normalizeLifecycleStatus("", normalizeText(resolveExperimentEvent(experimentEventMap, trayTargetExperiment)?.status))
    : "";
  const trayTargetRuntimeStatus = trayTargetExperiment
    ? resolveExperimentRunStatus({
        experimentCode: trayTargetExperiment.code,
        experimentRuns: input.experimentRuns || input.experiment_runs,
        experimentRunTrays: firstNonEmptyArray(input.experimentRunTrays, input.experiment_run_trays),
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
  const hasRunningRuntimeExperiment = !trayIsReturned && orderedExperiments.some((experiment) =>
    RUNNING_EXPERIMENT_RUN_STATUSES.has(resolveExperimentRunStatus({
      experimentCode: experiment.code,
      experimentRuns: input.experimentRuns || input.experiment_runs,
      experimentRunTrays: firstNonEmptyArray(input.experimentRunTrays, input.experiment_run_trays),
      taskCode,
      trayCode,
    })),
  );
  const explicitIndex = explicitExperimentCode
    ? orderedExperiments.findIndex((experiment) => experiment.code === explicitExperimentCode)
    : -1;
  const experimentStatusMap = new Map(
    orderedExperiments.map((experiment) => {
      const event = resolveExperimentEvent(experimentEventMap, experiment);
      const runtimeStatus = resolveExperimentRunStatus({
        experimentCode: experiment.code,
        experimentRuns: input.experimentRuns || input.experiment_runs,
        experimentRunTrays: firstNonEmptyArray(input.experimentRunTrays, input.experiment_run_trays),
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
        experimentCode: experiment.code,
        experimentRuns: input.experimentRuns || input.experiment_runs,
        experimentRunTrays: firstNonEmptyArray(input.experimentRunTrays, input.experiment_run_trays),
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
  const explicitUnstartedAfterOtherCompletion =
    explicitUnfinishedExperiment
    && normalizeLifecycleStatus("", normalizedStatus) === "实验已完成"
    && completedExperiments.length > 0
    && !latestWithdrawalRestoreTarget
    && !hasExperimentEnteredLabFlow(experimentStatusMap.get(explicitUnfinishedExperiment.code))
      ? explicitUnfinishedExperiment
      : null;
  const currentExperiment =
    explicitExperiment
    || explicitUnstartedReturnedExperiment
    || explicitUnstartedAfterOtherCompletion
    || startedUnfinishedExperiments[0]
    || unfinishedExperiments[0]
    || null;
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
  const normalizedStatusIsAppearanceInspection = isAppearanceInspectionStatus(
    normalizeLifecycleStatus("", normalizedStatus),
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
    currentExperiment,
    ...startedUnfinishedExperiments.filter((experiment) => experiment.code !== currentExperiment.code),
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

function buildSamplesTrayOverviewView(input = {}) {
  const tasks = Array.isArray(input.tasks) ? input.tasks : [];
  const samples = Array.isArray(input.samples) ? input.samples : [];
  const query = normalizeText(input.query).toLowerCase();
  const taskMap = new Map(
    tasks.map((task) => [
      normalizeText(task?.code),
      {
        code: normalizeText(task?.code),
        name: normalizeText(task?.name),
        testType: normalizeText(task?.test_type),
      },
    ]),
  );
  const trayMap = new Map();

  samples.forEach((sample) => {
    const sampleCode = normalizeText(sample?.code);
    const taskCode = normalizeText(sample?.task_code);
    const task = taskMap.get(taskCode) || { code: taskCode, name: "", testType: "" };
    const sampleStatus = normalizeLifecycleStatus(sample?.location, sample?.status);
    getSampleTrayList(sample).forEach((tray) => {
      const trayCode = normalizeText(tray?.tray_code);
      if (!trayCode) {
        return;
      }
      const trayStatus = normalizeLifecycleStatus(sample?.location, normalizeText(tray?.status) || sampleStatus);
      if (isReturnedTrayStatus(trayStatus)) {
        return;
      }
      if (!trayMap.has(trayCode)) {
        trayMap.set(trayCode, {
          trayCode,
          taskCode,
          taskName: task.name,
          testType: task.testType,
          status: trayStatus,
          sampleCodes: [],
        });
      }
      const row = trayMap.get(trayCode);
      if (!row.sampleCodes.includes(sampleCode)) {
        row.sampleCodes.push(sampleCode);
      }
      if (!row.status) {
        row.status = trayStatus;
      }
    });
  });

  const rows = Array.from(trayMap.values())
    .map((row) => ({
      ...row,
      sampleCodes: row.sampleCodes.slice().sort(compareText),
      sampleCount: row.sampleCodes.length,
      statusClass: resolveStatusClass(row.status),
      sampleSummary: row.sampleCodes.slice().sort(compareText).join("、"),
    }))
    .filter((row) => {
      if (!query) {
        return true;
      }
      return [row.trayCode, row.taskCode, row.taskName, row.testType, row.status, row.sampleSummary]
        .map((item) => normalizeText(item).toLowerCase())
        .join(" ")
        .includes(query);
    })
    .sort((left, right) => compareText(left.trayCode, right.trayCode));

  return { rows };
}

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
        recordLatestFlowTime(restoreLabel, withdrawalTime);
      }
    }

    const sampleStatus = normalizeLifecycleStatus(sample?.location, sample?.status);
    if (parseTimeValue(sample?.created_at) > 0 && resolveFlowStatusRank("", sampleStatus) >= (FLOW_STEP_INDEX_BY_KEY.get("arrived") ?? 1)) {
      recordLatestFlowTime("到货", sample?.created_at, "fallback");
    }

    trayEntries.forEach((tray) => {
      const trayStatus = normalizeLifecycleStatus(sample?.location, normalizeText(tray?.status) || sampleStatus);
      const trayStatusLabel = isPostRetentionLocation(sample?.location) && isAmbiguousStagingStatus(trayStatus)
        ? "放置实验后暂存间"
        : trayStatus;
      recordLatestFlowTime(trayStatusLabel, tray?.updated_at || sample?.updated_at, "fallback");
    });

    historyEntries.forEach((entry) => {
      const time = entry?.time || entry?.updated_at || entry?.created_at || entry?.timestamp;
      const statusLabel = normalizeHistoryFlowLabel(entry?.status, entry?.location);
      const actionLabel = normalizeHistoryFlowLabel(entry?.action, entry?.location);
      const detailLabel = normalizeHistoryFlowLabel(entry?.detail, entry?.location);
      const hasPostTestStagingLabel = [statusLabel, actionLabel, detailLabel].includes("放置实验后暂存间");
      const actualAppearanceStorage =
        statusLabel === APPEARANCE_STOCKED_STATUS
        && normalizeText(entry?.location).includes("外观检测间");
      [statusLabel, actionLabel, detailLabel].forEach((label) => {
        if (hasPostTestStagingLabel && label === "已到达暂存间") {
          return;
        }
        if (!label || (!actualAppearanceStorage && shouldIgnoreHistoryTime(entry, label, entry?.location))) {
          return;
        }
        recordLatestFlowTime(label, time);
      });
      if (actualAppearanceStorage && !timeMap.get(APPEARANCE_SENT_STATUS)) {
        recordLatestFlowTime(APPEARANCE_SENT_STATUS, time);
      }

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
          if (experimentRequiresAppearanceInspection({ name: experimentEvent.experimentName })) {
            recordLatestFlowTime(APPEARANCE_SENT_STATUS, time);
          }
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
      const matchingTimes = asArray(stepTimeHistoryMap.get(label))
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
      const time = stepTimeMap.get(label) || "";
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
      experimentsBeforeCurrent.forEach((experiment, index) => {
        completedStepIndexes.push(pushExperimentStep(experiment, index));
        if (!experimentRequiresAppearanceInspection(experiment)) {
          return;
        }
        const completedAppearanceIndex = {
          sent: pushStep({
            key: `route-completed-appearance-sent-${index}`,
            label: APPEARANCE_SENT_STATUS,
          }),
          stocked: pushStep({
            key: `route-completed-appearance-stocked-${index}`,
            label: APPEARANCE_STOCKED_STATUS,
          }),
        };
        completedAppearanceIndexes.push(completedAppearanceIndex);
      });
      const latestCompletedTimeBeforeCurrent = experimentsBeforeCurrent.reduce(
        (latest, experiment, index) => Math.max(latest, completedExperimentTime(experiment, index)),
        0,
      );
      const routeSteps = Array.isArray(activeExperiment?.routeSteps) && activeExperiment.routeSteps.length > 0
        ? activeExperiment.routeSteps.filter(Boolean)
        : buildExperimentRouteSteps();
      const explicitRouteStatus = normalizeText(activeExperiment?.routeStatus);
      const lifecycleRouteStatus = normalizeLifecycleStatus(effectiveInput.location, effectiveInput.status);
      const normalizedRouteStatus = explicitRouteStatus
        ? normalizeLifecycleStatus(effectiveInput.location, explicitRouteStatus)
        : activeExperiment?.unstarted && !lifecycleRouteStatus
          ? ""
          : lifecycleRouteStatus;
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
      const activeExperimentCanOwnCompletedRoute =
        !activeExperiment?.unstarted || inputCurrentExperimentCode === normalizeText(activeExperiment?.code);
      const activeExperimentRequiresAppearance = experimentRequiresAppearanceInspection(activeExperiment);
      const shouldShowActiveAppearance =
        (
          isAppearanceInspectionStatus(normalizedRouteStatus)
          && activeExperimentRequiresAppearance
          && activeExperimentCanOwnCompletedRoute
        )
        || (
          activeExperimentRequiresAppearance
          && activeExperimentCanOwnCompletedRoute
          && (
            normalizedRouteStatus === "实验已完成"
            || normalizedRouteStatus === "实验完成"
          )
        );
      const activeAppearanceBelongsToCurrentExperiment = activeExperimentRequiresAppearance;
      const activeAppearanceIndexes = shouldShowActiveAppearance
        ? {
            sent: pushStep({ key: `route-appearance-sent-${currentExperimentIndex}`, label: APPEARANCE_SENT_STATUS }),
            stocked: pushStep({ key: `route-appearance-stocked-${currentExperimentIndex}`, label: APPEARANCE_STOCKED_STATUS }),
          }
        : null;
      const stableAppearanceIndexes =
        isAppearanceInspectionStatus(normalizedRouteStatus)
        && !completedAppearanceIndexes.at(-1)
        && !activeAppearanceIndexes
          ? {
              sent: pushStep({ key: `route-stable-appearance-sent-${currentExperimentIndex}`, label: APPEARANCE_SENT_STATUS }),
              stocked: pushStep({ key: `route-stable-appearance-stocked-${currentExperimentIndex}`, label: APPEARANCE_STOCKED_STATUS }),
            }
          : null;

      experimentsAfterCurrent.forEach((experiment, index) => {
        pushExperimentStep(experiment, index + experimentsBeforeCurrent.length + 1);
      });
      const postTestStagingIndex = pushStep({
        key: `route-post-staging-${currentExperimentIndex}`,
        label: "放置实验后暂存间",
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
          [indexes.sent, indexes.stocked].forEach((index) => {
            if (!suppressInferredAppearanceReached || normalizeText(steps[index]?.time)) {
              steps[index].reached = true;
            }
          });
        });
      };

      if (
        isAppearanceInspectionStatus(normalizedRouteStatus)
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
        normalizedRouteStatus === APPEARANCE_SENT_STATUS
        && latestCompletedAppearanceIndexes
        && latestCompletedExperimentRequiresAppearance
      ) {
        currentStatus = normalizedRouteStatus;
        activeIndex = latestCompletedAppearanceIndexes.sent;
        completedStepIndexes.forEach((stepIndex) => {
          steps[stepIndex].reached = true;
        });
        markCompletedAppearanceReached(latestCompletedAppearancePosition);
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
        steps[latestCompletedAppearanceIndexes.sent].reached = true;
      } else if (normalizedRouteStatus === APPEARANCE_SENT_STATUS && stableAppearanceIndexes) {
        currentStatus = normalizedRouteStatus;
        activeIndex = stableAppearanceIndexes.sent;
        completedStepIndexes.forEach((stepIndex) => {
          steps[stepIndex].reached = true;
        });
        markCompletedAppearanceReached();
      } else if (normalizedRouteStatus === APPEARANCE_STOCKED_STATUS && stableAppearanceIndexes) {
        currentStatus = normalizedRouteStatus;
        activeIndex = stableAppearanceIndexes.stocked;
        completedStepIndexes.forEach((stepIndex) => {
          steps[stepIndex].reached = true;
        });
        markCompletedAppearanceReached();
        steps[stableAppearanceIndexes.sent].reached = true;
      } else if (
        (normalizedRouteStatus === "实验已完成" || normalizedRouteStatus === "实验完成")
        && latestCompletedAppearanceIndexes
        && latestCompletedExperimentRequiresAppearance
      ) {
        currentStatus = APPEARANCE_SENT_STATUS;
        activeIndex = latestCompletedAppearanceIndexes.sent;
        completedStepIndexes.forEach((stepIndex) => {
          steps[stepIndex].reached = true;
        });
        markCompletedAppearanceReached(latestCompletedAppearancePosition);
      } else if (
        (normalizedRouteStatus === "实验已完成" || normalizedRouteStatus === "实验完成")
        && activeAppearanceIndexes
        && activeExperimentCanOwnCompletedRoute
      ) {
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
        currentStatus = APPEARANCE_SENT_STATUS;
        activeIndex = activeAppearanceIndexes.sent;
        routeIndexes.forEach((stepIndex) => {
          steps[stepIndex].reached = true;
        });
        steps[currentExperimentIndexInSteps].reached = true;
        markCompletedAppearanceReached();
      } else if (routeStatusIndex >= 0) {
        currentStatus = normalizedRouteStatus;
        activeIndex = routeIndexes[routeStatusIndex];
        markCompletedAppearanceReached();
        routeIndexes.forEach((stepIndex, index) => {
          if (index < routeStatusIndex) {
            steps[stepIndex].reached = true;
          }
        });
      } else if (activeExperiment?.unstarted && !normalizedRouteStatus) {
        currentStatus = currentExperimentLabel;
        activeIndex = currentExperimentIndexInSteps;
      } else if (normalizedRouteStatus === "实验进行中" || normalizedRouteStatus === "实验中") {
        currentStatus = `${experimentName}${EXPERIMENT_FLOW_STATUS_LABELS.running}`;
        activeIndex = currentExperimentIndexInSteps;
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
      } else if (normalizedRouteStatus === "放置实验后暂存间") {
        currentStatus = normalizedRouteStatus;
        activeIndex = postTestStagingIndex;
        markCompletedAppearanceReached();
        routeIndexes.forEach((stepIndex) => {
          steps[stepIndex].reached = true;
        });
        steps[currentExperimentIndexInSteps].reached = true;
      } else if (normalizedRouteStatus === APPEARANCE_SENT_STATUS && activeAppearanceIndexes) {
        currentStatus = normalizedRouteStatus;
        activeIndex = activeAppearanceIndexes.sent;
        routeIndexes.forEach((stepIndex) => {
          steps[stepIndex].reached = true;
        });
        if (activeAppearanceBelongsToCurrentExperiment) {
          steps[currentExperimentIndexInSteps].reached = true;
        }
        markCompletedAppearanceReached();
      } else if (normalizedRouteStatus === APPEARANCE_STOCKED_STATUS && activeAppearanceIndexes) {
        currentStatus = normalizedRouteStatus;
        activeIndex = activeAppearanceIndexes.stocked;
        routeIndexes.forEach((stepIndex) => {
          steps[stepIndex].reached = true;
        });
        if (activeAppearanceBelongsToCurrentExperiment) {
          steps[currentExperimentIndexInSteps].reached = true;
        }
        steps[activeAppearanceIndexes.sent].reached = true;
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
          steps[postTestStagingIndex].reached = true;
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
          isAppearanceInspectionStatus(normalizedFinalStatus)
          || normalizedFinalStatus === "实验已完成"
          || normalizedFinalStatus === "实验完成"
        );
      const finalAppearanceIndexes = shouldShowFinalAppearance
        ? {
            sent: pushStep({ key: "route-final-appearance-sent", label: APPEARANCE_SENT_STATUS }),
            stocked: pushStep({ key: "route-final-appearance-stocked", label: APPEARANCE_STOCKED_STATUS }),
          }
        : null;
      const postTestStagingIndex = pushStep({
        key: "route-final-post-staging",
        label: "放置实验后暂存间",
      });
      const returnedIndex = pushStep({
        key: "route-final-returned",
        label: "厂家收回",
      });
      if (normalizedFinalStatus === "放置实验后暂存间" || normalizedFinalStatus === "已到达暂存间") {
        activeIndex = postTestStagingIndex;
        steps[completedIndex].reached = true;
        currentStatus = "放置实验后暂存间";
      } else if (normalizedFinalStatus === APPEARANCE_SENT_STATUS && finalAppearanceIndexes) {
        activeIndex = finalAppearanceIndexes.sent;
        steps[completedIndex].reached = true;
        currentStatus = normalizedFinalStatus;
      } else if (normalizedFinalStatus === APPEARANCE_STOCKED_STATUS && finalAppearanceIndexes) {
        activeIndex = finalAppearanceIndexes.stocked;
        steps[completedIndex].reached = true;
        steps[finalAppearanceIndexes.sent].reached = true;
        currentStatus = normalizedFinalStatus;
      } else if ((normalizedFinalStatus === "实验已完成" || normalizedFinalStatus === "实验完成") && finalAppearanceIndexes) {
        activeIndex = finalAppearanceIndexes.sent;
        steps[completedIndex].reached = true;
        currentStatus = APPEARANCE_SENT_STATUS;
      } else if (normalizedFinalStatus === "厂家收回") {
        activeIndex = returnedIndex;
        steps[completedIndex].reached = true;
        if (finalAppearanceIndexes) {
          steps[finalAppearanceIndexes.sent].reached = true;
          steps[finalAppearanceIndexes.stocked].reached = true;
        }
        steps[postTestStagingIndex].reached = true;
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
      experimentCode: singleExperiment.code,
      experimentRuns: input.experimentRuns || input.experiment_runs,
      experimentRunTrays: firstNonEmptyArray(input.experimentRunTrays, input.experiment_run_trays),
      taskCode: effectiveInput.taskCode,
      trayCode: effectiveInput.trayCode,
    })
    : "";
  const singleExperimentEventStatus = normalizeLifecycleStatus("", singleExperimentEvent?.status);
  let status = normalizeLifecycleStatus(effectiveInput.location, effectiveInput.status) || SAMPLE_FLOW_STEPS[0].label;
  if (
    singleExperimentEventStatus === "实验已完成"
    && experimentFlowStatusRank(singleExperimentEventStatus) >= experimentFlowStatusRank(status)
  ) {
    status = singleExperimentEventStatus;
  } else if (
    singleExperimentRuntimeStatus
    && experimentFlowStatusRank(singleExperimentRuntimeStatus) >= experimentFlowStatusRank(status)
  ) {
    status = singleExperimentRuntimeStatus;
  }
  const singleExperimentRequiresAppearance = singleExperiment && experimentRequiresAppearanceInspection(singleExperiment);
  const shouldShowSingleAppearance =
    isAppearanceInspectionStatus(status)
    || (
      singleExperimentRequiresAppearance
      && (
        singleExperimentEventStatus === "实验已完成"
        || normalizeLifecycleStatus("", singleExperimentRuntimeStatus) === "实验已完成"
      )
    );
  if (shouldShowSingleAppearance && (status === "实验已完成" || status === "实验完成")) {
    status = APPEARANCE_SENT_STATUS;
  }
  const singleFlowSteps = shouldShowSingleAppearance
    ? SAMPLE_FLOW_STEPS.flatMap((step) =>
        step.key === "completed"
          ? [
              step,
              { key: "sent_to_appearance", label: APPEARANCE_SENT_STATUS },
              { key: "appearance_storage", label: APPEARANCE_STOCKED_STATUS },
            ]
          : [step],
      )
    : SAMPLE_FLOW_STEPS;
  const currentStepIndex = singleFlowSteps.findIndex((step) => step.label === status);
  const currentKey = currentStepIndex >= 0 ? singleFlowSteps[currentStepIndex].key : FLOW_STEP_KEY_BY_LABEL.get(status) || SAMPLE_FLOW_STEPS[0].key;
  const currentIndex = currentStepIndex >= 0 ? currentStepIndex : Math.max(0, singleFlowSteps.findIndex((step) => step.key === currentKey));
  const singleExperimentName = normalizeText(singleExperiment?.displayName || singleExperiment?.name);
  const singleExperimentIdentityName = normalizeText(singleExperiment?.name);
  const singleExperimentDestinationLab = normalizeText(effectiveInput.dispatchTargetLab) || normalizeText(singleExperiment?.destinationLab);
  const displayStatus = buildSingleExperimentStatusLabel(singleExperimentName, status);
  const singleExperimentCompleted = singleExperimentEventStatus === "实验已完成";
  const holdUncompletedSingleExperiment =
    status === "厂家收回" && Boolean(singleExperimentName) && !singleExperimentCompleted;
  const preExperimentReturnedReachedIndex = FLOW_STEP_INDEX_BY_KEY.get("arrived_staging") ?? 3;

  const steps = singleFlowSteps.map((step, index) => {
      const label = buildSingleExperimentStatusLabel(singleExperimentName, step.label);
      const identityLabel = buildSingleExperimentStatusLabel(singleExperimentIdentityName || singleExperimentName, step.label);
      const displayLabel = step.key === "sent_to_lab" ? buildLabDispatchStepLabel(singleExperimentDestinationLab) : label;
      const active = step.key === currentKey;
      const reached = holdUncompletedSingleExperiment ? index <= preExperimentReturnedReachedIndex : index < currentIndex;
      const time = active || reached ? stepTimeMap.get(label) || stepTimeMap.get(identityLabel) || stepTimeMap.get(step.label) || "" : "";
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

// 在筛选和排序后构建分页样品流转表格。
function buildSamplesFlowView(input = {}) {
  const tasks = Array.isArray(input.tasks) ? input.tasks : [];
  const samples = filterSamplesForActiveTasks(input.samples, tasks).slice();
  const filters = input.filters && typeof input.filters === "object" ? input.filters : {};
  const sort = input.sort && typeof input.sort === "object" ? input.sort : {};
  const pageSize = Number(input.pageSize) > 0 ? Number(input.pageSize) : 8;

  const query = normalizeText(filters.query).toLowerCase();
  const selectedTaskCode = normalizeText(filters.taskCode);
  const selectedStatus = normalizeText(filters.status);

  const normalizedSamples = samples.map((sample) => normalizeSampleRecord(sample));
  const rows = normalizedSamples
    .filter((sample) => {
      // 列表筛选同时支持任务号、状态和自由关键词。
      if (selectedTaskCode && normalizeText(sample.task_code) !== selectedTaskCode) {
        return false;
      }
      if (selectedStatus && normalizeText(sample.status) !== selectedStatus) {
        return false;
      }
      if (!query) {
        return true;
      }
      const trayText = getSampleTrayList(sample)
        .map((tray) => normalizeText(tray.tray_code))
        .join(" ");
      const searchText = [
        sample.task_code,
        sample.code,
        trayText,
        sample.location,
        sample.owner,
        sample.status,
        sample.flow_status,
      ]
        .map((item) => normalizeText(item).toLowerCase())
        .join(" ");
      return searchText.includes(query);
    })
    .map((sample) => {
      const trayCodes = getSampleTrayList(sample).map((tray) => normalizeText(tray?.tray_code)).filter(Boolean);
      return {
        ...sample,
        // 托盘编号和状态样式都在视图层消费，因此提前派生好。
        trayCodes,
        trayCodesText: trayCodes.join("、"),
        statusClass: resolveStatusClass(sample.status),
      };
    });

  const sortKey = normalizeText(sort.key);
  const sortDirection = normalizeText(sort.direction) === "desc" ? "desc" : "asc";
  const sortedRows = rows.slice().sort((left, right) => {
    if (!sortKey) {
      return compareValue(left.code, right.code, "asc");
    }
    const order = compareValue(left?.[sortKey], right?.[sortKey], sortDirection);
    if (order !== 0) {
      return order;
    }
    return compareValue(left.code, right.code, "asc");
  });

  const totalPages = Math.max(1, Math.ceil(sortedRows.length / pageSize));
  const rawPage = Number.parseInt(String(input.page ?? 1), 10);
  const currentPage = Number.isFinite(rawPage) ? Math.min(Math.max(rawPage, 1), totalPages) : 1;
  const startIndex = (currentPage - 1) * pageSize;

  const taskCodes = Array.from(
    new Set(normalizedSamples.map((sample) => normalizeText(sample?.task_code)).filter(Boolean)),
  ).sort((left, right) => left.localeCompare(right, "zh-Hans-CN"));
  const statusOptions = Array.from(new Set(normalizedSamples.map((sample) => normalizeText(sample?.status)).filter(Boolean))).sort(
    (left, right) => left.localeCompare(right, "zh-Hans-CN"),
  );

  return {
    currentPage,
    rows: sortedRows.slice(startIndex, startIndex + pageSize),
    statusOptions,
    taskOptions: taskCodes,
    totalCount: sortedRows.length,
    totalPages,
  };
}

// 对多个样品一次性执行批量接样操作。
function submitSamplesBatchIntake(input = {}) {
  const labels = normalizeLabels(input.labels);
  const samples = Array.isArray(input.samples)
    ? input.samples.map((sample) => ({
        ...sample,
        history: Array.isArray(sample?.history) ? sample.history.slice() : [],
        trays: Array.isArray(sample?.trays) ? sample.trays.slice() : [],
      }))
    : [];
  const payload = input.payload && typeof input.payload === "object" ? input.payload : {};
  const codes = parseCodeList(payload.codes);
  const targetLocation =
    normalizeText(payload.location) ||
    normalizeText(labels.intakeLocation) ||
    normalizeText(labels.unpackingLocation) ||
      normalizeText(labels.preRetentionLocation) ||
      normalizeText(labels.retentionLocation);

  // 批量接样要求同时提供目标位置和至少一个样品号。
  if (!targetLocation || codes.length === 0) {
    return { error: "\u8BF7\u586B\u5199\u5165\u5E93\u4F4D\u7F6E\u548C\u6837\u54C1\u5217\u8868\u3002", samples };
  }

  const now = input.now || formatLocalDateTime();
  codes.forEach((code) => {
    const existing = samples.find((sample) => normalizeText(sample.code) === code);
    const nextStatus = resolveSampleStatus(targetLocation, labels);
    if (existing) {
      // 已存在样品按“更新位置与状态”处理，不重复生成记录。
      existing.location = targetLocation;
      existing.owner = normalizeText(payload.owner) || existing.owner || "";
      existing.status = normalizeLifecycleStatus(targetLocation, nextStatus, labels);
      existing.flow_status = existing.status;
      existing.updated_at = now;
      existing.history = appendSampleHistory(existing, "\u6279\u91CF\u5165\u5E93", "", now);
      return;
    }

    const created = {
      // 不存在的样品号会在批量接样时被直接创建。
      id: generateId("sample"),
      code,
      task_code: "",
      location: targetLocation,
      owner: normalizeText(payload.owner),
      status: normalizeLifecycleStatus(targetLocation, nextStatus, labels),
      flow_status: normalizeLifecycleStatus(targetLocation, nextStatus, labels),
      created_at: now,
      updated_at: now,
      trays: [],
      history: [],
    };
    created.history = appendSampleHistory(created, "\u6279\u91CF\u5165\u5E93", "", now);
    samples.unshift(created);
  });

  return { error: "", samples: normalizeSamplesSnapshot(samples, labels) };
}

// 更新单个样品可编辑的明细字段及其派生状态。
function updateSampleDetail(input = {}) {
  const sample = input.sample && typeof input.sample === "object" ? { ...input.sample } : null;
  if (!sample) {
    return { error: "\u672A\u627E\u5230\u6837\u54C1\u3002", sample: null };
  }
  const payload = input.payload && typeof input.payload === "object" ? input.payload : {};
  const labels = normalizeLabels(input.labels);
  const nextStatus = normalizeText(payload.status) || normalizeText(sample.status);
  const nextRemark = normalizeText(payload.remark);
  const now = input.now || formatLocalDateTime();
  const trayCodes = getSampleTrayList(sample).map((tray) => normalizeText(tray?.tray_code)).filter(Boolean);

  if (trayCodes.length > 0) {
    const result = synchronizeSamplesForTrayCodes({
      historyAction: "\u6837\u54C1\u8BE6\u60C5\u66F4\u65B0",
      historyDetail: nextRemark,
      labels,
      now,
      samples: [sample],
      status: nextStatus,
      trayCodes,
    });
    return { error: "", sample: result.samples[0] || sample };
  }

  // 明细抽屉只允许改状态与备注，流转状态由位置和状态共同派生。
  sample.status = normalizeLifecycleStatus(sample.location, nextStatus, labels);
  sample.flow_status = sample.status;
  sample.updated_at = now;
  sample.history = appendSampleHistory(sample, "\u6837\u54C1\u8BE6\u60C5\u66F4\u65B0", nextRemark, now);

  return { error: "", sample };
}

function updateTrayStatus(input = {}) {
  const trayCode = normalizeText(input.trayCode);
  const labels = normalizeLabels(input.labels);
  const now = input.now || formatLocalDateTime();
  const samples = cloneSampleCollection(input.samples);

  if (!trayCode || !normalizeText(input.status)) {
    return { error: "请选择托盘和目标状态。", samples };
  }

  const nextStatus = syncTrayStatusToSampleStatus(input.status, "", labels);
  const result = synchronizeSamplesForTrayCodes({
    historyAction: "托盘状态更新",
    historyDetail: `${trayCode} -> ${nextStatus}`,
    labels,
    now,
    samples,
    status: nextStatus,
    trayCodes: [trayCode],
  });

  return {
    error: result.updatedCount > 0 ? "" : `未找到托盘 ${trayCode}。`,
    samples: result.samples,
  };
}

// 构建当前位于前置或实验后暂存间的只读样品列表。
function buildSamplesStagingView(input = {}) {
  const labels = normalizeLabels(input.labels);
  const samples = Array.isArray(input.samples) ? input.samples : [];
  const filters = input.filters && typeof input.filters === "object" ? input.filters : {};
  const query = normalizeText(filters.query || input.query).toLowerCase();
  const selectedTaskCode = normalizeText(filters.taskCode);
  const selectedStatus = normalizeText(filters.status);
  const pageSize = Number(input.pageSize) > 0 ? Number(input.pageSize) : 8;
  const selectedCodes = Array.isArray(input.selectedCodes)
    ? input.selectedCodes.map((code) => normalizeText(code)).filter(Boolean)
    : [];
  const selectedSet = new Set(selectedCodes);
  const preRetentionLocation = normalizeText(labels.preRetentionLocation || labels.retentionLocation);
  const postRetentionLocation = normalizeText(labels.postRetentionLocation);

  const normalizedSamples = normalizeSamplesSnapshot(samples, labels);
  const stagingSamples = normalizedSamples.filter((sample) => {
    // 样品信息中的暂存间只做查看，包含前置暂存间和实验后暂存间。
    const location = normalizeText(sample?.location);
    return location === preRetentionLocation || location === postRetentionLocation;
  });
  const rows = stagingSamples
    .filter((sample) => {
      if (selectedTaskCode && normalizeText(sample?.task_code) !== selectedTaskCode) {
        return false;
      }
      if (selectedStatus && normalizeText(sample?.status) !== selectedStatus) {
        return false;
      }
      if (!query) {
        return true;
      }
      const searchText = [
        sample?.code,
        sample?.task_code,
        sample?.location,
        sample?.status,
        sample?.owner,
        sample?.flow_status,
      ]
        .map((item) => normalizeText(item).toLowerCase())
        .join(" ");
      return searchText.includes(query);
    })
    .map((sample) => {
      const trayCodes = getSampleTrayList(sample).map((tray) => normalizeText(tray?.tray_code)).filter(Boolean);
      return {
        ...sample,
        selected: selectedSet.has(normalizeText(sample?.code)),
        statusClass: resolveStatusClass(sample?.status),
        trayCodes,
        trayCodesText: trayCodes.join("、"),
      };
    })
    .sort((left, right) => compareValue(left.code, right.code, "asc"));

  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const rawPage = Number.parseInt(String(input.page ?? 1), 10);
  const currentPage = Number.isFinite(rawPage) ? Math.min(Math.max(rawPage, 1), totalPages) : 1;
  const startIndex = (currentPage - 1) * pageSize;
  const taskOptions = Array.from(new Set(stagingSamples.map((sample) => normalizeText(sample?.task_code)).filter(Boolean))).sort(
    (left, right) => left.localeCompare(right, "zh-Hans-CN"),
  );
  const statusOptions = Array.from(new Set(stagingSamples.map((sample) => normalizeText(sample?.status)).filter(Boolean))).sort(
    (left, right) => left.localeCompare(right, "zh-Hans-CN"),
  );

  return {
    count: rows.length,
    currentPage,
    labOptions: TEST_LAB_OPTIONS.slice(),
    rows: rows.slice(startIndex, startIndex + pageSize),
    statusOptions,
    taskOptions,
    totalCount: rows.length,
    totalPages,
  };
}

// 将选中的暂存样品派发到目标实验室和责任人。
function dispatchStagingSamples(input = {}) {
  const labels = normalizeLabels(input.labels);
  let samples = cloneSampleCollection(input.samples);
  const payload = input.payload && typeof input.payload === "object" ? input.payload : {};
  const selectedCodes = Array.isArray(input.selectedCodes) ? input.selectedCodes : [];
  const targetLab = normalizeText(payload.targetLab);
  const owner = normalizeText(payload.owner);
  const preRetentionLocation = normalizeText(labels.preRetentionLocation || labels.retentionLocation);
  const codes = Array.from(new Set([...selectedCodes, ...parseCodeList(payload.codes)].map((code) => normalizeText(code)).filter(Boolean)));

  // 暂存派发要求目标实验室和样品集合都有效。
  if (!targetLab || codes.length === 0) {
    return {
      error: "请填写样品编号并选择目标实验室。",
      samples,
      dispatchedCodes: [],
    };
  }

  const missing = [];
  const notStaging = [];
  const dispatchedCodes = [];
  const now = input.now || formatLocalDateTime();
  const trayCodesToSync = new Set();

  codes.forEach((code) => {
    const sample = samples.find((item) => normalizeText(item?.code) === code);
    if (!sample) {
      missing.push(code);
      return;
    }
    if (normalizeText(sample.location) !== preRetentionLocation) {
      notStaging.push(code);
      return;
    }

    // 只有当前位于暂存间的样品才允许派发到正式实验室。
    getSampleTrayList(sample).forEach((tray) => {
      const trayCode = normalizeText(tray?.tray_code);
      if (trayCode) {
        trayCodesToSync.add(trayCode);
      }
    });
    sample.location = targetLab;
    sample.owner = owner || normalizeText(sample.owner);
    sample.status = normalizeLifecycleStatus(targetLab, "\u5DF2\u5230\u8FBE\u5B9E\u9A8C\u5BA4", labels);
    sample.flow_status = sample.status;
    sample.updated_at = now;
    sample.history = appendSampleHistory(sample, "暂存间派发", "", now);
    dispatchedCodes.push(code);
  });

  if (trayCodesToSync.size > 0) {
    const synced = synchronizeSamplesForTrayCodes({
      historyAction: "",
      labels,
      location: targetLab,
      now,
      owner,
      samples,
      status: "\u5DF2\u5230\u8FBE\u5B9E\u9A8C\u5BA4",
      trayCodes: Array.from(trayCodesToSync),
    });
    samples = synced.samples;
  }

  const warnings = [];
  if (missing.length) {
    warnings.push(`未找到样品：${missing.join("、")}`);
  }
  if (notStaging.length) {
    warnings.push(`不在暂存间：${notStaging.join("、")}`);
  }

  return {
    // 部分成功时会同时返回更新后的样品集合和告警文本。
    error: warnings.length ? `${warnings.join("；")}。` : "",
    samples,
    dispatchedCodes,
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
