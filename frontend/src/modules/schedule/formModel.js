import { serverNowDate } from "@/lib/serverClock";
import {
  SLOT_RANGES,
  addDays,
  buildFixedSlotLabel,
  isRetentionDevice,
  normalizeText,
  parseDate,
  resolveFixedSlotStartAt,
  toLocalDateValue,
  toLocalTimeValue,
  truncateToMinute,
} from "./sharedModel";

const HALF_DAY_HOURS = 12;
const PLANNED_DURATION_MAX_DAYS = 99;
const PLANNED_DURATION_MAX_HOURS = 9999;

// 计划时长以 0.5 小时为最小粒度，其他输入都会归一化到这个精度。
const parsePlannedHours = (value) => {
  const rawValue = Number.parseFloat(String(value ?? "").trim());
  if (!Number.isFinite(rawValue)) {
    return null;
  }
  const normalized = Math.round(rawValue * 2) / 2;
  return normalized >= 0.5 ? Math.min(normalized, PLANNED_DURATION_MAX_HOURS) : null;
};

const parsePlannedDays = (value) => {
  const rawValue = Number.parseFloat(String(value ?? "").trim());
  if (!Number.isFinite(rawValue)) {
    return null;
  }
  const normalized = Math.round(rawValue * 2) / 2;
  return normalized >= 0.5 ? Math.min(normalized, PLANNED_DURATION_MAX_DAYS) : null;
};

const resolvePlannedHours = (form) => {
  const unit = normalizeText(form?.planned_duration_unit) || "hours";
  if (unit === "days") {
    const days = parsePlannedDays(form?.planned_hours);
    return days ? days * 24 : null;
  }
  return parsePlannedHours(form?.planned_hours);
};

// 如果没有显式填写计划时长，则从开始/结束时间反推。
const inferPlannedHours = (startAt, endAt) => {
  if (!startAt || !endAt) {
    return 3.5;
  }
  const hours = (endAt.getTime() - startAt.getTime()) / (1000 * 60 * 60);
  return parsePlannedHours(hours) || 3.5;
};

const buildPlannedDurationFormState = (plannedHours) => {
  const hours = parsePlannedHours(plannedHours);
  if (hours && Number.isInteger(hours / HALF_DAY_HOURS)) {
    return {
      plannedDurationUnit: "days",
      plannedHours: hours / 24,
    };
  }
  return {
    plannedDurationUnit: "hours",
    plannedHours: hours || 3.5,
  };
};

// 手动排程默认落在“当前时刻之后最近一个合法时段”。
const resolveLegalManualScheduleState = (now = serverNowDate()) => {
  const current = parseDate(now) || serverNowDate();
  const currentHour = current.getHours();

  if (currentHour < 12) {
    return {
      schedule_date: toLocalDateValue(current),
      time_slot: "morning",
    };
  }

  if (currentHour < 18) {
    return {
      schedule_date: toLocalDateValue(current),
      time_slot: "afternoon",
    };
  }

  return {
    schedule_date: toLocalDateValue(addDays(current, 1)),
    time_slot: "morning",
  };
};

function buildManualTimeSlotOptions({ device = "", now = serverNowDate(), scheduleDate = "", schedules = [] } = {}) {
  const selectedDate = normalizeText(scheduleDate) || toLocalDateValue(now);
  return [
    {
      value: "morning",
      label: buildFixedSlotLabel({ dateValue: selectedDate, device, now, schedules, slot: "morning" }),
    },
    {
      value: "afternoon",
      label: buildFixedSlotLabel({ dateValue: selectedDate, device, now, schedules, slot: "afternoon" }),
    },
    {
      value: "custom",
      label: "自定义",
    },
  ];
}

// 阻止用户把手动排程放到已经过去的非法时间片。
const isManualScheduleSelectionLegal = (form, now = serverNowDate()) => {
  const selectedDate = normalizeText(form?.schedule_date);
  const selectedSlot = normalizeText(form?.time_slot) || "morning";
  if (!selectedDate || selectedSlot === "custom") {
    return true;
  }

  const today = toLocalDateValue(now);
  if (selectedDate > today) {
    return true;
  }
  if (selectedDate < today) {
    return false;
  }

  const currentHour = now.getHours();
  if (currentHour >= 18) {
    return false;
  }
  if (currentHour >= 12 && selectedSlot === "morning") {
    return false;
  }
  return true;
};

// 表单工厂用于统一手动创建和编辑状态的数据结构。
function createManualScheduleForm(now = serverNowDate()) {
  const legalState = resolveLegalManualScheduleState(now);
  return {
    axis_batch_no: "",
    axis_codes: [],
    custom_end: "",
    custom_start: "",
    device: "",
    experiment_code: "",
    lab_code: "",
    lab_id: "",
    planned_hours: 3.5,
    planned_duration_unit: "hours",
    schedule_date: legalState.schedule_date,
    task_code: "",
    time_slot: legalState.time_slot,
  };
}

function createScheduleEditForm() {
  return {
    axis_batch_no: "",
    axis_codes: [],
    custom_end: "",
    custom_start: "",
    device: "",
    experiment_code: "",
    id: "",
    lab_code: "",
    lab_id: "",
    planned_hours: 3.5,
    planned_duration_unit: "hours",
    schedule_date: "",
    task_code: "",
    time_slot: "morning",
  };
}

// 将已存排程映射为编辑抽屉所需的表单结构。
function buildScheduleEditForm(schedule) {
  const startAt = parseDate(schedule?.start_at);
  const endAt = parseDate(schedule?.end_at);
  const startTime = startAt ? toLocalTimeValue(startAt) : "";
  const endTime = endAt ? toLocalTimeValue(endAt) : "";
  const duration = buildPlannedDurationFormState(schedule?.planned_hours || inferPlannedHours(startAt, endAt));
  let timeSlot = "custom";

  if (startTime === SLOT_RANGES.morning.start) {
    timeSlot = "morning";
  } else if (startTime === SLOT_RANGES.afternoon.start) {
    timeSlot = "afternoon";
  }

  // 编辑表单会尽量把固定时段还原回上午/下午选项，否则回退到自定义时段。
  return {
    axis_batch_no: normalizeText(schedule?.axis_batch_no ?? schedule?.axisBatchNo),
    axis_codes: Array.isArray(schedule?.axis_codes ?? schedule?.axisCodes) ? [...(schedule?.axis_codes ?? schedule?.axisCodes)] : [],
    custom_end: endTime,
    custom_start: startTime,
    device: normalizeText(schedule?.device),
    experiment_code: normalizeText(schedule?.experiment_code),
    id: normalizeText(schedule?.id),
    lab_code: normalizeText(schedule?.lab_code ?? schedule?.labCode),
    lab_id: schedule?.lab_id ?? schedule?.labId ?? "",
    planned_hours: duration.plannedHours,
    planned_duration_unit: duration.plannedDurationUnit,
    schedule_date: startAt ? toLocalDateValue(startAt) : "",
    task_code: normalizeText(schedule?.task_code),
    time_slot: timeSlot,
  };
}

function resolveRescheduleCustomStart(editForm, now) {
  if (editForm.time_slot !== "custom") {
    return editForm;
  }
  const current = truncateToMinute(parseDate(now)) || null;
  const startAt = parseDate(`${editForm.schedule_date}T${editForm.custom_start}:00`);
  if (!current || !startAt || startAt >= current) {
    return editForm;
  }
  return {
    ...editForm,
    custom_start: toLocalTimeValue(current),
    schedule_date: toLocalDateValue(current),
  };
}

function buildScheduleRescheduleForm(schedule, now = null) {
  const editForm = buildScheduleEditForm(schedule);
  const nextForm = now ? resolveRescheduleCustomStart(editForm, now) : editForm;
  return {
    axis_batch_no: nextForm.axis_batch_no,
    axis_codes: nextForm.axis_codes,
    custom_end: nextForm.custom_end,
    custom_start: nextForm.custom_start,
    device: nextForm.device,
    experiment_code: nextForm.experiment_code,
    lab_code: nextForm.lab_code,
    lab_id: nextForm.lab_id,
    planned_hours: nextForm.planned_hours,
    planned_duration_unit: nextForm.planned_duration_unit,
    schedule_date: nextForm.schedule_date,
    task_code: nextForm.task_code,
    time_slot: nextForm.time_slot,
  };
}

// 解析手动排程操作实际使用的开始和结束时间。
function resolveScheduleTimes(form, now = serverNowDate(), schedules = []) {
  const dateValue = normalizeText(form?.schedule_date);
  if (!dateValue) {
    return { error: "Invalid schedule date" };
  }

  const isRetention = isRetentionDevice(form?.device);
  if (isRetention) {
    // 暂存间记录按“立即进入、立即结束”的占位逻辑处理，不占正式实验时长。
    const startAt = new Date(now.getTime());
    const endAt = new Date(now.getTime());
    return {
      dateValue: toLocalDateValue(startAt),
      endAt,
      endTime: toLocalTimeValue(endAt),
      plannedHours: 0,
      slot: "retention",
      startAt,
      startTime: toLocalTimeValue(startAt),
    };
  }

  const slot = normalizeText(form?.time_slot) || "morning";
  let startTime = "";
  let plannedHours = resolvePlannedHours(form);

  if (slot === "custom") {
    // 自定义时段优先使用手填开始时间，如未填计划时长则从结束时间反推。
    startTime = normalizeText(form?.custom_start);
    if (!startTime) {
      return { error: "Custom start time required" };
    }
    const customStartAt = parseDate(`${dateValue}T${startTime}:00`);
    const earliestCustomStart = truncateToMinute(now) || serverNowDate();
    if (!customStartAt || customStartAt < earliestCustomStart) {
      return { error: "自定义开始时间不能早于当前时间" };
    }
    if (!plannedHours) {
      const endTime = normalizeText(form?.custom_end);
      const endAt = parseDate(`${dateValue}T${endTime}:00`);
      plannedHours = inferPlannedHours(customStartAt, endAt);
    }
  } else {
    // 上午/下午快捷时段直接复用预设时间窗。
    const range = SLOT_RANGES[slot] || SLOT_RANGES.morning;
    const slotStartAt = resolveFixedSlotStartAt({ dateValue, device: form?.device, now, schedules, slot });
    startTime = toLocalTimeValue(slotStartAt) || range.start;
    plannedHours ||= inferPlannedHours(
      slotStartAt,
      parseDate(`${dateValue}T${range.end}:00`),
    );
  }

  if (!plannedHours) {
    return { error: "Planned hours must be at least 0.5" };
  }

  const startAt = parseDate(`${dateValue}T${startTime}:00`);
  const endAt = startAt ? new Date(startAt.getTime() + plannedHours * 60 * 60 * 1000) : null;
  if (!startAt || !endAt || endAt <= startAt) {
    return { error: "Invalid schedule time" };
  }

  return {
    dateValue,
    endAt,
    endTime: toLocalTimeValue(endAt),
    plannedHours,
    slot,
    startAt,
    startTime,
  };
}

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
};
