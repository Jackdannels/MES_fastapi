import { formatDateTime, normalizeText } from "./sharedModel";

const CONFLICT_STATES = new Set([
  "blocked",
  "conflict",
  "failed",
  "manual_required",
  "pending_manual",
  "排程冲突",
  "待人工重排",
]);
const WAITING_STATES = new Set(["waiting_active_run_end"]);
const WAITING_REASON = "受前序实验超时影响，等待预计结束";

const firstPresent = (source, keys) => {
  for (const key of keys) {
    const value = source?.[key];
    if (value !== undefined && value !== null && value !== "") {
      return value;
    }
  }
  return "";
};

const normalizeMinutes = (value) => {
  const minutes = Number(value);
  return Number.isFinite(minutes) && minutes > 0 ? Math.round(minutes) : 0;
};

const isTruthyFlag = (value) => value === true || value === 1 || ["1", "true", "yes"].includes(normalizeText(value).toLowerCase());

const resolveComputedDelayMinutes = (effectiveStartAt, originalStartAt) => {
  const effectiveTime = Date.parse(effectiveStartAt);
  const originalTime = Date.parse(originalStartAt);
  if (!Number.isFinite(effectiveTime) || !Number.isFinite(originalTime) || effectiveTime <= originalTime) {
    return 0;
  }
  return Math.round((effectiveTime - originalTime) / 60000);
};

/**
 * Normalize optional automatic-delay fields without changing the schedule contract.
 * The backend may expose the audit metadata either flat on the schedule or under
 * `delay_metadata`; legacy schedule rows without these fields remain unchanged.
 */
function resolveScheduleDelayPresentation(schedule = {}) {
  const metadata = schedule?.delay_metadata && typeof schedule.delay_metadata === "object"
    ? schedule.delay_metadata
    : schedule?.delayMetadata && typeof schedule.delayMetadata === "object"
      ? schedule.delayMetadata
      : {};
  const source = { ...metadata, ...schedule };
  const effectiveStartAt = firstPresent(source, ["start_at", "startAt"]);
  const effectiveEndAt = firstPresent(source, ["end_at", "endAt"]);
  const originalStartAt = firstPresent(source, [
    "original_start_at",
    "originalStartAt",
    "baseline_start_at",
    "baselineStartAt",
  ]);
  const originalEndAt = firstPresent(source, [
    "original_end_at",
    "originalEndAt",
    "baseline_end_at",
    "baselineEndAt",
  ]);
  const explicitDelayMinutes = normalizeMinutes(firstPresent(source, [
    "delay_minutes",
    "delayMinutes",
    "auto_delay_minutes",
    "autoDelayMinutes",
  ]));
  const delayMinutes = explicitDelayMinutes || resolveComputedDelayMinutes(effectiveStartAt, originalStartAt);
  const adjustmentStatus = normalizeText(firstPresent(source, [
    "adjustment_status",
    "adjustmentStatus",
    "delay_status",
    "delayStatus",
  ]));
  const reason = normalizeText(firstPresent(source, ["delay_reason", "delayReason", "reason"]));
  const normalizedAdjustmentStatus = adjustmentStatus.toLowerCase();
  const hasConflict = isTruthyFlag(firstPresent(source, ["delay_conflict", "delayConflict"]))
    || CONFLICT_STATES.has(normalizedAdjustmentStatus)
    || CONFLICT_STATES.has(adjustmentStatus);
  const isWaitingForActiveRun = WAITING_STATES.has(normalizedAdjustmentStatus)
    || reason === WAITING_REASON
    || isTruthyFlag(firstPresent(source, ["delay_waiting_for_estimated_end", "delayWaitingForEstimatedEnd"]));
  const formattedEffectiveStartAt = formatDateTime(effectiveStartAt);
  const formattedEffectiveEndAt = formatDateTime(effectiveEndAt);
  const formattedOriginalStartAt = formatDateTime(originalStartAt);
  const formattedOriginalEndAt = formatDateTime(originalEndAt);
  const originalWindowChanged = Boolean(
    (formattedOriginalStartAt && formattedEffectiveStartAt && formattedOriginalStartAt !== formattedEffectiveStartAt)
    || (formattedOriginalEndAt && formattedEffectiveEndAt && formattedOriginalEndAt !== formattedEffectiveEndAt),
  );
  const isDelayed = hasConflict
    || isWaitingForActiveRun
    || delayMinutes > 0
    || isTruthyFlag(firstPresent(source, ["auto_delayed", "autoDelayed"]))
    || originalWindowChanged;
  const sourceRunNo = normalizeText(firstPresent(source, [
    "delay_source_run_no",
    "delaySourceRunNo",
    "source_run_no",
    "sourceRunNo",
  ]));
  const originalStartLabel = originalWindowChanged ? formattedOriginalStartAt : "";
  const originalEndLabel = originalWindowChanged ? formattedOriginalEndAt : "";
  const originalWindowLabel = originalStartLabel && originalEndLabel
    ? `${originalStartLabel} - ${originalEndLabel}`
    : originalStartLabel || originalEndLabel;
  const badgeLabel = hasConflict
    ? "顺延冲突"
    : isWaitingForActiveRun
      ? "等待前序结束"
    : delayMinutes > 0
      ? `自动顺延 ${delayMinutes} 分钟`
      : isDelayed
        ? "已自动顺延"
        : "";
  const details = [
    originalWindowLabel ? `原计划：${originalWindowLabel}` : "",
    reason ? `原因：${reason}` : "",
    sourceRunNo ? `来源运行：${sourceRunNo}` : "",
  ].filter(Boolean);

  return {
    adjustmentStatus,
    badgeLabel,
    delayMinutes,
    hasConflict,
    isWaitingForActiveRun,
    isDelayed,
    originalEndAt: originalEndLabel,
    originalStartAt: originalStartLabel,
    originalWindowLabel,
    reason,
    sourceRunNo,
    title: details.join("；"),
  };
}

export { resolveScheduleDelayPresentation };
