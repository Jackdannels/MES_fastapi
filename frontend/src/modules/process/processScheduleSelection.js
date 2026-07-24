import { scheduleMatchesLab } from "@/lib/labIdentity";
import { scheduleExperimentIsCompleted } from "./model";
import { normalizeText, parseScheduleTime, toText } from "./processLabCatalog";

function createProcessScheduleSelection({ nowValue, processLabs, state }) {
  const findTaskByCode = (taskCode) => state.tasks.value.find((item) => normalizeText(item?.code) === taskCode) || null;
  const findProcessLabByName = (labName) =>
    processLabs.value.find((lab) => normalizeText(lab?.name) === normalizeText(labName)) || { name: labName };
  const getLabSchedules = (labName) =>
    state.schedules.value
      .filter((entry) => scheduleMatchesLab(entry, findProcessLabByName(labName)))
      .sort((left, right) => parseScheduleTime(left?.start_at) - parseScheduleTime(right?.start_at));
  const isCompletedSchedule = (schedule) => scheduleExperimentIsCompleted({
    experiments: state.experiments.value,
    experimentRunSteps: state.experimentRunSteps.value,
    experimentRunTrays: state.experimentRunTrays.value,
    experimentTrays: state.experimentTrays.value,
    samples: state.samples.value,
    schedule,
    taskStatusMap: new Map(),
  });
  const buildExperimentSelectionKey = (taskCode, experimentCode = "") => {
    const normalizedTaskCode = normalizeText(taskCode);
    const normalizedExperimentCode = normalizeText(experimentCode);
    return normalizedExperimentCode ? `${normalizedTaskCode}::${normalizedExperimentCode}` : normalizedTaskCode;
  };
  const parseExperimentSelectionKey = (value) => {
    const normalized = normalizeText(value);
    const separatorIndex = normalized.indexOf("::");
    return separatorIndex === -1
      ? { experimentCode: "", taskCode: normalized }
      : { experimentCode: normalized.slice(separatorIndex + 2), taskCode: normalized.slice(0, separatorIndex) };
  };
  const resolveSelectedTaskForLab = (selectedTaskCodeByLab, labName, fallbackTaskCode = "", fallbackExperimentCode = "") => {
    const selected = normalizeText(selectedTaskCodeByLab.value[normalizeText(labName)]);
    return selected
      ? parseExperimentSelectionKey(selected)
      : { experimentCode: normalizeText(fallbackExperimentCode), taskCode: normalizeText(fallbackTaskCode) };
  };
  const getTaskSamples = (taskCode) => state.samples.value.filter((sample) => normalizeText(sample?.task_code) === taskCode);
  const getScheduledExperimentName = (taskCode, experimentCode) => {
    const normalizedTaskCode = normalizeText(taskCode);
    const normalizedExperimentCode = normalizeText(experimentCode);
    if (!normalizedTaskCode || !normalizedExperimentCode) {
      return "";
    }
    return normalizeText(state.experiments.value.find((entry) =>
      normalizeText(entry?.task_code) === normalizedTaskCode
      && normalizeText(entry?.experiment_code) === normalizedExperimentCode)?.experiment_name);
  };
  const getScheduledLabName = (taskCode, experimentCode) => {
    const normalizedTaskCode = normalizeText(taskCode);
    const normalizedExperimentCode = normalizeText(experimentCode);
    const matched = state.schedules.value.find((entry) =>
      normalizeText(entry?.task_code) === normalizedTaskCode
      && normalizeText(entry?.experiment_code) === normalizedExperimentCode);
    return normalizeText(matched?.device || matched?.lab_name || matched?.labName);
  };
  const getScheduledStartTime = (taskCode, experimentCode) => {
    const normalizedTaskCode = normalizeText(taskCode);
    const normalizedExperimentCode = normalizeText(experimentCode);
    const matched = state.schedules.value.find((entry) =>
      normalizeText(entry?.task_code) === normalizedTaskCode
      && normalizeText(entry?.experiment_code) === normalizedExperimentCode);
    return parseScheduleTime(matched?.start_at);
  };
  const buildAvailableTasksForLab = (labName) => {
    const rows = [];
    const seen = new Set();
    getLabSchedules(labName).filter((schedule) => !isCompletedSchedule(schedule)).forEach((schedule) => {
      const taskCode = normalizeText(schedule?.task_code);
      const experimentCode = normalizeText(schedule?.experiment_code);
      const selectionKey = buildExperimentSelectionKey(taskCode, experimentCode);
      if (!taskCode || seen.has(selectionKey)) {
        return;
      }
      seen.add(selectionKey);
      rows.push({
        experimentCode,
        experimentName: getScheduledExperimentName(taskCode, experimentCode),
        scheduleTime: `${toText(schedule?.start_at)} - ${toText(schedule?.end_at)}`,
        selectionKey,
        taskCode,
      });
    });
    return rows;
  };

  return {
    buildAvailableTasksForLab,
    buildExperimentSelectionKey,
    findTaskByCode,
    getLabSchedules,
    getScheduledExperimentName,
    getScheduledLabName,
    getScheduledStartTime,
    getTaskSamples,
    isCompletedSchedule,
    nowValue,
    resolveSelectedTaskForLab,
  };
}

export { createProcessScheduleSelection };
