const CONFIRM_STORAGE_ACTIONS = new Set(["任务已确认入库", "任务重新入库"]);

const normalizeText = (value) => String(value ?? "").trim();

const parseTimeValue = (value) => {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : Number.NaN;
};

function resolveTransferConfirmedAt({ samples = [], task } = {}) {
  const taskCode = normalizeText(task?.code || task?.task_code);
  const times = [];

  (Array.isArray(samples) ? samples : []).forEach((sample) => {
    if (taskCode && normalizeText(sample?.task_code) !== taskCode) {
      return;
    }
    (Array.isArray(sample?.history) ? sample.history : []).forEach((entry) => {
      if (!CONFIRM_STORAGE_ACTIONS.has(normalizeText(entry?.action))) {
        return;
      }
      const detail = normalizeText(entry?.detail);
      if (taskCode && detail && detail !== taskCode) {
        return;
      }
      const time = parseTimeValue(entry?.time);
      if (Number.isFinite(time)) {
        times.push(time);
      }
    });
  });

  if (times.length === 0) {
    return null;
  }
  return new Date(Math.min(...times));
}

export { resolveTransferConfirmedAt };
