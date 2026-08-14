import { canonicalAxisCode, normalizeAxisCodes } from "@/lib/axisCodes";
import { formatLocalDateTime, parseBusinessDateTimeToMs } from "@/lib/dateTime";
import { LAB_COMPARE_STATUS, LAB_INSTALL_STATUS, LAB_READY_STATUS } from "./laboratoryConstants";

const RESETTABLE_TRAY_STATUSES = new Set([LAB_COMPARE_STATUS, LAB_INSTALL_STATUS, LAB_READY_STATUS]);
export const SWITCH_REVERTIBLE_TRAY_STATUSES = RESETTABLE_TRAY_STATUSES;
export const TASK_SWITCH_LOCKED_TRAY_STATUSES = new Set([
  LAB_COMPARE_STATUS,
  LAB_INSTALL_STATUS,
  LAB_READY_STATUS,
  "实验进行中",
  "实验中",
  "实验暂停",
  "中途外观检查中",
  "中途检查完成，返回盐雾试验室",
  "等待恢复实验",
]);
export const COMPLETED_EXPERIMENT_RUN_STATUSES = new Set(["实验完成", "实验已完成", "实验已经完成"]);

export const normalizeText = (value) => String(value ?? "").trim();

export const formatFlowTimeForAttendance = (value) => {
  const time = parseBusinessDateTimeToMs(value);
  if (!Number.isFinite(time)) {
    return "--:--";
  }
  return formatLocalDateTime(new Date(time), { includeSeconds: false }).slice(-5);
};

export const formatAttendanceDuration = (elapsedSeconds) => {
  const seconds = Math.max(0, Math.floor(Number(elapsedSeconds) || 0));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
};

export const isResettableTrayStatus = (status) => {
  const normalized = normalizeText(status);
  return RESETTABLE_TRAY_STATUSES.has(normalized);
};

export const formatErrorMessage = (error) => normalizeText(error?.message || error) || "未知错误";
export const generateExperimentRunNo = () => `run-${Date.now()}-${Math.floor(Math.random() * 1000).toString().padStart(3, "0")}`;
export const generateFixtureInstallId = () => `fixture-install-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
export const stepAxisCode = (step) => canonicalAxisCode(step?.axis_code || step?.axisCode);
export const stepRunNo = (step) => normalizeText(step?.run_no || step?.runNo);
export const stepStatus = (step) => normalizeText(step?.status || step?.step_status || step?.stepStatus);
export const scheduleAxisCodes = (schedule) => normalizeAxisCodes(schedule?.axis_codes ?? schedule?.axisCodes);
export const resolveSubExperimentCode = (value = {}) =>
  normalizeText(value?.subExperimentCode ?? value?.sub_experiment_code ?? value?.sub_experiment_no ?? value?.subExperimentNo);
