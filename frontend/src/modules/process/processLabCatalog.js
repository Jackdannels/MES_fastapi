import { parseBusinessDateTimeToMs } from "@/lib/dateTime";
import { getLabHostInterfaceCapabilities } from "@/lib/labHostInterfaceCapabilities";
import { normalizeLifecycleStatus } from "@/modules/samples/samplesFlowModel";

const PROCESS_FILTERS = {
  idle: "idle",
  overview: "overview",
  running: "running",
  scheduled: "scheduled",
};

const TRAY_STATUS_READY = "实验准备就绪";
const TRAY_STATUS_RUNNING = "实验进行中";
const RUNNING_TRAY_STATUSES = new Set([TRAY_STATUS_RUNNING, "实验中"]);
const COMPLETED_TRAY_STATUSES = new Set(["实验完成", "实验已完成", "实验已经完成", "实验后暂存间存放", "厂家收回"]);
const TRAY_FLOW_STATUS_RANK = new Map(
  [
    "样品运输中",
    "到货",
    "送至暂存间",
    "已到达暂存间",
    "送至实验室",
    "已到达实验室",
    "工装夹具安装",
    TRAY_STATUS_READY,
    TRAY_STATUS_RUNNING,
    "实验已完成",
    "实验后暂存间存放",
    "厂家收回",
  ].map((status, index) => [status, index]),
);

const BATCH_SUFFIX_PATTERNS = [
  /(?:\s*[-/|]\s*|\s+)?batch\s*[a-z0-9_-]*$/i,
  /(?:\s*[-/|]\s*|\s+)?\u6279\u6b21\s*[a-z0-9_-]*$/i,
];

const normalizeText = (value) => String(value ?? "").trim();
const asArray = (value) => (Array.isArray(value) ? value : []);

const toText = (value, fallback = "-") => {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
};

const toCount = (value) => {
  if (value === 0 || value === "0") {
    return 0;
  }
  return value ? value : "-";
};

const resolveMqttStartDisabledReason = (lab) => {
  const capabilities = getLabHostInterfaceCapabilities({
    labCode: lab?.code || lab?.labCode || lab?.lab_code,
    labName: lab?.name || lab?.lab_name,
  });
  return capabilities.experimentStartInterface === "hostless"
    ? "试验间将在准备就绪后自动开始实验"
    : "MQTT模式下等待上位机发送实验开始信号";
};

const normalizeMasterProcessLabs = (rows) =>
  asArray(rows)
    .filter((lab) => Number(lab?.status ?? 1) !== 0)
    .map((lab) => ({
      code: normalizeText(lab?.code || lab?.labCode || lab?.lab_code),
      name: normalizeText(lab?.name || lab?.lab_name),
      testType: normalizeText(lab?.testTypeName || lab?.test_type_name || lab?.testType || lab?.test_type),
      type: normalizeText(lab?.type || lab?.lab_type),
    }))
    .filter((lab) => lab.name && lab.testType && lab.type === "实验室")
    .map((lab) => ({ code: lab.code, name: lab.name, testType: lab.testType }));

const mergeProcessLabsWithStaticFallback = (masterLabs, fallbackLabs) => {
  if (!asArray(masterLabs).length) {
    return fallbackLabs;
  }
  const fallbackNames = new Set(asArray(fallbackLabs).map((lab) => normalizeText(lab?.name)).filter(Boolean));
  const overlapsStaticProcessLabs = masterLabs.some((lab) => fallbackNames.has(normalizeText(lab?.name)));
  if (!overlapsStaticProcessLabs) {
    return masterLabs;
  }
  const existingNames = new Set(masterLabs.map((lab) => normalizeText(lab?.name)).filter(Boolean));
  const missingFallbackLabs = asArray(fallbackLabs).filter((lab) => {
    const name = normalizeText(lab?.name);
    return name && !existingNames.has(name);
  });
  return [...masterLabs, ...missingFallbackLabs];
};

const sanitizeTaskDisplayName = (value, fallback = "-") => {
  let normalized = String(value ?? "").trim();
  if (!normalized) {
    return fallback;
  }
  BATCH_SUFFIX_PATTERNS.forEach((pattern) => {
    normalized = normalized.replace(pattern, "").trim();
  });
  return normalized || fallback;
};

const summarizeUniqueTexts = (values, fallback = "-") => {
  const unique = Array.from(new Set(asArray(values).map(normalizeText).filter(Boolean))).sort((left, right) =>
    left.localeCompare(right, "zh-Hans-CN"),
  );
  return unique.length ? unique.join("、") : fallback;
};

const parseScheduleTime = (value) => {
  const parsed = parseBusinessDateTimeToMs(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
};

const normalizeLocationList = (locations) =>
  Array.from(new Set(asArray(locations).map(normalizeText).filter(Boolean))).sort((left, right) =>
    left.localeCompare(right, "zh-Hans-CN"),
  );

const trayLabNames = (trayRow) => normalizeLocationList([
  ...asArray(trayRow?.locationNames),
  ...asArray(trayRow?.targetLabNames),
]);

const trayBelongsToLab = (trayRow, labName) => {
  const normalizedLabName = normalizeText(labName);
  if (!normalizedLabName) {
    return false;
  }
  const labNames = trayLabNames(trayRow);
  return labNames.length > 0 && labNames.includes(normalizedLabName);
};

const trayHasUnknownLocation = (trayRow) => trayLabNames(trayRow).length === 0;

const resolveTrayFlowStatusRank = (location, status) => {
  const normalizedStatus = normalizeLifecycleStatus(location, status);
  return TRAY_FLOW_STATUS_RANK.get(normalizedStatus) ?? -1;
};

export {
  COMPLETED_TRAY_STATUSES,
  PROCESS_FILTERS,
  RUNNING_TRAY_STATUSES,
  TRAY_STATUS_READY,
  TRAY_STATUS_RUNNING,
  asArray,
  mergeProcessLabsWithStaticFallback,
  normalizeLocationList,
  normalizeMasterProcessLabs,
  normalizeText,
  parseScheduleTime,
  resolveMqttStartDisabledReason,
  resolveTrayFlowStatusRank,
  sanitizeTaskDisplayName,
  summarizeUniqueTexts,
  toCount,
  toText,
  trayBelongsToLab,
  trayHasUnknownLocation,
};
