const pad2 = (value) => String(value ?? "").padStart(2, "0");
const LOCAL_DATE_TIME_PATTERN = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::(\d{2}))?$/;

// 业务时间统一按北京时间本地字符串输出，不携带时区。
function formatLocalDateTime(value = new Date(), { includeSeconds = true } = {}) {
  if (typeof value === "string") {
    const normalized = value.trim();
    const localMatch = normalized.match(LOCAL_DATE_TIME_PATTERN);
    if (localMatch && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(normalized)) {
      const seconds = localMatch[3] || "00";
      return includeSeconds
        ? `${localMatch[1]} ${localMatch[2]}:${seconds}`
        : `${localMatch[1]} ${localMatch[2]}`;
    }
  }
  const date = value instanceof Date ? value : new Date(value);
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return "";
  }
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "2-digit",
    second: "2-digit",
    timeZone: "Asia/Shanghai",
    year: "numeric",
  })
    .formatToParts(date)
    .reduce((acc, part) => ({ ...acc, [part.type]: part.value }), {});
  const year = parts.year;
  const month = parts.month;
  const day = parts.day;
  const hours = pad2(parts.hour === "24" ? "00" : parts.hour);
  const minutes = pad2(parts.minute);
  const seconds = pad2(parts.second);
  return includeSeconds ? `${year}-${month}-${day} ${hours}:${minutes}:${seconds}` : `${year}-${month}-${day} ${hours}:${minutes}`;
}

export { formatLocalDateTime };
