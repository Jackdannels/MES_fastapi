import {
  formatBusinessDateKey,
  formatBusinessDateTime,
  formatBusinessTime,
  parseBusinessDateTimeToMs,
} from "@/lib/dateTime";
import { getRunningTrayRowsForCurrentTask } from "./laboratoryTrayEligibility";
import { resolveSubExperimentCode } from "./scheduleCompletion";

const normalizeText = (value) => String(value ?? "").trim();
const asArray = (value) => (Array.isArray(value) ? value : []);

const toTime = (value) => parseBusinessDateTimeToMs(value);

const toPositiveNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
};

const resolvePlannedDurationMs = (schedule, activeRun) => {
  const plannedHours =
    toPositiveNumber(activeRun?.planned_hours ?? activeRun?.plannedHours)
    ?? toPositiveNumber(schedule?.planned_hours ?? schedule?.plannedHours);
  if (plannedHours) {
    return plannedHours * 60 * 60 * 1000;
  }
  const scheduleStartTime = toTime(schedule?.start_at || schedule?.startAt);
  const scheduleEndTime = toTime(schedule?.end_at || schedule?.endAt);
  return Number.isFinite(scheduleStartTime) && Number.isFinite(scheduleEndTime) && scheduleEndTime > scheduleStartTime
    ? scheduleEndTime - scheduleStartTime
    : null;
};

const addDurationToDateTime = (dateTime, durationMs) => {
  const startTime = toTime(dateTime);
  return Number.isFinite(startTime) && Number.isFinite(durationMs) && durationMs > 0
    ? new Date(startTime + durationMs).toISOString()
    : "";
};

const formatTime = (value) => formatBusinessTime(value) || "-";
const formatDateKey = (value) => formatBusinessDateKey(value);
const formatDateTime = (value) => formatBusinessDateTime(value) || "-";

const formatDuration = (totalSeconds) => {
  const safeSeconds = Math.max(0, Number(totalSeconds) || 0);
  const hours = String(Math.floor(safeSeconds / 3600)).padStart(2, "0");
  const minutes = String(Math.floor((safeSeconds % 3600) / 60)).padStart(2, "0");
  const seconds = String(Math.floor(safeSeconds % 60)).padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
};

const uniqueValues = (values = []) => {
  const seen = new Set();
  return asArray(values).filter((value) => {
    const normalized = normalizeText(value);
    if (!normalized || seen.has(normalized)) {
      return false;
    }
    seen.add(normalized);
    return true;
  });
};

const buildRunningExperimentView = ({ currentTask, now }) => {
  const runningTrayRows = getRunningTrayRowsForCurrentTask(currentTask);
  if (!currentTask || !runningTrayRows.length) {
    return {
      active: false,
      countdownLabel: "",
      endDateTimeLabel: "-",
      endTime: null,
      experimentName: "",
      overdue: false,
      overdueLabel: "",
      remainingSeconds: 0,
      sampleCodes: [],
      startDateTimeLabel: "-",
      startTime: null,
      taskCode: "",
      trayCodes: [],
      trayRows: [],
    };
  }

  const nowTime = now instanceof Date ? now.getTime() : toTime(now);
  const startTime = toTime(currentTask?.startAt);
  const endTime = toTime(currentTask?.endAt);
  const remainingSeconds = Number.isFinite(endTime) && Number.isFinite(nowTime) ? Math.floor((endTime - nowTime) / 1000) : 0;
  const overdueSeconds = remainingSeconds < 0 ? Math.abs(remainingSeconds) : 0;

  return {
    active: true,
    countdownLabel: remainingSeconds >= 0 ? formatDuration(remainingSeconds) : `已超时 ${formatDuration(overdueSeconds)}`,
    endDateTimeLabel: formatDateTime(currentTask?.endAt),
    endTime,
    experimentName: normalizeText(currentTask?.experimentName),
    overdue: remainingSeconds < 0,
    overdueLabel: overdueSeconds ? formatDuration(overdueSeconds) : "",
    remainingSeconds,
    runNo: normalizeText(currentTask?.runNo),
    sampleCodes: uniqueValues(runningTrayRows.flatMap((row) => asArray(row?.sampleCodes))),
    startDateTimeLabel: formatDateTime(currentTask?.startAt),
    startTime,
    subExperimentCode: resolveSubExperimentCode(currentTask),
    sub_experiment_code: resolveSubExperimentCode(currentTask),
    taskCode: normalizeText(currentTask?.taskCode),
    trayCodes: runningTrayRows.map((row) => row.trayCode),
    trayRows: runningTrayRows,
  };
};

const updateRunningExperimentClock = (runningExperiment, now) => {
  if (!runningExperiment?.active) {
    return runningExperiment;
  }
  const nowTime = now instanceof Date ? now.getTime() : toTime(now);
  const endTime = runningExperiment?.endTime;
  const remainingSeconds = Number.isFinite(endTime) && Number.isFinite(nowTime)
    ? Math.floor((endTime - nowTime) / 1000)
    : 0;
  const overdueSeconds = remainingSeconds < 0 ? Math.abs(remainingSeconds) : 0;
  return {
    ...runningExperiment,
    countdownLabel: remainingSeconds >= 0 ? formatDuration(remainingSeconds) : `已超时 ${formatDuration(overdueSeconds)}`,
    overdue: remainingSeconds < 0,
    overdueLabel: overdueSeconds ? formatDuration(overdueSeconds) : "",
    remainingSeconds,
  };
};

export {
  addDurationToDateTime,
  buildRunningExperimentView,
  formatDateKey,
  formatDateTime,
  formatTime,
  resolvePlannedDurationMs,
  toTime,
  updateRunningExperimentClock,
  uniqueValues,
};
