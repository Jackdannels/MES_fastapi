const pad2 = (value) => String(value ?? "").padStart(2, "0");

// 到样时间属于用户可读业务时间，统一按浏览器本地时区格式化。
function formatLocalDateTime(value = new Date(), { includeSeconds = true } = {}) {
  const date = value instanceof Date ? value : new Date(value);
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return "";
  }
  const year = date.getFullYear();
  const month = pad2(date.getMonth() + 1);
  const day = pad2(date.getDate());
  const hours = pad2(date.getHours());
  const minutes = pad2(date.getMinutes());
  const seconds = pad2(date.getSeconds());
  return includeSeconds ? `${year}-${month}-${day} ${hours}:${minutes}:${seconds}` : `${year}-${month}-${day} ${hours}:${minutes}`;
}

export { formatLocalDateTime };
