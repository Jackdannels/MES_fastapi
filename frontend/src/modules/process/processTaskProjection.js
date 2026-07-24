import { parseBusinessDateTimeToMs } from "@/lib/dateTime";
import { scheduleMatchesLab } from "@/lib/labIdentity";
import { buildTrayFlowView } from "@/modules/samples/samplesFlowModel";
import { buildProcessLabCards } from "./model";
import {
  TRAY_STATUS_RUNNING,
  asArray,
  normalizeText,
  parseScheduleTime,
  resolveMqttStartDisabledReason,
  sanitizeTaskDisplayName,
  toCount,
  toText,
} from "./processLabCatalog";

function createProcessTaskProjection({
  currentTimeValue,
  processLabs,
  scheduleSelection,
  selectedTaskCodeByLab,
  selectedTrayCode,
  state,
  trayProjection,
}) {
  const {
    buildAvailableTasksForLab,
    findTaskByCode,
    getLabSchedules,
    getScheduledExperimentName,
    isCompletedSchedule,
  } = scheduleSelection;
  const { buildStartExperimentState, buildTrayRows, buildTraySummary, collectExperimentSampleCodes } = trayProjection;

  const findStartableScheduleForLab = (labName) => {
    let candidate = null;
    const labSchedules = getLabSchedules(labName).filter((schedule) => !isCompletedSchedule(schedule));
    for (const schedule of labSchedules) {
      const taskCode = normalizeText(schedule?.task_code);
      const experimentCode = normalizeText(schedule?.experiment_code);
      const actionState = buildStartExperimentState(buildTrayRows(taskCode, experimentCode), { experimentCode, labName, taskCode });
      if (actionState.runningTrayCount > 0) {
        return null;
      }
      if (!candidate && actionState.canStartExperiment) {
        candidate = schedule;
      }
    }
    return candidate;
  };

  const resolveScheduledRecordForLab = (lab, taskCode, currentTime, experimentCode = "") => {
    const normalizedTaskCode = normalizeText(taskCode);
    const normalizedExperimentCode = normalizeText(experimentCode);
    const relatedSchedules = state.schedules.value
      .filter((entry) => scheduleMatchesLab(entry, lab)
        && normalizeText(entry?.task_code) === normalizedTaskCode
        && (!normalizedExperimentCode || normalizeText(entry?.experiment_code) === normalizedExperimentCode))
      .filter((entry) => !isCompletedSchedule(entry))
      .sort((left, right) => parseScheduleTime(left?.start_at) - parseScheduleTime(right?.start_at));
    const activeSchedule = relatedSchedules.find((entry) => {
      const startAt = parseScheduleTime(entry?.start_at);
      const endAt = parseScheduleTime(entry?.end_at);
      return Number.isFinite(startAt) && Number.isFinite(endAt) && startAt <= currentTime && endAt >= currentTime;
    });
    if (activeSchedule) {
      return activeSchedule;
    }
    return relatedSchedules.find((entry) => parseScheduleTime(entry?.start_at) > currentTime)
      || relatedSchedules[relatedSchedules.length - 1]
      || null;
  };

  const buildTaskDetail = (lab) => {
    const taskCode = toText(lab?.taskCode, "");
    const labName = toText(lab?.name);
    const task = state.tasks.value.find((item) => normalizeText(item?.code) === taskCode)
      || state.tasks.value.find((item) => normalizeText(item?.required_device) === normalizeText(lab?.testType))
      || null;
    const activeExperimentCodeFromLab = normalizeText(lab?.experimentCode);
    const relatedSchedules = state.schedules.value
      .filter((entry) => scheduleMatchesLab(entry, lab))
      .filter((entry) => !isCompletedSchedule(entry))
      .sort((left, right) => (parseBusinessDateTimeToMs(right?.start_at) || 0) - (parseBusinessDateTimeToMs(left?.start_at) || 0));
    const schedule = relatedSchedules.find((entry) =>
      normalizeText(entry?.task_code) === taskCode
      && (!activeExperimentCodeFromLab || normalizeText(entry?.experiment_code) === activeExperimentCodeFromLab))
      || relatedSchedules.find((entry) => normalizeText(entry?.task_code) === taskCode)
      || relatedSchedules[0]
      || null;
    const activeExperimentCode = activeExperimentCodeFromLab || normalizeText(schedule?.experiment_code);
    const scheduledExperimentName = getScheduledExperimentName(taskCode, activeExperimentCode);
    const hasScopedExperimentSamples = collectExperimentSampleCodes(taskCode, activeExperimentCode).length > 0;
    const { trayCodes, trayCount, traySummary } = buildTraySummary(taskCode, task, activeExperimentCode);
    const trayRows = buildTrayRows(taskCode, activeExperimentCode);
    const actionState = buildStartExperimentState(trayRows, { experimentCode: activeExperimentCode, labName, taskCode });
    const runningTrayRows = actionState.runningTrayRows;
    const remainingTrayRows = actionState.remainingTrayRows;
    const completedTrayRows = trayRows.filter((row) => row.isCompleted);
    const activeTray = trayRows.find((row) => row.trayCode === selectedTrayCode.value)
      || runningTrayRows[0]
      || trayRows.find((row) => row.isReady)
      || remainingTrayRows[0]
      || trayRows[0]
      || null;
    const selectedTrayFlowExperimentCode = activeTray && asArray(activeTray.targetLabNames).length > 0 ? "" : activeExperimentCode;
    const filteredSampleCount = Array.from(new Set(trayRows.flatMap((row) => row.sampleCodes))).length;
    return {
      code: taskCode || "-",
      completedTrayRows,
      canStartExperiment: actionState.canStartExperiment,
      displayName: sanitizeTaskDisplayName(task?.name, toText(task?.test_type, "-")),
      dueAt: toText(task?.due_at),
      labName,
      name: toText(task?.name),
      priority: toText(task?.priority),
      readyTrayCount: actionState.readyTrayCount,
      remainingTrayCount: actionState.remainingTrayCount,
      remainingTrayRows,
      requiredDevice: toText(task?.required_device, labName),
      runningTrayCount: actionState.runningTrayCount,
      runningTrayRows,
      sampleCount: hasScopedExperimentSamples ? filteredSampleCount : toCount(task?.sample_count),
      scheduleTime: toText(schedule ? `${lab?.scheduleTime || ""}` : lab?.scheduleTime),
      selectedTrayCode: activeTray?.trayCode || "",
      selectedTrayFlow: activeTray
        ? buildTrayFlowView({
            currentExperimentCode: selectedTrayFlowExperimentCode,
            experimentRuns: state.experimentRuns.value,
            experimentRunSteps: state.experimentRunSteps.value,
            experimentRunTrays: state.experimentRunTrays.value,
            experimentTrays: state.experimentTrays.value,
            experiments: state.experiments.value,
            location: activeTray.locationSummary,
            samples: state.samples.value,
            schedules: state.schedules.value,
            status: activeTray.flowStatus || activeTray.status,
            taskCode,
            trayCode: activeTray.trayCode,
          })
        : buildTrayFlowView(),
      selectedTraySummary: activeTray,
      activeExperimentCode,
      availableTasks: buildAvailableTasksForLab(labName),
      source: toText(task?.source),
      readyTrayRows: actionState.readyTrayRows,
      startDisabledReason: actionState.startDisabledReason,
      status: toText(task?.status, toText(lab?.status)),
      targetExperiment: toText(scheduledExperimentName, toText(task?.test_type, toText(lab?.targetExperiment))),
      testType: toText(scheduledExperimentName, toText(task?.test_type, toText(lab?.testType))),
      trayCodes,
      trayCount,
      trayRows,
      traySummary,
    };
  };

  const enrichLabCard = (lab) => {
    const normalizedLabName = normalizeText(lab?.name);
    const explicitSelection = normalizeText(selectedTaskCodeByLab.value[normalizedLabName]);
    const selectedTask = scheduleSelection.resolveSelectedTaskForLab(
      selectedTaskCodeByLab,
      lab?.name,
      lab?.taskCode,
      lab?.experimentCode,
    );
    const buildScopedLab = (taskCode, experimentCode) => {
      const sourceSchedules = taskCode
        ? state.schedules.value.filter((entry) => scheduleMatchesLab(entry, lab)
          && normalizeText(entry?.task_code) === taskCode
          && (!experimentCode || normalizeText(entry?.experiment_code) === experimentCode))
        : state.schedules.value;
      return buildProcessLabCards(
        [lab], state.tasks.value, sourceSchedules, state.samples.value, currentTimeValue(),
        state.experiments.value, state.experimentTrays.value, state.devices.value,
        state.experimentRuns.value, state.experimentRunTrays.value, state.experimentRunSteps.value,
      )[0] || lab;
    };
    let scopedLab = buildScopedLab(selectedTask.taskCode, selectedTask.experimentCode);
    if (!scopedLab?.hasTask && explicitSelection) {
      scopedLab = buildScopedLab(normalizeText(lab?.taskCode), normalizeText(lab?.experimentCode));
    }
    if (!scopedLab?.hasTask) {
      return { ...scopedLab, canStartExperiment: false, readyTrayCount: 0, remainingTrayCount: 0, runningTrayCount: 0, startDisabledReason: "当前无任务" };
    }
    let taskCode = normalizeText(scopedLab.taskCode);
    let task = findTaskByCode(taskCode);
    let schedule = resolveScheduledRecordForLab(scopedLab, taskCode, currentTimeValue(), normalizeText(scopedLab?.experimentCode));
    let activeExperimentCode = normalizeText(schedule?.experiment_code) || normalizeText(scopedLab?.experimentCode);
    let scopedTrayRows = buildTrayRows(taskCode, activeExperimentCode);
    let actionState = buildStartExperimentState(scopedTrayRows, { experimentCode: activeExperimentCode, labName: scopedLab?.name, taskCode });
    if (!explicitSelection && !actionState.canStartExperiment && actionState.runningTrayCount === 0) {
      const startableSchedule = findStartableScheduleForLab(scopedLab?.name);
      const startableTaskCode = normalizeText(startableSchedule?.task_code);
      const startableExperimentCode = normalizeText(startableSchedule?.experiment_code);
      if (startableTaskCode && (startableTaskCode !== taskCode || startableExperimentCode !== activeExperimentCode)) {
        scopedLab = buildScopedLab(startableTaskCode, startableExperimentCode);
        taskCode = normalizeText(scopedLab.taskCode);
        task = findTaskByCode(taskCode);
        schedule = resolveScheduledRecordForLab(scopedLab, taskCode, currentTimeValue(), normalizeText(scopedLab?.experimentCode));
        activeExperimentCode = normalizeText(schedule?.experiment_code) || normalizeText(scopedLab?.experimentCode);
        scopedTrayRows = buildTrayRows(taskCode, activeExperimentCode);
        actionState = buildStartExperimentState(scopedTrayRows, { experimentCode: activeExperimentCode, labName: scopedLab?.name, taskCode });
      }
    }
    const scheduledExperimentName = getScheduledExperimentName(taskCode, activeExperimentCode);
    const hasScheduledTask = Boolean(scopedLab?.hasTask);
    const shared = {
      ...scopedLab,
      canStartExperiment: false,
      experimentCode: activeExperimentCode,
      readyTrayCount: actionState.readyTrayCount,
      remainingTrayCount: actionState.remainingTrayCount,
      runningTrayCount: actionState.runningTrayCount,
      targetExperiment: toText(scheduledExperimentName, toText(task?.test_type, toText(scopedLab?.targetExperiment))),
    };
    if (normalizeText(scopedLab?.statusClass) === "is-maintenance") {
      return { ...shared, startDisabledReason: "设备维修中，禁止开始实验" };
    }
    if (normalizeText(scopedLab?.statusClass) === "is-urgent") {
      return { ...shared, startDisabledReason: actionState.startDisabledReason };
    }
    const status = actionState.runningTrayCount > 0 ? TRAY_STATUS_RUNNING : hasScheduledTask ? "已排程" : "空闲";
    const statusClass = actionState.runningTrayCount > 0 ? "is-running" : hasScheduledTask ? "is-scheduled" : "is-idle";
    return {
      ...shared,
      startDisabledReason: actionState.canStartExperiment ? resolveMqttStartDisabledReason(scopedLab) : actionState.startDisabledReason,
      status,
      statusClass,
    };
  };

  const rebuildLabCards = () => {
    state.labCards.value = buildProcessLabCards(
      processLabs.value, state.tasks.value, state.schedules.value, state.samples.value, currentTimeValue(),
      state.experiments.value, state.experimentTrays.value, state.devices.value,
      state.experimentRuns.value, state.experimentRunTrays.value, state.experimentRunSteps.value,
    ).map(enrichLabCard);
  };

  return { buildTaskDetail, rebuildLabCards };
}

export { createProcessTaskProjection };
