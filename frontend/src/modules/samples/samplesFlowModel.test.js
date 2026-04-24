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
      trayCode: "SYLU-2026-03-001-TP-001",
      status: "实验进行中",
    });

    expect(view.currentStatus).toBe("当前托盘：SYLU-2026-03-001-TP-001 | 当前状态：实验进行中");
    expect(view.steps).toHaveLength(12);
    expect(view.steps.find((step) => step.key === "running")).toEqual(expect.objectContaining({ active: true }));
    expect(view.steps.find((step) => step.key === "ready")).toEqual(expect.objectContaining({ reached: true }));
    expect(view.steps.find((step) => step.key === "completed")).toEqual(expect.objectContaining({ active: false, reached: false }));
  });

  test("buildTrayFlowView labels single-experiment running and completed steps with the concrete experiment type", () => {
    const view = buildTrayFlowView({
      trayCode: "SYLU-2026-03-001-TP-004",
      taskCode: "SYLU-2026-03-001",
      status: "送至实验室",
      experiments: [
        {
          task_code: "SYLU-2026-03-001",
          experiment_code: "SYLU-2026-03-001-A",
          experiment_type: "盐雾试验",
        },
      ],
      experimentTrays: [
        {
          task_code: "SYLU-2026-03-001",
          experiment_code: "SYLU-2026-03-001-A",
          tray_code: "SYLU-2026-03-001-TP-004",
        },
      ],
    });

    expect(view.currentStatus).toBe("当前托盘：SYLU-2026-03-001-TP-004 | 当前状态：送至实验室");
    expect(view.steps.map((step) => step.label)).toEqual([
      "样品运输中",
      "到货",
      "送至暂存间",
      "已到达暂存间",
      "送至实验室",
      "已到达实验室",
      "工装夹具安装",
      "实验准备就绪",
      "盐雾试验进行中",
      "盐雾试验已完成",
      "放置实验后暂存间",
      "厂家收回",
    ]);
    expect(view.steps.find((step) => step.key === "sent_to_lab")).toEqual(expect.objectContaining({ active: true }));
  });

  test("buildTrayFlowView collapses completed experiments and expands only the current unfinished experiment", () => {
    const view = buildTrayFlowView({
      trayCode: "SYLU-2026-03-001-TP-001",
      experimentFlow: [
        {
          code: "A",
          name: "A实验",
          state: "completed",
        },
        {
          code: "B",
          name: "B实验",
          state: "current",
          routeStatus: "实验准备就绪",
        },
        {
          code: "C",
          name: "C实验",
          state: "pending",
        },
      ],
    });

    expect(view.currentStatus).toBe("当前托盘：SYLU-2026-03-001-TP-001 | 当前状态：实验准备就绪");
    expect(view.steps.map((step) => step.label)).toEqual([
      "样品运输中",
      "到货",
      "A实验已完成",
      "送至暂存间",
      "已到达暂存间",
      "送至实验室",
      "已到达实验室",
      "工装夹具安装",
      "实验准备就绪",
      "B实验进行中",
      "C实验未完成",
      "放置实验后暂存间",
      "厂家收回",
    ]);
    expect(view.steps.find((step) => step.label === "A实验已完成")).toEqual(expect.objectContaining({ reached: true }));
    expect(view.steps.find((step) => step.label === "实验准备就绪")).toEqual(expect.objectContaining({ active: true }));
    expect(view.steps.find((step) => step.label === "B实验进行中")).toEqual(expect.objectContaining({ active: false, reached: false }));
    expect(view.steps.find((step) => step.label === "C实验未完成")).toEqual(expect.objectContaining({ active: false, reached: false }));
  });

  test("buildTrayFlowView keeps only the last experiment path once all experiments are completed", () => {
    const view = buildTrayFlowView({
      trayCode: "SYLU-2026-03-001-TP-001",
      experimentFlow: [
        {
          code: "A",
          name: "A实验",
          state: "completed",
        },
        {
          code: "B",
          name: "B实验",
          state: "completed",
        },
        {
          code: "C",
          name: "C实验",
          state: "completed",
          routeStatus: "实验已完成",
        },
      ],
    });

    expect(view.currentStatus).toBe("当前托盘：SYLU-2026-03-001-TP-001 | 当前状态：C实验已完成");
    expect(view.steps.map((step) => step.label)).toEqual([
      "样品运输中",
      "到货",
      "A实验已完成",
      "B实验已完成",
      "送至暂存间",
      "已到达暂存间",
      "送至实验室",
      "已到达实验室",
      "工装夹具安装",
      "实验准备就绪",
      "C实验已完成",
      "放置实验后暂存间",
      "厂家收回",
    ]);
    expect(view.steps.find((step) => step.label === "C实验已完成")).toEqual(expect.objectContaining({ active: true }));
  });

  test("buildTrayFlowView adapts to out-of-order experiment completion but resumes the first unfinished scheduled experiment", () => {
    const view = buildTrayFlowView({
      trayCode: "SYLU-2026-03-001-TP-001",
      experimentFlow: [
        {
          code: "B",
          name: "B实验",
          state: "completed",
        },
        {
          code: "A",
          name: "A实验",
          state: "current",
          routeStatus: "到货",
        },
        {
          code: "C",
          name: "C实验",
          state: "pending",
        },
      ],
    });

    expect(view.currentStatus).toBe("当前托盘：SYLU-2026-03-001-TP-001 | 当前状态：到货");
    expect(view.steps.map((step) => step.label)).toEqual([
      "样品运输中",
      "到货",
      "B实验已完成",
      "送至暂存间",
      "已到达暂存间",
      "送至实验室",
      "已到达实验室",
      "工装夹具安装",
      "实验准备就绪",
      "A实验进行中",
      "C实验未完成",
      "放置实验后暂存间",
      "厂家收回",
    ]);
    expect(view.steps.find((step) => step.label === "到货")).toEqual(expect.objectContaining({ active: true }));
    expect(view.steps.find((step) => step.label === "B实验已完成")).toEqual(expect.objectContaining({ reached: true }));
    expect(view.steps.find((step) => step.label === "A实验进行中")).toEqual(expect.objectContaining({ active: false, reached: false }));
  });

  test("buildTrayFlowView highlights the latest completed experiment when the next experiment has not started", () => {
    const view = buildTrayFlowView({
      trayCode: "SYLU-2026-03-002-TP-001",
      taskCode: "SYLU-2026-03-002",
      location: "接驳区",
      status: "实验已完成",
      experiments: [
        {
          task_code: "SYLU-2026-03-002",
          experiment_code: "SYLU-2026-03-002-A",
          experiment_name: "盐雾试验",
        },
        {
          task_code: "SYLU-2026-03-002",
          experiment_code: "SYLU-2026-03-002-B",
          experiment_name: "霉菌试验",
        },
      ],
      experimentTrays: [
        {
          task_code: "SYLU-2026-03-002",
          experiment_code: "SYLU-2026-03-002-A",
          tray_code: "SYLU-2026-03-002-TP-001",
        },
        {
          task_code: "SYLU-2026-03-002",
          experiment_code: "SYLU-2026-03-002-B",
          tray_code: "SYLU-2026-03-002-TP-001",
        },
      ],
      samples: [
        {
          code: "SYLU-2026-03-002-SP-001",
          task_code: "SYLU-2026-03-002",
          location: "接驳区",
          status: "实验已完成",
          trays: [{ tray_code: "SYLU-2026-03-002-TP-001", status: "实验已完成", quantity: 1 }],
          history: [
            { time: "2026-04-21T10:30:00.000Z", detail: "SYLU-2026-03-002 / 盐雾试验 / 实验已完成" },
          ],
        },
      ],
    });

    expect(view.currentStatus).toBe("当前托盘：SYLU-2026-03-002-TP-001 | 当前状态：盐雾试验已完成");
    expect(view.steps.find((step) => step.label === "盐雾试验已完成")).toEqual(expect.objectContaining({ active: true }));
    expect(view.steps.find((step) => step.label === "到货")).toEqual(expect.objectContaining({ active: false }));
  });

  test("buildTrayFlowView uses the real tray status for the current experiment even without an explicit experiment code", () => {
    const view = buildTrayFlowView({
      trayCode: "SYLU-2026-03-002-TP-002",
      taskCode: "SYLU-2026-03-002",
      status: "送至实验室",
      experiments: [
        {
          task_code: "SYLU-2026-03-002",
          experiment_code: "SYLU-2026-03-002-A",
          experiment_name: "盐雾试验",
        },
        {
          task_code: "SYLU-2026-03-002",
          experiment_code: "SYLU-2026-03-002-B",
          experiment_name: "高低温湿热试验",
        },
      ],
      experimentTrays: [
        {
          task_code: "SYLU-2026-03-002",
          experiment_code: "SYLU-2026-03-002-A",
          tray_code: "SYLU-2026-03-002-TP-002",
        },
        {
          task_code: "SYLU-2026-03-002",
          experiment_code: "SYLU-2026-03-002-B",
          tray_code: "SYLU-2026-03-002-TP-002",
        },
      ],
      schedules: [
        {
          task_code: "SYLU-2026-03-002",
          experiment_code: "SYLU-2026-03-002-A",
          start_at: "2026-04-09T08:00:00",
        },
        {
          task_code: "SYLU-2026-03-002",
          experiment_code: "SYLU-2026-03-002-B",
          start_at: "2026-04-09T14:00:00",
        },
      ],
      samples: [
        {
          code: "SYLU-2026-03-002-SP-005",
          task_code: "SYLU-2026-03-002",
          trays: [{ tray_code: "SYLU-2026-03-002-TP-002", status: "送至实验室", quantity: 1 }],
          history: [],
        },
      ],
    });

    expect(view.currentStatus).toBe("当前托盘：SYLU-2026-03-002-TP-002 | 当前状态：送至实验室");
    expect(view.steps.find((step) => step.label === "送至实验室")).toEqual(
      expect.objectContaining({ active: true }),
    );
  });

  test("buildTrayFlowView prioritizes a started experiment ahead of earlier unstarted experiments", () => {
    const view = buildTrayFlowView({
      trayCode: "SYLU-2026-03-002-TP-002",
      taskCode: "SYLU-2026-03-002",
      currentExperimentCode: "SYLU-2026-03-002-B",
      location: "盐雾试验室",
      status: "实验准备就绪",
      experiments: [
        {
          task_code: "SYLU-2026-03-002",
          experiment_code: "SYLU-2026-03-002-A",
          experiment_name: "冲击试验",
        },
        {
          task_code: "SYLU-2026-03-002",
          experiment_code: "SYLU-2026-03-002-B",
          experiment_name: "盐雾试验",
        },
        {
          task_code: "SYLU-2026-03-002",
          experiment_code: "SYLU-2026-03-002-C",
          experiment_name: "温度冲击试验",
        },
      ],
      experimentTrays: [
        {
          task_code: "SYLU-2026-03-002",
          experiment_code: "SYLU-2026-03-002-A",
          tray_code: "SYLU-2026-03-002-TP-002",
        },
        {
          task_code: "SYLU-2026-03-002",
          experiment_code: "SYLU-2026-03-002-B",
          tray_code: "SYLU-2026-03-002-TP-002",
        },
        {
          task_code: "SYLU-2026-03-002",
          experiment_code: "SYLU-2026-03-002-C",
          tray_code: "SYLU-2026-03-002-TP-002",
        },
      ],
      schedules: [
        {
          task_code: "SYLU-2026-03-002",
          experiment_code: "SYLU-2026-03-002-A",
          start_at: "2026-04-09T08:00:00",
        },
        {
          task_code: "SYLU-2026-03-002",
          experiment_code: "SYLU-2026-03-002-B",
          start_at: "2026-04-09T14:00:00",
        },
        {
          task_code: "SYLU-2026-03-002",
          experiment_code: "SYLU-2026-03-002-C",
          start_at: "2026-04-10T08:00:00",
        },
      ],
      samples: [
        {
          code: "SYLU-2026-03-002-SP-005",
          task_code: "SYLU-2026-03-002",
          location: "盐雾试验室",
          status: "实验准备就绪",
          trays: [{ tray_code: "SYLU-2026-03-002-TP-002", status: "实验准备就绪", quantity: 1 }],
          history: [],
        },
      ],
    });

    expect(view.steps.map((step) => step.label)).toEqual([
      "样品运输中",
      "到货",
      "送至暂存间",
      "已到达暂存间",
      "送至实验室",
      "已到达实验室",
      "工装夹具安装",
      "实验准备就绪",
      "盐雾试验进行中",
      "冲击试验未完成",
      "温度冲击试验未完成",
      "放置实验后暂存间",
      "厂家收回",
    ]);
    expect(view.steps.find((step) => step.label === "实验准备就绪")).toEqual(
      expect.objectContaining({ active: true }),
    );
    expect(view.steps.find((step) => step.label === "冲击试验未完成")).toEqual(
      expect.objectContaining({ active: false, reached: false }),
    );
  });

  test("buildTrayFlowView keeps scheduled order when the later experiment has not entered lab flow yet", () => {
    const view = buildTrayFlowView({
      trayCode: "SYLU-2026-03-002-TP-002",
      taskCode: "SYLU-2026-03-002",
      currentExperimentCode: "SYLU-2026-03-002-B",
      location: "接驳区",
      status: "到货",
      experiments: [
        {
          task_code: "SYLU-2026-03-002",
          experiment_code: "SYLU-2026-03-002-A",
          experiment_name: "冲击试验",
        },
        {
          task_code: "SYLU-2026-03-002",
          experiment_code: "SYLU-2026-03-002-B",
          experiment_name: "盐雾试验",
        },
        {
          task_code: "SYLU-2026-03-002",
          experiment_code: "SYLU-2026-03-002-C",
          experiment_name: "温度冲击试验",
        },
      ],
      experimentTrays: [
        {
          task_code: "SYLU-2026-03-002",
          experiment_code: "SYLU-2026-03-002-A",
          tray_code: "SYLU-2026-03-002-TP-002",
        },
        {
          task_code: "SYLU-2026-03-002",
          experiment_code: "SYLU-2026-03-002-B",
          tray_code: "SYLU-2026-03-002-TP-002",
        },
        {
          task_code: "SYLU-2026-03-002",
          experiment_code: "SYLU-2026-03-002-C",
          tray_code: "SYLU-2026-03-002-TP-002",
        },
      ],
      schedules: [
        {
          task_code: "SYLU-2026-03-002",
          experiment_code: "SYLU-2026-03-002-A",
          start_at: "2026-04-09T08:00:00",
        },
        {
          task_code: "SYLU-2026-03-002",
          experiment_code: "SYLU-2026-03-002-B",
          start_at: "2026-04-09T14:00:00",
        },
        {
          task_code: "SYLU-2026-03-002",
          experiment_code: "SYLU-2026-03-002-C",
          start_at: "2026-04-10T08:00:00",
        },
      ],
      samples: [
        {
          code: "SYLU-2026-03-002-SP-005",
          task_code: "SYLU-2026-03-002",
          location: "接驳区",
          status: "到货",
          trays: [{ tray_code: "SYLU-2026-03-002-TP-002", status: "到货", quantity: 1 }],
          history: [],
        },
      ],
    });

    expect(view.steps.map((step) => step.label)).toEqual([
      "样品运输中",
      "到货",
      "送至暂存间",
      "已到达暂存间",
      "送至实验室",
      "已到达实验室",
      "工装夹具安装",
      "实验准备就绪",
      "冲击试验进行中",
      "盐雾试验未完成",
      "温度冲击试验未完成",
      "放置实验后暂存间",
      "厂家收回",
    ]);
    expect(view.steps.find((step) => step.label === "到货")).toEqual(
      expect.objectContaining({ active: true }),
    );
  });

  test("buildTrayFlowView treats staging after all mapped experiments are completed as post-experiment staging", () => {
    const view = buildTrayFlowView({
      trayCode: "SYLU-2026-03-001-TP-002",
      taskCode: "SYLU-2026-03-001",
      location: "恒温恒湿间（暂存间）",
      status: "已到达暂存间",
      experiments: [
        {
          task_code: "SYLU-2026-03-001",
          experiment_code: "SYLU-2026-03-001-A",
          experiment_name: "盐雾试验",
        },
        {
          task_code: "SYLU-2026-03-001",
          experiment_code: "SYLU-2026-03-001-B",
          experiment_name: "四综合试验",
        },
      ],
      experimentTrays: [
        {
          task_code: "SYLU-2026-03-001",
          experiment_code: "SYLU-2026-03-001-A",
          tray_code: "SYLU-2026-03-001-TP-002",
        },
        {
          task_code: "SYLU-2026-03-001",
          experiment_code: "SYLU-2026-03-001-B",
          tray_code: "SYLU-2026-03-001-TP-002",
        },
      ],
      samples: [
        {
          code: "SYLU-2026-03-001-SP-002",
          task_code: "SYLU-2026-03-001",
          location: "恒温恒湿间（暂存间）",
          status: "已到达暂存间",
          trays: [{ tray_code: "SYLU-2026-03-001-TP-002", status: "已到达暂存间", quantity: 1 }],
          history: [
            { time: "2026-04-21T10:30:00.000Z", detail: "SYLU-2026-03-001 / 盐雾试验 / 实验已完成" },
            { time: "2026-04-21T12:30:00.000Z", detail: "SYLU-2026-03-001 / 四综合试验 / 实验已完成" },
          ],
        },
      ],
    });

    expect(view.currentStatus).toBe("当前托盘：SYLU-2026-03-001-TP-002 | 当前状态：放置实验后暂存间");
    expect(view.steps.find((step) => step.label === "盐雾试验已完成")).toEqual(expect.objectContaining({ reached: true }));
    expect(view.steps.find((step) => step.label === "放置实验后暂存间")).toEqual(expect.objectContaining({ active: true }));
  });

  test("exports the canonical tray status options in the approved flow order", () => {
    expect(TRAY_STATUS_OPTIONS).toEqual([
      "样品运输中",
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
    expect(syncTrayStatusToSampleStatus("运输中")).toBe("样品运输中");
    expect(syncTrayStatusToSampleStatus("实验进行中")).toBe("实验进行中");
    expect(syncTrayStatusToSampleStatus("未知状态")).toBe("样品运输中");
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
        trays: [{ tray_code: "TP-001", status: "到货", quantity: 1 }],
      },
      payload: { status: "工装夹具安装", remark: "进入实验前检查完成" },
      now: "2026-03-13T10:00:00.000Z",
    });

    expect(result.sample.status).toBe("工装夹具安装");
    expect(result.sample.flow_status).toBe("工装夹具安装");
    expect(result.sample.trays[0].status).toBe("工装夹具安装");
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
        {
          code: "SP-001",
          task_code: "SZH-1",
          location: "恒温恒湿间（暂存间）",
          status: "已到达暂存间",
          owner: "张三",
          history: [],
          trays: [{ tray_code: "TP-001", status: "已到达暂存间", quantity: 1 }],
        },
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
    expect(result.samples[0].trays[0].status).toBe("已到达实验室");
    expect(result.samples[0].history[0].action).toBe("暂存间派发");
  });

  test("buildSamplesTrayOverviewView aggregates trays across samples and exposes task context", () => {
    const view = buildSamplesTrayOverviewView({
      tasks: [
        { code: "SYLU-2026-03-001", name: "任务A", test_type: "冲击试验" },
        { code: "SYLU-2026-03-002", name: "任务B", test_type: "振动试验" },
      ],
      samples: [
        {
          code: "SYLU-2026-03-001-SP-001",
          task_code: "SYLU-2026-03-001",
          trays: [{ tray_code: "SYLU-2026-03-001-TP-001", status: "到货", quantity: 1 }],
        },
        {
          code: "SYLU-2026-03-001-SP-002",
          task_code: "SYLU-2026-03-001",
          trays: [{ tray_code: "SYLU-2026-03-001-TP-001", status: "到货", quantity: 1 }],
        },
        {
          code: "SYLU-2026-03-002-SP-001",
          task_code: "SYLU-2026-03-002",
          trays: [{ tray_code: "SYLU-2026-03-002-TP-001", status: "运输中", quantity: 1 }],
        },
      ],
      query: "",
    });

    expect(view.rows).toEqual([
      expect.objectContaining({
        trayCode: "SYLU-2026-03-001-TP-001",
        taskCode: "SYLU-2026-03-001",
        taskName: "任务A",
        testType: "冲击试验",
        status: "到货",
        sampleCount: 2,
        sampleCodes: ["SYLU-2026-03-001-SP-001", "SYLU-2026-03-001-SP-002"],
      }),
      expect.objectContaining({
        trayCode: "SYLU-2026-03-002-TP-001",
        taskCode: "SYLU-2026-03-002",
        taskName: "任务B",
        testType: "振动试验",
        status: "样品运输中",
        sampleCount: 1,
        sampleCodes: ["SYLU-2026-03-002-SP-001"],
      }),
    ]);
  });

  test("buildSamplesTrayOverviewView only keeps the latest active tray for each sample", () => {
    const view = buildSamplesTrayOverviewView({
      tasks: [{ code: "SYLU-2026-03-001", name: "任务A", test_type: "冲击试验" }],
      samples: [
        {
          code: "SYLU-2026-03-001-SP-001",
          task_code: "SYLU-2026-03-001",
          trays: [
            {
              tray_code: "SYLU-2026-03-001-TP-021",
              status: "到货",
              quantity: 1,
              updated_at: "2026-03-20T08:00:00.000Z",
            },
            {
              tray_code: "SYLU-2026-03-001-TP-001",
              status: "送至实验室",
              quantity: 1,
              updated_at: "2026-03-21T08:00:00.000Z",
            },
          ],
        },
        {
          code: "SYLU-2026-03-001-SP-002",
          task_code: "SYLU-2026-03-001",
          trays: [
            {
              tray_code: "SYLU-2026-03-001-TP-002",
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
    expect(view.rows.map((row) => row.trayCode)).toEqual(["SYLU-2026-03-001-TP-001", "SYLU-2026-03-001-TP-002"]);
    expect(view.rows.find((row) => row.trayCode === "SYLU-2026-03-001-TP-021")).toBeUndefined();
  });

  test("buildSamplesTrayOverviewView keeps the furthest tray status when one tray is bound to multiple experiments", () => {
    const view = buildSamplesTrayOverviewView({
      tasks: [{ code: "SYLU-2026-03-001", name: "任务A", test_type: "盐雾试验 / 高低温湿热试验" }],
      samples: [
        {
          code: "SYLU-2026-03-001-SP-001",
          task_code: "SYLU-2026-03-001",
          location: "盐雾试验室",
          trays: [
            {
              tray_code: "SYLU-2026-03-001-TP-001",
              status: "实验进行中",
              quantity: 1,
              experiment_code: "SYLU-2026-03-001-B",
              updated_at: "2026-04-08T08:00:00.000Z",
            },
            {
              tray_code: "SYLU-2026-03-001-TP-001",
              status: "已到达实验室",
              quantity: 1,
              experiment_code: "SYLU-2026-03-001-A",
              updated_at: "2026-04-08T09:00:00.000Z",
            },
          ],
        },
      ],
      query: "",
    });

    expect(view.rows).toEqual([
      expect.objectContaining({
        trayCode: "SYLU-2026-03-001-TP-001",
        status: "实验进行中",
        sampleCodes: ["SYLU-2026-03-001-SP-001"],
      }),
    ]);
  });

  test("updateTrayStatus synchronizes tray status to all samples assigned to the tray", () => {
    const result = updateTrayStatus({
      tasks: [{ code: "SYLU-2026-03-001", name: "任务A", test_type: "冲击试验" }],
      samples: [
        {
          id: "sample-1",
          code: "SYLU-2026-03-001-SP-001",
          task_code: "SYLU-2026-03-001",
          status: "到货",
          flow_status: "到货",
          history: [],
          trays: [{ tray_code: "SYLU-2026-03-001-TP-001", status: "到货", quantity: 1 }],
        },
        {
          id: "sample-2",
          code: "SYLU-2026-03-001-SP-002",
          task_code: "SYLU-2026-03-001",
          status: "到货",
          flow_status: "到货",
          history: [],
          trays: [{ tray_code: "SYLU-2026-03-001-TP-001", status: "到货", quantity: 1 }],
        },
      ],
      trayCode: "SYLU-2026-03-001-TP-001",
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
