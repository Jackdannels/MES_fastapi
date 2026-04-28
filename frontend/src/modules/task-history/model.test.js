import { describe, expect, test } from "vitest";

import { buildReturnedTaskHistoryView } from "./model";

describe("task history model", () => {
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
    expect(view.tasks[0].taskFlow.map((step) => [step.label, step.time])).toEqual([
      ["到货", "2026-04-01T14:20:00"],
      ["工装夹具安装", "2026-04-03T09:20:00"],
      ["实验已完成", "2026-04-04T17:30:00"],
      ["厂家收回", "2026-04-05T11:05:00"],
    ]);
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
    expect(view.tasks[0].taskFlow.map((step) => step.label)).toEqual(["厂家收回"]);
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
});
