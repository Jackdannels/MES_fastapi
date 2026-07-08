import { describe, expect, test } from "vitest";

import { PROCESS_LABS, buildProcessLabCards, buildTaskOverviewPath, scheduleExperimentIsCompleted } from "./model";

const labs = [
  { name: "Impact Lab 1", testType: "Impact Test" },
  { name: "Vibration Lab 1", testType: "Vibration Test" },
  { name: "Salt Spray Lab", testType: "Salt Spray Test" },
];

describe("processLabModel", () => {
  test("PROCESS_LABS includes both high humid rooms as process fallbacks", () => {
    expect(PROCESS_LABS.filter((lab) => lab.testType === "高低温湿热试验").map((lab) => lab.name)).toEqual([
      "高低温湿热一室",
      "高低温湿热二室",
    ]);
  });

  test("buildProcessLabCards matches schedules by lab code before display device text", () => {
    const cards = buildProcessLabCards(
      [{ code: "LAB_SALT", name: "Salt Spray Lab", testType: "Salt Spray Test" }],
      [{ code: "TASK-SALT", test_type: "Salt Spray Test" }],
      [
        {
          device: "盐雾试验室",
          lab_code: "LAB_SALT",
          end_at: "2026-03-10T12:00:00Z",
          start_at: "2026-03-10T09:30:00Z",
          task_code: "TASK-SALT",
        },
      ],
      Date.parse("2026-03-10T10:00:00Z")
    );

    expect(cards.find((card) => card.name === "Salt Spray Lab")).toEqual(
      expect.objectContaining({ status: "已排程", taskCode: "TASK-SALT" }),
    );
  });

  test("buildProcessLabCards formats schedule time in Beijing business time", () => {
    const cards = buildProcessLabCards(
      [{ code: "LAB_SALT", name: "Salt Spray Lab", testType: "Salt Spray Test" }],
      [{ code: "TASK-SALT", test_type: "Salt Spray Test" }],
      [
        {
          device: "Salt Spray Lab",
          lab_code: "LAB_SALT",
          end_at: "2026-07-03T02:30:00.000Z",
          start_at: "2026-07-03T01:00:00.000Z",
          task_code: "TASK-SALT",
        },
      ],
      Date.parse("2026-07-03T01:30:00.000Z"),
    );

    expect(cards.find((card) => card.name === "Salt Spray Lab")).toEqual(
      expect.objectContaining({ scheduleTime: "07/03 09:00 - 07/03 10:30" }),
    );
  });

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
        experimentCode: "TASK-001-B",
        targetExperiment: "高低温湿热试验",
      })
    );
  });

  test("buildProcessLabCards shows maintenance state from device resources", () => {
    const cards = buildProcessLabCards(
      [{ name: "Salt Lab", testType: "盐雾试验" }],
      [{ code: "TASK-001", test_type: "盐雾试验" }],
      [
        {
          device: "Salt Lab",
          end_at: "2026-04-01T15:30:00Z",
          experiment_code: "TASK-001-A",
          start_at: "2026-04-01T12:00:00Z",
          task_code: "TASK-001",
        },
      ],
      [],
      Date.parse("2026-04-01T13:00:00Z"),
      [{ task_code: "TASK-001", experiment_code: "TASK-001-A", experiment_name: "盐雾试验" }],
      [],
      [{ code: "Salt Lab", status: "维护/校准" }],
    );

    expect(cards[0]).toEqual(
      expect.objectContaining({
        canStartExperiment: false,
        startDisabledReason: "设备维护中，禁止开始实验",
        status: "维护/校准",
        statusClass: "is-maintenance",
      }),
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
      ],
      [],
      [],
      [
        {
          task_code: "TASK-001",
          experiment_code: "TASK-001-A",
          tray_code: "TASK-001-TP-001",
          run_tray_status: "实验进行中",
        },
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

  test("buildProcessLabCards does not mark lab cards running from stale sample text without an active run", () => {
    const cards = buildProcessLabCards(
      [{ name: "Salt Lab", testType: "盐雾试验" }],
      [{ code: "TASK-STALE", test_type: "盐雾试验" }],
      [
        {
          device: "Salt Lab",
          end_at: "2026-04-09T21:35:00Z",
          experiment_code: "TASK-STALE-A",
          start_at: "2026-04-09T18:05:00Z",
          task_code: "TASK-STALE",
        },
      ],
      [
        {
          code: "TASK-STALE-SP-001",
          task_code: "TASK-STALE",
          status: "实验进行中",
          trays: [{ tray_code: "TASK-STALE-TP-001", status: "实验进行中", quantity: 1 }],
        },
      ],
      Date.parse("2026-04-09T18:30:00Z"),
      [{ task_code: "TASK-STALE", experiment_code: "TASK-STALE-A", experiment_name: "盐雾试验" }],
      [{ task_code: "TASK-STALE", experiment_code: "TASK-STALE-A", tray_code: "TASK-STALE-TP-001" }],
    );

    expect(cards[0]).toEqual(
      expect.objectContaining({
        status: "已排程",
        statusClass: "is-scheduled",
      }),
    );
  });

  test("buildProcessLabCards does not mark lab cards running from experiment run tray_codes without run-tray relations", () => {
    const cards = buildProcessLabCards(
      [{ name: "Salt Lab", testType: "盐雾试验" }],
      [{ code: "TASK-RUN-CODES", test_type: "盐雾试验" }],
      [
        {
          device: "Salt Lab",
          end_at: "2026-04-09T21:35:00Z",
          experiment_code: "TASK-RUN-CODES-A",
          start_at: "2026-04-09T18:05:00Z",
          task_code: "TASK-RUN-CODES",
        },
      ],
      [],
      Date.parse("2026-04-09T18:30:00Z"),
      [{ task_code: "TASK-RUN-CODES", experiment_code: "TASK-RUN-CODES-A", experiment_name: "盐雾试验" }],
      [{ task_code: "TASK-RUN-CODES", experiment_code: "TASK-RUN-CODES-A", tray_code: "TASK-RUN-CODES-TP-001" }],
      [],
      [
        {
          task_code: "TASK-RUN-CODES",
          experiment_code: "TASK-RUN-CODES-A",
          device: "Salt Lab",
          status: "实验进行中",
          tray_codes: ["TASK-RUN-CODES-TP-001"],
        },
      ],
      []
    );

    expect(cards[0]).toEqual(
      expect.objectContaining({
        status: "已排程",
        statusClass: "is-scheduled",
      }),
    );
  });

  test("buildProcessLabCards does not mark trays ready from sample status when tray status is blank", () => {
    const cards = buildProcessLabCards(
      [{ name: "Salt Lab", testType: "盐雾试验" }],
      [{ code: "TASK-SAMPLE-READY", test_type: "盐雾试验" }],
      [
        {
          device: "Salt Lab",
          end_at: "2026-04-09T21:35:00Z",
          experiment_code: "TASK-SAMPLE-READY-A",
          start_at: "2026-04-09T18:05:00Z",
          task_code: "TASK-SAMPLE-READY",
        },
      ],
      [
        {
          code: "TASK-SAMPLE-READY-SP-001",
          location: "Salt Lab",
          status: "实验准备就绪",
          task_code: "TASK-SAMPLE-READY",
          trays: [{ tray_code: "TASK-SAMPLE-READY-TP-001", quantity: 1 }],
        },
      ],
      Date.parse("2026-04-09T18:30:00Z"),
      [{ task_code: "TASK-SAMPLE-READY", experiment_code: "TASK-SAMPLE-READY-A", experiment_name: "盐雾试验" }],
      [{ task_code: "TASK-SAMPLE-READY", experiment_code: "TASK-SAMPLE-READY-A", tray_code: "TASK-SAMPLE-READY-TP-001" }]
    );

    expect(cards[0]).toEqual(
      expect.objectContaining({
        canStartExperiment: false,
        status: "已排程",
      }),
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

  test("buildProcessLabCards keeps scoped trays visible when only the experiment global status is completed", () => {
    const cards = buildProcessLabCards(
      [{ name: "Impact Lab 1", testType: "冲击试验" }],
      [{ code: "TASK-GLOBAL", test_type: "冲击试验" }],
      [
        {
          device: "Impact Lab 1",
          end_at: "2026-04-09T12:00:00Z",
          experiment_code: "TASK-GLOBAL-A",
          start_at: "2026-04-09T08:00:00Z",
          task_code: "TASK-GLOBAL",
        },
      ],
      [
        {
          code: "TASK-GLOBAL-SP-001",
          task_code: "TASK-GLOBAL",
          status: "已到达实验室",
          trays: [{ tray_code: "TASK-GLOBAL-TP-001", status: "已到达实验室", quantity: 1 }],
        },
      ],
      Date.parse("2026-04-09T09:00:00Z"),
      [
        {
          experiment_code: "TASK-GLOBAL-A",
          experiment_name: "冲击试验",
          status: "实验已完成",
          task_code: "TASK-GLOBAL",
        },
      ],
      [{ task_code: "TASK-GLOBAL", experiment_code: "TASK-GLOBAL-A", tray_code: "TASK-GLOBAL-TP-001" }],
    );

    expect(cards[0]).toEqual(
      expect.objectContaining({
        hasTask: true,
        status: "已排程",
        statusClass: "is-scheduled",
        taskCode: "TASK-GLOBAL",
      }),
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

  test("scheduleExperimentIsCompleted does not complete a tray from a substring tray-code history match", () => {
    const taskCode = "TASK-TRAY-SUBSTRING";

    expect(scheduleExperimentIsCompleted({
      experiments: [
        { task_code: taskCode, experiment_code: "EXP-A", experiment_name: "冲击试验" },
      ],
      experimentTrays: [
        { task_code: taskCode, experiment_code: "EXP-A", tray_code: "TP-001" },
        { task_code: taskCode, experiment_code: "EXP-A", tray_code: "TP-0010" },
      ],
      samples: [
        {
          task_code: taskCode,
          trays: [
            { tray_code: "TP-001", status: "实验进行中" },
            { tray_code: "TP-0010", status: "实验进行中" },
          ],
          history: [
            { detail: `${taskCode} / 冲击试验 / 实验已完成 / TP-0010`, time: "2026-06-06 14:00:00" },
          ],
        },
      ],
      schedule: { task_code: taskCode, experiment_code: "EXP-A" },
      taskStatusMap: new Map(),
    })).toBe(false);
  });

  test("scheduleExperimentIsCompleted keeps staging arrival from completing the scoped experiment", () => {
    expect(scheduleExperimentIsCompleted({
      experiments: [
        { task_code: "TASK-STAGING", experiment_code: "EXP-IMPACT", experiment_name: "冲击试验" },
      ],
      experimentRunTrays: [
        {
          task_code: "TASK-STAGING",
          experiment_code: "EXP-IMPACT",
          tray_code: "TP-001",
          run_tray_status: "已到达暂存间",
        },
      ],
      experimentTrays: [
        { task_code: "TASK-STAGING", experiment_code: "EXP-IMPACT", tray_code: "TP-001" },
      ],
      samples: [
        {
          task_code: "TASK-STAGING",
          trays: [{ tray_code: "TP-001", status: "已到达暂存间" }],
        },
      ],
      schedule: { task_code: "TASK-STAGING", experiment_code: "EXP-IMPACT" },
      taskStatusMap: new Map(),
    })).toBe(false);
  });

  test("scheduleExperimentIsCompleted ignores unscoped completion history for multi-tray samples", () => {
    expect(scheduleExperimentIsCompleted({
      experiments: [
        { task_code: "TASK-HISTORY", experiment_code: "EXP-MOLD", experiment_name: "霉菌试验" },
      ],
      experimentTrays: [
        { task_code: "TASK-HISTORY", experiment_code: "EXP-MOLD", tray_code: "TP-001" },
        { task_code: "TASK-HISTORY", experiment_code: "EXP-MOLD", tray_code: "TP-002" },
      ],
      samples: [
        {
          task_code: "TASK-HISTORY",
          trays: [
            { tray_code: "TP-001", status: "实验已完成" },
            { tray_code: "TP-002", status: "已到达实验室" },
          ],
          history: [
            { detail: "TASK-HISTORY / 霉菌试验 / 实验已完成", status: "实验已完成" },
          ],
        },
      ],
      schedule: { task_code: "TASK-HISTORY", experiment_code: "EXP-MOLD" },
      taskStatusMap: new Map(),
    })).toBe(false);
  });

  test("buildProcessLabCards hides returned shared-tray experiments when every scoped tray is completed or returned", () => {
    const taskCode = "SYLU-2026-06-021";
    const cards = buildProcessLabCards(
      [
        { name: "冲击二室", testType: "冲击试验" },
        { name: "温度冲击二室", testType: "温度冲击试验" },
      ],
      [{ code: taskCode, test_type: "冲击试验 / 温度冲击试验 / 振动试验" }],
      [
        {
          device: "冲击二室",
          end_at: "2026-06-05T12:00:00+08:00",
          experiment_code: `${taskCode}-A`,
          start_at: "2026-06-05T08:00:00+08:00",
          status: "实验进行中",
          task_code: taskCode,
        },
        {
          device: "温度冲击二室",
          end_at: "2026-06-05T18:00:00+08:00",
          experiment_code: `${taskCode}-B`,
          start_at: "2026-06-05T14:00:00+08:00",
          status: "实验进行中",
          task_code: taskCode,
        },
      ],
      [
        {
          code: `${taskCode}-SP-001`,
          task_code: taskCode,
          status: "厂家收回",
          trays: [{ tray_code: `${taskCode}-TP-001`, status: "厂家收回", quantity: 1 }],
          history: [
            { detail: `${taskCode} / 冲击试验 / 实验已完成`, status: "实验已完成", time: "2026-06-05 10:00:00" },
            { detail: `${taskCode} / 温度冲击试验 / 实验已完成`, status: "实验已完成", time: "2026-06-05 16:00:00" },
          ],
        },
        {
          code: `${taskCode}-SP-002`,
          task_code: taskCode,
          status: "厂家收回",
          trays: [{ tray_code: `${taskCode}-TP-002`, status: "厂家收回", quantity: 1 }],
          history: [
            { detail: `${taskCode} / 温度冲击试验 / 实验已完成`, status: "实验已完成", time: "2026-06-05 16:10:00" },
          ],
        },
        {
          code: `${taskCode}-SP-003`,
          task_code: taskCode,
          location: "厂家收回",
          status: "厂家收回",
          trays: [{ tray_code: `${taskCode}-TP-003`, status: "厂家收回", quantity: 1 }],
        },
        {
          code: `${taskCode}-SP-004`,
          task_code: taskCode,
          location: "厂家收回",
          status: "厂家收回",
          trays: [{ tray_code: `${taskCode}-TP-004`, status: "厂家收回", quantity: 1 }],
          history: [
            { detail: `${taskCode} / 冲击试验 / 实验已完成`, status: "实验已完成", time: "2026-06-05 10:20:00" },
          ],
        },
        {
          code: `${taskCode}-SP-005`,
          task_code: taskCode,
          status: "厂家收回",
          trays: [{ tray_code: `${taskCode}-TP-005`, status: "厂家收回", quantity: 1 }],
          history: [
            { detail: `${taskCode} / 冲击试验 / 实验已完成`, status: "实验已完成", time: "2026-06-05 10:30:00" },
            { detail: `${taskCode} / 温度冲击试验 / 实验已完成`, status: "实验已完成", time: "2026-06-05 16:30:00" },
          ],
        },
      ],
      Date.parse("2026-06-05T17:00:00+08:00"),
      [
        { task_code: taskCode, experiment_code: `${taskCode}-A`, experiment_name: "冲击试验" },
        { task_code: taskCode, experiment_code: `${taskCode}-B`, experiment_name: "温度冲击试验" },
      ],
      [
        { task_code: taskCode, experiment_code: `${taskCode}-A`, tray_code: `${taskCode}-TP-001` },
        { task_code: taskCode, experiment_code: `${taskCode}-A`, tray_code: `${taskCode}-TP-003` },
        { task_code: taskCode, experiment_code: `${taskCode}-A`, tray_code: `${taskCode}-TP-004` },
        { task_code: taskCode, experiment_code: `${taskCode}-A`, tray_code: `${taskCode}-TP-005` },
        { task_code: taskCode, experiment_code: `${taskCode}-B`, tray_code: `${taskCode}-TP-001` },
        { task_code: taskCode, experiment_code: `${taskCode}-B`, tray_code: `${taskCode}-TP-002` },
        { task_code: taskCode, experiment_code: `${taskCode}-B`, tray_code: `${taskCode}-TP-004` },
        { task_code: taskCode, experiment_code: `${taskCode}-B`, tray_code: `${taskCode}-TP-005` },
      ],
    );

    expect(cards.find((card) => card.name === "冲击二室")).toEqual(
      expect.objectContaining({ hasTask: false, status: "空闲", taskCode: "-" }),
    );
    expect(cards.find((card) => card.name === "温度冲击二室")).toEqual(
      expect.objectContaining({ hasTask: false, status: "空闲", taskCode: "-" }),
    );
  });

  test("buildProcessLabCards keeps shared-tray follow-up labs scheduled until that experiment code completes", () => {
    const cards = buildProcessLabCards(
      [{ name: "高低温湿热二室", testType: "高低温湿热试验" }],
      [{ code: "TASK-003", test_type: "高低温湿热试验" }],
      [
        {
          device: "高低温湿热二室",
          end_at: "2026-04-09T12:00:00Z",
          experiment_code: "TASK-003-B",
          start_at: "2026-04-09T08:00:00Z",
          task_code: "TASK-003",
        },
      ],
      [
        {
          code: "TASK-003-SP-001",
          history: [
            {
              detail: "TASK-003 / 高低温湿热试验-A / 实验已完成",
              time: "2026-04-09T10:00:00Z",
            },
          ],
          task_code: "TASK-003",
          status: "实验已完成",
          trays: [{ tray_code: "TASK-003-TP-001", status: "实验已完成", quantity: 1 }],
        },
      ],
      Date.parse("2026-04-09T09:00:00Z"),
      [
        {
          experiment_code: "TASK-003-A",
          experiment_name: "高低温湿热试验-A",
          status: "实验已完成",
          task_code: "TASK-003",
        },
        {
          experiment_code: "TASK-003-B",
          experiment_name: "高低温湿热试验-B",
          status: "已排程",
          task_code: "TASK-003",
        },
      ],
      [
        { task_code: "TASK-003", experiment_code: "TASK-003-A", tray_code: "TASK-003-TP-001" },
        { task_code: "TASK-003", experiment_code: "TASK-003-B", tray_code: "TASK-003-TP-001" },
      ]
    );

    expect(cards[0]).toEqual(
      expect.objectContaining({
        hasTask: true,
        experimentCode: "TASK-003-B",
        status: "已排程",
        statusClass: "is-scheduled",
        taskCode: "TASK-003",
      })
    );
  });

  test("buildProcessLabCards removes a completed shared-tray experiment from history while the tray is ready for the next lab", () => {
    const cards = buildProcessLabCards(
      [
        { name: "冲击一室", testType: "冲击试验" },
        { name: "温度冲击一室", testType: "温度冲击试验" },
      ],
      [{ code: "TASK-SHARED", test_type: "冲击试验 / 温度冲击试验" }],
      [
        {
          device: "冲击一室",
          end_at: "2026-06-04T12:00:00Z",
          experiment_code: "EXP-IMPACT",
          start_at: "2026-06-04T08:00:00Z",
          task_code: "TASK-SHARED",
        },
        {
          device: "温度冲击一室",
          end_at: "2026-06-04T16:00:00Z",
          experiment_code: "EXP-TEMP",
          start_at: "2026-06-04T12:30:00Z",
          task_code: "TASK-SHARED",
        },
      ],
      [
        {
          code: "SP-SHARED",
          history: [
            {
              action: "实验完成",
              detail: "TASK-SHARED / 冲击试验 / 实验已完成",
              status: "实验已完成",
              time: "2026-06-04T11:00:00Z",
            },
          ],
          location: "冲击一室",
          status: "实验准备就绪",
          task_code: "TASK-SHARED",
          trays: [
            {
              quantity: 1,
              status: "实验准备就绪",
              target_experiment_code: "EXP-TEMP",
              target_lab: "温度冲击一室",
              tray_code: "TP-SHARED",
            },
          ],
        },
      ],
      Date.parse("2026-06-04T12:45:00Z"),
      [
        {
          experiment_code: "EXP-IMPACT",
          experiment_name: "冲击试验",
          status: "已排程",
          task_code: "TASK-SHARED",
        },
        {
          experiment_code: "EXP-TEMP",
          experiment_name: "温度冲击试验",
          status: "已排程",
          task_code: "TASK-SHARED",
        },
      ],
      [
        { task_code: "TASK-SHARED", experiment_code: "EXP-IMPACT", tray_code: "TP-SHARED" },
        { task_code: "TASK-SHARED", experiment_code: "EXP-TEMP", tray_code: "TP-SHARED" },
      ],
      [],
      [],
      [
        {
          task_code: "TASK-SHARED",
          experiment_code: "EXP-IMPACT",
          tray_code: "TP-SHARED",
          run_tray_status: "实验已完成",
        },
      ]
    );

    expect(cards.find((card) => card.name === "冲击一室")).toEqual(
      expect.objectContaining({
        hasTask: false,
        status: "空闲",
        statusClass: "is-idle",
      })
    );
    expect(cards.find((card) => card.name === "温度冲击一室")).toEqual(
      expect.objectContaining({
        experimentCode: "EXP-TEMP",
        hasTask: true,
        status: "已排程",
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
      ],
      [],
      [],
      [
        {
          task_code: "SYLU-2026-03-002",
          experiment_code: "SYLU-2026-03-002-A",
          tray_code: "SYLU-2026-03-002-TP-001",
          run_tray_status: "实验进行中",
        },
        {
          task_code: "SYLU-2026-03-002",
          experiment_code: "SYLU-2026-03-002-A",
          tray_code: "SYLU-2026-03-002-TP-002",
          run_tray_status: "实验进行中",
        },
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
