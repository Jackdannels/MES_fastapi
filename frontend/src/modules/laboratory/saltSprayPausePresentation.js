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

const findActivePause = (pauseRows, runNo) => (Array.isArray(pauseRows) ? pauseRows : [])
  .filter((row) => normalizeText(row?.run_no || row?.runNo) === normalizeText(runNo))
  .filter((row) => !normalizeText(row?.resumed_at || row?.resumedAt))
  .sort((left, right) => (toTime(right?.paused_at || right?.pausedAt) || 0) - (toTime(left?.paused_at || left?.pausedAt) || 0))[0] || null;

const buildSaltSprayRunPresentation = ({ activePause, activeRun, now, runningExperiment }) => {
  const runStatus = normalizeText(activeRun?.status || runningExperiment?.runStatus);
  const paused = runStatus === "实验暂停";
  const nowTime = now instanceof Date ? now.getTime() : toTime(now);
  const startedAt = activeRun?.started_at || runningExperiment?.startTime;
  const startedTime = typeof startedAt === "number" ? startedAt : toTime(startedAt);
  const plannedEndAt = activeRun?.planned_end_at || activeRun?.plannedEndAt;
  const plannedEndTime = toTime(plannedEndAt) || runningExperiment?.endTime;
  const confirmedPauseSeconds = toNonNegativeNumber(activeRun?.total_pause_seconds ?? activeRun?.totalPauseSeconds) || 0;
  const activePauseStartedTime = toTime(
    activeRun?.active_pause_started_at
      || activeRun?.activePauseStartedAt
      || activePause?.paused_at
      || activePause?.pausedAt,
  );
  const openPauseSeconds = paused && Number.isFinite(nowTime) && Number.isFinite(activePauseStartedTime)
    ? Math.max(0, Math.floor((nowTime - activePauseStartedTime) / 1000))
    : 0;
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
    activePause,
    countdownLabel: paused ? `已暂停 ${formatDuration(openPauseSeconds)}` : formatDuration(remainingExposureSeconds),
    effectiveExposureLabel: formatDuration(effectiveExposureSeconds),
    effectiveExposureSeconds,
    expectedEndLabel: paused ? "待恢复后确定" : formatBusinessDateTime(plannedEndAt) || runningExperiment?.endDateTimeLabel || "-",
    isPaused: paused,
    pauseCount: toNonNegativeNumber(activeRun?.pause_count ?? activeRun?.pauseCount) || 0,
    remainingExposureLabel: formatDuration(remainingExposureSeconds),
    remainingExposureSeconds,
    runStatus,
    totalPauseLabel: formatDuration(totalPauseSeconds),
    totalPauseSeconds,
  };
};

export { buildSaltSprayRunPresentation, findActivePause, formatDuration };
