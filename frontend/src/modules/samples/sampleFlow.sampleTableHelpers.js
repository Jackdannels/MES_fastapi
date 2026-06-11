import { filterActiveTasks } from "@/lib/taskArchive";
import { normalizeText } from "./sampleFlow.shared";

const resolveStatusClass = (status) => {
  const normalized = normalizeText(status);
  if (
    normalized === "\u9001\u81F3\u5B9E\u9A8C\u5BA4" ||
    normalized === "\u5DF2\u5230\u8FBE\u5B9E\u9A8C\u5BA4" ||
    normalized === "\u5DE5\u88C5\u5939\u5177\u5B89\u88C5" ||
    normalized === "\u5B9E\u9A8C\u51C6\u5907\u5C31\u7EEA" ||
    normalized === "\u5B9E\u9A8C\u8FDB\u884C\u4E2D"
  ) {
    return "status running";
  }
  if (
    normalized === "\u9001\u81F3\u6682\u5B58\u95F4" ||
    normalized === "\u5DF2\u5230\u8FBE\u6682\u5B58\u95F4" ||
    normalized === "\u653E\u7F6E\u5B9E\u9A8C\u540E\u6682\u5B58\u95F4"
  ) {
    return "status retention";
  }
  if (
    normalized === "\u5DF2\u5904\u7F6E" ||
    normalized === "\u5382\u5BB6\u6536\u56DE" ||
    normalized === "\u5B9E\u9A8C\u5DF2\u5B8C\u6210"
  ) {
    return "status completed";
  }
  if (normalized === "\u6837\u54C1\u8FD0\u8F93\u4E2D" || normalized === "\u8FD0\u8F93\u4E2D" || normalized === "\u5230\u8D27") {
    return "status accepted";
  }
  return "status";
};

const compareValue = (left, right, direction) => {
  const factor = direction === "desc" ? -1 : 1;
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
    return (leftNumber - rightNumber) * factor;
  }
  return normalizeText(left).localeCompare(normalizeText(right), "zh-Hans-CN") * factor;
};

const filterSamplesForActiveTasks = (samples, tasks) => {
  const taskList = Array.isArray(tasks) ? tasks : [];
  if (taskList.length === 0) {
    return Array.isArray(samples) ? samples : [];
  }
  const activeTaskCodes = new Set(
    filterActiveTasks(taskList, samples)
      .map((task) => normalizeText(task?.code))
      .filter(Boolean),
  );
  return (Array.isArray(samples) ? samples : []).filter((sample) => {
    const taskCode = normalizeText(sample?.task_code);
    return !taskCode || activeTaskCodes.has(taskCode);
  });
};

export {
  compareValue,
  filterSamplesForActiveTasks,
  resolveStatusClass,
};
