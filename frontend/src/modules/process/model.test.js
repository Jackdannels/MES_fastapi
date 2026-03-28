import { describe, expect, test } from "vitest";

import { buildProcessLabCards, buildTaskOverviewPath } from "./model";

const labs = [
  { name: "Impact Lab 1", testType: "Impact Test" },
  { name: "Vibration Lab 1", testType: "Vibration Test" },
  { name: "Salt Spray Lab", testType: "Salt Spray Test" },
];

describe("processLabModel", () => {
  test("buildProcessLabCards returns all formal labs and marks unscheduled labs idle", () => {
    const cards = buildProcessLabCards(
      [...labs, { name: "Thermal Impact Lab", testType: "Thermal Impact Test" }],
      [
        { code: "TASK-001", test_type: "Impact Test" },
        { code: "TASK-002", test_type: "Vibration Test" },
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

    expect(cards).toHaveLength(4);
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
        status: "已排程",
        statusClass: "is-scheduled",
        taskCode: "TASK-002",
        targetExperiment: "Vibration Test",
      })
    );
    expect(cards.find((card) => card.name === "Salt Spray Lab")).toEqual(
      expect.objectContaining({
        name: "Salt Spray Lab",
        status: "空闲",
        statusClass: "is-idle",
        taskCode: "-",
        scheduleTime: "暂无排程",
      })
    );
    expect(cards.find((card) => card.name === "Thermal Impact Lab")).toEqual(
      expect.objectContaining({
        name: "Thermal Impact Lab",
        status: "空闲",
        statusClass: "is-idle",
        taskCode: "-",
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
