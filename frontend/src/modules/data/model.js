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

const normalizeCount = (value) => {
  const count = Number(value);
  return Number.isFinite(count) && count > 0 ? Math.trunc(count) : 0;
};

function normalizeExperimentOutput(item = {}, index = 0) {
  const experimentCode = normalizeText(item.experimentCode ?? item.experiment_code);
  const folderAvailable = item.folderAvailable === true || item.folder_available === true;
  const successfulPdfCount = normalizeCount(item.successfulPdfCount ?? item.successful_pdf_count);
  const explicitPdfCount = item.pdfCount ?? item.pdf_count;
  const rawStatus = normalizeText(item.status).toLowerCase();
  const status = item.completed === true || ["实验已完成", "实验完成", "实验已经完成"].includes(rawStatus)
    ? "completed"
    : (["实验进行中", "实验中", "进行中", "in_progress"].includes(rawStatus) ? "in_progress" : "pending");
  return {
    canOpen: item.canOpen === true || item.can_open === true || folderAvailable,
    canShare: item.canShare === true || item.can_share === true || successfulPdfCount > 0,
    experimentCode: experimentCode || `experiment-${index + 1}`,
    experimentName: normalizeText(item.experimentName ?? item.experiment_name) || experimentCode || `试验 ${index + 1}`,
    failedPdfCount: normalizeCount(item.failedPdfCount ?? item.failed_pdf_count),
    missingPdfCount: normalizeCount(item.missingPdfCount ?? item.missing_pdf_count),
    pdfCount: explicitPdfCount == null ? successfulPdfCount : normalizeCount(explicitPdfCount),
    status,
    successfulPdfCount,
  };
}

function normalizeTaskOutput(item = {}, index = 0) {
  const totalExperimentCount = normalizeCount(item.totalExperimentCount ?? item.total_experiment_count);
  const completedExperimentCount = Math.min(
    totalExperimentCount || Number.MAX_SAFE_INTEGER,
    normalizeCount(item.completedExperimentCount ?? item.completed_experiment_count),
  );
  const explicitProgress = Number(item.progressPercent ?? item.progress_percent);
  const progressPercent = Number.isFinite(explicitProgress)
    ? Math.max(0, Math.min(100, Math.round(explicitProgress)))
    : (totalExperimentCount ? Math.round((completedExperimentCount / totalExperimentCount) * 100) : 0);
  return {
    completedExperimentCount,
    experiments: Array.isArray(item.experiments) ? item.experiments.map(normalizeExperimentOutput) : [],
    failedPdfCount: normalizeCount(item.failedPdfCount ?? item.failed_pdf_count),
    missingPdfCount: normalizeCount(item.missingPdfCount ?? item.missing_pdf_count),
    progressPercent,
    successfulPdfCount: normalizeCount(item.successfulPdfCount ?? item.successful_pdf_count),
    taskCode: normalizeText(item.taskCode ?? item.task_code) || `task-${index + 1}`,
    totalExperimentCount,
  };
}

function normalizeTaskOutputList(payload = {}) {
  const items = Array.isArray(payload.items) ? payload.items.map(normalizeTaskOutput) : [];
  return {
    items,
    page: Math.max(1, normalizeCount(payload.page) || 1),
    pageSize: Math.max(1, normalizeCount(payload.pageSize ?? payload.page_size) || 20),
    total: normalizeCount(payload.total),
  };
}

function formatExperimentStatus(status) {
  const normalized = normalizeText(status).toLowerCase();
  const labels = {
    completed: "已完成",
    failed: "完成（PDF异常）",
    in_progress: "进行中",
    pending: "待完成",
  };
  return labels[normalized] || normalizeText(status) || "待完成";
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
  formatExperimentStatus,
  formatExportRange,
  normalizeFailedExport,
  normalizeFailedExportList,
  normalizeTaskOutput,
  normalizeTaskOutputList,
  normalizeTestDataSettings,
};
