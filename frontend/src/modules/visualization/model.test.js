import { describe, expect, test } from "vitest";

import { buildLabProcessPanels } from "./model";

describe("visualization model", () => {
  test("builds lab panels from real tray flow data grouped by laboratory", () => {
    const panels = buildLabProcessPanels({
      labNames: ["振动一室", "高低温湿热一室"],
      tasks: [
        { code: "TASK-001", name: "真实流程任务" },
        { code: "TASK-002", name: "温湿热任务" },
      ],
      experiments: [
        { task_code: "TASK-001", experiment_code: "EXP-VIB", experiment_name: "振动试验", required_device: "振动一室" },
        { task_code: "TASK-002", experiment_code: "EXP-HUM", experiment_name: "高低温湿热试验", required_device: "高低温湿热一室" },
      ],
      experimentTrays: [
        { task_code: "TASK-001", experiment_code: "EXP-VIB", tray_code: "TRAY-VIB-001" },
        { task_code: "TASK-002", experiment_code: "EXP-HUM", tray_code: "TRAY-HUM-001" },
      ],
      schedules: [
        { task_code: "TASK-001", experiment_code: "EXP-VIB", device: "振动一室", status: "实验进行中" },
        { task_code: "TASK-002", experiment_code: "EXP-HUM", device: "高低温湿热一室", status: "实验已完成" },
      ],
      samples: [
        {
          code: "SAMPLE-001",
          task_code: "TASK-001",
          location: "振动一室",
          status: "实验进行中",
          trays: [{ tray_code: "TRAY-VIB-001", status: "实验进行中", quantity: 2 }],
          history: [
            { status: "到货", time: "2026-05-22T09:00:00" },
            { detail: "TASK-001 / 振动试验 / 实验进行中", time: "2026-05-22T10:00:00" },
          ],
        },
        {
          code: "SAMPLE-002",
          task_code: "TASK-002",
          location: "高低温湿热一室",
          status: "实验已完成",
          trays: [{ tray_code: "TRAY-HUM-001", status: "实验已完成", quantity: 1 }],
          history: [
            { status: "到货", time: "2026-05-22T09:30:00" },
            { detail: "TASK-002 / 高低温湿热试验 / 实验已完成", time: "2026-05-22T12:00:00" },
          ],
        },
      ],
    });

    expect(panels).toHaveLength(2);
    expect(panels[0]).toMatchObject({
      name: "振动一室",
      sampleCount: 1,
      taskCount: 1,
      trayCount: 1,
    });
    expect(panels[0].trays[0].trayCode).toBe("TRAY-VIB-001");
    expect(panels[0].trays[0].taskCode).toBe("TASK-001");
    expect(panels[0].trays[0].steps.map((step) => step.label)).toEqual(
      expect.arrayContaining(["样品运输中", "到货", "振动试验进行中"]),
    );
    expect(panels[1].trays[0].status).toContain("高低温湿热试验");
    expect(panels[1].trays[0].steps.some((step) => step.label === "高低温湿热试验已完成")).toBe(true);
  });
});
