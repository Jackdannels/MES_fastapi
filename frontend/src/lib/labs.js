const LAB_LOCATIONS = Object.freeze([
  "冲击一室",
  "冲击二室",
  "振动一室",
  "振动二室",
  "四综合实验室",
  "温度冲击一室",
  "温度冲击二室",
  "高低温湿热一室",
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
  盐雾试验室: "盐雾试验",
  霉菌试验室: "霉菌试验",
});

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

export { LAB_LOCATIONS, LAB_TEST_MAP, TEST_LABS, TEST_PREFIX_MAP, getLabsForTestType };
