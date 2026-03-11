import { describe, expect, test } from "vitest";

import { buildProcessLabCards, buildTaskOverviewPath } from "./processLabModel";

const labs = [
  { name: "Impact Lab 1", testType: "Impact Test" },
  { name: "Vibration Lab 1", testType: "Vibration Test" },
  { name: "Salt Spray Lab", testType: "Salt Spray Test" },
];

describe("processLabModel", () => {
  test("buildProcessLabCards only keeps labs that are active or still relevant", () => {
    const cards = buildProcessLabCards(
      [...labs, { name: "Thermal Impact Lab", testType: "Thermal Impact Test" }],
      [
        { code: "TASK-001", test_type: "Impact Test" },
        { code: "TASK-002", test_type: "Vibration Test" },
        { code: "TASK-003", test_type: "Thermal Impact Test" },
      ],
      [
        {
          device: "Impact Lab 1",
          end_at: "2026-03-10T10:30:00Z",
          start_at: "2026-03-10T09:30:00Z",
          task_code: "TASK-001",
        },
        {
          device: "Vibration Lab 1",
          end_at: "2026-03-10T13:00:00Z",
          start_at: "2026-03-10T12:00:00Z",
          task_code: "TASK-002",
        },
        {
          device: "Thermal Impact Lab",
          end_at: "2026-03-09T08:30:00Z",
          start_at: "2026-03-09T06:30:00Z",
          task_code: "TASK-003",
        },
      ],
      Date.parse("2026-03-10T10:00:00Z")
    );

    expect(cards).toHaveLength(2);
    expect(cards.find((card) => card.name === "Impact Lab 1")).toEqual(
      expect.objectContaining({
        status: "实验中",
        statusClass: "is-running",
        taskCode: "TASK-001",
        targetExperiment: "Impact Test",
      })
    );
    expect(cards.find((card) => card.name === "Vibration Lab 1")).toEqual(
      expect.objectContaining({
        status: "已排期",
        statusClass: "is-scheduled",
        taskCode: "TASK-002",
        targetExperiment: "Vibration Test",
      })
    );
    expect(cards.find((card) => card.name === "Salt Spray Lab")).toBeUndefined();
    expect(cards.find((card) => card.name === "Thermal Impact Lab")).toBeUndefined();
  });

  test("buildProcessLabCards keeps labs visible for 24 hours after completion", () => {
    const cards = buildProcessLabCards(
      [{ name: "Recent Lab", testType: "Impact Test" }],
      [{ code: "TASK-RECENT", test_type: "Impact Test" }],
      [
        {
          device: "Recent Lab",
          end_at: "2026-03-10T08:30:00Z",
          start_at: "2026-03-10T06:30:00Z",
          task_code: "TASK-RECENT",
        },
      ],
      Date.parse("2026-03-10T10:00:00Z")
    );

    expect(cards).toHaveLength(1);
    expect(cards[0]).toEqual(
      expect.objectContaining({
        name: "Recent Lab",
        status: "已排期",
        statusClass: "is-scheduled",
        taskCode: "TASK-RECENT",
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
