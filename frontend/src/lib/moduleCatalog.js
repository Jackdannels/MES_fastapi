const MODULE_ROUTES = Object.freeze({
  central: "/",
  handover: "/handover-system",
  visual: "/visualization",
  staging: "/staging-management",
  appearance: "/appearance-inspection",
  laboratory: "/laboratory",
});

const MODULE_LABELS = Object.freeze({
  central: "中控管理",
  handover: "接驳区系统",
  visual: "可视化管理",
  staging: "暂存间系统",
  appearance: "外观检测间系统",
  laboratory: "试验室操作台",
});

const MODULE_OPTIONS = Object.freeze(
  Object.keys(MODULE_ROUTES).map((key) => ({
    key,
    label: MODULE_LABELS[key] || key,
  })),
);

const LABORATORY_OPTIONS = Object.freeze(
  [
    "冲击二室",
    "冲击一室",
    "高低温湿热一室",
    "霉菌试验室",
    "四综合实验室",
    "温度冲击二室",
    "温度冲击一室",
    "盐雾试验室",
    "振动二室",
    "振动一室",
  ].map((label) => ({
    key: label,
    label,
  })),
);

export { LABORATORY_OPTIONS, MODULE_LABELS, MODULE_OPTIONS, MODULE_ROUTES };
