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

  test("buildTrayFlowView displays the concrete laboratory for lab dispatch steps", () => {
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
      schedules: [
        {
          task_code: "SYLU-2026-03-001",
          experiment_code: "SYLU-2026-03-001-A",
          device: "盐雾试验室",
        },
      ],
    });

    expect(view.currentStatus).toBe("当前托盘：SYLU-2026-03-001-TP-004 | 当前状态：送至盐雾试验室");
    expect(view.steps.find((step) => step.key === "sent_to_lab")).toEqual(expect.objectContaining({
      active: true,
      label: "送至盐雾试验室",
    }));
  });

  test("buildTrayFlowView resolves concrete laboratories from camelCase schedule experiment codes", () => {
    const view = buildTrayFlowView({
      trayCode: "TP-MOLD-001",
      taskCode: "TASK-MOLD-001",
      status: "送至实验室",
      experiments: [
        {
          task_code: "TASK-MOLD-001",
          experiment_code: "EXP-MOLD",
          experiment_type: "霉菌试验",
        },
      ],
      experimentTrays: [
        {
          task_code: "TASK-MOLD-001",
          experiment_code: "EXP-MOLD",
          tray_code: "TP-MOLD-001",
        },
      ],
      schedules: [
        {
          task_code: "TASK-MOLD-001",
          experimentCode: "EXP-MOLD",
          device: "霉菌试验室",
        },
      ],
      samples: [
        {
          code: "SP-MOLD-001",
          task_code: "TASK-MOLD-001",
          location: "霉菌试验室",
          status: "送至实验室",
          trays: [{ tray_code: "TP-MOLD-001", status: "送至实验室" }],
        },
      ],
    });

    expect(view.steps.find((step) => step.key === "sent_to_lab")).toEqual(expect.objectContaining({
      label: "送至霉菌试验室",
    }));
  });

  test("buildTrayFlowView displays the concrete laboratory for multi-experiment route steps", () => {
    const view = buildTrayFlowView({
      trayCode: "SYLU-2026-03-101-TP-001",
      taskCode: "SYLU-2026-03-101",
      currentExperimentCode: "SYLU-2026-03-101-B",
      status: "送至实验室",
      experiments: [
        {
          task_code: "SYLU-2026-03-101",
          experiment_code: "SYLU-2026-03-101-A",
          experiment_type: "盐雾试验",
        },
        {
          task_code: "SYLU-2026-03-101",
          experiment_code: "SYLU-2026-03-101-B",
          experiment_type: "霉菌试验",
        },
      ],
      experimentTrays: [
        {
          task_code: "SYLU-2026-03-101",
          experiment_code: "SYLU-2026-03-101-A",
          tray_code: "SYLU-2026-03-101-TP-001",
        },
        {
          task_code: "SYLU-2026-03-101",
          experiment_code: "SYLU-2026-03-101-B",
          tray_code: "SYLU-2026-03-101-TP-001",
        },
      ],
      schedules: [
        {
          task_code: "SYLU-2026-03-101",
          experiment_code: "SYLU-2026-03-101-A",
          device: "盐雾试验室",
          start_at: "2026-03-01T08:00:00+08:00",
        },
        {
          task_code: "SYLU-2026-03-101",
          experiment_code: "SYLU-2026-03-101-B",
          device: "霉菌试验室",
          start_at: "2026-03-02T08:00:00+08:00",
        },
      ],
      samples: [
        {
          task_code: "SYLU-2026-03-101",
          trays: [{ tray_code: "SYLU-2026-03-101-TP-001", status: "盐雾试验已完成" }],
          history: [
            {
              detail: "SYLU-2026-03-101 / 盐雾试验 / 实验已完成",
              time: "2026-03-01T12:00:00+08:00",
            },
          ],
        },
      ],
    });

    const routeStep = view.steps.find((step) => step.key.startsWith("route-") && step.label === "送至霉菌试验室");
    expect(routeStep).toEqual(expect.objectContaining({ active: true }));
    expect(view.status).toBe("送至霉菌试验室");
    expect(view.canonicalStatus).toBe("送至实验室");
  });

  test("buildTrayFlowView uses the tray target lab to choose the current shared-tray experiment", () => {
    const view = buildTrayFlowView({
      trayCode: "SYLU-2026-06-021-TP-002",
      taskCode: "SYLU-2026-06-021",
      status: "送至实验室",
      experiments: [
        {
          task_code: "SYLU-2026-06-021",
          experiment_code: "SYLU-2026-06-021-A",
          experiment_name: "冲击试验",
        },
        {
          task_code: "SYLU-2026-06-021",
          experiment_code: "SYLU-2026-06-021-B",
          experiment_name: "温度冲击试验",
        },
        {
          task_code: "SYLU-2026-06-021",
          experiment_code: "SYLU-2026-06-021-C",
          experiment_name: "振动试验",
        },
      ],
      experimentTrays: [
        {
          task_code: "SYLU-2026-06-021",
          experiment_code: "SYLU-2026-06-021-A",
          tray_code: "SYLU-2026-06-021-TP-002",
        },
        {
          task_code: "SYLU-2026-06-021",
          experiment_code: "SYLU-2026-06-021-B",
          tray_code: "SYLU-2026-06-021-TP-002",
        },
        {
          task_code: "SYLU-2026-06-021",
          experiment_code: "SYLU-2026-06-021-C",
          tray_code: "SYLU-2026-06-021-TP-002",
        },
      ],
      schedules: [
        {
          task_code: "SYLU-2026-06-021",
          experiment_code: "SYLU-2026-06-021-A",
          device: "冲击一室",
          start_at: "2026-06-04T08:00:00+08:00",
        },
        {
          task_code: "SYLU-2026-06-021",
          experiment_code: "SYLU-2026-06-021-B",
          device: "温度冲击一室",
          start_at: "2026-06-04T08:00:00+08:00",
        },
        {
          task_code: "SYLU-2026-06-021",
          experiment_code: "SYLU-2026-06-021-C",
          device: "振动一室",
          start_at: "2026-06-04T08:00:00+08:00",
        },
      ],
      samples: [
        {
          code: "SYLU-2026-06-021-SP-002",
          task_code: "SYLU-2026-06-021",
          location: "温度冲击一室",
          status: "送至实验室",
          trays: [
            {
              tray_code: "SYLU-2026-06-021-TP-002",
              status: "送至实验室",
              target_lab: "温度冲击一室",
            },
          ],
        },
      ],
    });

    expect(view.steps.find((step) => step.label === "送至温度冲击一室")).toEqual(
      expect.objectContaining({ active: true }),
    );
    expect(view.steps.some((step) => step.label === "送至冲击一室" && step.active)).toBe(false);
  });

  test("buildTrayFlowView lets tray target lab override a stale current experiment code", () => {
    const view = buildTrayFlowView({
      trayCode: "SYLU-2026-06-022-TP-001",
      taskCode: "SYLU-2026-06-022",
      currentExperimentCode: "SYLU-2026-06-022-A",
      status: "送至实验室",
      experiments: [
        {
          task_code: "SYLU-2026-06-022",
          experiment_code: "SYLU-2026-06-022-A",
          experiment_name: "冲击试验",
        },
        {
          task_code: "SYLU-2026-06-022",
          experiment_code: "SYLU-2026-06-022-B",
          experiment_name: "温度冲击试验",
        },
      ],
      experimentTrays: [
        {
          task_code: "SYLU-2026-06-022",
          experiment_code: "SYLU-2026-06-022-A",
          tray_code: "SYLU-2026-06-022-TP-001",
        },
        {
          task_code: "SYLU-2026-06-022",
          experiment_code: "SYLU-2026-06-022-B",
          tray_code: "SYLU-2026-06-022-TP-001",
        },
      ],
      schedules: [
        {
          task_code: "SYLU-2026-06-022",
          experiment_code: "SYLU-2026-06-022-A",
          device: "冲击一室",
        },
        {
          task_code: "SYLU-2026-06-022",
          experiment_code: "SYLU-2026-06-022-B",
          device: "温度冲击一室",
        },
      ],
      samples: [
        {
          code: "SYLU-2026-06-022-SP-001",
          task_code: "SYLU-2026-06-022",
          location: "温度冲击一室",
          status: "送至实验室",
          trays: [
            {
              tray_code: "SYLU-2026-06-022-TP-001",
              status: "送至实验室",
              target_lab: "温度冲击一室",
            },
          ],
        },
      ],
    });

    expect(view.steps.find((step) => step.label === "送至温度冲击一室")).toEqual(
      expect.objectContaining({ active: true }),
    );
    expect(view.steps.some((step) => step.label === "送至冲击一室" && step.active)).toBe(false);
  });

  test("buildTrayFlowView does not guess a concrete next lab when multiple unfinished experiments remain", () => {
    const taskCode = "SYLU-2026-06-023";
    const trayCode = "SYLU-2026-06-023-TP-001";
    const view = buildTrayFlowView({
      trayCode,
      taskCode,
      status: "实验已完成",
      experiments: [
        { task_code: taskCode, experiment_code: `${taskCode}-A`, experiment_name: "盐雾试验" },
        { task_code: taskCode, experiment_code: `${taskCode}-B`, experiment_name: "振动试验" },
        { task_code: taskCode, experiment_code: `${taskCode}-C`, experiment_name: "温度冲击试验" },
      ],
      experimentTrays: [
        { task_code: taskCode, experiment_code: `${taskCode}-A`, tray_code: trayCode },
        { task_code: taskCode, experiment_code: `${taskCode}-B`, tray_code: trayCode },
        { task_code: taskCode, experiment_code: `${taskCode}-C`, tray_code: trayCode },
      ],
      schedules: [
        { task_code: taskCode, experiment_code: `${taskCode}-A`, device: "盐雾试验室" },
        { task_code: taskCode, experiment_code: `${taskCode}-B`, device: "振动一室" },
        { task_code: taskCode, experiment_code: `${taskCode}-C`, device: "温度冲击一室" },
      ],
      samples: [
        {
          code: "SYLU-2026-06-023-SP-001",
          task_code: taskCode,
          location: "盐雾试验室",
          status: "实验已完成",
          trays: [{ tray_code: trayCode, status: "实验已完成", quantity: 1 }],
          history: [
            {
              detail: `${taskCode} / 盐雾试验 / 实验已完成`,
              status: "实验已完成",
              time: "2026-06-05T10:21:42+08:00",
            },
          ],
        },
      ],
    });

    expect(view.currentStatus).toBe(`当前托盘：${trayCode} | 当前状态：盐雾试验已完成`);
    expect(view.steps.find((step) => step.label === "盐雾试验已完成")).toEqual(
      expect.objectContaining({ active: true }),
    );
    expect(view.steps.some((step) => step.label === "送至振动一室")).toBe(false);
    expect(view.steps.some((step) => step.label === "送至温度冲击一室")).toBe(false);
  });

  test("buildTrayFlowView lets directed tray dispatch override scheduled experiment status", () => {
    const taskCode = "SYLU-2026-06-001";
    const trayCode = "SYLU-2026-06-001-TP-001";
    const view = buildTrayFlowView({
      trayCode,
      taskCode,
      status: "送至实验室",
      experiments: [
        {
          task_code: taskCode,
          experiment_code: "SYLU-2026-06-001-A",
          experiment_name: "霉菌试验",
          required_device: "霉菌试验",
          status: "已排程",
        },
        {
          task_code: taskCode,
          experiment_code: "SYLU-2026-06-001-B",
          experiment_name: "冲击试验",
          required_device: "冲击试验",
          status: "已排程",
        },
        {
          task_code: taskCode,
          experiment_code: "SYLU-2026-06-001-C",
          experiment_name: "盐雾试验",
          required_device: "盐雾试验",
          status: "已排程",
        },
      ],
      experimentTrays: [
        { task_code: taskCode, experiment_code: "SYLU-2026-06-001-A", tray_code: trayCode },
        { task_code: taskCode, experiment_code: "SYLU-2026-06-001-B", tray_code: trayCode },
        { task_code: taskCode, experiment_code: "SYLU-2026-06-001-C", tray_code: trayCode },
      ],
      schedules: [
        {
          task_code: taskCode,
          experiment_code: "SYLU-2026-06-001-A",
          device: "霉菌试验室",
          start_at: "2026-06-04T15:40:00+08:00",
          status: "已排程",
        },
        {
          task_code: taskCode,
          experiment_code: "SYLU-2026-06-001-B",
          device: "冲击一室",
          start_at: "2026-06-05T08:00:00+08:00",
          status: "已排程",
        },
        {
          task_code: taskCode,
          experiment_code: "SYLU-2026-06-001-C",
          device: "盐雾试验室",
          start_at: "2026-06-05T12:00:00+08:00",
          status: "已排程",
        },
      ],
      samples: [
        {
          code: "SYLU-2026-06-001-SP-001",
          task_code: taskCode,
          location: "冲击一室",
          status: "送至实验室",
          trays: [
            {
              tray_code: trayCode,
              sample_code: "SYLU-2026-06-001-SP-001",
              quantity: 1,
              status: "送至实验室",
              target_lab: "冲击一室",
            },
          ],
          history: [
            {
              time: "2026-06-04T15:40:52+08:00",
              action: "送至实验室",
              location: "冲击一室",
              status: "送至实验室",
              detail: `${trayCode} -> 冲击一室`,
            },
          ],
        },
      ],
    });

    expect(view.currentStatus).toBe(`当前托盘：${trayCode} | 当前状态：送至冲击一室`);
    expect(view.steps.find((step) => step.label === "送至冲击一室")).toEqual(
      expect.objectContaining({ active: true }),
    );
    expect(view.steps.some((step) => step.label === "送至霉菌试验室" && step.active)).toBe(false);
  });

  test("buildTrayFlowView prefers structured dispatch location over stale detail text", () => {
    const taskCode = "SYLU-2026-06-001";
    const trayCode = "SYLU-2026-06-001-TP-002";
    const view = buildTrayFlowView({
      trayCode,
      taskCode,
      status: "送至实验室",
      experiments: [
        {
          task_code: taskCode,
          experiment_code: "EXP-MOLD",
          experiment_name: "霉菌试验",
          required_device: "霉菌试验",
          status: "已排程",
        },
        {
          task_code: taskCode,
          experiment_code: "EXP-IMPACT",
          experiment_name: "冲击试验",
          required_device: "冲击试验",
          status: "已排程",
        },
      ],
      experimentTrays: [
        { task_code: taskCode, experiment_code: "EXP-MOLD", tray_code: trayCode },
        { task_code: taskCode, experiment_code: "EXP-IMPACT", tray_code: trayCode },
      ],
      schedules: [
        {
          task_code: taskCode,
          experiment_code: "EXP-MOLD",
          device: "霉菌试验室",
          start_at: "2026-06-04T15:40:00+08:00",
          status: "已排程",
        },
        {
          task_code: taskCode,
          experiment_code: "EXP-IMPACT",
          device: "冲击一室",
          start_at: "2026-06-05T08:00:00+08:00",
          status: "已排程",
        },
      ],
      samples: [
        {
          code: "SYLU-2026-06-001-SP-002",
          task_code: taskCode,
          location: "冲击一室",
          status: "送至实验室",
          trays: [
            {
              tray_code: trayCode,
              sample_code: "SYLU-2026-06-001-SP-002",
              quantity: 1,
              status: "送至实验室",
            },
          ],
          history: [
            {
              time: "2026-06-04T15:40:52+08:00",
              action: "送至实验室",
              location: "冲击一室",
              status: "送至实验室",
              detail: `${trayCode} -> 霉菌试验室`,
            },
          ],
        },
      ],
    });

    expect(view.currentStatus).toBe(`当前托盘：${trayCode} | 当前状态：送至冲击一室`);
    expect(view.steps.find((step) => step.label === "送至冲击一室")).toEqual(
      expect.objectContaining({ active: true }),
    );
    expect(view.steps.some((step) => step.label === "送至霉菌试验室" && step.active)).toBe(false);
  });

  test("buildTrayFlowView labels tray experiment requirements by test type instead of experiment name", () => {
    const view = buildTrayFlowView({
      trayCode: "SYLU-2026-03-101-TP-001",
      taskCode: "SYLU-2026-03-101",
      currentExperimentCode: "SYLU-2026-03-101-A",
      status: "实验进行中",
      experiments: [
        {
          task_code: "SYLU-2026-03-101",
          experiment_code: "SYLU-2026-03-101-A",
          experiment_name: "高低温湿热试验2",
          required_device: "高低温湿热试验",
        },
        {
          task_code: "SYLU-2026-03-101",
          experiment_code: "SYLU-2026-03-101-B",
          experiment_name: "冲击试验2",
          required_device: "冲击试验",
        },
      ],
      experimentTrays: [
        {
          task_code: "SYLU-2026-03-101",
          experiment_code: "SYLU-2026-03-101-A",
          tray_code: "SYLU-2026-03-101-TP-001",
        },
        {
          task_code: "SYLU-2026-03-101",
          experiment_code: "SYLU-2026-03-101-B",
          tray_code: "SYLU-2026-03-101-TP-001",
        },
      ],
    });

    expect(view.steps.map((step) => step.label)).toContain("高低温湿热试验进行中");
    expect(view.steps.map((step) => step.label)).toContain("冲击试验未完成");
    expect(view.steps.map((step) => step.label)).not.toContain("高低温湿热试验2进行中");
    expect(view.steps.map((step) => step.label)).not.toContain("冲击试验2未完成");
  });

  test("buildTrayFlowView lets mqtt running run override stale ready history keyed by experiment code", () => {
    const taskCode = "SYLU-2026-06-021";
    const experimentCode = "SYLU-2026-06-021-A";
    const trayCode = "SYLU-2026-06-021-TP-001";
    const view = buildTrayFlowView({
      currentExperimentCode: experimentCode,
      experimentRuns: [
        {
          task_code: taskCode,
          experiment_code: experimentCode,
          tray_codes: [trayCode],
          status: "实验进行中",
          started_at: "2026-06-04T16:11:53+08:00",
        },
      ],
      experimentTrays: [
        { task_code: taskCode, experiment_code: experimentCode, tray_code: trayCode },
        { task_code: taskCode, experiment_code: "SYLU-2026-06-021-B", tray_code: trayCode },
        { task_code: taskCode, experiment_code: "SYLU-2026-06-021-C", tray_code: trayCode },
      ],
      experiments: [
        {
          task_code: taskCode,
          experiment_code: experimentCode,
          experiment_name: "冲击试验",
          required_device: "冲击试验",
          status: "实验进行中",
        },
        {
          task_code: taskCode,
          experiment_code: "SYLU-2026-06-021-B",
          experiment_name: "温度冲击试验",
          required_device: "温度冲击试验",
          status: "已排程",
        },
        {
          task_code: taskCode,
          experiment_code: "SYLU-2026-06-021-C",
          experiment_name: "振动试验",
          required_device: "振动试验",
          status: "已排程",
        },
      ],
      schedules: [
        { task_code: taskCode, experiment_code: experimentCode, device: "冲击一室", status: "实验进行中" },
        { task_code: taskCode, experiment_code: "SYLU-2026-06-021-B", device: "温度冲击一室", status: "已排程" },
        { task_code: taskCode, experiment_code: "SYLU-2026-06-021-C", device: "振动一室", status: "已排程" },
      ],
      samples: [
        {
          code: "SYLU-2026-06-021-SP-001",
          task_code: taskCode,
          location: "冲击一室",
          status: "实验进行中",
          trays: [
            {
              tray_code: trayCode,
              sample_code: "SYLU-2026-06-021-SP-001",
              quantity: 1,
              status: "实验进行中",
              target_lab: "冲击一室",
            },
          ],
          history: [
            {
              time: "2026-06-04T16:11:53+08:00",
              action: "开始实验",
              location: "冲击一室",
              status: "实验进行中",
              detail: `${taskCode} / ${experimentCode} / 实验进行中 / 托盘：${trayCode}`,
            },
            {
              time: "2026-06-04T16:11:49+08:00",
              action: "实验确认",
              location: "冲击一室",
              status: "实验准备就绪",
              detail: `${taskCode} / 冲击试验 / 实验准备就绪`,
            },
          ],
        },
      ],
      status: "实验进行中",
      taskCode,
      trayCode,
    });

    expect(view.currentStatus).toBe(`当前托盘：${trayCode} | 当前状态：冲击试验进行中`);
    expect(view.steps.find((step) => step.label === "冲击试验进行中")).toEqual(
      expect.objectContaining({ active: true, time: "2026-06-04T16:11:53+08:00" }),
    );
    expect(view.steps.find((step) => step.label === "实验准备就绪")).toEqual(
      expect.objectContaining({ active: false, reached: true }),
    );
  });

  test("buildTrayFlowView prefers tray-scoped run status over the parent run status", () => {
    const taskCode = "SYLU-2026-06-031";
    const experimentCode = "SYLU-2026-06-031-A";
    const trayCode = "SYLU-2026-06-031-TP-002";
    const view = buildTrayFlowView({
      currentExperimentCode: experimentCode,
      experimentRuns: [
        {
          run_no: "RUN-SALT-001",
          task_code: taskCode,
          experiment_code: experimentCode,
          tray_codes: ["SYLU-2026-06-031-TP-001", trayCode],
          status: "实验已完成",
          started_at: "2026-06-05 08:30:00",
          ended_at: "2026-06-05 09:30:00",
        },
      ],
      experimentRunTrays: [
        {
          run_no: "RUN-SALT-001",
          task_code: taskCode,
          experiment_code: experimentCode,
          tray_code: "SYLU-2026-06-031-TP-001",
          status: "实验已完成",
          started_at: "2026-06-05 08:30:00",
          ended_at: "2026-06-05 09:30:00",
        },
        {
          run_no: "RUN-SALT-001",
          task_no: taskCode,
          experiment_no: experimentCode,
          tray_no: trayCode,
          run_tray_status: "实验进行中",
          status: "实验已完成",
          started_at: "2026-06-05 08:30:00",
          ended_at: "",
        },
      ],
      experimentTrays: [
        { task_code: taskCode, experiment_code: experimentCode, tray_code: "SYLU-2026-06-031-TP-001" },
        { task_code: taskCode, experiment_code: experimentCode, tray_code: trayCode },
        { task_code: taskCode, experiment_code: "SYLU-2026-06-031-B", tray_code: trayCode },
      ],
      experiments: [
        { task_code: taskCode, experiment_code: experimentCode, experiment_name: "盐雾试验", required_device: "盐雾试验室" },
        { task_code: taskCode, experiment_code: "SYLU-2026-06-031-B", experiment_name: "振动试验", required_device: "振动一室" },
      ],
      samples: [
        {
          code: "SYLU-2026-06-031-SP-005",
          task_code: taskCode,
          location: "盐雾试验室",
          status: "实验准备就绪",
          trays: [{ tray_code: trayCode, status: "实验准备就绪", quantity: 1 }],
        },
      ],
      status: "实验准备就绪",
      taskCode,
      trayCode,
    });

    expect(view.currentStatus).toBe(`当前托盘：${trayCode} | 当前状态：盐雾试验进行中`);
    expect(view.steps.find((step) => step.label === "盐雾试验进行中")).toEqual(
      expect.objectContaining({ active: true, time: "2026-06-05 08:30:00" }),
    );
  });

  test("buildTrayFlowView uses experiment run start time when running history is missing", () => {
    const taskCode = "SYLU-2026-06-021";
    const experimentCode = "SYLU-2026-06-021-A";
    const trayCode = "SYLU-2026-06-021-TP-001";
    const view = buildTrayFlowView({
      currentExperimentCode: experimentCode,
      experimentRuns: [
        {
          task_code: taskCode,
          experiment_code: experimentCode,
          tray_codes: [trayCode],
          status: "实验进行中",
          started_at: "2026-06-04T19:12:09+08:00",
        },
      ],
      experimentTrays: [
        { task_code: taskCode, experiment_code: experimentCode, tray_code: trayCode },
        { task_code: taskCode, experiment_code: "SYLU-2026-06-021-B", tray_code: trayCode },
      ],
      experiments: [
        {
          task_code: taskCode,
          experiment_code: experimentCode,
          experiment_name: "冲击试验",
          required_device: "冲击试验",
          status: "实验进行中",
        },
        {
          task_code: taskCode,
          experiment_code: "SYLU-2026-06-021-B",
          experiment_name: "温度冲击试验",
          required_device: "温度冲击试验",
          status: "已排程",
        },
      ],
      samples: [
        {
          code: "SYLU-2026-06-021-SP-001",
          task_code: taskCode,
          location: "冲击一室",
          status: "实验进行中",
          trays: [
            {
              tray_code: trayCode,
              sample_code: "SYLU-2026-06-021-SP-001",
              quantity: 1,
              status: "实验进行中",
              target_lab: "冲击一室",
            },
          ],
          history: [
            {
              time: "2026-06-04T19:12:07+08:00",
              action: "实验确认",
              location: "冲击一室",
              status: "实验准备就绪",
              detail: `${taskCode} / 冲击试验 / 实验准备就绪`,
            },
          ],
        },
      ],
      status: "实验进行中",
      taskCode,
      trayCode,
    });

    expect(view.currentStatus).toBe(`当前托盘：${trayCode} | 当前状态：冲击试验进行中`);
    expect(view.steps.find((step) => step.label === "冲击试验进行中")).toEqual(
      expect.objectContaining({ active: true, time: "2026-06-04T19:12:09+08:00" }),
    );
  });

  test("buildTrayFlowView matches experiment history by test type while displaying test type labels", () => {
    const view = buildTrayFlowView({
      trayCode: "SYLU-2026-03-102-TP-001",
      taskCode: "SYLU-2026-03-102",
      status: "实验进行中",
      experiments: [
        {
          task_code: "SYLU-2026-03-102",
          experiment_code: "SYLU-2026-03-102-A",
          experiment_name: "高低温湿热试验2",
          required_device: "高低温湿热试验",
        },
        {
          task_code: "SYLU-2026-03-102",
          experiment_code: "SYLU-2026-03-102-B",
          experiment_name: "冲击试验2",
          required_device: "冲击试验",
        },
      ],
      experimentTrays: [
        {
          task_code: "SYLU-2026-03-102",
          experiment_code: "SYLU-2026-03-102-A",
          tray_code: "SYLU-2026-03-102-TP-001",
        },
        {
          task_code: "SYLU-2026-03-102",
          experiment_code: "SYLU-2026-03-102-B",
          tray_code: "SYLU-2026-03-102-TP-001",
        },
      ],
      samples: [
        {
          code: "SYLU-2026-03-102-SP-001",
          task_code: "SYLU-2026-03-102",
          trays: [{ quantity: 1, tray_code: "SYLU-2026-03-102-TP-001", status: "实验进行中" }],
          history: [
            { detail: "SYLU-2026-03-102 / 冲击试验 / 实验进行中", time: "2026-04-21T11:00:00.000Z" },
            { detail: "SYLU-2026-03-102 / 高低温湿热试验 / 实验已完成", time: "2026-04-21T10:00:00.000Z" },
          ],
        },
      ],
    });

    expect(view.steps.find((step) => step.label === "高低温湿热试验已完成")).toEqual(
      expect.objectContaining({ reached: true }),
    );
    expect(view.steps.map((step) => step.label)).toContain("冲击试验进行中");
  });

  test("buildTrayFlowView exposes tray flow step times including arrival", () => {
    const view = buildTrayFlowView({
      trayCode: "SYLU-2026-03-001-TP-001",
      taskCode: "SYLU-2026-03-001",
      status: "厂家收回",
      samples: [
        {
          code: "SYLU-2026-03-001-SP-001",
          task_code: "SYLU-2026-03-001",
          status: "厂家收回",
          created_at: "2026-04-28T11:30:00+08:00",
          trays: [{ tray_code: "SYLU-2026-03-001-TP-001", status: "厂家收回", updated_at: "2026-04-28T11:36:00+08:00", quantity: 1 }],
          history: [
            { action: "批量入库", status: "到货", time: "2026-04-28T11:31:20+08:00" },
            { action: "托盘状态更新", status: "送至暂存间", time: "2026-04-28T11:31:52+08:00" },
            { action: "厂家收回", status: "厂家收回", detail: "SYLU-2026-03-001-TP-001 厂家收回", time: "2026-04-28T11:36:00+08:00" },
          ],
        },
      ],
    });

    expect(view.steps.find((step) => step.label === "到货")).toEqual(
      expect.objectContaining({ time: "2026-04-28T11:31:20+08:00" }),
    );
    expect(view.steps.find((step) => step.label === "送至暂存间")).toEqual(
      expect.objectContaining({ time: "2026-04-28T11:31:52+08:00" }),
    );
    expect(view.steps.find((step) => step.label === "厂家收回")).toEqual(
      expect.objectContaining({ time: "2026-04-28T11:36:00+08:00" }),
    );
  });

  test("buildTrayFlowView hides staging step times invalidated by a handover withdraw", () => {
    const view = buildTrayFlowView({
      trayCode: "SYLU-2026-05-001-TP-001",
      taskCode: "SYLU-2026-05-001",
      status: "送至实验室",
      experimentFlow: [
        {
          name: "盐雾试验",
          state: "current",
          routeStatus: "送至实验室",
        },
      ],
      samples: [
        {
          code: "SYLU-2026-05-001-SP-001",
          task_code: "SYLU-2026-05-001",
          location: "盐雾试验室",
          status: "送至实验室",
          trays: [
            {
              tray_code: "SYLU-2026-05-001-TP-001",
              status: "送至实验室",
              quantity: 1,
              updated_at: "2026-05-19T16:37:27+08:00",
            },
          ],
          history: [
            { action: "送至实验室", status: "送至实验室", time: "2026-05-19T16:37:27+08:00" },
            { action: "撤回出库", status: "到货", detail: "SYLU-2026-05-001-TP-001 撤回出库至到货", time: "2026-05-19T16:37:09+08:00" },
            { action: "送至暂存间", status: "送至暂存间", location: "恒温恒湿间（暂存间）", time: "2026-05-19T16:36:42+08:00" },
          ],
        },
      ],
    });

    expect(view.steps.find((step) => step.label === "送至暂存间")).toEqual(
      expect.objectContaining({ reached: true, time: "" }),
    );
    expect(view.steps.find((step) => step.label === "已到达暂存间")).toEqual(
      expect.objectContaining({ reached: true, time: "" }),
    );
    expect(view.steps.find((step) => step.label === "送至实验室")).toEqual(
      expect.objectContaining({ active: true, time: "2026-05-19T16:37:27+08:00" }),
    );
  });

  test("buildTrayFlowView hides lab dispatch times invalidated by a staging withdraw", () => {
    const view = buildTrayFlowView({
      trayCode: "SYLU-2026-05-001-TP-001",
      taskCode: "SYLU-2026-05-001",
      status: "送至实验室",
      experimentFlow: [
        {
          name: "盐雾试验",
          state: "current",
          routeStatus: "送至实验室",
        },
      ],
      samples: [
        {
          code: "SYLU-2026-05-001-SP-001",
          task_code: "SYLU-2026-05-001",
          location: "盐雾试验室",
          status: "送至实验室",
          trays: [
            {
              tray_code: "SYLU-2026-05-001-TP-001",
              status: "送至实验室",
              quantity: 1,
            },
          ],
          history: [
            { action: "撤回出库", status: "已到达暂存间", detail: "SYLU-2026-05-001-TP-001 撤回出库至已到达暂存间", time: "2026-05-19T10:05:00+08:00" },
            { action: "暂存间扫码出库", status: "送至实验室", detail: "SYLU-2026-05-001-TP-001 送至 盐雾试验室", time: "2026-05-19T10:00:00+08:00" },
            { action: "暂存间扫码入库", status: "已到达暂存间", detail: "SYLU-2026-05-001-TP-001 已到达暂存间", time: "2026-05-19T09:50:00+08:00" },
          ],
        },
      ],
    });

    expect(view.steps.find((step) => step.label === "已到达暂存间")).toEqual(
      expect.objectContaining({ reached: true, time: "2026-05-19T10:05:00+08:00" }),
    );
    expect(view.steps.find((step) => step.label === "送至实验室")).toEqual(
      expect.objectContaining({ active: true, time: "" }),
    );
  });

  test("buildTrayFlowView keeps later valid laboratory dispatch times after a staging withdraw", () => {
    const view = buildTrayFlowView({
      trayCode: "SYLU-2026-05-001-TP-001",
      taskCode: "SYLU-2026-05-001",
      status: "送至实验室",
      experimentFlow: [
        {
          name: "盐雾试验",
          state: "current",
          routeStatus: "送至实验室",
        },
      ],
      samples: [
        {
          code: "SYLU-2026-05-001-SP-001",
          task_code: "SYLU-2026-05-001",
          location: "盐雾试验室",
          status: "送至实验室",
          trays: [
            {
              tray_code: "SYLU-2026-05-001-TP-001",
              status: "送至实验室",
              quantity: 1,
            },
          ],
          history: [
            { action: "暂存间扫码出库", status: "送至实验室", detail: "SYLU-2026-05-001-TP-001 送至 盐雾试验室", time: "2026-05-19T10:10:00+08:00" },
            { action: "撤回出库", status: "已到达暂存间", detail: "SYLU-2026-05-001-TP-001 撤回出库至已到达暂存间", time: "2026-05-19T10:05:00+08:00" },
            { action: "暂存间扫码出库", status: "送至实验室", detail: "SYLU-2026-05-001-TP-001 送至 错误试验室", time: "2026-05-19T10:00:00+08:00" },
            { action: "暂存间扫码入库", status: "已到达暂存间", detail: "SYLU-2026-05-001-TP-001 已到达暂存间", time: "2026-05-19T09:50:00+08:00" },
          ],
        },
      ],
    });

    expect(view.steps.find((step) => step.label === "已到达暂存间")).toEqual(
      expect.objectContaining({ reached: true, time: "2026-05-19T10:05:00+08:00" }),
    );
    expect(view.steps.find((step) => step.label === "送至实验室")).toEqual(
      expect.objectContaining({ active: true, time: "2026-05-19T10:10:00+08:00" }),
    );
  });

  test("buildTrayFlowView hides wrong laboratory preparation times after a laboratory withdraw to handover", () => {
    const view = buildTrayFlowView({
      trayCode: "SYLU-2026-05-002-TP-001",
      taskCode: "SYLU-2026-05-002",
      location: "接驳区",
      status: "到货",
      experiments: [
        {
          task_code: "SYLU-2026-05-002",
          experiment_code: "SYLU-2026-05-002-A",
          experiment_name: "盐雾试验",
        },
      ],
      experimentTrays: [
        {
          task_code: "SYLU-2026-05-002",
          experiment_code: "SYLU-2026-05-002-A",
          tray_code: "SYLU-2026-05-002-TP-001",
        },
      ],
      samples: [
        {
          code: "SYLU-2026-05-002-SP-001",
          task_code: "SYLU-2026-05-002",
          location: "接驳区",
          status: "到货",
          trays: [{ tray_code: "SYLU-2026-05-002-TP-001", status: "到货", quantity: 1 }],
          history: [
            { action: "实验任务撤回", status: "到货", detail: "SYLU-2026-05-002 / 盐雾试验 / 撤回至到货", time: "2026-05-19T11:00:00+08:00" },
            { action: "样品安装", status: "工装夹具安装", detail: "SYLU-2026-05-002 / 盐雾试验 / 工装夹具安装", time: "2026-05-19T10:40:00+08:00" },
            { action: "任务比对", status: "已到达实验室", detail: "SYLU-2026-05-002 / 盐雾试验 / 已到达实验室", time: "2026-05-19T10:30:00+08:00" },
            { action: "送至实验室", status: "送至实验室", time: "2026-05-19T10:20:00+08:00" },
          ],
        },
      ],
    });

    expect(view.steps.find((step) => step.label === "到货")).toEqual(
      expect.objectContaining({ active: true, time: "2026-05-19T11:00:00+08:00" }),
    );
    ["送至实验室", "已到达实验室", "工装夹具安装"].forEach((label) => {
      expect(view.steps.find((step) => step.label === label)).toEqual(
        expect.objectContaining({ active: false, reached: false, time: "" }),
      );
    });
  });

  test("buildTrayFlowView restores to the previous completed experiment after a wrong next-lab withdrawal", () => {
    const view = buildTrayFlowView({
      trayCode: "SYLU-2026-05-003-TP-001",
      taskCode: "SYLU-2026-05-003",
      currentExperimentCode: "SYLU-2026-05-003-B",
      location: "盐雾试验室",
      status: "实验已完成",
      experiments: [
        {
          task_code: "SYLU-2026-05-003",
          experiment_code: "SYLU-2026-05-003-A",
          experiment_name: "盐雾试验",
        },
        {
          task_code: "SYLU-2026-05-003",
          experiment_code: "SYLU-2026-05-003-B",
          experiment_name: "高低温湿热试验",
        },
        {
          task_code: "SYLU-2026-05-003",
          experiment_code: "SYLU-2026-05-003-C",
          experiment_name: "冲击试验",
        },
      ],
      experimentTrays: [
        { task_code: "SYLU-2026-05-003", experiment_code: "SYLU-2026-05-003-A", tray_code: "SYLU-2026-05-003-TP-001" },
        { task_code: "SYLU-2026-05-003", experiment_code: "SYLU-2026-05-003-B", tray_code: "SYLU-2026-05-003-TP-001" },
        { task_code: "SYLU-2026-05-003", experiment_code: "SYLU-2026-05-003-C", tray_code: "SYLU-2026-05-003-TP-001" },
      ],
      samples: [
        {
          code: "SYLU-2026-05-003-SP-001",
          task_code: "SYLU-2026-05-003",
          location: "盐雾试验室",
          status: "实验已完成",
          trays: [{ tray_code: "SYLU-2026-05-003-TP-001", status: "实验已完成", quantity: 1 }],
          history: [
            { action: "实验任务撤回", status: "实验已完成", detail: "SYLU-2026-05-003 / 高低温湿热试验 / 撤回至盐雾试验已完成", time: "2026-05-19T12:00:00+08:00" },
            { action: "样品安装", status: "工装夹具安装", detail: "SYLU-2026-05-003 / 高低温湿热试验 / 工装夹具安装", time: "2026-05-19T11:30:00+08:00" },
            { action: "实验完成", status: "实验已完成", detail: "SYLU-2026-05-003 / 盐雾试验 / 实验已完成", time: "2026-05-19T10:00:00+08:00" },
          ],
        },
      ],
    });

    expect(view.currentStatus).toBe("当前托盘：SYLU-2026-05-003-TP-001 | 当前状态：盐雾试验已完成");
    expect(view.steps.find((step) => step.label === "盐雾试验已完成")).toEqual(
      expect.objectContaining({ active: true, time: "2026-05-19T10:00:00+08:00" }),
    );
    expect(view.steps.find((step) => step.label === "高低温湿热试验未完成")).toEqual(
      expect.objectContaining({ active: false, reached: false, time: "" }),
    );
    expect(view.steps.find((step) => step.label === "高低温湿热试验进行中")).toBeUndefined();
    ["送至实验室", "已到达实验室", "工装夹具安装", "实验准备就绪"].forEach((label) => {
      expect(view.steps.find((step) => step.label === label)).toEqual(
        expect.objectContaining({ active: false, reached: false, time: "" }),
      );
    });
  });

  test("buildTrayFlowView keeps previous experiment completion when withdrawal detail includes a reason", () => {
    const view = buildTrayFlowView({
      trayCode: "SYLU-2026-05-220-TP-001",
      taskCode: "SYLU-2026-05-220",
      currentExperimentCode: "SYLU-2026-05-220-A",
      location: "霉菌试验室",
      status: "实验已完成",
      experiments: [
        {
          task_code: "SYLU-2026-05-220",
          experiment_code: "SYLU-2026-05-220-A",
          experiment_name: "四综合试验",
        },
        {
          task_code: "SYLU-2026-05-220",
          experiment_code: "SYLU-2026-05-220-B",
          experiment_name: "霉菌试验",
        },
      ],
      experimentTrays: [
        { task_code: "SYLU-2026-05-220", experiment_code: "SYLU-2026-05-220-A", tray_code: "SYLU-2026-05-220-TP-001" },
        { task_code: "SYLU-2026-05-220", experiment_code: "SYLU-2026-05-220-B", tray_code: "SYLU-2026-05-220-TP-001" },
      ],
      schedules: [
        {
          task_code: "SYLU-2026-05-220",
          experiment_code: "SYLU-2026-05-220-A",
          device: "四综合实验室",
          start_at: "2026-05-22T08:00:00+08:00",
          end_at: "2026-05-22T12:00:00+08:00",
        },
        {
          task_code: "SYLU-2026-05-220",
          experiment_code: "SYLU-2026-05-220-B",
          device: "霉菌试验室",
          start_at: "2026-05-22T14:00:00+08:00",
          end_at: "2026-05-22T18:00:00+08:00",
        },
      ],
      samples: [
        {
          code: "SYLU-2026-05-220-SP-001",
          task_code: "SYLU-2026-05-220",
          location: "霉菌试验室",
          status: "实验已完成",
          trays: [{ tray_code: "SYLU-2026-05-220-TP-001", status: "实验已完成", quantity: 1 }],
          history: [
            {
              action: "实验任务撤回",
              status: "实验已完成",
              detail: "SYLU-2026-05-220 / 四综合试验 / 撤回至霉菌试验已完成（试验间内撤回当前实验任务）",
              time: "2026-05-22T15:00:00+08:00",
            },
            {
              action: "实验完成",
              status: "实验已完成",
              detail: "SYLU-2026-05-220 / 霉菌试验 / 实验已完成",
              time: "2026-05-22T14:30:00+08:00",
            },
          ],
        },
      ],
    });

    expect(view.currentStatus).toBe("当前托盘：SYLU-2026-05-220-TP-001 | 当前状态：霉菌试验已完成");
    expect(view.steps.find((step) => step.label === "霉菌试验已完成")).toEqual(
      expect.objectContaining({ active: true, time: "2026-05-22T14:30:00+08:00" }),
    );
    expect(view.steps.find((step) => step.label === "四综合试验已完成")).toBeUndefined();
    expect(view.steps.find((step) => step.label === "四综合试验未完成")).toEqual(
      expect.objectContaining({ active: false, reached: false, time: "" }),
    );
  });

  test("buildTrayFlowView preserves all earlier completed experiments after resetting a later shared-tray experiment", () => {
    const view = buildTrayFlowView({
      trayCode: "SYLU-2026-05-022-TP-001",
      taskCode: "SYLU-2026-05-022",
      currentExperimentCode: "SYLU-2026-05-022-C",
      location: "冲击试验室",
      status: "实验已完成",
      experiments: [
        {
          task_code: "SYLU-2026-05-022",
          experiment_code: "SYLU-2026-05-022-A",
          experiment_name: "四综合试验",
        },
        {
          task_code: "SYLU-2026-05-022",
          experiment_code: "SYLU-2026-05-022-B",
          experiment_name: "温度冲击试验",
        },
        {
          task_code: "SYLU-2026-05-022",
          experiment_code: "SYLU-2026-05-022-C",
          experiment_name: "冲击试验",
        },
      ],
      experimentTrays: [
        { task_code: "SYLU-2026-05-022", experiment_code: "SYLU-2026-05-022-A", tray_code: "SYLU-2026-05-022-TP-001" },
        { task_code: "SYLU-2026-05-022", experiment_code: "SYLU-2026-05-022-B", tray_code: "SYLU-2026-05-022-TP-001" },
        { task_code: "SYLU-2026-05-022", experiment_code: "SYLU-2026-05-022-C", tray_code: "SYLU-2026-05-022-TP-001" },
      ],
      samples: [
        {
          code: "SYLU-2026-05-022-SP-001",
          task_code: "SYLU-2026-05-022",
          location: "冲击试验室",
          status: "实验已完成",
          trays: [{ tray_code: "SYLU-2026-05-022-TP-001", status: "实验已完成", quantity: 1 }],
          history: [
            {
              action: "实验任务撤回",
              status: "实验已完成",
              detail: "SYLU-2026-05-022 / 冲击试验 / 撤回至温度冲击试验已完成（试验间内撤回当前实验任务）",
              time: "2026-05-22T14:10:00+08:00",
            },
            {
              action: "样品安装",
              status: "工装夹具安装",
              detail: "SYLU-2026-05-022 / 冲击试验 / 工装夹具安装",
              time: "2026-05-22T14:00:00+08:00",
            },
            {
              action: "实验完成",
              status: "实验已完成",
              detail: "SYLU-2026-05-022 / 温度冲击试验 / 实验已完成",
              time: "2026-05-22T13:15:59+08:00",
            },
            {
              action: "实验完成",
              status: "实验已完成",
              detail: "SYLU-2026-05-022 / 四综合试验 / 实验已完成",
              time: "2026-05-22T13:00:00+08:00",
            },
          ],
        },
      ],
    });

    expect(view.currentStatus).toBe("当前托盘：SYLU-2026-05-022-TP-001 | 当前状态：温度冲击试验已完成");
    expect(view.steps.find((step) => step.label === "四综合试验已完成")).toEqual(
      expect.objectContaining({ reached: true, time: "2026-05-22T13:00:00+08:00" }),
    );
    expect(view.steps.find((step) => step.label === "温度冲击试验已完成")).toEqual(
      expect.objectContaining({ active: true, time: "2026-05-22T13:15:59+08:00" }),
    );
    expect(view.steps.find((step) => step.label === "冲击试验已完成")).toBeUndefined();
    expect(view.steps.find((step) => step.label === "冲击试验未完成")).toEqual(
      expect.objectContaining({ active: false, reached: false, time: "" }),
    );
  });

  test("buildTrayFlowView highlights a completed current experiment instead of its running step", () => {
    const view = buildTrayFlowView({
      trayCode: "SYLU-2026-05-004-TP-001",
      taskCode: "SYLU-2026-05-004",
      currentExperimentCode: "SYLU-2026-05-004-A",
      location: "盐雾试验室",
      status: "实验已完成",
      experiments: [
        {
          task_code: "SYLU-2026-05-004",
          experiment_code: "SYLU-2026-05-004-A",
          experiment_name: "盐雾试验",
        },
        {
          task_code: "SYLU-2026-05-004",
          experiment_code: "SYLU-2026-05-004-B",
          experiment_name: "温度冲击试验",
        },
      ],
      experimentTrays: [
        { task_code: "SYLU-2026-05-004", experiment_code: "SYLU-2026-05-004-A", tray_code: "SYLU-2026-05-004-TP-001" },
        { task_code: "SYLU-2026-05-004", experiment_code: "SYLU-2026-05-004-B", tray_code: "SYLU-2026-05-004-TP-001" },
      ],
      samples: [
        {
          code: "SYLU-2026-05-004-SP-001",
          task_code: "SYLU-2026-05-004",
          location: "盐雾试验室",
          status: "实验已完成",
          trays: [{ tray_code: "SYLU-2026-05-004-TP-001", status: "实验已完成", quantity: 1 }],
          history: [],
        },
      ],
    });

    expect(view.currentStatus).toBe("当前托盘：SYLU-2026-05-004-TP-001 | 当前状态：盐雾试验已完成");
    expect(view.steps.find((step) => step.label === "盐雾试验已完成")).toEqual(
      expect.objectContaining({ active: true }),
    );
    expect(view.steps.find((step) => step.label === "盐雾试验进行中")).toBeUndefined();
    expect(view.steps.find((step) => step.label === "温度冲击试验未完成")).toEqual(
      expect.objectContaining({ active: false, reached: false, time: "" }),
    );
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

  test("buildTrayFlowView prefers explicit running experiment records over stale ready tray status", () => {
    const view = buildTrayFlowView({
      currentExperimentCode: "EXP-IMPACT",
      experimentRuns: [
        {
          task_code: "TASK-MQTT-RUN",
          experiment_code: "EXP-IMPACT",
          tray_codes: ["TP-MQTT-RUN-001"],
          status: "实验进行中",
        },
      ],
      experimentTrays: [
        { task_code: "TASK-MQTT-RUN", experiment_code: "EXP-IMPACT", tray_code: "TP-MQTT-RUN-001" },
        { task_code: "TASK-MQTT-RUN", experiment_code: "EXP-VIB", tray_code: "TP-MQTT-RUN-001" },
      ],
      experiments: [
        { task_code: "TASK-MQTT-RUN", experiment_code: "EXP-IMPACT", experiment_name: "冲击试验", status: "实验准备就绪" },
        { task_code: "TASK-MQTT-RUN", experiment_code: "EXP-VIB", experiment_name: "振动试验", status: "已排程" },
      ],
      samples: [
        {
          task_code: "TASK-MQTT-RUN",
          code: "SP-MQTT-RUN-001",
          location: "冲击一室",
          status: "实验准备就绪",
          trays: [{ tray_code: "TP-MQTT-RUN-001", status: "实验准备就绪", quantity: 1 }],
        },
      ],
      schedules: [
        { task_code: "TASK-MQTT-RUN", experiment_code: "EXP-IMPACT", device: "冲击一室", status: "实验准备就绪" },
        { task_code: "TASK-MQTT-RUN", experiment_code: "EXP-VIB", device: "振动一室", status: "已排程" },
      ],
      status: "实验准备就绪",
      taskCode: "TASK-MQTT-RUN",
      trayCode: "TP-MQTT-RUN-001",
    });

    expect(view.currentStatus).toBe("当前托盘：TP-MQTT-RUN-001 | 当前状态：冲击试验进行中");
    expect(view.steps.find((step) => step.label === "冲击试验进行中")).toEqual(
      expect.objectContaining({ active: true }),
    );
    expect(view.steps.find((step) => step.label === "实验准备就绪")).toEqual(
      expect.objectContaining({ active: false, reached: true }),
    );
  });

  test("buildTrayFlowView ignores experiment runs that do not identify the current tray", () => {
    const taskCode = "TASK-RUN-SCOPE";
    const experiments = [
      { task_code: taskCode, experiment_code: "EXP-A", experiment_name: "冲击试验", required_device: "冲击试验", status: "已排程" },
      { task_code: taskCode, experiment_code: "EXP-B", experiment_name: "温度冲击试验", required_device: "温度冲击试验", status: "已排程" },
    ];
    const experimentTrays = [
      { task_code: taskCode, experiment_code: "EXP-A", tray_code: "TP-001" },
      { task_code: taskCode, experiment_code: "EXP-A", tray_code: "TP-002" },
      { task_code: taskCode, experiment_code: "EXP-B", tray_code: "TP-001" },
      { task_code: taskCode, experiment_code: "EXP-B", tray_code: "TP-002" },
    ];
    const experimentRuns = [
      {
        task_code: taskCode,
        experiment_code: "EXP-A",
        status: "实验进行中",
        started_at: "2026-06-04T20:10:00+08:00",
      },
    ];
    const commonInput = {
      experiments,
      experimentTrays,
      experimentRuns,
      samples: [],
      schedules: [],
      status: "已到达实验室",
      taskCode,
    };

    const firstTrayView = buildTrayFlowView({ ...commonInput, trayCode: "TP-001" });
    const secondTrayView = buildTrayFlowView({ ...commonInput, trayCode: "TP-002" });

    expect(firstTrayView.currentStatus).toBe("当前托盘：TP-001 | 当前状态：已到达实验室");
    expect(secondTrayView.currentStatus).toBe("当前托盘：TP-002 | 当前状态：已到达实验室");
    expect(firstTrayView.steps.find((step) => step.label === "冲击试验进行中")?.active).not.toBe(true);
    expect(secondTrayView.steps.find((step) => step.label === "冲击试验进行中")?.active).not.toBe(true);
  });

  test("buildTrayFlowView chooses the latest matching run using run start and end times", () => {
    const taskCode = "TASK-RERUN";
    const trayCode = "TP-001";
    const view = buildTrayFlowView({
      experiments: [
        { task_code: taskCode, experiment_code: "EXP-A", experiment_name: "冲击试验", required_device: "冲击试验", status: "已排程" },
        { task_code: taskCode, experiment_code: "EXP-B", experiment_name: "温度冲击试验", required_device: "温度冲击试验", status: "已排程" },
      ],
      experimentTrays: [
        { task_code: taskCode, experiment_code: "EXP-A", tray_code: trayCode },
        { task_code: taskCode, experiment_code: "EXP-B", tray_code: trayCode },
      ],
      experimentRuns: [
        {
          run_no: "OLD-COMPLETED",
          task_code: taskCode,
          experiment_code: "EXP-A",
          tray_codes: [trayCode],
          status: "实验已完成",
          ended_at: "2026-06-04T20:00:00+08:00",
          updated_at: "2026-06-04T20:30:00+08:00",
        },
        {
          run_no: "NEW-RUNNING",
          task_code: taskCode,
          experiment_code: "EXP-A",
          tray_codes: [trayCode],
          status: "实验进行中",
          started_at: "2026-06-04T20:45:00+08:00",
        },
      ],
      samples: [],
      schedules: [],
      status: "已到达实验室",
      taskCode,
      trayCode,
    });

    expect(view.currentStatus).toBe("当前托盘：TP-001 | 当前状态：冲击试验进行中");
    expect(view.steps.find((step) => step.label === "冲击试验进行中")).toEqual(
      expect.objectContaining({ active: true, time: "2026-06-04T20:45:00+08:00" }),
    );
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

  test("buildTrayFlowView expands the next unfinished experiment route after later experiments completed out of order", () => {
    const view = buildTrayFlowView({
      trayCode: "SYLU-2026-06-003-TP-002",
      taskCode: "SYLU-2026-06-003",
      currentExperimentCode: "SYLU-2026-06-003-A",
      location: "盐雾试验室",
      status: "实验已完成",
      experiments: [
        {
          task_code: "SYLU-2026-06-003",
          experiment_code: "SYLU-2026-06-003-A",
          experiment_name: "冲击试验",
        },
        {
          task_code: "SYLU-2026-06-003",
          experiment_code: "SYLU-2026-06-003-B",
          experiment_name: "四综合试验",
        },
        {
          task_code: "SYLU-2026-06-003",
          experiment_code: "SYLU-2026-06-003-C",
          experiment_name: "盐雾试验",
        },
      ],
      experimentTrays: [
        { task_code: "SYLU-2026-06-003", experiment_code: "SYLU-2026-06-003-A", tray_code: "SYLU-2026-06-003-TP-002" },
        { task_code: "SYLU-2026-06-003", experiment_code: "SYLU-2026-06-003-B", tray_code: "SYLU-2026-06-003-TP-002" },
        { task_code: "SYLU-2026-06-003", experiment_code: "SYLU-2026-06-003-C", tray_code: "SYLU-2026-06-003-TP-002" },
      ],
      schedules: [
        {
          task_code: "SYLU-2026-06-003",
          experiment_code: "SYLU-2026-06-003-A",
          device: "冲击一室",
          start_at: "2026-06-04T08:00:00+08:00",
          end_at: "2026-06-04T11:30:00+08:00",
        },
        {
          task_code: "SYLU-2026-06-003",
          experiment_code: "SYLU-2026-06-003-B",
          device: "四综合实验室",
          start_at: "2026-06-04T08:00:00+08:00",
          end_at: "2026-06-04T11:30:00+08:00",
        },
        {
          task_code: "SYLU-2026-06-003",
          experiment_code: "SYLU-2026-06-003-C",
          device: "盐雾试验室",
          start_at: "2026-06-04T08:00:00+08:00",
          end_at: "2026-06-04T11:30:00+08:00",
        },
      ],
      samples: [
        {
          code: "SYLU-2026-06-003-SP-008",
          task_code: "SYLU-2026-06-003",
          location: "盐雾试验室",
          status: "实验已完成",
          trays: [
            {
              tray_code: "SYLU-2026-06-003-TP-002",
              status: "实验已完成",
              target_lab: "四综合实验室",
              quantity: 1,
            },
          ],
          history: [
            { action: "实验完成", detail: "SYLU-2026-06-003 / 盐雾试验 / 实验已完成", status: "实验已完成", time: "2026-06-04T00:13:04+08:00" },
            { action: "实验完成", detail: "SYLU-2026-06-003 / 四综合试验 / 实验已完成", status: "实验已完成", time: "2026-06-04T00:09:48+08:00" },
            { action: "送至实验室", location: "四综合实验室", status: "送至实验室", detail: "SYLU-2026-06-003-TP-002 -> 四综合实验室", time: "2026-06-04T00:07:24+08:00" },
          ],
        },
      ],
    });

    expect(view.currentStatus).toBe("当前托盘：SYLU-2026-06-003-TP-002 | 当前状态：送至冲击一室");
    expect(view.steps.map((step) => step.label)).toEqual([
      "样品运输中",
      "到货",
      "四综合试验已完成",
      "盐雾试验已完成",
      "送至暂存间",
      "已到达暂存间",
      "送至冲击一室",
      "已到达实验室",
      "工装夹具安装",
      "实验准备就绪",
      "冲击试验未完成",
      "放置实验后暂存间",
      "厂家收回",
    ]);
    expect(view.steps.find((step) => step.label === "送至冲击一室")).toEqual(expect.objectContaining({
      active: true,
      time: "",
    }));
    expect(view.steps.find((step) => step.label === "送至四综合实验室")).toBeUndefined();
  });

  test("buildTrayFlowView does not reuse a completed experiment target lab for the next unfinished route", () => {
    const view = buildTrayFlowView({
      trayCode: "SYLU-2026-06-002-TP-001",
      taskCode: "SYLU-2026-06-002",
      currentExperimentCode: "SYLU-2026-06-002-A",
      dispatchTargetLab: "振动一室",
      location: "振动一室",
      status: "实验已完成",
      experiments: [
        {
          task_code: "SYLU-2026-06-002",
          experiment_code: "SYLU-2026-06-002-A",
          experiment_name: "振动试验",
        },
        {
          task_code: "SYLU-2026-06-002",
          experiment_code: "SYLU-2026-06-002-B",
          experiment_name: "盐雾试验",
        },
        {
          task_code: "SYLU-2026-06-002",
          experiment_code: "SYLU-2026-06-002-C",
          experiment_name: "霉菌试验",
        },
      ],
      experimentTrays: [
        { task_code: "SYLU-2026-06-002", experiment_code: "SYLU-2026-06-002-A", tray_code: "SYLU-2026-06-002-TP-001" },
        { task_code: "SYLU-2026-06-002", experiment_code: "SYLU-2026-06-002-B", tray_code: "SYLU-2026-06-002-TP-001" },
        { task_code: "SYLU-2026-06-002", experiment_code: "SYLU-2026-06-002-C", tray_code: "SYLU-2026-06-002-TP-001" },
      ],
      schedules: [
        {
          task_code: "SYLU-2026-06-002",
          experiment_code: "SYLU-2026-06-002-A",
          device: "振动一室",
          start_at: "2026-06-04T00:00:00+08:00",
        },
        {
          task_code: "SYLU-2026-06-002",
          experiment_code: "SYLU-2026-06-002-B",
          device: "盐雾试验室",
          start_at: "2026-06-04T02:00:00+08:00",
        },
        {
          task_code: "SYLU-2026-06-002",
          experiment_code: "SYLU-2026-06-002-C",
          device: "霉菌试验室",
          start_at: "2026-06-04T04:00:00+08:00",
        },
      ],
      samples: [
        {
          code: "SYLU-2026-06-002-SP-001",
          task_code: "SYLU-2026-06-002",
          location: "振动一室",
          status: "实验已完成",
          trays: [
            {
              tray_code: "SYLU-2026-06-002-TP-001",
              status: "实验已完成",
              target_lab: "振动一室",
              quantity: 1,
            },
          ],
          history: [
            { action: "实验完成", detail: "SYLU-2026-06-002 / 振动试验 / 实验已完成", status: "实验已完成", time: "2026-06-04T01:04:34+08:00" },
            { action: "送至实验室", location: "振动一室", status: "送至实验室", detail: "SYLU-2026-06-002-TP-001 -> 振动一室", time: "2026-06-04T01:03:00+08:00" },
          ],
        },
      ],
    });

    expect(view.currentStatus).toBe("当前托盘：SYLU-2026-06-002-TP-001 | 当前状态：振动试验已完成");
    expect(view.steps.find((step) => step.label === "振动试验已完成")).toEqual(expect.objectContaining({ active: true }));
    expect(view.steps.find((step) => step.label === "送至盐雾试验室")).toEqual(
      expect.objectContaining({ active: false, reached: false }),
    );
    expect(view.steps.find((step) => step.label === "送至振动一室")).toBeUndefined();
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

  test("buildTrayFlowView does not reuse completed experiment route times for unfinished experiment steps", () => {
    const view = buildTrayFlowView({
      trayCode: "SYLU-2026-03-002-TP-001",
      taskCode: "SYLU-2026-03-002",
      location: "接驳区",
      status: "厂家收回",
      experiments: [
        {
          task_code: "SYLU-2026-03-002",
          experiment_code: "SYLU-2026-03-002-A",
          experiment_name: "盐雾试验",
        },
        {
          task_code: "SYLU-2026-03-002",
          experiment_code: "SYLU-2026-03-002-B",
          experiment_name: "四综合试验",
        },
        {
          task_code: "SYLU-2026-03-002",
          experiment_code: "SYLU-2026-03-002-C",
          experiment_name: "高低温湿热试验",
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
        {
          task_code: "SYLU-2026-03-002",
          experiment_code: "SYLU-2026-03-002-C",
          tray_code: "SYLU-2026-03-002-TP-001",
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
          code: "SYLU-2026-03-002-SP-001",
          task_code: "SYLU-2026-03-002",
          location: "接驳区",
          status: "厂家收回",
          trays: [{ tray_code: "SYLU-2026-03-002-TP-001", status: "厂家收回", quantity: 1 }],
          history: [
            { time: "2026-04-28T11:31:25+08:00", status: "送至实验室" },
            { time: "2026-04-28T11:31:54+08:00", status: "已到达实验室" },
            { time: "2026-04-28T11:31:40+08:00", status: "工装夹具安装" },
            { time: "2026-04-28T11:31:41+08:00", status: "实验准备就绪" },
            { time: "2026-04-28T11:32:12+08:00", detail: "SYLU-2026-03-002 / 盐雾试验 / 实验已完成" },
            { time: "2026-04-28T11:32:31+08:00", status: "厂家收回" },
          ],
        },
      ],
    });

    expect(view.steps.find((step) => step.label === "盐雾试验已完成")).toEqual(
      expect.objectContaining({ time: "2026-04-28T11:32:12+08:00" }),
    );
    expect(view.steps.find((step) => step.label === "四综合试验未完成")).toEqual(
      expect.objectContaining({ reached: false, time: "" }),
    );
    ["送至实验室", "已到达实验室", "工装夹具安装", "实验准备就绪"].forEach((label) => {
      expect(view.steps.find((step) => step.label === label)).toEqual(
        expect.objectContaining({ reached: false, active: false, time: "" }),
      );
    });
  });

  test("buildTrayFlowView keeps lab dispatch and arrival times scoped before the completed experiment", () => {
    const view = buildTrayFlowView({
      trayCode: "SYLU-2026-06-001-TP-001",
      taskCode: "SYLU-2026-06-001",
      location: "四综合试验室",
      status: "实验已完成",
      experimentFlow: [
        {
          destinationLab: "盐雾试验室",
          displayName: "盐雾试验",
          name: "盐雾试验",
          state: "completed",
        },
        {
          destinationLab: "四综合试验室",
          displayName: "四综合试验",
          name: "四综合试验",
          state: "completed",
        },
      ],
      samples: [
        {
          code: "SYLU-2026-06-001-SP-001",
          location: "四综合试验室",
          status: "实验已完成",
          task_code: "SYLU-2026-06-001",
          trays: [{ tray_code: "SYLU-2026-06-001-TP-001", status: "实验已完成", quantity: 1 }],
          history: [
            { time: "2026-06-03T10:00:00+08:00", detail: "SYLU-2026-06-001 / 盐雾试验 / 实验已完成" },
            { time: "2026-06-03T10:20:00+08:00", status: "送至实验室", detail: "SYLU-2026-06-001-TP-001 -> 四综合试验室" },
            { time: "2026-06-03T10:25:00+08:00", status: "已到达实验室", detail: "SYLU-2026-06-001 / 四综合试验 / 已到达实验室" },
            { time: "2026-06-03T11:00:00+08:00", detail: "SYLU-2026-06-001 / 四综合试验 / 实验已完成" },
            { time: "2026-06-03T11:20:00+08:00", status: "送至实验室", detail: "SYLU-2026-06-001-TP-001 -> 盐雾试验室" },
            { time: "2026-06-03T11:25:00+08:00", status: "已到达实验室", detail: "SYLU-2026-06-001 / 盐雾试验 / 已到达实验室" },
          ],
        },
      ],
    });

    expect(view.steps.find((step) => step.label === "送至四综合试验室")).toEqual(
      expect.objectContaining({ time: "2026-06-03T10:20:00+08:00" }),
    );
    expect(view.steps.find((step) => step.label === "已到达实验室")).toEqual(
      expect.objectContaining({ time: "2026-06-03T10:25:00+08:00" }),
    );
    expect(view.steps.find((step) => step.label === "四综合试验已完成")).toEqual(
      expect.objectContaining({ time: "2026-06-03T11:00:00+08:00" }),
    );
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

  test("buildTrayFlowView does not mark unstarted experiments as running or completed when a partially tested tray is returned", () => {
    const view = buildTrayFlowView({
      trayCode: "SYLU-2026-03-001-TP-002",
      taskCode: "SYLU-2026-03-001",
      location: "厂家收回",
      status: "厂家收回",
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
        {
          task_code: "SYLU-2026-03-001",
          experiment_code: "SYLU-2026-03-001-C",
          experiment_name: "高低温湿热试验",
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
        {
          task_code: "SYLU-2026-03-001",
          experiment_code: "SYLU-2026-03-001-C",
          tray_code: "SYLU-2026-03-001-TP-002",
        },
      ],
      samples: [
        {
          code: "SYLU-2026-03-001-SP-005",
          task_code: "SYLU-2026-03-001",
          location: "厂家收回",
          status: "厂家收回",
          trays: [{ tray_code: "SYLU-2026-03-001-TP-002", status: "厂家收回", quantity: 1 }],
          history: [
            { time: "2026-04-21T10:30:00.000Z", detail: "SYLU-2026-03-001 / 盐雾试验 / 实验已完成" },
          ],
        },
      ],
    });

    expect(view.currentStatus).toBe("当前托盘：SYLU-2026-03-001-TP-002 | 当前状态：厂家收回");
    expect(view.steps.map((step) => step.label)).toEqual([
      "样品运输中",
      "到货",
      "盐雾试验已完成",
      "送至暂存间",
      "已到达暂存间",
      "送至实验室",
      "已到达实验室",
      "工装夹具安装",
      "实验准备就绪",
      "四综合试验未完成",
      "高低温湿热试验未完成",
      "放置实验后暂存间",
      "厂家收回",
    ]);
    expect(view.steps.find((step) => step.label === "四综合试验进行中")).toBeUndefined();
    expect(view.steps.find((step) => step.label === "四综合试验未完成")).toEqual(
      expect.objectContaining({ active: false, reached: false }),
    );
    expect(view.steps.find((step) => step.label === "高低温湿热试验未完成")).toEqual(
      expect.objectContaining({ active: false, reached: false }),
    );
    expect(view.steps.find((step) => step.label === "送至实验室")).toEqual(
      expect.objectContaining({ active: false, reached: false }),
    );
    expect(view.steps.find((step) => step.label === "放置实验后暂存间")).toEqual(
      expect.objectContaining({ active: false, reached: false }),
    );
    expect(view.steps.find((step) => step.label === "厂家收回")).toEqual(
      expect.objectContaining({ active: true }),
    );
  });

  test("buildTrayFlowView keeps lab preparation steps unreached when a staging tray is returned with an explicit experiment context", () => {
    const view = buildTrayFlowView({
      trayCode: "SYLU-2026-05-021-TP-001",
      taskCode: "SYLU-2026-05-021",
      currentExperimentCode: "SYLU-2026-05-021-VIB",
      location: "厂家收回",
      status: "厂家收回",
      experiments: [
        {
          task_code: "SYLU-2026-05-021",
          experiment_code: "SYLU-2026-05-021-VIB",
          experiment_name: "振动试验",
          required_device: "振动一室",
        },
        {
          task_code: "SYLU-2026-05-021",
          experiment_code: "SYLU-2026-05-021-MOLD",
          experiment_name: "霉菌试验",
          required_device: "霉菌试验室",
        },
      ],
      experimentTrays: [
        {
          task_code: "SYLU-2026-05-021",
          experiment_code: "SYLU-2026-05-021-VIB",
          tray_code: "SYLU-2026-05-021-TP-001",
        },
        {
          task_code: "SYLU-2026-05-021",
          experiment_code: "SYLU-2026-05-021-MOLD",
          tray_code: "SYLU-2026-05-021-TP-001",
        },
      ],
      samples: [
        {
          code: "SYLU-2026-05-021-SP-001",
          task_code: "SYLU-2026-05-021",
          location: "厂家收回",
          status: "厂家收回",
          trays: [{ tray_code: "SYLU-2026-05-021-TP-001", status: "厂家收回", quantity: 1 }],
          history: [
            { time: "2026-05-30T13:21:01+08:00", status: "样品运输中" },
            { time: "2026-05-30T13:28:35+08:00", status: "送至暂存间" },
            { time: "2026-05-30T13:59:28+08:00", status: "已到达暂存间" },
            { time: "2026-05-30T13:59:33+08:00", status: "厂家收回" },
          ],
        },
      ],
    });

    expect(view.currentStatus).toBe("当前托盘：SYLU-2026-05-021-TP-001 | 当前状态：厂家收回");
    expect(view.steps.find((step) => step.label === "送至振动一室")).toEqual(
      expect.objectContaining({ active: false, reached: false }),
    );
    expect(view.steps.find((step) => step.label === "已到达实验室")).toEqual(
      expect.objectContaining({ active: false, reached: false }),
    );
    expect(view.steps.find((step) => step.label === "工装夹具安装")).toEqual(
      expect.objectContaining({ active: false, reached: false }),
    );
    expect(view.steps.find((step) => step.label === "实验准备就绪")).toEqual(
      expect.objectContaining({ active: false, reached: false }),
    );
    expect(view.steps.find((step) => step.label === "振动试验未完成")).toEqual(
      expect.objectContaining({ active: false, reached: false }),
    );
    expect(view.steps.find((step) => step.label === "厂家收回")).toEqual(
      expect.objectContaining({ active: true }),
    );
  });

  test("buildTrayFlowView does not show next experiment as running without tray-scoped runtime evidence", () => {
    const view = buildTrayFlowView({
      trayCode: "SYLU-2026-06-021-TP-005",
      taskCode: "SYLU-2026-06-021",
      location: "冲击二室",
      status: "实验进行中",
      experiments: [
        {
          task_code: "SYLU-2026-06-021",
          experiment_code: "SYLU-2026-06-021-A",
          experiment_name: "冲击试验",
          required_device: "冲击二室",
        },
        {
          task_code: "SYLU-2026-06-021",
          experiment_code: "SYLU-2026-06-021-B",
          experiment_name: "温度冲击试验",
          required_device: "温度冲击二室",
        },
        {
          task_code: "SYLU-2026-06-021",
          experiment_code: "SYLU-2026-06-021-C",
          experiment_name: "振动试验",
          required_device: "振动二室",
          status: "实验进行中",
        },
      ],
      experimentTrays: [
        { task_code: "SYLU-2026-06-021", experiment_code: "SYLU-2026-06-021-A", tray_code: "SYLU-2026-06-021-TP-005" },
        { task_code: "SYLU-2026-06-021", experiment_code: "SYLU-2026-06-021-B", tray_code: "SYLU-2026-06-021-TP-005" },
        { task_code: "SYLU-2026-06-021", experiment_code: "SYLU-2026-06-021-C", tray_code: "SYLU-2026-06-021-TP-005" },
      ],
      experimentRunTrays: [
        {
          run_no: "run-impact-005",
          task_code: "SYLU-2026-06-021",
          experiment_code: "SYLU-2026-06-021-A",
          tray_code: "SYLU-2026-06-021-TP-005",
          run_tray_status: "实验已完成",
          ended_at: "2026-06-05 17:50:53",
        },
        {
          run_no: "run-temp-005",
          task_code: "SYLU-2026-06-021",
          experiment_code: "SYLU-2026-06-021-B",
          tray_code: "SYLU-2026-06-021-TP-005",
          run_tray_status: "实验已完成",
          ended_at: "2026-06-05 16:26:11",
        },
      ],
      samples: [
        {
          code: "SYLU-2026-06-021-SP-005",
          task_code: "SYLU-2026-06-021",
          location: "冲击二室",
          status: "实验进行中",
          flow_status: "实验进行中",
          trays: [
            {
              tray_code: "SYLU-2026-06-021-TP-005",
              status: "实验进行中",
              target_experiment_code: "SYLU-2026-06-021-A",
              target_lab: "冲击二室",
              quantity: 1,
            },
          ],
          history: [],
        },
      ],
      schedules: [
        { task_code: "SYLU-2026-06-021", experiment_code: "SYLU-2026-06-021-A", device: "冲击二室" },
        { task_code: "SYLU-2026-06-021", experiment_code: "SYLU-2026-06-021-B", device: "温度冲击二室" },
        { task_code: "SYLU-2026-06-021", experiment_code: "SYLU-2026-06-021-C", device: "振动二室", status: "实验进行中" },
      ],
    });

    expect(view.currentStatus).not.toContain("振动试验进行中");
    expect(view.steps.find((step) => step.label === "振动试验未完成")).toEqual(
      expect.objectContaining({ active: true }),
    );
  });

  test("buildTrayFlowView ignores stale next-experiment runtime after the tray is returned by manufacturer", () => {
    const taskCode = "SYLU-2026-06-021";
    const trayCode = `${taskCode}-TP-002`;
    const view = buildTrayFlowView({
      trayCode,
      taskCode,
      location: "厂家收回",
      status: "厂家收回",
      experiments: [
        { task_code: taskCode, experiment_code: `${taskCode}-A`, experiment_name: "冲击试验", required_device: "冲击二室" },
        { task_code: taskCode, experiment_code: `${taskCode}-B`, experiment_name: "温度冲击试验", required_device: "温度冲击二室" },
        { task_code: taskCode, experiment_code: `${taskCode}-C`, experiment_name: "振动试验", required_device: "振动二室" },
      ],
      experimentTrays: [
        { task_code: taskCode, experiment_code: `${taskCode}-A`, tray_code: trayCode },
        { task_code: taskCode, experiment_code: `${taskCode}-B`, tray_code: trayCode },
        { task_code: taskCode, experiment_code: `${taskCode}-C`, tray_code: trayCode },
      ],
      experimentRunTrays: [
        {
          run_no: "run-impact-002",
          task_code: taskCode,
          experiment_code: `${taskCode}-A`,
          tray_code: trayCode,
          run_tray_status: "实验已完成",
          ended_at: "2026-06-06 12:57:55",
        },
        {
          run_no: "run-temp-stale-002",
          task_code: taskCode,
          experiment_code: `${taskCode}-B`,
          tray_code: trayCode,
          run_tray_status: "实验进行中",
          started_at: "2026-06-06 12:58:20",
        },
      ],
      samples: [
        {
          code: `${taskCode}-SP-002`,
          task_code: taskCode,
          location: "厂家收回",
          status: "厂家收回",
          trays: [{ tray_code: trayCode, status: "厂家收回", quantity: 1 }],
          history: [
            { time: "2026-06-06 12:57:55", detail: `${taskCode} / 冲击试验 / 实验已完成` },
            { time: "2026-06-06 12:58:10", status: "已到达暂存间", action: "放置实验后暂存间" },
            { time: "2026-06-06 12:58:34", status: "厂家收回" },
          ],
        },
      ],
      schedules: [
        { task_code: taskCode, experiment_code: `${taskCode}-A`, device: "冲击二室" },
        { task_code: taskCode, experiment_code: `${taskCode}-B`, device: "温度冲击二室" },
        { task_code: taskCode, experiment_code: `${taskCode}-C`, device: "振动二室" },
      ],
    });

    expect(view.currentStatus).toBe(`当前托盘：${trayCode} | 当前状态：厂家收回`);
    expect(view.steps.some((step) => step.label === "温度冲击试验进行中")).toBe(false);
    expect(view.steps.find((step) => step.label === "厂家收回")).toEqual(
      expect.objectContaining({ active: true }),
    );
  });

  test("buildTrayFlowView does not treat returned future-experiment runtime as in-progress history", () => {
    const taskCode = "SYLU-2026-06-021";
    const trayCode = `${taskCode}-TP-001`;
    const view = buildTrayFlowView({
      trayCode,
      taskCode,
      location: "厂家收回",
      status: "厂家收回",
      experiments: [
        { task_code: taskCode, experiment_code: `${taskCode}-A`, experiment_name: "冲击试验", required_device: "冲击二室" },
        { task_code: taskCode, experiment_code: `${taskCode}-B`, experiment_name: "温度冲击试验", required_device: "温度冲击二室" },
        { task_code: taskCode, experiment_code: `${taskCode}-C`, experiment_name: "振动试验", required_device: "振动二室" },
      ],
      experimentTrays: [
        { task_code: taskCode, experiment_code: `${taskCode}-A`, tray_code: trayCode },
        { task_code: taskCode, experiment_code: `${taskCode}-B`, tray_code: trayCode },
        { task_code: taskCode, experiment_code: `${taskCode}-C`, tray_code: trayCode },
      ],
      experimentRunTrays: [
        {
          run_no: "run-impact-001",
          task_code: taskCode,
          experiment_code: `${taskCode}-A`,
          tray_code: trayCode,
          run_tray_status: "实验已完成",
          ended_at: "2026-06-06 13:18:06",
        },
        {
          run_no: `RETURNED-${taskCode}-B`,
          task_code: taskCode,
          experiment_code: `${taskCode}-B`,
          tray_code: trayCode,
          run_tray_status: "厂家收回",
          ended_at: "2026-06-06 13:18:16",
        },
      ],
      samples: [
        {
          code: `${taskCode}-SP-001`,
          task_code: taskCode,
          location: "厂家收回",
          status: "厂家收回",
          trays: [{ tray_code: trayCode, status: "厂家收回", quantity: 1 }],
          history: [
            { time: "2026-06-06 13:18:06", detail: `${taskCode} / 冲击试验 / 实验已完成` },
            { time: "2026-06-06 13:18:13", status: "已到达暂存间", action: "放置实验后暂存间" },
            { time: "2026-06-06 13:18:16", status: "厂家收回" },
          ],
        },
      ],
      schedules: [
        { task_code: taskCode, experiment_code: `${taskCode}-A`, device: "冲击二室" },
        { task_code: taskCode, experiment_code: `${taskCode}-B`, device: "温度冲击二室" },
        { task_code: taskCode, experiment_code: `${taskCode}-C`, device: "振动二室" },
      ],
    });

    expect(view.currentStatus).toBe(`当前托盘：${trayCode} | 当前状态：厂家收回`);
    expect(view.steps.some((step) => step.label === "温度冲击试验进行中")).toBe(false);
    expect(view.steps.some((step) => step.label === "冲击试验已完成")).toBe(true);
  });

  test("buildTrayFlowView keeps a never-tested returned tray from showing the first experiment as running", () => {
    const taskCode = "SYLU-2026-06-021";
    const trayCode = `${taskCode}-TP-002`;
    const view = buildTrayFlowView({
      trayCode,
      taskCode,
      location: "厂家收回",
      status: "厂家收回",
      experiments: [
        { task_code: taskCode, experiment_code: `${taskCode}-A`, experiment_name: "冲击试验", required_device: "冲击二室" },
        { task_code: taskCode, experiment_code: `${taskCode}-B`, experiment_name: "温度冲击试验", required_device: "温度冲击二室" },
        { task_code: taskCode, experiment_code: `${taskCode}-C`, experiment_name: "振动试验", required_device: "振动二室" },
      ],
      experimentTrays: [
        { task_code: taskCode, experiment_code: `${taskCode}-A`, tray_code: trayCode },
        { task_code: taskCode, experiment_code: `${taskCode}-B`, tray_code: trayCode },
        { task_code: taskCode, experiment_code: `${taskCode}-C`, tray_code: trayCode },
      ],
      experimentRunTrays: [
        {
          run_no: `RETURNED-${taskCode}-A`,
          task_code: taskCode,
          experiment_code: `${taskCode}-A`,
          tray_code: trayCode,
          run_tray_status: "厂家收回",
          ended_at: "2026-06-06 13:17:08",
        },
      ],
      samples: [
        {
          code: `${taskCode}-SP-002`,
          task_code: taskCode,
          location: "厂家收回",
          status: "厂家收回",
          trays: [{ tray_code: trayCode, status: "厂家收回", quantity: 1 }],
          history: [
            { time: "2026-06-06 13:16:51", status: "已到达暂存间" },
            { time: "2026-06-06 13:17:08", status: "厂家收回" },
          ],
        },
      ],
      schedules: [
        { task_code: taskCode, experiment_code: `${taskCode}-A`, device: "冲击二室" },
        { task_code: taskCode, experiment_code: `${taskCode}-B`, device: "温度冲击二室" },
        { task_code: taskCode, experiment_code: `${taskCode}-C`, device: "振动二室" },
      ],
    });

    expect(view.currentStatus).toBe(`当前托盘：${trayCode} | 当前状态：厂家收回`);
    expect(view.steps.some((step) => step.label === "冲击试验进行中")).toBe(false);
    expect(view.steps.some((step) => step.label === "温度冲击试验进行中")).toBe(false);
  });

  test("buildTrayFlowView derives returned status from tray history when top-level history status is stale", () => {
    const taskCode = "SYLU-2026-06-021";
    const trayCode = `${taskCode}-TP-002`;
    const view = buildTrayFlowView({
      trayCode,
      taskCode,
      location: "冲击二室",
      status: "实验进行中",
      experiments: [
        { task_code: taskCode, experiment_code: `${taskCode}-A`, experiment_name: "冲击试验", required_device: "冲击二室" },
        { task_code: taskCode, experiment_code: `${taskCode}-B`, experiment_name: "温度冲击试验", required_device: "温度冲击二室" },
      ],
      experimentTrays: [
        { task_code: taskCode, experiment_code: `${taskCode}-A`, tray_code: trayCode },
        { task_code: taskCode, experiment_code: `${taskCode}-B`, tray_code: trayCode },
      ],
      experimentRunTrays: [
        {
          run_no: "stale-impact-run",
          task_code: taskCode,
          experiment_code: `${taskCode}-A`,
          tray_code: trayCode,
          run_tray_status: "实验进行中",
          started_at: "2026-06-06 13:17:02",
        },
      ],
      samples: [
        {
          code: `${taskCode}-SP-002`,
          task_code: taskCode,
          location: "冲击二室",
          status: "实验进行中",
          trays: [{ trayCode, status: "实验进行中" }],
          history: [
            { time: "2026-06-06 13:16:51", status: "已到达暂存间", detail: `${trayCode} 已到达暂存间` },
            { time: "2026-06-06 13:17:08", status: "厂家收回", detail: `${trayCode} 厂家收回` },
          ],
        },
      ],
      schedules: [
        { task_code: taskCode, experiment_code: `${taskCode}-A`, device: "冲击二室" },
        { task_code: taskCode, experiment_code: `${taskCode}-B`, device: "温度冲击二室" },
      ],
    });

    expect(view.currentStatus).toBe(`当前托盘：${trayCode} | 当前状态：厂家收回`);
    expect(view.steps.some((step) => step.label === "冲击试验进行中")).toBe(false);
  });

  test("buildTrayFlowView keeps single-experiment lab and completion steps unreached when a returned tray never completed that experiment", () => {
    const view = buildTrayFlowView({
      trayCode: "SYLU-2026-03-001-TP-001",
      taskCode: "SYLU-2026-03-001",
      location: "厂家收回",
      status: "厂家收回",
      experiments: [
        {
          task_code: "SYLU-2026-03-001",
          experiment_code: "SYLU-2026-03-001-B",
          experiment_name: "四综合试验",
        },
      ],
      experimentTrays: [
        {
          task_code: "SYLU-2026-03-001",
          experiment_code: "SYLU-2026-03-001-B",
          tray_code: "SYLU-2026-03-001-TP-001",
        },
      ],
      samples: [
        {
          code: "SYLU-2026-03-001-SP-001",
          task_code: "SYLU-2026-03-001",
          location: "厂家收回",
          status: "厂家收回",
          trays: [{ tray_code: "SYLU-2026-03-001-TP-001", status: "厂家收回", quantity: 1 }],
          history: [
            { time: "2026-04-21T09:00:00.000Z", detail: "SYLU-2026-03-001-TP-001 已到达暂存间" },
            { time: "2026-04-21T12:00:00.000Z", detail: "SYLU-2026-03-001-TP-001 厂家收回" },
          ],
        },
      ],
    });

    expect(view.currentStatus).toBe("当前托盘：SYLU-2026-03-001-TP-001 | 当前状态：厂家收回");
    expect(view.steps.map((step) => step.label)).toEqual([
      "样品运输中",
      "到货",
      "送至暂存间",
      "已到达暂存间",
      "送至实验室",
      "已到达实验室",
      "工装夹具安装",
      "实验准备就绪",
      "四综合试验进行中",
      "四综合试验已完成",
      "放置实验后暂存间",
      "厂家收回",
    ]);
    expect(view.steps.find((step) => step.label === "已到达暂存间")).toEqual(
      expect.objectContaining({ reached: true, time: "2026-04-21T09:00:00.000Z" }),
    );
    expect(view.steps.find((step) => step.label === "送至实验室")).toEqual(
      expect.objectContaining({ active: false, reached: false }),
    );
    expect(view.steps.find((step) => step.label === "四综合试验进行中")).toEqual(
      expect.objectContaining({ active: false, reached: false }),
    );
    expect(view.steps.find((step) => step.label === "四综合试验已完成")).toEqual(
      expect.objectContaining({ active: false, reached: false }),
    );
    expect(view.steps.find((step) => step.label === "放置实验后暂存间")).toEqual(
      expect.objectContaining({ active: false, reached: false }),
    );
    expect(view.steps.find((step) => step.label === "厂家收回")).toEqual(
      expect.objectContaining({ active: true }),
    );
  });

  test("buildTrayFlowView does not copy post-test staging time to pre-test staging when tray skipped pre-staging", () => {
    const view = buildTrayFlowView({
      trayCode: "SYLU-2026-05-001-TP-001",
      taskCode: "SYLU-2026-05-001",
      location: "厂家收回",
      status: "厂家收回",
      experiments: [
        {
          task_code: "SYLU-2026-05-001",
          experiment_code: "SYLU-2026-05-001-A",
          experiment_type: "盐雾试验",
        },
      ],
      experimentTrays: [
        {
          task_code: "SYLU-2026-05-001",
          experiment_code: "SYLU-2026-05-001-A",
          tray_code: "SYLU-2026-05-001-TP-001",
        },
      ],
      samples: [
        {
          code: "SYLU-2026-05-001-SP-001",
          task_code: "SYLU-2026-05-001",
          location: "恒温恒湿间（实验后暂存间）",
          status: "厂家收回",
          trays: [
            {
              tray_code: "SYLU-2026-05-001-TP-001",
              status: "已到达暂存间",
              quantity: 1,
              updated_at: "2026-05-16T13:50:15+08:00",
            },
          ],
          history: [
            { time: "2026-05-16T13:30:04+08:00", status: "送至实验室" },
            { time: "2026-05-16T13:49:47+08:00", status: "已到达实验室" },
            { time: "2026-05-16T13:49:54+08:00", detail: "SYLU-2026-05-001 / 盐雾试验 / 实验已完成" },
            {
              time: "2026-05-16T13:50:15+08:00",
              location: "恒温恒湿间（实验后暂存间）",
              status: "已到达暂存间",
              action: "放置实验后暂存间",
            },
            { time: "2026-05-16T13:50:19+08:00", status: "厂家收回" },
          ],
        },
      ],
    });

    expect(view.steps.find((step) => step.label === "已到达暂存间")).toEqual(
      expect.objectContaining({ reached: true, time: "" }),
    );
    expect(view.steps.find((step) => step.label === "放置实验后暂存间")).toEqual(
      expect.objectContaining({ reached: true, time: "2026-05-16T13:50:15+08:00" }),
    );
  });

  test("buildTrayFlowView does not reuse first pre-staging time after a completed experiment when moving to the next lab", () => {
    const view = buildTrayFlowView({
      trayCode: "SYLU-2026-05-002-TP-001",
      taskCode: "SYLU-2026-05-002",
      currentExperimentCode: "SYLU-2026-05-002-B",
      location: "温度冲击一室",
      status: "送至实验室",
      experiments: [
        {
          task_code: "SYLU-2026-05-002",
          experiment_code: "SYLU-2026-05-002-A",
          experiment_name: "盐雾试验",
        },
        {
          task_code: "SYLU-2026-05-002",
          experiment_code: "SYLU-2026-05-002-B",
          experiment_name: "温度冲击试验",
        },
      ],
      experimentTrays: [
        {
          task_code: "SYLU-2026-05-002",
          experiment_code: "SYLU-2026-05-002-A",
          tray_code: "SYLU-2026-05-002-TP-001",
        },
        {
          task_code: "SYLU-2026-05-002",
          experiment_code: "SYLU-2026-05-002-B",
          tray_code: "SYLU-2026-05-002-TP-001",
        },
      ],
      schedules: [
        {
          task_code: "SYLU-2026-05-002",
          experiment_code: "SYLU-2026-05-002-A",
          start_at: "2026-05-22T08:00:00",
        },
        {
          task_code: "SYLU-2026-05-002",
          experiment_code: "SYLU-2026-05-002-B",
          start_at: "2026-05-22T14:00:00",
        },
      ],
      samples: [
        {
          code: "SYLU-2026-05-002-SP-001",
          task_code: "SYLU-2026-05-002",
          location: "温度冲击一室",
          status: "送至实验室",
          trays: [{ tray_code: "SYLU-2026-05-002-TP-001", status: "送至实验室", quantity: 1 }],
          history: [
            {
              time: "2026-05-22T08:10:00+08:00",
              location: "恒温恒湿间（暂存间）",
              status: "已到达暂存间",
              action: "暂存间扫码入库",
            },
            { time: "2026-05-22T08:20:00+08:00", status: "送至实验室", action: "暂存间扫码出库" },
            { time: "2026-05-22T08:30:00+08:00", status: "已到达实验室" },
            { time: "2026-05-22T10:30:00+08:00", detail: "SYLU-2026-05-002 / 盐雾试验 / 实验已完成" },
            { time: "2026-05-22T11:00:00+08:00", status: "送至实验室" },
          ],
        },
      ],
    });

    expect(view.steps.find((step) => step.label === "盐雾试验已完成")).toEqual(
      expect.objectContaining({ time: "2026-05-22T10:30:00+08:00" }),
    );
    expect(view.steps.find((step) => step.label === "已到达暂存间")).toEqual(
      expect.objectContaining({ time: "" }),
    );
    expect(view.steps.find((step) => step.label === "送至实验室")).toEqual(
      expect.objectContaining({ active: true, time: "2026-05-22T11:00:00+08:00" }),
    );
  });

  test("buildTrayFlowView does not copy final post-test staging time to the last experiment pre-staging steps", () => {
    const view = buildTrayFlowView({
      trayCode: "SYLU-2026-05-024-TP-001",
      taskCode: "SYLU-2026-05-024",
      location: "厂家收回",
      status: "厂家收回",
      experiments: [
        {
          task_code: "SYLU-2026-05-024",
          experiment_code: "SYLU-2026-05-024-A",
          experiment_name: "霉菌试验",
        },
        {
          task_code: "SYLU-2026-05-024",
          experiment_code: "SYLU-2026-05-024-B",
          experiment_name: "高低温湿热试验",
        },
        {
          task_code: "SYLU-2026-05-024",
          experiment_code: "SYLU-2026-05-024-C",
          experiment_name: "冲击试验",
        },
      ],
      experimentTrays: [
        { task_code: "SYLU-2026-05-024", experiment_code: "SYLU-2026-05-024-A", tray_code: "SYLU-2026-05-024-TP-001" },
        { task_code: "SYLU-2026-05-024", experiment_code: "SYLU-2026-05-024-B", tray_code: "SYLU-2026-05-024-TP-001" },
        { task_code: "SYLU-2026-05-024", experiment_code: "SYLU-2026-05-024-C", tray_code: "SYLU-2026-05-024-TP-001" },
      ],
      samples: [
        {
          code: "SYLU-2026-05-024-SP-001",
          task_code: "SYLU-2026-05-024",
          location: "厂家收回",
          status: "厂家收回",
          trays: [{ tray_code: "SYLU-2026-05-024-TP-001", status: "厂家收回", quantity: 1 }],
          history: [
            { time: "2026-05-21T13:49:30+08:00", detail: "SYLU-2026-05-024 / 霉菌试验 / 实验已完成" },
            { time: "2026-05-21T13:52:25+08:00", detail: "SYLU-2026-05-024 / 高低温湿热试验 / 实验已完成" },
            { time: "2026-05-21T13:52:59+08:00", status: "已到达实验室" },
            { time: "2026-05-21T13:53:08+08:00", detail: "SYLU-2026-05-024 / 冲击试验 / 实验已完成" },
            {
              time: "2026-05-21T13:53:36+08:00",
              status: "已到达暂存间",
              action: "放置实验后暂存间",
            },
            { time: "2026-05-21T13:53:39+08:00", status: "厂家收回" },
          ],
        },
      ],
    });

    expect(view.steps.find((step) => step.label === "已到达暂存间")).toEqual(
      expect.objectContaining({ time: "" }),
    );
    expect(view.steps.find((step) => step.label === "放置实验后暂存间")).toEqual(
      expect.objectContaining({ reached: true, time: "2026-05-21T13:53:36+08:00" }),
    );
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
        {
          code: "SP-002",
          task_code: "SZH-2",
          status: "到货",
          location: "接驳区",
          owner: "张三",
          trays: [{ tray_code: "TP-002", status: "到货", quantity: 1 }],
        },
        {
          code: "SP-001",
          task_code: "SZH-1",
          status: "已到达实验室",
          location: "振动一室",
          owner: "李四",
          trays: [{ tray_code: "TP-001", status: "已到达实验室", quantity: 1 }],
        },
      ],
      filters: { query: "SP-00", taskCode: "", status: "" },
      sort: { key: "code", direction: "asc" },
      page: 1,
      pageSize: 8,
    });

    expect(view.rows).toHaveLength(2);
    expect(view.rows[0].code).toBe("SP-001");
    expect(view.rows[1].code).toBe("SP-002");
    expect(view.rows[0].trayCodesText).toBe("TP-001");
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

  test("buildSamplesStagingView returns current pre and post retention samples for read-only viewing", () => {
    const view = buildSamplesStagingView({
      samples: [
        {
          code: "SP-001",
          task_code: "SZH-1",
          location: "恒温恒湿间（暂存间）",
          status: "已到达暂存间",
          owner: "张三",
          trays: [{ tray_code: "TP-001", quantity: 1 }],
        },
        {
          code: "SP-002",
          task_code: "SZH-1",
          location: "恒温恒湿间（实验后暂存间）",
          status: "放置实验后暂存间",
          owner: "李四",
          trays: [{ tray_code: "TP-002", quantity: 1 }],
        },
        { code: "SP-003", task_code: "SZH-1", location: "振动一室", status: "已到达实验室", owner: "李四" },
      ],
      query: "",
      selectedCodes: ["SP-001"],
    });

    expect(view.rows.map((row) => row.code)).toEqual(["SP-001", "SP-002"]);
    expect(view.rows[0].trayCodesText).toBe("TP-001");
    expect(view.rows[1].trayCodesText).toBe("TP-002");
  });

  test("buildSamplesStagingView filters staging samples by task and status with pagination", () => {
    const view = buildSamplesStagingView({
      samples: [
        {
          code: "SP-001",
          task_code: "TASK-A",
          location: "恒温恒湿间（暂存间）",
          status: "已到达暂存间",
          trays: [{ tray_code: "TP-001", quantity: 1 }],
        },
        {
          code: "SP-002",
          task_code: "TASK-A",
          location: "恒温恒湿间（实验后暂存间）",
          status: "放置实验后暂存间",
          trays: [{ tray_code: "TP-002", quantity: 1 }],
        },
        {
          code: "SP-003",
          task_code: "TASK-B",
          location: "恒温恒湿间（暂存间）",
          status: "已到达暂存间",
          trays: [{ tray_code: "TP-003", quantity: 1 }],
        },
      ],
      filters: { taskCode: "TASK-A", status: "已到达暂存间" },
      page: 1,
      pageSize: 1,
    });

    expect(view.rows.map((row) => row.code)).toEqual(["SP-001"]);
    expect(view.count).toBe(1);
    expect(view.totalCount).toBe(1);
    expect(view.totalPages).toBe(1);
    expect(view.currentPage).toBe(1);
    expect(view.taskOptions).toEqual(["TASK-A", "TASK-B"]);
    expect(view.statusOptions).toEqual(["放置实验后暂存间", "已到达暂存间"]);
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

  test("buildSamplesTrayOverviewView excludes returned trays from active tray management", () => {
    const view = buildSamplesTrayOverviewView({
      tasks: [
        { code: "TASK-RETURNED", name: "已收回任务", test_type: "盐雾试验" },
        { code: "TASK-ACTIVE", name: "活跃任务", test_type: "振动试验" },
      ],
      samples: [
        {
          code: "SP-001",
          task_code: "TASK-RETURNED",
          status: "厂家收回",
          trays: [{ tray_code: "TP-RETURNED", status: "厂家收回", quantity: 1 }],
        },
        {
          code: "SP-002",
          task_code: "TASK-ACTIVE",
          status: "已入库",
          trays: [{ tray_code: "TP-ACTIVE", status: "已入库", quantity: 1 }],
        },
      ],
    });

    expect(view.rows.map((row) => row.trayCode)).toEqual(["TP-ACTIVE"]);
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
