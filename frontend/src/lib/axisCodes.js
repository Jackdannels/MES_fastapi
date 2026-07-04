const DEFAULT_AXIS_CODES = Object.freeze(["x+", "x-", "y+", "y-", "z+", "z-"]);
const AXIS_ORDER = new Map(DEFAULT_AXIS_CODES.map((axisCode, index) => [axisCode, index]));

const normalizeText = (value) => String(value ?? "").trim();

const canonicalAxisCode = (value) => {
  const normalized = normalizeText(value);
  const lowered = normalized.toLowerCase();
  return AXIS_ORDER.has(lowered) ? lowered : normalized;
};

const sortAxisCodes = (axisCodes = []) => {
  const seen = new Set();
  return (Array.isArray(axisCodes) ? axisCodes : [])
    .map((axisCode, index) => ({ axisCode: canonicalAxisCode(axisCode), index }))
    .filter(({ axisCode }) => {
      const dedupeKey = axisCode.toLowerCase();
      if (!axisCode || seen.has(dedupeKey)) {
        return false;
      }
      seen.add(dedupeKey);
      return true;
    })
    .sort((left, right) => {
      const leftOrder = AXIS_ORDER.get(left.axisCode.toLowerCase()) ?? DEFAULT_AXIS_CODES.length;
      const rightOrder = AXIS_ORDER.get(right.axisCode.toLowerCase()) ?? DEFAULT_AXIS_CODES.length;
      return leftOrder - rightOrder || left.index - right.index;
    })
    .map(({ axisCode }) => axisCode);
};

const parseAxisCodeInput = (value) => {
  if (Array.isArray(value)) {
    return value;
  }
  const normalized = normalizeText(value);
  if (!normalized) {
    return [];
  }
  try {
    const parsed = JSON.parse(normalized);
    if (Array.isArray(parsed)) {
      return parsed;
    }
  } catch {
    // Legacy text values use delimiters instead of JSON arrays.
  }
  return normalized.split(/[,，/、\s]+/);
};

const normalizeAxisCodes = (value) => sortAxisCodes(parseAxisCodeInput(value));

const formatAxisCodeLabel = (value) => normalizeText(value).toUpperCase();

export {
  DEFAULT_AXIS_CODES,
  canonicalAxisCode,
  formatAxisCodeLabel,
  normalizeAxisCodes,
  sortAxisCodes,
};
