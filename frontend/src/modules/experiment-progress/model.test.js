import { describe, expect, test } from "vitest";

import {
  buildAxisPartialProgressStatus,
  resolveAxisProgress,
} from "./axisProgress";
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

  test("does not treat a completed axis run as terminal when required axes remain", () => {
    expect(experimentScopeIsTerminal({
      experimentRunTrays: [
        {
          run_no: "RUN-VIB-Z",
          task_code: "TASK-AXIS",
          experiment_code: "EXP-VIB",
          tray_code: "TP-001",
          run_tray_status: "实验已完成",
        },
      ],
      experimentRunSteps: [
        { run_no: "RUN-VIB-Z", task_code: "TASK-AXIS", experiment_code: "EXP-VIB", axis_code: "z+", status: "实验已完成" },
        { run_no: "RUN-VIB-Z", task_code: "TASK-AXIS", experiment_code: "EXP-VIB", axis_code: "z-", status: "实验已完成" },
      ],
      experimentTrays: [
        { task_code: "TASK-AXIS", experiment_code: "EXP-VIB", tray_code: "TP-001" },
      ],
      experiments: [
        {
          task_code: "TASK-AXIS",
          experiment_code: "EXP-VIB",
          experiment_name: "振动试验",
          axis_codes: ["x+", "x-", "y+", "y-", "z+", "z-"],
        },
      ],
      samples: [],
      taskCode: "TASK-AXIS",
      experimentCode: "EXP-VIB",
    })).toBe(false);
  });

  test("uses completed run axis codes when axis step rows are unavailable", () => {
    const progress = resolveAxisProgress({
      experimentRuns: [
        {
          run_no: "RUN-AXIS-001",
          task_code: "TASK-AXIS",
          experiment_code: "EXP-AXIS",
          tray_codes: ["TP-AXIS-001"],
          axis_codes: ["x+", "x-", "y+"],
          status: "实验已完成",
        },
      ],
      experimentRunSteps: [],
      experimentRunTrays: [
        {
          run_no: "RUN-AXIS-001",
          task_code: "TASK-AXIS",
          experiment_code: "EXP-AXIS",
          tray_code: "TP-AXIS-001",
          run_tray_status: "实验已完成",
        },
      ],
      experiments: [
        {
          task_code: "TASK-AXIS",
          experiment_code: "EXP-AXIS",
          experiment_name: "冲击试验",
          axis_codes: ["x+", "x-", "y+", "y-", "z+", "z-"],
        },
      ],
      taskCode: "TASK-AXIS",
      experimentCode: "EXP-AXIS",
      trayCode: "TP-AXIS-001",
    });

    expect(progress.completedAxisCodes).toEqual(["x+", "x-", "y+"]);
    expect(buildAxisPartialProgressStatus("冲击试验", progress)).toBe("冲击试验部分完成 3/6轴");
  });

  test("orders required and completed axis codes in standard sequence", () => {
    const progress = resolveAxisProgress({
      experimentRuns: [
        {
          run_no: "RUN-AXIS-ORDERED",
          task_code: "TASK-AXIS",
          experiment_code: "EXP-AXIS",
          tray_codes: ["TP-AXIS-001"],
        },
      ],
      experimentRunSteps: [
        { run_no: "RUN-AXIS-ORDERED", task_code: "TASK-AXIS", experiment_code: "EXP-AXIS", axis_code: "z-", status: "实验已完成" },
        { run_no: "RUN-AXIS-ORDERED", task_code: "TASK-AXIS", experiment_code: "EXP-AXIS", axis_code: "x+", status: "实验已完成" },
      ],
      experimentRunTrays: [
        {
          run_no: "RUN-AXIS-ORDERED",
          task_code: "TASK-AXIS",
          experiment_code: "EXP-AXIS",
          tray_code: "TP-AXIS-001",
          run_tray_status: "实验进行中",
        },
      ],
      experiments: [
        {
          task_code: "TASK-AXIS",
          experiment_code: "EXP-AXIS",
          experiment_name: "冲击试验",
          axis_codes: ["z-", "x+", "y-"],
        },
      ],
      taskCode: "TASK-AXIS",
      experimentCode: "EXP-AXIS",
      trayCode: "TP-AXIS-001",
    });

    expect(progress.requiredAxisCodes).toEqual(["x+", "y-", "z-"]);
    expect(progress.completedAxisCodes).toEqual(["x+", "z-"]);
  });

  test("does not build a partial axis label when no axis has completed", () => {
    const progress = resolveAxisProgress({
      experiments: [
        {
          task_code: "TASK-AXIS",
          experiment_code: "EXP-AXIS",
          experiment_name: "冲击试验",
          axis_codes: ["x+", "x-", "y+", "y-", "z+", "z-"],
        },
      ],
      taskCode: "TASK-AXIS",
      experimentCode: "EXP-AXIS",
      trayCode: "TP-AXIS-001",
    });

    expect(progress.completedCount).toBe(0);
    expect(buildAxisPartialProgressStatus("冲击试验", progress)).toBe("");
  });
});
