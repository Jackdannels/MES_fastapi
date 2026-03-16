import { describe, expect, test } from "vitest";

import {
  buildBalancedTrayDraft,
  buildSampleProcessTaskOptions,
  removeTrayFromDraft,
  buildTrayPrintPayload,
  confirmSampleTaskStore,
  buildTaskTrayCode,
  moveSampleBetweenTrays,
  selectTaskProcessDraft,
} from "./samplesProcessModel";

describe("samplesProcessModel", () => {
  test("buildSampleProcessTaskOptions prefers tasks with planned samples or existing samples", () => {
    const options = buildSampleProcessTaskOptions({
      tasks: [
        { code: "SZH-2026-001", name: "任务A", sample_count: "4" },
        { code: "SZH-2026-002", name: "任务B", sample_count: "0" },
      ],
      samples: [{ code: "SZH-2026-002-SP-001", task_code: "SZH-2026-002" }],
    });

    expect(options.map((option) => option.code)).toEqual(["SZH-2026-001", "SZH-2026-002"]);
  });

  test("selectTaskProcessDraft loads sample codes and default tray layout for a task", () => {
    const draft = selectTaskProcessDraft({
      taskCode: "SZH-2026-001",
      tasks: [{ code: "SZH-2026-001", sample_count: "4" }],
      samples: [],
    });

    expect(draft.sampleCodes).toEqual([
      "SZH-2026-001-SP-001",
      "SZH-2026-001-SP-002",
      "SZH-2026-001-SP-003",
      "SZH-2026-001-SP-004",
    ]);
    expect(draft.maxPerTray).toBe(5);
    expect(draft.trays).toEqual([
      expect.objectContaining({ trayCode: "SZH-2026-001-TP-001", samples: ["SZH-2026-001-SP-001", "SZH-2026-001-SP-002"] }),
      expect.objectContaining({ trayCode: "SZH-2026-001-TP-002", samples: ["SZH-2026-001-SP-003", "SZH-2026-001-SP-004"] }),
    ]);
  });

  test("moveSampleBetweenTrays moves one sample and preserves tray capacities", () => {
    const result = moveSampleBetweenTrays({
      trayDraft: {
        taskCode: "SZH-2026-001",
        maxPerTray: 2,
        sampleCodes: ["SZH-2026-001-SP-001", "SZH-2026-001-SP-002", "SZH-2026-001-SP-003"],
        trays: [
          { id: "tray-1", trayCode: "SZH-2026-001-TP-001", samples: ["SZH-2026-001-SP-001", "SZH-2026-001-SP-002"] },
          { id: "tray-2", trayCode: "SZH-2026-001-TP-002", samples: ["SZH-2026-001-SP-003"] },
        ],
      },
      sampleCode: "SZH-2026-001-SP-002",
      targetIndex: 1,
    });

    expect(result.moved).toBe(true);
    expect(result.trays[0].samples).toEqual(["SZH-2026-001-SP-001"]);
    expect(result.trays[1].samples).toEqual(["SZH-2026-001-SP-002", "SZH-2026-001-SP-003"]);
  });

  test("confirmSampleTaskStore writes trays back to samples and task tray codes", () => {
    const result = confirmSampleTaskStore({
      taskCode: "SZH-2026-001",
      tasks: [{ code: "SZH-2026-001", sample_count: "2" }],
      samples: [],
      trayDraft: {
        taskCode: "SZH-2026-001",
        maxPerTray: 5,
        sampleCodes: ["SZH-2026-001-SP-001", "SZH-2026-001-SP-002"],
        trays: [
          { trayCode: "SZH-2026-001-TP-001", samples: ["SZH-2026-001-SP-001"] },
          { trayCode: "SZH-2026-001-TP-002", samples: ["SZH-2026-001-SP-002"] },
        ],
      },
      labels: {
        intakeLocation: "接驳区",
        preRetentionLocation: "恒温恒湿间（暂存间）",
        sampleStored: "已入库",
      },
      now: "2099-03-20T08:00:00.000Z",
    });

    expect(result.error).toBeUndefined();
    expect(result.tasks[0].tray_codes).toEqual(["SZH-2026-001-TP-001", "SZH-2026-001-TP-002"]);
    expect(result.samples).toHaveLength(2);
    expect(result.samples[0]).toEqual(
      expect.objectContaining({
        task_code: "SZH-2026-001",
        location: "接驳区",
        status: "到货",
        flow_status: "到货",
      }),
    );
    expect(result.samples[0].trays[0]).toEqual(
      expect.objectContaining({
        tray_code: expect.stringMatching(/^SZH-2026-001-TP-\d{3}$/),
      }),
    );
  });

  test("buildTrayPrintPayload returns deduplicated sorted tray codes", () => {
    const payload = buildTrayPrintPayload({
      taskCode: "SZH-2026-001",
      trayCodes: ["SZH-2026-001-TP-002", "SZH-2026-001-TP-001", "SZH-2026-001-TP-002"],
    });

    expect(payload).toEqual({
      taskCode: "SZH-2026-001",
      trayCodes: ["SZH-2026-001-TP-001", "SZH-2026-001-TP-002"],
    });
  });

  test("buildBalancedTrayDraft rebalances samples when tray count or limit changes", () => {
    const result = buildBalancedTrayDraft({
      taskCode: "SZH-2026-001",
      sampleCodes: [
        "SZH-2026-001-SP-001",
        "SZH-2026-001-SP-002",
        "SZH-2026-001-SP-003",
        "SZH-2026-001-SP-004",
      ],
      maxPerTray: 2,
      trayCount: 3,
    });

    expect(result).toHaveLength(3);
    expect(result[0].trayCode).toBe(buildTaskTrayCode("SZH-2026-001", 1));
    expect(result.map((tray) => tray.samples.length)).toEqual([2, 1, 1]);
  });

  test("confirmSampleTaskStore reports samples that already belong to another task", () => {
    const result = confirmSampleTaskStore({
      taskCode: "SZH-2026-001",
      tasks: [{ code: "SZH-2026-001", sample_count: "1" }],
      samples: [{ code: "SZH-2026-001-SP-001", task_code: "OTHER-001" }],
      trayDraft: {
        taskCode: "SZH-2026-001",
        maxPerTray: 5,
        sampleCodes: ["SZH-2026-001-SP-001"],
        trays: [{ trayCode: "SZH-2026-001-TP-001", samples: ["SZH-2026-001-SP-001"] }],
      },
      labels: { intakeLocation: "接驳区", sampleStored: "已入库" },
      now: "2099-03-20T08:00:00.000Z",
    });

    expect(result.error).toContain("不属于任务");
  });

  test("removeTrayFromDraft rebalances remaining trays and renumbers sequentially", () => {
    const result = removeTrayFromDraft({
      taskCode: "SZH-2026-001",
      sampleCodes: [
        "SZH-2026-001-SP-001",
        "SZH-2026-001-SP-002",
        "SZH-2026-001-SP-003",
        "SZH-2026-001-SP-004",
      ],
      maxPerTray: 2,
      trays: [
        { trayCode: "SZH-2026-001-TP-001", samples: ["SZH-2026-001-SP-001"] },
        { trayCode: "SZH-2026-001-TP-002", samples: ["SZH-2026-001-SP-002"] },
        { trayCode: "SZH-2026-001-TP-003", samples: ["SZH-2026-001-SP-003", "SZH-2026-001-SP-004"] },
      ],
      removeIndex: 1,
    });

    expect(result).toHaveLength(2);
    expect(result[0].trayCode).toBe("SZH-2026-001-TP-001");
    expect(result[1].trayCode).toBe("SZH-2026-001-TP-002");
    expect(result.map((tray) => tray.samples.length)).toEqual([2, 2]);
  });
});
