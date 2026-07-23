import {
  buildTrayFlowView,
  normalizeLifecycleStatus,
  synchronizeSamplesForTrayCodes,
} from "@/modules/samples/samplesFlowModel";
import { serverNowDate, serverNowMs } from "@/lib/serverClock";
import { formatLocalDateTime } from "@/lib/dateTime";
import { scheduleMatchesLab } from "@/lib/labIdentity";
import { normalizeTrayScanCode } from "@/lib/trayQrCode";
import {
  STATUS_WAITING,
} from "@/modules/tasks/model";
import { isAxisPartialProgressStatus } from "@/modules/experiment-progress/axisProgress";
import {
  COMPLETED_TRAY_STATUSES,
  scheduleExperimentIsCompleted,
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
  resolvePreDispatchSnapshot,
  resolvePreviousStableSnapshot,
} from "./laboratoryHistory";
import {
  getLaboratoryOperationLock,
  getRunningTrayRowsForCurrentTask,
  isPreviousExperimentCompletionForCurrentTask,
  resolveLaboratoryStatusRank,
  resolveTrayExperimentOperationState,
  rowCanEnterCurrentExperimentAfterOtherCompletion,
  rowCanUseCurrentExperimentAfterCompletedTarget,
  rowHasCompletedAxisSubExperimentForOtherExperiment,
  rowHasPreDispatchLifecycleStatus,
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
  buildRunningExperimentView,
  toTime,
  uniqueValues,
} from "./laboratoryPresentation";
import {
  buildExperimentTrayCodeMap,
} from "./laboratoryRunIndex";
import {
  buildExperimentMap,
  buildExperimentRecordMap,
  buildSampleMap,
  buildTaskMap,
  experimentIsCompletedInSampleHistory,
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
import {
  resolveSelectedTrayPartialAxisEvidenceStatus,
  selectedTrayHasCompletedAxisRunEvidence,
} from "./laboratoryAxisEvidence";
import { buildLaboratoryScheduleRow } from "./laboratoryScheduleRow";
import {
  buildLaboratorySummary,
  findTrayFlowContextTask,
  rowCanBeCurrentLaboratoryTask,
  selectLaboratoryOperationTask,
} from "./laboratoryWorkbenchSelection";
const normalizeText = (value) => String(value ?? "").trim();
const asArray = (value) => (Array.isArray(value) ? value : []);

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
  const operationTask = selectLaboratoryOperationTask({ currentCandidateRows, nowTime });
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
