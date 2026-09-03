import { normalizeAxisCodes } from "@/lib/axisCodes";
import {
  EXPERIMENT_COMPLETED_STATUS,
  LAB_RESET_STATUS,
  SALT_SPRAY_LAB,
} from "./laboratoryConstants";
import { buildActiveAxisProgressTrayCodes } from "./laboratoryAxisEvidence";
import {
  addDurationToDateTime,
  formatDateTime,
  formatTime,
  resolvePlannedDurationMs,
  uniqueValues,
} from "./laboratoryPresentation";
import {
  RUNNING_EXPERIMENT_RUN_STATUSES,
  buildActiveOtherExperimentRunLocks,
  buildCompletedScheduleTrayCodeSet,
  findActiveExperimentRun,
  findActiveExperimentRunTrayRelations,
} from "./laboratoryRunIndex";
import {
  COMPLETED_EXPERIMENT_STATUSES,
  buildAxisProgressForSchedule,
  buildScheduleAxisProgressTrayCodes,
  relationIsCompleted,
  resolveRelationExperimentCode,
  resolveRelationStatus,
  resolveRelationTaskCode,
  resolveRelationTrayCode,
  resolveSubExperimentCode,
} from "./scheduleCompletion";
import { rowHasReturnedStatus } from "./laboratoryTrayEligibility";
import { collectTrayRows } from "./laboratoryTrayRows";

const normalizeText = (value) => String(value ?? "").trim();
const asArray = (value) => (Array.isArray(value) ? value : []);
const MOLD_CANCELED_STATUS = "实验已取消";
const MOLD_LAB = "霉菌试验室";

const resolveRunNo = (entry) => normalizeText(entry?.run_no || entry?.runNo || entry?.id);
const resolveRunScheduleId = (entry) => normalizeText(entry?.schedule_id || entry?.scheduleId || entry?.schedule_no);
const resolveRunStatus = (entry) => normalizeText(entry?.status || entry?.run_status || entry?.runStatus);
const runTrayEventTime = (entry) => {
  const value = entry?.ended_at || entry?.endedAt || entry?.updated_at || entry?.updatedAt || entry?.started_at || entry?.startedAt;
  const time = Date.parse(String(value || ""));
  return Number.isFinite(time) ? time : 0;
};

const markCanceledMoldRerunEligibility = ({
  device,
  experimentCode,
  experimentName,
  experimentRuns,
  experimentRunTrays,
  scheduleId,
  taskCode,
  trayRows,
}) => {
  if (device !== MOLD_LAB || !experimentName.includes("霉菌")) {
    return;
  }
  const runByNo = new Map(
    asArray(experimentRuns)
      .map((run) => [resolveRunNo(run), run])
      .filter(([runNo]) => Boolean(runNo)),
  );
  asArray(trayRows).forEach((row) => {
    const trayCode = normalizeText(row?.trayCode);
    const latest = asArray(experimentRunTrays)
      .map((relation, index) => ({ index, relation, time: runTrayEventTime(relation) }))
      .filter(({ relation }) => (
        resolveRelationTaskCode(relation) === taskCode
        && resolveRelationExperimentCode(relation) === experimentCode
        && resolveRelationTrayCode(relation) === trayCode
      ))
      .sort((left, right) => left.time - right.time || left.index - right.index)
      .at(-1);
    const relation = latest?.relation;
    const run = relation ? runByNo.get(resolveRunNo(relation)) : null;
    const canceledScheduleId = resolveRunScheduleId(run);
    row.canceledMoldRerunEligible = Boolean(
      relation
      && run
      && resolveRelationStatus(relation) === MOLD_CANCELED_STATUS
      && resolveRunStatus(run) === MOLD_CANCELED_STATUS
      && canceledScheduleId
      && scheduleId
      && canceledScheduleId !== scheduleId
    );
    if (row.canceledMoldRerunEligible) {
      row.canceledMoldRunNo = resolveRunNo(relation);
      row.canceledMoldScheduleId = canceledScheduleId;
    }
  });
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
  markCanceledMoldRerunEligibility({
    device,
    experimentCode,
    experimentName,
    experimentRuns,
    experimentRunTrays,
    scheduleId,
    taskCode,
    trayRows,
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
  const activeRunStatus = activeRunTrayRelations.length > 0 || RUNNING_EXPERIMENT_RUN_STATUSES.has(normalizeText(activeRun?.status))
    ? normalizeText(activeRun?.status) === "实验暂停" ? "实验暂停" : "实验进行中"
    : "";
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
    activeRun,
    runStatus: normalizeText(activeRun?.status),
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

export { buildLaboratoryScheduleRow };
