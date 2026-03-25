import { describe, expect, test } from "vitest";

import {
  buildTrayFlowView,
  buildSamplesTrayOverviewView,
  buildSamplesFlowView,
  buildSamplesStagingView,
  dispatchStagingSamples,
  TRAY_STATUS_OPTIONS,
  submitSamplesBatchIntake,
  syncTrayStatusToSampleStatus,
  updateTrayStatus,
  updateSampleDetail,
} from "./samplesFlowModel";

describe("samplesFlowModel", () => {
  test("buildTrayFlowView highlights the current tray status in the canonical tray flow", () => {
    const view = buildTrayFlowView({
      trayCode: "SZH-2026-001-TP-001",
      status: "实验进行中",
    });

    expect(view.currentStatus).toBe("当前托盘：SZH-2026-001-TP-001 | 当前状态：实验进行中");
    expect(view.steps).toHaveLength(12);
    expect(view.steps.find((step) => step.key === "running")).toEqual(expect.objectContaining({ active: true }));
    expect(view.steps.find((step) => step.key === "ready")).toEqual(expect.objectContaining({ reached: true }));
    expect(view.steps.find((step) => step.key === "completed")).toEqual(expect.objectContaining({ active: false, reached: false }));
  });

  test("exports the canonical tray status options in the approved flow order", () => {
    expect(TRAY_STATUS_OPTIONS).toEqual([
      "运输中",
      "到货",
      "送至暂存间",
      "已到达暂存间",
      "送至实验室",
      "已到达实验室",
      "工装夹具安装",
      "实验准备就绪",
      "实验进行中",
      "实验已完成",
      "放置实验后暂存间",
      "厂家收回",
    ]);
  });

  test("syncTrayStatusToSampleStatus maps tray status directly to the same sample status label", () => {
    expect(syncTrayStatusToSampleStatus("运输中")).toBe("运输中");
    expect(syncTrayStatusToSampleStatus("实验进行中")).toBe("实验进行中");
    expect(syncTrayStatusToSampleStatus("未知状态")).toBe("未知状态");
  });

  test("buildSamplesFlowView filters sorts and paginates samples", () => {
    const view = buildSamplesFlowView({
      samples: [
        { code: "SP-002", task_code: "SZH-2", status: "到货", location: "接驳区", owner: "张三", trays: [] },
        { code: "SP-001", task_code: "SZH-1", status: "已到达实验室", location: "振动一室", owner: "李四", trays: [] },
      ],
      filters: { query: "SP-00", taskCode: "", status: "" },
      sort: { key: "code", direction: "asc" },
      page: 1,
      pageSize: 8,
    });

    expect(view.rows).toHaveLength(2);
    expect(view.rows[0].code).toBe("SP-001");
    expect(view.rows[1].code).toBe("SP-002");
    expect(view.totalPages).toBe(1);
  });

  test("submitSamplesBatchIntake writes location owner and status to matching samples", () => {
    const result = submitSamplesBatchIntake({
      samples: [{ code: "SP-001", task_code: "SZH-1", status: "运输中", location: "", owner: "" }],
      payload: { location: "接驳区", owner: "王工", codes: "SP-001" },
      labels: { intakeLocation: "接驳区", sampleReceived: "已接收", sampleStored: "已入库" },
      now: "2026-03-13T10:00:00.000Z",
    });

    expect(result.error).toBe("");
    expect(result.samples[0].location).toBe("接驳区");
    expect(result.samples[0].owner).toBe("王工");
    expect(result.samples[0].status).toBe("到货");
    expect(result.samples[0].flow_status).toBe("到货");
  });

  test("updateSampleDetail persists status and remark into history", () => {
    const result = updateSampleDetail({
      sample: {
        id: "sample-1",
        code: "SP-001",
        status: "到货",
        location: "接驳区",
        owner: "王工",
        history: [],
      },
      payload: { status: "工装夹具安装", remark: "进入实验前检查完成" },
      now: "2026-03-13T10:00:00.000Z",
    });

    expect(result.sample.status).toBe("工装夹具安装");
    expect(result.sample.flow_status).toBe("工装夹具安装");
    expect(result.sample.history[0].detail).toBe("进入实验前检查完成");
  });

  test("buildSamplesStagingView only returns samples still waiting in pre-retention area", () => {
    const view = buildSamplesStagingView({
      samples: [
        { code: "SP-001", task_code: "SZH-1", location: "恒温恒湿间（暂存间）", status: "已到达暂存间", owner: "张三" },
        { code: "SP-002", task_code: "SZH-1", location: "振动一室", status: "已到达实验室", owner: "李四" },
      ],
      query: "",
      selectedCodes: ["SP-001"],
    });

    expect(view.rows).toHaveLength(1);
    expect(view.rows[0].code).toBe("SP-001");
    expect(view.rows[0].selected).toBe(true);
  });

  test("dispatchStagingSamples moves staging samples to target lab and appends history", () => {
    const result = dispatchStagingSamples({
      samples: [
        { code: "SP-001", task_code: "SZH-1", location: "恒温恒湿间（暂存间）", status: "已到达暂存间", owner: "张三", history: [] },
      ],
      payload: { targetLab: "振动一室", owner: "王工", codes: "" },
      selectedCodes: ["SP-001"],
      now: "2026-03-13T10:00:00.000Z",
    });

    expect(result.error).toBe("");
    expect(result.samples[0].location).toBe("振动一室");
    expect(result.samples[0].owner).toBe("王工");
    expect(result.samples[0].status).toBe("已到达实验室");
    expect(result.samples[0].flow_status).toBe("已到达实验室");
    expect(result.samples[0].history[0].action).toBe("暂存间派发");
  });

  test("buildSamplesTrayOverviewView aggregates trays across samples and exposes task context", () => {
    const view = buildSamplesTrayOverviewView({
      tasks: [
        { code: "SZH-2026-001", name: "任务A", test_type: "冲击试验" },
        { code: "SZH-2026-002", name: "任务B", test_type: "振动试验" },
      ],
      samples: [
        {
          code: "SZH-2026-001-SP-001",
          task_code: "SZH-2026-001",
          trays: [{ tray_code: "SZH-2026-001-TP-001", status: "到货", quantity: 1 }],
        },
        {
          code: "SZH-2026-001-SP-002",
          task_code: "SZH-2026-001",
          trays: [{ tray_code: "SZH-2026-001-TP-001", status: "到货", quantity: 1 }],
        },
        {
          code: "SZH-2026-002-SP-001",
          task_code: "SZH-2026-002",
          trays: [{ tray_code: "SZH-2026-002-TP-001", status: "运输中", quantity: 1 }],
        },
      ],
      query: "",
    });

    expect(view.rows).toEqual([
      expect.objectContaining({
        trayCode: "SZH-2026-001-TP-001",
        taskCode: "SZH-2026-001",
        taskName: "任务A",
        testType: "冲击试验",
        status: "到货",
        sampleCount: 2,
        sampleCodes: ["SZH-2026-001-SP-001", "SZH-2026-001-SP-002"],
      }),
      expect.objectContaining({
        trayCode: "SZH-2026-002-TP-001",
        taskCode: "SZH-2026-002",
        taskName: "任务B",
        testType: "振动试验",
        status: "运输中",
        sampleCount: 1,
        sampleCodes: ["SZH-2026-002-SP-001"],
      }),
    ]);
  });

  test("buildSamplesTrayOverviewView only keeps the latest active tray for each sample", () => {
    const view = buildSamplesTrayOverviewView({
      tasks: [{ code: "SZH-2026-001", name: "任务A", test_type: "冲击试验" }],
      samples: [
        {
          code: "SZH-2026-001-SP-001",
          task_code: "SZH-2026-001",
          trays: [
            {
              tray_code: "SZH-2026-001-TP-021",
              status: "到货",
              quantity: 1,
              updated_at: "2026-03-20T08:00:00.000Z",
            },
            {
              tray_code: "SZH-2026-001-TP-001",
              status: "送至实验室",
              quantity: 1,
              updated_at: "2026-03-21T08:00:00.000Z",
            },
          ],
        },
        {
          code: "SZH-2026-001-SP-002",
          task_code: "SZH-2026-001",
          trays: [
            {
              tray_code: "SZH-2026-001-TP-002",
              status: "送至实验室",
              quantity: 1,
              updated_at: "2026-03-21T08:30:00.000Z",
            },
          ],
        },
      ],
      query: "",
    });

    expect(view.rows).toHaveLength(2);
    expect(view.rows.map((row) => row.trayCode)).toEqual(["SZH-2026-001-TP-001", "SZH-2026-001-TP-002"]);
    expect(view.rows.find((row) => row.trayCode === "SZH-2026-001-TP-021")).toBeUndefined();
  });

  test("updateTrayStatus synchronizes tray status to all samples assigned to the tray", () => {
    const result = updateTrayStatus({
      tasks: [{ code: "SZH-2026-001", name: "任务A", test_type: "冲击试验" }],
      samples: [
        {
          id: "sample-1",
          code: "SZH-2026-001-SP-001",
          task_code: "SZH-2026-001",
          status: "到货",
          flow_status: "到货",
          history: [],
          trays: [{ tray_code: "SZH-2026-001-TP-001", status: "到货", quantity: 1 }],
        },
        {
          id: "sample-2",
          code: "SZH-2026-001-SP-002",
          task_code: "SZH-2026-001",
          status: "到货",
          flow_status: "到货",
          history: [],
          trays: [{ tray_code: "SZH-2026-001-TP-001", status: "到货", quantity: 1 }],
        },
      ],
      trayCode: "SZH-2026-001-TP-001",
      status: "送至实验室",
      now: "2026-03-18T12:00:00.000Z",
    });

    expect(result.error).toBe("");
    expect(result.samples[0].status).toBe("送至实验室");
    expect(result.samples[1].status).toBe("送至实验室");
    expect(result.samples[0].trays[0].status).toBe("送至实验室");
    expect(result.samples[1].trays[0].status).toBe("送至实验室");
  });
});
