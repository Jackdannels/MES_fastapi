// 排程模型兼容入口：公开 API 保持稳定，具体职责由内部模型分担。
export {
  AXIS_CODE_OPTIONS,
  STATUS_COMPLETED,
  STATUS_RETENTION,
  STATUS_RUNNING,
  STATUS_SCHEDULED,
  STATUS_WAITING,
  isDeviceUnavailableForSchedule,
  resolveAxisScheduleDeviceLock,
  resolveDeviceUnavailableReason,
} from "./scheduleFoundationModel";
export { resolveTaskStatus } from "./scheduleLifecycleModel";
export {
  analyzeTaskTrayConflict,
  buildConflictRows,
  buildExperimentOptions,
  buildGanttRows,
  buildLabOptions,
  buildManualTaskOptions,
  buildRetentionInternalRows,
  buildScheduleRows,
  buildSummaryCards,
  buildTaskScheduledOverlays,
  resolveRetentionTimeState,
} from "./scheduleViewModel";
export {
  createScheduleRecord,
  deleteScheduleRecord,
  updateScheduleRecord,
} from "./scheduleRecordModel";
export {
  RETENTION_DEVICE,
  formatDateTime,
  isRetentionDevice,
  normalizeText,
  toLocalDateValue,
  toLocalTimeValue,
} from "./sharedModel";
export {
  PLANNED_DURATION_MAX_DAYS,
  PLANNED_DURATION_MAX_HOURS,
  buildManualTimeSlotOptions,
  buildScheduleEditForm,
  buildScheduleRescheduleForm,
  createManualScheduleForm,
  createScheduleEditForm,
  isManualScheduleSelectionLegal,
  resolveLegalManualScheduleState,
  resolveScheduleTimes,
} from "./formModel";
export { resolveScheduleDelayPresentation } from "./scheduleDelayPresentation";
