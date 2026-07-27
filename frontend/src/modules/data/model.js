// 将试验数据归档接口的响应整理为页面稳定消费的结构。
const normalizeText = (value) => String(value ?? "").trim();

function normalizeTestDataSettings(payload = {}) {
  return {
    defaultPath: normalizeText(payload.defaultPath ?? payload.default_path),
    detail: normalizeText(payload.detail),
    savePath: normalizeText(payload.savePath ?? payload.save_path),
    writable: payload.writable === true,
  };
}

function normalizeFailedExport(item = {}, index = 0) {
  return {
    axisCode: normalizeText(item.axisCode ?? item.axis_code),
    endedAt: normalizeText(item.endedAt ?? item.ended_at),
    error: normalizeText(item.error),
    experimentCode: normalizeText(item.experimentCode ?? item.experiment_code),
    experimentName: normalizeText(item.experimentName ?? item.experiment_name),
    exportKey: normalizeText(item.exportKey ?? item.export_key) || `failed-export-${index + 1}`,
    filePath: normalizeText(item.filePath ?? item.file_path),
    generatedAt: normalizeText(item.generatedAt ?? item.generated_at),
    runNo: normalizeText(item.runNo ?? item.run_no),
    sampleCode: normalizeText(item.sampleCode ?? item.sample_code),
    startedAt: normalizeText(item.startedAt ?? item.started_at),
    status: normalizeText(item.status) || "failed",
    taskCode: normalizeText(item.taskCode ?? item.task_code),
  };
}

function normalizeFailedExportList(payload = {}) {
  const items = Array.isArray(payload.items) ? payload.items.map(normalizeFailedExport) : [];
  const count = Number(payload.failedCount ?? payload.failed_count);
  return {
    failedCount: Number.isFinite(count) ? count : items.length,
    items,
  };
}

function formatAxisLabel(axisCode) {
  const normalized = normalizeText(axisCode);
  if (!normalized) {
    return "-";
  }
  return normalized.endsWith("轴向") ? normalized : `${normalized}轴向`;
}

const formatDateTime = (value) => {
  const normalized = normalizeText(value);
  if (!normalized) {
    return "";
  }
  return normalized.replace("T", " ").replace(/\.\d+(?:Z|[+-]\d\d:\d\d)?$/, "").slice(0, 16);
};

function formatExportRange(item = {}) {
  const startedAt = formatDateTime(item.startedAt);
  const endedAt = formatDateTime(item.endedAt);
  if (startedAt && endedAt) {
    return `${startedAt} — ${endedAt}`;
  }
  return startedAt || endedAt || "-";
}

export {
  formatAxisLabel,
  formatExportRange,
  normalizeFailedExport,
  normalizeFailedExportList,
  normalizeTestDataSettings,
};
