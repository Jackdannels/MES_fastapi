const LAB_LOCATIONS = Object.freeze([
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
  "恒温恒湿间（暂存间）",
  "恒温恒湿间（实验后暂存间）",
  "拆箱操作间",
  "室外接驳区",
]);

const LAB_TEST_MAP = Object.freeze({
  冲击一室: "冲击试验",
  冲击二室: "冲击试验",
  振动一室: "振动试验",
  振动二室: "振动试验",
  四综合实验室: "四综合试验",
  温度冲击一室: "温度冲击试验",
  温度冲击二室: "温度冲击试验",
  高低温湿热一室: "高低温湿热试验",
  高低温湿热二室: "高低温湿热试验",
  盐雾试验室: "盐雾试验",
  霉菌试验室: "霉菌试验",
});

const LAB_CODE_BY_NAME = Object.freeze({
  冲击一室: "LAB_IMPACT_1",
  冲击二室: "LAB_IMPACT_2",
  振动一室: "LAB_VIBRATION_1",
  振动二室: "LAB_VIBRATION_2",
  四综合实验室: "LAB_COMPREHENSIVE",
  温度冲击一室: "LAB_TEMP_SHOCK_1",
  温度冲击二室: "LAB_TEMP_SHOCK_2",
  高低温湿热一室: "LAB_HOT_HUMID",
  高低温湿热二室: "LAB_HOT_HUMID_2",
  盐雾试验室: "LAB_SALT",
  霉菌试验室: "LAB_MOLD",
});

const LAB_NAME_BY_CODE = Object.freeze(
  Object.fromEntries(Object.entries(LAB_CODE_BY_NAME).map(([name, code]) => [code, name])),
);

function resolveLaboratoryDisplayName(value) {
  const normalizedValue = String(value ?? "").trim();
  return LAB_NAME_BY_CODE[normalizedValue] || normalizedValue;
}

function resolveLaboratoryRouteKey(value) {
  const normalizedValue = String(value ?? "").trim();
  const displayName = resolveLaboratoryDisplayName(normalizedValue);
  return LAB_CODE_BY_NAME[displayName] || normalizedValue;
}

const TEST_PREFIX_MAP = Object.freeze({
  冲击试验: "CJ",
  振动试验: "ZD",
  四综合试验: "SZH",
  温度冲击试验: "WDC",
  高低温湿热试验: "GDW",
  盐雾试验: "YW",
  霉菌试验: "MJ",
});

const TEST_LABS = Object.freeze(LAB_LOCATIONS.filter((lab) => LAB_TEST_MAP[lab]));

function getLabsForTestType(testType) {
  const normalizedType = String(testType ?? "").trim();
  if (!normalizedType) {
    return [...TEST_LABS];
  }

  const labs = TEST_LABS.filter((lab) => LAB_TEST_MAP[lab] === normalizedType);
  return labs.length ? labs : [...TEST_LABS];
}

export {
  LAB_CODE_BY_NAME,
  LAB_LOCATIONS,
  LAB_NAME_BY_CODE,
  LAB_TEST_MAP,
  TEST_LABS,
  TEST_PREFIX_MAP,
  getLabsForTestType,
  resolveLaboratoryDisplayName,
  resolveLaboratoryRouteKey,
};
