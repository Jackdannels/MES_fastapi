const MODULE_ROUTES = Object.freeze({
  central: "/",
  handover: "/handover-system",
  visual: "/visualization",
  staging: "/staging-management",
});

const MODULE_LABELS = Object.freeze({
  central: "中控管理",
  handover: "接驳区系统",
  visual: "可视化管理",
  staging: "暂存间系统",
});

const MODULE_OPTIONS = Object.freeze(
  Object.keys(MODULE_ROUTES).map((key) => ({
    key,
    label: MODULE_LABELS[key] || key,
  })),
);

export { MODULE_LABELS, MODULE_OPTIONS, MODULE_ROUTES };
