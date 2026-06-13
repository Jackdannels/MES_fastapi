import { describe, expect, test } from "vitest";

import { experimentScopeIsTerminal } from "./model";

describe("experiment progress model", () => {
  test("does not treat arrival at staging as experiment terminal for a scoped tray", () => {
    expect(experimentScopeIsTerminal({
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
      experiments: [
        { task_code: "TASK-STAGING", experiment_code: "EXP-IMPACT", experiment_name: "冲击试验" },
      ],
      samples: [],
      taskCode: "TASK-STAGING",
      experimentCode: "EXP-IMPACT",
    })).toBe(false);
  });

  test("does not apply sample-level returned status to every tray in a multi-tray sample", () => {
    expect(experimentScopeIsTerminal({
      experimentTrays: [
        { task_code: "TASK-RETURNED", experiment_code: "EXP-SALT", tray_code: "TP-001" },
        { task_code: "TASK-RETURNED", experiment_code: "EXP-SALT", tray_code: "TP-002" },
      ],
      experiments: [
        { task_code: "TASK-RETURNED", experiment_code: "EXP-SALT", experiment_name: "盐雾试验" },
      ],
      samples: [
        {
          task_code: "TASK-RETURNED",
          status: "厂家收回",
          location: "厂家收回",
          trays: [
            { tray_code: "TP-001", status: "厂家收回" },
            { tray_code: "TP-002", status: "已到达实验室" },
          ],
        },
      ],
      taskCode: "TASK-RETURNED",
      experimentCode: "EXP-SALT",
    })).toBe(false);
  });

  test("ignores unscoped completion history when a sample has multiple trays", () => {
    expect(experimentScopeIsTerminal({
      experimentTrays: [
        { task_code: "TASK-HISTORY", experiment_code: "EXP-MOLD", tray_code: "TP-001" },
        { task_code: "TASK-HISTORY", experiment_code: "EXP-MOLD", tray_code: "TP-002" },
      ],
      experiments: [
        { task_code: "TASK-HISTORY", experiment_code: "EXP-MOLD", experiment_name: "霉菌试验" },
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
      taskCode: "TASK-HISTORY",
      experimentCode: "EXP-MOLD",
    })).toBe(false);
  });

  test("ignores sample history text as a terminal fallback for a scoped tray", () => {
    expect(experimentScopeIsTerminal({
      experimentTrays: [
        { task_code: "TASK-HISTORY-TEXT", experiment_code: "EXP-SALT", tray_code: "TP-001" },
      ],
      experiments: [
        { task_code: "TASK-HISTORY-TEXT", experiment_code: "EXP-SALT", experiment_name: "盐雾试验" },
      ],
      samples: [
        {
          task_code: "TASK-HISTORY-TEXT",
          trays: [{ tray_code: "TP-001", status: "已到达实验室" }],
          history: [
            { detail: "TASK-HISTORY-TEXT / 盐雾试验 / 实验已完成", status: "实验已完成" },
          ],
        },
      ],
      taskCode: "TASK-HISTORY-TEXT",
      experimentCode: "EXP-SALT",
    })).toBe(false);
  });
});
