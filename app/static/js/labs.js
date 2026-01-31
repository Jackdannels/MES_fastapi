/* FILE: labs.js
 * Lab/test mappings and select option initialization.
 */
import { getLabels } from "./labels.js";

// Lab locations and mapping to test types.
const LAB_LOCATIONS = [
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
  "拆箱操作间",
  "室外接驳区",
];

const LAB_TEST_MAP = {
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
};

const TEST_PREFIX_MAP = {
  冲击试验: "CJ",
  振动试验: "ZD",
  四综合试验: "SZH",
  温度冲击试验: "WDC",
  高低温湿热试验: "GDW",
  盐雾试验: "YW",
  霉菌试验: "MJ",
};

const TEST_TYPES = Array.from(new Set(Object.keys(TEST_PREFIX_MAP)));
const TEST_LABS = LAB_LOCATIONS.filter((lab) => LAB_TEST_MAP[lab]);

function getLabsForTestType(testType) {
  if (!testType) {
    return [...TEST_LABS];
  }
  const matches = TEST_LABS.filter((lab) => LAB_TEST_MAP[lab] === testType);
  return matches.length ? matches : [...TEST_LABS];
}

function appendOption(select, value) {
  const exists = Array.from(select.options).some((option) => option.value === value);
  if (exists) {
    return;
  }
  const option = document.createElement("option");
  option.value = value;
  option.textContent = value;
  select.appendChild(option);
}

function bindLabToTestType(select) {
  if (select.dataset.labLinked === "1") {
    return;
  }
  select.addEventListener("change", () => {
    const testType = LAB_TEST_MAP[select.value];
    if (!testType) {
      return;
    }
    const root = select.closest("form") || select.closest(".form-grid") || document;
    const testSelect = root.querySelector("select[data-test-type-select]");
    if (!testSelect) {
      return;
    }
    appendOption(testSelect, testType);
    testSelect.value = testType;
  });
  select.dataset.labLinked = "1";
}

// Populate lab selects and sync test type when needed.
function initLabSelects() {
  document.querySelectorAll("select[data-lab-select]").forEach((select) => {
    if (select.dataset.labFilled === "1") {
      bindLabToTestType(select);
      return;
    }
    LAB_LOCATIONS.forEach((name) => {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = name;
      select.appendChild(option);
    });
    const customOption = document.createElement("option");
    customOption.value = "其他/自定义";
    customOption.textContent = "其他/自定义";
    select.appendChild(customOption);
    select.dataset.labFilled = "1";
    bindLabToTestType(select);
  });
}

function initTestTypeSelects() {
  document.querySelectorAll("select[data-test-type-select]").forEach((select) => {
    if (select.dataset.testTypeFilled === "1") {
      return;
    }
    TEST_TYPES.forEach((type) => appendOption(select, type));
    appendOption(select, "其他/自定义");
    select.dataset.testTypeFilled = "1";
  });
}


// Populate dispatch target (labs + retention).
function initDispatchTargetSelects() {
  const labels = getLabels();
  const retention = labels.retentionLocation || "";
  document.querySelectorAll("select[data-dispatch-target-select]").forEach((select) => {
    if (select.dataset.dispatchTargetFilled === "1") {
      return;
    }
    TEST_LABS.forEach((lab) => appendOption(select, lab));
    if (retention) {
      appendOption(select, retention);
    }
    select.dataset.dispatchTargetFilled = "1";
  });
}

// Populate lab options for lab-only selects.
function initTestLabSelects() {
  document.querySelectorAll("select[data-test-lab-select]").forEach((select) => {
    if (select.dataset.testLabFilled === "1") {
      return;
    }
    TEST_LABS.forEach((lab) => appendOption(select, lab));
    const customOption = document.createElement("option");
    customOption.value = "其他/自定义";
    customOption.textContent = "其他/自定义";
    select.appendChild(customOption);
    select.dataset.testLabFilled = "1";
  });
}

export {
  LAB_LOCATIONS,
  LAB_TEST_MAP,
  TEST_LABS,
  TEST_PREFIX_MAP,
  getLabsForTestType,
  initLabSelects,
  initTestLabSelects,
  initDispatchTargetSelects,
  initTestTypeSelects,
};
