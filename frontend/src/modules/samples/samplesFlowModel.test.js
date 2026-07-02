import { afterEach, describe, expect, test } from "vitest";

import * as samplesFlowModelPublicApi from "./samplesFlowModel";
import {
  DETAIL_STATUS_OPTIONS as DETAIL_STATUS_OPTIONS_FROM_CONSTANTS,
  SAMPLE_FLOW_STEPS as SAMPLE_FLOW_STEPS_FROM_CONSTANTS,
  TEST_LAB_OPTIONS,
  TRAY_STATUS_OPTIONS as TRAY_STATUS_OPTIONS_FROM_CONSTANTS,
} from "./sampleFlow.constants";
import {
  normalizeLifecycleStatus as normalizeLifecycleStatusFromStatus,
  normalizeSamplesSnapshot as normalizeSamplesSnapshotFromStatus,
  resolveFlowStatusByLocation as resolveFlowStatusByLocationFromStatus,
  syncTrayStatusToSampleStatus as syncTrayStatusToSampleStatusFromStatus,
} from "./sampleFlow.status";
import { parseExperimentHistoryDetail } from "./sampleFlow.experimentHelpers";
import { getSampleTrayList as getSampleTrayListFromTrayScope } from "./sampleFlow.trayScope";
import {
  dispatchStagingSamples as dispatchStagingSamplesFromCommands,
  submitSamplesBatchIntake as submitSamplesBatchIntakeFromCommands,
  updateSampleDetail as updateSampleDetailFromCommands,
  updateTrayStatus as updateTrayStatusFromCommands,
} from "./sampleFlow.commands";
import {
  buildTrayFlowView as buildTrayFlowViewRaw,
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
import { getLegacyFallbackHits, resetLegacyFallbackHits } from "@/lib/legacyFallback";

const normalizeText = (value) => String(value ?? "").trim();
const asArray = (value) => (Array.isArray(value) ? value : []);

const historyEntryMatchesTaskExperimentDetail = (entry, taskCode) => {
  const segments = normalizeText(entry?.detail)
    .split(" / ")
    .map(normalizeText)
    .filter(Boolean);
  return segments.length >= 3 && segments[0] === normalizeText(taskCode);
};

const scopeSingleTrayHistoryEntries = (samples = []) => {
  const knownTrayCodes = new Set(
    asArray(samples)
      .flatMap((sample) => asArray(sample?.trays))
      .map((tray) => normalizeText(tray?.tray_code || tray?.trayCode || tray?.tray_no || tray?.trayNo))
      .filter(Boolean),
  );
  return asArray(samples).map((sample) => {
    const trayCodes = asArray(sample?.trays)
      .map((tray) => normalizeText(tray?.tray_code || tray?.trayCode || tray?.tray_no || tray?.trayNo))
      .filter(Boolean);
    const uniqueTrayCodes = Array.from(new Set(trayCodes));
    if (uniqueTrayCodes.length !== 1) {
      return sample;
    }
    const [trayCode] = uniqueTrayCodes;
    const taskCode = normalizeText(sample?.task_code || sample?.taskCode || sample?.task_no || sample?.taskNo);
    return {
      ...sample,
      history: asArray(sample?.history).map((entry) => {
        if (
          normalizeText(entry?.tray_code || entry?.trayCode || entry?.tray_no || entry?.trayNo)
          || asArray(entry?.tray_codes || entry?.trayCodes).length > 0
          || !historyEntryMatchesTaskExperimentDetail(entry, taskCode)
        ) {
          return entry;
        }
        const detail = normalizeText(entry?.detail);
        const mentionsOtherTray = Array.from(knownTrayCodes).some((knownTrayCode) => knownTrayCode !== trayCode && detail.includes(knownTrayCode));
        return mentionsOtherTray ? entry : { ...entry, tray_code: trayCode };
      }),
    };
  });
};

const buildTrayFlowView = (input = {}) => buildTrayFlowViewRaw({
  ...input,
  samples: scopeSingleTrayHistoryEntries(input.samples),
});

describe("samplesFlowModel", () => {
  afterEach(() => {
    resetLegacyFallbackHits();
  });

  test("parseExperimentHistoryDetail extracts standard tray scope segment", () => {
    const taskCode = "SYLU-2026-07-001";
    const trayCode = `${taskCode}-TP-001`;

    expect(
      parseExperimentHistoryDetail(`${taskCode} / 冲击试验 / 已到达实验室 / 托盘：${trayCode}`, taskCode),
    ).toEqual({
      experimentName: "冲击试验",
      status: "已到达实验室",
      trayCode,
      trayCodes: [trayCode],
    });
  });

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
      "实验后暂存间存放",
      "厂家收回",
    ]);
    expect(view.steps.find((step) => step.key === "sent_to_lab")).toEqual(expect.objectContaining({ active: true }));
  });

  test("sample flow lab options include both high humid rooms", () => {
    expect(TEST_LAB_OPTIONS).toEqual(expect.arrayContaining(["高低温湿热一室", "高低温湿热二室"]));
  });

  test("buildTrayFlowView shows post-experiment staging dispatch as regular staging dispatch", () => {
    const taskCode = "SYLU-2026-06-029";
    const trayCode = `${taskCode}-TP-001`;
    const view = buildTrayFlowView({
      trayCode,
      taskCode,
      location: "恒温恒湿间（暂存间）",
      status: "送至暂存间",
      experiments: [
        {
          task_code: taskCode,
          experiment_code: `${taskCode}-A`,
          experiment_name: "霉菌试验",
          required_device: "霉菌试验室",
        },
      ],
      experimentTrays: [
        { task_code: taskCode, experiment_code: `${taskCode}-A`, tray_code: trayCode },
      ],
      experimentRunTrays: [
        {
          task_code: taskCode,
          experiment_code: `${taskCode}-A`,
          tray_code: trayCode,
          run_tray_status: "实验已完成",
          ended_at: "2026-06-14 18:10:00",
        },
      ],
      samples: [
        {
          code: `${taskCode}-SP-001`,
          task_code: taskCode,
          location: "恒温恒湿间（暂存间）",
          status: "送至暂存间",
          trays: [{ tray_code: trayCode, status: "送至暂存间", quantity: 1 }],
          history: [
            {
              action: "外观检测间扫码出库",
              detail: `${trayCode} 送至 恒温恒湿间（暂存间）`,
              location: "恒温恒湿间（暂存间）",
              status: "送至暂存间",
              time: "2026-06-14 18:17:17",
              tray_code: trayCode,
            },
            {
              action: "外观检测间扫码入库",
              detail: `${trayCode} 实验后外观检测间存放`,
              location: "外观检测间",
              status: "实验后外观检测间存放",
              time: "2026-06-14 18:16:00",
              tray_code: trayCode,
            },
            {
              action: "实验完成",
              detail: `${taskCode} / 霉菌试验 / 实验已完成`,
              location: "霉菌试验室",
              status: "实验已完成",
              time: "2026-06-14 18:10:00",
              tray_code: trayCode,
            },
          ],
        },
      ],
    });

    expect(view.currentStatus).toBe(`当前托盘：${trayCode} | 当前状态：送至暂存间`);
    expect(view.steps.find((step) => step.label === "送至暂存间")).toEqual(
      expect.objectContaining({ active: true, time: "2026-06-14 18:17:17" }),
    );
    expect(view.steps.find((step) => step.label === "已到达暂存间")).toEqual(
      expect.objectContaining({ active: false, reached: false, time: "" }),
    );
  });

  test("buildTrayFlowView shows optional appearance storage after salt or mold completion without a dispatch step", () => {
    const view = buildTrayFlowView({
      trayCode: "SYLU-2026-03-001-TP-004",
      taskCode: "SYLU-2026-03-001",
      location: "外观检测间",
      status: "实验后外观检测间存放",
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
      experimentRunTrays: [
        {
          task_code: "SYLU-2026-03-001",
          experiment_code: "SYLU-2026-03-001-A",
          tray_code: "SYLU-2026-03-001-TP-004",
          run_tray_status: "实验已完成",
          ended_at: "2026-06-06T10:00:00+08:00",
        },
      ],
    });

    expect(view.currentStatus).toBe("当前托盘：SYLU-2026-03-001-TP-004 | 当前状态：实验后外观检测间存放");
    expect(view.steps.map((step) => step.label)).not.toContain("送至外观检测间");
    expect(view.steps.find((step) => step.label === "实验后外观检测间存放")).toEqual(expect.objectContaining({ active: true }));
    expect(view.steps.find((step) => step.label === "盐雾试验已完成")).toEqual(expect.objectContaining({ reached: true }));
  });

  test("buildTrayFlowView keeps salt completion neutral before appearance stock-in choice", () => {
    const view = buildTrayFlowView({
      trayCode: "SYLU-2026-03-011-TP-001",
      taskCode: "SYLU-2026-03-011",
      location: "盐雾试验室",
      status: "实验已完成",
      experiments: [
        {
          task_code: "SYLU-2026-03-011",
          experiment_code: "SYLU-2026-03-011-A",
          experiment_type: "盐雾试验",
        },
      ],
      experimentTrays: [
        {
          task_code: "SYLU-2026-03-011",
          experiment_code: "SYLU-2026-03-011-A",
          tray_code: "SYLU-2026-03-011-TP-001",
        },
      ],
      experimentRunTrays: [
        {
          task_code: "SYLU-2026-03-011",
          experiment_code: "SYLU-2026-03-011-A",
          tray_code: "SYLU-2026-03-011-TP-001",
          run_tray_status: "实验已完成",
          ended_at: "2026-06-06T10:00:00+08:00",
        },
      ],
    });

    expect(view.currentStatus).toBe("当前托盘：SYLU-2026-03-011-TP-001 | 当前状态：盐雾试验已完成");
    expect(view.steps.find((step) => step.label === "盐雾试验已完成")).toEqual(expect.objectContaining({ active: true, reached: false }));
    expect(view.steps.map((step) => step.label)).not.toContain("送至外观检测间");
    expect(view.steps.map((step) => step.label)).not.toContain("实验后外观检测间存放");
  });

  test("buildTrayFlowView shows pre-experiment appearance storage before dispatching to the salt lab", () => {
    const view = buildTrayFlowView({
      trayCode: "SYLU-2026-03-013-TP-001",
      taskCode: "SYLU-2026-03-013",
      location: "外观检测间",
      status: "实验前外观检测间存放",
      samples: [
        {
          task_code: "SYLU-2026-03-013",
          location: "外观检测间",
          status: "实验前外观检测间存放",
          trays: [
            {
              tray_code: "SYLU-2026-03-013-TP-001",
              status: "实验前外观检测间存放",
              target_experiment_code: "SYLU-2026-03-013-A",
              target_lab: "盐雾试验室",
            },
          ],
        },
      ],
      experiments: [
        { task_code: "SYLU-2026-03-013", experiment_code: "SYLU-2026-03-013-A", experiment_name: "盐雾试验" },
      ],
      experimentTrays: [
        { task_code: "SYLU-2026-03-013", experiment_code: "SYLU-2026-03-013-A", tray_code: "SYLU-2026-03-013-TP-001" },
      ],
      schedules: [
        { task_code: "SYLU-2026-03-013", experiment_code: "SYLU-2026-03-013-A", device: "盐雾试验室" },
      ],
    });

    const labels = view.steps.map((step) => step.label);
    expect(view.currentStatus).toBe("当前托盘：SYLU-2026-03-013-TP-001 | 当前状态：实验前外观检测间存放");
    expect(labels.indexOf("实验前外观检测间存放")).toBeGreaterThan(labels.indexOf("已到达暂存间"));
    expect(labels.indexOf("实验前外观检测间存放")).toBeLessThan(labels.indexOf("送至盐雾试验室"));
    expect(view.steps.find((step) => step.label === "实验前外观检测间存放")).toEqual(expect.objectContaining({ active: true }));
    expect(labels).not.toContain("实验后外观检测间存放");
  });

  test("buildTrayFlowView shows pre-experiment appearance storage in multi-experiment tray flow", () => {
    const view = buildTrayFlowView({
      trayCode: "SYLU-2026-08-001-TP-001",
      taskCode: "SYLU-2026-08-001",
      location: "外观检测间",
      status: "实验前外观检测间存放",
      samples: [
        {
          task_code: "SYLU-2026-08-001",
          location: "外观检测间",
          status: "实验前外观检测间存放",
          trays: [
            {
              tray_code: "SYLU-2026-08-001-TP-001",
              status: "实验前外观检测间存放",
              target_experiment_code: "SYLU-2026-08-001-A",
              target_lab: "盐雾试验室",
            },
          ],
        },
      ],
      experiments: [
        { task_code: "SYLU-2026-08-001", experiment_code: "SYLU-2026-08-001-A", experiment_name: "盐雾试验" },
        { task_code: "SYLU-2026-08-001", experiment_code: "SYLU-2026-08-001-B", experiment_name: "高低温湿热试验" },
      ],
      experimentTrays: [
        { task_code: "SYLU-2026-08-001", experiment_code: "SYLU-2026-08-001-A", tray_code: "SYLU-2026-08-001-TP-001" },
        { task_code: "SYLU-2026-08-001", experiment_code: "SYLU-2026-08-001-B", tray_code: "SYLU-2026-08-001-TP-001" },
      ],
      schedules: [
        { task_code: "SYLU-2026-08-001", experiment_code: "SYLU-2026-08-001-A", device: "盐雾试验室" },
        { task_code: "SYLU-2026-08-001", experiment_code: "SYLU-2026-08-001-B", device: "高低温湿热一室" },
      ],
    });

    const labels = view.steps.map((step) => step.label);
    expect(view.currentStatus).toBe("当前托盘：SYLU-2026-08-001-TP-001 | 当前状态：实验前外观检测间存放");
    expect(labels.indexOf("实验前外观检测间存放")).toBeGreaterThan(labels.indexOf("已到达暂存间"));
    expect(labels.indexOf("实验前外观检测间存放")).toBeLessThan(labels.indexOf("送至盐雾试验室"));
    expect(view.steps.find((step) => step.label === "实验前外观检测间存放")).toEqual(expect.objectContaining({ active: true }));
  });

  test("buildTrayFlowView shows explicit pre-experiment appearance storage before dispatching to a salt lab", () => {
    const taskCode = "SYLU-2026-06-031";
    const trayCode = `${taskCode}-TP-001`;
    const view = buildTrayFlowView({
      trayCode,
      taskCode,
      location: "外观检测间",
      status: "实验前外观检测间存放",
      experiments: [
        {
          task_code: taskCode,
          experiment_code: `${taskCode}-A`,
          experiment_type: "盐雾试验",
          required_device: "盐雾试验室",
        },
      ],
      experimentTrays: [
        {
          task_code: taskCode,
          experiment_code: `${taskCode}-A`,
          tray_code: trayCode,
        },
      ],
      samples: [
        {
          code: `${taskCode}-SP-001`,
          task_code: taskCode,
          location: "外观检测间",
          status: "实验前外观检测间存放",
          flow_status: "实验前外观检测间存放",
          trays: [
            {
              tray_code: trayCode,
              status: "实验前外观检测间存放",
              target_lab: "盐雾试验室",
              target_experiment_code: `${taskCode}-A`,
              quantity: 1,
            },
          ],
          history: [
            {
              action: "外观检测间扫码入库",
              detail: `${trayCode} 实验前外观检测间存放`,
              location: "外观检测间",
              status: "实验前外观检测间存放",
              time: "2026-06-23 15:20:08",
            },
            {
              action: "送至实验室",
              detail: `${trayCode} -> 盐雾试验室`,
              location: "盐雾试验室",
              status: "送至实验室",
              time: "2026-06-23 15:20:03",
            },
            {
              action: "任务已确认入库",
              detail: taskCode,
              location: "接驳区",
              status: "到货",
              time: "2026-06-23 15:19:58",
            },
          ],
        },
      ],
    });

    const labels = view.steps.map((step) => step.label);
    expect(view.currentStatus).toBe(`当前托盘：${trayCode} | 当前状态：实验前外观检测间存放`);
    expect(labels).not.toContain("送至外观检测间");
    expect(labels.indexOf("实验前外观检测间存放")).toBeGreaterThan(labels.indexOf("已到达暂存间"));
    expect(labels.indexOf("实验前外观检测间存放")).toBeLessThan(labels.indexOf("送至盐雾试验室"));
    expect(view.steps.find((step) => step.label === "送至暂存间")).toEqual(
      expect.objectContaining({ reached: true, time: "" }),
    );
    expect(view.steps.find((step) => step.label === "已到达暂存间")).toEqual(
      expect.objectContaining({ reached: true, time: "" }),
    );
    expect(view.steps.find((step) => step.label === "实验前外观检测间存放")).toEqual(
      expect.objectContaining({ active: true, time: "2026-06-23 15:20:08" }),
    );
  });

  test("buildTrayFlowView places explicit pre-experiment appearance storage before the next appearance-required lab", () => {
    const taskCode = "SYLU-2026-06-021";
    const trayCode = `${taskCode}-TP-001`;
    const view = buildTrayFlowView({
      trayCode,
      taskCode,
      location: "外观检测间",
      status: "实验前外观检测间存放",
      experiments: [
        {
          task_code: taskCode,
          experiment_code: `${taskCode}-A`,
          experiment_name: "四综合试验",
          required_device: "四综合实验室",
        },
        {
          task_code: taskCode,
          experiment_code: `${taskCode}-B`,
          experiment_name: "霉菌试验",
          required_device: "霉菌试验室",
        },
      ],
      experimentTrays: [
        { task_code: taskCode, experiment_code: `${taskCode}-A`, tray_code: trayCode },
        { task_code: taskCode, experiment_code: `${taskCode}-B`, tray_code: trayCode },
      ],
      samples: [
        {
          code: `${taskCode}-SP-001`,
          task_code: taskCode,
          location: "外观检测间",
          status: "实验前外观检测间存放",
          flow_status: "实验前外观检测间存放",
          trays: [
            {
              tray_code: trayCode,
              status: "实验前外观检测间存放",
              quantity: 1,
            },
          ],
          history: [
            {
              action: "外观检测间扫码入库",
              detail: `${trayCode} 实验前外观检测间存放`,
              location: "外观检测间",
              status: "实验前外观检测间存放",
              time: "2026-06-23 15:55:59",
            },
            {
              action: "任务已确认入库",
              detail: taskCode,
              location: "接驳区",
              status: "到货",
              time: "2026-06-23 15:54:44",
            },
          ],
        },
      ],
    });

    const labels = view.steps.map((step) => step.label);
    const sentToStaging = view.steps.find((step) => step.label === "送至暂存间");
    const arrivedStaging = view.steps.find((step) => step.label === "已到达暂存间");
    const appearanceIndex = labels.indexOf("实验前外观检测间存放");
    const labDispatchIndex = labels.indexOf("送至霉菌试验室");

    expect(view.currentStatus).toBe(`当前托盘：${trayCode} | 当前状态：实验前外观检测间存放`);
    expect(labels).not.toContain("送至外观检测间");
    expect(labels).not.toContain("送至四综合实验室");
    expect(sentToStaging).toEqual(expect.objectContaining({ reached: true, time: "" }));
    expect(arrivedStaging).toEqual(expect.objectContaining({ reached: true, time: "" }));
    expect(appearanceIndex).toBeGreaterThan(labels.indexOf("已到达暂存间"));
    expect(appearanceIndex).toBeLessThan(labDispatchIndex);
    expect(view.steps[appearanceIndex]).toEqual(expect.objectContaining({
      active: true,
      time: "2026-06-23 15:55:59",
    }));
  });

  test("buildTrayFlowView keeps explicit pre-experiment appearance storage after a salt withdrawal", () => {
    const taskCode = "SYLU-2026-06-021";
    const trayCode = `${taskCode}-TP-001`;
    const view = buildTrayFlowView({
      trayCode,
      taskCode,
      location: "外观检测间",
      status: "实验前外观检测间存放",
      experiments: [
        { task_code: taskCode, experiment_code: `${taskCode}-A`, experiment_name: "四综合试验", required_device: "四综合试验" },
        { task_code: taskCode, experiment_code: `${taskCode}-B`, experiment_name: "霉菌试验", required_device: "霉菌试验" },
        { task_code: taskCode, experiment_code: `${taskCode}-C`, experiment_name: "盐雾试验", required_device: "盐雾试验" },
      ],
      experimentTrays: [
        { task_code: taskCode, experiment_code: `${taskCode}-A`, tray_code: trayCode },
        { task_code: taskCode, experiment_code: `${taskCode}-B`, tray_code: trayCode },
        { task_code: taskCode, experiment_code: `${taskCode}-C`, tray_code: trayCode },
      ],
      schedules: [
        { task_code: taskCode, experiment_code: `${taskCode}-C`, device: "盐雾试验室", start_at: "2026-06-23 15:54:00" },
        { task_code: taskCode, experiment_code: `${taskCode}-B`, device: "霉菌试验室", start_at: "2026-06-23 15:54:00" },
        { task_code: taskCode, experiment_code: `${taskCode}-A`, device: "四综合实验室", start_at: "2026-06-23 15:54:00" },
      ],
      samples: [
        {
          code: `${taskCode}-SP-001`,
          task_code: taskCode,
          location: "外观检测间",
          status: "实验前外观检测间存放",
          flow_status: "实验前外观检测间存放",
          trays: [
            {
              tray_code: trayCode,
              status: "实验前外观检测间存放",
              target_lab: "盐雾试验室",
              target_experiment_code: `${taskCode}-C`,
              quantity: 1,
            },
          ],
          history: [
            {
              action: "实验任务撤回",
              detail: `${taskCode} / 盐雾试验 / 撤回至实验前外观检测间存放（试验间内撤回当前实验任务）`,
              location: "外观检测间",
              status: "实验前外观检测间存放",
              time: "2026-06-23 15:55:59",
            },
            {
              action: "任务比对",
              detail: `${taskCode} / 盐雾试验 / 已到达实验室`,
              location: "盐雾试验室",
              status: "已到达实验室",
              time: "2026-06-23 15:55:54",
            },
            {
              action: "任务已确认入库",
              detail: taskCode,
              location: "接驳区",
              status: "到货",
              time: "2026-06-23 15:54:44",
            },
          ],
        },
      ],
    });

    const labels = view.steps.map((step) => step.label);
    const appearanceIndex = labels.indexOf("实验前外观检测间存放");

    expect(view.currentStatus).toBe(`当前托盘：${trayCode} | 当前状态：实验前外观检测间存放`);
    expect(labels).not.toContain("送至四综合实验室");
    expect(labels).not.toContain("实验后外观检测间存放");
    expect(view.steps.find((step) => step.label === "送至暂存间")).toEqual(
      expect.objectContaining({ reached: true, time: "" }),
    );
    expect(view.steps.find((step) => step.label === "已到达暂存间")).toEqual(
      expect.objectContaining({ reached: true, time: "" }),
    );
    expect(appearanceIndex).toBeGreaterThan(labels.indexOf("已到达暂存间"));
    expect(appearanceIndex).toBeLessThan(labels.indexOf("送至盐雾试验室"));
    expect(view.steps[appearanceIndex]).toEqual(expect.objectContaining({
      active: true,
      time: "2026-06-23 15:55:59",
    }));
  });

  test("buildTrayFlowView does not infer post-experiment appearance from a pre-experiment appearance withdrawal", () => {
    const taskCode = "SYLU-2026-07-001";
    const trayCode = `${taskCode}-TP-001`;
    const view = buildTrayFlowView({
      trayCode,
      taskCode,
      currentExperimentCode: `${taskCode}-B`,
      dispatchTargetLab: "盐雾试验室",
      location: "外观检测间",
      status: "实验前外观检测间存放",
      experiments: [
        { task_code: taskCode, experiment_code: `${taskCode}-A`, experiment_name: "霉菌试验", required_device: "霉菌试验" },
        { task_code: taskCode, experiment_code: `${taskCode}-B`, experiment_name: "盐雾试验", required_device: "盐雾试验" },
      ],
      experimentTrays: [
        { task_code: taskCode, experiment_code: `${taskCode}-A`, tray_code: trayCode },
        { task_code: taskCode, experiment_code: `${taskCode}-B`, tray_code: trayCode },
      ],
      experimentRuns: [
        {
          task_code: taskCode,
          experiment_code: `${taskCode}-A`,
          status: "实验已完成",
          ended_at: "2026-06-23 18:23:58",
          tray_codes: [trayCode],
        },
      ],
      experimentRunTrays: [
        {
          task_code: taskCode,
          experiment_code: `${taskCode}-A`,
          tray_code: trayCode,
          status: "实验已完成",
          run_tray_status: "实验已完成",
          ended_at: "2026-06-23 18:23:58",
        },
      ],
      schedules: [
        { task_code: taskCode, experiment_code: `${taskCode}-A`, device: "霉菌试验室", status: "实验已完成" },
        { task_code: taskCode, experiment_code: `${taskCode}-B`, device: "盐雾试验室", status: "已排程" },
      ],
      samples: [
        {
          code: `${taskCode}-SP-001`,
          task_code: taskCode,
          location: "外观检测间",
          status: "实验前外观检测间存放",
          flow_status: "实验前外观检测间存放",
          trays: [
            {
              tray_code: trayCode,
              status: "实验前外观检测间存放",
              target_lab: "盐雾试验室",
              target_experiment_code: `${taskCode}-B`,
              quantity: 1,
            },
          ],
          history: [
            {
              action: "实验任务撤回",
              detail: `${taskCode} / 盐雾试验 / 撤回至实验前外观检测间存放（试验间内撤回当前实验任务）`,
              location: "外观检测间",
              status: "实验前外观检测间存放",
              time: "2026-06-23 18:25:28",
            },
            {
              action: "外观检测间扫码入库",
              detail: `${trayCode} 实验前外观检测间存放`,
              location: "外观检测间",
              status: "实验前外观检测间存放",
              time: "2026-06-23 18:25:08",
            },
            {
              action: "实验完成",
              detail: `${taskCode} / 霉菌试验 / 实验已完成`,
              location: "霉菌试验室",
              status: "实验已完成",
              time: "2026-06-23 18:23:58",
            },
          ],
        },
      ],
    });

    const labels = view.steps.map((step) => step.label);

    expect(view.currentStatus).toBe(`当前托盘：${trayCode} | 当前状态：实验前外观检测间存放`);
    expect(labels).not.toContain("实验后外观检测间存放");
    expect(view.steps.find((step) => step.label === "实验前外观检测间存放")).toEqual(
      expect.objectContaining({ active: true, time: "2026-06-23 18:25:08" }),
    );
  });

  test("buildTrayFlowView inserts optional appearance storage between completed salt test and the next experiment", () => {
    const view = buildTrayFlowView({
      trayCode: "SYLU-2026-03-010-TP-002",
      taskCode: "SYLU-2026-03-010",
      location: "外观检测间",
      status: "实验后外观检测间存放",
      experiments: [
        {
          task_code: "SYLU-2026-03-010",
          experiment_code: "SYLU-2026-03-010-A",
          experiment_type: "盐雾试验",
          required_device: "盐雾试验室",
        },
        {
          task_code: "SYLU-2026-03-010",
          experiment_code: "SYLU-2026-03-010-B",
          experiment_type: "振动试验",
          required_device: "振动一室",
        },
      ],
      experimentTrays: [
        {
          task_code: "SYLU-2026-03-010",
          experiment_code: "SYLU-2026-03-010-A",
          tray_code: "SYLU-2026-03-010-TP-002",
        },
        {
          task_code: "SYLU-2026-03-010",
          experiment_code: "SYLU-2026-03-010-B",
          tray_code: "SYLU-2026-03-010-TP-002",
        },
      ],
      experimentRunTrays: [
        {
          task_code: "SYLU-2026-03-010",
          experiment_code: "SYLU-2026-03-010-A",
          tray_code: "SYLU-2026-03-010-TP-002",
          run_tray_status: "实验已完成",
          ended_at: "2026-06-06T10:00:00+08:00",
        },
      ],
    });

    const labels = view.steps.map((step) => step.label);
    expect(labels).not.toContain("送至外观检测间");
    expect(labels.indexOf("盐雾试验已完成")).toBeLessThan(labels.indexOf("实验后外观检测间存放"));
    expect(labels.indexOf("实验后外观检测间存放")).toBeLessThan(labels.indexOf("送至暂存间"));
    expect(view.steps.find((step) => step.label === "实验后外观检测间存放")).toEqual(expect.objectContaining({ active: true }));
    expect(view.steps.find((step) => step.label === "送至暂存间")).toEqual(expect.objectContaining({ active: false, reached: false }));
  });

  test("buildTrayFlowView keeps completed salt test neutral before the next routing choice", () => {
    const view = buildTrayFlowView({
      trayCode: "SYLU-2026-03-012-TP-002",
      taskCode: "SYLU-2026-03-012",
      location: "盐雾试验室",
      status: "实验已完成",
      experiments: [
        {
          task_code: "SYLU-2026-03-012",
          experiment_code: "SYLU-2026-03-012-A",
          experiment_type: "盐雾试验",
          required_device: "盐雾试验室",
        },
        {
          task_code: "SYLU-2026-03-012",
          experiment_code: "SYLU-2026-03-012-B",
          experiment_type: "霉菌试验",
          required_device: "霉菌试验室",
        },
      ],
      experimentTrays: [
        {
          task_code: "SYLU-2026-03-012",
          experiment_code: "SYLU-2026-03-012-A",
          tray_code: "SYLU-2026-03-012-TP-002",
        },
        {
          task_code: "SYLU-2026-03-012",
          experiment_code: "SYLU-2026-03-012-B",
          tray_code: "SYLU-2026-03-012-TP-002",
        },
      ],
      experimentRunTrays: [
        {
          task_code: "SYLU-2026-03-012",
          experiment_code: "SYLU-2026-03-012-A",
          tray_code: "SYLU-2026-03-012-TP-002",
          run_tray_status: "实验已完成",
          ended_at: "2026-06-06T10:00:00+08:00",
        },
      ],
    });

    const labels = view.steps.map((step) => step.label);
    expect(labels).toContain("盐雾试验已完成");
    expect(labels).not.toContain("送至外观检测间");
    expect(labels).not.toContain("实验后外观检测间存放");
    expect(view.currentStatus).toBe("当前托盘：SYLU-2026-03-012-TP-002 | 当前状态：盐雾试验已完成");
    expect(view.steps.find((step) => step.label === "盐雾试验已完成")).toEqual(expect.objectContaining({ active: true }));
  });

  test("buildTrayFlowView keeps actual appearance milestones after a withdrawal back to staging", () => {
    const taskCode = "SYLU-2026-06-021";
    const trayCode = `${taskCode}-TP-002`;
    const view = buildTrayFlowView({
      trayCode,
      taskCode,
      location: "恒温恒湿间（暂存间）",
      status: "已到达暂存间",
      experiments: [
        {
          task_code: taskCode,
          experiment_code: `${taskCode}-A`,
          experiment_type: "盐雾试验",
          required_device: "盐雾试验室",
        },
        {
          task_code: taskCode,
          experiment_code: `${taskCode}-B`,
          experiment_type: "四综合试验",
          required_device: "四综合实验室",
        },
        {
          task_code: taskCode,
          experiment_code: `${taskCode}-C`,
          experiment_type: "高低温湿热试验",
          required_device: "高低温湿热一室",
        },
        {
          task_code: taskCode,
          experiment_code: `${taskCode}-D`,
          experiment_type: "霉菌试验",
          required_device: "霉菌试验室",
        },
      ],
      experimentTrays: [
        { task_code: taskCode, experiment_code: `${taskCode}-A`, tray_code: trayCode },
        { task_code: taskCode, experiment_code: `${taskCode}-B`, tray_code: trayCode },
        { task_code: taskCode, experiment_code: `${taskCode}-C`, tray_code: trayCode },
        { task_code: taskCode, experiment_code: `${taskCode}-D`, tray_code: trayCode },
      ],
      experimentRunTrays: [
        {
          task_code: taskCode,
          experiment_code: `${taskCode}-A`,
          tray_code: trayCode,
          run_tray_status: "实验已完成",
          ended_at: "2026-06-11T14:57:39+08:00",
        },
        {
          task_code: taskCode,
          experiment_code: `${taskCode}-D`,
          tray_code: trayCode,
          run_tray_status: "实验已完成",
          ended_at: "2026-06-11T15:13:57+08:00",
        },
      ],
      samples: [
        {
          code: `${taskCode}-SP-002`,
          task_code: taskCode,
          location: "恒温恒湿间（暂存间）",
          status: "已到达暂存间",
          flow_status: "已到达暂存间",
          trays: [
            {
              tray_code: trayCode,
              status: "已到达暂存间",
              target_lab: "四综合实验室",
              target_experiment_code: `${taskCode}-B`,
              quantity: 1,
            },
          ],
          history: [
            {
              action: "实验任务撤回",
              detail: `${taskCode} / 四综合试验 / 撤回至已到达暂存间（试验间内撤回当前实验任务）`,
              status: "已到达暂存间",
              time: "2026-06-11T15:18:26+08:00",
            },
            {
              action: "外观检测间扫码出库",
              detail: `${trayCode} 送至 恒温恒湿间（暂存间）`,
              location: "恒温恒湿间（暂存间）",
              status: "送至暂存间",
              time: "2026-06-11T15:15:04+08:00",
            },
            {
              action: "外观检测间扫码入库",
              detail: `${trayCode} 实验后外观检测间存放`,
              location: "外观检测间",
              status: "实验后外观检测间存放",
              time: "2026-06-11T15:14:54+08:00",
            },
            {
              detail: `${taskCode} / 霉菌试验 / 实验已完成`,
              status: "实验已完成",
              time: "2026-06-11T15:13:57+08:00",
              tray_code: trayCode,
            },
            {
              detail: `${taskCode} / 盐雾试验 / 实验已完成`,
              status: "实验已完成",
              time: "2026-06-11T14:57:39+08:00",
              tray_code: trayCode,
            },
          ],
        },
      ],
    });

    const labels = view.steps.map((step) => step.label);
    expect(view.currentStatus).toBe(`当前托盘：${trayCode} | 当前状态：已到达暂存间`);
    expect(view.steps.find((step) => step.label === "送至外观检测间")).toBeUndefined();
    expect(view.steps.find((step) => step.label === "实验后外观检测间存放")).toEqual(
      expect.objectContaining({ active: false, reached: true, time: "2026-06-11T15:14:54+08:00" }),
    );
  });

  test("buildTrayFlowView keeps the original pre-experiment appearance storage time after a lab withdrawal", () => {
    const taskCode = "SYLU-2026-06-023";
    const trayCode = `${taskCode}-TP-001`;
    const view = buildTrayFlowView({
      currentExperimentCode: `${taskCode}-B`,
      experiments: [
        { task_code: taskCode, experiment_code: `${taskCode}-A`, experiment_name: "四综合试验" },
        { task_code: taskCode, experiment_code: `${taskCode}-B`, experiment_name: "霉菌试验" },
      ],
      experimentTrays: [
        { task_code: taskCode, experiment_code: `${taskCode}-A`, tray_code: trayCode },
        { task_code: taskCode, experiment_code: `${taskCode}-B`, tray_code: trayCode },
      ],
      location: "外观检测间",
      samples: [
        {
          code: `${taskCode}-SP-001`,
          flow_status: "实验前外观检测间存放",
          history: [
            {
              action: "实验任务撤回",
              detail: `${taskCode} / 霉菌试验 / 撤回至实验前外观检测间存放（试验间内撤回当前实验任务）`,
              location: "外观检测间",
              status: "实验前外观检测间存放",
              time: "2026-06-23 14:50:00",
            },
            {
              action: "任务比对",
              detail: `${taskCode} / 霉菌试验 / 已到达实验室`,
              location: "霉菌试验室",
              status: "已到达实验室",
              time: "2026-06-23 14:46:00",
            },
            {
              action: "外观检测间扫码出库",
              detail: `${trayCode} 送至 霉菌试验室`,
              location: "霉菌试验室",
              status: "送至实验室",
              time: "2026-06-23 14:44:30",
            },
            {
              action: "外观检测间扫码入库",
              detail: `${trayCode} 实验前外观检测间存放`,
              location: "外观检测间",
              status: "实验前外观检测间存放",
              time: "2026-06-23 14:43:56",
            },
            {
              action: "暂存间扫码出库",
              detail: `${trayCode} 送至 外观检测间`,
              location: "外观检测间",
              status: "送至外观检测间",
              time: "2026-06-23 14:43:30",
            },
            {
              action: "暂存间扫码入库",
              detail: `${trayCode} 已到达暂存间`,
              location: "恒温恒湿间（暂存间）",
              status: "已到达暂存间",
              time: "2026-06-23 14:42:56",
            },
            {
              action: "送至暂存间",
              detail: `${trayCode} 送至暂存间`,
              location: "恒温恒湿间（暂存间）",
              status: "送至暂存间",
              time: "2026-06-23 14:42:30",
            },
            {
              action: "实验完成",
              detail: `${taskCode} / 四综合试验 / 实验已完成`,
              location: "四综合实验室",
              status: "实验已完成",
              time: "2026-06-23 14:40:00",
            },
            {
              action: "任务样品入库",
              detail: `${trayCode} 到货`,
              location: "接驳区",
              status: "到货",
              time: "2026-06-23 14:10:00",
            },
          ],
          location: "外观检测间",
          status: "实验前外观检测间存放",
          task_code: taskCode,
          trays: [{ quantity: 1, status: "实验前外观检测间存放", tray_code: trayCode }],
        },
      ],
      status: "实验前外观检测间存放",
      taskCode,
      trayCode,
    });

    expect(view.steps.find((step) => step.label === "到货")).toEqual(
      expect.objectContaining({ reached: true, time: "2026-06-23 14:10:00" }),
    );
    expect(view.steps.find((step) => step.label === "送至暂存间")).toEqual(
      expect.objectContaining({ reached: true, time: "2026-06-23 14:42:30" }),
    );
    expect(view.steps.find((step) => step.label === "已到达暂存间")).toEqual(
      expect.objectContaining({ reached: true, time: "2026-06-23 14:42:56" }),
    );
    expect(view.steps.find((step) => step.label === "实验前外观检测间存放")).toEqual(
      expect.objectContaining({ active: true, time: "2026-06-23 14:43:56" }),
    );
  });

  test("buildTrayFlowView keeps pre-experiment appearance active after a later salt withdrawal without explicit current experiment", () => {
    const taskCode = "SYLU-2026-06-021";
    const trayCode = `${taskCode}-TP-001`;
    const view = buildTrayFlowView({
      experimentFlow: [
        { code: `${taskCode}-B`, name: "四综合试验", destinationLab: "四综合实验室", state: "completed" },
        {
          code: `${taskCode}-D`,
          name: "盐雾试验",
          destinationLab: "盐雾试验室",
          routeStatus: "实验前外观检测间存放",
          state: "current",
          unstarted: true,
        },
        { code: `${taskCode}-C`, name: "霉菌试验", destinationLab: "霉菌试验室", state: "pending" },
      ],
      experiments: [
        { task_code: taskCode, experiment_code: `${taskCode}-A`, experiment_name: "高低温湿热试验" },
        { task_code: taskCode, experiment_code: `${taskCode}-B`, experiment_name: "四综合试验" },
        { task_code: taskCode, experiment_code: `${taskCode}-C`, experiment_name: "霉菌试验" },
        { task_code: taskCode, experiment_code: `${taskCode}-D`, experiment_name: "盐雾试验" },
      ],
      experimentTrays: [
        { task_code: taskCode, experiment_code: `${taskCode}-A`, tray_code: trayCode },
        { task_code: taskCode, experiment_code: `${taskCode}-B`, tray_code: trayCode },
        { task_code: taskCode, experiment_code: `${taskCode}-C`, tray_code: trayCode },
        { task_code: taskCode, experiment_code: `${taskCode}-D`, tray_code: trayCode },
      ],
      experimentRuns: [
        {
          task_code: taskCode,
          experiment_code: `${taskCode}-B`,
          status: "实验已完成",
          ended_at: "2026-06-23 15:01:33",
          tray_codes: [trayCode],
        },
      ],
      location: "外观检测间",
      samples: [
        {
          code: `${taskCode}-SP-001`,
          flow_status: "实验前外观检测间存放",
          history: [
            {
              action: "实验任务撤回",
              detail: `${taskCode} / 盐雾试验 / 撤回至实验前外观检测间存放（试验间内撤回当前实验任务）`,
              location: "外观检测间",
              status: "实验前外观检测间存放",
              time: "2026-06-23 15:02:58",
            },
            {
              action: "任务比对",
              detail: `${taskCode} / 盐雾试验 / 已到达实验室`,
              location: "盐雾试验室",
              status: "已到达实验室",
              time: "2026-06-23 15:02:53",
            },
            {
              action: "外观检测间扫码出库",
              detail: `${trayCode} 送至 盐雾试验室`,
              location: "盐雾试验室",
              status: "送至实验室",
              time: "2026-06-23 15:02:31",
            },
            {
              action: "外观检测间扫码入库",
              detail: `${trayCode} 实验前外观检测间存放`,
              location: "外观检测间",
              status: "实验前外观检测间存放",
              time: "2026-06-23 15:02:27",
            },
            {
              action: "暂存间扫码出库",
              detail: `${trayCode} 送至 盐雾试验室`,
              location: "盐雾试验室",
              status: "送至实验室",
              time: "2026-06-23 15:02:21",
            },
            {
              action: "实验任务撤回",
              detail: `${taskCode} / 盐雾试验 / 撤回至已到达暂存间（试验间内撤回当前实验任务）`,
              location: "恒温恒湿间（暂存间）",
              status: "已到达暂存间",
              time: "2026-06-23 15:02:15",
            },
            {
              action: "暂存间扫码入库",
              detail: `${trayCode} 已到达暂存间`,
              location: "恒温恒湿间（暂存间）",
              status: "已到达暂存间",
              time: "2026-06-23 15:01:48",
            },
            {
              action: "实验完成",
              detail: `${taskCode} / 四综合试验 / 实验已完成`,
              location: "四综合实验室",
              status: "实验已完成",
              time: "2026-06-23 15:01:33",
            },
          ],
          location: "外观检测间",
          status: "实验前外观检测间存放",
          task_code: taskCode,
          trays: [
            {
              quantity: 1,
              status: "实验前外观检测间存放",
              target_experiment_code: `${taskCode}-D`,
              target_lab: "盐雾试验室",
              tray_code: trayCode,
            },
          ],
        },
      ],
      status: "实验前外观检测间存放",
      taskCode,
      trayCode,
    });

    expect(view.currentStatus).toBe(`当前托盘：${trayCode} | 当前状态：实验前外观检测间存放`);
    expect(view.steps.find((step) => step.label === "实验前外观检测间存放")).toEqual(
      expect.objectContaining({ active: true, time: "2026-06-23 15:02:27" }),
    );
    expect(view.steps.find((step) => step.label === "四综合试验已完成")).toEqual(
      expect.objectContaining({ active: false, reached: true }),
    );
  });

  test("buildTrayFlowView does not show appearance inspection for non-salt non-mold completion", () => {
    const view = buildTrayFlowView({
      trayCode: "SYLU-2026-03-002-TP-001",
      taskCode: "SYLU-2026-03-002",
      location: "振动一室",
      status: "实验已完成",
      experiments: [
        {
          task_code: "SYLU-2026-03-002",
          experiment_code: "SYLU-2026-03-002-A",
          experiment_type: "振动试验",
        },
      ],
      experimentTrays: [
        {
          task_code: "SYLU-2026-03-002",
          experiment_code: "SYLU-2026-03-002-A",
          tray_code: "SYLU-2026-03-002-TP-001",
        },
      ],
      experimentRunTrays: [
        {
          task_code: "SYLU-2026-03-002",
          experiment_code: "SYLU-2026-03-002-A",
          tray_code: "SYLU-2026-03-002-TP-001",
          run_tray_status: "实验已完成",
        },
      ],
    });

    expect(view.steps.map((step) => step.label)).not.toContain("送至外观检测间");
    expect(view.steps.map((step) => step.label)).not.toContain("实验后外观检测间存放");
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

  test("buildTrayFlowView does not reuse another laboratory dispatch time for the current route", () => {
    const taskCode = "SYLU-2026-06-021";
    const trayCode = `${taskCode}-TP-003`;
    const view = buildTrayFlowView({
      currentExperimentCode: `${taskCode}-B`,
      dispatchTargetLab: "霉菌试验室",
      location: "霉菌试验室",
      status: "送至实验室",
      taskCode,
      trayCode,
      experiments: [
        {
          experiment_code: `${taskCode}-A`,
          experiment_name: "冲击试验",
          required_device: "冲击二室",
          task_code: taskCode,
        },
        {
          experiment_code: `${taskCode}-B`,
          experiment_name: "霉菌试验",
          required_device: "霉菌试验室",
          task_code: taskCode,
        },
      ],
      experimentTrays: [
        { experiment_code: `${taskCode}-A`, task_code: taskCode, tray_code: trayCode },
        { experiment_code: `${taskCode}-B`, task_code: taskCode, tray_code: trayCode },
      ],
      samples: [
        {
          code: `${taskCode}-SP-003`,
          history: [
            {
              action: "暂存间扫码出库",
              detail: `${trayCode} 送至 冲击二室`,
              location: "冲击二室",
              status: "送至实验室",
              time: "2026-06-30 20:16:43",
              tray_code: trayCode,
            },
          ],
          location: "霉菌试验室",
          status: "送至实验室",
          task_code: taskCode,
          trays: [{ quantity: 1, status: "送至实验室", target_lab: "霉菌试验室", tray_code: trayCode }],
        },
      ],
    });

    expect(view.steps.find((step) => step.label === "送至霉菌试验室")).toEqual(
      expect.objectContaining({ active: true, time: "" }),
    );
    expect(view.steps.find((step) => step.label === "送至冲击二室")).toBeUndefined();
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
    expect(view.steps.find((step) => step.label === "送至外观检测间")).toBeUndefined();
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
              target_lab: "冲击一室",
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
          run_no: "RUN-IMPACT-001",
          task_code: taskCode,
          experiment_code: experimentCode,
          tray_codes: [trayCode],
          status: "实验进行中",
          started_at: "2026-06-04T16:11:53+08:00",
        },
      ],
      experimentRunTrays: [
        {
          run_no: "RUN-IMPACT-001",
          task_code: taskCode,
          experiment_code: experimentCode,
          tray_code: trayCode,
          run_tray_status: "实验进行中",
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
          run_no: "RUN-IMPACT-START-001",
          task_code: taskCode,
          experiment_code: experimentCode,
          tray_codes: [trayCode],
          status: "实验进行中",
          started_at: "2026-06-04T19:12:09+08:00",
        },
      ],
      experimentRunTrays: [
        {
          run_no: "RUN-IMPACT-START-001",
          task_code: taskCode,
          experiment_code: experimentCode,
          tray_code: trayCode,
          run_tray_status: "实验进行中",
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
    expect(view.steps.find((step) => step.label === "送至外观检测间")).toBeUndefined();
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
    expect(view.steps.find((step) => step.label === "送至外观检测间")).toBeUndefined();
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
    expect(view.steps.find((step) => step.label === "送至外观检测间")).toBeUndefined();
    expect(view.steps.find((step) => step.label === "盐雾试验进行中")).toBeUndefined();
    expect(view.steps.find((step) => step.label === "温度冲击试验未完成")).toEqual(
      expect.objectContaining({ active: false, reached: false, time: "" }),
    );
  });

  test("buildTrayFlowView shows partial axis completion instead of advancing to the next experiment", () => {
    const view = buildTrayFlowView({
      trayCode: "SYLU-2026-06-021-TP-001",
      taskCode: "SYLU-2026-06-021",
      location: "振动二室",
      status: "实验进行中",
      experiments: [
        {
          task_code: "SYLU-2026-06-021",
          experiment_code: "SYLU-2026-06-021-VIB",
          experiment_name: "振动试验",
          required_device: "振动二室",
          axis_codes: ["x+", "x-", "y+", "y-", "z+", "z-"],
        },
        {
          task_code: "SYLU-2026-06-021",
          experiment_code: "SYLU-2026-06-021-IMP",
          experiment_name: "冲击试验",
          required_device: "冲击二室",
        },
      ],
      experimentTrays: [
        { task_code: "SYLU-2026-06-021", experiment_code: "SYLU-2026-06-021-VIB", tray_code: "SYLU-2026-06-021-TP-001" },
        { task_code: "SYLU-2026-06-021", experiment_code: "SYLU-2026-06-021-IMP", tray_code: "SYLU-2026-06-021-TP-001" },
      ],
      experimentRuns: [
        {
          run_no: "RUN-VIB-Z",
          task_code: "SYLU-2026-06-021",
          experiment_code: "SYLU-2026-06-021-VIB",
          tray_codes: ["SYLU-2026-06-021-TP-001"],
          axis_codes: ["z+", "z-"],
          status: "实验已完成",
        },
      ],
      experimentRunTrays: [
        {
          run_no: "RUN-VIB-Z",
          task_code: "SYLU-2026-06-021",
          experiment_code: "SYLU-2026-06-021-VIB",
          tray_code: "SYLU-2026-06-021-TP-001",
          run_tray_status: "实验已完成",
        },
      ],
      experimentRunSteps: [
        { run_no: "RUN-VIB-Z", task_code: "SYLU-2026-06-021", experiment_code: "SYLU-2026-06-021-VIB", axis_code: "z+", status: "实验已完成" },
        { run_no: "RUN-VIB-Z", task_code: "SYLU-2026-06-021", experiment_code: "SYLU-2026-06-021-VIB", axis_code: "z-", status: "实验已完成" },
      ],
      samples: [
        {
          code: "SYLU-2026-06-021-SP-001",
          task_code: "SYLU-2026-06-021",
          location: "振动二室",
          status: "实验进行中",
          trays: [{ tray_code: "SYLU-2026-06-021-TP-001", status: "实验进行中", quantity: 1 }],
          history: [],
        },
      ],
      schedules: [
        {
          task_code: "SYLU-2026-06-021",
          experiment_code: "SYLU-2026-06-021-VIB",
          experiment_name: "振动试验",
          device: "振动二室",
          start_at: "2026-06-21T08:00:00",
        },
        {
          task_code: "SYLU-2026-06-021",
          experiment_code: "SYLU-2026-06-021-IMP",
          experiment_name: "冲击试验",
          device: "冲击二室",
          start_at: "2026-06-22T08:00:00",
        },
      ],
    });

    expect(view.currentStatus).toBe("当前托盘：SYLU-2026-06-021-TP-001 | 当前状态：振动试验部分完成 2/6轴");
    expect(view.steps.find((step) => step.label === "振动试验部分完成 2/6轴")).toEqual(expect.objectContaining({ active: true }));
    expect(view.steps.find((step) => step.label === "振动试验已完成")).toBeUndefined();
    expect(view.steps.find((step) => step.label === "冲击试验未完成")).toEqual(
      expect.objectContaining({ active: false, reached: false }),
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
          run_no: "RUN-MQTT-RUN-001",
          task_code: "TASK-MQTT-RUN",
          experiment_code: "EXP-IMPACT",
          tray_codes: ["TP-MQTT-RUN-001"],
          status: "实验进行中",
        },
      ],
      experimentRunTrays: [
        {
          run_no: "RUN-MQTT-RUN-001",
          task_code: "TASK-MQTT-RUN",
          experiment_code: "EXP-IMPACT",
          tray_code: "TP-MQTT-RUN-001",
          run_tray_status: "实验进行中",
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

  test("buildTrayFlowView ignores run header tray codes without a structured run-tray relation", () => {
    const taskCode = "TASK-RUN-HEADER-ONLY";
    const experimentCode = "EXP-HEADER-ONLY";
    const trayCode = "TP-HEADER-ONLY-001";
    const view = buildTrayFlowView({
      currentExperimentCode: experimentCode,
      experimentRuns: [
        {
          run_no: "RUN-HEADER-ONLY-001",
          task_code: taskCode,
          experiment_code: experimentCode,
          tray_codes: [trayCode],
          status: "实验进行中",
        },
      ],
      experimentTrays: [
        { task_code: taskCode, experiment_code: experimentCode, tray_code: trayCode },
      ],
      experiments: [
        { task_code: taskCode, experiment_code: experimentCode, experiment_name: "冲击试验", status: "实验准备就绪" },
      ],
      samples: [
        {
          task_code: taskCode,
          code: "SP-HEADER-ONLY-001",
          location: "冲击一室",
          status: "实验准备就绪",
          trays: [{ tray_code: trayCode, status: "实验准备就绪", quantity: 1 }],
        },
      ],
      status: "实验准备就绪",
      taskCode,
      trayCode,
    });

    expect(view.currentStatus).toBe("当前托盘：TP-HEADER-ONLY-001 | 当前状态：实验准备就绪");
    expect(view.steps.find((step) => step.label === "冲击试验进行中")?.active).not.toBe(true);
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
      experimentRunTrays: [
        {
          run_no: "OLD-COMPLETED",
          task_code: taskCode,
          experiment_code: "EXP-A",
          tray_code: trayCode,
          run_tray_status: "实验已完成",
          ended_at: "2026-06-04T20:00:00+08:00",
          updated_at: "2026-06-04T20:30:00+08:00",
        },
        {
          run_no: "NEW-RUNNING",
          task_code: taskCode,
          experiment_code: "EXP-A",
          tray_code: trayCode,
          run_tray_status: "实验进行中",
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
      "厂家收回",
    ]);
    expect(view.steps.find((step) => step.label === "到货")).toEqual(expect.objectContaining({ active: true }));
    expect(view.steps.find((step) => step.label === "B实验已完成")).toEqual(expect.objectContaining({ reached: true }));
    expect(view.steps.find((step) => step.label === "A实验进行中")).toEqual(expect.objectContaining({ active: false, reached: false }));
  });

  test("buildTrayFlowView keeps the latest completed experiment active after later experiments completed out of order", () => {
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

    expect(view.currentStatus).toBe("当前托盘：SYLU-2026-06-003-TP-002 | 当前状态：盐雾试验已完成");
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
      "厂家收回",
    ]);
    expect(view.steps.find((step) => step.label === "盐雾试验已完成")).toEqual(expect.objectContaining({
      active: true,
      reached: true,
    }));
    expect(view.steps.find((step) => step.label === "送至冲击一室")).toEqual(expect.objectContaining({
      active: false,
      reached: false,
      time: "",
    }));
    expect(view.steps.find((step) => step.label === "送至四综合实验室")).toBeUndefined();
  });

  test("buildTrayFlowView keeps appearance inspection milestones independent after later non-appearance experiment completion", () => {
    const view = buildTrayFlowView({
      trayCode: "SYLU-2026-06-021-TP-001",
      taskCode: "SYLU-2026-06-021",
      currentExperimentCode: "SYLU-2026-06-021-B",
      dispatchTargetLab: "冲击一室",
      location: "冲击一室",
      status: "实验已完成",
      experiments: [
        {
          task_code: "SYLU-2026-06-021",
          experiment_code: "SYLU-2026-06-021-A",
          experiment_name: "盐雾试验",
        },
        {
          task_code: "SYLU-2026-06-021",
          experiment_code: "SYLU-2026-06-021-B",
          experiment_name: "冲击试验",
        },
        {
          task_code: "SYLU-2026-06-021",
          experiment_code: "SYLU-2026-06-021-C",
          experiment_name: "霉菌试验",
        },
      ],
      experimentTrays: [
        { task_code: "SYLU-2026-06-021", experiment_code: "SYLU-2026-06-021-A", tray_code: "SYLU-2026-06-021-TP-001" },
        { task_code: "SYLU-2026-06-021", experiment_code: "SYLU-2026-06-021-B", tray_code: "SYLU-2026-06-021-TP-001" },
        { task_code: "SYLU-2026-06-021", experiment_code: "SYLU-2026-06-021-C", tray_code: "SYLU-2026-06-021-TP-001" },
      ],
      samples: [
        {
          code: "SYLU-2026-06-021-SP-001",
          task_code: "SYLU-2026-06-021",
          location: "冲击一室",
          status: "实验已完成",
          trays: [
            {
              tray_code: "SYLU-2026-06-021-TP-001",
              status: "实验已完成",
              target_lab: "",
              target_experiment_code: "",
              quantity: 1,
            },
          ],
          history: [
            { action: "实验完成", detail: "SYLU-2026-06-021 / 冲击试验 / 实验已完成", location: "冲击一室", status: "实验已完成", time: "2026-06-07 15:23:04" },
            { action: "实验完成", detail: "SYLU-2026-06-021 / 盐雾试验 / 实验已完成", location: "盐雾试验室", status: "实验已完成", time: "2026-06-07 15:21:43" },
            { action: "外观检测间扫码入库", detail: "SYLU-2026-06-021-TP-001 实验后外观检测间存放", location: "外观检测间", status: "实验后外观检测间存放", time: "2026-06-07 15:22:27" },
            { action: "外观检测间扫码出库", detail: "SYLU-2026-06-021-TP-001 送至 恒温恒湿间（暂存间）", location: "恒温恒湿间（暂存间）", status: "送至暂存间", time: "2026-06-07 15:22:34" },
            { action: "暂存间扫码入库", detail: "SYLU-2026-06-021-TP-001 已到达暂存间", location: "恒温恒湿间（暂存间）", status: "已到达暂存间", time: "2026-06-07 15:22:41" },
            { action: "暂存间扫码出库", detail: "SYLU-2026-06-021-TP-001 送至 冲击一室", location: "冲击一室", status: "送至实验室", time: "2026-06-07 15:22:43" },
          ],
        },
      ],
    });

    expect(view.currentStatus).toBe("当前托盘：SYLU-2026-06-021-TP-001 | 当前状态：冲击试验已完成");
    expect(view.steps.map((step) => step.label)).toEqual([
      "样品运输中",
      "到货",
      "盐雾试验已完成",
      "实验后外观检测间存放",
      "冲击试验已完成",
      "送至暂存间",
      "已到达暂存间",
      "送至冲击一室",
      "已到达实验室",
      "工装夹具安装",
      "实验准备就绪",
      "霉菌试验未完成",
      "厂家收回",
    ]);
    expect(view.steps.find((step) => step.label === "送至外观检测间")).toBeUndefined();
    expect(view.steps.find((step) => step.label === "实验后外观检测间存放")).toEqual(expect.objectContaining({
      active: false,
      reached: true,
      time: "2026-06-07 15:22:27",
    }));
    expect(view.steps.find((step) => step.label === "冲击试验已完成")).toEqual(expect.objectContaining({
      active: true,
      reached: true,
    }));
  });

  test("buildTrayFlowView does not activate the next lab dispatch without post-completion dispatch evidence", () => {
    const taskCode = "SYLU-2026-07-001";
    const trayCode = `${taskCode}-TP-001`;
    const impactExperimentCode = `${taskCode}-IMPACT`;
    const vibrationExperimentCode = `${taskCode}-VIBRATION`;
    const view = buildTrayFlowView({
      currentExperimentCode: vibrationExperimentCode,
      dispatchTargetLab: "振动一室",
      experiments: [
        {
          task_code: taskCode,
          experiment_code: impactExperimentCode,
          experiment_name: "冲击试验",
          required_device: "冲击二室",
        },
        {
          task_code: taskCode,
          experiment_code: vibrationExperimentCode,
          experiment_name: "振动试验",
          required_device: "振动一室",
        },
      ],
      experimentTrays: [
        { task_code: taskCode, experiment_code: impactExperimentCode, tray_code: trayCode },
        { task_code: taskCode, experiment_code: vibrationExperimentCode, tray_code: trayCode },
      ],
      location: "冲击二室",
      samples: [
        {
          code: `${taskCode}-SP-001`,
          task_code: taskCode,
          location: "冲击二室",
          status: "送至实验室",
          trays: [
            {
              quantity: 1,
              status: "送至实验室",
              target_experiment_code: vibrationExperimentCode,
              target_lab: "振动一室",
              tray_code: trayCode,
            },
          ],
          history: [
            {
              action: "暂存间扫码出库",
              detail: `${trayCode} 送至 冲击二室`,
              location: "冲击二室",
              status: "送至实验室",
              time: "2026-06-28 19:54:48",
            },
            {
              action: "实验完成",
              detail: `${taskCode} / 冲击试验 / 实验已完成`,
              location: "冲击二室",
              status: "实验已完成",
              time: "2026-06-28 20:36:27",
            },
          ],
        },
      ],
      schedules: [
        {
          device: "冲击二室",
          experiment_code: impactExperimentCode,
          start_at: "2026-06-28 19:30:00",
          task_code: taskCode,
        },
        {
          device: "振动一室",
          experiment_code: vibrationExperimentCode,
          start_at: "2026-06-29 08:00:00",
          task_code: taskCode,
        },
      ],
      status: "送至实验室",
      taskCode,
      trayCode,
    });

    expect(view.currentStatus).toBe(`当前托盘：${trayCode} | 当前状态：冲击试验已完成`);
    expect(view.steps.find((step) => step.label === "冲击试验已完成")).toEqual(
      expect.objectContaining({ active: true }),
    );
    expect(view.steps.find((step) => step.label === "送至振动一室")).toEqual(
      expect.objectContaining({ active: false, reached: false, time: "" }),
    );
  });

  test("buildTrayFlowView keeps appearance storage historical after a later vibration completion", () => {
    const view = buildTrayFlowView({
      trayCode: "SYLU-2026-06-022-TP-001",
      taskCode: "SYLU-2026-06-022",
      currentExperimentCode: "SYLU-2026-06-022-D",
      dispatchTargetLab: "盐雾试验室",
      location: "外观检测间",
      status: "实验后外观检测间存放",
      experiments: [
        {
          task_code: "SYLU-2026-06-022",
          experiment_code: "SYLU-2026-06-022-A",
          experiment_name: "冲击试验",
        },
        {
          task_code: "SYLU-2026-06-022",
          experiment_code: "SYLU-2026-06-022-B",
          experiment_name: "霉菌试验",
        },
        {
          task_code: "SYLU-2026-06-022",
          experiment_code: "SYLU-2026-06-022-C",
          experiment_name: "振动试验",
        },
        {
          task_code: "SYLU-2026-06-022",
          experiment_code: "SYLU-2026-06-022-D",
          experiment_name: "盐雾试验",
        },
      ],
      experimentTrays: [
        { task_code: "SYLU-2026-06-022", experiment_code: "SYLU-2026-06-022-A", tray_code: "SYLU-2026-06-022-TP-001" },
        { task_code: "SYLU-2026-06-022", experiment_code: "SYLU-2026-06-022-B", tray_code: "SYLU-2026-06-022-TP-001" },
        { task_code: "SYLU-2026-06-022", experiment_code: "SYLU-2026-06-022-C", tray_code: "SYLU-2026-06-022-TP-001" },
        { task_code: "SYLU-2026-06-022", experiment_code: "SYLU-2026-06-022-D", tray_code: "SYLU-2026-06-022-TP-001" },
      ],
      samples: [
        {
          code: "SYLU-2026-06-022-SP-001",
          task_code: "SYLU-2026-06-022",
          location: "外观检测间",
          status: "实验后外观检测间存放",
          flow_status: "实验后外观检测间存放",
          trays: [
            {
              tray_code: "SYLU-2026-06-022-TP-001",
              status: "实验后外观检测间存放",
              quantity: 1,
            },
          ],
          history: [
            { action: "实验完成", detail: "SYLU-2026-06-022 / 振动试验 / 实验已完成", location: "振动一室", status: "实验已完成", time: "2026-06-07 16:55:03" },
            { action: "外观检测间扫码入库", detail: "SYLU-2026-06-022-TP-001 实验后外观检测间存放", location: "外观检测间", status: "实验后外观检测间存放", time: "2026-06-07 16:54:55" },
            { action: "实验完成", detail: "SYLU-2026-06-022 / 霉菌试验 / 实验已完成", location: "霉菌试验室", status: "实验已完成", time: "2026-06-07 16:54:03" },
            { action: "实验完成", detail: "SYLU-2026-06-022 / 冲击试验 / 实验已完成", location: "冲击一室", status: "实验已完成", time: "2026-06-07 16:53:07" },
          ],
        },
      ],
    });

    expect(view.currentStatus).toBe("当前托盘：SYLU-2026-06-022-TP-001 | 当前状态：振动试验已完成");
    expect(view.steps.find((step) => step.label === "实验后外观检测间存放")).toEqual(expect.objectContaining({
      active: false,
      reached: true,
      time: "2026-06-07 16:54:55",
    }));
    expect(view.steps.find((step) => step.label === "振动试验已完成")).toEqual(expect.objectContaining({
      active: true,
      reached: true,
      time: "2026-06-07 16:55:03",
    }));
  });

  test("buildTrayFlowView does not append appearance inspection after the next non-appearance experiment", () => {
    const view = buildTrayFlowView({
      trayCode: "SYLU-2026-06-022-TP-001",
      taskCode: "SYLU-2026-06-022",
      location: "外观检测间",
      status: "送至外观检测间",
      experiments: [
        {
          task_code: "SYLU-2026-06-022",
          experiment_code: "SYLU-2026-06-022-A",
          experiment_name: "霉菌试验",
        },
        {
          task_code: "SYLU-2026-06-022",
          experiment_code: "SYLU-2026-06-022-B",
          experiment_name: "盐雾试验",
        },
        {
          task_code: "SYLU-2026-06-022",
          experiment_code: "SYLU-2026-06-022-C",
          experiment_name: "温度冲击试验",
        },
      ],
      experimentTrays: [
        { task_code: "SYLU-2026-06-022", experiment_code: "SYLU-2026-06-022-A", tray_code: "SYLU-2026-06-022-TP-001" },
        { task_code: "SYLU-2026-06-022", experiment_code: "SYLU-2026-06-022-B", tray_code: "SYLU-2026-06-022-TP-001" },
        { task_code: "SYLU-2026-06-022", experiment_code: "SYLU-2026-06-022-C", tray_code: "SYLU-2026-06-022-TP-001" },
      ],
      samples: [
        {
          code: "SYLU-2026-06-022-SP-001",
          task_code: "SYLU-2026-06-022",
          location: "外观检测间",
          status: "送至外观检测间",
          trays: [
            {
              tray_code: "SYLU-2026-06-022-TP-001",
              status: "送至外观检测间",
              target_lab: "盐雾试验室",
              target_experiment_code: "SYLU-2026-06-022-B",
              quantity: 1,
            },
          ],
          history: [
            { action: "实验完成", detail: "SYLU-2026-06-022 / 盐雾试验 / 实验已完成", location: "盐雾试验室", status: "实验已完成", time: "2026-06-07 15:38:17" },
            { action: "外观检测间扫码入库", detail: "SYLU-2026-06-022-TP-001 实验后外观检测间存放", location: "外观检测间", status: "实验后外观检测间存放", time: "2026-06-07 15:35:57" },
            { action: "实验完成", detail: "SYLU-2026-06-022 / 霉菌试验 / 实验已完成", location: "霉菌试验室", status: "实验已完成", time: "2026-06-07 15:33:27" },
          ],
        },
      ],
    });

    const labels = view.steps.map((step) => step.label);
    const appearanceStockedIndexes = labels
      .map((label, index) => (label === "实验后外观检测间存放" ? index : -1))
      .filter((index) => index >= 0);
    const temperatureIndex = labels.indexOf("温度冲击试验未完成");

    expect(view.currentStatus).toBe("当前托盘：SYLU-2026-06-022-TP-001 | 当前状态：盐雾试验已完成");
    expect(labels).not.toContain("送至外观检测间");
    expect(appearanceStockedIndexes).toHaveLength(1);
    expect(appearanceStockedIndexes.every((index) => index < temperatureIndex)).toBe(true);
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
    expect(view.steps.find((step) => step.label === "送至外观检测间")).toBeUndefined();
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
      location: "恒温恒湿间（实验后暂存间）",
      status: "实验后暂存间存放",
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
          location: "恒温恒湿间（实验后暂存间）",
          status: "实验后暂存间存放",
          trays: [{ tray_code: "SYLU-2026-03-001-TP-002", status: "实验后暂存间存放", quantity: 1 }],
          history: [
            { time: "2026-04-21T10:30:00.000Z", detail: "SYLU-2026-03-001 / 盐雾试验 / 实验已完成" },
            { time: "2026-04-21T12:30:00.000Z", detail: "SYLU-2026-03-001 / 四综合试验 / 实验已完成" },
            { time: "2026-04-21T12:45:00.000Z", status: "实验后暂存间存放", action: "实验后暂存间存放" },
          ],
        },
      ],
    });

    expect(view.currentStatus).toBe("当前托盘：SYLU-2026-03-001-TP-002 | 当前状态：实验后暂存间存放");
    expect(view.steps.find((step) => step.label === "盐雾试验已完成")).toEqual(expect.objectContaining({ reached: true }));
    expect(view.steps.find((step) => step.label === "实验后暂存间存放")).toEqual(expect.objectContaining({ active: true }));
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
    expect(view.steps.find((step) => step.label === "实验后暂存间存放")).toBeUndefined();
    expect(view.steps.find((step) => step.label === "厂家收回")).toEqual(
      expect.objectContaining({ active: true }),
    );
  });

  test("buildTrayFlowView ignores partial-axis runtime before a withdrawal back to arrival", () => {
    const view = buildTrayFlowView({
      trayCode: "SYLU-2026-07-022-TP-002",
      taskCode: "SYLU-2026-07-022",
      location: "接驳区",
      status: "到货",
      experiments: [
        {
          task_code: "SYLU-2026-07-022",
          experiment_code: "SYLU-2026-07-022-A",
          experiment_name: "霉菌试验",
        },
        {
          task_code: "SYLU-2026-07-022",
          experiment_code: "SYLU-2026-07-022-B",
          experiment_name: "冲击试验",
          axis_codes: ["x+", "x-", "y+", "y-", "z+", "z-"],
        },
      ],
      experimentTrays: [
        {
          task_code: "SYLU-2026-07-022",
          experiment_code: "SYLU-2026-07-022-A",
          tray_code: "SYLU-2026-07-022-TP-002",
        },
        {
          task_code: "SYLU-2026-07-022",
          experiment_code: "SYLU-2026-07-022-B",
          tray_code: "SYLU-2026-07-022-TP-002",
        },
      ],
      experimentRuns: [
        {
          run_no: "RUN-IMPACT",
          task_code: "SYLU-2026-07-022",
          experiment_code: "SYLU-2026-07-022-B",
          status: "实验已完成",
          ended_at: "2026-07-01 16:27:14",
          axis_codes: ["x+", "x-", "y-", "z+", "z-"],
        },
      ],
      experimentRunTrays: [
        {
          run_no: "RUN-IMPACT",
          task_code: "SYLU-2026-07-022",
          experiment_code: "SYLU-2026-07-022-B",
          tray_code: "SYLU-2026-07-022-TP-002",
          status: "实验已完成",
          run_tray_status: "实验已完成",
          ended_at: "2026-07-01 16:27:14",
        },
      ],
      experimentRunSteps: ["x+", "x-", "y-", "z+", "z-"].map((axisCode, index) => ({
        run_no: "RUN-IMPACT",
        task_code: "SYLU-2026-07-022",
        experiment_code: "SYLU-2026-07-022-B",
        axis_code: axisCode,
        step_no: index + 1,
        status: "实验已完成",
        ended_at: "2026-07-01 16:27:14",
      })),
      schedules: [
        {
          task_code: "SYLU-2026-07-022",
          experiment_code: "SYLU-2026-07-022-B",
          axis_codes: ["y+"],
          status: "已排程",
        },
      ],
      samples: [
        {
          code: "SYLU-2026-07-022-SP-016",
          task_code: "SYLU-2026-07-022",
          location: "接驳区",
          status: "到货",
          flow_status: "到货",
          trays: [{ tray_code: "SYLU-2026-07-022-TP-002", status: "到货", quantity: 1 }],
          history: [
            {
              action: "实验任务撤回",
              detail: "SYLU-2026-07-022 / 冲击试验 / 撤回至到货（试验间内撤回当前实验任务）",
              location: "接驳区",
              status: "到货",
              time: "2026-07-01 17:31:31",
            },
            {
              action: "实验完成",
              detail: "SYLU-2026-07-022 / 冲击试验 / 冲击试验部分完成 5/6轴",
              location: "冲击一室",
              status: "冲击试验部分完成 5/6轴",
              time: "2026-07-01 16:27:14",
            },
          ],
        },
      ],
    });

    const labels = view.steps.map((step) => step.label);
    expect(labels).not.toContain("冲击试验部分完成 5/6轴");
    expect(labels).not.toContain("待继续冲击试验：剩余 1/6轴");
    expect(view.steps.find((step) => step.label === "到货")).toEqual(expect.objectContaining({ active: true }));
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
            { time: "2026-06-06 12:58:10", status: "已到达暂存间", action: "实验后暂存间存放" },
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

  test("buildTrayFlowView keeps completed experiment runtimes visible after returned runtime markers", () => {
    const taskCode = "SYLU-2026-06-099";
    const trayCode = `${taskCode}-TP-001`;
    const experiments = [
      { task_code: taskCode, experiment_code: `${taskCode}-A`, experiment_name: "霉菌试验", required_device: "霉菌试验室" },
      { task_code: taskCode, experiment_code: `${taskCode}-B`, experiment_name: "高低温湿热试验", required_device: "高低温湿热一室" },
      { task_code: taskCode, experiment_code: `${taskCode}-C`, experiment_name: "冲击试验", required_device: "冲击一室" },
    ];
    const experimentTrays = experiments.map((experiment) => ({
      task_code: taskCode,
      experiment_code: experiment.experiment_code,
      tray_code: trayCode,
    }));
    const completedRunTrays = [
      [`${taskCode}-A`, "2026-06-06 10:00:00"],
      [`${taskCode}-B`, "2026-06-06 11:00:00"],
      [`${taskCode}-C`, "2026-06-06 12:00:00"],
    ].map(([experimentCode, endedAt]) => ({
      run_no: `RUN-${experimentCode}`,
      task_code: taskCode,
      experiment_code: experimentCode,
      tray_code: trayCode,
      run_tray_status: "实验已完成",
      ended_at: endedAt,
    }));
    const returnedRunTrays = experiments.map((experiment) => ({
      run_no: `RETURNED-${experiment.experiment_code}`,
      task_code: taskCode,
      experiment_code: experiment.experiment_code,
      tray_code: trayCode,
      run_tray_status: "厂家收回",
      ended_at: "2026-06-06 12:30:00",
    }));

    const view = buildTrayFlowView({
      trayCode,
      taskCode,
      location: "厂家收回",
      status: "厂家收回",
      experiments,
      experimentTrays,
      experimentRunTrays: [...completedRunTrays, ...returnedRunTrays],
      samples: [
        {
          code: `${taskCode}-SP-001`,
          task_code: taskCode,
          location: "厂家收回",
          status: "厂家收回",
          trays: [{ tray_code: trayCode, status: "厂家收回", quantity: 1 }],
          history: [{ time: "2026-06-06 12:30:00", status: "厂家收回" }],
        },
      ],
    });

    expect(view.currentStatus).toBe(`当前托盘：${trayCode} | 当前状态：厂家收回`);
    expect(view.steps.find((step) => step.label === "霉菌试验已完成")).toEqual(
      expect.objectContaining({ reached: true, time: "2026-06-06 10:00:00" }),
    );
    expect(view.steps.find((step) => step.label === "高低温湿热试验已完成")).toEqual(
      expect.objectContaining({ reached: true, time: "2026-06-06 11:00:00" }),
    );
    expect(view.steps.find((step) => step.label === "冲击试验已完成")).toEqual(
      expect.objectContaining({ reached: true, time: "2026-06-06 12:00:00" }),
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
            { time: "2026-06-06 13:18:13", status: "已到达暂存间", action: "实验后暂存间存放" },
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
            { time: "2026-06-06 13:16:51", status: "已到达暂存间", detail: `${trayCode} 已到达暂存间`, tray_code: trayCode },
            { time: "2026-06-06 13:17:08", status: "厂家收回", detail: `${trayCode} 厂家收回`, tray_code: trayCode },
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

  test("buildTrayFlowView ignores exact tray-code text in history when tray scope is not structured", () => {
    const taskCode = "SYLU-2026-06-021";
    const trayCode = `${taskCode}-TP-001`;
    const view = buildTrayFlowView({
      trayCode,
      taskCode,
      status: "实验进行中",
      samples: [
        {
          task_code: taskCode,
          trays: [{ tray_code: trayCode, status: "实验进行中", quantity: 1 }],
          history: [
            { time: "2026-06-06 13:17:08", status: "厂家收回", detail: `${trayCode} 厂家收回` },
          ],
        },
      ],
    });

    expect(view.currentStatus).toBe(`当前托盘：${trayCode} | 当前状态：实验进行中`);
  });

  test("buildTrayFlowView does not mark a tray returned from a substring tray-code history match", () => {
    const taskCode = "SYLU-2026-06-021";
    const trayCode = `${taskCode}-TP-001`;
    const view = buildTrayFlowView({
      trayCode,
      taskCode,
      status: "实验进行中",
      samples: [
        {
          code: `${taskCode}-SP-001`,
          task_code: taskCode,
          status: "实验进行中",
          trays: [{ tray_code: trayCode, status: "实验进行中", quantity: 1 }],
          history: [
            { time: "2026-06-06 13:17:08", status: "厂家收回", detail: `${taskCode}-TP-0010 厂家收回` },
          ],
        },
      ],
    });

    expect(view.currentStatus).toBe(`当前托盘：${trayCode} | 当前状态：实验进行中`);
  });

  test("buildTrayFlowView does not use a substring tray-code history match as dispatch target", () => {
    const taskCode = "SYLU-2026-06-021";
    const trayCode = `${taskCode}-TP-001`;
    const view = buildTrayFlowView({
      trayCode,
      taskCode,
      status: "已到达暂存间",
      experiments: [
        { task_code: taskCode, experiment_code: `${taskCode}-A`, experiment_name: "冲击试验", required_device: "冲击试验" },
        { task_code: taskCode, experiment_code: `${taskCode}-B`, experiment_name: "温度冲击试验", required_device: "温度冲击试验" },
      ],
      experimentTrays: [
        { task_code: taskCode, experiment_code: `${taskCode}-A`, tray_code: trayCode },
        { task_code: taskCode, experiment_code: `${taskCode}-B`, tray_code: trayCode },
      ],
      samples: [
        {
          code: `${taskCode}-SP-001`,
          task_code: taskCode,
          status: "已到达暂存间",
          trays: [{ tray_code: trayCode, status: "已到达暂存间", quantity: 1 }],
          history: [
            { time: "2026-06-06 13:17:08", detail: `${taskCode}-TP-0010 送至温度冲击一室` },
          ],
        },
      ],
      schedules: [
        { task_code: taskCode, experiment_code: `${taskCode}-A`, device: "冲击一室" },
        { task_code: taskCode, experiment_code: `${taskCode}-B`, device: "温度冲击一室" },
      ],
    });

    expect(view.steps.map((step) => step.label)).toContain("送至冲击一室");
    expect(view.steps.map((step) => step.label)).not.toContain("送至温度冲击一室");
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
      "实验后暂存间存放",
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
    expect(view.steps.find((step) => step.label === "实验后暂存间存放")).toEqual(
      expect.objectContaining({ active: false, reached: false }),
    );
    expect(view.steps.find((step) => step.label === "厂家收回")).toEqual(
      expect.objectContaining({ active: true }),
    );
  });

  test("buildTrayFlowView keeps single-experiment completion reached after manufacturer return", () => {
    const view = buildTrayFlowViewRaw({
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
            { time: "2026-04-21T10:00:00.000Z", detail: "SYLU-2026-03-001 / 四综合试验 / 实验已完成", status: "实验已完成" },
            { time: "2026-04-21T12:00:00.000Z", detail: "SYLU-2026-03-001-TP-001 厂家收回", status: "厂家收回" },
          ],
        },
      ],
    });

    expect(view.currentStatus).toBe("当前托盘：SYLU-2026-03-001-TP-001 | 当前状态：厂家收回");
    expect(view.steps.find((step) => step.label === "四综合试验已完成")).toEqual(
      expect.objectContaining({ active: false, reached: true, time: "2026-04-21T10:00:00.000Z" }),
    );
    expect(view.steps.find((step) => step.label === "厂家收回")).toEqual(
      expect.objectContaining({ active: true }),
    );
    expect(getLegacyFallbackHits()).toEqual([]);
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
              action: "实验后暂存间存放",
            },
            { time: "2026-05-16T13:50:19+08:00", status: "厂家收回" },
          ],
        },
      ],
    });

    expect(view.steps.find((step) => step.label === "已到达暂存间")).toEqual(
      expect.objectContaining({ reached: true, time: "" }),
    );
    expect(view.steps.find((step) => step.label === "实验后暂存间存放")).toEqual(
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
              action: "实验后暂存间存放",
            },
            { time: "2026-05-21T13:53:39+08:00", status: "厂家收回" },
          ],
        },
      ],
    });

    expect(view.steps.find((step) => step.label === "已到达暂存间")).toEqual(
      expect.objectContaining({ time: "" }),
    );
    expect(view.steps.find((step) => step.label === "实验后暂存间存放")).toEqual(
      expect.objectContaining({ reached: true, time: "2026-05-21T13:53:36+08:00" }),
    );
    expect(view.steps.find((step) => step.label === "霉菌试验已完成")).toEqual(
      expect.objectContaining({ reached: true, time: "2026-05-21T13:49:30+08:00" }),
    );
    expect(view.steps.find((step) => step.label === "高低温湿热试验已完成")).toEqual(
      expect.objectContaining({ reached: true, time: "2026-05-21T13:52:25+08:00" }),
    );
    expect(view.steps.find((step) => step.label === "冲击试验已完成")).toEqual(
      expect.objectContaining({ reached: true, time: "2026-05-21T13:53:08+08:00" }),
    );
  });

  test("exports the canonical tray status options in the approved flow order", () => {
    expect(TRAY_STATUS_OPTIONS).toEqual([
      "样品运输中",
      "到货",
      "送至暂存间",
      "已到达暂存间",
      "实验前外观检测间存放",
      "送至实验室",
      "已到达实验室",
      "工装夹具安装",
      "实验准备就绪",
      "实验进行中",
      "实验已完成",
      "实验后暂存间存放",
      "厂家收回",
    ]);
  });

  test("keeps the samples flow model public compatibility exports stable", () => {
    expect(Object.keys(samplesFlowModelPublicApi).sort()).toEqual([
      "DETAIL_STATUS_OPTIONS",
      "SAMPLE_FLOW_STEPS",
      "TRAY_STATUS_OPTIONS",
      "buildSamplesFlowView",
      "buildSamplesStagingView",
      "buildSamplesTrayOverviewView",
      "buildTrayFlowView",
      "dispatchStagingSamples",
      "getSampleTrayList",
      "normalizeLifecycleStatus",
      "normalizeSamplesSnapshot",
      "resolveFlowStatusByLocation",
      "submitSamplesBatchIntake",
      "syncTrayStatusToSampleStatus",
      "synchronizeSamplesForTrayCodes",
      "updateSampleDetail",
      "updateTrayStatus",
    ].sort());
    expect(samplesFlowModelPublicApi.SAMPLE_FLOW_STEPS).toBe(SAMPLE_FLOW_STEPS_FROM_CONSTANTS);
    expect(samplesFlowModelPublicApi.DETAIL_STATUS_OPTIONS).toBe(DETAIL_STATUS_OPTIONS_FROM_CONSTANTS);
    expect(samplesFlowModelPublicApi.TRAY_STATUS_OPTIONS).toBe(TRAY_STATUS_OPTIONS_FROM_CONSTANTS);
    expect(samplesFlowModelPublicApi.getSampleTrayList).toBe(getSampleTrayListFromTrayScope);
    expect(samplesFlowModelPublicApi.normalizeLifecycleStatus).toBe(normalizeLifecycleStatusFromStatus);
    expect(samplesFlowModelPublicApi.normalizeSamplesSnapshot).toBe(normalizeSamplesSnapshotFromStatus);
    expect(samplesFlowModelPublicApi.resolveFlowStatusByLocation).toBe(resolveFlowStatusByLocationFromStatus);
    expect(samplesFlowModelPublicApi.syncTrayStatusToSampleStatus).toBe(syncTrayStatusToSampleStatusFromStatus);
    expect(samplesFlowModelPublicApi.submitSamplesBatchIntake).toBe(submitSamplesBatchIntakeFromCommands);
    expect(samplesFlowModelPublicApi.updateSampleDetail).toBe(updateSampleDetailFromCommands);
    expect(samplesFlowModelPublicApi.updateTrayStatus).toBe(updateTrayStatusFromCommands);
    expect(samplesFlowModelPublicApi.dispatchStagingSamples).toBe(dispatchStagingSamplesFromCommands);
  });

  test("syncTrayStatusToSampleStatus maps tray status directly to the same sample status label", () => {
    expect(syncTrayStatusToSampleStatus("运输中")).toBe("样品运输中");
    expect(syncTrayStatusToSampleStatus("实验进行中")).toBe("实验进行中");
    expect(syncTrayStatusToSampleStatus("未知状态")).toBe("样品运输中");
  });

  test("does not normalize legacy stored status to canonical arrival", () => {
    expect(samplesFlowModelPublicApi.normalizeLifecycleStatus("", "到货")).toBe("到货");
    expect(samplesFlowModelPublicApi.normalizeLifecycleStatus("", "已入库")).toBe("样品运输中");
    expect(samplesFlowModelPublicApi.normalizeLifecycleStatus("恒温恒湿间（暂存间）", "已入库")).toBe("已到达暂存间");
    expect(samplesFlowModelPublicApi.normalizeLifecycleStatus("", "放置暂存间")).toBe("已到达暂存间");
  });

  test("normalizeSamplesSnapshot preserves partial axis statuses during reload", () => {
    const [sample] = normalizeSamplesSnapshotFromStatus([
      {
        code: "SYLU-2026-07-001-SP-001",
        location: "振动一室",
        status: "振动试验部分完成 3/6轴",
        task_code: "SYLU-2026-07-001",
        trays: [
          {
            quantity: 1,
            status: "振动试验部分完成 3/6轴",
            tray_code: "SYLU-2026-07-001-TP-001",
          },
        ],
      },
    ]);

    expect(samplesFlowModelPublicApi.normalizeLifecycleStatus("", "振动试验部分完成 3/6轴")).toBe("振动试验部分完成 3/6轴");
    expect(sample.status).toBe("振动试验部分完成 3/6轴");
    expect(sample.flow_status).toBe("振动试验部分完成 3/6轴");
    expect(sample.trays[0].status).toBe("振动试验部分完成 3/6轴");
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
          status: "实验后暂存间存放",
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
          status: "实验后暂存间存放",
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
    expect(view.statusOptions).toEqual(["实验后暂存间存放", "已到达暂存间"]);
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

  test("dispatchStagingSamples sends salt trays directly to the target lab while preserving the real target", () => {
    const result = dispatchStagingSamples({
      samples: [
        {
          code: "SP-SALT-001",
          task_code: "TASK-SALT",
          location: "恒温恒湿间（暂存间）",
          status: "已到达暂存间",
          owner: "张三",
          history: [],
          trays: [{ tray_code: "TP-SALT-001", status: "已到达暂存间", quantity: 1 }],
        },
      ],
      payload: {
        targetExperimentCode: "EXP-SALT-001",
        targetLab: "盐雾试验室",
        owner: "王工",
        codes: "",
      },
      selectedCodes: ["SP-SALT-001"],
      now: "2026-03-13T10:00:00.000Z",
    });

    expect(result.error).toBe("");
    expect(result.samples[0].location).toBe("盐雾试验室");
    expect(result.samples[0].status).toBe("已到达实验室");
    expect(result.samples[0].flow_status).toBe("已到达实验室");
    expect(result.samples[0].trays[0]).toMatchObject({
      status: "已到达实验室",
      target_experiment_code: "EXP-SALT-001",
      target_lab: "盐雾试验室",
    });
    expect(result.samples[0].history[0]).toEqual(expect.objectContaining({
      action: "暂存间派发",
      status: "已到达实验室",
    }));
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

  test("buildSamplesTrayOverviewView does not exclude a tray from sample-level returned status", () => {
    const view = buildSamplesTrayOverviewView({
      tasks: [{ code: "TASK-SAMPLE-RETURNED", name: "样品状态任务", test_type: "冲击试验" }],
      samples: [
        {
          code: "SP-SAMPLE-RETURNED",
          task_code: "TASK-SAMPLE-RETURNED",
          status: "厂家收回",
          location: "厂家收回",
          trays: [{ tray_code: "TP-SAMPLE-RETURNED", quantity: 1 }],
        },
      ],
    });

    expect(view.rows).toEqual([
      expect.objectContaining({
        trayCode: "TP-SAMPLE-RETURNED",
        status: "",
        sampleCodes: ["SP-SAMPLE-RETURNED"],
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

  test("buildSamplesTrayOverviewView keeps partial axis completion ahead of stale lab dispatch rows", () => {
    const view = buildSamplesTrayOverviewView({
      tasks: [{ code: "SYLU-2026-07-001", name: "分段轴向任务", test_type: "冲击试验 / 振动试验" }],
      samples: [
        {
          code: "SYLU-2026-07-001-SP-001",
          task_code: "SYLU-2026-07-001",
          location: "冲击一室",
          trays: [
            {
              tray_code: "SYLU-2026-07-001-TP-001",
              status: "送至实验室",
              quantity: 1,
              experiment_code: "SYLU-2026-07-001-A",
              updated_at: "2026-07-01T08:00:00.000Z",
            },
          ],
        },
        {
          code: "SYLU-2026-07-001-SP-002",
          task_code: "SYLU-2026-07-001",
          location: "冲击一室",
          trays: [
            {
              tray_code: "SYLU-2026-07-001-TP-001",
              status: "冲击试验部分完成 3/6轴",
              quantity: 1,
              experiment_code: "SYLU-2026-07-001-A",
              updated_at: "2026-07-01T09:00:00.000Z",
            },
          ],
        },
      ],
    });

    expect(view.rows).toEqual([
      expect.objectContaining({
        trayCode: "SYLU-2026-07-001-TP-001",
        status: "冲击试验部分完成 3/6轴",
        sampleCodes: ["SYLU-2026-07-001-SP-001", "SYLU-2026-07-001-SP-002"],
      }),
    ]);
  });

  test("buildTrayFlowView does not apply sample-level returned status to another tray in a multi-tray sample", () => {
    const view = buildTrayFlowView({
      trayCode: "TP-002",
      taskCode: "TASK-MULTI-RETURN",
      status: "已到达实验室",
      experiments: [
        { task_code: "TASK-MULTI-RETURN", experiment_code: "EXP-MOLD", experiment_name: "霉菌试验" },
      ],
      experimentTrays: [
        { task_code: "TASK-MULTI-RETURN", experiment_code: "EXP-MOLD", tray_code: "TP-001" },
        { task_code: "TASK-MULTI-RETURN", experiment_code: "EXP-MOLD", tray_code: "TP-002" },
      ],
      samples: [
        {
          task_code: "TASK-MULTI-RETURN",
          status: "厂家收回",
          location: "厂家收回",
          trays: [
            { tray_code: "TP-001", status: "厂家收回", quantity: 1 },
            { tray_code: "TP-002", status: "已到达实验室", quantity: 1 },
          ],
        },
      ],
    });

    expect(view.currentStatus).toBe("当前托盘：TP-002 | 当前状态：已到达实验室");
    expect(view.steps.find((step) => step.label === "厂家收回")).toEqual(
      expect.objectContaining({ active: false, reached: false }),
    );
  });

  test("buildTrayFlowView does not apply sample-level returned status to an unstatused single tray", () => {
    const view = buildTrayFlowView({
      trayCode: "TP-SINGLE-RETURNED",
      taskCode: "TASK-SINGLE-RETURNED",
      status: "已到达实验室",
      samples: [
        {
          task_code: "TASK-SINGLE-RETURNED",
          status: "厂家收回",
          location: "厂家收回",
          trays: [{ tray_code: "TP-SINGLE-RETURNED", quantity: 1 }],
        },
      ],
    });

    expect(view.currentStatus).toBe("当前托盘：TP-SINGLE-RETURNED | 当前状态：已到达实验室");
    expect(view.steps.find((step) => step.label === "厂家收回")).toEqual(
      expect.objectContaining({ active: false, reached: false }),
    );
  });

  test("buildTrayFlowView does not fill tray step times from sample-level status timestamps", () => {
    const view = buildTrayFlowView({
      trayCode: "TP-SAMPLE-TIME",
      taskCode: "TASK-SAMPLE-TIME",
      status: "已到达实验室",
      samples: [
        {
          task_code: "TASK-SAMPLE-TIME",
          status: "已到达实验室",
          location: "冲击一室",
          created_at: "2026-06-01T08:00:00+08:00",
          updated_at: "2026-06-01T09:00:00+08:00",
          trays: [{ tray_code: "TP-SAMPLE-TIME", quantity: 1 }],
        },
      ],
    });

    expect(view.steps.find((step) => step.label === "到货")).toEqual(
      expect.objectContaining({ time: "" }),
    );
    expect(view.steps.find((step) => step.label === "已到达实验室")).toEqual(
      expect.objectContaining({ active: true, time: "" }),
    );
  });

  test("buildTrayFlowView ignores unscoped completion history for another tray in a multi-tray sample", () => {
    const view = buildTrayFlowView({
      currentExperimentCode: "EXP-MOLD",
      trayCode: "TP-002",
      taskCode: "TASK-HISTORY",
      status: "送至实验室",
      experiments: [
        { task_code: "TASK-HISTORY", experiment_code: "EXP-IMPACT", experiment_name: "冲击试验" },
        { task_code: "TASK-HISTORY", experiment_code: "EXP-MOLD", experiment_name: "霉菌试验" },
      ],
      experimentTrays: [
        { task_code: "TASK-HISTORY", experiment_code: "EXP-IMPACT", tray_code: "TP-001" },
        { task_code: "TASK-HISTORY", experiment_code: "EXP-IMPACT", tray_code: "TP-002" },
        { task_code: "TASK-HISTORY", experiment_code: "EXP-MOLD", tray_code: "TP-001" },
        { task_code: "TASK-HISTORY", experiment_code: "EXP-MOLD", tray_code: "TP-002" },
      ],
      samples: [
        {
          task_code: "TASK-HISTORY",
          trays: [
            { tray_code: "TP-001", status: "实验已完成", quantity: 1 },
            { tray_code: "TP-002", status: "送至实验室", quantity: 1, target_experiment_code: "EXP-MOLD" },
          ],
          history: [
            { detail: "TASK-HISTORY / 冲击试验 / 实验已完成", status: "实验已完成" },
          ],
        },
      ],
    });

    expect(view.steps.some((step) => step.label === "冲击试验已完成")).toBe(false);
    expect(view.steps.find((step) => step.label === "送至实验室")).toEqual(
      expect.objectContaining({ active: true }),
    );
  });

  test("buildTrayFlowView ignores unscoped single-tray returned history after fallback removal", () => {
    const view = buildTrayFlowView({
      trayCode: "TP-001",
      taskCode: "TASK-RETURNED-HISTORY",
      status: "已到达暂存间",
      samples: [
        {
          task_code: "TASK-RETURNED-HISTORY",
          status: "已到达暂存间",
          location: "恒温恒湿间（暂存间）",
          trays: [{ tray_code: "TP-001", status: "已到达暂存间", quantity: 1 }],
          history: [{ status: "厂家收回" }],
        },
      ],
    });

    expect(view.currentStatus).toBe("当前托盘：TP-001 | 当前状态：已到达暂存间");
    expect(getLegacyFallbackHits()).toEqual([]);
  });

  test("buildTrayFlowView ignores single-tray unscoped experiment history after scoped history normalization", () => {
    const view = buildTrayFlowViewRaw({
      currentExperimentCode: "EXP-IMPACT",
      trayCode: "TP-001",
      taskCode: "TASK-SINGLE-HISTORY",
      status: "送至实验室",
      experiments: [
        { task_code: "TASK-SINGLE-HISTORY", experiment_code: "EXP-IMPACT", experiment_name: "冲击试验" },
      ],
      experimentTrays: [
        { task_code: "TASK-SINGLE-HISTORY", experiment_code: "EXP-IMPACT", tray_code: "TP-001" },
      ],
      samples: [
        {
          task_code: "TASK-SINGLE-HISTORY",
          trays: [{ tray_code: "TP-001", status: "实验已完成", quantity: 1 }],
          history: [
            { detail: "TASK-SINGLE-HISTORY / 冲击试验 / 实验已完成", status: "实验已完成" },
          ],
        },
      ],
    });

    expect(view.currentStatus).toBe("当前托盘：TP-001 | 当前状态：送至实验室");
    expect(getLegacyFallbackHits()).toEqual([]);
  });

  test("buildTrayFlowView keeps single-tray completed experiment history before manufacturer return", () => {
    const view = buildTrayFlowViewRaw({
      trayCode: "TP-RETURNED-HISTORY",
      taskCode: "TASK-RETURNED-COMPLETED-HISTORY",
      location: "厂家收回",
      status: "厂家收回",
      experiments: [
        { task_code: "TASK-RETURNED-COMPLETED-HISTORY", experiment_code: "EXP-MOLD", experiment_name: "霉菌试验" },
        { task_code: "TASK-RETURNED-COMPLETED-HISTORY", experiment_code: "EXP-HUMID", experiment_name: "高低温湿热试验" },
        { task_code: "TASK-RETURNED-COMPLETED-HISTORY", experiment_code: "EXP-IMPACT", experiment_name: "冲击试验" },
      ],
      experimentTrays: [
        { task_code: "TASK-RETURNED-COMPLETED-HISTORY", experiment_code: "EXP-MOLD", tray_code: "TP-RETURNED-HISTORY" },
        { task_code: "TASK-RETURNED-COMPLETED-HISTORY", experiment_code: "EXP-HUMID", tray_code: "TP-RETURNED-HISTORY" },
        { task_code: "TASK-RETURNED-COMPLETED-HISTORY", experiment_code: "EXP-IMPACT", tray_code: "TP-RETURNED-HISTORY" },
      ],
      samples: [
        {
          task_code: "TASK-RETURNED-COMPLETED-HISTORY",
          location: "厂家收回",
          status: "厂家收回",
          trays: [{ tray_code: "TP-RETURNED-HISTORY", status: "厂家收回", quantity: 1 }],
          history: [
            { time: "2026-06-06 10:00:00", detail: "TASK-RETURNED-COMPLETED-HISTORY / 霉菌试验 / 实验已完成", status: "实验已完成" },
            { time: "2026-06-06 11:00:00", detail: "TASK-RETURNED-COMPLETED-HISTORY / 高低温湿热试验 / 实验已完成", status: "实验已完成" },
            { time: "2026-06-06 12:00:00", detail: "TASK-RETURNED-COMPLETED-HISTORY / 冲击试验 / 实验已完成", status: "实验已完成" },
            { time: "2026-06-06 12:30:00", status: "厂家收回", detail: "TP-RETURNED-HISTORY 厂家收回" },
          ],
        },
      ],
    });

    expect(view.currentStatus).toBe("当前托盘：TP-RETURNED-HISTORY | 当前状态：厂家收回");
    expect(view.steps.find((step) => step.label === "霉菌试验已完成")).toEqual(
      expect.objectContaining({ reached: true, time: "2026-06-06 10:00:00" }),
    );
    expect(view.steps.find((step) => step.label === "高低温湿热试验已完成")).toEqual(
      expect.objectContaining({ reached: true, time: "2026-06-06 11:00:00" }),
    );
    expect(view.steps.find((step) => step.label === "冲击试验已完成")).toEqual(
      expect.objectContaining({ reached: true, time: "2026-06-06 12:00:00" }),
    );
    expect(getLegacyFallbackHits()).toEqual([]);
  });

  test("buildTrayFlowView uses structured tray codes without legacy experiment history fallback", () => {
    const view = buildTrayFlowView({
      currentExperimentCode: "EXP-IMPACT",
      trayCode: "TP-001",
      taskCode: "TASK-SCOPED-HISTORY",
      status: "实验已完成",
      experiments: [
        { task_code: "TASK-SCOPED-HISTORY", experiment_code: "EXP-IMPACT", experiment_name: "冲击试验" },
      ],
      experimentTrays: [
        { task_code: "TASK-SCOPED-HISTORY", experiment_code: "EXP-IMPACT", tray_code: "TP-001" },
      ],
      samples: [
        {
          task_code: "TASK-SCOPED-HISTORY",
          trays: [{ tray_code: "TP-001", status: "实验已完成", quantity: 1 }],
          history: [
            {
              detail: "TASK-SCOPED-HISTORY / 冲击试验 / 实验已完成",
              status: "实验已完成",
              tray_codes: ["TP-001"],
            },
          ],
        },
      ],
    });

    expect(view.currentStatus).toBe("当前托盘：TP-001 | 当前状态：冲击试验已完成");
    expect(getLegacyFallbackHits()).toEqual([]);
  });

  test("buildTrayFlowView keeps an axis experiment current until all required axes are completed", () => {
    const view = buildTrayFlowView({
      trayCode: "TP-AXIS-001",
      taskCode: "TASK-AXIS-FLOW",
      location: "振动试验室",
      status: "实验已完成",
      experiments: [
        {
          task_code: "TASK-AXIS-FLOW",
          experiment_code: "EXP-VIB",
          experiment_name: "振动试验",
          axis_codes: ["x+", "x-", "y+", "y-", "z+", "z-"],
        },
        {
          task_code: "TASK-AXIS-FLOW",
          experiment_code: "EXP-IMPACT",
          experiment_name: "冲击试验",
        },
      ],
      experimentTrays: [
        { task_code: "TASK-AXIS-FLOW", experiment_code: "EXP-VIB", tray_code: "TP-AXIS-001" },
        { task_code: "TASK-AXIS-FLOW", experiment_code: "EXP-IMPACT", tray_code: "TP-AXIS-001" },
      ],
      experimentRuns: [
        {
          run_no: "RUN-VIB-Z",
          task_code: "TASK-AXIS-FLOW",
          experiment_code: "EXP-VIB",
          axis_codes: ["z+", "z-"],
          status: "实验已完成",
        },
      ],
      experimentRunTrays: [
        {
          run_no: "RUN-VIB-Z",
          task_code: "TASK-AXIS-FLOW",
          experiment_code: "EXP-VIB",
          tray_code: "TP-AXIS-001",
          run_tray_status: "实验已完成",
        },
      ],
      experimentRunSteps: [
        { run_no: "RUN-VIB-Z", task_code: "TASK-AXIS-FLOW", experiment_code: "EXP-VIB", axis_code: "z+", status: "实验已完成" },
        { run_no: "RUN-VIB-Z", task_code: "TASK-AXIS-FLOW", experiment_code: "EXP-VIB", axis_code: "z-", status: "实验已完成" },
      ],
      samples: [
        {
          task_code: "TASK-AXIS-FLOW",
          location: "振动试验室",
          status: "实验已完成",
          trays: [{ tray_code: "TP-AXIS-001", status: "实验已完成", quantity: 1 }],
        },
      ],
      schedules: [
        { task_code: "TASK-AXIS-FLOW", experiment_code: "EXP-VIB", start_at: "2026-06-01T08:00:00" },
        { task_code: "TASK-AXIS-FLOW", experiment_code: "EXP-IMPACT", start_at: "2026-06-02T08:00:00" },
      ],
    });

    expect(view.currentStatus).toBe("当前托盘：TP-AXIS-001 | 当前状态：振动试验部分完成 2/6轴");
    expect(view.steps.find((step) => step.label === "振动试验部分完成 2/6轴")).toEqual(
      expect.objectContaining({ active: true }),
    );
    expect(view.steps.some((step) => step.label === "冲击试验未完成")).toBe(true);
  });

  test("buildTrayFlowView shows partial axis completion for a single axis experiment", () => {
    const taskCode = "SYLU-2026-07-001";
    const experimentCode = `${taskCode}-A`;
    const trayCode = `${taskCode}-TP-001`;
    const completedAxisCodes = ["x+", "x-", "y+"];
    const view = buildTrayFlowView({
      trayCode,
      taskCode,
      location: "冲击一室",
      status: "实验进行中",
      experiments: [
        {
          task_code: taskCode,
          experiment_code: experimentCode,
          experiment_name: "冲击试验",
          axis_codes: [...completedAxisCodes, "y-", "z+", "z-"],
        },
      ],
      experimentTrays: [
        { task_code: taskCode, experiment_code: experimentCode, tray_code: trayCode },
      ],
      experimentRuns: [
        {
          run_no: "RUN-IMPACT-AXIS",
          task_code: taskCode,
          experiment_code: experimentCode,
          axis_codes: completedAxisCodes,
          status: "实验已完成",
        },
      ],
      experimentRunTrays: [
        {
          run_no: "RUN-IMPACT-AXIS",
          task_code: taskCode,
          experiment_code: experimentCode,
          tray_code: trayCode,
          run_tray_status: "实验已完成",
        },
      ],
      experimentRunSteps: completedAxisCodes.map((axisCode, index) => ({
        run_no: "RUN-IMPACT-AXIS",
        task_code: taskCode,
        experiment_code: experimentCode,
        axis_code: axisCode,
        step_no: index + 1,
        status: "实验已完成",
      })),
      samples: [
        {
          task_code: taskCode,
          location: "冲击一室",
          status: "实验进行中",
          trays: [{ tray_code: trayCode, status: "实验进行中", quantity: 1 }],
        },
      ],
      schedules: [
        { task_code: taskCode, experiment_code: experimentCode, axis_codes: completedAxisCodes, start_at: "2026-06-25T15:00:00" },
        { task_code: taskCode, experiment_code: experimentCode, axis_codes: ["y-", "z+", "z-"], start_at: "2026-06-26T08:00:00" },
      ],
    });

    expect(view.currentStatus).toBe(`当前托盘：${trayCode} | 当前状态：冲击试验部分完成 3/6轴`);
    expect(view.steps.find((step) => step.label === "冲击试验部分完成 3/6轴")).toEqual(
      expect.objectContaining({ active: true }),
    );
    expect(view.currentStatus).not.toContain("样品运输中");
  });

  test("buildTrayFlowView aggregates sub-experiment axis completion across the whole experiment", () => {
    const taskCode = "SYLU-2026-06-001";
    const experimentCode = `${taskCode}-B`;
    const trayCode = `${taskCode}-TP-001`;
    const firstSubExperimentCode = `${experimentCode}-AXIS-001`;
    const secondSubExperimentCode = `${experimentCode}-AXIS-002`;
    const completedAxisCodes = ["y+", "z+", "x+"];
    const remainingAxisCodes = ["z-", "y-", "x-"];
    const view = buildTrayFlowView({
      trayCode,
      taskCode,
      location: "冲击一室",
      status: "送至实验室",
      experiments: [
        {
          task_code: taskCode,
          experiment_code: experimentCode,
          experiment_name: "冲击试验",
          axis_codes: [...completedAxisCodes, ...remainingAxisCodes],
        },
      ],
      experimentTrays: [
        { task_code: taskCode, experiment_code: experimentCode, tray_code: trayCode },
      ],
      experimentRuns: [
        {
          run_no: "RUN-IMPACT-AXIS-001",
          task_code: taskCode,
          experiment_code: experimentCode,
          sub_experiment_code: firstSubExperimentCode,
          axis_codes: completedAxisCodes,
          status: "实验已完成",
        },
      ],
      experimentRunTrays: [
        {
          run_no: "RUN-IMPACT-AXIS-001",
          task_code: taskCode,
          experiment_code: experimentCode,
          sub_experiment_code: firstSubExperimentCode,
          tray_code: trayCode,
          run_tray_status: "实验已完成",
        },
      ],
      experimentRunSteps: completedAxisCodes.map((axisCode, index) => ({
        run_no: "RUN-IMPACT-AXIS-001",
        task_code: taskCode,
        experiment_code: experimentCode,
        sub_experiment_code: firstSubExperimentCode,
        axis_code: axisCode,
        step_no: index + 1,
        status: "实验已完成",
      })),
      samples: [
        {
          task_code: taskCode,
          location: "冲击一室",
          status: "送至实验室",
          trays: [
            {
              tray_code: trayCode,
              status: "送至实验室",
              target_experiment_code: experimentCode,
              target_lab: "冲击一室",
              quantity: 1,
            },
          ],
        },
      ],
      schedules: [
        {
          task_code: taskCode,
          experiment_code: experimentCode,
          device: "冲击一室",
          sub_experiment_code: firstSubExperimentCode,
          axis_codes: completedAxisCodes,
          start_at: "2026-06-26 11:12:00",
        },
        {
          task_code: taskCode,
          experiment_code: experimentCode,
          device: "冲击一室",
          sub_experiment_code: secondSubExperimentCode,
          axis_codes: remainingAxisCodes,
          start_at: "2026-06-26 14:52:00",
        },
      ],
    });

    const labels = view.steps.map((step) => step.label);
    const partialIndex = labels.indexOf("冲击试验部分完成 3/6轴");
    const dispatchIndex = labels.indexOf("送至冲击一室");
    const arrivedIndex = labels.indexOf("已到达实验室");
    const fixtureIndex = labels.indexOf("工装夹具安装");
    const readyIndex = labels.indexOf("实验准备就绪");
    const runningIndex = labels.indexOf("冲击试验进行中");

    expect(view.currentStatus).toBe(`当前托盘：${trayCode} | 当前状态：冲击试验部分完成 3/6轴`);
    expect(partialIndex).toBeGreaterThan(labels.indexOf("到货"));
    expect(runningIndex).toBeGreaterThan(-1);
    expect(dispatchIndex).toBeLessThan(partialIndex);
    expect(runningIndex).toBeLessThan(partialIndex);
    expect(view.steps[partialIndex]).toEqual(
      expect.objectContaining({ active: true, reached: false }),
    );
    expect(view.steps[dispatchIndex]).toEqual(
      expect.objectContaining({ active: false, reached: true }),
    );
    expect(view.steps[arrivedIndex]).toEqual(
      expect.objectContaining({ active: false, reached: true }),
    );
    expect(view.steps[fixtureIndex]).toEqual(
      expect.objectContaining({ active: false, reached: true }),
    );
    expect(view.steps[readyIndex]).toEqual(
      expect.objectContaining({ active: false, reached: true }),
    );
    expect(view.steps[runningIndex]).toEqual(
      expect.objectContaining({ active: false, reached: true }),
    );
    expect(view.steps.some((step) => step.label === "冲击试验已完成")).toBe(false);
  });

  test("buildTrayFlowView keeps a previous partial axis experiment visible after dispatching to another experiment", () => {
    const taskCode = "SYLU-2026-07-001";
    const trayCode = `${taskCode}-TP-001`;
    const impactExperimentCode = `${taskCode}-IMPACT`;
    const vibrationExperimentCode = `${taskCode}-VIBRATION`;
    const impactSubExperimentCode = `${impactExperimentCode}-AXIS-001`;
    const completedImpactAxisCodes = ["x+", "x-", "y+"];
    const view = buildTrayFlowView({
      trayCode,
      taskCode,
      location: "振动一室",
      status: "已到达实验室",
      experiments: [
        {
          task_code: taskCode,
          experiment_code: impactExperimentCode,
          experiment_name: "冲击试验",
          required_device: "冲击一室",
          axis_codes: [...completedImpactAxisCodes, "y-", "z+", "z-"],
        },
        {
          task_code: taskCode,
          experiment_code: vibrationExperimentCode,
          experiment_name: "振动试验",
          required_device: "振动一室",
          axis_codes: ["x+", "x-", "y+", "y-", "z+", "z-"],
        },
      ],
      experimentTrays: [
        { task_code: taskCode, experiment_code: impactExperimentCode, tray_code: trayCode },
        { task_code: taskCode, experiment_code: vibrationExperimentCode, tray_code: trayCode },
      ],
      experimentRuns: [
        {
          run_no: "RUN-IMPACT-AXIS-001",
          task_code: taskCode,
          experiment_code: impactExperimentCode,
          sub_experiment_code: impactSubExperimentCode,
          axis_codes: completedImpactAxisCodes,
          status: "实验已完成",
        },
      ],
      experimentRunTrays: [
        {
          run_no: "RUN-IMPACT-AXIS-001",
          task_code: taskCode,
          experiment_code: impactExperimentCode,
          sub_experiment_code: impactSubExperimentCode,
          tray_code: trayCode,
          run_tray_status: "实验已完成",
        },
      ],
      experimentRunSteps: completedImpactAxisCodes.map((axisCode, index) => ({
        run_no: "RUN-IMPACT-AXIS-001",
        task_code: taskCode,
        experiment_code: impactExperimentCode,
        sub_experiment_code: impactSubExperimentCode,
        axis_code: axisCode,
        step_no: index + 1,
        status: "实验已完成",
      })),
      samples: [
        {
          task_code: taskCode,
          location: "振动一室",
          status: "已到达实验室",
          trays: [
            {
              tray_code: trayCode,
              status: "已到达实验室",
              target_experiment_code: vibrationExperimentCode,
              target_lab: "振动一室",
              quantity: 1,
            },
          ],
        },
      ],
      schedules: [
        {
          task_code: taskCode,
          experiment_code: impactExperimentCode,
          device: "冲击一室",
          sub_experiment_code: impactSubExperimentCode,
          axis_codes: completedImpactAxisCodes,
          start_at: "2026-06-25 08:00:00",
        },
        {
          task_code: taskCode,
          experiment_code: vibrationExperimentCode,
          device: "振动一室",
          axis_codes: ["x+", "x-", "y+", "y-", "z+", "z-"],
          start_at: "2026-06-26 17:03:51",
        },
      ],
    });
    const labels = view.steps.map((step) => step.label);
    const partialIndex = labels.indexOf("冲击试验部分完成 3/6轴");
    const vibrationDispatchIndex = labels.indexOf("送至振动一室");
    const vibrationArrivalIndex = labels.indexOf("已到达实验室");
    const incompleteWarningIndex = labels.indexOf("冲击试验未全部完成");
    const returnedIndex = labels.indexOf("厂家收回");

    expect(view.currentStatus).toBe(`当前托盘：${trayCode} | 当前状态：已到达实验室`);
    expect(partialIndex).toBeGreaterThan(labels.indexOf("到货"));
    expect(vibrationDispatchIndex).toBeGreaterThan(partialIndex);
    expect(vibrationArrivalIndex).toBeGreaterThan(vibrationDispatchIndex);
    expect(incompleteWarningIndex).toBe(-1);
    expect(returnedIndex).toBeGreaterThan(vibrationArrivalIndex);
    expect(view.steps[partialIndex]).toEqual(expect.objectContaining({ active: false, reached: true }));
    expect(view.steps[vibrationArrivalIndex]).toEqual(expect.objectContaining({ active: true }));
    expect(labels).not.toContain("冲击试验未完成");
  });

  test("buildTrayFlowView orders partial axis completion before staging and manufacturer return", () => {
    const taskCode = "SYLU-2026-06-021";
    const trayCode = `${taskCode}-TP-001`;
    const moldExperimentCode = `${taskCode}-MOLD`;
    const impactExperimentCode = `${taskCode}-IMPACT`;
    const impactSubExperimentCode = `${impactExperimentCode}-AXIS-001`;
    const completedAxisCodes = ["x+", "x-"];
    const allAxisCodes = [...completedAxisCodes, "y+", "y-", "z+", "z-"];
    const view = buildTrayFlowView({
      taskCode,
      trayCode,
      location: "厂家收回",
      status: "厂家收回",
      experiments: [
        {
          task_code: taskCode,
          experiment_code: moldExperimentCode,
          experiment_name: "霉菌试验",
          required_device: "霉菌试验室",
        },
        {
          task_code: taskCode,
          experiment_code: impactExperimentCode,
          experiment_name: "冲击试验",
          required_device: "冲击二室",
          axis_codes: allAxisCodes,
        },
      ],
      experimentTrays: [
        { task_code: taskCode, experiment_code: moldExperimentCode, tray_code: trayCode },
        { task_code: taskCode, experiment_code: impactExperimentCode, tray_code: trayCode },
      ],
      experimentRuns: [
        {
          run_no: "RUN-MOLD-DONE",
          task_code: taskCode,
          experiment_code: moldExperimentCode,
          status: "实验已完成",
          ended_at: "2026-06-30 16:08:19",
          tray_codes: [trayCode],
        },
        {
          run_no: "RUN-IMPACT-PARTIAL",
          task_code: taskCode,
          experiment_code: impactExperimentCode,
          sub_experiment_code: impactSubExperimentCode,
          axis_codes: completedAxisCodes,
          status: "实验已完成",
          started_at: "2026-06-30 17:00:48",
          ended_at: "2026-06-30 17:01:47",
          tray_codes: [trayCode],
        },
      ],
      experimentRunTrays: [
        {
          run_no: "RUN-MOLD-DONE",
          task_code: taskCode,
          experiment_code: moldExperimentCode,
          tray_code: trayCode,
          run_tray_status: "实验已完成",
          ended_at: "2026-06-30 16:08:19",
        },
        {
          run_no: "RUN-IMPACT-PARTIAL",
          task_code: taskCode,
          experiment_code: impactExperimentCode,
          sub_experiment_code: impactSubExperimentCode,
          tray_code: trayCode,
          run_tray_status: "实验已完成",
          started_at: "2026-06-30 17:00:48",
          ended_at: "2026-06-30 17:01:47",
        },
      ],
      experimentRunSteps: completedAxisCodes.map((axisCode, index) => ({
        run_no: "RUN-IMPACT-PARTIAL",
        task_code: taskCode,
        experiment_code: impactExperimentCode,
        sub_experiment_code: impactSubExperimentCode,
        axis_code: axisCode,
        step_no: index + 1,
        status: "实验已完成",
        ended_at: "2026-06-30 17:01:47",
      })),
      samples: [
        {
          task_code: taskCode,
          location: "厂家收回",
          status: "厂家收回",
          trays: [{ tray_code: trayCode, status: "厂家收回", quantity: 1 }],
          history: [
            {
              detail: `${taskCode} / 霉菌试验 / 实验已完成`,
              location: "霉菌试验室",
              status: "实验已完成",
              time: "2026-06-30 16:08:19",
              tray_code: trayCode,
            },
            {
              detail: `${taskCode} / 冲击试验 / 送至实验室`,
              location: "冲击二室",
              status: "送至实验室",
              time: "2026-06-30 16:33:15",
              tray_code: trayCode,
            },
            {
              detail: `${taskCode} / 冲击试验 / 已到达实验室`,
              location: "冲击二室",
              status: "已到达实验室",
              time: "2026-06-30 17:00:21",
              tray_code: trayCode,
            },
            {
              detail: `${taskCode} / 冲击试验 / 工装夹具安装`,
              location: "冲击二室",
              status: "工装夹具安装",
              time: "2026-06-30 17:00:41",
              tray_code: trayCode,
            },
            {
              detail: `${taskCode} / 冲击试验 / 实验准备就绪`,
              location: "冲击二室",
              status: "实验准备就绪",
              time: "2026-06-30 17:00:45",
              tray_code: trayCode,
            },
            {
              detail: `${taskCode} / 冲击试验 / 实验进行中`,
              location: "冲击二室",
              status: "实验进行中",
              time: "2026-06-30 17:00:48",
              tray_code: trayCode,
            },
            {
              detail: `${taskCode} / 冲击试验 / 冲击试验部分完成 2/6轴`,
              location: "冲击二室",
              status: "冲击试验部分完成 2/6轴",
              time: "2026-06-30 17:01:47",
              tray_code: trayCode,
            },
            {
              detail: `${trayCode} 送至暂存间`,
              location: "恒温恒湿间（暂存间）",
              status: "送至暂存间",
              time: "2026-06-30 17:01:55",
              tray_code: trayCode,
            },
            {
              detail: `${trayCode} 已到达暂存间`,
              location: "恒温恒湿间（暂存间）",
              status: "已到达暂存间",
              time: "2026-06-30 17:02:01",
              tray_code: trayCode,
            },
            {
              detail: `${trayCode} 厂家收回`,
              location: "厂家收回",
              status: "厂家收回",
              time: "2026-06-30 17:02:07",
              tray_code: trayCode,
            },
          ],
        },
      ],
      schedules: [
        {
          task_code: taskCode,
          experiment_code: moldExperimentCode,
          device: "霉菌试验室",
          start_at: "2026-06-30 16:00:00",
        },
        {
          task_code: taskCode,
          experiment_code: impactExperimentCode,
          device: "冲击二室",
          sub_experiment_code: impactSubExperimentCode,
          axis_codes: completedAxisCodes,
          start_at: "2026-06-30 17:00:00",
        },
      ],
    });
    const labels = view.steps.map((step) => step.label);
    const runningIndex = labels.indexOf("冲击试验进行中");
    const partialIndex = labels.indexOf("冲击试验部分完成 2/6轴");
    const sentStagingIndex = labels.indexOf("送至暂存间");
    const arrivedStagingIndex = labels.indexOf("已到达暂存间");
    const returnedIndex = labels.indexOf("厂家收回");

    expect(view.currentStatus).toBe(`当前托盘：${trayCode} | 当前状态：厂家收回`);
    expect(labels).not.toContain("冲击试验未全部完成");
    expect(runningIndex).toBeGreaterThan(-1);
    expect(view.steps[runningIndex]).toEqual(expect.objectContaining({ time: "2026-06-30 17:00:48" }));
    expect(partialIndex).toBeGreaterThan(runningIndex);
    expect(sentStagingIndex).toBeGreaterThan(partialIndex);
    expect(arrivedStagingIndex).toBeGreaterThan(sentStagingIndex);
    expect(returnedIndex).toBeGreaterThan(arrivedStagingIndex);
  });

  test("buildTrayFlowView keeps returned partial axis experiments from becoming completed", () => {
    const taskCode = "TASK-RETURNED-PARTIAL-AXIS";
    const trayCode = `${taskCode}-TP-001`;
    const impactExperimentCode = `${taskCode}-IMPACT`;
    const vibrationExperimentCode = `${taskCode}-VIBRATION`;
    const impactSubExperimentCode = `${impactExperimentCode}-AXIS-001`;
    const vibrationSubExperimentCode = `${vibrationExperimentCode}-AXIS-001`;
    const completedAxisCodes = ["x+", "x-", "y+"];
    const allAxisCodes = [...completedAxisCodes, "y-", "z+", "z-"];
    const view = buildTrayFlowView({
      taskCode,
      trayCode,
      location: "厂家收回",
      status: "厂家收回",
      experiments: [
        {
          task_code: taskCode,
          experiment_code: impactExperimentCode,
          experiment_name: "冲击试验",
          required_device: "冲击二室",
          axis_codes: allAxisCodes,
        },
        {
          task_code: taskCode,
          experiment_code: vibrationExperimentCode,
          experiment_name: "振动试验",
          required_device: "振动二室",
          axis_codes: allAxisCodes,
        },
      ],
      experimentTrays: [
        { task_code: taskCode, experiment_code: impactExperimentCode, tray_code: trayCode },
        { task_code: taskCode, experiment_code: vibrationExperimentCode, tray_code: trayCode },
      ],
      experimentRuns: [
        {
          run_no: "RUN-IMPACT-PARTIAL",
          task_code: taskCode,
          experiment_code: impactExperimentCode,
          sub_experiment_code: impactSubExperimentCode,
          axis_codes: completedAxisCodes,
          status: "实验已完成",
          ended_at: "2026-06-29 10:00:00",
        },
        {
          run_no: "RUN-VIBRATION-PARTIAL",
          task_code: taskCode,
          experiment_code: vibrationExperimentCode,
          sub_experiment_code: vibrationSubExperimentCode,
          axis_codes: completedAxisCodes,
          status: "实验已完成",
          ended_at: "2026-06-29 11:00:00",
        },
      ],
      experimentRunTrays: [
        {
          run_no: "RUN-IMPACT-PARTIAL",
          task_code: taskCode,
          experiment_code: impactExperimentCode,
          sub_experiment_code: impactSubExperimentCode,
          tray_code: trayCode,
          run_tray_status: "实验已完成",
          ended_at: "2026-06-29 10:00:00",
        },
        {
          run_no: "RUN-VIBRATION-PARTIAL",
          task_code: taskCode,
          experiment_code: vibrationExperimentCode,
          sub_experiment_code: vibrationSubExperimentCode,
          tray_code: trayCode,
          run_tray_status: "实验已完成",
          ended_at: "2026-06-29 11:00:00",
        },
      ],
      experimentRunSteps: [
        ...completedAxisCodes.map((axisCode, index) => ({
          run_no: "RUN-IMPACT-PARTIAL",
          task_code: taskCode,
          experiment_code: impactExperimentCode,
          sub_experiment_code: impactSubExperimentCode,
          axis_code: axisCode,
          step_no: index + 1,
          status: "实验已完成",
        })),
        ...completedAxisCodes.map((axisCode, index) => ({
          run_no: "RUN-VIBRATION-PARTIAL",
          task_code: taskCode,
          experiment_code: vibrationExperimentCode,
          sub_experiment_code: vibrationSubExperimentCode,
          axis_code: axisCode,
          step_no: index + 1,
          status: "实验已完成",
        })),
      ],
      samples: [
        {
          task_code: taskCode,
          location: "厂家收回",
          status: "厂家收回",
          trays: [{ tray_code: trayCode, status: "厂家收回", quantity: 1 }],
          history: [
            {
              detail: `${taskCode} / 冲击试验 / 实验已完成`,
              status: "实验已完成",
              time: "2026-06-29 10:00:00",
            },
            {
              detail: `${taskCode} / 振动试验 / 实验已完成`,
              status: "实验已完成",
              time: "2026-06-29 11:00:00",
            },
            {
              detail: `${trayCode} 厂家收回`,
              status: "厂家收回",
              time: "2026-06-29 12:00:00",
            },
          ],
        },
      ],
      schedules: [
        {
          task_code: taskCode,
          experiment_code: impactExperimentCode,
          device: "冲击二室",
          sub_experiment_code: impactSubExperimentCode,
          axis_codes: completedAxisCodes,
          start_at: "2026-06-29 09:00:00",
        },
        {
          task_code: taskCode,
          experiment_code: vibrationExperimentCode,
          device: "振动二室",
          sub_experiment_code: vibrationSubExperimentCode,
          axis_codes: completedAxisCodes,
          start_at: "2026-06-29 10:30:00",
        },
      ],
    });
    const labels = view.steps.map((step) => step.label);

    expect(labels).toContain("冲击试验部分完成 3/6轴");
    expect(labels).toContain("振动试验部分完成 3/6轴");
    expect(labels).not.toContain("冲击试验已完成");
    expect(labels).not.toContain("振动试验已完成");
    expect(view.currentStatus).toBe(`当前托盘：${trayCode} | 当前状态：厂家收回`);
  });

  test("buildTrayFlowView keeps timed partial axis completion before later completed experiments", () => {
    const taskCode = "SYLU-2026-06-021";
    const trayCode = `${taskCode}-TP-001`;
    const impactExperimentCode = `${taskCode}-IMPACT`;
    const combinedExperimentCode = `${taskCode}-COMBINED`;
    const vibrationExperimentCode = `${taskCode}-VIBRATION`;
    const impactSubExperimentCode = `${impactExperimentCode}-AXIS-001`;
    const completedImpactAxisCodes = ["y+", "z+"];
    const view = buildTrayFlowView({
      currentExperimentCode: vibrationExperimentCode,
      dispatchTargetLab: "振动二室",
      location: "四综合实验室",
      status: "实验已完成",
      taskCode,
      trayCode,
      experiments: [
        {
          axis_codes: [...completedImpactAxisCodes, "x+", "x-", "y-", "z-"],
          experiment_code: impactExperimentCode,
          experiment_name: "冲击试验",
          required_device: "冲击一室",
          task_code: taskCode,
        },
        {
          experiment_code: combinedExperimentCode,
          experiment_name: "四综合试验",
          required_device: "四综合实验室",
          task_code: taskCode,
        },
        {
          experiment_code: vibrationExperimentCode,
          experiment_name: "振动试验",
          required_device: "振动二室",
          task_code: taskCode,
        },
      ],
      experimentTrays: [
        { experiment_code: impactExperimentCode, task_code: taskCode, tray_code: trayCode },
        { experiment_code: combinedExperimentCode, task_code: taskCode, tray_code: trayCode },
        { experiment_code: vibrationExperimentCode, task_code: taskCode, tray_code: trayCode },
      ],
      experimentRuns: [
        {
          axis_codes: completedImpactAxisCodes,
          ended_at: "2026-06-28 10:00:00",
          experiment_code: impactExperimentCode,
          run_no: "RUN-IMPACT-PARTIAL",
          status: "实验已完成",
          sub_experiment_code: impactSubExperimentCode,
          task_code: taskCode,
          tray_codes: [trayCode],
        },
        {
          ended_at: "2026-06-28 11:00:00",
          experiment_code: combinedExperimentCode,
          run_no: "RUN-COMBINED-DONE",
          status: "实验已完成",
          task_code: taskCode,
          tray_codes: [trayCode],
        },
      ],
      experimentRunTrays: [
        {
          ended_at: "2026-06-28 10:00:00",
          experiment_code: impactExperimentCode,
          run_no: "RUN-IMPACT-PARTIAL",
          run_tray_status: "实验已完成",
          sub_experiment_code: impactSubExperimentCode,
          task_code: taskCode,
          tray_code: trayCode,
        },
        {
          ended_at: "2026-06-28 11:00:00",
          experiment_code: combinedExperimentCode,
          run_no: "RUN-COMBINED-DONE",
          run_tray_status: "实验已完成",
          task_code: taskCode,
          tray_code: trayCode,
        },
      ],
      experimentRunSteps: completedImpactAxisCodes.map((axisCode, index) => ({
        axis_code: axisCode,
        experiment_code: impactExperimentCode,
        run_no: "RUN-IMPACT-PARTIAL",
        status: "实验已完成",
        step_no: index + 1,
        sub_experiment_code: impactSubExperimentCode,
        task_code: taskCode,
      })),
      samples: [
        {
          location: "四综合实验室",
          status: "实验已完成",
          task_code: taskCode,
          trays: [{ quantity: 1, status: "实验已完成", tray_code: trayCode }],
        },
      ],
    });
    const labels = view.steps.map((step) => step.label);
    const partialIndex = labels.indexOf("冲击试验部分完成 2/6轴");
    const combinedIndex = labels.indexOf("四综合试验已完成");

    expect(partialIndex).toBeGreaterThan(-1);
    expect(combinedIndex).toBeGreaterThan(-1);
    expect(partialIndex).toBeLessThan(combinedIndex);
    expect(view.steps[partialIndex]).toEqual(expect.objectContaining({
      reached: true,
      time: "2026-06-28 10:00:00",
    }));
    expect(view.steps[combinedIndex]).toEqual(expect.objectContaining({
      reached: true,
      time: "2026-06-28 11:00:00",
    }));
  });

  test("buildTrayFlowView keeps the running time before a restored partial-axis status", () => {
    const taskCode = "SYLU-2026-12-001";
    const trayCode = `${taskCode}-TP-001`;
    const impactExperimentCode = `${taskCode}-A`;
    const combinedExperimentCode = `${taskCode}-C`;
    const impactSubExperimentCode = `${impactExperimentCode}-AXIS-001`;
    const completedAxisCodes = ["x+", "x-", "y+"];
    const view = buildTrayFlowView({
      taskCode,
      trayCode,
      location: "冲击一室",
      status: "冲击试验部分完成 3/6轴",
      experiments: [
        {
          axis_codes: ["x+", "x-", "y+", "y-", "z+", "z-"],
          experiment_code: impactExperimentCode,
          experiment_name: "冲击试验",
          required_device: "冲击试验",
          task_code: taskCode,
        },
        {
          experiment_code: combinedExperimentCode,
          experiment_name: "四综合试验",
          required_device: "四综合试验",
          task_code: taskCode,
        },
      ],
      experimentTrays: [
        { experiment_code: impactExperimentCode, task_code: taskCode, tray_code: trayCode },
        { experiment_code: combinedExperimentCode, task_code: taskCode, tray_code: trayCode },
      ],
      experimentRuns: [
        {
          axis_codes: completedAxisCodes,
          ended_at: "2026-07-01 18:11:23",
          experiment_code: impactExperimentCode,
          run_no: "RUN-IMPACT-PARTIAL",
          started_at: "2026-07-01 18:11:19",
          status: "实验已完成",
          sub_experiment_code: impactSubExperimentCode,
          task_code: taskCode,
          tray_codes: [trayCode],
        },
      ],
      experimentRunTrays: [
        {
          ended_at: "2026-07-01 18:11:23",
          experiment_code: impactExperimentCode,
          run_no: "RUN-IMPACT-PARTIAL",
          run_tray_status: "实验已完成",
          started_at: "2026-07-01 18:11:19",
          sub_experiment_code: impactSubExperimentCode,
          task_code: taskCode,
          tray_code: trayCode,
        },
      ],
      experimentRunSteps: completedAxisCodes.map((axisCode, index) => ({
        axis_code: axisCode,
        ended_at: "2026-07-01 18:11:23",
        experiment_code: impactExperimentCode,
        run_no: "RUN-IMPACT-PARTIAL",
        status: "实验已完成",
        step_no: index + 1,
        sub_experiment_code: impactSubExperimentCode,
        task_code: taskCode,
      })),
      samples: [
        {
          location: "冲击一室",
          status: "冲击试验部分完成 3/6轴",
          task_code: taskCode,
          trays: [
            {
              quantity: 1,
              status: "冲击试验部分完成 3/6轴",
              target_experiment_code: combinedExperimentCode,
              target_lab: "四综合实验室",
              tray_code: trayCode,
            },
          ],
          history: [
            {
              detail: `${taskCode} / 四综合试验 / 撤回至冲击试验部分完成（试验间内撤回当前实验任务）`,
              location: "冲击一室",
              status: "冲击试验部分完成 3/6轴",
              time: "2026-07-01 18:12:20",
              tray_code: trayCode,
            },
            {
              detail: `${taskCode} / 冲击试验 / 实验进行中 / 托盘：${trayCode}`,
              location: "冲击一室",
              status: "实验进行中",
              time: "2026-07-01 18:11:19",
            },
            {
              detail: `${taskCode} / 冲击试验 / 冲击试验部分完成 3/6轴`,
              location: "冲击一室",
              status: "冲击试验部分完成 3/6轴",
              time: "2026-07-01 18:11:23",
              tray_code: trayCode,
            },
          ],
        },
      ],
    });

    expect(view.steps.find((step) => step.label === "冲击试验进行中")).toEqual(expect.objectContaining({
      reached: true,
      time: "2026-07-01 18:11:19",
    }));
  });

  test("buildTrayFlowView keeps the latest completed experiment active after earlier partial axis completion", () => {
    const taskCode = "SYLU-2026-06-021";
    const trayCode = `${taskCode}-TP-001`;
    const impactExperimentCode = `${taskCode}-IMPACT`;
    const combinedExperimentCode = `${taskCode}-COMBINED`;
    const vibrationExperimentCode = `${taskCode}-VIBRATION`;
    const impactSubExperimentCode = `${impactExperimentCode}-AXIS-001`;
    const completedImpactAxisCodes = ["y+", "z+"];
    const view = buildTrayFlowViewRaw({
      location: "四综合实验室",
      status: "实验已完成",
      taskCode,
      trayCode,
      experiments: [
        {
          axis_codes: [...completedImpactAxisCodes, "x+", "x-", "y-", "z-"],
          experiment_code: impactExperimentCode,
          experiment_name: "冲击试验",
          required_device: "冲击一室",
          task_code: taskCode,
        },
        {
          experiment_code: combinedExperimentCode,
          experiment_name: "四综合试验",
          required_device: "四综合实验室",
          task_code: taskCode,
        },
        {
          experiment_code: vibrationExperimentCode,
          experiment_name: "振动试验",
          required_device: "振动二室",
          task_code: taskCode,
        },
      ],
      experimentTrays: [
        { experiment_code: impactExperimentCode, task_code: taskCode, tray_code: trayCode },
        { experiment_code: combinedExperimentCode, task_code: taskCode, tray_code: trayCode },
        { experiment_code: vibrationExperimentCode, task_code: taskCode, tray_code: trayCode },
      ],
      experimentRuns: [
        {
          axis_codes: completedImpactAxisCodes,
          ended_at: "2026-06-28 21:13:01",
          experiment_code: impactExperimentCode,
          run_no: "RUN-IMPACT-PARTIAL",
          status: "实验已完成",
          sub_experiment_code: impactSubExperimentCode,
          task_code: taskCode,
          tray_codes: [trayCode],
        },
        {
          ended_at: "2026-06-28 21:14:27",
          experiment_code: combinedExperimentCode,
          run_no: "RUN-COMBINED-DONE",
          status: "实验已完成",
          task_code: taskCode,
          tray_codes: [trayCode],
        },
      ],
      experimentRunTrays: [
        {
          ended_at: "2026-06-28 21:13:01",
          experiment_code: impactExperimentCode,
          run_no: "RUN-IMPACT-PARTIAL",
          run_tray_status: "实验已完成",
          sub_experiment_code: impactSubExperimentCode,
          task_code: taskCode,
          tray_code: trayCode,
        },
        {
          ended_at: "2026-06-28 21:14:27",
          experiment_code: combinedExperimentCode,
          run_no: "RUN-COMBINED-DONE",
          run_tray_status: "实验已完成",
          task_code: taskCode,
          tray_code: trayCode,
        },
      ],
      experimentRunSteps: completedImpactAxisCodes.map((axisCode, index) => ({
        axis_code: axisCode,
        experiment_code: impactExperimentCode,
        run_no: "RUN-IMPACT-PARTIAL",
        status: "实验已完成",
        step_no: index + 1,
        sub_experiment_code: impactSubExperimentCode,
        task_code: taskCode,
      })),
      samples: [
        {
          location: "四综合实验室",
          status: "实验已完成",
          task_code: taskCode,
          trays: [{ quantity: 1, status: "实验已完成", tray_code: trayCode }],
        },
      ],
    });
    const labels = view.steps.map((step) => step.label);
    const partialIndex = labels.indexOf("冲击试验部分完成 2/6轴");
    const combinedIndex = labels.indexOf("四综合试验已完成");

    expect(partialIndex).toBeGreaterThan(-1);
    expect(combinedIndex).toBeGreaterThan(-1);
    expect(partialIndex).toBeLessThan(combinedIndex);
    expect(view.steps[partialIndex]).toEqual(expect.objectContaining({
      reached: true,
      time: "2026-06-28 21:13:01",
    }));
    expect(view.steps[combinedIndex]).toEqual(expect.objectContaining({
      active: true,
      time: "2026-06-28 21:14:27",
    }));
    expect(view.currentStatus).toBe(`当前托盘：${trayCode} | 当前状态：四综合试验已完成`);
  });

  test("buildTrayFlowView keeps a completed explicit current experiment after its own route steps", () => {
    const taskCode = "SYLU-2026-11-001";
    const trayCode = `${taskCode}-TP-001`;
    const impactExperimentCode = `${taskCode}-A`;
    const combinedExperimentCode = `${taskCode}-B`;
    const saltExperimentCode = `${taskCode}-C`;
    const vibrationExperimentCode = `${taskCode}-D`;

    const view = buildTrayFlowViewRaw({
      currentExperimentCode: combinedExperimentCode,
      dispatchTargetLab: "四综合实验室",
      location: "四综合实验室",
      preferCurrentExperimentCode: true,
      status: "实验已完成",
      taskCode,
      trayCode,
      experiments: [
        {
          experiment_code: impactExperimentCode,
          experiment_name: "冲击试验",
          required_device: "冲击一室",
          task_code: taskCode,
        },
        {
          experiment_code: combinedExperimentCode,
          experiment_name: "四综合试验",
          required_device: "四综合实验室",
          task_code: taskCode,
        },
        {
          experiment_code: saltExperimentCode,
          experiment_name: "盐雾试验",
          required_device: "盐雾试验室",
          task_code: taskCode,
        },
        {
          experiment_code: vibrationExperimentCode,
          experiment_name: "振动试验",
          required_device: "振动一室",
          task_code: taskCode,
        },
      ],
      experimentTrays: [
        { experiment_code: impactExperimentCode, task_code: taskCode, tray_code: trayCode },
        { experiment_code: combinedExperimentCode, task_code: taskCode, tray_code: trayCode },
        { experiment_code: saltExperimentCode, task_code: taskCode, tray_code: trayCode },
        { experiment_code: vibrationExperimentCode, task_code: taskCode, tray_code: trayCode },
      ],
      experimentRuns: [
        {
          ended_at: "2026-07-01 18:59:41",
          experiment_code: impactExperimentCode,
          run_no: "RUN-IMPACT-DONE",
          status: "实验已完成",
          task_code: taskCode,
          tray_codes: [trayCode],
        },
        {
          ended_at: "2026-07-01 19:01:41",
          experiment_code: combinedExperimentCode,
          run_no: "RUN-COMBINED-DONE",
          status: "实验已完成",
          task_code: taskCode,
          tray_codes: [trayCode],
        },
      ],
      experimentRunTrays: [
        {
          ended_at: "2026-07-01 18:59:41",
          experiment_code: impactExperimentCode,
          run_no: "RUN-IMPACT-DONE",
          run_tray_status: "实验已完成",
          task_code: taskCode,
          tray_code: trayCode,
        },
        {
          ended_at: "2026-07-01 19:01:41",
          experiment_code: combinedExperimentCode,
          run_no: "RUN-COMBINED-DONE",
          run_tray_status: "实验已完成",
          task_code: taskCode,
          tray_code: trayCode,
        },
      ],
      samples: [
        {
          code: `${taskCode}-SP-001`,
          location: "四综合实验室",
          status: "实验已完成",
          task_code: taskCode,
          history: [
            {
              action: "实验完成",
              detail: `${taskCode} / 四综合试验 / 实验已完成`,
              location: "四综合实验室",
              status: "实验已完成",
              time: "2026-07-01 19:01:41",
              tray_code: trayCode,
            },
            {
              action: "实验准备",
              detail: `${taskCode} / 四综合试验 / 实验准备就绪 / 托盘：${trayCode}`,
              location: "四综合实验室",
              status: "实验准备就绪",
              time: "2026-07-01 19:00:40",
              tray_code: trayCode,
            },
            {
              action: "工装夹具安装",
              detail: `${taskCode} / 四综合试验 / 工装夹具安装 / 托盘：${trayCode}`,
              location: "四综合实验室",
              status: "工装夹具安装",
              time: "2026-07-01 19:00:12",
              tray_code: trayCode,
            },
            {
              action: "任务比对",
              detail: `${taskCode} / 四综合试验 / 已到达实验室 / 托盘：${trayCode}`,
              location: "四综合实验室",
              status: "已到达实验室",
              time: "2026-07-01 18:59:58",
              tray_code: trayCode,
            },
            {
              action: "送至实验室",
              detail: `${trayCode} -> 四综合实验室`,
              location: "四综合实验室",
              status: "送至实验室",
              time: "2026-07-01 18:59:52",
              tray_code: trayCode,
            },
            {
              action: "实验完成",
              detail: `${taskCode} / 冲击试验 / 实验已完成`,
              location: "冲击一室",
              status: "实验已完成",
              time: "2026-07-01 18:59:41",
              tray_code: trayCode,
            },
          ],
          trays: [
            {
              quantity: 1,
              status: "实验已完成",
              target_experiment_code: combinedExperimentCode,
              target_lab: "四综合实验室",
              tray_code: trayCode,
            },
          ],
        },
      ],
    });

    const labels = view.steps.map((step) => step.label);
    const impactCompletedIndex = labels.indexOf("冲击试验已完成");
    const combinedDispatchIndex = labels.indexOf("送至四综合实验室");
    const combinedReadyIndex = labels.indexOf("实验准备就绪");
    const combinedCompletedIndex = labels.indexOf("四综合试验已完成");
    const saltPendingIndex = labels.indexOf("盐雾试验未完成");

    expect(impactCompletedIndex).toBeGreaterThan(-1);
    expect(combinedDispatchIndex).toBeGreaterThan(-1);
    expect(combinedReadyIndex).toBeGreaterThan(-1);
    expect(combinedCompletedIndex).toBeGreaterThan(-1);
    expect(saltPendingIndex).toBeGreaterThan(-1);
    expect(impactCompletedIndex).toBeLessThan(combinedDispatchIndex);
    expect(combinedDispatchIndex).toBeLessThan(combinedReadyIndex);
    expect(combinedReadyIndex).toBeLessThan(combinedCompletedIndex);
    expect(combinedCompletedIndex).toBeLessThan(saltPendingIndex);
    expect(view.steps[combinedCompletedIndex]).toEqual(expect.objectContaining({
      active: true,
      time: "2026-07-01 19:01:41",
    }));
    expect(view.currentStatus).toBe(`当前托盘：${trayCode} | 当前状态：四综合试验已完成`);
  });

  test("buildTrayFlowView keeps a completed dispatch-target experiment active without a preferred current flag", () => {
    const taskCode = "SYLU-2026-11-001";
    const trayCode = `${taskCode}-TP-001`;
    const impactExperimentCode = `${taskCode}-A`;
    const combinedExperimentCode = `${taskCode}-B`;
    const saltExperimentCode = `${taskCode}-C`;

    const view = buildTrayFlowViewRaw({
      currentExperimentCode: combinedExperimentCode,
      dispatchTargetLab: "四综合实验室",
      location: "四综合实验室",
      status: "实验已完成",
      taskCode,
      trayCode,
      experiments: [
        {
          experiment_code: impactExperimentCode,
          experiment_name: "冲击试验",
          required_device: "冲击一室",
          task_code: taskCode,
        },
        {
          experiment_code: combinedExperimentCode,
          experiment_name: "四综合试验",
          required_device: "四综合实验室",
          task_code: taskCode,
        },
        {
          experiment_code: saltExperimentCode,
          experiment_name: "盐雾试验",
          required_device: "盐雾试验室",
          task_code: taskCode,
        },
      ],
      experimentTrays: [
        { experiment_code: impactExperimentCode, task_code: taskCode, tray_code: trayCode },
        { experiment_code: combinedExperimentCode, task_code: taskCode, tray_code: trayCode },
        { experiment_code: saltExperimentCode, task_code: taskCode, tray_code: trayCode },
      ],
      experimentRuns: [
        {
          ended_at: "2026-07-01 18:59:41",
          experiment_code: impactExperimentCode,
          run_no: "RUN-IMPACT-DONE",
          status: "实验已完成",
          task_code: taskCode,
          tray_codes: [trayCode],
        },
        {
          ended_at: "2026-07-01 19:01:41",
          experiment_code: combinedExperimentCode,
          run_no: "RUN-COMBINED-DONE",
          status: "实验已完成",
          task_code: taskCode,
          tray_codes: [trayCode],
        },
      ],
      experimentRunTrays: [
        {
          ended_at: "2026-07-01 18:59:41",
          experiment_code: impactExperimentCode,
          run_no: "RUN-IMPACT-DONE",
          run_tray_status: "实验已完成",
          task_code: taskCode,
          tray_code: trayCode,
        },
        {
          ended_at: "2026-07-01 19:01:41",
          experiment_code: combinedExperimentCode,
          run_no: "RUN-COMBINED-DONE",
          run_tray_status: "实验已完成",
          task_code: taskCode,
          tray_code: trayCode,
        },
      ],
      samples: [
        {
          code: `${taskCode}-SP-001`,
          history: [
            {
              action: "实验完成",
              detail: `${taskCode} / 四综合试验 / 实验已完成`,
              location: "四综合实验室",
              status: "实验已完成",
              time: "2026-07-01 19:01:41",
              tray_code: trayCode,
            },
            {
              action: "实验准备",
              detail: `${taskCode} / 四综合试验 / 实验准备就绪 / 托盘：${trayCode}`,
              location: "四综合实验室",
              status: "实验准备就绪",
              time: "2026-07-01 19:01:38",
              tray_code: trayCode,
            },
            {
              action: "实验完成",
              detail: `${taskCode} / 冲击试验 / 实验已完成`,
              location: "冲击一室",
              status: "实验已完成",
              time: "2026-07-01 18:59:41",
              tray_code: trayCode,
            },
          ],
          location: "四综合实验室",
          status: "实验已完成",
          task_code: taskCode,
          trays: [
            {
              quantity: 1,
              status: "实验已完成",
              target_experiment_code: combinedExperimentCode,
              target_lab: "四综合实验室",
              tray_code: trayCode,
            },
          ],
        },
      ],
    });

    expect(view.currentStatus).toBe(`当前托盘：${trayCode} | 当前状态：四综合试验已完成`);
    expect(view.steps.find((step) => step.label === "冲击试验已完成")).toEqual(
      expect.objectContaining({ active: false, reached: true, time: "2026-07-01 18:59:41" }),
    );
    expect(view.steps.find((step) => step.label === "四综合试验已完成")).toEqual(
      expect.objectContaining({ active: true, time: "2026-07-01 19:01:41" }),
    );
  });

  test("buildTrayFlowView keeps historical partial axis before later mold completion in folded order", () => {
    const taskCode = "SYLU-2026-06-021";
    const trayCode = `${taskCode}-TP-003`;
    const impactExperimentCode = `${taskCode}-A`;
    const moldExperimentCode = `${taskCode}-B`;
    const impactSubExperimentCode = `${impactExperimentCode}-AXIS-001`;
    const view = buildTrayFlowViewRaw({
      location: "霉菌试验室",
      status: "实验已完成",
      taskCode,
      trayCode,
      experiments: [
        {
          axis_codes: ["x+", "x-", "y+", "y-", "z+", "z-"],
          experiment_code: impactExperimentCode,
          experiment_name: "冲击试验",
          required_device: "冲击二室",
          task_code: taskCode,
        },
        {
          experiment_code: moldExperimentCode,
          experiment_name: "霉菌试验",
          required_device: "霉菌试验室",
          task_code: taskCode,
        },
      ],
      experimentTrays: [
        { experiment_code: impactExperimentCode, task_code: taskCode, tray_code: trayCode },
        { experiment_code: moldExperimentCode, task_code: taskCode, tray_code: trayCode },
      ],
      experimentRuns: [
        {
          axis_codes: ["z+", "z-"],
          ended_at: "2026-06-30 20:17:03",
          experiment_code: impactExperimentCode,
          run_no: "RUN-IMPACT-PARTIAL",
          status: "实验已完成",
          sub_experiment_code: impactSubExperimentCode,
          task_code: taskCode,
          tray_codes: [trayCode],
        },
        {
          ended_at: "2026-06-30 20:27:03",
          experiment_code: moldExperimentCode,
          run_no: "RUN-MOLD-DONE",
          status: "实验已完成",
          task_code: taskCode,
          tray_codes: [trayCode],
        },
      ],
      experimentRunTrays: [
        {
          ended_at: "2026-06-30 20:17:03",
          experiment_code: impactExperimentCode,
          run_no: "RUN-IMPACT-PARTIAL",
          run_tray_status: "实验已完成",
          sub_experiment_code: impactSubExperimentCode,
          task_code: taskCode,
          tray_code: trayCode,
        },
        {
          ended_at: "2026-06-30 20:27:03",
          experiment_code: moldExperimentCode,
          run_no: "RUN-MOLD-DONE",
          run_tray_status: "实验已完成",
          task_code: taskCode,
          tray_code: trayCode,
        },
      ],
      experimentRunSteps: ["z+", "z-"].map((axisCode, index) => ({
        axis_code: axisCode,
        experiment_code: impactExperimentCode,
        run_no: "RUN-IMPACT-PARTIAL",
        status: "实验已完成",
        step_no: index + 1,
        sub_experiment_code: impactSubExperimentCode,
        task_code: taskCode,
      })),
      samples: [
        {
          history: [
            {
              action: "实验完成",
              detail: `${taskCode} / 霉菌试验 / 实验已完成`,
              location: "霉菌试验室",
              status: "实验已完成",
              time: "2026-06-30 20:27:03",
              tray_code: trayCode,
            },
            {
              action: "任务比对",
              detail: `${taskCode} / 霉菌试验 / 已到达实验室 / 托盘：${trayCode}`,
              location: "霉菌试验室",
              status: "已到达实验室",
              time: "2026-06-30 20:26:47",
              tray_code: trayCode,
            },
            {
              action: "实验完成",
              detail: `${taskCode} / 冲击试验 / 冲击试验部分完成 2/6轴`,
              location: "冲击二室",
              status: "冲击试验部分完成 2/6轴",
              time: "2026-06-30 20:17:03",
              tray_code: trayCode,
            },
            {
              action: "送至实验室",
              detail: `${trayCode} -> 冲击二室`,
              location: "冲击二室",
              status: "送至实验室",
              time: "2026-06-30 20:16:43",
              tray_code: trayCode,
            },
          ],
          location: "霉菌试验室",
          status: "实验已完成",
          task_code: taskCode,
          trays: [{ quantity: 1, status: "实验已完成", tray_code: trayCode }],
        },
      ],
    });

    const labels = view.steps.map((step) => step.label);
    expect(labels).toEqual([
      "样品运输中",
      "到货",
      "冲击试验部分完成 2/6轴",
      "霉菌试验已完成",
      "送至暂存间",
      "已到达暂存间",
      "待继续冲击试验：剩余 4/6轴",
      "厂家收回",
    ]);
    expect(labels.indexOf("冲击试验部分完成 2/6轴")).toBeLessThan(labels.indexOf("霉菌试验已完成"));
    expect(labels.indexOf("霉菌试验已完成")).toBeLessThan(labels.indexOf("送至暂存间"));
    expect(labels.indexOf("送至暂存间")).toBeLessThan(labels.indexOf("已到达暂存间"));
    expect(labels.indexOf("霉菌试验已完成")).toBeLessThan(labels.indexOf("已到达暂存间"));
    expect(view.steps.find((step) => step.label === "冲击试验部分完成 2/6轴")).toEqual(expect.objectContaining({
      active: false,
      reached: true,
      time: "2026-06-30 20:17:03",
    }));
    expect(view.steps.find((step) => step.label === "霉菌试验已完成")).toEqual(expect.objectContaining({
      active: true,
      time: "2026-06-30 20:27:03",
    }));
    expect(view.steps.find((step) => step.label === "已到达暂存间")).toEqual(expect.objectContaining({
      active: false,
      reached: false,
      time: "",
    }));
    expect(view.steps.find((step) => step.label === "待继续冲击试验：剩余 4/6轴")).toEqual(expect.objectContaining({
      active: false,
      reached: false,
    }));
    expect(view.steps.find((step) => step.label === "送至霉菌试验室")).toBeUndefined();
    expect(view.currentStatus).toBe(`当前托盘：${trayCode} | 当前状态：霉菌试验已完成`);
  });

  test("buildTrayFlowView uses tray-scoped compare history ahead of older partial axis runtime", () => {
    const taskCode = "SYLU-2026-07-001";
    const trayCode = `${taskCode}-TP-001`;
    const impactExperimentCode = `${taskCode}-A`;
    const saltExperimentCode = `${taskCode}-B`;
    const vibrationExperimentCode = `${taskCode}-C`;
    const combinedExperimentCode = `${taskCode}-D`;
    const view = buildTrayFlowView({
      location: "冲击一室",
      status: "已到达实验室",
      taskCode,
      trayCode,
      experiments: [
        {
          axis_codes: ["x+", "x-", "y+", "y-", "z+", "z-"],
          experiment_code: impactExperimentCode,
          experiment_name: "冲击试验",
          required_device: "冲击试验",
          task_code: taskCode,
        },
        {
          experiment_code: saltExperimentCode,
          experiment_name: "盐雾试验",
          required_device: "盐雾试验",
          task_code: taskCode,
        },
        {
          axis_codes: ["x+", "x-", "y+", "y-", "z+", "z-"],
          experiment_code: vibrationExperimentCode,
          experiment_name: "振动试验",
          required_device: "振动试验",
          task_code: taskCode,
        },
        {
          experiment_code: combinedExperimentCode,
          experiment_name: "四综合试验",
          required_device: "四综合试验",
          task_code: taskCode,
        },
      ],
      experimentTrays: [
        { experiment_code: impactExperimentCode, task_code: taskCode, tray_code: trayCode },
        { experiment_code: saltExperimentCode, task_code: taskCode, tray_code: trayCode },
        { experiment_code: vibrationExperimentCode, task_code: taskCode, tray_code: trayCode },
        { experiment_code: combinedExperimentCode, task_code: taskCode, tray_code: trayCode },
      ],
      experimentRuns: [
        {
          axis_codes: ["x+", "x-", "y+"],
          ended_at: "2026-06-30 21:03:04",
          experiment_code: impactExperimentCode,
          run_no: "RUN-IMPACT-FIRST",
          status: "实验已完成",
          sub_experiment_code: `${impactExperimentCode}-AXIS-001`,
          task_code: taskCode,
          tray_codes: [trayCode],
        },
        {
          axis_codes: ["x+", "x-", "y+"],
          ended_at: "2026-06-30 21:03:23",
          experiment_code: vibrationExperimentCode,
          run_no: "RUN-VIBRATION-FIRST",
          status: "实验已完成",
          sub_experiment_code: `${vibrationExperimentCode}-AXIS-001`,
          task_code: taskCode,
          tray_codes: [trayCode],
        },
      ],
      experimentRunTrays: [
        {
          ended_at: "2026-06-30 21:03:04",
          experiment_code: impactExperimentCode,
          run_no: "RUN-IMPACT-FIRST",
          run_tray_status: "实验已完成",
          sub_experiment_code: `${impactExperimentCode}-AXIS-001`,
          task_code: taskCode,
          tray_code: trayCode,
        },
        {
          ended_at: "2026-06-30 21:03:23",
          experiment_code: vibrationExperimentCode,
          run_no: "RUN-VIBRATION-FIRST",
          run_tray_status: "实验已完成",
          sub_experiment_code: `${vibrationExperimentCode}-AXIS-001`,
          task_code: taskCode,
          tray_code: trayCode,
        },
      ],
      experimentRunSteps: [
        ...["x+", "x-", "y+"].map((axisCode) => ({
          axis_code: axisCode,
          experiment_code: impactExperimentCode,
          run_no: "RUN-IMPACT-FIRST",
          status: "实验已完成",
          sub_experiment_code: `${impactExperimentCode}-AXIS-001`,
          task_code: taskCode,
        })),
        ...["x+", "x-", "y+"].map((axisCode) => ({
          axis_code: axisCode,
          experiment_code: vibrationExperimentCode,
          run_no: "RUN-VIBRATION-FIRST",
          status: "实验已完成",
          sub_experiment_code: `${vibrationExperimentCode}-AXIS-001`,
          task_code: taskCode,
        })),
      ],
      samples: [
        {
          code: `${taskCode}-SP-001`,
          history: [
            {
              action: "任务比对",
              detail: `${taskCode} / 冲击试验 / 已到达实验室 / 托盘：${trayCode}`,
              location: "冲击一室",
              status: "已到达实验室",
              time: "2026-06-30 21:03:38",
            },
            {
              action: "实验完成",
              detail: `${taskCode} / 振动试验 / 振动试验部分完成 3/6轴`,
              location: "振动一室",
              status: "振动试验部分完成 3/6轴",
              time: "2026-06-30 21:03:23",
            },
            {
              action: "实验确认",
              detail: `${taskCode} / 振动试验 / 实验准备就绪 / 托盘：${trayCode}`,
              location: "振动一室",
              status: "实验准备就绪",
              time: "2026-06-30 21:03:18",
            },
            {
              action: "实验完成",
              detail: `${taskCode} / 冲击试验 / 冲击试验部分完成 3/6轴`,
              location: "冲击一室",
              status: "冲击试验部分完成 3/6轴",
              time: "2026-06-30 21:03:04",
            },
            {
              action: "实验确认",
              detail: `${taskCode} / 冲击试验 / 实验准备就绪 / 托盘：${trayCode}`,
              location: "冲击一室",
              status: "实验准备就绪",
              time: "2026-06-30 21:03:00",
            },
            {
              action: "送至实验室",
              detail: `${trayCode} -> 冲击一室`,
              location: "冲击一室",
              status: "送至实验室",
              time: "2026-06-30 21:02:46",
            },
          ],
          location: "冲击一室",
          status: "已到达实验室",
          task_code: taskCode,
          trays: [
            {
              quantity: 1,
              status: "已到达实验室",
              target_experiment_code: impactExperimentCode,
              target_lab: "冲击一室",
              tray_code: trayCode,
            },
          ],
        },
      ],
      schedules: [
        {
          axis_codes: ["x+", "x-", "y+"],
          device: "冲击一室",
          experiment_code: impactExperimentCode,
          status: "实验进行中",
          sub_experiment_code: `${impactExperimentCode}-AXIS-001`,
          task_code: taskCode,
        },
        {
          axis_codes: ["y-", "z+", "z-"],
          device: "冲击一室",
          experiment_code: impactExperimentCode,
          status: "已排程",
          sub_experiment_code: `${impactExperimentCode}-AXIS-002`,
          task_code: taskCode,
        },
        {
          axis_codes: ["x+", "x-", "y+"],
          device: "振动一室",
          experiment_code: vibrationExperimentCode,
          status: "实验进行中",
          sub_experiment_code: `${vibrationExperimentCode}-AXIS-001`,
          task_code: taskCode,
        },
      ],
    });

    const labels = view.steps.map((step) => step.label);
    expect(labels.filter((label) => label === "冲击试验部分完成 3/6轴")).toHaveLength(1);
    expect(labels.indexOf("冲击试验部分完成 3/6轴")).toBeLessThan(labels.indexOf("振动试验部分完成 3/6轴"));
    expect(labels.indexOf("振动试验部分完成 3/6轴")).toBeLessThan(labels.indexOf("送至冲击一室"));
    expect(view.currentStatus).toBe(`当前托盘：${trayCode} | 当前状态：已到达实验室`);
    expect(view.steps.find((step) => step.label === "已到达实验室")).toEqual(expect.objectContaining({ active: true }));
    ["工装夹具安装", "实验准备就绪", "冲击试验进行中"].forEach((label) => {
      expect(view.steps.find((step) => step.label === label)).toEqual(
        expect.objectContaining({ active: false, reached: false }),
      );
    });
  });

  test("buildTrayFlowView keeps appearance dispatch to lab ahead of older partial axis runtime", () => {
    const taskCode = "SYLU-2026-06-021";
    const trayCode = `${taskCode}-TP-001`;
    const impactExperimentCode = `${taskCode}-A`;
    const moldExperimentCode = `${taskCode}-B`;
    const vibrationExperimentCode = `${taskCode}-C`;
    const view = buildTrayFlowView({
      location: "冲击二室",
      status: "送至实验室",
      taskCode,
      trayCode,
      experiments: [
        {
          axis_codes: ["x+", "x-", "y+", "y-", "z+", "z-"],
          experiment_code: impactExperimentCode,
          experiment_name: "冲击试验",
          required_device: "冲击试验",
          task_code: taskCode,
        },
        {
          experiment_code: moldExperimentCode,
          experiment_name: "霉菌试验",
          required_device: "霉菌试验",
          task_code: taskCode,
        },
        {
          axis_codes: ["x+", "x-", "y+", "y-", "z+", "z-"],
          experiment_code: vibrationExperimentCode,
          experiment_name: "振动试验",
          required_device: "振动试验",
          task_code: taskCode,
        },
      ],
      experimentTrays: [
        { experiment_code: impactExperimentCode, task_code: taskCode, tray_code: trayCode },
        { experiment_code: moldExperimentCode, task_code: taskCode, tray_code: trayCode },
        { experiment_code: vibrationExperimentCode, task_code: taskCode, tray_code: trayCode },
      ],
      experimentRuns: [
        {
          axis_codes: ["z+", "z-"],
          ended_at: "2026-06-30 21:41:01",
          experiment_code: impactExperimentCode,
          run_no: "RUN-IMPACT-FIRST",
          status: "实验已完成",
          sub_experiment_code: `${impactExperimentCode}-AXIS-001`,
          task_code: taskCode,
          tray_codes: [trayCode],
        },
        {
          ended_at: "2026-06-30 21:42:22",
          experiment_code: moldExperimentCode,
          run_no: "RUN-MOLD",
          status: "实验已完成",
          task_code: taskCode,
          tray_codes: [trayCode],
        },
        {
          axis_codes: ["z+", "z-"],
          ended_at: "2026-06-30 21:41:50",
          experiment_code: vibrationExperimentCode,
          run_no: "RUN-VIBRATION-FIRST",
          status: "实验已完成",
          sub_experiment_code: `${vibrationExperimentCode}-AXIS-001`,
          task_code: taskCode,
          tray_codes: [trayCode],
        },
      ],
      experimentRunTrays: [
        {
          ended_at: "2026-06-30 21:41:01",
          experiment_code: impactExperimentCode,
          run_no: "RUN-IMPACT-FIRST",
          run_tray_status: "实验已完成",
          sub_experiment_code: `${impactExperimentCode}-AXIS-001`,
          task_code: taskCode,
          tray_code: trayCode,
        },
        {
          ended_at: "2026-06-30 21:42:22",
          experiment_code: moldExperimentCode,
          run_no: "RUN-MOLD",
          run_tray_status: "实验已完成",
          task_code: taskCode,
          tray_code: trayCode,
        },
        {
          ended_at: "2026-06-30 21:41:50",
          experiment_code: vibrationExperimentCode,
          run_no: "RUN-VIBRATION-FIRST",
          run_tray_status: "实验已完成",
          sub_experiment_code: `${vibrationExperimentCode}-AXIS-001`,
          task_code: taskCode,
          tray_code: trayCode,
        },
      ],
      experimentRunSteps: [
        ...["z+", "z-"].map((axisCode) => ({
          axis_code: axisCode,
          experiment_code: impactExperimentCode,
          run_no: "RUN-IMPACT-FIRST",
          status: "实验已完成",
          sub_experiment_code: `${impactExperimentCode}-AXIS-001`,
          task_code: taskCode,
        })),
        ...["z+", "z-"].map((axisCode) => ({
          axis_code: axisCode,
          experiment_code: vibrationExperimentCode,
          run_no: "RUN-VIBRATION-FIRST",
          status: "实验已完成",
          sub_experiment_code: `${vibrationExperimentCode}-AXIS-001`,
          task_code: taskCode,
        })),
      ],
      samples: [
        {
          code: `${taskCode}-SP-001`,
          history: [
            {
              action: "外观检测间扫码出库",
              detail: `${trayCode} 送至 冲击二室`,
              location: "冲击二室",
              status: "送至实验室",
              time: "2026-06-30 21:42:49",
            },
            {
              action: "外观检测间扫码入库",
              detail: `${trayCode} 实验后外观检测间存放`,
              location: "外观检测间",
              status: "实验后外观检测间存放",
              time: "2026-06-30 21:42:45",
            },
            {
              action: "实验完成",
              detail: `${taskCode} / 霉菌试验 / 实验已完成`,
              location: "霉菌试验室",
              status: "实验已完成",
              time: "2026-06-30 21:42:22",
            },
            {
              action: "实验完成",
              detail: `${taskCode} / 振动试验 / 振动试验部分完成 2/6轴`,
              location: "振动二室",
              status: "振动试验部分完成 2/6轴",
              time: "2026-06-30 21:41:50",
            },
            {
              action: "实验确认",
              detail: `${taskCode} / 振动试验 / 实验准备就绪 / 托盘：${trayCode}`,
              location: "振动二室",
              status: "实验准备就绪",
              time: "2026-06-30 21:41:45",
            },
            {
              action: "实验完成",
              detail: `${taskCode} / 冲击试验 / 冲击试验部分完成 2/6轴`,
              location: "冲击二室",
              status: "冲击试验部分完成 2/6轴",
              time: "2026-06-30 21:41:01",
            },
            {
              action: "实验确认",
              detail: `${taskCode} / 冲击试验 / 实验准备就绪 / 托盘：${trayCode}`,
              location: "冲击二室",
              status: "实验准备就绪",
              time: "2026-06-30 21:40:55",
            },
            {
              action: "送至实验室",
              detail: `${trayCode} -> 冲击二室`,
              location: "冲击二室",
              status: "送至实验室",
              time: "2026-06-30 21:40:44",
            },
            {
              action: "任务已确认入库",
              detail: taskCode,
              location: "接驳区",
              status: "到货",
              time: "2026-06-30 21:40:39",
            },
            {
              action: "样品分装托盘",
              detail: trayCode,
              location: "",
              status: "运输中",
              time: "2026-06-30 21:39:34",
            },
          ],
          location: "冲击二室",
          status: "送至实验室",
          task_code: taskCode,
          trays: [
            {
              quantity: 1,
              status: "送至实验室",
              target_experiment_code: impactExperimentCode,
              target_lab: "冲击二室",
              tray_code: trayCode,
              updated_at: "2026-06-30 21:42:49",
            },
          ],
        },
      ],
      schedules: [
        {
          axis_codes: ["z+", "z-"],
          device: "冲击二室",
          experiment_code: impactExperimentCode,
          status: "实验已完成",
          sub_experiment_code: `${impactExperimentCode}-AXIS-001`,
          task_code: taskCode,
        },
        {
          axis_codes: ["y+", "y-"],
          device: "冲击二室",
          experiment_code: impactExperimentCode,
          status: "已排程",
          sub_experiment_code: `${impactExperimentCode}-AXIS-002`,
          task_code: taskCode,
        },
        {
          device: "霉菌试验室",
          experiment_code: moldExperimentCode,
          status: "实验已完成",
          task_code: taskCode,
        },
        {
          axis_codes: ["z+", "z-"],
          device: "振动二室",
          experiment_code: vibrationExperimentCode,
          status: "实验已完成",
          sub_experiment_code: `${vibrationExperimentCode}-AXIS-001`,
          task_code: taskCode,
        },
      ],
    });

    const labels = view.steps.map((step) => step.label);
    expect(view.currentStatus).toBe(`当前托盘：${trayCode} | 当前状态：送至冲击二室`);
    expect(labels.filter((label) => label === "冲击试验部分完成 2/6轴")).toHaveLength(1);
    expect(labels.indexOf("冲击试验部分完成 2/6轴")).toBeLessThan(labels.indexOf("霉菌试验已完成"));
    expect(labels.indexOf("实验后外观检测间存放")).toBeLessThan(labels.indexOf("送至冲击二室"));
    expect(labels).toEqual(expect.arrayContaining(["送至暂存间", "已到达暂存间"]));
    expect(view.steps.find((step) => step.label === "送至冲击二室")).toEqual(
      expect.objectContaining({ active: true, time: "2026-06-30 21:42:49" }),
    );
    ["已到达实验室", "工装夹具安装", "实验准备就绪", "冲击试验进行中"].forEach((label) => {
      expect(view.steps.find((step) => step.label === label)).toEqual(
        expect.objectContaining({ active: false, reached: false }),
      );
    });
  });

  test("buildTrayFlowView keeps current partial axis completion before future unfinished experiments and route steps", () => {
    const taskCode = "SYLU-2026-09-001";
    const trayCode = `${taskCode}-TP-001`;
    const impactExperimentCode = `${taskCode}-A`;
    const combinedExperimentCode = `${taskCode}-B`;
    const saltExperimentCode = `${taskCode}-C`;
    const vibrationExperimentCode = `${taskCode}-D`;
    const impactFirstSubExperimentCode = `${impactExperimentCode}-AXIS-001`;
    const completedImpactAxisCodes = ["x+", "x-", "y+"];
    const remainingImpactAxisCodes = ["y-", "z+", "z-"];
    const view = buildTrayFlowView({
      currentExperimentCode: impactExperimentCode,
      dispatchTargetLab: "冲击一室",
      location: "冲击一室",
      status: "冲击试验部分完成 3/6轴",
      taskCode,
      trayCode,
      experiments: [
        {
          axis_codes: [...completedImpactAxisCodes, ...remainingImpactAxisCodes],
          experiment_code: impactExperimentCode,
          experiment_name: "冲击试验",
          required_device: "冲击试验",
          task_code: taskCode,
        },
        {
          experiment_code: combinedExperimentCode,
          experiment_name: "四综合试验",
          required_device: "四综合试验",
          task_code: taskCode,
        },
        {
          experiment_code: saltExperimentCode,
          experiment_name: "盐雾试验",
          required_device: "盐雾试验",
          task_code: taskCode,
        },
        {
          axis_codes: ["x+", "x-", "y+", "y-", "z+", "z-"],
          experiment_code: vibrationExperimentCode,
          experiment_name: "振动试验",
          required_device: "振动试验",
          task_code: taskCode,
        },
      ],
      experimentTrays: [
        { experiment_code: impactExperimentCode, task_code: taskCode, tray_code: trayCode },
        { experiment_code: combinedExperimentCode, task_code: taskCode, tray_code: trayCode },
        { experiment_code: saltExperimentCode, task_code: taskCode, tray_code: trayCode },
        { experiment_code: vibrationExperimentCode, task_code: taskCode, tray_code: trayCode },
      ],
      experimentRuns: [
        {
          axis_codes: completedImpactAxisCodes,
          ended_at: "2026-06-30 17:34:02",
          experiment_code: impactExperimentCode,
          run_no: "RUN-IMPACT-PARTIAL",
          status: "实验已完成",
          sub_experiment_code: impactFirstSubExperimentCode,
          task_code: taskCode,
          tray_codes: [trayCode],
        },
        {
          ended_at: "2026-06-30 17:33:29",
          experiment_code: combinedExperimentCode,
          run_no: "RUN-COMBINED-DONE",
          status: "实验已完成",
          task_code: taskCode,
          tray_codes: [trayCode],
        },
      ],
      experimentRunTrays: [
        {
          ended_at: "2026-06-30 17:34:02",
          experiment_code: impactExperimentCode,
          run_no: "RUN-IMPACT-PARTIAL",
          run_tray_status: "实验已完成",
          sub_experiment_code: impactFirstSubExperimentCode,
          task_code: taskCode,
          tray_code: trayCode,
        },
        {
          ended_at: "2026-06-30 17:33:29",
          experiment_code: combinedExperimentCode,
          run_no: "RUN-COMBINED-DONE",
          run_tray_status: "实验已完成",
          task_code: taskCode,
          tray_code: trayCode,
        },
      ],
      experimentRunSteps: completedImpactAxisCodes.map((axisCode, index) => ({
        axis_code: axisCode,
        ended_at: "2026-06-30 17:34:02",
        experiment_code: impactExperimentCode,
        run_no: "RUN-IMPACT-PARTIAL",
        status: "实验已完成",
        step_no: index + 1,
        sub_experiment_code: impactFirstSubExperimentCode,
        task_code: taskCode,
      })),
      samples: [
        {
          location: "冲击一室",
          status: "冲击试验部分完成 3/6轴",
          task_code: taskCode,
          trays: [
            {
              quantity: 1,
              status: "冲击试验部分完成 3/6轴",
              target_experiment_code: impactExperimentCode,
              target_lab: "冲击一室",
              tray_code: trayCode,
            },
          ],
        },
      ],
      schedules: [
        {
          axis_codes: completedImpactAxisCodes,
          experiment_code: impactExperimentCode,
          status: "实验已完成",
          sub_experiment_code: impactFirstSubExperimentCode,
          task_code: taskCode,
        },
        {
          axis_codes: remainingImpactAxisCodes,
          experiment_code: impactExperimentCode,
          status: "已排程",
          sub_experiment_code: `${impactExperimentCode}-AXIS-002`,
          task_code: taskCode,
        },
        { experiment_code: saltExperimentCode, status: "已排程", task_code: taskCode },
        { experiment_code: vibrationExperimentCode, status: "已排程", task_code: taskCode },
      ],
    });

    const labels = view.steps.map((step) => step.label);
    const partialIndex = labels.indexOf("冲击试验部分完成 3/6轴");

    expect(view.currentStatus).toBe(`当前托盘：${trayCode} | 当前状态：冲击试验部分完成 3/6轴`);
    expect(partialIndex).toBeGreaterThan(labels.indexOf("冲击试验进行中"));
    expect(partialIndex).toBeLessThan(labels.indexOf("盐雾试验未完成"));
    expect(partialIndex).toBeLessThan(labels.indexOf("振动试验未完成"));
    expect(labels.indexOf("送至冲击一室")).toBeLessThan(partialIndex);
    expect(view.steps[partialIndex]).toEqual(expect.objectContaining({
      active: true,
      time: "2026-06-30 17:34:02",
    }));
  });

  test("buildTrayFlowView keeps inferred staging steps before a directly tested partial axis tray", () => {
    const taskCode = "SYLU-2026-07-001";
    const trayCode = `${taskCode}-TP-001`;
    const impactExperimentCode = `${taskCode}-A`;
    const impactFirstSubExperimentCode = `${impactExperimentCode}-AXIS-001`;
    const completedImpactAxisCodes = ["x+", "x-", "y+"];
    const view = buildTrayFlowView({
      currentExperimentCode: impactExperimentCode,
      dispatchTargetLab: "冲击一室",
      location: "冲击一室",
      status: "冲击试验部分完成 3/6轴",
      taskCode,
      trayCode,
      experiments: [
        {
          axis_codes: [...completedImpactAxisCodes, "y-", "z+", "z-"],
          experiment_code: impactExperimentCode,
          experiment_name: "冲击试验",
          required_device: "冲击试验",
          task_code: taskCode,
        },
        { experiment_code: `${taskCode}-B`, experiment_name: "盐雾试验", required_device: "盐雾试验", task_code: taskCode },
      ],
      experimentTrays: [
        { experiment_code: impactExperimentCode, task_code: taskCode, tray_code: trayCode },
        { experiment_code: `${taskCode}-B`, task_code: taskCode, tray_code: trayCode },
      ],
      experimentRuns: [
        {
          axis_codes: completedImpactAxisCodes,
          ended_at: "2026-06-30 19:29:39",
          experiment_code: impactExperimentCode,
          run_no: "RUN-IMPACT-PARTIAL",
          status: "实验已完成",
          sub_experiment_code: impactFirstSubExperimentCode,
          task_code: taskCode,
          tray_codes: [trayCode],
        },
      ],
      experimentRunTrays: [
        {
          ended_at: "2026-06-30 19:29:39",
          experiment_code: impactExperimentCode,
          run_no: "RUN-IMPACT-PARTIAL",
          run_tray_status: "实验已完成",
          sub_experiment_code: impactFirstSubExperimentCode,
          task_code: taskCode,
          tray_code: trayCode,
        },
      ],
      experimentRunSteps: completedImpactAxisCodes.map((axisCode, index) => ({
        axis_code: axisCode,
        ended_at: "2026-06-30 19:29:39",
        experiment_code: impactExperimentCode,
        run_no: "RUN-IMPACT-PARTIAL",
        status: "实验已完成",
        step_no: index + 1,
        sub_experiment_code: impactFirstSubExperimentCode,
        task_code: taskCode,
      })),
      samples: [
        {
          history: [
            { action: "实验完成", detail: `${taskCode} / 冲击试验 / 冲击试验部分完成 3/6轴`, location: "冲击一室", status: "冲击试验部分完成 3/6轴", time: "2026-06-30 19:29:39" },
            { action: "开始实验", detail: `${taskCode} / 冲击试验 / 实验进行中 / 托盘：${trayCode}`, location: "冲击一室", status: "实验进行中", time: "2026-06-30 19:29:29" },
            { action: "任务比对", detail: `${taskCode} / 冲击试验 / 已到达实验室 / 托盘：${trayCode}`, location: "冲击一室", status: "已到达实验室", time: "2026-06-30 19:29:13" },
            { action: "送至实验室", detail: `${trayCode} -> 冲击一室`, location: "冲击一室", status: "送至实验室", time: "2026-06-30 19:29:01" },
            { action: "任务已确认入库", detail: taskCode, location: "接驳区", status: "到货", time: "2026-06-30 19:28:55" },
          ],
          location: "冲击一室",
          status: "冲击试验部分完成 3/6轴",
          task_code: taskCode,
          trays: [
            {
              quantity: 1,
              status: "冲击试验部分完成 3/6轴",
              target_experiment_code: impactExperimentCode,
              target_lab: "冲击一室",
              tray_code: trayCode,
            },
          ],
        },
      ],
      schedules: [
        {
          axis_codes: completedImpactAxisCodes,
          experiment_code: impactExperimentCode,
          status: "实验进行中",
          sub_experiment_code: impactFirstSubExperimentCode,
          task_code: taskCode,
        },
        {
          axis_codes: ["y-", "z+", "z-"],
          experiment_code: impactExperimentCode,
          status: "已排程",
          sub_experiment_code: `${impactExperimentCode}-AXIS-002`,
          task_code: taskCode,
        },
      ],
    });

    const labels = view.steps.map((step) => step.label);

    expect(labels).toEqual(expect.arrayContaining([
      "送至暂存间",
      "已到达暂存间",
      "送至冲击一室",
      "已到达实验室",
      "冲击试验进行中",
      "冲击试验部分完成 3/6轴",
    ]));
    expect(labels.indexOf("送至暂存间")).toBeGreaterThan(labels.indexOf("到货"));
    expect(labels.indexOf("已到达暂存间")).toBeGreaterThan(labels.indexOf("送至暂存间"));
    expect(labels.indexOf("已到达暂存间")).toBeLessThan(labels.indexOf("送至冲击一室"));
    expect(view.steps.find((step) => step.label === "送至暂存间")).toEqual(
      expect.objectContaining({ reached: true, active: false, time: "" }),
    );
    expect(view.steps.find((step) => step.label === "已到达暂存间")).toEqual(
      expect.objectContaining({ reached: true, active: false, time: "" }),
    );
    expect(labels.indexOf("冲击试验部分完成 3/6轴")).toBeLessThan(labels.indexOf("盐雾试验未完成"));
  });

  test("buildTrayFlowView lets current vibration arrival outrank its historical partial axis completion", () => {
    const taskCode = "SYLU-2026-07-001";
    const trayCode = `${taskCode}-TP-002`;
    const impactExperimentCode = `${taskCode}-IMPACT`;
    const vibrationExperimentCode = `${taskCode}-VIBRATION`;
    const impactFirstSubExperimentCode = `${impactExperimentCode}-AXIS-001`;
    const impactRemainingSubExperimentCode = `${impactExperimentCode}-AXIS-002`;
    const vibrationFirstSubExperimentCode = `${vibrationExperimentCode}-AXIS-001`;
    const vibrationRemainingSubExperimentCode = `${vibrationExperimentCode}-AXIS-002`;
    const firstAxisCodes = ["x+", "x-", "y+"];
    const remainingAxisCodes = ["y-", "z+", "z-"];
    const allAxisCodes = [...firstAxisCodes, ...remainingAxisCodes];
    const view = buildTrayFlowViewRaw({
      currentExperimentCode: vibrationExperimentCode,
      dispatchTargetLab: "振动二室",
      location: "振动二室",
      status: "已到达实验室",
      taskCode,
      trayCode,
      experiments: [
        {
          axis_codes: allAxisCodes,
          experiment_code: impactExperimentCode,
          experiment_name: "冲击试验",
          required_device: "冲击一室",
          task_code: taskCode,
        },
        {
          axis_codes: allAxisCodes,
          experiment_code: vibrationExperimentCode,
          experiment_name: "振动试验",
          required_device: "振动二室",
          task_code: taskCode,
        },
      ],
      experimentTrays: [
        { experiment_code: impactExperimentCode, task_code: taskCode, tray_code: trayCode },
        { experiment_code: vibrationExperimentCode, task_code: taskCode, tray_code: trayCode },
      ],
      experimentRuns: [
        {
          axis_codes: firstAxisCodes,
          ended_at: "2026-06-29 09:00:00",
          experiment_code: impactExperimentCode,
          run_no: "RUN-IMPACT-FIRST",
          status: "实验已完成",
          sub_experiment_code: impactFirstSubExperimentCode,
          task_code: taskCode,
          tray_codes: [trayCode],
        },
        {
          axis_codes: firstAxisCodes,
          ended_at: "2026-06-29 10:00:00",
          experiment_code: vibrationExperimentCode,
          run_no: "RUN-VIBRATION-FIRST",
          status: "实验已完成",
          sub_experiment_code: vibrationFirstSubExperimentCode,
          task_code: taskCode,
          tray_codes: [trayCode],
        },
        {
          axis_codes: remainingAxisCodes,
          ended_at: "2026-06-29 11:00:00",
          experiment_code: impactExperimentCode,
          run_no: "RUN-IMPACT-REMAINING",
          status: "实验已完成",
          sub_experiment_code: impactRemainingSubExperimentCode,
          task_code: taskCode,
          tray_codes: [trayCode],
        },
      ],
      experimentRunTrays: [
        {
          ended_at: "2026-06-29 09:00:00",
          experiment_code: impactExperimentCode,
          run_no: "RUN-IMPACT-FIRST",
          run_tray_status: "实验已完成",
          sub_experiment_code: impactFirstSubExperimentCode,
          task_code: taskCode,
          tray_code: trayCode,
        },
        {
          ended_at: "2026-06-29 10:00:00",
          experiment_code: vibrationExperimentCode,
          run_no: "RUN-VIBRATION-FIRST",
          run_tray_status: "实验已完成",
          sub_experiment_code: vibrationFirstSubExperimentCode,
          task_code: taskCode,
          tray_code: trayCode,
        },
        {
          ended_at: "2026-06-29 11:00:00",
          experiment_code: impactExperimentCode,
          run_no: "RUN-IMPACT-REMAINING",
          run_tray_status: "实验已完成",
          sub_experiment_code: impactRemainingSubExperimentCode,
          task_code: taskCode,
          tray_code: trayCode,
        },
      ],
      experimentRunSteps: [
        ...firstAxisCodes.map((axisCode, index) => ({
          axis_code: axisCode,
          experiment_code: impactExperimentCode,
          run_no: "RUN-IMPACT-FIRST",
          status: "实验已完成",
          step_no: index + 1,
          sub_experiment_code: impactFirstSubExperimentCode,
          task_code: taskCode,
        })),
        ...firstAxisCodes.map((axisCode, index) => ({
          axis_code: axisCode,
          experiment_code: vibrationExperimentCode,
          run_no: "RUN-VIBRATION-FIRST",
          status: "实验已完成",
          step_no: index + 1,
          sub_experiment_code: vibrationFirstSubExperimentCode,
          task_code: taskCode,
        })),
        ...remainingAxisCodes.map((axisCode, index) => ({
          axis_code: axisCode,
          experiment_code: impactExperimentCode,
          run_no: "RUN-IMPACT-REMAINING",
          status: "实验已完成",
          step_no: firstAxisCodes.length + index + 1,
          sub_experiment_code: impactRemainingSubExperimentCode,
          task_code: taskCode,
        })),
      ],
      samples: [
        {
          history: [
            {
              action: "任务比对",
              detail: `${taskCode} / 振动试验 / 已到达实验室 / 托盘：${trayCode}`,
              location: "振动二室",
              status: "已到达实验室",
              time: "2026-06-29 11:30:00",
              tray_code: trayCode,
            },
            {
              action: "实验完成",
              detail: `${taskCode} / 冲击试验 / 冲击试验已完成`,
              location: "冲击一室",
              status: "实验已完成",
              time: "2026-06-29 11:00:00",
              tray_code: trayCode,
            },
            {
              action: "实验完成",
              detail: `${taskCode} / 振动试验 / 振动试验部分完成 3/6轴`,
              location: "振动二室",
              status: "振动试验部分完成 3/6轴",
              time: "2026-06-29 10:00:00",
              tray_code: trayCode,
            },
          ],
          location: "振动二室",
          status: "已到达实验室",
          task_code: taskCode,
          trays: [
            {
              quantity: 1,
              status: "已到达实验室",
              target_experiment_code: vibrationExperimentCode,
              target_lab: "振动二室",
              tray_code: trayCode,
            },
          ],
        },
      ],
      schedules: [
        {
          axis_codes: remainingAxisCodes,
          device: "振动二室",
          experiment_code: vibrationExperimentCode,
          id: "schedule-vibration-remaining",
          status: "实验进行中",
          sub_experiment_code: vibrationRemainingSubExperimentCode,
          task_code: taskCode,
        },
      ],
    });

    expect(view.currentStatus).toBe(`当前托盘：${trayCode} | 当前状态：已到达实验室`);
    expect(view.steps.find((step) => step.label === "振动试验部分完成 3/6轴")).toEqual(
      expect.objectContaining({ reached: true, active: false }),
    );
    expect(view.steps.find((step) => step.label === "已到达实验室")).toEqual(
      expect.objectContaining({ active: true }),
    );
  });

  test("buildTrayFlowView does not reuse previous experiment staging times for the current vibration route", () => {
    const taskCode = "SYLU-2026-08-001";
    const trayCode = `${taskCode}-TP-001`;
    const impactExperimentCode = `${taskCode}-A`;
    const vibrationExperimentCode = `${taskCode}-D`;
    const impactSubExperimentCode = `${impactExperimentCode}-AXIS-001`;
    const impactAxisCodes = ["x+", "x-", "y+"];
    const allAxisCodes = [...impactAxisCodes, "y-", "z+", "z-"];
    const view = buildTrayFlowView({
      currentExperimentCode: vibrationExperimentCode,
      dispatchTargetLab: "振动一室",
      location: "振动一室",
      status: "已到达实验室",
      taskCode,
      trayCode,
      experiments: [
        {
          axis_codes: allAxisCodes,
          experiment_code: impactExperimentCode,
          experiment_name: "冲击试验",
          required_device: "冲击一室",
          task_code: taskCode,
        },
        {
          axis_codes: allAxisCodes,
          experiment_code: vibrationExperimentCode,
          experiment_name: "振动试验",
          required_device: "振动一室",
          task_code: taskCode,
        },
      ],
      experimentTrays: [
        { experiment_code: impactExperimentCode, task_code: taskCode, tray_code: trayCode },
        { experiment_code: vibrationExperimentCode, task_code: taskCode, tray_code: trayCode },
      ],
      experimentRuns: [
        {
          axis_codes: impactAxisCodes,
          ended_at: "2026-07-01 16:04:18",
          experiment_code: impactExperimentCode,
          run_no: "RUN-IMPACT-PARTIAL",
          status: "实验已完成",
          sub_experiment_code: impactSubExperimentCode,
          task_code: taskCode,
          tray_codes: [trayCode],
        },
      ],
      experimentRunTrays: [
        {
          ended_at: "2026-07-01 16:04:18",
          experiment_code: impactExperimentCode,
          run_no: "RUN-IMPACT-PARTIAL",
          run_tray_status: "实验已完成",
          sub_experiment_code: impactSubExperimentCode,
          task_code: taskCode,
          tray_code: trayCode,
        },
      ],
      experimentRunSteps: impactAxisCodes.map((axisCode, index) => ({
        axis_code: axisCode,
        ended_at: "2026-07-01 16:04:18",
        experiment_code: impactExperimentCode,
        run_no: "RUN-IMPACT-PARTIAL",
        status: "实验已完成",
        step_no: index + 1,
        sub_experiment_code: impactSubExperimentCode,
        task_code: taskCode,
      })),
      samples: [
        {
          history: [
            {
              action: "任务比对",
              detail: `${taskCode} / 振动试验 / 已到达实验室 / 托盘：${trayCode}`,
              location: "振动一室",
              status: "已到达实验室",
              time: "2026-07-01 16:16:05",
              tray_code: trayCode,
            },
            {
              action: "实验完成",
              detail: `${taskCode} / 冲击试验 / 冲击试验部分完成 3/6轴 / 托盘：${trayCode}`,
              location: "冲击一室",
              status: "冲击试验部分完成 3/6轴",
              time: "2026-07-01 16:04:18",
              tray_code: trayCode,
            },
            {
              action: "暂存间扫码入库",
              detail: `${trayCode} 已到达暂存间`,
              location: "恒温恒湿间（暂存间）",
              status: "已到达暂存间",
              time: "2026-07-01 16:03:32",
              tray_code: trayCode,
            },
            {
              action: "接驳间扫码出库",
              detail: `${trayCode} 送至 恒温恒湿间（暂存间）`,
              location: "恒温恒湿间（暂存间）",
              status: "送至暂存间",
              time: "2026-07-01 16:03:26",
              tray_code: trayCode,
            },
          ],
          location: "振动一室",
          status: "已到达实验室",
          task_code: taskCode,
          trays: [
            {
              quantity: 1,
              status: "已到达实验室",
              target_experiment_code: vibrationExperimentCode,
              target_lab: "振动一室",
              tray_code: trayCode,
            },
          ],
        },
      ],
      schedules: [
        {
          axis_codes: impactAxisCodes,
          experiment_code: impactExperimentCode,
          status: "实验已完成",
          sub_experiment_code: impactSubExperimentCode,
          task_code: taskCode,
        },
        {
          axis_codes: ["x+", "x-", "y+"],
          device: "振动一室",
          experiment_code: vibrationExperimentCode,
          status: "实验进行中",
          sub_experiment_code: `${vibrationExperimentCode}-AXIS-001`,
          task_code: taskCode,
        },
      ],
    });

    expect(view.steps.find((step) => step.label === "送至暂存间")).toEqual(
      expect.objectContaining({ time: "" }),
    );
    expect(view.steps.find((step) => step.label === "已到达暂存间")).toEqual(
      expect.objectContaining({ time: "" }),
    );
    expect(view.steps.find((step) => step.label === "已到达实验室")).toEqual(
      expect.objectContaining({ active: true, time: "2026-07-01 16:16:05" }),
    );
  });

  test("buildTrayFlowView keeps pre-experiment appearance current after an earlier partial axis completion", () => {
    const taskCode = "SYLU-2026-06-021";
    const trayCode = `${taskCode}-TP-001`;
    const vibrationExperimentCode = `${taskCode}-A`;
    const saltExperimentCode = `${taskCode}-C`;
    const vibrationSubExperimentCode = `${vibrationExperimentCode}-AXIS-001`;
    const completedAxisCodes = ["z+", "z-"];
    const view = buildTrayFlowView({
      taskCode,
      trayCode,
      status: "实验前外观检测间存放",
      samples: [
        {
          code: `${taskCode}-SP-001`,
          flow_status: "实验前外观检测间存放",
          location: "外观检测间",
          status: "实验前外观检测间存放",
          task_code: taskCode,
          trays: [
            {
              quantity: 1,
              status: "实验前外观检测间存放",
              target_experiment_code: saltExperimentCode,
              target_lab: "盐雾试验室",
              tray_code: trayCode,
            },
          ],
          history: [
            {
              action: "实验任务撤回",
              detail: `${taskCode} / 盐雾试验 / 撤回至实验前外观检测间存放（试验间内撤回当前实验任务）`,
              location: "外观检测间",
              status: "实验前外观检测间存放",
              time: "2026-06-29 13:43:47",
              tray_code: trayCode,
            },
            {
              action: "外观检测间扫码入库",
              detail: `${trayCode} 实验前外观检测间存放`,
              location: "外观检测间",
              status: "实验前外观检测间存放",
              time: "2026-06-29 13:43:00",
              tray_code: trayCode,
            },
          ],
        },
      ],
      experiments: [
        {
          axis_codes: ["x+", "x-", "y+", "y-", "z+", "z-"],
          experiment_code: vibrationExperimentCode,
          experiment_name: "振动试验",
          required_device: "振动二室",
          task_code: taskCode,
        },
        {
          experiment_code: saltExperimentCode,
          experiment_name: "盐雾试验",
          required_device: "盐雾试验室",
          task_code: taskCode,
        },
      ],
      experimentTrays: [
        { experiment_code: vibrationExperimentCode, task_code: taskCode, tray_code: trayCode },
        { experiment_code: saltExperimentCode, task_code: taskCode, tray_code: trayCode },
      ],
      experimentRuns: [
        {
          axis_codes: completedAxisCodes,
          ended_at: "2026-06-29 13:37:50",
          experiment_code: vibrationExperimentCode,
          run_no: "RUN-VIBRATION-PARTIAL",
          status: "实验已完成",
          sub_experiment_code: vibrationSubExperimentCode,
          task_code: taskCode,
          tray_codes: [trayCode],
        },
      ],
      experimentRunTrays: [
        {
          ended_at: "2026-06-29 13:37:50",
          experiment_code: vibrationExperimentCode,
          run_no: "RUN-VIBRATION-PARTIAL",
          run_tray_status: "实验已完成",
          sub_experiment_code: vibrationSubExperimentCode,
          task_code: taskCode,
          tray_code: trayCode,
        },
      ],
      experimentRunSteps: completedAxisCodes.map((axisCode, index) => ({
        axis_code: axisCode,
        experiment_code: vibrationExperimentCode,
        run_no: "RUN-VIBRATION-PARTIAL",
        status: "实验已完成",
        step_no: index + 1,
        sub_experiment_code: vibrationSubExperimentCode,
        task_code: taskCode,
      })),
      schedules: [
        {
          axis_codes: completedAxisCodes,
          device: "振动二室",
          experiment_code: vibrationExperimentCode,
          start_at: "2026-06-29 13:30:00",
          task_code: taskCode,
        },
        {
          device: "盐雾试验室",
          experiment_code: saltExperimentCode,
          start_at: "2026-06-29 14:00:00",
          task_code: taskCode,
        },
      ],
    });
    const labels = view.steps.map((step) => step.label);
    const partialIndex = labels.indexOf("振动试验部分完成 2/6轴");
    const appearanceIndex = labels.indexOf("实验前外观检测间存放");
    const saltDispatchIndex = labels.indexOf("送至盐雾试验室");

    expect(view.currentStatus).toBe(`当前托盘：${trayCode} | 当前状态：实验前外观检测间存放`);
    expect(partialIndex).toBeGreaterThan(-1);
    expect(appearanceIndex).toBeGreaterThan(partialIndex);
    expect(saltDispatchIndex).toBeGreaterThan(appearanceIndex);
    expect(view.steps[partialIndex]).toEqual(expect.objectContaining({ reached: true, active: false }));
    expect(view.steps[appearanceIndex]).toEqual(
      expect.objectContaining({ active: true, time: "2026-06-29 13:43:00" }),
    );
  });

  test("buildTrayFlowView uses normal staging status when a partial axis tray is placed in staging", () => {
    const taskCode = "SYLU-2026-06-001";
    const experimentCode = `${taskCode}-B`;
    const trayCode = `${taskCode}-TP-002`;
    const firstSubExperimentCode = `${experimentCode}-AXIS-001`;
    const secondSubExperimentCode = `${experimentCode}-AXIS-002`;
    const completedAxisCodes = ["y+", "z+", "x+"];
    const remainingAxisCodes = ["z-", "y-", "x-"];
    const view = buildTrayFlowView({
      trayCode,
      taskCode,
      location: "恒温恒湿间（暂存间）",
      status: "已到达暂存间",
      experiments: [
        {
          task_code: taskCode,
          experiment_code: experimentCode,
          experiment_name: "冲击试验",
          axis_codes: [...completedAxisCodes, ...remainingAxisCodes],
        },
      ],
      experimentTrays: [
        { task_code: taskCode, experiment_code: experimentCode, tray_code: trayCode },
      ],
      experimentRuns: [
        {
          run_no: "RUN-IMPACT-AXIS-001",
          task_code: taskCode,
          experiment_code: experimentCode,
          sub_experiment_code: firstSubExperimentCode,
          axis_codes: completedAxisCodes,
          status: "实验已完成",
        },
      ],
      experimentRunTrays: [
        {
          run_no: "RUN-IMPACT-AXIS-001",
          task_code: taskCode,
          experiment_code: experimentCode,
          sub_experiment_code: firstSubExperimentCode,
          tray_code: trayCode,
          run_tray_status: "实验已完成",
        },
      ],
      experimentRunSteps: completedAxisCodes.map((axisCode, index) => ({
        run_no: "RUN-IMPACT-AXIS-001",
        task_code: taskCode,
        experiment_code: experimentCode,
        sub_experiment_code: firstSubExperimentCode,
        axis_code: axisCode,
        step_no: index + 1,
        status: "实验已完成",
      })),
      samples: [
        {
          task_code: taskCode,
          location: "恒温恒湿间（暂存间）",
          status: "已到达暂存间",
          trays: [
            {
              tray_code: trayCode,
              status: "已到达暂存间",
              quantity: 1,
            },
          ],
        },
      ],
      schedules: [
        {
          task_code: taskCode,
          experiment_code: experimentCode,
          device: "冲击一室",
          sub_experiment_code: firstSubExperimentCode,
          axis_codes: completedAxisCodes,
          start_at: "2026-06-26 11:12:00",
        },
        {
          task_code: taskCode,
          experiment_code: experimentCode,
          device: "冲击一室",
          sub_experiment_code: secondSubExperimentCode,
          axis_codes: remainingAxisCodes,
          start_at: "2026-06-26 14:52:00",
        },
      ],
    });

    const labels = view.steps.map((step) => step.label);
    expect(view.currentStatus).toBe(`当前托盘：${trayCode} | 当前状态：已到达暂存间`);
    expect(view.steps.find((step) => step.label === "冲击试验部分完成 3/6轴")).toEqual(
      expect.objectContaining({ reached: true, active: false }),
    );
    expect(view.steps.find((step) => step.label === "已到达暂存间")).toEqual(
      expect.objectContaining({ active: true }),
    );
    expect(view.steps.find((step) => step.label === "待继续冲击试验：剩余 3/6轴")).toEqual(
      expect.objectContaining({ active: false, reached: false, time: "" }),
    );
    expect(labels.indexOf("待继续冲击试验：剩余 3/6轴")).toBeGreaterThan(labels.indexOf("已到达暂存间"));
    expect(labels.indexOf("待继续冲击试验：剩余 3/6轴")).toBeLessThan(labels.indexOf("厂家收回"));
    expect(view.steps.some((step) => step.label === "放置暂存间")).toBe(false);
    expect(view.steps.some((step) => step.label === "实验后暂存间存放")).toBe(false);
  });

  test("buildTrayFlowView keeps a pending continuation placeholder when partial axis status is current", () => {
    const taskCode = "SYLU-2026-06-025";
    const experimentCode = `${taskCode}-A`;
    const trayCode = `${taskCode}-TP-001`;
    const view = buildTrayFlowView({
      trayCode,
      taskCode,
      location: "振动二室",
      status: "振动试验部分完成 4/6轴",
      currentExperimentCode: experimentCode,
      dispatchTargetLab: "振动二室",
      experiments: [
        {
          task_code: taskCode,
          experiment_code: experimentCode,
          experiment_name: "振动试验",
          axis_codes: ["x+", "x-", "y+", "y-", "z+", "z-"],
        },
      ],
      experimentTrays: [
        { task_code: taskCode, experiment_code: experimentCode, tray_code: trayCode },
      ],
      experimentRuns: [
        {
          run_no: "RUN-VIB-001",
          task_code: taskCode,
          experiment_code: experimentCode,
          status: "实验已完成",
          ended_at: "2026-06-30 22:11:09",
          tray_codes: [trayCode],
          sub_experiment_code: `${experimentCode}-AXIS-001`,
          axis_codes: ["y+", "y-", "z+", "z-"],
        },
      ],
      experimentRunTrays: [
        {
          run_no: "RUN-VIB-001",
          task_code: taskCode,
          experiment_code: experimentCode,
          tray_code: trayCode,
          status: "实验已完成",
          run_tray_status: "实验已完成",
          ended_at: "2026-06-30 22:11:09",
          sub_experiment_code: `${experimentCode}-AXIS-001`,
        },
      ],
      samples: [
        {
          code: `${taskCode}-SP-001`,
          task_code: taskCode,
          location: "振动二室",
          status: "振动试验部分完成 4/6轴",
          flow_status: "振动试验部分完成 4/6轴",
          history: [
            { action: "送至实验室", location: "振动二室", status: "送至实验室", detail: `${trayCode} -> 振动二室`, time: "2026-06-30 22:10:39" },
            { action: "实验完成", location: "振动二室", status: "振动试验部分完成 4/6轴", detail: `${taskCode} / 振动试验 / 振动试验部分完成 4/6轴`, time: "2026-06-30 22:11:09" },
          ],
          trays: [
            {
              tray_code: trayCode,
              status: "振动试验部分完成 4/6轴",
              target_lab: "振动二室",
              target_experiment_code: experimentCode,
              quantity: 1,
            },
          ],
        },
      ],
      schedules: [
        {
          task_code: taskCode,
          experiment_code: experimentCode,
          device: "振动二室",
          sub_experiment_code: `${experimentCode}-AXIS-001`,
          axis_codes: ["y+", "y-", "z+", "z-"],
          status: "实验已完成",
        },
        {
          task_code: taskCode,
          experiment_code: experimentCode,
          device: "振动二室",
          sub_experiment_code: `${experimentCode}-AXIS-002`,
          axis_codes: ["x+", "x-"],
          status: "已排程",
        },
      ],
    });

    const labels = view.steps.map((step) => step.label);
    expect(view.currentStatus).toBe(`当前托盘：${trayCode} | 当前状态：振动试验部分完成 4/6轴`);
    expect(view.steps.find((step) => step.label === "振动试验部分完成 4/6轴")).toEqual(
      expect.objectContaining({ active: true, reached: true }),
    );
    expect(view.steps.find((step) => step.label === "待继续振动试验：剩余 2/6轴")).toEqual(
      expect.objectContaining({ active: false, reached: false, time: "" }),
    );
    expect(labels.indexOf("待继续振动试验：剩余 2/6轴")).toBeGreaterThan(labels.indexOf("振动试验部分完成 4/6轴"));
    expect(labels.indexOf("待继续振动试验：剩余 2/6轴")).toBeLessThan(labels.indexOf("厂家收回"));
  });

  test("buildTrayFlowView keeps vibration continuation after completing remaining impact axes later", () => {
    const taskCode = "SYLU-2026-08-AXIS";
    const trayCode = `${taskCode}-TP-001`;
    const impactExperimentCode = `${taskCode}-A`;
    const vibrationExperimentCode = `${taskCode}-B`;
    const firstAxisCodes = ["x+", "x-", "y+"];
    const remainingAxisCodes = ["y-", "z+", "z-"];
    const allAxisCodes = [...firstAxisCodes, ...remainingAxisCodes];
    const impactFirstRun = "RUN-IMPACT-FIRST";
    const vibrationFirstRun = "RUN-VIBRATION-FIRST";
    const impactRemainingRun = "RUN-IMPACT-REMAINING";

    const view = buildTrayFlowView({
      trayCode,
      taskCode,
      location: "冲击一室",
      status: "实验已完成",
      samples: [
        {
          code: `${taskCode}-SP-001`,
          location: "冲击一室",
          status: "实验已完成",
          flow_status: "实验已完成",
          task_code: taskCode,
          trays: [
            {
              quantity: 1,
              status: "实验已完成",
              tray_code: trayCode,
            },
          ],
        },
      ],
      experiments: [
        {
          axis_codes: allAxisCodes,
          experiment_code: impactExperimentCode,
          experiment_name: "冲击试验",
          required_device: "冲击一室",
          task_code: taskCode,
        },
        {
          axis_codes: allAxisCodes,
          experiment_code: vibrationExperimentCode,
          experiment_name: "振动试验",
          required_device: "振动一室",
          task_code: taskCode,
        },
      ],
      experimentTrays: [
        { experiment_code: impactExperimentCode, task_code: taskCode, tray_code: trayCode },
        { experiment_code: vibrationExperimentCode, task_code: taskCode, tray_code: trayCode },
      ],
      experimentRuns: [
        {
          axis_codes: firstAxisCodes,
          ended_at: "2026-06-30 09:00:00",
          experiment_code: impactExperimentCode,
          run_no: impactFirstRun,
          status: "实验已完成",
          sub_experiment_code: `${impactExperimentCode}-AXIS-001`,
          task_code: taskCode,
          tray_codes: [trayCode],
        },
        {
          axis_codes: firstAxisCodes,
          ended_at: "2026-06-30 10:00:00",
          experiment_code: vibrationExperimentCode,
          run_no: vibrationFirstRun,
          status: "实验已完成",
          sub_experiment_code: `${vibrationExperimentCode}-AXIS-001`,
          task_code: taskCode,
          tray_codes: [trayCode],
        },
        {
          axis_codes: remainingAxisCodes,
          ended_at: "2026-06-30 11:00:00",
          experiment_code: impactExperimentCode,
          run_no: impactRemainingRun,
          status: "实验已完成",
          sub_experiment_code: `${impactExperimentCode}-AXIS-002`,
          task_code: taskCode,
          tray_codes: [trayCode],
        },
      ],
      experimentRunTrays: [
        {
          ended_at: "2026-06-30 09:00:00",
          experiment_code: impactExperimentCode,
          run_no: impactFirstRun,
          run_tray_status: "实验已完成",
          sub_experiment_code: `${impactExperimentCode}-AXIS-001`,
          task_code: taskCode,
          tray_code: trayCode,
        },
        {
          ended_at: "2026-06-30 10:00:00",
          experiment_code: vibrationExperimentCode,
          run_no: vibrationFirstRun,
          run_tray_status: "实验已完成",
          sub_experiment_code: `${vibrationExperimentCode}-AXIS-001`,
          task_code: taskCode,
          tray_code: trayCode,
        },
        {
          ended_at: "2026-06-30 11:00:00",
          experiment_code: impactExperimentCode,
          run_no: impactRemainingRun,
          run_tray_status: "实验已完成",
          sub_experiment_code: `${impactExperimentCode}-AXIS-002`,
          task_code: taskCode,
          tray_code: trayCode,
        },
      ],
      experimentRunSteps: [
        ...firstAxisCodes.map((axisCode, index) => ({
          axis_code: axisCode,
          experiment_code: impactExperimentCode,
          run_no: impactFirstRun,
          status: "实验已完成",
          step_no: index + 1,
          sub_experiment_code: `${impactExperimentCode}-AXIS-001`,
          task_code: taskCode,
        })),
        ...firstAxisCodes.map((axisCode, index) => ({
          axis_code: axisCode,
          experiment_code: vibrationExperimentCode,
          run_no: vibrationFirstRun,
          status: "实验已完成",
          step_no: index + 1,
          sub_experiment_code: `${vibrationExperimentCode}-AXIS-001`,
          task_code: taskCode,
        })),
        ...remainingAxisCodes.map((axisCode, index) => ({
          axis_code: axisCode,
          experiment_code: impactExperimentCode,
          run_no: impactRemainingRun,
          status: "实验已完成",
          step_no: index + 1,
          sub_experiment_code: `${impactExperimentCode}-AXIS-002`,
          task_code: taskCode,
        })),
      ],
      schedules: [
        {
          axis_codes: firstAxisCodes,
          device: "冲击一室",
          experiment_code: impactExperimentCode,
          status: "实验已完成",
          sub_experiment_code: `${impactExperimentCode}-AXIS-001`,
          task_code: taskCode,
        },
        {
          axis_codes: remainingAxisCodes,
          device: "冲击一室",
          experiment_code: impactExperimentCode,
          status: "实验已完成",
          sub_experiment_code: `${impactExperimentCode}-AXIS-002`,
          task_code: taskCode,
        },
        {
          axis_codes: firstAxisCodes,
          device: "振动一室",
          experiment_code: vibrationExperimentCode,
          status: "实验已完成",
          sub_experiment_code: `${vibrationExperimentCode}-AXIS-001`,
          task_code: taskCode,
        },
        {
          axis_codes: remainingAxisCodes,
          device: "振动一室",
          experiment_code: vibrationExperimentCode,
          status: "已排程",
          sub_experiment_code: `${vibrationExperimentCode}-AXIS-002`,
          task_code: taskCode,
        },
      ],
    });

    const labels = view.steps.map((step) => step.label);
    expect(view.steps.find((step) => step.label === "冲击试验已完成")).toEqual(
      expect.objectContaining({ reached: true }),
    );
    expect(view.steps.find((step) => step.label === "振动试验部分完成 3/6轴")).toEqual(
      expect.objectContaining({ time: "2026-06-30 10:00:00" }),
    );
    expect(view.steps.find((step) => step.label === "待继续振动试验：剩余 3/6轴")).toEqual(
      expect.objectContaining({ active: false, reached: false, time: "" }),
    );
    expect(labels.indexOf("待继续振动试验：剩余 3/6轴")).toBeGreaterThan(labels.indexOf("振动试验部分完成 3/6轴"));
    expect(labels.indexOf("待继续振动试验：剩余 3/6轴")).toBeLessThan(labels.indexOf("厂家收回"));
  });

  test("buildTrayFlowView uses completed run axis codes when step rows are missing", () => {
    const taskCode = "SYLU-2026-07-001";
    const experimentCode = `${taskCode}-A`;
    const trayCode = `${taskCode}-TP-001`;
    const view = buildTrayFlowView({
      trayCode,
      taskCode,
      location: "冲击一室",
      status: "实验进行中",
      experiments: [
        {
          task_code: taskCode,
          experiment_code: experimentCode,
          experiment_name: "冲击试验",
          axis_codes: ["x+", "x-", "y+", "y-", "z+", "z-"],
        },
      ],
      experimentTrays: [
        { task_code: taskCode, experiment_code: experimentCode, tray_code: trayCode },
      ],
      experimentRuns: [
        {
          run_no: "RUN-IMPACT-AXIS",
          task_code: taskCode,
          experiment_code: experimentCode,
          axis_codes: ["x+", "x-", "y+"],
          status: "实验已完成",
        },
      ],
      experimentRunTrays: [
        {
          run_no: "RUN-IMPACT-AXIS",
          task_code: taskCode,
          experiment_code: experimentCode,
          tray_code: trayCode,
          run_tray_status: "实验已完成",
        },
      ],
      experimentRunSteps: [],
      samples: [
        {
          task_code: taskCode,
          location: "冲击一室",
          status: "实验进行中",
          trays: [{ tray_code: trayCode, status: "实验进行中", quantity: 1 }],
        },
      ],
      schedules: [
        { task_code: taskCode, experiment_code: experimentCode, axis_codes: ["x+", "x-", "y+"], start_at: "2026-06-25T15:00:00" },
        { task_code: taskCode, experiment_code: experimentCode, axis_codes: ["y-", "z+", "z-"], start_at: "2026-06-26T08:00:00" },
      ],
    });

    expect(view.currentStatus).toBe(`当前托盘：${trayCode} | 当前状态：冲击试验部分完成 3/6轴`);
    expect(view.currentStatus).not.toContain("0/6轴");
  });

  test("buildTrayFlowView treats the tray status matching partial axis experiment as current after earlier partial experiments", () => {
    const taskCode = "SYLU-2026-07-001";
    const trayCode = `${taskCode}-TP-001`;
    const impactExperimentCode = `${taskCode}-A`;
    const saltExperimentCode = `${taskCode}-B`;
    const vibrationExperimentCode = `${taskCode}-D`;
    const firstAxisCodes = ["x+", "x-", "y+"];
    const remainingAxisCodes = ["y-", "z+", "z-"];
    const allAxisCodes = [...firstAxisCodes, ...remainingAxisCodes];
    const view = buildTrayFlowView({
      trayCode,
      taskCode,
      status: "振动试验部分完成 3/6轴",
      samples: [
        {
          code: `${taskCode}-SP-001`,
          location: "振动一室",
          status: "振动试验部分完成 3/6轴",
          task_code: taskCode,
          trays: [
            {
              quantity: 1,
              status: "振动试验部分完成 3/6轴",
              target_experiment_code: vibrationExperimentCode,
              target_lab: "振动一室",
              tray_code: trayCode,
            },
          ],
        },
      ],
      experiments: [
        {
          axis_codes: allAxisCodes,
          experiment_code: impactExperimentCode,
          experiment_name: "冲击试验",
          required_device: "冲击一室",
          task_code: taskCode,
        },
        {
          experiment_code: saltExperimentCode,
          experiment_name: "盐雾试验",
          required_device: "盐雾试验室",
          task_code: taskCode,
        },
        {
          axis_codes: allAxisCodes,
          experiment_code: vibrationExperimentCode,
          experiment_name: "振动试验",
          required_device: "振动一室",
          task_code: taskCode,
        },
      ],
      experimentTrays: [
        { experiment_code: impactExperimentCode, task_code: taskCode, tray_code: trayCode },
        { experiment_code: saltExperimentCode, task_code: taskCode, tray_code: trayCode },
        { experiment_code: vibrationExperimentCode, task_code: taskCode, tray_code: trayCode },
      ],
      experimentRuns: [
        {
          axis_codes: firstAxisCodes,
          ended_at: "2026-06-30 19:29:39",
          experiment_code: impactExperimentCode,
          run_no: "RUN-IMPACT-FIRST",
          status: "实验已完成",
          sub_experiment_code: `${impactExperimentCode}-AXIS-001`,
          task_code: taskCode,
          tray_codes: [trayCode],
        },
        {
          ended_at: "2026-06-30 19:35:00",
          experiment_code: saltExperimentCode,
          run_no: "RUN-SALT",
          status: "实验已完成",
          task_code: taskCode,
          tray_codes: [trayCode],
        },
        {
          axis_codes: firstAxisCodes,
          ended_at: "2026-06-30 19:35:58",
          experiment_code: vibrationExperimentCode,
          run_no: "RUN-VIBRATION-FIRST",
          status: "实验已完成",
          sub_experiment_code: `${vibrationExperimentCode}-AXIS-001`,
          task_code: taskCode,
          tray_codes: [trayCode],
        },
      ],
      experimentRunTrays: [
        {
          ended_at: "2026-06-30 19:29:39",
          experiment_code: impactExperimentCode,
          run_no: "RUN-IMPACT-FIRST",
          run_tray_status: "实验已完成",
          sub_experiment_code: `${impactExperimentCode}-AXIS-001`,
          task_code: taskCode,
          tray_code: trayCode,
        },
        {
          ended_at: "2026-06-30 19:35:00",
          experiment_code: saltExperimentCode,
          run_no: "RUN-SALT",
          run_tray_status: "实验已完成",
          task_code: taskCode,
          tray_code: trayCode,
        },
        {
          ended_at: "2026-06-30 19:35:58",
          experiment_code: vibrationExperimentCode,
          run_no: "RUN-VIBRATION-FIRST",
          run_tray_status: "实验已完成",
          sub_experiment_code: `${vibrationExperimentCode}-AXIS-001`,
          task_code: taskCode,
          tray_code: trayCode,
        },
      ],
      experimentRunSteps: [
        ...firstAxisCodes.map((axisCode, index) => ({
          axis_code: axisCode,
          experiment_code: impactExperimentCode,
          run_no: "RUN-IMPACT-FIRST",
          status: "实验已完成",
          step_no: index + 1,
          sub_experiment_code: `${impactExperimentCode}-AXIS-001`,
          task_code: taskCode,
        })),
        ...firstAxisCodes.map((axisCode, index) => ({
          axis_code: axisCode,
          experiment_code: vibrationExperimentCode,
          run_no: "RUN-VIBRATION-FIRST",
          status: "实验已完成",
          step_no: index + 1,
          sub_experiment_code: `${vibrationExperimentCode}-AXIS-001`,
          task_code: taskCode,
        })),
      ],
      schedules: [
        {
          axis_codes: remainingAxisCodes,
          device: "冲击一室",
          experiment_code: impactExperimentCode,
          status: "已排程",
          sub_experiment_code: `${impactExperimentCode}-AXIS-002`,
          task_code: taskCode,
        },
        {
          axis_codes: remainingAxisCodes,
          device: "振动一室",
          experiment_code: vibrationExperimentCode,
          status: "已排程",
          sub_experiment_code: `${vibrationExperimentCode}-AXIS-002`,
          task_code: taskCode,
        },
      ],
    });

    expect(view.currentStatus).toBe(`当前托盘：${trayCode} | 当前状态：振动试验部分完成 3/6轴`);
    expect(view.steps.find((step) => step.label === "冲击试验部分完成 3/6轴")).toEqual(
      expect.objectContaining({ reached: true, active: false }),
    );
    expect(view.steps.find((step) => step.label === "盐雾试验已完成")).toEqual(
      expect.objectContaining({ reached: true, active: false }),
    );
    expect(view.steps.find((step) => step.label === "振动试验部分完成 3/6轴")).toEqual(
      expect.objectContaining({ active: true }),
    );
  });

  test("buildTrayFlowView uses the latest real partial-axis completion when tray status is stale", () => {
    const taskCode = "SYLU-2026-08-001";
    const trayCode = `${taskCode}-TP-001`;
    const impactExperimentCode = `${taskCode}-A`;
    const vibrationExperimentCode = `${taskCode}-D`;
    const firstAxisCodes = ["x+", "x-", "y+"];
    const remainingAxisCodes = ["y-", "z+", "z-"];
    const allAxisCodes = [...firstAxisCodes, ...remainingAxisCodes];

    const view = buildTrayFlowView({
      taskCode,
      trayCode,
      location: "振动一室",
      status: "冲击试验部分完成 3/6轴",
      samples: [
        {
          code: `${taskCode}-SP-001`,
          location: "振动一室",
          status: "振动试验部分完成 3/6轴",
          task_code: taskCode,
          history: [
            {
              action: "实验完成",
              detail: `${taskCode} / 振动试验 / 振动试验部分完成 3/6轴`,
              location: "振动一室",
              status: "振动试验部分完成 3/6轴",
              time: "2026-07-01 16:38:35",
              tray_code: trayCode,
            },
            {
              action: "实验完成",
              detail: `${taskCode} / 冲击试验 / 冲击试验部分完成 3/6轴`,
              location: "冲击一室",
              status: "冲击试验部分完成 3/6轴",
              time: "2026-07-01 16:04:18",
              tray_code: trayCode,
            },
          ],
          trays: [
            {
              quantity: 1,
              status: "冲击试验部分完成 3/6轴",
              target_experiment_code: impactExperimentCode,
              target_lab: "冲击一室",
              tray_code: trayCode,
            },
          ],
        },
      ],
      experiments: [
        {
          axis_codes: allAxisCodes,
          experiment_code: impactExperimentCode,
          experiment_name: "冲击试验",
          required_device: "冲击一室",
          task_code: taskCode,
        },
        {
          axis_codes: allAxisCodes,
          experiment_code: vibrationExperimentCode,
          experiment_name: "振动试验",
          required_device: "振动一室",
          task_code: taskCode,
        },
      ],
      experimentTrays: [
        { experiment_code: impactExperimentCode, task_code: taskCode, tray_code: trayCode },
        { experiment_code: vibrationExperimentCode, task_code: taskCode, tray_code: trayCode },
      ],
      experimentRuns: [
        {
          axis_codes: firstAxisCodes,
          ended_at: "2026-07-01 16:04:18",
          experiment_code: impactExperimentCode,
          run_no: "RUN-IMPACT-FIRST",
          status: "实验已完成",
          task_code: taskCode,
          tray_codes: [trayCode],
        },
        {
          axis_codes: firstAxisCodes,
          ended_at: "2026-07-01 16:38:35",
          experiment_code: vibrationExperimentCode,
          run_no: "RUN-VIBRATION-FIRST",
          status: "实验已完成",
          task_code: taskCode,
          tray_codes: [trayCode],
        },
      ],
      experimentRunTrays: [
        {
          ended_at: "2026-07-01 16:04:18",
          experiment_code: impactExperimentCode,
          run_no: "RUN-IMPACT-FIRST",
          run_tray_status: "实验已完成",
          task_code: taskCode,
          tray_code: trayCode,
        },
        {
          ended_at: "2026-07-01 16:38:35",
          experiment_code: vibrationExperimentCode,
          run_no: "RUN-VIBRATION-FIRST",
          run_tray_status: "实验已完成",
          task_code: taskCode,
          tray_code: trayCode,
        },
      ],
      experimentRunSteps: [
        ...firstAxisCodes.map((axisCode) => ({
          axis_code: axisCode,
          experiment_code: impactExperimentCode,
          run_no: "RUN-IMPACT-FIRST",
          status: "实验已完成",
          task_code: taskCode,
        })),
        ...firstAxisCodes.map((axisCode) => ({
          axis_code: axisCode,
          experiment_code: vibrationExperimentCode,
          run_no: "RUN-VIBRATION-FIRST",
          status: "实验已完成",
          task_code: taskCode,
        })),
      ],
      schedules: [
        {
          axis_codes: remainingAxisCodes,
          device: "冲击一室",
          experiment_code: impactExperimentCode,
          status: "已排程",
          task_code: taskCode,
        },
        {
          axis_codes: remainingAxisCodes,
          device: "振动一室",
          experiment_code: vibrationExperimentCode,
          status: "已排程",
          task_code: taskCode,
        },
      ],
    });

    const labels = view.steps.map((step) => step.label);
    expect(labels.indexOf("冲击试验部分完成 3/6轴")).toBeLessThan(labels.indexOf("振动试验部分完成 3/6轴"));
    expect(view.currentStatus).toBe(`当前托盘：${trayCode} | 当前状态：振动试验部分完成 3/6轴`);
    expect(view.steps.find((step) => step.label === "冲击试验部分完成 3/6轴")).toEqual(
      expect.objectContaining({ reached: true, active: false }),
    );
    expect(view.steps.find((step) => step.label === "振动试验部分完成 3/6轴")).toEqual(
      expect.objectContaining({ active: true }),
    );
  });

  test("buildTrayFlowView keeps pending axis continuations as hints after a later normal experiment completes", () => {
    const taskCode = "SYLU-2026-09-001";
    const trayCode = `${taskCode}-TP-001`;
    const impactExperimentCode = `${taskCode}-A`;
    const vibrationExperimentCode = `${taskCode}-B`;
    const saltExperimentCode = `${taskCode}-C`;
    const firstAxisCodes = ["x+", "x-", "y+"];
    const remainingAxisCodes = ["y-", "z+", "z-"];
    const allAxisCodes = [...firstAxisCodes, ...remainingAxisCodes];

    const view = buildTrayFlowViewRaw({
      taskCode,
      trayCode,
      location: "盐雾试验室",
      status: "实验已完成",
      samples: [
        {
          code: `${taskCode}-SP-001`,
          location: "盐雾试验室",
          status: "实验已完成",
          task_code: taskCode,
          history: [
            {
              action: "实验完成",
              detail: `${taskCode} / 盐雾试验 / 实验已完成`,
              location: "盐雾试验室",
              status: "实验已完成",
              time: "2026-07-01 17:06:06",
              tray_code: trayCode,
            },
            {
              action: "实验完成",
              detail: `${taskCode} / 振动试验 / 振动试验部分完成 3/6轴`,
              location: "振动一室",
              status: "振动试验部分完成 3/6轴",
              time: "2026-07-01 17:05:08",
              tray_code: trayCode,
            },
            {
              action: "实验完成",
              detail: `${taskCode} / 冲击试验 / 冲击试验部分完成 3/6轴`,
              location: "冲击一室",
              status: "冲击试验部分完成 3/6轴",
              time: "2026-07-01 17:04:34",
              tray_code: trayCode,
            },
          ],
          trays: [
            {
              quantity: 1,
              status: "实验已完成",
              target_experiment_code: impactExperimentCode,
              target_lab: "冲击一室",
              tray_code: trayCode,
            },
          ],
        },
      ],
      experiments: [
        {
          axis_codes: allAxisCodes,
          experiment_code: impactExperimentCode,
          experiment_name: "冲击试验",
          required_device: "冲击一室",
          task_code: taskCode,
        },
        {
          axis_codes: allAxisCodes,
          experiment_code: vibrationExperimentCode,
          experiment_name: "振动试验",
          required_device: "振动一室",
          task_code: taskCode,
        },
        {
          experiment_code: saltExperimentCode,
          experiment_name: "盐雾试验",
          required_device: "盐雾试验室",
          task_code: taskCode,
        },
      ],
      experimentTrays: [
        { experiment_code: impactExperimentCode, task_code: taskCode, tray_code: trayCode },
        { experiment_code: vibrationExperimentCode, task_code: taskCode, tray_code: trayCode },
        { experiment_code: saltExperimentCode, task_code: taskCode, tray_code: trayCode },
      ],
      experimentRuns: [
        {
          axis_codes: firstAxisCodes,
          ended_at: "2026-07-01 17:04:34",
          experiment_code: impactExperimentCode,
          run_no: "RUN-IMPACT-FIRST",
          status: "实验已完成",
          task_code: taskCode,
          tray_codes: [trayCode],
        },
        {
          axis_codes: firstAxisCodes,
          ended_at: "2026-07-01 17:05:08",
          experiment_code: vibrationExperimentCode,
          run_no: "RUN-VIBRATION-FIRST",
          status: "实验已完成",
          task_code: taskCode,
          tray_codes: [trayCode],
        },
        {
          ended_at: "2026-07-01 17:06:06",
          experiment_code: saltExperimentCode,
          run_no: "RUN-SALT-DONE",
          status: "实验已完成",
          task_code: taskCode,
          tray_codes: [trayCode],
        },
      ],
      experimentRunTrays: [
        {
          ended_at: "2026-07-01 17:04:34",
          experiment_code: impactExperimentCode,
          run_no: "RUN-IMPACT-FIRST",
          run_tray_status: "实验已完成",
          task_code: taskCode,
          tray_code: trayCode,
        },
        {
          ended_at: "2026-07-01 17:05:08",
          experiment_code: vibrationExperimentCode,
          run_no: "RUN-VIBRATION-FIRST",
          run_tray_status: "实验已完成",
          task_code: taskCode,
          tray_code: trayCode,
        },
        {
          ended_at: "2026-07-01 17:06:06",
          experiment_code: saltExperimentCode,
          run_no: "RUN-SALT-DONE",
          run_tray_status: "实验已完成",
          task_code: taskCode,
          tray_code: trayCode,
        },
      ],
      experimentRunSteps: [
        ...firstAxisCodes.map((axisCode) => ({
          axis_code: axisCode,
          experiment_code: impactExperimentCode,
          run_no: "RUN-IMPACT-FIRST",
          status: "实验已完成",
          task_code: taskCode,
        })),
        ...firstAxisCodes.map((axisCode) => ({
          axis_code: axisCode,
          experiment_code: vibrationExperimentCode,
          run_no: "RUN-VIBRATION-FIRST",
          status: "实验已完成",
          task_code: taskCode,
        })),
      ],
      schedules: [
        {
          axis_codes: remainingAxisCodes,
          device: "冲击一室",
          experiment_code: impactExperimentCode,
          status: "已排程",
          task_code: taskCode,
        },
        {
          axis_codes: remainingAxisCodes,
          device: "振动一室",
          experiment_code: vibrationExperimentCode,
          status: "已排程",
          task_code: taskCode,
        },
      ],
    });

    const labels = view.steps.map((step) => step.label);
    expect(labels.indexOf("冲击试验部分完成 3/6轴")).toBeLessThan(labels.indexOf("振动试验部分完成 3/6轴"));
    expect(labels.indexOf("振动试验部分完成 3/6轴")).toBeLessThan(labels.indexOf("盐雾试验已完成"));
    expect(labels.indexOf("盐雾试验已完成")).toBeLessThan(labels.indexOf("待继续振动试验：剩余 3/6轴"));
    expect(labels.indexOf("送至暂存间")).toBeGreaterThan(labels.indexOf("盐雾试验已完成"));
    expect(labels.indexOf("已到达暂存间")).toBeGreaterThan(labels.indexOf("送至暂存间"));
    expect(view.currentStatus).toBe(`当前托盘：${trayCode} | 当前状态：盐雾试验已完成`);
    expect(view.steps.find((step) => step.label === "冲击试验部分完成 3/6轴")).toEqual(
      expect.objectContaining({ reached: true, active: false }),
    );
    expect(view.steps.find((step) => step.label === "振动试验部分完成 3/6轴")).toEqual(
      expect.objectContaining({ reached: true, active: false }),
    );
    expect(view.steps.find((step) => step.label === "盐雾试验已完成")).toEqual(
      expect.objectContaining({ active: true }),
    );
    expect(view.steps.find((step) => step.label === "待继续冲击试验：剩余 3/6轴")).toBeTruthy();
    expect(view.steps.find((step) => step.label === "待继续振动试验：剩余 3/6轴")).toBeTruthy();
  });

  test("buildTrayFlowView keeps historical partial impact time before later completed experiments after withdrawal hops", () => {
    const taskCode = "SYLU-2026-08-001";
    const trayCode = `${taskCode}-TP-001`;
    const impactExperimentCode = `${taskCode}-A`;
    const saltExperimentCode = `${taskCode}-B`;
    const comprehensiveExperimentCode = `${taskCode}-C`;
    const vibrationExperimentCode = `${taskCode}-D`;

    const view = buildTrayFlowViewRaw({
      taskCode,
      trayCode,
      location: "厂家收回",
      status: "厂家收回",
      samples: [
        {
          code: `${taskCode}-SP-001`,
          location: "厂家收回",
          status: "厂家收回",
          task_code: taskCode,
          history: [
            { action: "厂家收回", detail: `${trayCode} 厂家收回`, location: "厂家收回", status: "厂家收回", time: "2026-07-02 14:24:34", tray_code: trayCode },
            { action: "暂存间扫码入库", detail: `${trayCode} 实验后暂存间存放`, location: "恒温恒湿间（实验后暂存间）", status: "实验后暂存间存放", time: "2026-07-02 14:24:31", tray_code: trayCode },
            { action: "实验完成", detail: `${taskCode} / 冲击试验 / 实验已完成`, location: "冲击一室", status: "实验已完成", time: "2026-07-02 14:23:48", tray_code: trayCode },
            { action: "任务比对", detail: `${taskCode} / 冲击试验 / 已到达实验室 / 托盘：${trayCode}`, location: "冲击一室", status: "已到达实验室", time: "2026-07-02 14:23:35", tray_code: trayCode },
            { action: "实验完成", detail: `${taskCode} / 盐雾试验 / 实验已完成`, location: "盐雾试验室", status: "实验已完成", time: "2026-07-02 14:19:40", tray_code: trayCode },
            { action: "实验完成", detail: `${taskCode} / 四综合试验 / 实验已完成`, location: "四综合实验室", status: "实验已完成", time: "2026-07-02 14:17:57", tray_code: trayCode },
            { action: "实验任务撤回", detail: `${taskCode} / 冲击试验 / 撤回至冲击试验部分完成（试验间内撤回当前实验任务）`, location: "冲击一室", status: "冲击试验部分完成 1/2轴", time: "2026-07-02 13:51:41", tray_code: trayCode },
            { action: "任务比对", detail: `${taskCode} / 冲击试验 / 已到达实验室 / 托盘：${trayCode}`, location: "冲击一室", status: "已到达实验室", time: "2026-07-02 13:51:16", tray_code: trayCode },
            { action: "实验任务撤回", detail: `${taskCode} / 四综合试验 / 撤回至振动试验已完成（试验间内撤回当前实验任务）`, location: "振动一室", status: "实验已完成", time: "2026-07-02 13:50:02", tray_code: trayCode },
            { action: "实验完成", detail: `${taskCode} / 振动试验 / 实验已完成`, location: "振动一室", status: "实验已完成", time: "2026-07-02 13:49:45", tray_code: trayCode },
            { action: "实验完成", detail: `${taskCode} / 冲击试验 / 冲击试验部分完成 1/2轴`, location: "冲击一室", status: "冲击试验部分完成 1/2轴", time: "2026-07-02 13:49:23", tray_code: trayCode },
          ],
          trays: [
            {
              quantity: 1,
              status: "厂家收回",
              target_experiment_code: impactExperimentCode,
              target_lab: "冲击一室",
              tray_code: trayCode,
            },
          ],
        },
      ],
      experiments: [
        { axis_codes: ["y+", "z-"], experiment_code: impactExperimentCode, experiment_name: "冲击试验", required_device: "冲击一室", task_code: taskCode },
        { experiment_code: saltExperimentCode, experiment_name: "盐雾试验", required_device: "盐雾试验室", task_code: taskCode },
        { experiment_code: comprehensiveExperimentCode, experiment_name: "四综合试验", required_device: "四综合实验室", task_code: taskCode },
        { axis_codes: ["x+", "y+", "y-", "z-"], experiment_code: vibrationExperimentCode, experiment_name: "振动试验", required_device: "振动一室", task_code: taskCode },
      ],
      experimentTrays: [
        { experiment_code: impactExperimentCode, task_code: taskCode, tray_code: trayCode },
        { experiment_code: saltExperimentCode, task_code: taskCode, tray_code: trayCode },
        { experiment_code: comprehensiveExperimentCode, task_code: taskCode, tray_code: trayCode },
        { experiment_code: vibrationExperimentCode, task_code: taskCode, tray_code: trayCode },
      ],
      experimentRuns: [
        { axis_codes: ["y+"], ended_at: "2026-07-02 13:49:23", experiment_code: impactExperimentCode, run_no: "RUN-IMPACT-1", status: "实验已完成", task_code: taskCode, tray_codes: [trayCode] },
        { axis_codes: ["x+", "y+", "y-", "z-"], ended_at: "2026-07-02 13:49:45", experiment_code: vibrationExperimentCode, run_no: "RUN-VIBRATION", status: "实验已完成", task_code: taskCode, tray_codes: [trayCode] },
        { ended_at: "2026-07-02 14:17:57", experiment_code: comprehensiveExperimentCode, run_no: "RUN-COMPREHENSIVE", status: "实验已完成", task_code: taskCode, tray_codes: [trayCode] },
        { ended_at: "2026-07-02 14:19:40", experiment_code: saltExperimentCode, run_no: "RUN-SALT", status: "实验已完成", task_code: taskCode, tray_codes: [trayCode] },
        { axis_codes: ["z-"], ended_at: "2026-07-02 14:23:48", experiment_code: impactExperimentCode, run_no: "RUN-IMPACT-2", status: "实验已完成", task_code: taskCode, tray_codes: [trayCode] },
      ],
      experimentRunTrays: [
        { ended_at: "2026-07-02 13:49:23", experiment_code: impactExperimentCode, run_no: "RUN-IMPACT-1", run_tray_status: "实验已完成", task_code: taskCode, tray_code: trayCode },
        { ended_at: "2026-07-02 13:49:45", experiment_code: vibrationExperimentCode, run_no: "RUN-VIBRATION", run_tray_status: "实验已完成", task_code: taskCode, tray_code: trayCode },
        { ended_at: "2026-07-02 14:17:57", experiment_code: comprehensiveExperimentCode, run_no: "RUN-COMPREHENSIVE", run_tray_status: "实验已完成", task_code: taskCode, tray_code: trayCode },
        { ended_at: "2026-07-02 14:19:40", experiment_code: saltExperimentCode, run_no: "RUN-SALT", run_tray_status: "实验已完成", task_code: taskCode, tray_code: trayCode },
        { ended_at: "2026-07-02 14:23:48", experiment_code: impactExperimentCode, run_no: "RUN-IMPACT-2", run_tray_status: "实验已完成", task_code: taskCode, tray_code: trayCode },
      ],
      experimentRunSteps: [
        { axis_code: "y+", experiment_code: impactExperimentCode, run_no: "RUN-IMPACT-1", status: "实验已完成", task_code: taskCode },
        { axis_code: "z-", experiment_code: impactExperimentCode, run_no: "RUN-IMPACT-2", status: "实验已完成", task_code: taskCode },
        ...["x+", "y+", "y-", "z-"].map((axisCode) => ({
          axis_code: axisCode,
          experiment_code: vibrationExperimentCode,
          run_no: "RUN-VIBRATION",
          status: "实验已完成",
          task_code: taskCode,
        })),
      ],
    });

    const labels = view.steps.map((step) => step.label);
    expect(labels.indexOf("冲击试验部分完成 1/2轴")).toBeLessThan(labels.indexOf("振动试验已完成"));
    expect(labels.indexOf("振动试验已完成")).toBeLessThan(labels.indexOf("四综合试验已完成"));
    expect(labels.indexOf("四综合试验已完成")).toBeLessThan(labels.indexOf("盐雾试验已完成"));
    expect(labels.indexOf("盐雾试验已完成")).toBeLessThan(labels.indexOf("冲击试验已完成"));
    expect(view.steps.find((step) => step.label === "冲击试验部分完成 1/2轴")).toEqual(
      expect.objectContaining({ reached: true, active: false, time: "2026-07-02 13:49:23" }),
    );
    expect(view.steps.find((step) => step.label === "冲击试验已完成")).toEqual(
      expect.objectContaining({ reached: true, active: false, time: "2026-07-02 14:23:48" }),
    );
    expect(view.steps.find((step) => step.label === "待继续冲击试验：剩余 1/2轴")).toBeFalsy();
    expect(view.currentStatus).toBe(`当前托盘：${trayCode} | 当前状态：厂家收回`);
  });

  test("buildTrayFlowView merges consecutive partial axis batches into one completed experiment", () => {
    const taskCode = "SYLU-2026-07-024";
    const trayCode = `${taskCode}-TP-001`;
    const impactExperimentCode = `${taskCode}-A`;
    const comprehensiveExperimentCode = `${taskCode}-B`;

    const view = buildTrayFlowViewRaw({
      taskCode,
      trayCode,
      status: "实验已完成",
      samples: [
        {
          code: `${taskCode}-SP-001`,
          location: "冲击二室",
          status: "实验已完成",
          task_code: taskCode,
          history: [
            { action: "实验完成", detail: `${taskCode} / 冲击试验 / 实验已完成`, location: "冲击二室", status: "实验已完成", time: "2026-07-02 16:49:40", tray_code: trayCode },
            { action: "实验完成", detail: `${taskCode} / 冲击试验 / 冲击试验部分完成 3/6轴`, location: "冲击二室", status: "冲击试验部分完成 3/6轴", time: "2026-07-02 16:48:16", tray_code: trayCode },
            { action: "任务已确认入库", detail: taskCode, location: "接驳区", status: "到货", time: "2026-07-02 16:45:03" },
            { action: "样品分装托盘", detail: trayCode, status: "运输中", time: "2026-07-02 16:45:03" },
          ],
          trays: [
            {
              quantity: 1,
              status: "实验已完成",
              target_experiment_code: "",
              target_lab: "",
              tray_code: trayCode,
            },
          ],
        },
      ],
      experiments: [
        {
          axis_codes: ["x+", "x-", "y+", "y-", "z+", "z-"],
          experiment_code: impactExperimentCode,
          experiment_name: "冲击试验",
          required_device: "冲击二室",
          status: "实验已完成",
          task_code: taskCode,
        },
        {
          experiment_code: comprehensiveExperimentCode,
          experiment_name: "四综合试验",
          required_device: "四综合实验室",
          status: "实验进行中",
          task_code: taskCode,
        },
      ],
      experimentTrays: [
        { experiment_code: impactExperimentCode, task_code: taskCode, tray_code: trayCode },
        { experiment_code: comprehensiveExperimentCode, task_code: taskCode, tray_code: trayCode },
      ],
      experimentRuns: [
        {
          axis_codes: ["y-", "z+", "z-"],
          ended_at: "2026-07-02 16:48:16",
          experiment_code: impactExperimentCode,
          run_no: "RUN-IMPACT-AXIS-001",
          status: "实验已完成",
          sub_experiment_code: `${impactExperimentCode}-AXIS-001`,
          task_code: taskCode,
          tray_codes: [trayCode],
        },
        {
          axis_codes: ["x+", "x-", "y+"],
          ended_at: "2026-07-02 16:49:40",
          experiment_code: impactExperimentCode,
          run_no: "RUN-IMPACT-AXIS-002",
          status: "实验已完成",
          sub_experiment_code: `${impactExperimentCode}-AXIS-002`,
          task_code: taskCode,
          tray_codes: [trayCode],
        },
      ],
      experimentRunTrays: [
        {
          ended_at: "2026-07-02 16:48:16",
          experiment_code: impactExperimentCode,
          run_no: "RUN-IMPACT-AXIS-001",
          run_tray_status: "实验已完成",
          status: "实验已完成",
          sub_experiment_code: `${impactExperimentCode}-AXIS-001`,
          task_code: taskCode,
          tray_code: trayCode,
        },
        {
          ended_at: "2026-07-02 16:49:40",
          experiment_code: impactExperimentCode,
          run_no: "RUN-IMPACT-AXIS-002",
          run_tray_status: "实验已完成",
          status: "实验已完成",
          sub_experiment_code: `${impactExperimentCode}-AXIS-002`,
          task_code: taskCode,
          tray_code: trayCode,
        },
      ],
      experimentRunSteps: [
        ...["y-", "z+", "z-"].map((axisCode) => ({
          axis_code: axisCode,
          experiment_code: impactExperimentCode,
          run_no: "RUN-IMPACT-AXIS-001",
          status: "实验已完成",
          sub_experiment_code: `${impactExperimentCode}-AXIS-001`,
          task_code: taskCode,
        })),
        ...["x+", "x-", "y+"].map((axisCode) => ({
          axis_code: axisCode,
          experiment_code: impactExperimentCode,
          run_no: "RUN-IMPACT-AXIS-002",
          status: "实验已完成",
          sub_experiment_code: `${impactExperimentCode}-AXIS-002`,
          task_code: taskCode,
        })),
      ],
      schedules: [
        {
          device: "四综合实验室",
          experiment_code: comprehensiveExperimentCode,
          start_at: "2026-07-02 16:46:00",
          status: "实验进行中",
          task_code: taskCode,
        },
      ],
    });

    const labels = view.steps.map((step) => step.label);
    expect(labels.filter((label) => label === "冲击试验已完成")).toHaveLength(1);
    expect(labels).not.toContain("冲击试验部分完成 3/6轴");
    expect(view.steps.find((step) => step.label === "冲击试验已完成")).toEqual(
      expect.objectContaining({ reached: true, time: "2026-07-02 16:49:40" }),
    );
    expect(labels).toContain("四综合试验未完成");
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
