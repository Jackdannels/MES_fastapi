const IMPACT_AXIS_CODES = Object.freeze(["x+", "x-", "y+", "z+", "y-", "z-"]);
const VIBRATION_AXIS_CODES = Object.freeze(["x", "y+", "z+", "y-", "z-"]);
const DEFAULT_AXIS_CODES = IMPACT_AXIS_CODES;
const AXIS_ORDER_CODES = Object.freeze(["x", ...IMPACT_AXIS_CODES]);
const AXIS_ORDER = new Map(AXIS_ORDER_CODES.map((axisCode, index) => [axisCode, index]));
const IMPACT_EXPERIMENT_TYPES = new Set(["冲击试验", "冲击实验"]);
const VIBRATION_EXPERIMENT_TYPES = new Set(["振动试验", "振动实验"]);

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
      const leftOrder = AXIS_ORDER.get(left.axisCode.toLowerCase()) ?? AXIS_ORDER_CODES.length;
      const rightOrder = AXIS_ORDER.get(right.axisCode.toLowerCase()) ?? AXIS_ORDER_CODES.length;
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

const axisCodesForExperimentType = (experimentType) => {
  const normalizedType = normalizeText(experimentType);
  if (IMPACT_EXPERIMENT_TYPES.has(normalizedType)) {
    return IMPACT_AXIS_CODES;
  }
  if (VIBRATION_EXPERIMENT_TYPES.has(normalizedType)) {
    return VIBRATION_AXIS_CODES;
  }
  return Object.freeze([]);
};

const normalizeAxisCodesForExperimentType = (value, experimentType) => {
  const allowedAxisCodes = axisCodesForExperimentType(experimentType);
  if (allowedAxisCodes.length === 0) {
    return [];
  }
  const selected = new Set(normalizeAxisCodes(value));
  return allowedAxisCodes.filter((axisCode) => selected.has(axisCode));
};

const formatAxisCodeLabel = (value) => normalizeText(value).toUpperCase();

export {
  DEFAULT_AXIS_CODES,
  IMPACT_AXIS_CODES,
  VIBRATION_AXIS_CODES,
  axisCodesForExperimentType,
  canonicalAxisCode,
  formatAxisCodeLabel,
  normalizeAxisCodes,
  normalizeAxisCodesForExperimentType,
  sortAxisCodes,
};
