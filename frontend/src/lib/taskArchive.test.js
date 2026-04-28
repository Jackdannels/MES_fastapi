import { describe, expect, test } from "vitest";

import { filterActiveTasks, isReturnedTask, isReturnedTrayStatus } from "./taskArchive";

describe("taskArchive", () => {
  test("recognizes a task as archived only when every assigned tray has been returned", () => {
    const samples = [
      {
        task_code: "TASK-RETURNED",
        status: "厂家收回",
        trays: [{ tray_code: "TP-001", status: "厂家收回" }],
      },
      {
        task_code: "TASK-RETURNED",
        status: "厂家收回",
        trays: [{ tray_code: "TP-002", status: "厂家收回" }],
      },
      {
        task_code: "TASK-ACTIVE",
        status: "厂家收回",
        trays: [{ tray_code: "TP-003", status: "厂家收回" }],
      },
      {
        task_code: "TASK-ACTIVE",
        status: "实验进行中",
        trays: [{ tray_code: "TP-004", status: "实验进行中" }],
      },
    ];

    expect(isReturnedTask({ code: "TASK-RETURNED" }, samples)).toBe(true);
    expect(isReturnedTask({ code: "TASK-ACTIVE" }, samples)).toBe(false);
    expect(filterActiveTasks([{ code: "TASK-RETURNED" }, { code: "TASK-ACTIVE" }], samples)).toEqual([
      { code: "TASK-ACTIVE" },
    ]);
  });

  test("normalizes returned tray status for capacity and visibility checks", () => {
    expect(isReturnedTrayStatus("厂家收回")).toBe(true);
    expect(isReturnedTrayStatus("已入库")).toBe(false);
  });
});
