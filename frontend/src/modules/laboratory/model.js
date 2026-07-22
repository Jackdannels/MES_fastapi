import {
  buildTrayFlowView,
  normalizeLifecycleStatus,
  synchronizeSamplesForTrayCodes,
} from "@/modules/samples/samplesFlowModel";
import { normalizeAxisCodes } from "@/lib/axisCodes";
import { serverNowDate, serverNowMs } from "@/lib/serverClock";
import { formatLocalDateTime } from "@/lib/dateTime";
import { scheduleMatchesLab } from "@/lib/labIdentity";
import { normalizeTrayScanCode } from "@/lib/trayQrCode";
import {
  STATUS_WAITING,
} from "@/modules/tasks/model";
import { isAxisPartialProgressStatus } from "@/modules/experiment-progress/axisProgress";
import {
  COMPLETED_EXPERIMENT_STATUSES,
  COMPLETED_TRAY_STATUSES,
  buildAxisProgressForSchedule,
  buildScheduleAxisProgressTrayCodes,
  historyEntryAppliesToTray,
  relationIsCompleted,
  resolveRelationExperimentCode,
  resolveRelationRunNo,
  resolveRelationStatus,
  resolveRelationTaskCode,
  resolveRelationTrayCode,
  resolveRunExperimentCode,
  resolveRunNo,
  resolveRunStatus,
  resolveRunTaskCode,
  resolveSubExperimentCode,
  resolveTrayCode,
  scheduleExperimentIsCompleted,
  stepAxisCode,
  stepExperimentCode,
  stepIsCompleted,
  stepRunNo,
  stepTaskCode,
} from "./scheduleCompletion";
import {
  completeLaboratoryComparison,
  completeLaboratoryInstallation,
  confirmLaboratoryExperiment,
  createLaboratoryWorkflow,
  getLaboratoryActionState,
} from "./workflowState";
import {
  AXIS_PARTIAL_REAL_FOLLOW_UP_STATUSES,
  EXPERIMENT_COMPLETED_STATUS,
  LAB_COMPARE_STATUS,
  LAB_INSTALL_STATUS,
  LAB_READY_STATUS,
  LAB_RESET_STATUS,
  SALT_SPRAY_LAB,
} from "./laboratoryConstants";
import {
  buildLaboratoryHistoryEntry,
  resolveLatestAnyExperimentHistorySnapshot,
  resolveLatestExperimentHistorySnapshot,
  resolveLatestLaboratoryDispatchSnapshot,
  resolvePreDispatchSnapshot,
  resolvePreviousCompletedExperimentSnapshot,
  resolvePreviousStableSnapshot,
} from "./laboratoryHistory";
import {
  experimentHistoryStatusIsWithdrawal,
  getLaboratoryOperationLock,
  getRunningTrayRowsForCurrentTask,
  isPreviousExperimentCompletionForCurrentTask,
  laboratoryRowHasStartedOperation,
  resolveLaboratoryStatusRank,
  resolveTrayExperimentOperationState,
  rowCanEnterCurrentExperimentAfterOtherCompletion,
  rowCanUseCurrentExperimentAfterCompletedTarget,
  rowHasCompletedAxisSubExperimentForOtherExperiment,
  rowHasPartialAxisCompletionStatus,
  rowHasPreDispatchLifecycleStatus,
  rowHasReturnedStatus,
  rowHasUnfinishedDifferentTargetExperiment,
  rowPartialAxisCompletionStatusLabels,
  rowPartialAxisStatusMatchesCurrentExperiment,
  taskHasCurrentLaboratoryDispatch,
  taskHasWrongLaboratoryDispatch,
  trayCanEnterCurrentExperimentAfterOtherCompletion,
  trayIsCompletedForCurrentExperiment,
  trayIsDispatchedToCurrentLaboratory,
  trayIsOccupiedByDifferentLaboratory,
  trayLaboratoryLocation,
  trayLifecycleIsBeforeLaboratoryDispatch,
} from "./laboratoryTrayEligibility";
import {
  buildActiveOtherExperimentComparisonResult,
  buildBlockedComparisonResult,
  buildNotDispatchedComparisonResult,
  buildWrongLaboratoryDispatchResult,
} from "./laboratoryComparisonFeedback";
import {
  addDurationToDateTime,
  buildRunningExperimentView,
  formatDateKey,
  formatDateTime,
  formatTime,
  resolvePlannedDurationMs,
  toTime,
  uniqueValues,
} from "./laboratoryPresentation";
import {
  RUNNING_EXPERIMENT_RUN_STATUSES,
  buildActiveOtherExperimentRunLocks,
  buildCompletedExperimentCodesByTrayCode,
  buildCompletedExperimentRecordCodesByTrayCode,
  buildCompletedScheduleTrayCodeSet,
  buildExperimentCodesByTrayCode,
  buildExperimentTrayCodeMap,
  findActiveExperimentRun,
  findActiveExperimentRunTrayRelations,
} from "./laboratoryRunIndex";
import {
  buildExperimentMap,
  buildExperimentRecordMap,
  buildSampleMap,
  buildTaskMap,
  experimentIsCompletedInSampleHistory,
  isFixtureReady,
  resolveCurrentExperimentTrayStatus,
  resolveUnifiedTrayLifecycleCandidate,
  shouldReplaceUnifiedTrayLifecycle,
  shouldRevertLaboratoryTrayStatus,
} from "./laboratoryTrayState";
import {
  activateLatestCompletedExperimentStep,
  buildLaboratoryTaskFlow,
  parsePartialAxisExperimentName,
  parsePartialAxisStatusLabelCounts,
  resolveLaboratoryTaskAxisStatusLabel,
  resolveLaboratoryTaskStatus,
  resolveSelectedTrayFlowStatus,
  selectedTrayAxisPartialStatusIsSupersededByLaterExperimentCompletion,
  trayHasCurrentExperimentDisplayDispatch,
  trayHasCurrentExperimentFlowContext,
} from "./laboratoryTaskFlow";
const normalizeText = (value) => String(value ?? "").trim();
const asArray = (value) => (Array.isArray(value) ? value : []);
const selectedTrayHasCompletedAxisRunEvidence = ({ experimentRunTrays = [], flowContextTask = null, selectedTrayRow = null }) => {
  const taskCode = normalizeText(flowContextTask?.taskCode);
  const experimentCode = normalizeText(flowContextTask?.experimentCode);
  const trayCode = normalizeText(selectedTrayRow?.trayCode);
  if (!taskCode || !experimentCode || !trayCode) {
    return false;
  }
  return asArray(experimentRunTrays).some((relation) =>
    resolveRelationTaskCode(relation) === taskCode
    && resolveRelationExperimentCode(relation) === experimentCode
    && resolveRelationTrayCode(relation) === trayCode
    && relationIsCompleted(relation),
  );
};
const resolveSelectedTrayPartialAxisEvidenceStatus = ({
  experimentRuns = [],
  experimentRunSteps = [],
  experimentRunTrays = [],
  experiments = [],
  flowContextTask = null,
  samples = [],
  selectedTrayRow = null,
} = {}) => {
  const taskCode = normalizeText(flowContextTask?.taskCode);
  const trayCode = normalizeText(selectedTrayRow?.trayCode);
  if (!taskCode || !trayCode) {
    return "";
  }
  const sampleTrayMatches = (sample) => {
    const sampleTrayCodes = asArray(sample?.trays).map(resolveTrayCode).filter(Boolean);
    return !sampleTrayCodes.length || sampleTrayCodes.includes(trayCode);
  };
  const historyCandidates = [];
  asArray(samples).forEach((sample) => {
    if (normalizeText(sample?.task_code || sample?.taskCode) !== taskCode || !sampleTrayMatches(sample)) {
      return;
    }
    asArray(sample?.history).forEach((entry) => {
      if (!historyEntryAppliesToTray(entry, asArray(sample?.trays).map(resolveTrayCode).filter(Boolean), trayCode)) {
        return;
      }
      const status = normalizeText(entry?.status);
      const detail = normalizeText(entry?.detail);
      const partialStatus = [status, detail].find((value) => isAxisPartialProgressStatus(value)) || "";
      if (!partialStatus) {
        return;
      }
      historyCandidates.push({
        status: partialStatus,
        time: toTime(entry?.time || entry?.updated_at || entry?.created_at) || 0,
      });
    });
  });
  if (historyCandidates.length > 0) {
    historyCandidates.sort((left, right) => left.time - right.time);
    return historyCandidates[historyCandidates.length - 1].status;
  }

  const experimentByCode = new Map(
    asArray(experiments)
      .filter((experiment) => normalizeText(experiment?.task_code || experiment?.taskCode) === taskCode)
      .map((experiment) => [
        normalizeText(experiment?.experiment_code || experiment?.experimentCode || experiment?.code),
        experiment,
      ])
      .filter(([experimentCode]) => Boolean(experimentCode)),
  );
  const runByNo = new Map(
    asArray(experimentRuns)
      .filter((run) => normalizeText(run?.task_code || run?.taskCode) === taskCode)
      .map((run) => [resolveRunNo(run), run])
      .filter(([runNo]) => Boolean(runNo)),
  );
  const completedAxisCodesByExperiment = new Map();
  const runNosForTray = new Set();
  asArray(experimentRunTrays).forEach((relation) => {
    if (
      resolveRelationTaskCode(relation) !== taskCode
      || resolveRelationTrayCode(relation) !== trayCode
      || !relationIsCompleted(relation)
    ) {
      return;
    }
    const runNo = resolveRelationRunNo(relation);
    if (runNo) {
      runNosForTray.add(runNo);
    }
  });
  asArray(experimentRuns).forEach((run) => {
    if (
      resolveRunTaskCode(run) === taskCode
      && asArray(run?.tray_codes || run?.trayCodes).map(normalizeText).includes(trayCode)
      && COMPLETED_EXPERIMENT_STATUSES.has(resolveRunStatus(run))
    ) {
      const runNo = resolveRunNo(run);
      if (runNo) {
        runNosForTray.add(runNo);
      }
    }
  });
  runNosForTray.forEach((runNo) => {
    const run = runByNo.get(runNo);
    const experimentCode = resolveRunExperimentCode(run);
    const axisCodes = normalizeAxisCodes(run?.axis_codes ?? run?.axisCodes);
    if (!experimentCode || axisCodes.length === 0) {
      return;
    }
    const current = completedAxisCodesByExperiment.get(experimentCode) || new Set();
    axisCodes.forEach((axisCode) => current.add(axisCode));
    completedAxisCodesByExperiment.set(experimentCode, current);
  });
  asArray(experimentRunSteps).forEach((step) => {
    const runNo = stepRunNo(step);
    const experimentCode = stepExperimentCode(step);
    if (
      stepTaskCode(step) !== taskCode
      || !runNosForTray.has(runNo)
      || !experimentCode
      || !stepIsCompleted(step)
    ) {
      return;
    }
    const axisCode = stepAxisCode(step);
    if (!axisCode) {
      return;
    }
    const current = completedAxisCodesByExperiment.get(experimentCode) || new Set();
    current.add(axisCode);
    completedAxisCodesByExperiment.set(experimentCode, current);
  });
  for (const [experimentCode, completedAxisCodes] of completedAxisCodesByExperiment.entries()) {
    const experiment = experimentByCode.get(experimentCode);
    const requiredAxisCodes = normalizeAxisCodes(experiment?.axis_codes ?? experiment?.axisCodes);
    if (requiredAxisCodes.length > 0 && completedAxisCodes.size > 0 && completedAxisCodes.size < requiredAxisCodes.length) {
      const experimentName = normalizeText(experiment?.experiment_name || experiment?.experimentName || experiment?.name);
      return experimentName ? `${experimentName}部分完成 ${completedAxisCodes.size}/${requiredAxisCodes.length}轴` : "";
    }
  }
  return "";
};
const buildActiveAxisProgressTrayCodes = ({ baseTrayCodes = [], currentTaskContext = null, trayRows = [] }) => {
  const unfinishedWorkflowTrayCodes = asArray(trayRows)
    .filter((row) => {
      if (!row || row?.completedForCurrentExperiment === true || rowHasReturnedStatus(row)) {
        return false;
      }
      if (trayLifecycleIsBeforeLaboratoryDispatch(row)) {
        return false;
      }
      const currentExperimentCode = normalizeText(currentTaskContext?.experimentCode);
      const experimentCodes = asArray(row?.experimentCodes).map((code) => normalizeText(code)).filter(Boolean);
      const hasCurrentExperimentRelation = Boolean(
        currentExperimentCode && experimentCodes.includes(currentExperimentCode),
      );
      const targetExperimentCode = normalizeText(row?.targetExperimentCode || row?.target_experiment_code);
      const targetLab = normalizeText(row?.targetLab || row?.target_lab);
      const currentLab = normalizeText(currentTaskContext?.device);
      const pointsToOtherExperiment = Boolean(
        targetExperimentCode && currentExperimentCode && targetExperimentCode !== currentExperimentCode,
      );
      const pointsToOtherLab = Boolean(targetLab && currentLab && targetLab !== currentLab);
      if (hasCurrentExperimentRelation) {
        if ((pointsToOtherExperiment || pointsToOtherLab) && row?.completedForOtherExperiment !== true) {
          return false;
        }
        return row?.completedForOtherExperiment === true
          || rowHasPartialAxisCompletionStatus(row)
          || resolveLaboratoryStatusRank(row?.trayStatus || row?.displayStatus || row?.lifecycleStatus) > 0;
      }
      return trayHasCurrentExperimentFlowContext(row, currentTaskContext)
        || trayIsDispatchedToCurrentLaboratory(row, currentTaskContext)
        || rowCanEnterCurrentExperimentAfterOtherCompletion(row, currentTaskContext)
        || rowCanUseCurrentExperimentAfterCompletedTarget(row, currentTaskContext);
    })
    .map((row) => normalizeText(row?.trayCode))
    .filter(Boolean);
  return uniqueValues([
    ...asArray(baseTrayCodes).map(normalizeText).filter(Boolean),
    ...unfinishedWorkflowTrayCodes,
  ]);
};

const collectTrayRows = ({
  device,
  experimentName,
  experimentRecordMap,
  experimentRuns,
  experimentRunTrays,
  experimentTrayCodeMap,
  experimentKey,
  relatedSamples,
  schedule,
  taskCode,
}) => {
  const trayRows = [];
  const indexByTrayCode = new Map();
  const experimentCodesByTrayCode = buildExperimentCodesByTrayCode(experimentTrayCodeMap);
  const currentExperimentCode = normalizeText(String(experimentKey).split("::")[1]);
  const currentScheduleIsAxisSubExperiment = Boolean(
    resolveSubExperimentCode(schedule)
    && normalizeAxisCodes(schedule?.axis_codes ?? schedule?.axisCodes).length > 0,
  );
  const completedCurrentScheduleTrayCodes = currentScheduleIsAxisSubExperiment
    ? buildCompletedScheduleTrayCodeSet({ experimentRuns, experimentRunTrays, schedule })
    : new Set();
  const completedExperimentCodesByTrayCode = buildCompletedExperimentCodesByTrayCode({ experimentRunTrays, taskCode });
  const completedExperimentRecordCodesByTrayCode = buildCompletedExperimentRecordCodesByTrayCode({
    currentExperimentCode,
    experimentRecordMap,
    experimentTrayCodeMap,
    taskCode,
  });

  const pushRow = (
    trayCode,
    sampleCode = "",
    quantity = "",
    owner = "",
    location = "",
    fixtureReady = false,
    targetLab = "",
    targetExperimentCode = "",
    hasCurrentExperimentHistory = false,
  ) => {
    const normalizedTrayCode = normalizeText(trayCode);
    if (!normalizedTrayCode) {
      return;
    }
    const normalizedTargetLab = normalizeText(targetLab);
    const normalizedTargetExperimentCode = normalizeText(targetExperimentCode);
    const existingIndex = indexByTrayCode.get(normalizedTrayCode);
    if (existingIndex !== undefined) {
      const current = trayRows[existingIndex];
      if (sampleCode && !current.sampleCodes.includes(sampleCode)) {
        current.sampleCodes.push(sampleCode);
      }
      if (!current.owner && owner) {
        current.owner = owner;
      }
      if (!current.quantity && quantity) {
        current.quantity = quantity;
      }
      if (!current.currentLocation && location) {
        current.currentLocation = location;
      }
      if (!current.targetLab && normalizedTargetLab) {
        current.targetLab = normalizedTargetLab;
      }
      if (!current.targetExperimentCode && normalizedTargetExperimentCode) {
        current.targetExperimentCode = normalizedTargetExperimentCode;
      }
      current.hasCurrentExperimentHistory = current.hasCurrentExperimentHistory || Boolean(hasCurrentExperimentHistory);
      current.fixtureReady = current.fixtureReady || isFixtureReady(fixtureReady);
      return;
    }
    indexByTrayCode.set(normalizedTrayCode, trayRows.length);
    const completedExperimentCodes = new Set([
      ...Array.from(completedExperimentCodesByTrayCode.get(normalizedTrayCode) || []),
      ...Array.from(completedExperimentRecordCodesByTrayCode.get(normalizedTrayCode) || []),
    ]);
    if (currentScheduleIsAxisSubExperiment && !completedCurrentScheduleTrayCodes.has(normalizedTrayCode)) {
      completedExperimentCodes.delete(currentExperimentCode);
    }
    trayRows.push({
      currentLocation: normalizeText(location),
      completedExperimentCodes: Array.from(completedExperimentCodes),
      completedForCurrentExperiment: false,
      completedForOtherExperiment: false,
      displayStatus: "",
      experimentCodes: experimentCodesByTrayCode.get(normalizedTrayCode) || [],
      lifecycleLocation: normalizeText(location),
      lifecycleStatus: "",
      lifecycleTime: 0,
      hasCurrentExperimentHistory: false,
      currentExperimentHistoryStatus: "",
      latestExperimentHistoryStatus: "",
      owner: normalizeText(owner),
      quantity: quantity || "",
      sampleCodes: sampleCode ? [sampleCode] : [],
      targetExperimentCode: normalizedTargetExperimentCode,
      targetLab: normalizedTargetLab,
      fixtureReady: isFixtureReady(fixtureReady),
      trayStatus: "",
      trayCode: normalizedTrayCode,
    });
  };

  const scopedTrayCodes = experimentTrayCodeMap.get(experimentKey) || [];
  scopedTrayCodes.forEach((trayCode) => pushRow(trayCode));

  asArray(relatedSamples).forEach((sample) => {
    const sampleCode = normalizeText(sample?.code);
    const owner = normalizeText(sample?.owner);
    const location = normalizeText(sample?.location);
    asArray(sample?.trays).forEach((tray) => {
      const trayCode = normalizeText(tray?.tray_code);
      const quantity = tray?.quantity ?? "";
      if (scopedTrayCodes.length > 0 && !scopedTrayCodes.includes(trayCode)) {
        return;
      }
      const targetLab = normalizeText(tray?.target_lab || tray?.targetLab);
      const targetExperimentCode = normalizeText(tray?.target_experiment_code || tray?.targetExperimentCode);
      const physicalTrayStatus = normalizeText(tray?.status);
      const latestDispatch = physicalTrayStatus === LAB_RESET_STATUS
        ? resolveLatestLaboratoryDispatchSnapshot({
            currentExperimentCode,
            currentLab: device,
            sample,
            trayCode,
          })
        : null;
      const restoredDispatch = physicalTrayStatus === LAB_RESET_STATUS && (!targetLab || !targetExperimentCode)
        ? latestDispatch
        : null;
      const currentExperimentHistorySnapshot = resolveLatestExperimentHistorySnapshot({
        experimentName,
        sample,
        taskCode,
        trayCode,
      });
      const latestExperimentHistorySnapshot = resolveLatestAnyExperimentHistorySnapshot({
        sample,
        taskCode,
        trayCode,
      });
      const currentExperimentHistoryIsStale =
        currentExperimentHistorySnapshot
        && latestExperimentHistorySnapshot
        && normalizeText(latestExperimentHistorySnapshot.experimentName) !== normalizeText(experimentName)
        && (latestExperimentHistorySnapshot.time || -Infinity) > (currentExperimentHistorySnapshot.time || -Infinity)
        && (
          resolveLaboratoryStatusRank(latestExperimentHistorySnapshot.status) > 0
          || experimentHistoryStatusIsWithdrawal(latestExperimentHistorySnapshot.status)
        );
      const dispatchRestoresWithdrawnCurrentExperiment =
        experimentHistoryStatusIsWithdrawal(currentExperimentHistorySnapshot?.status)
        && latestDispatch
        && latestDispatch.time > (currentExperimentHistorySnapshot?.time || -Infinity)
        && normalizeText(latestDispatch.targetLab) === normalizeText(device)
        && (
          !normalizeText(currentExperimentCode)
          || normalizeText(latestDispatch.targetExperimentCode) === normalizeText(currentExperimentCode)
        );
      const rawCurrentExperimentHistoryStatus = normalizeText(currentExperimentHistorySnapshot?.status);
      const rawCurrentExperimentHistoryRank = resolveLaboratoryStatusRank(rawCurrentExperimentHistoryStatus);
      const currentScheduleSuppressesCurrentHistory =
        currentScheduleIsAxisSubExperiment
        && (rawCurrentExperimentHistoryRank <= 0 || rawCurrentExperimentHistoryRank >= 5);
      const currentExperimentHistoryStatus = dispatchRestoresWithdrawnCurrentExperiment
        || currentExperimentHistoryIsStale
        || currentScheduleSuppressesCurrentHistory
        ? ""
        : rawCurrentExperimentHistoryStatus;
      const latestExperimentHistoryStatus = normalizeText(latestExperimentHistorySnapshot?.status);
      const restoredTargetLab = targetLab || normalizeText(restoredDispatch?.targetLab);
      const restoredTargetExperimentCode =
        targetExperimentCode
        || (restoredTargetLab === normalizeText(restoredDispatch?.targetLab)
          ? normalizeText(restoredDispatch?.targetExperimentCode)
          : "");
      const sampleHasCurrentExperimentHistory = Boolean(currentExperimentHistoryStatus);
      const currentExperimentHistoryRank = resolveLaboratoryStatusRank(currentExperimentHistoryStatus);
      const currentExperimentProgressIsAuthoritative = sampleHasCurrentExperimentHistory && currentExperimentHistoryRank > 0;
      const effectiveTargetLab = currentExperimentProgressIsAuthoritative ? device : restoredTargetLab;
      const effectiveTargetExperimentCode = currentExperimentProgressIsAuthoritative ? currentExperimentCode : restoredTargetExperimentCode;
      pushRow(
        trayCode,
        sampleCode,
        quantity,
        owner,
        location,
        tray?.fixtureReady ?? tray?.fixture_ready,
        effectiveTargetLab,
        effectiveTargetExperimentCode,
        sampleHasCurrentExperimentHistory,
      );
      const row = trayRows[indexByTrayCode.get(trayCode)];
      const completedExperimentCodes = completedExperimentCodesByTrayCode.get(trayCode) || new Set();
      const completedExperimentRecordCodes = completedExperimentRecordCodesByTrayCode.get(trayCode) || new Set();
      row.completedExperimentCodes = uniqueValues([
        ...asArray(row.completedExperimentCodes),
        ...Array.from(completedExperimentCodes),
        ...Array.from(completedExperimentRecordCodes),
      ]);
      row.completedForCurrentExperiment =
        row.completedForCurrentExperiment
        || (
          currentScheduleIsAxisSubExperiment
            ? completedCurrentScheduleTrayCodes.has(trayCode)
            : (
                completedExperimentCodes.has(currentExperimentCode)
                || completedExperimentRecordCodes.has(currentExperimentCode)
                || experimentIsCompletedInSampleHistory({ experimentName, sample, taskCode, trayCode })
              )
        );
      row.completedForOtherExperiment =
        row.completedForOtherExperiment
        || asArray(row?.experimentCodes).some((experimentCode) =>
          experimentCode !== currentExperimentCode
          && (completedExperimentCodes.has(experimentCode) || completedExperimentRecordCodes.has(experimentCode)),
        )
        || Boolean(resolvePreviousCompletedExperimentSnapshot(sample, taskCode, experimentName));
      row.hasCurrentExperimentHistory =
        row.hasCurrentExperimentHistory
        || sampleHasCurrentExperimentHistory;
      if (currentExperimentHistoryStatus) {
        row.currentExperimentHistoryStatus = currentExperimentHistoryStatus;
      }
      if (latestExperimentHistoryStatus) {
        row.latestExperimentHistoryStatus = latestExperimentHistoryStatus;
      }
      const currentRank = resolveLaboratoryStatusRank(row?.trayStatus);
      const nextStatus = physicalTrayStatus
        ? resolveCurrentExperimentTrayStatus({
            completedForCurrentExperiment: row.completedForCurrentExperiment,
            completedForOtherExperiment: row.completedForOtherExperiment,
            currentExperimentCode,
            device,
            experimentCodes: row?.experimentCodes,
            experimentName,
            historyStatus: currentExperimentHistoryStatus,
            physicalStatus: physicalTrayStatus,
            sample,
            targetExperimentCode: effectiveTargetExperimentCode,
            targetLab: effectiveTargetLab,
            taskCode,
            trayCode: row.trayCode,
          })
        : "";
      const displayStatusCandidate = resolveCurrentExperimentTrayStatus({
        completedForCurrentExperiment: row.completedForCurrentExperiment,
        completedForOtherExperiment: row.completedForOtherExperiment,
        currentExperimentCode,
        device,
        experimentCodes: row?.experimentCodes,
        experimentName,
        historyStatus: currentExperimentHistoryStatus,
        physicalStatus: physicalTrayStatus,
        sample,
        targetExperimentCode: effectiveTargetExperimentCode,
        targetLab: effectiveTargetLab,
        taskCode,
        trayCode: row.trayCode,
      });
      if (currentExperimentProgressIsAuthoritative) {
        row.targetLab = effectiveTargetLab;
        row.targetExperimentCode = effectiveTargetExperimentCode;
      }
      const nextStatusRestoresCurrentDispatch =
        dispatchRestoresWithdrawnCurrentExperiment && nextStatus === LAB_RESET_STATUS;
      if (nextStatusRestoresCurrentDispatch || resolveLaboratoryStatusRank(nextStatus) >= currentRank) {
        row.trayStatus = nextStatus;
      }
      if (physicalTrayStatus === LAB_RESET_STATUS && effectiveTargetLab) {
        row.currentLocation = effectiveTargetLab;
        row.lifecycleLocation = effectiveTargetLab;
      }
      const currentDisplayRank = resolveLaboratoryStatusRank(row?.displayStatus);
      if (
        nextStatusRestoresCurrentDispatch
        || resolveLaboratoryStatusRank(displayStatusCandidate) >= currentDisplayRank
      ) {
        row.displayStatus = displayStatusCandidate;
      }
      const lifecycleLocation = physicalTrayStatus === LAB_RESET_STATUS && effectiveTargetLab ? effectiveTargetLab : location;
      const lifecycleCandidate = resolveUnifiedTrayLifecycleCandidate({
        location: lifecycleLocation,
        sample,
        tray,
        trayCode: row.trayCode,
      });
      if (shouldReplaceUnifiedTrayLifecycle(row, lifecycleCandidate)) {
        row.lifecycleLocation = lifecycleCandidate.location || row.currentLocation;
        row.lifecycleStatus = lifecycleCandidate.status;
        row.lifecycleTime = lifecycleCandidate.time || 0;
      }
    });
  });

  return trayRows;
};

const buildLaboratoryScheduleRow = ({
  experimentMap,
  experimentRecordMap,
  experimentRuns,
  experimentRunSteps,
  experimentRunTrays,
  experimentTrayCodeMap,
  sampleMap,
  schedule,
  taskMap,
}) => {
  const taskCode = normalizeText(schedule?.task_code);
  const experimentCode = normalizeText(schedule?.experiment_code);
  const task = taskMap.get(taskCode) || null;
  const relatedSamples = sampleMap.get(taskCode) || [];
  const experimentKey = `${taskCode}::${experimentCode}`;
  const experiment = experimentRecordMap.get(experimentKey) || null;
  const owner = normalizeText(relatedSamples[0]?.owner) || "-";
  const experimentName =
    normalizeText(experiment?.experiment_name)
    || normalizeText(experimentMap.get(experimentKey))
    || normalizeText(task?.test_type)
    || normalizeText(task?.name)
    || "-";
  const startAt = String(schedule?.start_at || "");
  const endAt = String(schedule?.end_at || "");
  const scheduleId = normalizeText(schedule?.id) || `${taskCode}-${experimentCode}-${startAt}`;
  const device = normalizeText(schedule?.device) || SALT_SPRAY_LAB;
  const labCode = normalizeText(schedule?.lab_code || schedule?.labCode);
  const subExperimentCode = resolveSubExperimentCode(schedule);
  const scheduleIsAxisSubExperiment = Boolean(
    subExperimentCode
    && normalizeAxisCodes(schedule?.axis_codes ?? schedule?.axisCodes).length > 0,
  );
  const completedScheduleTrayCodes = scheduleIsAxisSubExperiment
    ? buildCompletedScheduleTrayCodeSet({ experimentRuns, experimentRunTrays, schedule })
    : new Set();
  const trayRows = collectTrayRows({
    device,
    experimentName,
    experimentRecordMap,
    experimentRuns,
    experimentRunTrays,
    experimentTrayCodeMap,
    experimentKey,
    relatedSamples,
    schedule,
    taskCode,
  });
  const currentTaskContext = {
    device,
    experimentCode,
    experimentName,
    status: normalizeText(experiment?.status),
    taskCode,
  };
  const axisProgressTrayCodes = buildActiveAxisProgressTrayCodes({
    baseTrayCodes: buildScheduleAxisProgressTrayCodes({ experimentRuns, experimentRunTrays, schedule }),
    currentTaskContext,
    trayRows,
  });
  const axisProgress = buildAxisProgressForSchedule({
    experiment,
    experimentName,
    experimentRuns,
    experimentRunSteps,
    experimentRunTrays,
    schedule,
    trayCodes: axisProgressTrayCodes,
  });
  const activeRun = findActiveExperimentRun({
    device,
    experimentCode,
    experimentRuns,
    scheduleId,
    taskCode,
  });
  const activeRunTrayRelations = findActiveExperimentRunTrayRelations({
    device,
    experimentCode,
    experimentRuns,
    experimentRunTrays,
    scheduleId,
    taskCode,
  });
  const activeRunTrayCodes = activeRunTrayRelations.length > 0
    ? uniqueValues(activeRunTrayRelations.map(resolveRelationTrayCode))
    : uniqueValues(asArray(activeRun?.tray_codes).map((trayCode) => normalizeText(trayCode)));
  const displayStartAt = normalizeText(activeRunTrayRelations[0]?.started_at || activeRunTrayRelations[0]?.startedAt) || normalizeText(activeRun?.started_at) || startAt;
  const estimatedEndAt = addDurationToDateTime(displayStartAt, resolvePlannedDurationMs(schedule, activeRun));
  const displayEndAt = estimatedEndAt || normalizeText(activeRun?.planned_end_at) || normalizeText(activeRun?.ended_at) || endAt;
  const activeRunStatus = activeRunTrayRelations.length > 0 || RUNNING_EXPERIMENT_RUN_STATUSES.has(normalizeText(activeRun?.status)) ? "实验进行中" : "";
  if (activeRunStatus) {
    trayRows.forEach((row) => {
      if (activeRunTrayCodes.length > 0 && !activeRunTrayCodes.includes(normalizeText(row?.trayCode))) {
        return;
      }
      if (COMPLETED_EXPERIMENT_STATUSES.has(normalizeText(row?.trayStatus))) {
        return;
      }
      row.displayStatus = activeRunStatus;
      row.lifecycleStatus = activeRunStatus;
      row.trayStatus = activeRunStatus;
    });
  }
  if (axisProgress?.remainingAxisCodes?.length > 0) {
    trayRows.forEach((row) => {
      row.completedForCurrentExperiment = false;
      row.completedExperimentCodes = asArray(row.completedExperimentCodes).filter((code) => normalizeText(code) !== experimentCode);
      if (
        row.completedForOtherExperiment !== true
        && (
          COMPLETED_EXPERIMENT_STATUSES.has(normalizeText(row?.trayStatus))
          || COMPLETED_EXPERIMENT_STATUSES.has(normalizeText(row?.displayStatus))
          || COMPLETED_EXPERIMENT_STATUSES.has(normalizeText(row?.lifecycleStatus))
        )
      ) {
        row.trayStatus = LAB_RESET_STATUS;
        row.displayStatus = LAB_RESET_STATUS;
        row.lifecycleStatus = LAB_RESET_STATUS;
      }
    });
  }
  const completedRunTrayCodes = new Set(
    scheduleIsAxisSubExperiment
      ? Array.from(completedScheduleTrayCodes)
      : axisProgress?.remainingAxisCodes?.length > 0
        ? []
        : asArray(experimentRunTrays)
        .filter((relation) =>
          resolveRelationTaskCode(relation) === taskCode
          && resolveRelationExperimentCode(relation) === experimentCode
          && relationIsCompleted(relation),
        )
        .map(resolveRelationTrayCode)
        .filter(Boolean),
  );
  const returnedRunTrayCodes = new Set(
    asArray(experimentRunTrays)
      .filter((relation) =>
        resolveRelationTaskCode(relation) === taskCode
        && resolveRelationExperimentCode(relation) === experimentCode
        && normalizeText(resolveRelationStatus(relation)) === "厂家收回",
      )
      .map(resolveRelationTrayCode)
      .filter(Boolean),
  );
  trayRows.forEach((row) => {
    const activeOtherExperimentRuns = buildActiveOtherExperimentRunLocks({
      currentExperimentCode: experimentCode,
      experimentMap,
      experimentRuns,
      experimentRunTrays,
      taskCode,
      trayCode: row?.trayCode,
    });
    row.activeOtherExperimentRuns = activeOtherExperimentRuns;
    row.activeOtherExperimentRun = activeOtherExperimentRuns[0] || null;

    if (!completedRunTrayCodes.has(normalizeText(row?.trayCode))) {
      return;
    }
    row.completedForCurrentExperiment = true;
    row.completedExperimentCodes = uniqueValues([...asArray(row.completedExperimentCodes), experimentCode]);
    row.displayStatus = EXPERIMENT_COMPLETED_STATUS;
    row.lifecycleStatus = EXPERIMENT_COMPLETED_STATUS;
    row.trayStatus = EXPERIMENT_COMPLETED_STATUS;
  });
  const visibleTrayRows = trayRows.filter((row) =>
    row?.completedForCurrentExperiment !== true
    && !completedRunTrayCodes.has(normalizeText(row?.trayCode))
    && !rowHasReturnedStatus(row),
  );

  return {
    activeRunTrayCodes,
    allTrayCodes: trayRows
      .filter((row) => !returnedRunTrayCodes.has(normalizeText(row?.trayCode)) && !rowHasReturnedStatus(row))
      .map((row) => row.trayCode),
    allTrayRows: trayRows,
    axisBatchNo: normalizeText(schedule?.axis_batch_no ?? schedule?.axisBatchNo),
    axisCodes: normalizeAxisCodes(schedule?.axis_codes ?? schedule?.axisCodes),
    axisProgress,
    axis_batch_no: normalizeText(schedule?.axis_batch_no ?? schedule?.axisBatchNo),
    axis_codes: normalizeAxisCodes(schedule?.axis_codes ?? schedule?.axisCodes),
    device,
    endAt: displayEndAt,
    endTimeLabel: formatTime(displayEndAt),
    experimentCode,
    experimentKey,
    experimentName,
    id: scheduleId,
    labCode,
    owner,
    sampleCount: visibleTrayRows.reduce((count, row) => count + Math.max(1, row.sampleCodes.length || 0), 0) || visibleTrayRows.length,
    runNo:
      normalizeText(activeRun?.run_no)
      || normalizeText(activeRun?.id)
      || normalizeText(activeRunTrayRelations[0]?.run_no)
      || normalizeText(activeRunTrayRelations[0]?.runNo),
    startAt: displayStartAt,
    startDateTimeLabel: formatDateTime(displayStartAt),
    startTimeLabel: formatTime(displayStartAt),
    status: normalizeText(experiment?.status),
    subExperimentCode,
    sub_experiment_code: subExperimentCode,
    taskCode,
    taskName: normalizeText(task?.name) || taskCode || "-",
    dateTimeRange: `${formatDateTime(displayStartAt)} - ${formatDateTime(displayEndAt)}`,
    timeRange: `${formatTime(displayStartAt)} - ${formatTime(displayEndAt)}`,
    title: `${taskCode} / ${experimentName} / ${formatDateTime(displayStartAt)} - ${formatDateTime(displayEndAt)}`,
    trayCodes: visibleTrayRows.map((row) => row.trayCode),
    trayRows: visibleTrayRows,
    endDateTimeLabel: formatDateTime(displayEndAt),
  };
};

const isAxisContinuationRow = (row) => {
  const axisProgress = row?.axisProgress;
  return asArray(axisProgress?.scheduledAxisCodes).length > 0
    && asArray(axisProgress?.totalRequiredAxisCodes).length > asArray(axisProgress?.scheduledAxisCodes).length
    && Number(axisProgress?.totalCompletedCount || 0) > 0
    && Number(axisProgress?.completedCount || 0) === 0;
};

const isFutureAxisContinuationRow = (row, nowTime) =>
  (toTime(row?.startAt) || 0) > nowTime && isAxisContinuationRow(row);

const rowCanBeCurrentLaboratoryTask = (row) => {
  if (!isAxisContinuationRow(row)) {
    return true;
  }
  const scopedTrayRows = asArray(row?.allTrayRows).length > 0
    ? asArray(row?.allTrayRows)
    : asArray(row?.trayRows);
  return scopedTrayRows.length === 0
    || taskHasCurrentLaboratoryDispatch(row)
    || scopedTrayRows.some((trayRow) => rowPartialAxisStatusMatchesCurrentExperiment(trayRow, row));
};

const findTrayFlowContextTask = (scheduleRows, currentTask, selectedTrayCode) => {
  if (currentTask) {
    return currentTask;
  }
  const normalizedTrayCode = normalizeText(selectedTrayCode);
  if (!normalizedTrayCode) {
    return asArray(scheduleRows)[0] || null;
  }
  return asArray(scheduleRows).find((row) =>
    asArray(row?.trayCodes).includes(normalizedTrayCode)
    || asArray(row?.allTrayCodes).includes(normalizedTrayCode),
  ) || asArray(scheduleRows)[0] || null;
};

function buildLaboratoryWorkbenchView({
  tasks = [],
  schedules = [],
  experiments = [],
  experimentRuns = [],
  experimentRunSteps = [],
  experimentRunTrays = [],
  experimentTrays = [],
  samples = [],
  now = serverNowDate(),
  selectedTaskCode = "",
  selectedTrayCode = "",
  labName = SALT_SPRAY_LAB,
  labCode = "",
}) {
  const taskMap = buildTaskMap(tasks);
  const experimentMap = buildExperimentMap(experiments);
  const experimentRecordMap = buildExperimentRecordMap(experiments);
  const sampleMap = buildSampleMap(samples);
  const experimentTrayCodeMap = buildExperimentTrayCodeMap(experimentTrays);
  const rowBuilderInput = { experimentMap, experimentRecordMap, experimentRuns, experimentRunSteps, experimentRunTrays, experimentTrayCodeMap, sampleMap, taskMap };

  const scheduleCompletionEntries = asArray(schedules).map((schedule) => ({
    completed: scheduleExperimentIsCompleted({
      experiments,
      experimentRuns,
      experimentRunSteps,
      experimentRunTrays,
      experimentTrays,
      samples,
      schedule,
    }),
    schedule,
  }));
  const activeSchedules = scheduleCompletionEntries
    .filter((entry) => !entry.completed)
    .map((entry) => entry.schedule);
  const allScheduleRows = activeSchedules
    .map((schedule) => buildLaboratoryScheduleRow({ ...rowBuilderInput, schedule }))
    .sort((left, right) => (toTime(left.startAt) || 0) - (toTime(right.startAt) || 0));

  const labRef = { code: labCode, name: labName };
  const nowTime = now instanceof Date ? now.getTime() : toTime(now) || serverNowMs();
  const scheduleRows = allScheduleRows.filter((row) => scheduleMatchesLab(row, labRef));
  const currentCandidateRows = scheduleRows.filter((row) => rowCanBeCurrentLaboratoryTask(row));
  const operationTask =
    currentCandidateRows.find((row) => normalizeText(row?.runNo))
    || currentCandidateRows.find((row) => !isFutureAxisContinuationRow(row, nowTime) && laboratoryRowHasStartedOperation(row));
  const defaultCandidate = currentCandidateRows[0] || null;
  const defaultTask = operationTask || defaultCandidate;

  const selectedKey = normalizeText(selectedTaskCode);
  const selectedDisplayTask =
    scheduleRows.find((row) => normalizeText(row.id) === selectedKey)
    || scheduleRows.find((row) => normalizeText(row.experimentKey) === selectedKey)
    || scheduleRows.find((row) => row.taskCode === selectedKey)
    || null;
  const selectedCurrentTask =
    currentCandidateRows.find((row) => normalizeText(row.id) === selectedKey)
    || currentCandidateRows.find((row) => normalizeText(row.experimentKey) === selectedKey)
    || currentCandidateRows.find((row) => row.taskCode === selectedKey)
    || null;
  const currentTask = selectedKey && selectedDisplayTask ? selectedCurrentTask : defaultTask;
  const flowContextTask = findTrayFlowContextTask(scheduleRows, currentTask || selectedDisplayTask, selectedTrayCode);
  const trayFlowTask = currentTask || selectedDisplayTask || flowContextTask;
  const selectedTask = selectedDisplayTask || currentTask || trayFlowTask;
  const currentExperimentTrayRows = asArray(trayFlowTask?.trayRows);
  const flowContextTrayRows = asArray(flowContextTask?.trayRows);
  const selectedTrayRow =
    flowContextTrayRows.find((row) => row.trayCode === normalizeText(selectedTrayCode))
    || flowContextTrayRows[0]
    || null;
  const selectedTrayHasCurrentExperimentContext = trayHasCurrentExperimentFlowContext(selectedTrayRow, flowContextTask);
  const selectedTrayDifferentTargetIsActive = rowHasUnfinishedDifferentTargetExperiment(selectedTrayRow, flowContextTask);
  const selectedTrayCanEnterCurrentExperimentAfterOtherCompletion =
    rowCanEnterCurrentExperimentAfterOtherCompletion(selectedTrayRow, flowContextTask)
    || rowHasCompletedAxisSubExperimentForOtherExperiment(selectedTrayRow, flowContextTask)
    || trayIsDispatchedToCurrentLaboratory(selectedTrayRow, flowContextTask)
    || rowCanUseCurrentExperimentAfterCompletedTarget(selectedTrayRow, flowContextTask);
  const selectedTrayHasCurrentExperimentDisplayDispatch =
    trayHasCurrentExperimentDisplayDispatch(selectedTrayRow, flowContextTask);
  const selectedTrayResolvedFlowStatus = resolveSelectedTrayFlowStatus(selectedTrayRow, flowContextTask);
  const selectedTrayPartialAxisEvidenceStatus = resolveSelectedTrayPartialAxisEvidenceStatus({
    experimentRuns,
    experimentRunSteps,
    experimentRunTrays,
    experiments,
    flowContextTask,
    samples,
    selectedTrayRow,
  });
  const flowContextExperimentName = normalizeText(flowContextTask?.experimentName);
  const selectedTrayResolvedAxisExperimentName = parsePartialAxisExperimentName(selectedTrayResolvedFlowStatus);
  const selectedTrayPartialAxisEvidenceExperimentName = parsePartialAxisExperimentName(selectedTrayPartialAxisEvidenceStatus);
  const selectedTrayEffectiveResolvedFlowStatus =
    isAxisPartialProgressStatus(selectedTrayResolvedFlowStatus)
    && selectedTrayPartialAxisEvidenceStatus
    && selectedTrayPartialAxisEvidenceExperimentName
    && selectedTrayPartialAxisEvidenceExperimentName === flowContextExperimentName
    && selectedTrayResolvedAxisExperimentName !== flowContextExperimentName
      ? selectedTrayPartialAxisEvidenceStatus
      : selectedTrayResolvedFlowStatus;
  const selectedTrayHasDisplayCurrentExperimentContext =
    selectedTrayHasCurrentExperimentContext
    && (
      selectedTrayHasCurrentExperimentDisplayDispatch
      || (
        selectedTrayCanEnterCurrentExperimentAfterOtherCompletion
        && !isAxisPartialProgressStatus(selectedTrayEffectiveResolvedFlowStatus)
      )
    );
  const selectedTrayAxisPartialStatusCandidate = [
    selectedTrayEffectiveResolvedFlowStatus,
    selectedTrayPartialAxisEvidenceStatus,
    ...rowPartialAxisCompletionStatusLabels(selectedTrayRow),
  ].map(normalizeText).find((status) => isAxisPartialProgressStatus(status)) || "";
  const selectedTrayAxisPartialStatusSupersededByLaterCompletion =
    selectedTrayRow
    && selectedTrayAxisPartialStatusCandidate
    && (
      !selectedTrayHasDisplayCurrentExperimentContext
      || isAxisPartialProgressStatus(selectedTrayEffectiveResolvedFlowStatus)
      || COMPLETED_TRAY_STATUSES.has(normalizeLifecycleStatus("", selectedTrayEffectiveResolvedFlowStatus))
    )
    && selectedTrayAxisPartialStatusIsSupersededByLaterExperimentCompletion({
      axisStatus: selectedTrayAxisPartialStatusCandidate,
      experimentRuns,
      experimentRunTrays,
      experiments,
      samples,
      taskCode: normalizeText(flowContextTask?.taskCode),
      trayCode: normalizeText(selectedTrayRow?.trayCode),
    });
  const selectedTrayProjectsCurrentDispatchStatus =
    selectedTrayHasDisplayCurrentExperimentContext
    && !selectedTrayHasCurrentExperimentDisplayDispatch
    && selectedTrayCanEnterCurrentExperimentAfterOtherCompletion
    && !selectedTrayAxisPartialStatusSupersededByLaterCompletion
    && !selectedTrayAxisPartialStatusCandidate
    && selectedTrayRow?.completedForCurrentExperiment !== true
    && selectedTrayEffectiveResolvedFlowStatus === LAB_RESET_STATUS;
  const selectedTrayProjectsFromOtherExperimentCompletion =
    selectedTrayProjectsCurrentDispatchStatus
    && selectedTrayRow?.completedForOtherExperiment === true
    && selectedTrayRow?.completedForCurrentExperiment !== true
    && COMPLETED_TRAY_STATUSES.has(normalizeLifecycleStatus("", selectedTrayRow?.latestExperimentHistoryStatus));
  const selectedTrayOnlyHasOtherExperimentCompletion =
    !selectedTrayHasCurrentExperimentContext
    && selectedTrayRow?.completedForOtherExperiment === true
    && selectedTrayRow?.completedForCurrentExperiment !== true
    && !selectedTrayDifferentTargetIsActive
    && !rowHasPreDispatchLifecycleStatus(selectedTrayRow);
  const selectedTrayFlowStatus =
    selectedTrayProjectsFromOtherExperimentCompletion
      ? EXPERIMENT_COMPLETED_STATUS
      : selectedTrayProjectsCurrentDispatchStatus
      ? LAB_RESET_STATUS
      : selectedTrayAxisPartialStatusSupersededByLaterCompletion
        ? EXPERIMENT_COMPLETED_STATUS
      : selectedTrayOnlyHasOtherExperimentCompletion
      ? EXPERIMENT_COMPLETED_STATUS
      : selectedTrayEffectiveResolvedFlowStatus;
  const currentTaskStatus = currentTask
    ? resolveLaboratoryTaskStatus(currentTask)
    : STATUS_WAITING;
  const currentTaskFlow = buildLaboratoryTaskFlow(currentTaskStatus, currentTask?.axisProgress);
  const rawSelectedTrayFlow = selectedTrayRow
    ? buildTrayFlowView({
        currentExperimentCode: selectedTrayAxisPartialStatusSupersededByLaterCompletion
          || selectedTrayProjectsFromOtherExperimentCompletion
          || selectedTrayOnlyHasOtherExperimentCompletion
          ? ""
          : selectedTrayHasDisplayCurrentExperimentContext
          ? normalizeText(flowContextTask?.experimentCode)
          : selectedTrayDifferentTargetIsActive
            ? normalizeText(selectedTrayRow?.targetExperimentCode || selectedTrayRow?.target_experiment_code)
            : "",
        experimentRuns,
        experimentRunSteps,
        experimentRunTrays,
        experimentTrays,
        experiments,
        dispatchTargetLab: selectedTrayAxisPartialStatusSupersededByLaterCompletion
          ? ""
          : selectedTrayProjectsFromOtherExperimentCompletion
          ? ""
          : selectedTrayProjectsCurrentDispatchStatus
          ? normalizeText(flowContextTask?.device)
          : selectedTrayHasDisplayCurrentExperimentContext || selectedTrayDifferentTargetIsActive
            ? normalizeText(selectedTrayRow?.targetLab || selectedTrayRow?.target_lab)
            : "",
        location: normalizeText(selectedTrayRow?.lifecycleLocation) || normalizeText(selectedTrayRow?.currentLocation),
        samples,
        schedules,
        status: selectedTrayFlowStatus,
        preferCurrentExperimentCode: (
          selectedTrayProjectsCurrentDispatchStatus
          && !selectedTrayProjectsFromOtherExperimentCompletion
        ) || selectedTrayHasCurrentExperimentDisplayDispatch,
        suppressGuessedDestinationLab: (
          selectedTrayProjectsFromOtherExperimentCompletion
        ),
        taskCode: normalizeText(flowContextTask?.taskCode),
        trayCode: normalizeText(selectedTrayRow?.trayCode),
      })
    : buildTrayFlowView();
  const baseSelectedTrayFlow =
    selectedTrayAxisPartialStatusSupersededByLaterCompletion
      ? activateLatestCompletedExperimentStep(rawSelectedTrayFlow)
      : rawSelectedTrayFlow;
  const selectedTrayFlowAxisStatus = [
    baseSelectedTrayFlow?.status,
    baseSelectedTrayFlow?.canonicalStatus,
  ].map(normalizeText).find((status) => isAxisPartialProgressStatus(status)) || "";
  const flowContextAxisStatus =
    resolveLaboratoryTaskAxisStatusLabel(flowContextTask?.axisProgress)
    || normalizeText(flowContextTask?.axisProgress?.totalStatusLabel);
  const selectedTrayFlowAxisStatusCounts = parsePartialAxisStatusLabelCounts(selectedTrayFlowAxisStatus);
  const flowContextAxisStatusCounts = parsePartialAxisStatusLabelCounts(flowContextAxisStatus);
  const selectedTrayFlowAxisExperimentName = parsePartialAxisExperimentName(selectedTrayFlowAxisStatus);
  const flowContextAxisExperimentName = parsePartialAxisExperimentName(flowContextAxisStatus);
  const selectedTrayAxisStatus =
    selectedTrayFlowAxisStatus
      ? (
          flowContextAxisStatus
          && selectedTrayFlowAxisStatusCounts
          && flowContextAxisStatusCounts
          && (
            (
              selectedTrayFlowAxisStatusCounts.completed === flowContextAxisStatusCounts.completed
              && selectedTrayFlowAxisStatusCounts.total !== flowContextAxisStatusCounts.total
            )
            || (
              selectedTrayFlowAxisStatusCounts.completed === flowContextAxisStatusCounts.completed
              && selectedTrayFlowAxisStatusCounts.total === flowContextAxisStatusCounts.total
              && flowContextAxisExperimentName
              && selectedTrayFlowAxisExperimentName !== flowContextAxisExperimentName
            )
          )
            ? flowContextAxisStatus
            : selectedTrayFlowAxisStatus
        )
      : flowContextAxisStatus;
  const selectedTrayFlowLifecycleStatus = normalizeLifecycleStatus("", selectedTrayFlowStatus);
  const selectedTrayHasAxisStatusEvidence =
    isAxisPartialProgressStatus(baseSelectedTrayFlow?.status)
    || isAxisPartialProgressStatus(selectedTrayFlowStatus)
    || isAxisPartialProgressStatus(selectedTrayRow?.trayStatus)
    || isAxisPartialProgressStatus(selectedTrayRow?.displayStatus)
    || isAxisPartialProgressStatus(selectedTrayRow?.lifecycleStatus)
    || selectedTrayHasCompletedAxisRunEvidence({
      experimentRunTrays,
      flowContextTask,
      selectedTrayRow,
    });
  const selectedTrayFlowShouldUseAxisStatus =
    !selectedTrayAxisPartialStatusSupersededByLaterCompletion
    &&
    selectedTrayAxisStatus
    && selectedTrayHasAxisStatusEvidence
    && (
      selectedTrayFlowLifecycleStatus === LAB_RESET_STATUS
      || (
        !selectedTrayProjectsCurrentDispatchStatus
        && !AXIS_PARTIAL_REAL_FOLLOW_UP_STATUSES.has(selectedTrayFlowLifecycleStatus)
      )
    );
  const selectedTrayFlowShouldUseLifecycleStatus =
    selectedTrayRow
    && selectedTrayAxisStatus
    && selectedTrayHasAxisStatusEvidence
    && !selectedTrayFlowShouldUseAxisStatus
    && selectedTrayFlowLifecycleStatus
    && AXIS_PARTIAL_REAL_FOLLOW_UP_STATUSES.has(selectedTrayFlowLifecycleStatus)
    && isAxisPartialProgressStatus(baseSelectedTrayFlow?.status);
  const lifecycleStepIndex = selectedTrayFlowShouldUseLifecycleStatus
    ? asArray(baseSelectedTrayFlow?.steps).findIndex((step) => normalizeText(step?.label) === selectedTrayFlowLifecycleStatus)
    : -1;
  const selectedTrayFlow =
    selectedTrayRow && selectedTrayAxisStatus && selectedTrayHasAxisStatusEvidence
      ? {
          ...baseSelectedTrayFlow,
          canonicalStatus: selectedTrayFlowShouldUseAxisStatus
            ? selectedTrayAxisStatus
            : selectedTrayFlowShouldUseLifecycleStatus
            ? selectedTrayFlowLifecycleStatus
            : baseSelectedTrayFlow.canonicalStatus,
          currentStatus: selectedTrayFlowShouldUseLifecycleStatus
            ? `当前托盘：${selectedTrayRow.trayCode} | 当前状态：${selectedTrayFlowLifecycleStatus}`
            : selectedTrayFlowShouldUseAxisStatus
            ? `当前托盘：${selectedTrayRow.trayCode} | 当前状态：${selectedTrayAxisStatus}`
            : baseSelectedTrayFlow.currentStatus,
          steps: selectedTrayFlowShouldUseLifecycleStatus && lifecycleStepIndex >= 0
            ? asArray(baseSelectedTrayFlow.steps).map((step, index) => ({
                ...step,
                active: index === lifecycleStepIndex,
                reached: index <= lifecycleStepIndex ? true : Boolean(step?.reached),
              }))
            : baseSelectedTrayFlow.steps,
          status: selectedTrayFlowShouldUseAxisStatus
            ? selectedTrayAxisStatus
            : selectedTrayFlowShouldUseLifecycleStatus
            ? selectedTrayFlowLifecycleStatus
            : baseSelectedTrayFlow.status,
        }
      : baseSelectedTrayFlow;
  const operationTaskMatchesCurrentTask =
    operationTask
    && currentTask
    && normalizeText(operationTask.taskCode) === normalizeText(currentTask.taskCode)
    && normalizeText(operationTask.experimentCode) === normalizeText(currentTask.experimentCode);
  const runningExperiment = buildRunningExperimentView({
    currentTask: operationTaskMatchesCurrentTask || !selectedKey ? (operationTask || currentTask) : currentTask,
    now: now instanceof Date ? now : new Date(toTime(now) || serverNowMs()),
  });

  return {
    allScheduleRows,
    currentTask,
    currentTaskFlow,
    currentTaskStatus,
    currentExperimentTrayRows,
    defaultTask,
    labName,
    runningExperiment,
    scheduleRows,
    selectedTask,
    selectedTrayFlow,
    selectedTrayRow,
    trayFlowTask,
  };
}

function buildLaboratorySummary(scheduleRows = [], now = serverNowDate()) {
  const todayKey = formatDateKey(now);
  const nowTime = now instanceof Date ? now.getTime() : toTime(now);
  const todayRows = asArray(scheduleRows).filter((row) => formatDateKey(row?.startAt) === todayKey);
  return {
    todayPendingCount: todayRows.length,
    todayUndoneCount: todayRows.filter((row) => {
      const end = toTime(row?.endAt);
      return Number.isFinite(end) && end < nowTime;
    }).length,
  };
}

function buildLaboratoryWorkflowFromTask(task) {
  const trayRows = asArray(task?.trayRows);
  const workflowRowsWithState = trayRows
    .map((row) => ({ row, state: resolveTrayExperimentOperationState(row, task) }))
    .filter(({ state }) => state.belongsToCurrentWorkflow);
  const workflowTrayRows = workflowRowsWithState.map(({ row }) => row);
  const activeOtherExperimentRows = workflowTrayRows.filter((row) => asArray(row?.activeOtherExperimentRuns).length > 0);
  const comparableTrayRows = workflowTrayRows.filter((row) =>
    asArray(row?.activeOtherExperimentRuns).length === 0
    && resolveTrayExperimentOperationState(row, task).rank < 1
  );
  const trayRanks = workflowRowsWithState.map(({ state }) => state.rank);
  const installedWaitingReadyRows = workflowTrayRows.filter((row) => resolveLaboratoryStatusRank(row?.trayStatus) === 2);
  const hasCompared = trayRanks.some((rank) => rank >= 1);
  const comparisonDone = trayRanks.length > 0 && trayRanks.every((rank) => rank >= 1);
  const hasInstalled = trayRanks.some((rank) => rank >= 2 && rank < 5);
  const installationDone = trayRanks.length > 0 && trayRanks.every((rank) => rank >= 2);
  const experimentConfirmed = trayRanks.length > 0 && trayRanks.every((rank) => rank >= 3);
  const fixtureReadyDone =
    installedWaitingReadyRows.length > 0 && installedWaitingReadyRows.every((row) => row?.fixtureReady === true);
  const workflow = {
    comparisonDone,
    experimentConfirmed,
    hasCompared,
    hasInstalled,
    installationDone,
  };
  Object.defineProperties(workflow, {
    fixtureReadyDone: {
      value: fixtureReadyDone,
    },
    hasComparedWaitingInstall: {
      value: trayRanks.some((rank) => rank === 1),
    },
    hasInstalledWaitingReady: {
      value: trayRanks.some((rank) => rank === 2),
    },
    hasActiveOtherExperimentRun: {
      value: activeOtherExperimentRows.length > 0,
    },
    activeOtherExperimentRows: {
      value: activeOtherExperimentRows,
    },
    activeOtherExperimentRun: {
      value: activeOtherExperimentRows[0]?.activeOtherExperimentRun || null,
    },
    hasComparableTrayWithoutActiveOtherExperiment: {
      value: comparableTrayRows.length > 0,
    },
    hasInProgressPreparation: {
      value: trayRanks.some((rank) => rank >= 2 && rank < 5),
    },
    hasWrongLaboratoryDispatch: {
      value: taskHasWrongLaboratoryDispatch(task),
    },
    hasCurrentLaboratoryDispatch: {
      value: taskHasCurrentLaboratoryDispatch(task),
    },
  });
  return workflow;
}

const buildSaltSprayLaboratoryView = buildLaboratoryWorkbenchView;

function buildLaboratoryProgressMessage(workflow, currentTask, labName = SALT_SPRAY_LAB) {
  if (!currentTask) {
    return `当前${normalizeText(labName) || SALT_SPRAY_LAB}暂无排程`;
  }
  if (getRunningTrayRowsForCurrentTask(currentTask).length > 0) {
    return `当前任务 ${currentTask.taskCode} 已进入实验进行中`;
  }
  if (
    workflow.hasActiveOtherExperimentRun
    && !workflow.hasComparableTrayWithoutActiveOtherExperiment
  ) {
    const lock = workflow.activeOtherExperimentRun || {};
    const target = normalizeText(lock.device) || normalizeText(lock.experimentName) || "其他实验";
    return `托盘正在${target}进行实验，完成后才可继续当前试验间流程`;
  }
  if (workflow.experimentConfirmed) {
    return "当前任务已确认全部托盘实验准备就绪";
  }
  if (workflow.hasInstalledWaitingReady && !workflow.fixtureReadyDone) {
    return "当前任务已完成夹具安装，等待上位机确认夹具安装完成";
  }
  if (workflow.hasInstalledWaitingReady && workflow.fixtureReadyDone) {
    return "夹具安装完成，可确认实验准备就绪";
  }
  if (workflow.hasInstalled && !workflow.installationDone) {
    return "当前任务已有托盘完成样品安装，待确认已安装托盘准备就绪";
  }
  if (workflow.installationDone) {
    return "当前任务已完成全部托盘样品安装，待实验确认";
  }
  if (workflow.hasCompared && !workflow.comparisonDone) {
    return "当前任务已完成部分托盘比对，可继续比对或开始样品安装";
  }
  if (workflow.comparisonDone) {
    return "当前任务已完成全部托盘任务比对，待样品安装";
  }
  return `当前任务 ${currentTask.taskCode} 待开始任务比对`;
}

function applyLaboratoryTaskStep({
  samples = [],
  currentTask = null,
  nextStatus = "",
  historyAction = "",
  now = formatLocalDateTime(),
  targetTrayCodes = [],
}) {
  if (!currentTask) {
    return asArray(samples);
  }

  const normalizedStatus = normalizeText(nextStatus);
  const scopedTrayCodes = asArray(targetTrayCodes).length > 0 ? targetTrayCodes : currentTask.trayCodes;
  const trayCodeSet = new Set(asArray(scopedTrayCodes).map((trayCode) => normalizeText(trayCode)).filter(Boolean));
  const taskCode = normalizeText(currentTask.taskCode);
  const detail = `${taskCode} / ${normalizeText(currentTask.experimentName) || "-"} / ${normalizedStatus}`;
  const scopedSamples = asArray(samples).filter((sample) => normalizeText(sample?.task_code) === taskCode);
  const targetStatusRank = resolveLaboratoryStatusRank(normalizedStatus);
  const protectsCompletedCurrentExperiment = targetStatusRank > 0 && targetStatusRank < 5;
  const protectedCompletedTrayCodes = new Set(
    asArray(samples)
      .filter((sample) => normalizeText(sample?.task_code) === taskCode)
      .flatMap((sample) =>
        asArray(sample?.trays)
          .map((tray) => normalizeText(tray?.tray_code))
          .filter((trayCode) =>
            trayCodeSet.has(trayCode)
            && protectsCompletedCurrentExperiment
            && experimentIsCompletedInSampleHistory({
              experimentName: currentTask.experimentName,
              sample,
              taskCode,
              trayCode,
            }),
          ),
      )
      .filter(Boolean),
  );
  const mutableTrayCodes = Array.from(trayCodeSet).filter((trayCode) => !protectedCompletedTrayCodes.has(trayCode));
  if (mutableTrayCodes.length === 0) {
    return asArray(samples);
  }

  const syncedSamples = synchronizeSamplesForTrayCodes({
    historyAction,
    historyDetail: detail,
    location: normalizeText(currentTask.device) || SALT_SPRAY_LAB,
    now,
    samples: scopedSamples,
    status: normalizedStatus,
    targetExperimentCode: normalizeText(currentTask.experimentCode),
    targetLab: normalizeText(currentTask.device) || SALT_SPRAY_LAB,
    trayCodes: mutableTrayCodes,
  }).samples;
  const syncedByCode = new Map(syncedSamples.map((sample) => [normalizeText(sample?.code), sample]));
  return asArray(samples).map((sample) => syncedByCode.get(normalizeText(sample?.code)) || sample);
}

function resetLaboratoryExperimentTrays({
  samples = [],
  currentTask = null,
  now = formatLocalDateTime(),
}) {
  if (!currentTask || !asArray(currentTask?.trayCodes).length) {
    return asArray(samples);
  }

  return applyLaboratoryTaskStep({
    currentTask,
    historyAction: "实验任务重置",
    nextStatus: LAB_RESET_STATUS,
    now,
    samples,
    targetTrayCodes: currentTask.trayCodes,
  });
}

function revertLaboratoryTaskToPreDispatch({
  samples = [],
  currentTask = null,
  now = formatLocalDateTime(),
}) {
  if (!currentTask || !asArray(currentTask?.trayCodes).length) {
    return asArray(samples);
  }

  const taskCode = normalizeText(currentTask?.taskCode);
  const trayCodeSet = new Set(asArray(currentTask?.trayCodes).map((trayCode) => normalizeText(trayCode)).filter(Boolean));
  const experimentName = normalizeText(currentTask?.experimentName) || "-";

  return asArray(samples).map((sample) => {
    if (normalizeText(sample?.task_code) !== taskCode) {
      return sample;
    }

    let restoreSnapshot = null;
    let reverted = false;
    const nextTrays = asArray(sample?.trays).map((tray) => {
      const trayCode = normalizeText(tray?.tray_code);
      if (!trayCodeSet.has(trayCode) || !shouldRevertLaboratoryTrayStatus(normalizeText(tray?.status) || normalizeText(sample?.status))) {
        return { ...tray };
      }
      restoreSnapshot = restoreSnapshot || resolvePreDispatchSnapshot(sample);
      if (!restoreSnapshot) {
        return { ...tray };
      }
      reverted = true;
      return {
        ...tray,
        status: restoreSnapshot.status,
        updated_at: now,
      };
    });

    if (!reverted || !restoreSnapshot) {
      return sample;
    }

    const nextSample = {
      ...sample,
      flow_status: restoreSnapshot.status,
      location: restoreSnapshot.location,
      status: restoreSnapshot.status,
      trays: nextTrays,
      updated_at: now,
    };
    nextSample.history = buildLaboratoryHistoryEntry(
      nextSample,
      "任务切换撤回",
      restoreSnapshot.status,
      `${taskCode} / ${experimentName} / 撤回至${restoreSnapshot.status}`,
      now,
    );
    return nextSample;
  });
}

function revertLaboratoryTaskToPreviousStableState({
  allowRunningRevert = false,
  samples = [],
  currentTask = null,
  now = formatLocalDateTime(),
}) {
  if (!currentTask || !asArray(currentTask?.trayCodes).length) {
    return asArray(samples);
  }

  const taskCode = normalizeText(currentTask?.taskCode);
  const trayCodeSet = new Set(asArray(currentTask?.trayCodes).map((trayCode) => normalizeText(trayCode)).filter(Boolean));
  const experimentName = normalizeText(currentTask?.experimentName) || "-";

  return asArray(samples).map((sample) => {
    if (normalizeText(sample?.task_code) !== taskCode) {
      return sample;
    }

    let restoreSnapshot = null;
    let reverted = false;
    const nextTrays = asArray(sample?.trays).map((tray) => {
      const trayCode = normalizeText(tray?.tray_code);
      if (
        !trayCodeSet.has(trayCode)
        || !shouldRevertLaboratoryTrayStatus(normalizeText(tray?.status) || normalizeText(sample?.status), {
          includeRunning: allowRunningRevert,
        })
      ) {
        return { ...tray };
      }
      restoreSnapshot = restoreSnapshot || resolvePreviousStableSnapshot(sample, taskCode, experimentName);
      reverted = true;
      return {
        ...tray,
        status: restoreSnapshot.status,
        updated_at: now,
      };
    });

    if (!reverted || !restoreSnapshot) {
      return sample;
    }

    const nextSample = {
      ...sample,
      flow_status: restoreSnapshot.status,
      location: restoreSnapshot.location,
      status: restoreSnapshot.status,
      trays: nextTrays,
      updated_at: now,
    };
    const detailTarget = restoreSnapshot.experimentName
      ? `${restoreSnapshot.experimentName}已完成`
      : restoreSnapshot.status;
    nextSample.history = buildLaboratoryHistoryEntry(
      nextSample,
      "任务切换撤回",
      restoreSnapshot.status,
      `${taskCode} / ${experimentName} / 撤回至${detailTarget}`,
      now,
    );
    return nextSample;
  });
}

function buildLaboratoryChecklist(task) {
  if (!task) {
    return [];
  }
  return [
    { label: "任务编号", value: task.taskCode || "-" },
    { label: "实验项目", value: task.experimentName || "-" },
    { label: "执行人员", value: task.owner || "-" },
    { label: "开始时间", value: task.startTimeLabel || "-" },
    { label: "结束时间", value: task.endTimeLabel || "-" },
    { label: "样品数量", value: task.sampleCount ? `${task.sampleCount} 件` : "-" },
    { label: "实验室", value: task.device || SALT_SPRAY_LAB },
  ];
}

function validateLaboratoryTrayScan({ currentTask = null, scheduleRows = [], allScheduleRows = [], scanCode = "" }) {
  const normalizedScanCode = normalizeTrayScanCode(scanCode);
  if (!normalizedScanCode) {
    return {
      guidance: "请扫描托盘编号",
      message: "请扫描托盘编号",
      ok: false,
      tone: "error",
    };
  }
  if (!currentTask) {
    return {
      guidance: "当前没有可比对的任务",
      message: "当前没有可比对的任务",
      ok: false,
      tone: "error",
    };
  }

  const currentTaskTrayCodes = uniqueValues([...asArray(currentTask.trayCodes), ...asArray(currentTask.allTrayCodes)]);
  if (currentTaskTrayCodes.includes(normalizedScanCode)) {
    const matchedTray =
      asArray(currentTask.trayRows).find((row) => normalizeText(row?.trayCode) === normalizedScanCode)
      || asArray(currentTask.allTrayRows).find((row) => normalizeText(row?.trayCode) === normalizedScanCode)
      || null;
    const trayStatus = normalizeText(matchedTray?.trayStatus) || normalizeText(matchedTray?.displayStatus);
    const activeOtherExperimentRun = asArray(matchedTray?.activeOtherExperimentRuns)[0] || matchedTray?.activeOtherExperimentRun || null;
    const canEnterAfterOtherExperimentCompletion =
      trayCanEnterCurrentExperimentAfterOtherCompletion(matchedTray, currentTask);
    if (activeOtherExperimentRun) {
      return buildActiveOtherExperimentComparisonResult(normalizedScanCode, activeOtherExperimentRun);
    }
    if (trayIsOccupiedByDifferentLaboratory(matchedTray, currentTask)) {
      return buildWrongLaboratoryDispatchResult(normalizedScanCode, matchedTray, currentTask);
    }
    if (trayLifecycleIsBeforeLaboratoryDispatch(matchedTray)) {
      return buildNotDispatchedComparisonResult(normalizedScanCode, {
        ...matchedTray,
        currentLocation: normalizeText(matchedTray?.lifecycleLocation) || normalizeText(matchedTray?.currentLocation),
        trayStatus: normalizeText(matchedTray?.lifecycleStatus) || trayStatus,
      });
    }
    if (resolveLaboratoryStatusRank(trayStatus) >= 1) {
      if (trayIsCompletedForCurrentExperiment(matchedTray, currentTask)) {
        return buildBlockedComparisonResult(normalizedScanCode, trayStatus);
      }
      const canEnterNextExperiment =
        (
          (trayStatus === "实验已完成" || trayStatus === "实验完成" || trayStatus === "实验已经完成")
          && isPreviousExperimentCompletionForCurrentTask(matchedTray, currentTask)
        )
        || canEnterAfterOtherExperimentCompletion;
      if (canEnterNextExperiment) {
        return {
          guidance: `${normalizedScanCode} 属于当前任务 ${currentTask.taskCode}`,
          matchedRow: currentTask,
          message: "比对正确",
          ok: true,
          tone: "success",
          trayCode: normalizedScanCode,
        };
      }
      return buildBlockedComparisonResult(normalizedScanCode, trayStatus);
    }
    if (canEnterAfterOtherExperimentCompletion) {
      return {
        guidance: `${normalizedScanCode} 属于当前任务 ${currentTask.taskCode}`,
        matchedRow: currentTask,
        message: "比对正确",
        ok: true,
        tone: "success",
        trayCode: normalizedScanCode,
      };
    }
    const currentLab = normalizeText(currentTask?.device);
    const currentLocation = trayLaboratoryLocation(matchedTray);
    const canContinueCurrentAxisExperiment =
      rowPartialAxisStatusMatchesCurrentExperiment(matchedTray, currentTask)
      && (!currentLab || currentLocation === currentLab)
      && trayIsDispatchedToCurrentLaboratory(matchedTray, currentTask);
    if (canContinueCurrentAxisExperiment) {
      return {
        guidance: `${normalizedScanCode} 属于当前任务 ${currentTask.taskCode}`,
        matchedRow: currentTask,
        message: "比对正确",
        ok: true,
        tone: "success",
        trayCode: normalizedScanCode,
      };
    }
    if (trayStatus !== LAB_RESET_STATUS) {
      return buildNotDispatchedComparisonResult(normalizedScanCode, matchedTray);
    }
    if (!trayIsDispatchedToCurrentLaboratory(matchedTray, currentTask)) {
      return buildWrongLaboratoryDispatchResult(normalizedScanCode, matchedTray, currentTask);
    }
    return {
      guidance: `${normalizedScanCode} 属于当前任务 ${currentTask.taskCode}`,
      matchedRow: currentTask,
      message: "比对正确",
      ok: true,
      tone: "success",
      trayCode: normalizedScanCode,
    };
  }

  const searchRows = asArray(allScheduleRows).length ? asArray(allScheduleRows) : asArray(scheduleRows);
  const matchedRows = searchRows.filter((row) =>
    uniqueValues([...asArray(row.trayCodes), ...asArray(row.allTrayCodes)]).includes(normalizedScanCode),
  );
  if (matchedRows.length > 0) {
    const destinationLabels = uniqueValues(matchedRows.map((row) => row.device));
    return {
      guidance: `当前任务并非优先所选任务。该托盘可前往：${destinationLabels.join("、")}`,
      matchedRow: matchedRows[0],
      matchedRows,
      message: "比对不正确",
      ok: false,
      tone: "error",
      trayCode: normalizedScanCode,
    };
  }

  return {
    guidance: "未匹配到该托盘",
    message: "未匹配到任务",
    ok: false,
    tone: "error",
    trayCode: normalizedScanCode,
  };
}

export {
  applyLaboratoryTaskStep,
  SALT_SPRAY_LAB,
  LAB_COMPARE_STATUS,
  LAB_INSTALL_STATUS,
  LAB_READY_STATUS,
  buildLaboratoryChecklist,
  buildLaboratoryWorkbenchView,
  buildLaboratoryProgressMessage,
  buildLaboratorySummary,
  buildLaboratoryWorkflowFromTask,
  buildSaltSprayLaboratoryView,
  completeLaboratoryComparison,
  completeLaboratoryInstallation,
  confirmLaboratoryExperiment,
  createLaboratoryWorkflow,
  getLaboratoryActionState,
  getLaboratoryOperationLock,
  resetLaboratoryExperimentTrays,
  revertLaboratoryTaskToPreviousStableState,
  revertLaboratoryTaskToPreDispatch,
  validateLaboratoryTrayScan,
};
