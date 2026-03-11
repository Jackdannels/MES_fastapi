import { describe, expect, test } from "vitest";

import { buildProcessLabCards, buildTaskOverviewPath } from "./processLabModel";

const labs = [
  { name: "冲击一室", testType: "冲击试验" },
  { name: "振动一室", testType: "振动试验" },
  { name: "盐雾试验室", testType: "盐雾试验" },
];

describe("processLabModel", () => {
  test("buildProcessLabCards marks labs as running, scheduled, or idle", () => {
    const cards = buildProcessLabCards(
      labs,
      [
        { code: "TASK-001", test_type: "冲击试验" },
        { code: "TASK-002", test_type: "振动试验" },
      ],
      [
        {
          device: "冲击一室",
          end_at: "2026-03-10T10:30:00Z",
          start_at: "2026-03-10T09:30:00Z",
          task_code: "TASK-001",
        },
        {
          device: "振动一室",
          end_at: "2026-03-10T13:00:00Z",
          start_at: "2026-03-10T12:00:00Z",
          task_code: "TASK-002",
        },
      ],
      Date.parse("2026-03-10T10:00:00Z")
    );

    expect(cards).toHaveLength(3);
    expect(cards.find((card) => card.name === "冲击一室")).toEqual(
      expect.objectContaining({
        status: "实验中",
        statusClass: "is-running",
        taskCode: "TASK-001",
        targetExperiment: "冲击试验",
      })
    );
    expect(cards.find((card) => card.name === "振动一室")).toEqual(
      expect.objectContaining({
        status: "已排期",
        statusClass: "is-scheduled",
        taskCode: "TASK-002",
        targetExperiment: "振动试验",
      })
    );
    expect(cards.find((card) => card.name === "盐雾试验室")).toEqual(
      expect.objectContaining({
        status: "空闲",
        statusClass: "is-idle",
        taskCode: "-",
        targetExperiment: "未分配",
      })
    );
  });

  test("buildTaskOverviewPath trims and omits empty query parameters", () => {
    expect(buildTaskOverviewPath({ taskCode: " TASK-001 ", testType: " 冲击试验 " })).toBe(
      "/task-overview?testType=%E5%86%B2%E5%87%BB%E8%AF%95%E9%AA%8C&task=TASK-001"
    );
    expect(buildTaskOverviewPath({ taskCode: "-", testType: "" })).toBe("/task-overview");
  });
});
