const normalizeText = (value) => String(value ?? "").trim();

const isCompletedExperimentStep = (step) => {
  const label = normalizeText(step?.label);
  if (!label.endsWith("已完成")) {
    return false;
  }
  return label.includes("试验") || label.includes("实验");
};

const resolveVisualFlowStepTone = (step) => {
  if (step?.active) {
    return "active";
  }
  if (!step?.reached) {
    return "waiting";
  }
  if (normalizeText(step?.time) || isCompletedExperimentStep(step)) {
    return "done";
  }
  return "inferred";
};

const visualFlowStepClass = (step) => {
  const tone = resolveVisualFlowStepTone(step);
  return {
    "is-active": tone === "active",
    "is-done": tone === "done",
    "is-inferred": tone === "inferred",
    "is-waiting": tone === "waiting",
  };
};

const resolveVisualFlowStepTitle = (step, formatTime = (value) => normalizeText(value)) => {
  const time = normalizeText(step?.time);
  if (time) {
    return normalizeText(formatTime(time)) || time;
  }
  const tone = resolveVisualFlowStepTone(step);
  if (tone === "inferred") {
    return "推导节点，暂无实际时间记录";
  }
  if (tone === "done" && isCompletedExperimentStep(step)) {
    return "实验已完成";
  }
  return "";
};

export {
  resolveVisualFlowStepTitle,
  resolveVisualFlowStepTone,
  visualFlowStepClass,
};
