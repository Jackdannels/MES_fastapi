import { describe, expect, test } from "vitest";

import { buildReturnedTaskHistoryView, formatHistoryTime } from "./model";

describe("task history model", () => {
  const returnedTaskFlow = [
    ["待排程", false, true],
    ["已排程", false, true],
    ["任务进行中", false, true],
    ["任务已完成", false, true],
    ["厂家收回", true, true],
  ];

  test("formats UTC returned timestamps as Beijing business time", () => {
    expect(formatHistoryTime("2026-05-21T01:46:35Z")).toBe("2026-05-21 09:46:35");
    expect(formatHistoryTime("2026-05-21T09:46:35+08:00")).toBe("2026-05-21 09:46:35");
    expect(formatHistoryTime("2026-05-21T09:46:35")).toBe("2026-05-21 09:46:35");
  });

  test("uses real history times for arrival and latest return instead of stale record timestamps", () => {
    const view = buildReturnedTaskHistoryView({
      tasks: [
        {
          code: "TASK-TIME",
          name: "时间校验任务",
          status: "厂家收回",
          updated_at: "2026-05-19T18:00:00+08:00",
        },
      ],
      samples: [
        {
          code: "SP-TIME-001",
          task_code: "TASK-TIME",
          status: "厂家收回",
          created_at: "2026-05-19T12:00:00+08:00",
          updated_at: "2026-05-19T12:30:00+08:00",
          trays: [
            {
              tray_code: "TP-TIME-001",
              status: "厂家收回",
              updated_at: "2026-05-19T12:30:00+08:00",
            },
          ],
          history: [
            { action: "厂家收回", status: "厂家收回", detail: "TP-TIME-001 厂家收回", time: "2026-05-19T12:31:00+08:00" },
            { action: "批量入库", status: "到货", detail: "TP-TIME-001 到货", time: "2026-05-19T11:25:00+08:00" },
          ],
        },
      ],
    });

    expect(view.tasks[0].updatedAt).toBe("2026-05-19T12:31:00+08:00");
    expect(view.tasks[0].taskFlow.map((step) => [step.label, step.active, step.reached])).toEqual(returnedTaskFlow);
    expect(view.tasks[0].taskFlow.find((step) => step.label === "厂家收回")?.time).toBe("2026-05-19T12:31:00+08:00");
    expect(view.tasks[0].trays[0].flowSteps).toEqual([
      { label: "到货", time: "2026-05-19T11:25:00+08:00" },
      { label: "厂家收回", time: "2026-05-19T12:31:00+08:00" },
    ]);
  });

  test("maps sample history times onto the returned task status flow", () => {
    const view = buildReturnedTaskHistoryView({
      tasks: [{ code: "TASK-FLOW-TIME", name: "流程时间任务", status: "厂家收回" }],
      samples: [
        {
          code: "SP-FLOW-001",
          task_code: "TASK-FLOW-TIME",
          status: "厂家收回",
          trays: [{ tray_code: "TP-FLOW-001", status: "厂家收回" }],
          history: [
            { status: "实验进行中", time: "2026-05-19T09:00:00+08:00" },
            { status: "实验已完成", time: "2026-05-19T10:00:00+08:00" },
            { status: "厂家收回", time: "2026-05-19T11:00:00+08:00" },
          ],
        },
      ],
    });

    expect(view.tasks[0].taskFlow.map((step) => [step.label, step.time || ""])).toEqual([
      ["待排程", ""],
      ["已排程", ""],
      ["任务进行中", "2026-05-19T09:00:00+08:00"],
      ["任务已完成", "2026-05-19T10:00:00+08:00"],
      ["厂家收回", "2026-05-19T11:00:00+08:00"],
    ]);
  });

  test("filters returned task history by search text and recent day window with pagination", () => {
    const view = buildReturnedTaskHistoryView({
      now: "2026-05-19T12:00:00+08:00",
      page: 1,
      pageSize: 1,
      filters: {
        query: "TP-B",
        days: 30,
      },
      tasks: [
        { code: "TASK-A", name: "旧任务", status: "厂家收回" },
        { code: "TASK-B", name: "目标任务", status: "厂家收回" },
        { code: "TASK-C", name: "不匹配任务", status: "厂家收回" },
      ],
      samples: [
        {
          code: "SP-A",
          task_code: "TASK-A",
          status: "厂家收回",
          trays: [{ tray_code: "TP-A", status: "厂家收回" }],
          history: [{ status: "厂家收回", time: "2026-03-01T12:00:00+08:00" }],
        },
        {
          code: "SP-B",
          task_code: "TASK-B",
          status: "厂家收回",
          trays: [{ tray_code: "TP-B", status: "厂家收回" }],
          history: [{ status: "厂家收回", time: "2026-05-18T12:00:00+08:00" }],
        },
        {
          code: "SP-C",
          task_code: "TASK-C",
          status: "厂家收回",
          trays: [{ tray_code: "TP-C", status: "厂家收回" }],
          history: [{ status: "厂家收回", time: "2026-05-18T12:00:00+08:00" }],
        },
      ],
    });

    expect(view.totalCount).toBe(1);
    expect(view.totalPages).toBe(1);
    expect(view.currentPage).toBe(1);
    expect(view.tasks.map((task) => task.code)).toEqual(["TASK-B"]);
  });

  test("keeps only tasks whose assigned trays are all returned and exposes task/tray flow times", () => {
    const view = buildReturnedTaskHistoryView({
      tasks: [
        { code: "TASK-RETURNED", name: "已收回任务", status: "厂家收回", updated_at: "2026-04-05T11:00:00" },
        { code: "TASK-RUNNING", name: "未完成任务", status: "实验进行中" },
      ],
      samples: [
        {
          code: "SP-001",
          task_code: "TASK-RETURNED",
          status: "厂家收回",
          trays: [{ tray_code: "TP-001", status: "厂家收回" }],
          history: [
            { action: "厂家收回", status: "厂家收回", detail: "TP-001 厂家收回", time: "2026-04-05T11:00:00" },
            { action: "实验完成", status: "实验已完成", detail: "TASK-RETURNED / 盐雾试验 / 实验已完成", time: "2026-04-04T16:30:00" },
            { action: "任务比对", status: "工装夹具安装", detail: "TP-001", time: "2026-04-03T09:20:00" },
            { action: "批量入库", status: "到货", detail: "", time: "2026-04-01T14:20:00" },
          ],
        },
        {
          code: "SP-002",
          task_code: "TASK-RETURNED",
          status: "厂家收回",
          trays: [{ tray_code: "TP-002", status: "厂家收回" }],
          history: [
            { action: "厂家收回", status: "厂家收回", detail: "TP-002 厂家收回", time: "2026-04-05T11:05:00" },
            { action: "实验完成", status: "实验已完成", detail: "TASK-RETURNED / 振动试验 / 实验已完成", time: "2026-04-04T17:30:00" },
          ],
        },
        {
          code: "SP-003",
          task_code: "TASK-RUNNING",
          status: "实验进行中",
          trays: [{ tray_code: "TP-003", status: "实验进行中" }],
          history: [{ action: "开始实验", status: "实验进行中", time: "2026-04-06T09:00:00" }],
        },
      ],
    });

    expect(view.tasks).toHaveLength(1);
    expect(view.tasks[0]).toMatchObject({
      code: "TASK-RETURNED",
      name: "已收回任务",
      status: "厂家收回",
      trayCount: 2,
    });
    expect(view.tasks[0].taskFlow.map((step) => [step.label, step.active, step.reached])).toEqual(returnedTaskFlow);
    expect(view.tasks[0].trays.map((tray) => tray.trayCode)).toEqual(["TP-001", "TP-002"]);
    expect(view.tasks[0].trays[0].flowSteps.map((step) => [step.label, step.time])).toContainEqual([
      "厂家收回",
      "2026-04-05T11:00:00",
    ]);
  });

  test("keeps unfinished experiments separate from task flow completion", () => {
    const view = buildReturnedTaskHistoryView({
      tasks: [
        {
          code: "TASK-PARTIAL",
          name: "已收回但实验未完成",
          status: "厂家收回",
          updated_at: "2026-04-08T11:00:00",
        },
      ],
      samples: [
        {
          code: "SP-101",
          task_code: "TASK-PARTIAL",
          status: "厂家收回",
          trays: [{ tray_code: "TP-101", status: "厂家收回" }],
          history: [
            { action: "实验完成", status: "实验已完成", detail: "TASK-PARTIAL / 盐雾试验 / 实验已完成", time: "2026-04-07T15:00:00" },
            { action: "厂家收回", status: "厂家收回", detail: "TP-101 厂家收回", time: "2026-04-08T11:00:00" },
          ],
        },
        {
          code: "SP-102",
          task_code: "TASK-PARTIAL",
          status: "厂家收回",
          trays: [{ tray_code: "TP-102", status: "厂家收回" }],
          history: [
            { action: "厂家收回", status: "厂家收回", detail: "TP-102 厂家收回", time: "2026-04-08T11:05:00" },
          ],
        },
      ],
      experiments: [
        {
          task_code: "TASK-PARTIAL",
          experiment_code: "TASK-PARTIAL-A",
          experiment_name: "盐雾试验",
          status: "实验已完成",
          updated_at: "2026-04-07T15:00:00",
        },
        {
          task_code: "TASK-PARTIAL",
          experiment_code: "TASK-PARTIAL-B",
          experiment_name: "振动试验",
          status: "待排程",
        },
      ],
      experimentTrays: [
        { task_code: "TASK-PARTIAL", experiment_code: "TASK-PARTIAL-A", tray_code: "TP-101" },
        { task_code: "TASK-PARTIAL", experiment_code: "TASK-PARTIAL-B", tray_code: "TP-102" },
      ],
    });

    expect(view.tasks).toHaveLength(1);
    expect(view.tasks[0]).toEqual(
      expect.objectContaining({
        status: "厂家收回",
        experimentCompletedCount: 1,
        experimentCount: 2,
      }),
    );
    expect(view.tasks[0].taskFlow.map((step) => [step.label, step.active, step.reached])).toEqual(returnedTaskFlow);
    expect(view.tasks[0].experiments).toEqual([
      expect.objectContaining({
        experimentCode: "TASK-PARTIAL-A",
        experimentName: "盐雾试验",
        displayStatus: "已完成",
        trayCodes: ["TP-101"],
      }),
      expect.objectContaining({
        experimentCode: "TASK-PARTIAL-B",
        experimentName: "振动试验",
        displayStatus: "未完成",
        trayCodes: ["TP-102"],
      }),
    ]);
  });

  test("marks returned history tasks as returned even when the task record still says running", () => {
    const view = buildReturnedTaskHistoryView({
      tasks: [{ code: "TASK-STALE", name: "状态滞后任务", status: "任务进行中" }],
      samples: [
        {
          code: "SP-201",
          task_code: "TASK-STALE",
          status: "厂家收回",
          trays: [{ tray_code: "TP-201", status: "厂家收回" }],
          history: [{ action: "厂家收回", status: "厂家收回", detail: "TP-201 厂家收回", time: "2026-04-08T11:00:00+08:00" }],
        },
      ],
    });

    expect(view.tasks).toHaveLength(1);
    expect(view.tasks[0].status).toBe("厂家收回");
  });

  test("includes partially returned tasks and keeps all tray details visible", () => {
    const view = buildReturnedTaskHistoryView({
      query: "TP-RETURNED",
      tasks: [{ code: "TASK-MIXED", name: "部分收回任务", status: "任务进行中" }],
      samples: [
        {
          code: "SP-ACTIVE-001",
          task_code: "TASK-MIXED",
          status: "实验进行中",
          trays: [{ tray_code: "TP-ACTIVE-001", status: "实验进行中" }],
          history: [{ action: "开始实验", status: "实验进行中", time: "2026-04-08T09:00:00+08:00" }],
        },
        {
          code: "SP-ACTIVE-002",
          task_code: "TASK-MIXED",
          status: "实验进行中",
          trays: [{ tray_code: "TP-ACTIVE-002", status: "实验进行中" }],
          history: [{ action: "开始实验", status: "实验进行中", time: "2026-04-08T09:05:00+08:00" }],
        },
        {
          code: "SP-RETURNED",
          task_code: "TASK-MIXED",
          status: "厂家收回",
          trays: [{ tray_code: "TP-RETURNED", status: "厂家收回" }],
          history: [{ action: "厂家收回", status: "厂家收回", detail: "TP-RETURNED 厂家收回", time: "2026-04-08T11:00:00+08:00" }],
        },
      ],
    });

    expect(view.tasks).toHaveLength(1);
    expect(view.tasks[0]).toEqual(expect.objectContaining({
      code: "TASK-MIXED",
      status: "任务进行中（收回1，剩余2）",
      returnedTrayCount: 1,
      remainingTrayCount: 2,
      originalTrayCount: 3,
      originalSampleCount: 3,
      returnedSampleCount: 1,
      remainingSampleCount: 2,
      trayCount: 3,
    }));
    expect(view.tasks[0].trayCountText).toBe("3 个托盘（收回1，剩余2）");
    expect(view.tasks[0].sampleCountText).toBe("3 个样品（收回1，剩余2）");
    expect(view.tasks[0].trays.map((tray) => tray.trayCode)).toEqual(["TP-ACTIVE-001", "TP-ACTIVE-002", "TP-RETURNED"]);
    expect(view.tasks[0].taskFlow.map((step) => [step.label, step.active, step.reached])).toEqual([
      ["待排程", false, true],
      ["已排程", false, true],
      ["任务进行中", true, true],
      ["任务已完成", false, false],
      ["厂家收回", false, false],
    ]);
  });

  test("recognizes partially returned trays by location when status is stale", () => {
    const view = buildReturnedTaskHistoryView({
      tasks: [{ code: "TASK-LOCATION", name: "位置收回任务", status: "任务进行中" }],
      samples: [
        {
          code: "SP-LOCATION-001",
          task_code: "TASK-LOCATION",
          location: "厂家收回",
          status: "实验已完成",
          trays: [{ tray_code: "TP-LOCATION", status: "实验已完成" }],
          history: [{ action: "厂家收回", status: "厂家收回", detail: "TP-LOCATION 厂家收回", time: "2026-04-08T11:00:00+08:00" }],
        },
        {
          code: "SP-ACTIVE",
          task_code: "TASK-LOCATION",
          status: "实验进行中",
          trays: [{ tray_code: "TP-ACTIVE", status: "实验进行中" }],
        },
      ],
    });

    expect(view.tasks).toHaveLength(1);
    expect(view.tasks[0].trays.map((tray) => tray.trayCode)).toEqual(["TP-ACTIVE", "TP-LOCATION"]);
    expect(view.tasks[0].status).toBe("任务进行中（收回1，剩余1）");
  });

  test("uses task-bound tray relations and planned sample count to avoid treating partial returns as fully returned", () => {
    const view = buildReturnedTaskHistoryView({
      tasks: [
        {
          code: "TASK-BOUND",
          name: "绑定托盘任务",
          sample_count: 8,
          status: "任务进行中",
          tray_codes: ["TP-001", "TP-002", "TP-003", "TP-004"],
        },
      ],
      samples: [
        {
          code: "SP-005",
          task_code: "TASK-BOUND",
          status: "厂家收回",
          trays: [{ tray_code: "TP-002", status: "厂家收回" }],
          history: [{ action: "厂家收回", status: "厂家收回", detail: "TP-002 厂家收回", time: "2026-05-31T17:29:55+08:00" }],
        },
        {
          code: "SP-006",
          task_code: "TASK-BOUND",
          status: "厂家收回",
          trays: [{ tray_code: "TP-002", status: "厂家收回" }],
        },
        {
          code: "SP-007",
          task_code: "TASK-BOUND",
          status: "厂家收回",
          trays: [{ tray_code: "TP-002", status: "厂家收回" }],
        },
        {
          code: "SP-008",
          task_code: "TASK-BOUND",
          status: "厂家收回",
          trays: [{ tray_code: "TP-002", status: "厂家收回" }],
        },
      ],
      experimentTrays: [
        { task_code: "TASK-BOUND", experiment_code: "TASK-BOUND-A", tray_code: "TP-001" },
        { task_code: "TASK-BOUND", experiment_code: "TASK-BOUND-A", tray_code: "TP-002" },
        { task_code: "TASK-BOUND", experiment_code: "TASK-BOUND-A", tray_code: "TP-003" },
        { task_code: "TASK-BOUND", experiment_code: "TASK-BOUND-A", tray_code: "TP-004" },
      ],
    });

    expect(view.tasks).toHaveLength(1);
    expect(view.tasks[0]).toEqual(expect.objectContaining({
      originalTrayCount: 4,
      returnedTrayCount: 1,
      remainingTrayCount: 3,
      originalSampleCount: 8,
      returnedSampleCount: 4,
      remainingSampleCount: 4,
      status: "任务进行中（收回1，剩余3）",
    }));
    expect(view.tasks[0].trayCountText).toBe("4 个托盘（收回1，剩余3）");
    expect(view.tasks[0].sampleCountText).toBe("8 个样品（收回4，剩余4）");
    expect(view.tasks[0].taskFlow.map((step) => [step.label, step.active, step.reached])).toEqual([
      ["待排程", false, true],
      ["已排程", false, true],
      ["任务进行中", true, true],
      ["任务已完成", false, false],
      ["厂家收回", false, false],
    ]);
  });

  test("keeps returned tasks when one sample row for the same tray still has a stale status", () => {
    const view = buildReturnedTaskHistoryView({
      tasks: [{ code: "TASK-STALE-TRAY", name: "托盘状态滞后任务", status: "厂家收回", transfer_status: "厂家收回" }],
      samples: [
        {
          code: "SP-STALE-001",
          task_code: "TASK-STALE-TRAY",
          status: "实验已完成",
          trays: [{ tray_code: "TP-STALE-001", status: "实验已完成", updated_at: "2026-05-19T10:00:00+08:00" }],
          history: [{ action: "实验完成", status: "实验已完成", time: "2026-05-19T10:00:00+08:00" }],
        },
        {
          code: "SP-STALE-002",
          task_code: "TASK-STALE-TRAY",
          status: "厂家收回",
          trays: [{ tray_code: "TP-STALE-001", status: "厂家收回", updated_at: "2026-05-19T12:00:00+08:00" }],
          history: [{ action: "厂家收回", status: "厂家收回", detail: "TP-STALE-001 厂家收回", time: "2026-05-19T12:00:00+08:00" }],
        },
      ],
    });

    expect(view.tasks).toHaveLength(1);
    expect(view.tasks[0]).toMatchObject({
      code: "TASK-STALE-TRAY",
      status: "厂家收回",
      trayCount: 1,
    });
    expect(view.tasks[0].trays[0]).toMatchObject({
      status: "厂家收回",
      trayCode: "TP-STALE-001",
    });
  });

  test("recognizes returned status aliases and explicit archived tasks without tray refs", () => {
    const view = buildReturnedTaskHistoryView({
      tasks: [
        { code: "TASK-ALIAS", name: "别名收回任务", status: "已收回" },
        { code: "TASK-EMPTY", name: "显式归档任务", transfer_status: "厂家收回", updated_at: "2026-05-19T14:00:00+08:00" },
      ],
      samples: [
        {
          code: "SP-ALIAS-001",
          task_code: "TASK-ALIAS",
          status: "已收回",
          trays: [{ tray_code: "TP-ALIAS-001", status: "已收回" }],
          history: [{ action: "已收回", status: "已收回", detail: "TP-ALIAS-001 已收回", time: "2026-05-19T13:00:00+08:00" }],
        },
      ],
    });

    expect(view.tasks.map((task) => task.code)).toEqual(["TASK-EMPTY", "TASK-ALIAS"]);
    expect(view.tasks.find((task) => task.code === "TASK-ALIAS")).toMatchObject({
      status: "厂家收回",
      trayCount: 1,
    });
    expect(view.tasks.find((task) => task.code === "TASK-EMPTY")).toMatchObject({
      status: "厂家收回",
      trayCount: 0,
      updatedAt: "2026-05-19T14:00:00+08:00",
    });
  });

  test("uses the same canonical task flow as the tray information task flow", () => {
    const view = buildReturnedTaskHistoryView({
      tasks: [{ code: "TASK-MULTI", name: "多实验任务", status: "厂家收回" }],
      samples: [
        {
          code: "SP-301",
          task_code: "TASK-MULTI",
          status: "厂家收回",
          trays: [{ tray_code: "TP-301", status: "厂家收回" }],
          history: [
            { action: "开始实验", status: "实验进行中", detail: "TASK-MULTI / A实验 / 实验进行中", time: "2026-04-02T10:00:00" },
            { action: "开始实验", status: "实验进行中", detail: "TASK-MULTI / B实验 / 实验进行中", time: "2026-04-03T11:00:00" },
            { action: "厂家收回", status: "厂家收回", detail: "TP-301 厂家收回", time: "2026-04-05T11:00:00" },
          ],
        },
      ],
    });

    expect(view.tasks[0].taskFlow.map((step) => [step.label, step.active, step.reached])).toEqual(returnedTaskFlow);
  });

  test("marks trays returned from history even when sample and tray status are stale", () => {
    const view = buildReturnedTaskHistoryView({
      tasks: [{ code: "TASK-HISTORY-RETURN", name: "历史回收任务", status: "任务进行中" }],
      samples: [
        {
          code: "SP-HISTORY-001",
          task_code: "TASK-HISTORY-RETURN",
          location: "温度冲击二室",
          status: "实验进行中",
          trays: [{ tray_code: "TP-HISTORY-001", status: "实验进行中" }],
          history: [
            { status: "实验进行中", detail: "TASK-HISTORY-RETURN / 温度冲击试验 / 实验进行中", time: "2026-06-06T13:17:58+08:00" },
            { status: "厂家收回", detail: "TP-HISTORY-001 厂家收回", time: "2026-06-06T13:18:27+08:00" },
          ],
        },
        {
          code: "SP-HISTORY-002",
          task_code: "TASK-HISTORY-RETURN",
          location: "恒温恒湿间（暂存间）",
          status: "已到达暂存间",
          trays: [{ tray_code: "TP-HISTORY-002", status: "已到达暂存间" }],
          history: [
            { status: "已到达暂存间", detail: "TP-HISTORY-002 已到达暂存间", time: "2026-06-06T13:16:51+08:00" },
            { status: "厂家收回", detail: "TP-HISTORY-002 厂家收回", time: "2026-06-06T13:17:08+08:00" },
          ],
        },
      ],
      experimentTrays: [
        { task_code: "TASK-HISTORY-RETURN", experiment_code: "TASK-HISTORY-RETURN-A", tray_code: "TP-HISTORY-001" },
        { task_code: "TASK-HISTORY-RETURN", experiment_code: "TASK-HISTORY-RETURN-A", tray_code: "TP-HISTORY-002" },
      ],
    });

    expect(view.tasks).toHaveLength(1);
    expect(view.tasks[0].status).toBe("厂家收回");
    expect(view.tasks[0].trays.map((tray) => [tray.trayCode, tray.status])).toEqual([
      ["TP-HISTORY-001", "厂家收回"],
      ["TP-HISTORY-002", "厂家收回"],
    ]);
    expect(view.tasks[0].trays[0].flowSteps).toContainEqual({
      label: "厂家收回",
      time: "2026-06-06T13:18:27+08:00",
    });
  });

  test("keeps staged tray details visible when another tray from the same task was returned", () => {
    const view = buildReturnedTaskHistoryView({
      tasks: [
        {
          code: "TASK-MIXED",
          name: "部分回收任务",
          status: "任务进行中",
        },
      ],
      samples: [
        {
          code: "SP-MIXED-001",
          task_code: "TASK-MIXED",
          location: "厂家收回",
          status: "厂家收回",
          trays: [{ tray_code: "TP-MIXED-001", status: "厂家收回" }],
          history: [
            { status: "已到达暂存间", detail: "TP-MIXED-001 已到达暂存间", time: "2026-06-06T12:12:23+08:00" },
            { status: "厂家收回", detail: "TP-MIXED-001 厂家收回", time: "2026-06-06T12:13:02+08:00" },
          ],
        },
        {
          code: "SP-MIXED-002",
          task_code: "TASK-MIXED",
          location: "恒温恒湿间（暂存间）",
          status: "已到达暂存间",
          trays: [{ tray_code: "TP-MIXED-002", status: "已到达暂存间" }],
          history: [
            { status: "已到达暂存间", detail: "TP-MIXED-002 已到达暂存间", time: "2026-06-06T12:12:30+08:00" },
          ],
        },
      ],
      experimentTrays: [
        { task_code: "TASK-MIXED", experiment_code: "TASK-MIXED-A", tray_code: "TP-MIXED-001" },
        { task_code: "TASK-MIXED", experiment_code: "TASK-MIXED-A", tray_code: "TP-MIXED-002" },
      ],
    });

    expect(view.tasks).toHaveLength(1);
    expect(view.tasks[0]).toEqual(expect.objectContaining({
      remainingTrayCount: 1,
      returnedTrayCount: 1,
    }));
    expect(view.tasks[0].trays.map((tray) => tray.trayCode)).toEqual(["TP-MIXED-001", "TP-MIXED-002"]);
    expect(view.tasks[0].trays.find((tray) => tray.trayCode === "TP-MIXED-002")?.flowSteps).toContainEqual({
      label: "已到达暂存间",
      time: "2026-06-06T12:12:30+08:00",
    });
  });
});
