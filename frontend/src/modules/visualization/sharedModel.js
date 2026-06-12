const asArray = (value) => (Array.isArray(value) ? value : []);
const firstNonEmptyArray = (...values) => {
  const arrays = values.filter(Array.isArray);
  return arrays.find((value) => value.length > 0) || arrays[0] || [];
};
const normalizeText = (value) => String(value ?? "").trim();
const compareText = (left, right) => normalizeText(left).localeCompare(normalizeText(right), "zh-Hans-CN", { numeric: true });
const normalizeQuantity = (value) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
};
const parseDate = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};
const parseTimeValue = (value) => {
  const time = Date.parse(String(value || ""));
  return Number.isFinite(time) ? time : 0;
};
const addDays = (date, days) => {
  const next = new Date(date.getTime());
  next.setDate(next.getDate() + days);
  return next;
};
const startOfLocalDay = (value) => {
  const date = parseDate(value) || new Date();
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
};
const overlaps = (startA, endA, startB, endB) => startA < endB && endA > startB;

const resolveTaskCode = (entry) => normalizeText(entry?.task_code || entry?.taskCode || entry?.code);
const resolveExperimentCode = (entry) => normalizeText(entry?.experiment_code || entry?.experimentCode || entry?.code);
const resolveTrayCode = (entry) => normalizeText(entry?.tray_code || entry?.trayCode || entry?.code);
const resolveLabDevice = (entry) => normalizeText(entry?.device || entry?.required_device || entry?.requiredDevice || entry?.lab || entry?.labName);
const resolveDeviceName = (device) => normalizeText(device?.code) || normalizeText(device?.name);

const buildExperimentByTaskAndCode = (experiments) => {
  const map = new Map();
  asArray(experiments).forEach((experiment) => {
    const taskCode = resolveTaskCode(experiment);
    const experimentCode = resolveExperimentCode(experiment);
    if (taskCode && experimentCode) {
      map.set(`${taskCode}::${experimentCode}`, experiment);
    }
  });
  return map;
};

export {
  addDays,
  asArray,
  buildExperimentByTaskAndCode,
  compareText,
  firstNonEmptyArray,
  normalizeQuantity,
  normalizeText,
  overlaps,
  parseDate,
  parseTimeValue,
  resolveExperimentCode,
  resolveLabDevice,
  resolveDeviceName,
  resolveTaskCode,
  resolveTrayCode,
  startOfLocalDay,
};
