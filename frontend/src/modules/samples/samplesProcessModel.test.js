import { describe, expect, test } from "vitest";

import {
  buildBalancedTrayDraft,
  buildTrayOutboundDestinations,
  buildSampleProcessTaskOptions,
  removeTrayFromDraft,
  buildTrayPrintPayload,
  confirmSampleTaskStore,
  buildTaskTrayCode,
  moveSampleBetweenTrays,
  selectTaskProcessDraft,
  submitTrayOutbound,
} from "./samplesProcessModel";

// 托盘分装是样品链路里副作用最多的环节，这组测试专门守护均衡分配和入库回写规则。
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

  test("buildSampleProcessTaskOptions exposes derived task status for downstream module filtering", () => {
    const options = buildSampleProcessTaskOptions({
      tasks: [
        { code: "SZH-2026-001", name: "任务A", sample_count: "1", status: "待排程" },
        { code: "SZH-2026-002", name: "任务B", sample_count: "1", status: "待排程" },
        { code: "SZH-2026-003", name: "任务C", sample_count: "1", status: "待排程" },
      ],
      samples: [
        {
          code: "SZH-2026-001-SP-001",
          task_code: "SZH-2026-001",
          status: "实验准备就绪",
          trays: [{ tray_code: "SZH-2026-001-TP-001", status: "实验准备就绪" }],
        },
        {
          code: "SZH-2026-002-SP-001",
          task_code: "SZH-2026-002",
          status: "厂家收回",
          trays: [{ tray_code: "SZH-2026-002-TP-001", status: "厂家收回" }],
        },
      ],
    });

    expect(options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "SZH-2026-001", displayStatus: "实验中" }),
        expect.objectContaining({ code: "SZH-2026-002", displayStatus: "厂家收回" }),
        expect.objectContaining({ code: "SZH-2026-003", displayStatus: "待排程" }),
      ]),
    );
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
      expect.objectContaining({
        trayCode: "SZH-2026-001-TP-001",
        samples: ["SZH-2026-001-SP-001", "SZH-2026-001-SP-002", "SZH-2026-001-SP-003", "SZH-2026-001-SP-004"],
      }),
    ]);
  });

  test("selectTaskProcessDraft auto-adds trays when sample count exceeds the single-tray limit", () => {
    const draft = selectTaskProcessDraft({
      taskCode: "SZH-2026-001",
      tasks: [{ code: "SZH-2026-001", sample_count: "6" }],
      samples: [],
    });

    expect(draft.trays).toEqual([
      expect.objectContaining({
        trayCode: "SZH-2026-001-TP-001",
        samples: ["SZH-2026-001-SP-001", "SZH-2026-001-SP-002", "SZH-2026-001-SP-003"],
      }),
      expect.objectContaining({
        trayCode: "SZH-2026-001-TP-002",
        samples: ["SZH-2026-001-SP-004", "SZH-2026-001-SP-005", "SZH-2026-001-SP-006"],
      }),
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
    // 确认入库后，任务侧 tray_codes 和样品侧 trays 必须同时落盘。
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
    expect(result.tasks[0].arrival_at).toBe("2099-03-20 08:00:00");
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
        status: "到货",
      }),
    );
  });

  test("confirmSampleTaskStore keeps sample status aligned with the assigned tray status", () => {
    const result = confirmSampleTaskStore({
      taskCode: "SZH-2026-001",
      tasks: [{ code: "SZH-2026-001", sample_count: "1" }],
      samples: [],
      trayDraft: {
        taskCode: "SZH-2026-001",
        maxPerTray: 5,
        sampleCodes: ["SZH-2026-001-SP-001"],
        trays: [{ trayCode: "SZH-2026-001-TP-001", samples: ["SZH-2026-001-SP-001"] }],
      },
      labels: {
        intakeLocation: "接驳区",
        preRetentionLocation: "恒温恒湿间（暂存间）",
        sampleStored: "已入库",
      },
      now: "2099-03-20T08:00:00.000Z",
    });

    expect(result.error).toBeUndefined();
    expect(result.samples[0].status).toBe("到货");
    expect(result.samples[0].trays).toEqual([
      expect.objectContaining({
        tray_code: "SZH-2026-001-TP-001",
        status: "到货",
      }),
    ]);
  });

  test("confirmSampleTaskStore overwrites task arrival time when the task is re-stored", () => {
    const result = confirmSampleTaskStore({
      taskCode: "SZH-2026-001",
      tasks: [{ code: "SZH-2026-001", sample_count: "1", arrival_at: "2099-03-19 08:00:00" }],
      samples: [],
      trayDraft: {
        taskCode: "SZH-2026-001",
        maxPerTray: 5,
        sampleCodes: ["SZH-2026-001-SP-001"],
        trays: [{ trayCode: "SZH-2026-001-TP-001", samples: ["SZH-2026-001-SP-001"] }],
      },
      labels: {
        intakeLocation: "接驳区",
        sampleStored: "已入库",
      },
      now: "2099-03-21T09:30:00.000Z",
    });

    expect(result.error).toBeUndefined();
    expect(result.tasks[0].arrival_at).toBe("2099-03-21 09:30:00");
  });

  test("confirmSampleTaskStore keeps second precision so re-store within one minute is still visible", () => {
    const result = confirmSampleTaskStore({
      taskCode: "SZH-2026-001",
      tasks: [{ code: "SZH-2026-001", sample_count: "1", arrival_at: "2099-03-21 09:30:05" }],
      samples: [],
      trayDraft: {
        taskCode: "SZH-2026-001",
        maxPerTray: 5,
        sampleCodes: ["SZH-2026-001-SP-001"],
        trays: [{ trayCode: "SZH-2026-001-TP-001", samples: ["SZH-2026-001-SP-001"] }],
      },
      labels: {
        intakeLocation: "接驳区",
        sampleStored: "已入库",
      },
      now: "2099-03-21T09:30:45.000Z",
    });

    expect(result.error).toBeUndefined();
    expect(result.tasks[0].arrival_at).toBe("2099-03-21 09:30:45");
  });

  test("confirmSampleTaskStore ignores empty default trays when building printable tray codes", () => {
    const result = confirmSampleTaskStore({
      taskCode: "SZH-2026-001",
      tasks: [{ code: "SZH-2026-001", sample_count: "1" }],
      samples: [],
      trayDraft: {
        taskCode: "SZH-2026-001",
        maxPerTray: 5,
        sampleCodes: ["SZH-2026-001-SP-001"],
        trays: [
          { trayCode: "SZH-2026-001-TP-001", samples: ["SZH-2026-001-SP-001"] },
          { trayCode: "SZH-2026-001-TP-002", samples: [] },
        ],
      },
      labels: {
        intakeLocation: "接驳区",
        sampleStored: "已入库",
      },
      now: "2099-03-21T10:00:00.000Z",
    });

    expect(result.error).toBeUndefined();
    expect(result.trayCodes).toEqual(["SZH-2026-001-TP-001"]);
    expect(result.tasks[0].tray_codes).toEqual(["SZH-2026-001-TP-001"]);
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

  test("buildTrayOutboundDestinations shows a fixed staging card and only highlights scheduled labs", () => {
    const result = buildTrayOutboundDestinations({
      taskCode: "ZD-2026-003",
      trayCode: "ZD-2026-003-TP-001",
      tasks: [{ code: "ZD-2026-003", name: "振动任务", test_type: "振动试验" }],
      schedules: [
        {
          id: "schedule-1",
          task_code: "ZD-2026-003",
          device: "振动一室",
          start_at: "2026-03-20T00:00:00.000Z",
          end_at: "2026-03-20T03:30:00.000Z",
        },
      ],
    });

    expect(result.cards).toEqual([
      expect.objectContaining({
        key: "staging",
        label: "暂存间",
        available: true,
        status: "送至暂存间",
        variant: "staging",
      }),
      expect.objectContaining({
        key: "lab:振动一室",
        label: "振动一室",
        available: true,
        highlighted: true,
        status: "送至实验室",
        taskCode: "ZD-2026-003",
        testType: "振动试验",
      }),
      expect.objectContaining({
        key: "lab:振动二室",
        label: "振动二室",
        available: false,
        highlighted: false,
        taskCode: "ZD-2026-003",
        testType: "振动试验",
      }),
    ]);
    expect(result.cards[1].scheduleText).toContain("03/20 08:00");
  });

  test("submitTrayOutbound updates only the scanned tray samples to staging or lab outbound status", () => {
    const result = submitTrayOutbound({
      trayCode: "ZD-2026-003-TP-001",
      destination: {
        key: "lab:振动一室",
        label: "振动一室",
        location: "振动一室",
        status: "送至实验室",
        available: true,
      },
      now: "2026-03-20T01:00:00.000Z",
      samples: [
        {
          id: "sample-1",
          code: "ZD-2026-003-SP-001",
          task_code: "ZD-2026-003",
          location: "接驳区",
          status: "到货",
          flow_status: "到货",
          history: [],
          trays: [{ tray_code: "ZD-2026-003-TP-001", status: "到货", quantity: 1 }],
        },
        {
          id: "sample-2",
          code: "ZD-2026-003-SP-002",
          task_code: "ZD-2026-003",
          location: "接驳区",
          status: "到货",
          flow_status: "到货",
          history: [],
          trays: [{ tray_code: "ZD-2026-003-TP-002", status: "到货", quantity: 1 }],
        },
      ],
    });

    expect(result.error).toBe("");
    expect(result.samples[0]).toEqual(
      expect.objectContaining({
        location: "振动一室",
        status: "送至实验室",
        flow_status: "送至实验室",
      }),
    );
    expect(result.samples[0].trays).toEqual([expect.objectContaining({ tray_code: "ZD-2026-003-TP-001", status: "送至实验室" })]);
    expect(result.samples[0].history[0]).toEqual(expect.objectContaining({ action: "扫码出库", detail: "ZD-2026-003-TP-001 -> 振动一室" }));
    expect(result.samples[1]).toEqual(
      expect.objectContaining({
        location: "接驳区",
        status: "到货",
        flow_status: "到货",
      }),
    );
  });

  test("confirmSampleTaskStore reports samples that already belong to another task", () => {
    // 已绑定其他任务的样品号不能被当前任务直接占用。
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
    // 删除托盘后不仅要重新均衡样品，还要保证托盘号重新连续编号。
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
