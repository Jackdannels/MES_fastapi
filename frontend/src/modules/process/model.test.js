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
        status: "已排程",
        statusClass: "is-scheduled",
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

  test("buildProcessLabCards prefers the scheduled experiment label over task test_type", () => {
    const cards = buildProcessLabCards(
      [{ name: "Thermal Lab", testType: "高低温湿热试验" }],
      [
        {
          code: "TASK-001",
          test_type: "温度冲击试验 / 高低温湿热试验 / 盐雾试验",
        },
      ],
      [
        {
          device: "Thermal Lab",
          end_at: "2026-04-01T15:30:00Z",
          experiment_code: "TASK-001-B",
          start_at: "2026-04-01T12:00:00Z",
          task_code: "TASK-001",
        },
      ],
      [
        { task_code: "TASK-001", status: "已排程" },
      ],
      Date.parse("2026-04-01T13:00:00Z"),
      [
        { task_code: "TASK-001", experiment_code: "TASK-001-A", experiment_name: "温度冲击试验" },
        { task_code: "TASK-001", experiment_code: "TASK-001-B", experiment_name: "高低温湿热试验" },
        { task_code: "TASK-001", experiment_code: "TASK-001-C", experiment_name: "盐雾试验" },
      ]
    );

    expect(cards[0]).toEqual(
      expect.objectContaining({
        targetExperiment: "高低温湿热试验",
      })
    );
  });

  test("buildProcessLabCards scopes running state to the scheduled experiment instead of the whole task", () => {
    const cards = buildProcessLabCards(
      [
        { name: "Salt Lab", testType: "盐雾试验" },
        { name: "Thermal Lab", testType: "高低温湿热试验" },
      ],
      [{ code: "TASK-001", test_type: "盐雾试验 / 高低温湿热试验" }],
      [
        {
          device: "Salt Lab",
          end_at: "2026-04-09T21:35:00Z",
          experiment_code: "TASK-001-A",
          start_at: "2026-04-09T18:05:00Z",
          task_code: "TASK-001",
        },
        {
          device: "Thermal Lab",
          end_at: "2026-04-10T15:30:00Z",
          experiment_code: "TASK-001-B",
          start_at: "2026-04-10T12:00:00Z",
          task_code: "TASK-001",
        },
      ],
      [
        {
          code: "TASK-001-SP-001",
          task_code: "TASK-001",
          status: "实验进行中",
          trays: [{ tray_code: "TASK-001-TP-001", status: "实验进行中", quantity: 1 }],
        },
        {
          code: "TASK-001-SP-002",
          task_code: "TASK-001",
          status: "到货",
          trays: [{ tray_code: "TASK-001-TP-002", status: "到货", quantity: 1 }],
        },
      ],
      Date.parse("2026-04-09T18:30:00Z"),
      [
        { task_code: "TASK-001", experiment_code: "TASK-001-A", experiment_name: "盐雾试验" },
        { task_code: "TASK-001", experiment_code: "TASK-001-B", experiment_name: "高低温湿热试验" },
      ],
      [
        { task_code: "TASK-001", experiment_code: "TASK-001-A", tray_code: "TASK-001-TP-001" },
        { task_code: "TASK-001", experiment_code: "TASK-001-B", tray_code: "TASK-001-TP-002" },
      ]
    );

    expect(cards.find((card) => card.name === "Salt Lab")).toEqual(
      expect.objectContaining({
        status: "实验进行中",
        statusClass: "is-running",
      })
    );
    expect(cards.find((card) => card.name === "Thermal Lab")).toEqual(
      expect.objectContaining({
        status: "已排程",
        statusClass: "is-scheduled",
      })
    );
  });

  test("buildProcessLabCards ignores active schedules whose experiment is already completed", () => {
    const cards = buildProcessLabCards(
      [{ name: "Impact Lab 1", testType: "冲击试验" }],
      [{ code: "TASK-001", test_type: "冲击试验" }],
      [
        {
          device: "Impact Lab 1",
          end_at: "2026-04-09T12:00:00Z",
          experiment_code: "TASK-001-A",
          start_at: "2026-04-09T08:00:00Z",
          task_code: "TASK-001",
        },
      ],
      [],
      Date.parse("2026-04-09T09:00:00Z"),
      [
        {
          experiment_code: "TASK-001-A",
          experiment_name: "冲击试验",
          status: "实验已完成",
          task_code: "TASK-001",
        },
      ]
    );

    expect(cards[0]).toEqual(
      expect.objectContaining({
        hasTask: false,
        scheduleTime: "暂无排程",
        status: "空闲",
        statusClass: "is-idle",
        taskCode: "-",
        targetExperiment: "未分配",
      })
    );
  });

  test("buildProcessLabCards treats completed scoped trays as actual completion", () => {
    const cards = buildProcessLabCards(
      [{ name: "Impact Lab 1", testType: "冲击试验" }],
      [{ code: "TASK-002", test_type: "冲击试验" }],
      [
        {
          device: "Impact Lab 1",
          end_at: "2026-04-09T12:00:00Z",
          experiment_code: "TASK-002-A",
          start_at: "2026-04-09T08:00:00Z",
          task_code: "TASK-002",
        },
      ],
      [
        {
          code: "TASK-002-SP-001",
          task_code: "TASK-002",
          status: "实验已完成",
          trays: [{ tray_code: "TASK-002-TP-001", status: "实验已完成", quantity: 1 }],
        },
      ],
      Date.parse("2026-04-09T09:00:00Z"),
      [
        {
          experiment_code: "TASK-002-A",
          experiment_name: "冲击试验",
          status: "已排程",
          task_code: "TASK-002",
        },
      ],
      [
        { task_code: "TASK-002", experiment_code: "TASK-002-A", tray_code: "TASK-002-TP-001" },
      ]
    );

    expect(cards[0]).toEqual(
      expect.objectContaining({
        hasTask: false,
        status: "空闲",
        taskCode: "-",
      })
    );
  });

  test("buildProcessLabCards does not mark future labs running when shared trays are still located in the current lab", () => {
    const cards = buildProcessLabCards(
      [
        { name: "盐雾试验室", testType: "盐雾试验" },
        { name: "高低温湿热一室", testType: "高低温湿热试验" },
        { name: "振动一室", testType: "振动试验" },
      ],
      [{ code: "SYLU-2026-03-002", test_type: "盐雾试验 / 高低温湿热试验 / 振动试验" }],
      [
        {
          device: "盐雾试验室",
          end_at: "2026-04-09T13:35:38Z",
          experiment_code: "SYLU-2026-03-002-A",
          start_at: "2026-04-09T10:05:38Z",
          task_code: "SYLU-2026-03-002",
        },
        {
          device: "高低温湿热一室",
          end_at: "2026-04-10T07:30:00Z",
          experiment_code: "SYLU-2026-03-002-B",
          start_at: "2026-04-10T04:00:00Z",
          task_code: "SYLU-2026-03-002",
        },
        {
          device: "振动一室",
          end_at: "2026-04-10T07:30:00Z",
          experiment_code: "SYLU-2026-03-002-C",
          start_at: "2026-04-10T04:00:00Z",
          task_code: "SYLU-2026-03-002",
        },
      ],
      [
        {
          code: "SYLU-2026-03-002-SP-001",
          location: "盐雾试验室",
          status: "实验进行中",
          task_code: "SYLU-2026-03-002",
          trays: [{ tray_code: "SYLU-2026-03-002-TP-001", status: "实验进行中", quantity: 1 }],
        },
        {
          code: "SYLU-2026-03-002-SP-005",
          location: "盐雾试验室",
          status: "实验进行中",
          task_code: "SYLU-2026-03-002",
          trays: [{ tray_code: "SYLU-2026-03-002-TP-002", status: "实验进行中", quantity: 1 }],
        },
      ],
      Date.parse("2026-04-09T18:30:00Z"),
      [
        { task_code: "SYLU-2026-03-002", experiment_code: "SYLU-2026-03-002-A", experiment_name: "盐雾试验" },
        { task_code: "SYLU-2026-03-002", experiment_code: "SYLU-2026-03-002-B", experiment_name: "高低温湿热试验" },
        { task_code: "SYLU-2026-03-002", experiment_code: "SYLU-2026-03-002-C", experiment_name: "振动试验" },
      ],
      [
        { task_code: "SYLU-2026-03-002", experiment_code: "SYLU-2026-03-002-A", tray_code: "SYLU-2026-03-002-TP-001" },
        { task_code: "SYLU-2026-03-002", experiment_code: "SYLU-2026-03-002-A", tray_code: "SYLU-2026-03-002-TP-002" },
        { task_code: "SYLU-2026-03-002", experiment_code: "SYLU-2026-03-002-B", tray_code: "SYLU-2026-03-002-TP-002" },
        { task_code: "SYLU-2026-03-002", experiment_code: "SYLU-2026-03-002-C", tray_code: "SYLU-2026-03-002-TP-001" },
      ]
    );

    expect(cards.find((card) => card.name === "盐雾试验室")).toEqual(
      expect.objectContaining({
        status: "实验进行中",
        statusClass: "is-running",
      })
    );
    expect(cards.find((card) => card.name === "高低温湿热一室")).toEqual(
      expect.objectContaining({
        status: "已排程",
        statusClass: "is-scheduled",
      })
    );
    expect(cards.find((card) => card.name === "振动一室")).toEqual(
      expect.objectContaining({
        status: "已排程",
        statusClass: "is-scheduled",
      })
    );
  });
});
