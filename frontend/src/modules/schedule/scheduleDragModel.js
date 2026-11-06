import { formatLocalDateTime } from "@/lib/dateTime";
import { scheduleMatchesLab } from "@/lib/labIdentity";
import { scheduleExperimentHasStarted } from "@/lib/runningExperimentGuards";
import { serverNowDate } from "@/lib/serverClock";
import { analyzeTaskTrayConflict } from "./scheduleViewModel";
import { filterSchedulesForActiveTasks, STATUS_SCHEDULED } from "./scheduleFoundationModel";
import { buildExperimentNameMap, buildExperimentTrayMap, buildTrayExperimentCodeMap, scheduleIsCompleted } from "./scheduleLifecycleModel";
import { updateScheduleRecord } from "./scheduleRecordModel";
import { isRetentionDevice, normalizeText, parseDate, SLOT_BUFFER_MINUTES, SLOT_RANGES, toLocalDateValue, toLocalTimeValue } from "./sharedModel";

const canDragSchedule = (context, scheduleId, scheduleIds = []) => {
  const ids = new Set([scheduleId, ...scheduleIds].map(normalizeText).filter(Boolean));
  if (ids.size !== 1) return false;
  const schedule = filterSchedulesForActiveTasks(context).find(row => normalizeText(row.id) === normalizeText(scheduleId));
  return Boolean(schedule && !isRetentionDevice(schedule)
    && normalizeText(schedule.status) === STATUS_SCHEDULED
    && !scheduleExperimentHasStarted({ ...context, schedule }));
};

// 拖入半天时追加到该实验室已有排程之后；手动表单的插空规则保持原样。
function buildScheduleDragPreview(context, { scheduleId, date, slot, lab }) {
  if (!canDragSchedule(context, scheduleId)) return { error: "排程已完成任务比对、进入实验流程或已被移除，不能拖拽改期。" };
  const source = context.schedules.find(row => normalizeText(row.id) === normalizeText(scheduleId));
  if (!scheduleMatchesLab(source, lab)) return { error: "请拖到同一实验室的目标时段；更换实验室请使用排程编辑。" };
  const range = SLOT_RANGES[slot];
  const start = range && parseDate(`${date}T${range.start}:00`);
  const slotEnd = range && parseDate(`${date}T${range.end}:00`);
  const now = context.now || serverNowDate();
  if (!start || !slotEnd || slotEnd <= now) return { error: "目标时段已过期，请选择当前或未来的时段。" };
  const sourceStart = parseDate(source.start_at);
  const sourceEnd = parseDate(source.end_at);
  const duration = sourceEnd - sourceStart;
  if (!sourceStart || !sourceEnd || duration <= 0) return { error: "原排程时间无效，请先通过排程编辑修正。" };
  const plannedHours = duration / 3600000;
  if (plannedHours < 0.1 || Math.abs(Math.round(plannedHours * 10) / 10 - plannedHours) > 0.000001) {
    return { error: "原排程时长不符合当前精度，请先通过排程编辑修正。" };
  }
  const lifecycle = {
    samples: context.samples,
    experimentTrayMap: buildExperimentTrayMap(context.experimentTrays),
    experimentNameByCode: buildExperimentNameMap(context.experiments),
    trayExperimentCodeMap: buildTrayExperimentCodeMap(context.experimentTrays),
  };
  const occupied = filterSchedulesForActiveTasks(context).filter(schedule =>
    normalizeText(schedule.id) !== normalizeText(source.id)
    && !isRetentionDevice(schedule) && scheduleMatchesLab(schedule, lab)
    && !scheduleIsCompleted({ ...lifecycle, schedule }),
  ).map(schedule => ({ start: parseDate(schedule.start_at), end: parseDate(schedule.end_at) }))
    .filter(window => window.start && window.end);
  const buffer = SLOT_BUFFER_MINUTES * 60000;
  let startMs = Math.max(start.getTime(), now.getTime());
  occupied.filter(window => window.start < slotEnd && window.end.getTime() + buffer > start.getTime())
    .forEach(window => { startMs = Math.max(startMs, window.end.getTime() + buffer); });
  // 表单以分钟保存，向上取整以保留完整的十分钟间隔。
  startMs = Math.ceil(startMs / 60000) * 60000;
  if (startMs >= slotEnd.getTime()) return { error: "目标时段已排满，请选择其他时段。" };
  const nextStart = new Date(startMs);
  const nextEnd = new Date(startMs + duration);
  if (occupied.some(window => startMs < window.end.getTime() + buffer && nextEnd.getTime() + buffer > window.start.getTime())) {
    return { error: "移动后将与后续排程冲突或不足 10 分钟间隔，请选择其他时段。" };
  }
  const form = {
    ...source,
    schedule_date: toLocalDateValue(nextStart), time_slot: "custom", custom_start: toLocalTimeValue(nextStart),
    planned_duration_unit: "hours", planned_hours: plannedHours,
  };
  const result = updateScheduleRecord({ ...context, form, now });
  if (result.error) return result;
  const moved = result.schedules.find(row => normalizeText(row.id) === normalizeText(source.id));
  const trayConflict = analyzeTaskTrayConflict({ ...context, candidate: moved });
  if (trayConflict) return { error: `移动后与 ${trayConflict.conflictSchedules.map(row => row.experimentLabel).join("、")} 共用托盘且时间重叠，请选择其他时段。` };
  // 手动确认的新时间成为后续自动顺延的基准，移除上一次延期的派生字段。
  for (const field of [
    "original_start_at", "original_end_at", "originalStartAt", "originalEndAt",
    "baseline_start_at", "baseline_end_at", "baselineStartAt", "baselineEndAt",
    "delay_minutes", "delayMinutes", "auto_delay_minutes", "autoDelayMinutes", "delay_reason", "delayReason",
    "delay_status", "delayStatus", "adjustment_status", "adjustmentStatus", "delay_conflict", "delayConflict",
    "delay_source_run_no", "delaySourceRunNo", "source_run_no", "sourceRunNo",
    "delay_waiting_for_estimated_end", "delayWaitingForEstimatedEnd", "auto_delayed", "autoDelayed", "delay_metadata", "delayMetadata",
  ]) {
    delete moved[field];
  }
  return {
    result,
    source: { ...source },
    target: { scheduleId, date, slot, lab },
    startAt: formatLocalDateTime(nextStart), endAt: formatLocalDateTime(nextEnd),
    taskCode: source.task_code, device: source.device, plannedHours,
    unchanged: sourceStart.getTime() === nextStart.getTime() && sourceEnd.getTime() === nextEnd.getTime(),
  };
}

function getGanttDropSlots(row, segmentIndex) {
  const start = row.segments.slice(0, segmentIndex).reduce((total, segment) => total + segment.colspan, 0);
  return row.slots.slice(start, start + row.segments[segmentIndex].colspan);
}

export { buildScheduleDragPreview, canDragSchedule, getGanttDropSlots };
