import { mount } from "@vue/test-utils";
import { describe, expect, test } from "vitest";
import { buildTrayFlowView, buildSamplesTrayOverviewView, normalizeLifecycleStatus, TRAY_STATUS_OPTIONS, DETAIL_STATUS_OPTIONS } from "./samplesFlowModel";
import { buildLabProcessPanels } from "../visualization/model";
import { resolveVisualFlowStepTone } from "../visualization/flowStepState";
import { LabProcessScreen } from "../visualization/screens/labProcessScreen";
import TrayManagementPanel from "./TrayManagementPanel.vue";

const originalArrival = "2026-11-08 07:00:00";
const originalSent = "2026-11-08 07:20:00";
const originalStored = "2026-11-08 07:30:00";
const returnTime = "2026-11-08 11:00:00";

function snapshot(historyType, phase = "returned") {
  const history = [{ status: "到货", location: "接驳区", time: originalArrival, tray_code: "TP" }];
  if (historyType === "history" || historyType === "untimed") {
    history.push(
      { status: "送至暂存间", location: "恒温恒湿间（暂存间）", time: historyType === "untimed" ? "" : originalSent, tray_code: "TP" },
      { status: "已到达暂存间", location: "恒温恒湿间（暂存间）", time: historyType === "untimed" ? "" : originalStored, tray_code: "TP" },
    );
  }
  const phases = ["returned", "compared", "installed", "fixture", "ready", "resumed"];
  const index = phases.indexOf(phase);
  const status = ["等待恢复实验", "已到达实验室", "工装夹具安装", "工装夹具安装", "实验准备就绪", "实验进行中"][index];
  const actions = ["resume_preparation_started", "resume_preparation_compared", "resume_preparation_installed", "resume_preparation_fixture_ready", "resume_preparation_ready"];
  const events = [
    { task_code: "T", tray_code: "TP", run_no: "R", pause_no: "P", room: "appearance", action: "stock_in", appearance_phase: "mid_experiment", time: "2026-11-08 10:10:00" },
    { task_code: "T", tray_code: "TP", run_no: "R", pause_no: "P", room: "appearance", action: "stock_out", appearance_phase: "mid_experiment", target_lab_code: "LAB_SALT", target_lab: "盐雾试验室", time: returnTime },
    ...actions.slice(0, Math.min(index + 1, 5)).map((action, i) => ({ task_code: "T", tray_code: "TP", run_no: "R", pause_no: "P", room: "laboratory_resume_preparation", action, time: `2026-11-08 11:0${i + 1}:00` })),
  ];
  if (historyType === "events") events.push(
    { task_code: "T", tray_code: "TP", room: "appearance", action: "stock_out", target_type: "staging", target_lab: "恒温恒湿间（暂存间）", time: originalSent },
    { task_code: "T", tray_code: "TP", room: "staging", action: "stock_in", status: "已到达暂存间", location: "恒温恒湿间（暂存间）", time: originalStored },
  );
  return {
    tasks: [{ code: "T", status: "任务进行中" }],
    experiments: [{ task_code: "T", experiment_code: "E", experiment_name: "盐雾试验", required_device: "盐雾试验室", status: "实验进行中" }],
    schedules: [{ id: "S", task_code: "T", experiment_code: "E", device: "盐雾试验室", status: "实验进行中" }],
    experimentTrays: [{ task_code: "T", experiment_code: "E", tray_code: "TP" }],
    experimentRuns: [{ run_no: "R", task_code: "T", experiment_code: "E", device: "盐雾试验室", status: phase === "resumed" ? "实验进行中" : "实验暂停", started_at: "2026-11-08 09:00:00" }],
    experimentRunTrays: [{ run_no: "R", task_code: "T", experiment_code: "E", tray_code: "TP", run_tray_status: "实验进行中" }],
    experimentRunPauses: [{ pause_no: "P", run_no: "R", task_code: "T", experiment_code: "E", lab_code: "LAB_SALT", status: phase === "resumed" ? "实验已恢复" : "实验暂停", paused_at: "2026-11-08 10:00:00", resumed_at: phase === "resumed" ? "2026-11-08 11:10:00" : "", inspection_tray_codes: ["TP"] }],
    samples: [{ code: "SP", task_code: "T", location: "盐雾试验室", status, flow_status: status, trays: [{ tray_code: "TP", quantity: 1, status, target_experiment_code: "E", target_lab: "盐雾试验室" }], history }],
    stagingEvents: events,
  };
}

function views(input, trayCode = "TP") {
  const row = buildSamplesTrayOverviewView(input).rows.find((row) => row.trayCode === trayCode);
  const detail = buildTrayFlowView({ ...input, taskCode: "T", trayCode, status: row.status, location: "" });
  const panel = buildLabProcessPanels({ ...input, labNames: ["盐雾试验室"] })[0];
  return { detail, panel, visual: panel.trays.find((tray) => tray.trayCode === trayCode) };
}

const state = (step) => ({ label: step.label, active: Boolean(step.active), reached: Boolean(step.reached), time: step.time || "", tone: resolveVisualFlowStepTone(step) });
const staging = (flow) => flow.steps.filter((step) => ["送至暂存间", "已到达暂存间"].includes(step.label));

describe("B-ISSUE-02 salt recovery preserves actual staging history", () => {
  test("recognizes the existing backend waiting state without making it an editable state", () => {
    for (const location of ["", "盐雾试验室", "外观检测间"]) expect(normalizeLifecycleStatus(location, "等待恢复实验")).toBe("等待恢复实验");
    expect(TRAY_STATUS_OPTIONS).not.toContain("等待恢复实验");
    expect(DETAIL_STATUS_OPTIONS).not.toContain("等待恢复实验");
  });

  test("uses the existing central-control preparation flow without a new waiting status or node", () => {
    const { detail, visual } = views(snapshot("none"));
    for (const flow of [detail, visual]) {
      expect(flow.status).toBe("送至盐雾试验室");
      expect(flow.currentStatus || flow.status).not.toContain("等待恢复实验");
      expect(flow.steps.some((step) => (step.displayLabel || step.label).includes("等待恢复实验"))).toBe(false);
    }
  });

  for (const historyType of ["none", "history", "events", "untimed"]) {
    test.each(["returned", "compared", "installed", "fixture", "ready", "resumed"])(`${historyType}: %s keeps identical real predecessor states`, (phase) => {
      const input = snapshot(historyType, phase);
      const before = structuredClone(input);
      const { detail, visual } = views(input);
      expect(detail.steps.map(state)).toEqual(visual.steps.map(state));
      expect(detail.steps.filter((step) => step.active)).toHaveLength(1);
      expect(detail.steps.find((step) => step.active).label).not.toBe("样品运输中");
      expect(detail.steps.find((step) => step.label === "到货")).toMatchObject({ reached: true, time: originalArrival });
      for (const flow of [detail, visual]) {
        expect(staging(flow).map((step) => Boolean(step.reached))).toEqual(historyType === "none" ? [false, false] : [true, true]);
        expect(staging(flow).map((step) => step.time || "")).toEqual(["history", "events"].includes(historyType) ? [originalSent, originalStored] : ["", ""]);
        expect(staging(flow).every((step) => !step.active && !step.pauseResetRequired && !step.pauseResetState)).toBe(true);
      }
      expect(input).toEqual(before);
    });
  }

  test("does not borrow staging facts from another task, tray or after the current pause", () => {
    const input = snapshot("none");
    input.samples[0].history.push({ status: "已到达暂存间", time: originalStored, tray_code: "OTHER" });
    input.samples.push({ code: "FOREIGN", task_code: "OTHER-TASK", location: "恒温恒湿间（暂存间）", trays: [{ tray_code: "TP", quantity: 1 }], history: [{ status: "已到达暂存间", time: originalStored }] });
    input.stagingEvents.push(
      { task_code: "OTHER-TASK", tray_code: "TP", room: "staging", action: "stock_in", time: originalStored },
      { task_code: "T", tray_code: "TP", room: "staging", action: "stock_in", time: "2026-11-08 12:00:00" },
      { task_code: "T", tray_code: "OTHER", room: "staging", action: "stock_in", time: originalStored },
    );
    for (const flow of [views(input).detail, views(input).visual]) expect(staging(flow).every((step) => !step.reached && !step.time)).toBe(true);
  });

  test("second pause uses current recovery evidence without replacing earlier staging times", () => {
    const input = snapshot("history");
    input.experimentRunPauses.unshift({ ...input.experimentRunPauses[0], pause_no: "OLD", paused_at: "2026-11-08 09:10:00", resumed_at: "2026-11-08 09:20:00", status: "实验已恢复" });
    input.stagingEvents.unshift({ ...input.stagingEvents[1], pause_no: "OLD", time: "2026-11-08 09:15:00" });
    const { detail, visual } = views(input);
    expect(detail.steps.map(state)).toEqual(visual.steps.map(state));
    expect(detail.steps.find((step) => step.active).time).toBe(returnTime);
    expect(staging(detail).map((step) => step.time)).toEqual([originalSent, originalStored]);
  });

  test("staging before a previously completed experiment cannot fill the current salt route", () => {
    const input = snapshot("history");
    input.experiments.unshift({ task_code: "T", experiment_code: "V", experiment_name: "振动试验", required_device: "振动一室", status: "实验已完成" });
    input.experimentTrays.unshift({ task_code: "T", experiment_code: "V", tray_code: "TP" });
    input.experimentRuns.unshift({ task_code: "T", experiment_code: "V", run_no: "R-V", device: "振动一室", status: "实验已完成", started_at: "2026-11-08 07:40:00", ended_at: "2026-11-08 08:00:00" });
    input.experimentRunTrays.unshift({ task_code: "T", experiment_code: "V", run_no: "R-V", tray_code: "TP", run_tray_status: "实验已完成", ended_at: "2026-11-08 08:00:00" });
    input.samples[0].history.push({ action: "实验完成", status: "实验已完成", detail: "T / 振动试验 / 实验已完成", tray_code: "TP", location: "振动一室", time: "2026-11-08 08:00:00" });
    let result = views(input);
    expect(result.detail.steps.map(state)).toEqual(result.visual.steps.map(state));
    expect(staging(result.detail).every((step) => !step.reached && !step.time)).toBe(true);
    input.samples[0].history.push(
      { status: "送至暂存间", location: "恒温恒湿间（暂存间）", tray_code: "TP", time: "2026-11-08 08:10:00" },
      { status: "已到达暂存间", location: "恒温恒湿间（暂存间）", tray_code: "TP", time: "2026-11-08 08:20:00" },
    );
    result = views(input);
    expect(result.detail.steps.map(state)).toEqual(result.visual.steps.map(state));
    expect(staging(result.detail).map((step) => step.time)).toEqual(["2026-11-08 08:10:00", "2026-11-08 08:20:00"]);
  });

  test("post-experiment storage events do not prove a normal staging visit", () => {
    const input = snapshot("none");
    input.stagingEvents.push({ task_code: "T", tray_code: "TP", room: "staging", action: "stock_in", status: "实验后暂存间存放", location: "恒温恒湿间（实验后暂存间）", time: originalStored });
    for (const flow of [views(input).detail, views(input).visual]) expect(staging(flow).every((step) => !step.reached && !step.time)).toBe(true);
  });

  test("two returned trays preserve their own staging history", () => {
    const input = snapshot("history");
    input.samples.push({ ...structuredClone(input.samples[0]), code: "SP2", trays: [{ ...input.samples[0].trays[0], tray_code: "TP2" }], history: [{ status: "到货", time: originalArrival, tray_code: "TP2" }] });
    input.experimentRunTrays.push({ ...input.experimentRunTrays[0], tray_code: "TP2" });
    input.experimentTrays.push({ ...input.experimentTrays[0], tray_code: "TP2" });
    input.experimentRunPauses[0].inspection_tray_codes.push("TP2");
    input.stagingEvents.push(...input.stagingEvents.map((event) => ({ ...event, tray_code: "TP2" })));
    for (const trayCode of ["TP", "TP2"]) {
      const { detail, visual } = views(input, trayCode);
      expect(detail.steps.map(state)).toEqual(visual.steps.map(state));
      expect(staging(detail).map((step) => Boolean(step.reached))).toEqual(trayCode === "TP" ? [true, true] : [false, false]);
    }
  });

  test("real detail and visualization components render matching prior node tones", () => {
    const input = snapshot("none");
    const { panel } = views(input);
    const detail = mount(TrayManagementPanel, { props: { samplesFlow: {
      rawTasks: input.tasks, rawSamples: input.samples, rawExperiments: input.experiments, rawSchedules: input.schedules,
      rawExperimentRuns: input.experimentRuns, rawExperimentRunTrays: input.experimentRunTrays, rawExperimentTrays: input.experimentTrays,
      rawExperimentRunPauses: input.experimentRunPauses, rawStagingEvents: input.stagingEvents,
      trayRows: buildSamplesTrayOverviewView(input).rows, trayStatusOptions: [], warning: "",
    } } });
    const visual = mount(LabProcessScreen, { props: { labs: [panel] } });
    for (const label of ["送至暂存间", "已到达暂存间"]) {
      expect(detail.findAll('[data-testid="samples-tray-flow"] li').find((li) => li.text().includes(label)).classes()).not.toContain("reached");
      expect(visual.findAll(".visual-flow-step").find((li) => li.text().includes(label)).classes()).toContain("is-waiting");
    }
    detail.unmount();
    visual.unmount();
  });
});
