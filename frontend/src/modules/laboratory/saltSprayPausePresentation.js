import { formatBusinessDateTime, parseBusinessDateTimeToMs } from "@/lib/dateTime";

const normalizeText = (value) => String(value ?? "").trim();
const toTime = (value) => parseBusinessDateTimeToMs(value);
const toNonNegativeNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
};

const formatDuration = (totalSeconds) => {
  const seconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const hours = String(Math.floor(seconds / 3600)).padStart(2, "0");
  const minutes = String(Math.floor((seconds % 3600) / 60)).padStart(2, "0");
  const remainder = String(seconds % 60).padStart(2, "0");
  return `${hours}:${minutes}:${remainder}`;
};

const pauseNoOf = (row) => normalizeText(row?.pause_no || row?.pauseNo);
const runNoOf = (row) => normalizeText(row?.run_no || row?.runNo);
const pausedAtOf = (row) => row?.paused_at || row?.pausedAt;
const resumedAtOf = (row) => row?.resumed_at || row?.resumedAt;
const stoppedAtOf = (row) => row?.stopped_at || row?.stoppedAt;
const pauseStatusOf = (row) => normalizeText(row?.status || row?.pause_status || row?.pauseStatus);
const CLOSED_PAUSE_STATUSES = new Set(["实验已恢复", "实验已停止"]);

const isActivePause = (row) => Boolean(
  pausedAtOf(row)
  && !normalizeText(resumedAtOf(row))
  && !normalizeText(stoppedAtOf(row))
  && !CLOSED_PAUSE_STATUSES.has(pauseStatusOf(row)),
);

const deduplicateRunPauses = (pauseRows, runNo) => {
  const matchingRunNo = normalizeText(runNo);
  const rowsByPauseNo = new Map();
  (Array.isArray(pauseRows) ? pauseRows : []).forEach((row) => {
    const pauseNo = pauseNoOf(row);
    if (pauseNo && runNoOf(row) === matchingRunNo) {
      rowsByPauseNo.set(pauseNo, row);
    }
  });
  return [...rowsByPauseNo.values()];
};

const findActivePause = (pauseRows, runNo) => (Array.isArray(pauseRows) ? pauseRows : [])
  .filter((row) => runNoOf(row) === normalizeText(runNo))
  .filter(isActivePause)
  .sort((left, right) => (toTime(pausedAtOf(right)) || 0) - (toTime(pausedAtOf(left)) || 0))[0] || null;

const pauseDurationSeconds = (row) => {
  const persistedValue = row?.pause_seconds ?? row?.pauseSeconds;
  const persistedSeconds = normalizeText(persistedValue) ? toNonNegativeNumber(persistedValue) : null;
  if (persistedSeconds !== null) {
    return Math.floor(persistedSeconds);
  }
  const pausedTime = toTime(pausedAtOf(row));
  const closedTime = toTime(resumedAtOf(row) || stoppedAtOf(row));
  return Number.isFinite(pausedTime) && Number.isFinite(closedTime)
    ? Math.max(0, Math.floor((closedTime - pausedTime) / 1000))
    : 0;
};

const summarizeRunPauses = (pauseRows, runNo, now) => {
  const rows = deduplicateRunPauses(pauseRows, runNo);
  const activePause = findActivePause(rows, runNo);
  const nowTime = now instanceof Date ? now.getTime() : toTime(now);
  const activePauseStartedTime = toTime(pausedAtOf(activePause));
  const activePauseSeconds = Number.isFinite(nowTime) && Number.isFinite(activePauseStartedTime)
    ? Math.max(0, Math.floor((nowTime - activePauseStartedTime) / 1000))
    : 0;
  const confirmedPauseSeconds = rows
    .filter((row) => pauseNoOf(row) !== pauseNoOf(activePause))
    .reduce((total, row) => total + pauseDurationSeconds(row), 0);

  return {
    activePause,
    activePauseSeconds,
    confirmedPauseSeconds,
    pauseCount: rows.length,
    totalPauseSeconds: confirmedPauseSeconds + activePauseSeconds,
  };
};

const buildSaltSprayRunPresentation = ({ activePause, activeRun, now, pauseRows, runningExperiment }) => {
  const runStatus = normalizeText(activeRun?.status || runningExperiment?.runStatus);
  const paused = runStatus === "实验暂停";
  const nowTime = now instanceof Date ? now.getTime() : toTime(now);
  const runNo = activeRun?.run_no || activeRun?.runNo || runningExperiment?.runNo;
  const pauseSummary = summarizeRunPauses(
    Array.isArray(pauseRows) ? pauseRows : activePause ? [activePause] : [],
    runNo,
    now,
  );
  const startedAt = activeRun?.started_at || runningExperiment?.startTime;
  const startedTime = typeof startedAt === "number" ? startedAt : toTime(startedAt);
  const plannedEndAt = activeRun?.planned_end_at || activeRun?.plannedEndAt;
  const plannedEndTime = toTime(plannedEndAt) || runningExperiment?.endTime;
  const confirmedPauseSeconds = pauseSummary.confirmedPauseSeconds;
  const openPauseSeconds = paused ? pauseSummary.activePauseSeconds : 0;
  const totalPauseSeconds = confirmedPauseSeconds + openPauseSeconds;
  const explicitEffectiveSeconds = toNonNegativeNumber(
    activeRun?.effective_exposure_seconds ?? activeRun?.effectiveExposureSeconds,
  );
  const calculatedEffectiveSeconds = Number.isFinite(nowTime) && Number.isFinite(startedTime)
    ? Math.max(0, Math.floor((nowTime - startedTime) / 1000) - totalPauseSeconds)
    : 0;
  const effectiveExposureSeconds = explicitEffectiveSeconds === null
    ? calculatedEffectiveSeconds
    : paused
      ? explicitEffectiveSeconds
      : Math.max(explicitEffectiveSeconds, calculatedEffectiveSeconds);
  const requiredExposureSeconds = toNonNegativeNumber(
    activeRun?.required_exposure_seconds ?? activeRun?.requiredExposureSeconds,
  ) ?? (
    Number.isFinite(plannedEndTime) && Number.isFinite(startedTime)
      ? Math.max(0, Math.floor((plannedEndTime - startedTime) / 1000) - confirmedPauseSeconds)
      : 0
  );
  const remainingExposureSeconds = Math.max(0, requiredExposureSeconds - effectiveExposureSeconds);

  return {
    activePause: pauseSummary.activePause,
    countdownLabel: paused ? `已暂停 ${formatDuration(openPauseSeconds)}` : formatDuration(remainingExposureSeconds),
    effectiveExposureLabel: formatDuration(effectiveExposureSeconds),
    effectiveExposureSeconds,
    expectedEndLabel: paused ? "待恢复后确定" : formatBusinessDateTime(plannedEndAt) || runningExperiment?.endDateTimeLabel || "-",
    isPaused: paused,
    pauseCount: pauseSummary.pauseCount,
    remainingExposureLabel: formatDuration(remainingExposureSeconds),
    remainingExposureSeconds,
    runStatus,
    totalPauseLabel: formatDuration(totalPauseSeconds),
    totalPauseSeconds,
  };
};

export { buildSaltSprayRunPresentation, findActivePause, formatDuration, summarizeRunPauses };
