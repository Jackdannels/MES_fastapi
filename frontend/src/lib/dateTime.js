const pad2 = (value) => String(value ?? "").padStart(2, "0");
const LOCAL_DATE_TIME_PATTERN = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::(\d{2}))?$/;
const TIMEZONE_SUFFIX_PATTERN = /[zZ]|[+-]\d{2}:?\d{2}$/;
const BUSINESS_TIME_ZONE = "Asia/Shanghai";

function parseBusinessDateTimeToMs(value) {
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : null;
  }
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    return null;
  }
  const localMatch = normalized.match(LOCAL_DATE_TIME_PATTERN);
  const parseValue = localMatch && !TIMEZONE_SUFFIX_PATTERN.test(normalized)
    ? `${localMatch[1]}T${localMatch[2]}:${localMatch[3] || "00"}+08:00`
    : normalized;
  const time = Date.parse(parseValue);
  return Number.isFinite(time) ? time : null;
}

function getBusinessDateTimeParts(value) {
  const time = parseBusinessDateTimeToMs(value);
  if (!Number.isFinite(time)) {
    return null;
  }
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "2-digit",
    second: "2-digit",
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
  })
    .formatToParts(new Date(time))
    .reduce((acc, part) => ({ ...acc, [part.type]: part.value }), {});
  return {
    day: parts.day,
    hours: pad2(parts.hour === "24" ? "00" : parts.hour),
    minutes: pad2(parts.minute),
    month: parts.month,
    seconds: pad2(parts.second),
    year: parts.year,
  };
}

function formatBusinessDateKey(value) {
  const parts = getBusinessDateTimeParts(value);
  return parts ? `${parts.year}-${parts.month}-${parts.day}` : "";
}

function formatBusinessTime(value, { includeSeconds = false } = {}) {
  const parts = getBusinessDateTimeParts(value);
  if (!parts) {
    return "";
  }
  const time = `${parts.hours}:${parts.minutes}`;
  return includeSeconds ? `${time}:${parts.seconds}` : time;
}

function formatBusinessDateTime(value, { includeSeconds = false } = {}) {
  const dateKey = formatBusinessDateKey(value);
  const time = formatBusinessTime(value, { includeSeconds });
  return dateKey && time ? `${dateKey} ${time}` : "";
}

// 业务时间统一按北京时间本地字符串输出，不携带时区。
function formatLocalDateTime(value = new Date(), { includeSeconds = true } = {}) {
  if (typeof value === "string") {
    const normalized = value.trim();
    const localMatch = normalized.match(LOCAL_DATE_TIME_PATTERN);
    if (localMatch && !TIMEZONE_SUFFIX_PATTERN.test(normalized)) {
      const seconds = localMatch[3] || "00";
      return includeSeconds
        ? `${localMatch[1]} ${localMatch[2]}:${seconds}`
        : `${localMatch[1]} ${localMatch[2]}`;
    }
  }
  return formatBusinessDateTime(value, { includeSeconds });
}

export {
  formatBusinessDateKey,
  formatBusinessDateTime,
  formatBusinessTime,
  formatLocalDateTime,
  parseBusinessDateTimeToMs,
};
