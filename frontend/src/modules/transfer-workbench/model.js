export const MODE_CONFIGS = {
  handover: {
    allowConfirm: true,
    allowReset: true,
    detailHint: "支持触控先点托盘再点样品，也支持样品换位",
    detailTitle: "托盘分装与入库",
    headerTitle: "接驳区工作台",
    overviewTitle: "接驳任务总览",
    printTitle: "接驳区二维码打印",
    resetActionLabel: "重新入库",
  },
  "pre-allocation": {
    allowConfirm: false,
    allowReset: true,
    detailHelper: "当前为预接驳预分装模式，可保存托盘方案与打印二维码；正式入库由接驳区工作台执行。到货任务仅允许查看与打印。",
    detailHint: "支持鼠标拖拽与点击快速调整托盘",
    detailTitle: "任务样品分配管理",
    overviewTitle: "样品预分装",
    printTitle: "样品预分装二维码打印",
    resetActionLabel: "重新分配",
  },
};

const pendingStatus = "未入库";
const storedStatus = "到货";
const MAX_TRAY_LIMIT = 16;
const EXPERIMENT_TAG_TONES = [
  { bg: "rgba(14, 165, 233, 0.14)", border: "rgba(14, 165, 233, 0.45)", color: "#7dd3fc" },
  { bg: "rgba(16, 185, 129, 0.14)", border: "rgba(16, 185, 129, 0.4)", color: "#86efac" },
  { bg: "rgba(245, 158, 11, 0.16)", border: "rgba(245, 158, 11, 0.44)", color: "#facc15" },
  { bg: "rgba(244, 114, 182, 0.15)", border: "rgba(236, 72, 153, 0.42)", color: "#f9a8d4" },
  { bg: "rgba(168, 85, 247, 0.16)", border: "rgba(147, 51, 234, 0.44)", color: "#c4b5fd" },
  { bg: "rgba(239, 68, 68, 0.13)", border: "rgba(239, 68, 68, 0.38)", color: "#fca5a5" },
];
const XML_ESCAPE_MAP = {
  "&": "&amp;",
  "\"": "&quot;",
  "<": "&lt;",
  ">": "&gt;",
};

const normalizeTaskStatus = (status) => {
  const text = String(status || "").trim();
  if (text === storedStatus) return storedStatus;
  if (text === pendingStatus) return pendingStatus;
  return text;
};
const BARCODE_SAMPLE_PREVIEW_LIMIT = 4;
const OVERVIEW_SAMPLE_CODE_LIMIT = 12;

const normalizeText = (value) => String(value || "").trim();

const splitSampleCodesText = (value) => normalizeText(value)
  .split(/[、,，/|\s]+/u)
  .map((sampleCode) => normalizeText(sampleCode))
  .filter(Boolean);

const normalizeSampleCodeList = (sampleCodes) => (Array.isArray(sampleCodes)
  ? sampleCodes.map((sampleCode) => normalizeText(sampleCode)).filter(Boolean)
  : []);

const resolveOverviewSampleCodes = (task, { full = false } = {}) => {
  if (!full) {
    const previewCodes = normalizeSampleCodeList(task?.sampleCodePreview);
    if (previewCodes.length) {
      return previewCodes;
    }
  }
  const sampleCodes = normalizeSampleCodeList(task?.sampleCodes);
  if (sampleCodes.length && (!full || !task?.sampleCodeSearchText)) {
    return sampleCodes;
  }
  const searchCodes = splitSampleCodesText(task?.sampleCodeSearchText);
  if (searchCodes.length) {
    return searchCodes;
  }
  return splitSampleCodesText(task?.sampleCodesText);
};

const resolveOverviewSampleCodeCount = (task) => {
  const explicitCount = Number.parseInt(task?.sampleCodeCount, 10);
  if (Number.isFinite(explicitCount) && explicitCount >= 0) {
    return explicitCount;
  }
  return resolveOverviewSampleCodes(task, { full: true }).length;
};

const visibleOverviewSampleCodes = (task) => resolveOverviewSampleCodes(task).slice(0, OVERVIEW_SAMPLE_CODE_LIMIT);

const overviewSampleOverflowCount = (task) => Math.max(0, resolveOverviewSampleCodeCount(task) - visibleOverviewSampleCodes(task).length);

const buildOverviewSearchText = (task) => {
  const sampleSearchText = normalizeText(task?.sampleCodeSearchText)
    || normalizeText(task?.sampleCodesText)
    || normalizeSampleCodeList(task?.sampleCodes).join(" ");
  return [
    task?.taskNo,
    task?.taskType,
    task?.experimentTypeText,
    task?.taskProgress,
    sampleSearchText,
  ].join(" ").toLowerCase();
};

const normalizeTaskRecord = (task) => {
  const sampleCodePreview = normalizeSampleCodeList(task?.sampleCodePreview).length
    ? normalizeSampleCodeList(task?.sampleCodePreview)
    : normalizeSampleCodeList(task?.sampleCodes).slice(0, OVERVIEW_SAMPLE_CODE_LIMIT);
  return {
    ...task,
    taskStatus: normalizeTaskStatus(task?.taskStatus),
    sampleCodePreview,
    sampleCodeSearchText: normalizeText(task?.sampleCodeSearchText) || normalizeText(task?.sampleCodesText),
    overviewSearchText: buildOverviewSearchText({
      ...task,
      sampleCodePreview,
      sampleCodeSearchText: normalizeText(task?.sampleCodeSearchText) || normalizeText(task?.sampleCodesText),
    }),
  };
};

const resolveExperimentDisplayName = (experiment) =>
  normalizeText(experiment?.requiredDevice || experiment?.required_device || experiment?.experimentType || experiment?.experiment_type)
  || normalizeText(experiment?.experimentName || experiment?.experiment_name)
  || normalizeText(experiment?.experimentCode || experiment?.experiment_code)
  || "实验";

const encodeHtml = (value) => String(value || "").replace(/[&"<>]/g, (char) => XML_ESCAPE_MAP[char] || char);

const formatSampleCodePreview = (sampleCodes, limit = BARCODE_SAMPLE_PREVIEW_LIMIT) => {
  const codes = Array.isArray(sampleCodes)
    ? sampleCodes.map((sampleCode) => normalizeText(sampleCode)).filter(Boolean)
    : [];
  if (!codes.length) {
    return "-";
  }
  const visibleCodes = codes.slice(0, limit);
  return `${visibleCodes.join(" / ")}${codes.length > limit ? " / ..." : ""}`;
};

const resolveExperimentTagToneIndex = (value) => {
  const text = String(value || "").trim();
  const hash = Array.from(text).reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return hash % EXPERIMENT_TAG_TONES.length;
};

const resolveExperimentTagTone = (value) => {
  return `transfer-tray-experiment-tag--tone-${resolveExperimentTagToneIndex(value) + 1}`;
};

const buildExperimentTagPrintCss = () => EXPERIMENT_TAG_TONES.map((tone, index) => `
          .transfer-tray-experiment-tag--tone-${index + 1} {
            --tray-experiment-bg: ${tone.bg};
            --tray-experiment-border: ${tone.border};
            --tray-experiment-color: ${tone.color};
          }
`).join("");

const buildPrintExperimentTags = (item) => {
  const tags = (item.experimentLabels || []).map((label, index) => `
        <span class="transfer-tray-experiment-tag ${resolveExperimentTagTone(item.experimentCodes?.[index] || label)}">${encodeHtml(label)}</span>
      `).join("");
  if (!tags) {
    return "";
  }
  return `<div class="transfer-tray-experiment-tags print-experiment-tags">${tags}</div>`;
};

const normalizeTrayLimit = (value) => {
  const parsed = Number.parseInt(value, 10);
  return Math.min(MAX_TRAY_LIMIT, Math.max(1, Number.isFinite(parsed) ? parsed : 1));
};

const formatApiErrorDetail = (detail) => {
  if (typeof detail === "string") {
    return detail.trim();
  }
  if (Array.isArray(detail)) {
    return detail
      .map((item) => {
        if (typeof item === "string") {
          return item.trim();
        }
        if (item && typeof item === "object") {
          const path = Array.isArray(item.loc) ? item.loc.join(".") : "";
          const message = String(item.msg || item.message || item.detail || "").trim();
          return [path, message].filter(Boolean).join(": ");
        }
        return "";
      })
      .filter(Boolean)
      .join("；");
  }
  if (detail && typeof detail === "object") {
    return String(detail.message || detail.msg || detail.detail || "").trim();
  }
  return "";
};

export {
  BARCODE_SAMPLE_PREVIEW_LIMIT,
  OVERVIEW_SAMPLE_CODE_LIMIT,
  normalizeTaskStatus,
  normalizeText,
  splitSampleCodesText,
  normalizeSampleCodeList,
  resolveOverviewSampleCodes,
  resolveOverviewSampleCodeCount,
  visibleOverviewSampleCodes,
  overviewSampleOverflowCount,
  buildOverviewSearchText,
  normalizeTaskRecord,
  resolveExperimentDisplayName,
  encodeHtml,
  formatSampleCodePreview,
  resolveExperimentTagToneIndex,
  resolveExperimentTagTone,
  buildExperimentTagPrintCss,
  buildPrintExperimentTags,
  normalizeTrayLimit,
  formatApiErrorDetail,
};
