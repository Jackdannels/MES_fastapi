import { scheduleTargetsStorageArea } from "@/lib/labIdentity";
import { serverNowDate } from "@/lib/serverClock";
import {
  formatBusinessDateKey,
  formatBusinessDateTime,
  formatBusinessTime,
  parseBusinessDateTimeToMs,
} from "@/lib/dateTime";

const RETENTION_DEVICE = "恒温恒湿间（暂存间）";
const RETENTION_KEYWORD = "暂存间";

const SLOT_RANGES = Object.freeze({
  morning: { start: "08:00", end: "12:00", label: "上午 08:00-12:00" },
  afternoon: { start: "12:00", end: "18:00", label: "下午 12:00-18:00" },
});
const SLOT_BUFFER_MINUTES = 10;

// 排程模块的大部分判断都依赖稳定字符串，因此先做统一规范化。
const normalizeText = (value) => String(value ?? "").trim();
const isRetentionDevice = (value) => {
  if (value && typeof value === "object") {
    return scheduleTargetsStorageArea(value);
  }
  return normalizeText(value).includes(RETENTION_KEYWORD);
};

// 输入可能来自 ISO 字符串、空值或 Date 实例，统一在这里做容错解析。
const parseDate = (value) => {
  const time = parseBusinessDateTimeToMs(value);
  return Number.isFinite(time) ? new Date(time) : null;
};
const toLocalDateValue = (date) => {
  return formatBusinessDateKey(date);
};

// 从日期对象中提取 HH:mm，供时间输入框和展示逻辑复用。
const toLocalTimeValue = (value) => {
  return formatBusinessTime(value);
};

const truncateToMinute = (value) => {
  const date = parseDate(value);
  if (!date) {
    return null;
  }
  date.setSeconds(0, 0);
  return date;
};

// 排程表格统一展示 yyyy-MM-dd HH:mm 格式。
const formatDateTime = (value) => {
  return formatBusinessDateTime(value);
};

// 甘特图和默认排程窗口经常需要按天偏移。
const addDays = (date, days) => {
  const dateTime = formatBusinessDateTime(date, { includeSeconds: true });
  const match = dateTime.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}:\d{2}:\d{2})$/);
  if (!match) {
    return null;
  }
  const day = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + Number(days || 0)));
  const dateKey = `${day.getUTCFullYear()}-${String(day.getUTCMonth() + 1).padStart(2, "0")}-${String(day.getUTCDate()).padStart(2, "0")}`;
  return parseDate(`${dateKey}T${match[4]}`);
};

const buildSlotBoundary = (dateValue, timeValue) => parseDate(`${dateValue}T${timeValue}:00`);

const getLatestMorningScheduleEnd = (dateValue, schedules = [], device = "") => {
  const noonBoundary = buildSlotBoundary(dateValue, SLOT_RANGES.afternoon.start);
  const normalizedDevice = normalizeText(device);
  if (!noonBoundary) {
    return null;
  }

  let latestEnd = null;
  (Array.isArray(schedules) ? schedules : []).forEach((schedule) => {
    if (isRetentionDevice(schedule)) {
      return;
    }
    if (normalizedDevice && normalizeText(schedule?.device) !== normalizedDevice) {
      return;
    }
    const startAt = parseDate(schedule?.start_at);
    const endAt = parseDate(schedule?.end_at);
    if (!startAt || !endAt) {
      return;
    }
    if (toLocalDateValue(startAt) !== dateValue) {
      return;
    }
    if (startAt >= noonBoundary) {
      return;
    }
    if (!latestEnd || endAt > latestEnd) {
      latestEnd = endAt;
    }
  });

  return latestEnd;
};

const resolveFixedSlotStartAt = ({ dateValue, device = "", now = serverNowDate(), schedules = [], slot }) => {
  const range = SLOT_RANGES[slot] || SLOT_RANGES.morning;
  const current = truncateToMinute(now) || serverNowDate();
  let earliestStart = buildSlotBoundary(dateValue, range.start);
  const slotEnd = buildSlotBoundary(dateValue, range.end);

  if (!earliestStart || !slotEnd) {
    return null;
  }

  if (slot === "afternoon") {
    const latestMorningEnd = getLatestMorningScheduleEnd(dateValue, schedules, device);
    if (latestMorningEnd) {
      const bufferedStart = new Date(latestMorningEnd.getTime() + SLOT_BUFFER_MINUTES * 60 * 1000);
      if (bufferedStart > earliestStart) {
        earliestStart = bufferedStart;
      }
    }
  }

  if (toLocalDateValue(current) === dateValue && current >= earliestStart && current < slotEnd) {
    earliestStart = current;
  }

  return truncateToMinute(earliestStart);
};

const buildFixedSlotLabel = ({ dateValue, device = "", now = serverNowDate(), schedules = [], slot }) => {
  const range = SLOT_RANGES[slot] || SLOT_RANGES.morning;
  const prefix = slot === "afternoon" ? "下午" : "上午";
  const earliestStart = resolveFixedSlotStartAt({ dateValue, device, now, schedules, slot });
  const earliestText = toLocalTimeValue(earliestStart);
  if (!earliestText || earliestText === range.start) {
    return `${prefix}（${range.start}-${range.end}）`;
  }
  return `${prefix}（${range.start}-${range.end}，最早 ${earliestText} 开始）`;
};
// 判断两个时间区间是否重叠，是冲突检测和甘特图命中的基础工具。
const overlaps = (startA, endA, startB, endB) => startA < endB && endA > startB;

// 新增排程、流记录等前端实体时使用轻量级本地 ID。
const createId = (prefix) => {
  const random = Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, "0");
  return `${prefix}-${Date.now()}-${random}`;
};

// 甘特图里的时间段会根据当前时刻区分为进行中、已完成或忙碌。
const getSlotState = ({ startAt, endAt, now, started = false, completed = false }) => {
  if (completed && startAt && endAt) {
    if (endAt < now) {
      return { state: "completed", className: "gantt-slot busy completed" };
    }
    if (startAt <= now && endAt >= now) {
      return { state: "running", className: "gantt-slot busy running" };
    }
  }
  if (started) {
    return { state: "running", className: "gantt-slot busy running" };
  }
  return { state: "busy", className: "gantt-slot busy" };
};

export {
  RETENTION_DEVICE,
  RETENTION_KEYWORD,
  SLOT_RANGES,
  addDays,
  buildFixedSlotLabel,
  createId,
  formatDateTime,
  getSlotState,
  isRetentionDevice,
  normalizeText,
  overlaps,
  parseDate,
  resolveFixedSlotStartAt,
  toLocalDateValue,
  toLocalTimeValue,
  truncateToMinute,
};
