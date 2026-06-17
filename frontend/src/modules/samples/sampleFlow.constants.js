const DEFAULT_LABELS = {
  intakeLocation: "接驳区",
  unpackingLocation: "拆箱操作间",
  preRetentionLocation: "恒温恒湿间（暂存间）",
  retentionLocation: "恒温恒湿间（暂存间）",
  postRetentionLocation: "恒温恒湿间（实验后暂存间）",
  sampleReceived: "已接收",
  sampleTesting: "试验中",
  sampleStored: "到货",
};

const TEST_LABS = new Set([
  "冲击一室",
  "冲击二室",
  "振动一室",
  "振动二室",
  "四综合实验室",
  "温度冲击一室",
  "温度冲击二室",
  "高低温湿热一室",
  "高低温湿热二室",
  "盐雾试验室",
  "霉菌试验室",
]);

const TEST_LAB_OPTIONS = Array.from(TEST_LABS).sort((left, right) => left.localeCompare(right, "zh-Hans-CN"));

const SAMPLE_FLOW_STEPS = [
  { key: "in_transit", label: "样品运输中" },
  { key: "arrived", label: "到货" },
  { key: "sent_to_staging", label: "送至暂存间" },
  { key: "arrived_staging", label: "已到达暂存间" },
  { key: "sent_to_lab", label: "送至实验室" },
  { key: "arrived_lab", label: "已到达实验室" },
  { key: "fixture_install", label: "工装夹具安装" },
  { key: "ready", label: "实验准备就绪" },
  { key: "running", label: "实验进行中" },
  { key: "completed", label: "实验已完成" },
  { key: "post_test_staging", label: "实验后暂存间存放" },
  { key: "returned", label: "厂家收回" },
];

const APPEARANCE_INSPECTION_LOCATION = "外观检测间";
const APPEARANCE_SENT_STATUS = "送至外观检测间";
const APPEARANCE_STOCKED_STATUS = "外观检测间存放";
const APPEARANCE_PRE_EXPERIMENT_STOCKED_STATUS = "实验前外观检测存放";
const POST_EXPERIMENT_STAGING_SENT_STATUS = "送至实验后暂存间";
const POST_EXPERIMENT_STAGING_STOCKED_STATUS = "实验后暂存间存放";
const APPEARANCE_REQUIRED_KEYWORDS = ["盐雾", "霉菌"];

const requiresPreExperimentAppearanceStorage = (...values) => {
  const text = values.map((value) => String(value ?? "").trim()).filter(Boolean).join(" ");
  return APPEARANCE_REQUIRED_KEYWORDS.some((keyword) => text.includes(keyword));
};

const FLOW_STEP_KEY_BY_LABEL = new Map(SAMPLE_FLOW_STEPS.map((step) => [step.label, step.key]));
const FLOW_STEP_INDEX_BY_KEY = new Map(SAMPLE_FLOW_STEPS.map((step, index) => [step.key, index]));
const EXPERIMENT_STARTED_FLOW_INDEX = FLOW_STEP_INDEX_BY_KEY.get("sent_to_lab") ?? 4;
const EXPERIMENT_FLOW_STATUS_LABELS = {
  pending: "未完成",
  running: "进行中",
  completed: "已完成",
};
const MULTI_EXPERIMENT_ROUTE_STEPS = ["送至暂存间", "已到达暂存间", "送至实验室", "已到达实验室", "工装夹具安装", "实验准备就绪"];
const WITHDRAWAL_ACTIONS = new Set(["撤回出库", "实验任务撤回", "任务切换撤回"]);
const RUNNING_EXPERIMENT_RUN_STATUSES = new Set(["实验进行中", "实验中"]);

const BASE_DETAIL_STATUS_OPTIONS = SAMPLE_FLOW_STEPS.map((step) => step.label);
const PRE_EXPERIMENT_APPEARANCE_OPTION_INDEX = BASE_DETAIL_STATUS_OPTIONS.indexOf("已到达暂存间") + 1;
const POST_EXPERIMENT_STAGING_SENT_OPTION_INDEX = BASE_DETAIL_STATUS_OPTIONS.indexOf(POST_EXPERIMENT_STAGING_STOCKED_STATUS);
const DETAIL_STATUS_OPTIONS = [
  ...BASE_DETAIL_STATUS_OPTIONS.slice(0, PRE_EXPERIMENT_APPEARANCE_OPTION_INDEX),
  APPEARANCE_PRE_EXPERIMENT_STOCKED_STATUS,
  ...BASE_DETAIL_STATUS_OPTIONS.slice(PRE_EXPERIMENT_APPEARANCE_OPTION_INDEX, POST_EXPERIMENT_STAGING_SENT_OPTION_INDEX),
  POST_EXPERIMENT_STAGING_SENT_STATUS,
  ...BASE_DETAIL_STATUS_OPTIONS.slice(POST_EXPERIMENT_STAGING_SENT_OPTION_INDEX),
];
const FLOW_STATUS_LABELS = new Set(DETAIL_STATUS_OPTIONS);
const TRAY_STATUS_OPTIONS = DETAIL_STATUS_OPTIONS.slice();

export {
  APPEARANCE_INSPECTION_LOCATION,
  APPEARANCE_PRE_EXPERIMENT_STOCKED_STATUS,
  APPEARANCE_REQUIRED_KEYWORDS,
  APPEARANCE_SENT_STATUS,
  APPEARANCE_STOCKED_STATUS,
  DEFAULT_LABELS,
  DETAIL_STATUS_OPTIONS,
  EXPERIMENT_FLOW_STATUS_LABELS,
  EXPERIMENT_STARTED_FLOW_INDEX,
  FLOW_STATUS_LABELS,
  FLOW_STEP_INDEX_BY_KEY,
  FLOW_STEP_KEY_BY_LABEL,
  MULTI_EXPERIMENT_ROUTE_STEPS,
  POST_EXPERIMENT_STAGING_SENT_STATUS,
  POST_EXPERIMENT_STAGING_STOCKED_STATUS,
  RUNNING_EXPERIMENT_RUN_STATUSES,
  SAMPLE_FLOW_STEPS,
  TEST_LAB_OPTIONS,
  TEST_LABS,
  TRAY_STATUS_OPTIONS,
  WITHDRAWAL_ACTIONS,
  requiresPreExperimentAppearanceStorage,
};
