import { describe, expect, test } from "vitest";

import {
  TASK_STATUS_COMPLETED,
  TASK_STATUS_RUNNING,
  TASK_STATUS_WAITING,
  TRANSFER_STATUS_ARRIVED,
  normalizeExperimentStatusLabel,
  normalizeTaskStatusLabel,
  isExperimentCompletedStatus,
  isExperimentRunningStatus,
  isTransferArrivedStatus,
} from "./statusNormalization";

describe("statusNormalization", () => {
  test("normalizes legacy experiment labels to canonical experiment labels", () => {
    expect(normalizeExperimentStatusLabel("实验中")).toBe("实验进行中");
    expect(normalizeExperimentStatusLabel("实验完成")).toBe("实验已完成");
    expect(normalizeExperimentStatusLabel("实验已经完成")).toBe("实验已完成");
    expect(normalizeExperimentStatusLabel("实验准备就绪")).toBe("实验准备就绪");
  });

  test("normalizes legacy task labels to canonical task labels", () => {
    expect(normalizeTaskStatusLabel("实验中")).toBe(TASK_STATUS_RUNNING);
    expect(normalizeTaskStatusLabel("实验进行中")).toBe(TASK_STATUS_RUNNING);
    expect(normalizeTaskStatusLabel("实验完成")).toBe(TASK_STATUS_COMPLETED);
    expect(normalizeTaskStatusLabel("实验已经完成")).toBe(TASK_STATUS_COMPLETED);
    expect(normalizeTaskStatusLabel("实验已完成")).toBe(TASK_STATUS_COMPLETED);
  });

  test("keeps old staging task labels from being treated as returned", () => {
    expect(normalizeTaskStatusLabel("暂存间排放")).toBe(TASK_STATUS_WAITING);
    expect(normalizeTaskStatusLabel("暂存间存放")).toBe(TASK_STATUS_WAITING);
  });

  test("recognizes only canonical transfer arrival labels", () => {
    expect(isTransferArrivedStatus("到货")).toBe(true);
    expect(isTransferArrivedStatus("已入库")).toBe(false);
    expect(normalizeTaskStatusLabel("已入库")).toBe("已入库");
  });

  test("recognizes canonical and legacy experiment running/completed labels", () => {
    expect(isExperimentRunningStatus("实验进行中")).toBe(true);
    expect(isExperimentRunningStatus("实验中")).toBe(true);
    expect(isExperimentCompletedStatus("实验已完成")).toBe(true);
    expect(isExperimentCompletedStatus("实验完成")).toBe(true);
    expect(isExperimentCompletedStatus("实验已经完成")).toBe(true);
  });
});
