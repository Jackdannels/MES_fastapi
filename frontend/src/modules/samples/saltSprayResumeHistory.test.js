import { mount } from "@vue/test-utils";
import { describe, expect, test } from "vitest";
import { buildTrayFlowView, buildSamplesTrayOverviewView, normalizeLifecycleStatus, TRAY_STATUS_OPTIONS, DETAIL_STATUS_OPTIONS } from "./samplesFlowModel";
import { buildLabProcessPanels } from "../visualization/model";
import { resolveVisualFlowStepTone } from "../visualization/flowStepState";
import { LabProcessScreen } from "../visualization/screens/labProcessScreen";
import TrayFlowDialog from "./TrayFlowDialog.vue";

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

function arrivalOnlySnapshot(source, phase = "paused") {
  const input = snapshot("none", phase === "paused" ? "resumed" : phase);
  input.experiments.unshift({ task_code: "T", experiment_code: "V", experiment_name: "四综合试验", required_device: "四综合实验室", status: "实验已完成" });
  input.experimentTrays.unshift({ task_code: "T", experiment_code: "V", tray_code: "TP" });
  input.experimentRuns.unshift({ task_code: "T", experiment_code: "V", run_no: "R-V", device: "四综合实验室", status: "实验已完成", started_at: "2026-11-08 07:40:00", ended_at: "2026-11-08 08:00:00" });
  input.experimentRunTrays.unshift({ task_code: "T", experiment_code: "V", run_no: "R-V", tray_code: "TP", run_tray_status: "实验已完成", ended_at: "2026-11-08 08:00:00" });
  input.samples[0].history.push(
    { action: "实验完成", status: "实验已完成", detail: "T / 四综合试验 / 实验已完成", tray_code: "TP", location: "四综合实验室", time: "2026-11-08 08:00:00" },
    { action: "暂存间扫码出库", status: "送至实验室", detail: "TP 送至盐雾试验室", tray_code: "TP", location: "盐雾试验室", time: "2026-11-08 08:30:00" },
  );
  if (phase === "paused") {
    input.experimentRuns.find((run) => run.run_no === "R").status = "实验暂停";
    Object.assign(input.experimentRunPauses[0], { status: "实验暂停", resumed_at: "" });
    input.stagingEvents = [];
  }
  const arrival = { status: "已到达暂存间", location: "恒温恒湿间（暂存间）", time: source === "untimed" ? "" : "2026-11-08 08:20:00" };
  if (source === "events") {
    input.stagingEvents.push({ ...arrival, task_code: "T", tray_code: "TP", room: "staging", action: "stock_in" });
  } else {
    input.samples[0].history.push({ ...arrival, action: "暂存间扫码入库", detail: "TP 已到达暂存间", tray_code: "TP" });
  }
  return input;
}

function views(input, trayCode = "TP") {
  const row = buildSamplesTrayOverviewView(input).rows.find((row) => row.trayCode === trayCode);
  const detail = buildTrayFlowView({ ...input, taskCode: "T", trayCode, status: row.status, location: "" });
  const panel = buildLabProcessPanels({ ...input, labNames: ["盐雾试验室"] })[0];
  return { detail, panel, visual: panel.trays.find((tray) => tray.trayCode === trayCode) };
}

const state = (step) => ({ label: step.label, active: Boolean(step.active), reached: Boolean(step.reached), time: step.time || "", tone: resolveVisualFlowStepTone(step) });
const staging = (flow) => flow.steps.filter((step) => ["送至暂存间", "已到达暂存间"].includes(step.label));
const expectInferredStaging = (flow) => {
  const steps = staging(flow);
  expect(steps).toHaveLength(2);
  for (const step of steps) {
    expect(step).toMatchObject({ active: false, reached: true, inferred: true, time: "" });
    expect(resolveVisualFlowStepTone(step)).toBe("inferred");
  }
};

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
        expect(staging(flow).map((step) => Boolean(step.reached))).toEqual([true, true]);
        if (historyType === "none") expectInferredStaging(flow);
        expect(staging(flow).map((step) => step.time || "")).toEqual(["history", "events"].includes(historyType) ? [originalSent, originalStored] : ["", ""]);
        expect(staging(flow).every((step) => !step.active && !step.pauseResetRequired && !step.pauseResetState)).toBe(true);
      }
      expect(input).toEqual(before);
    });
  }

  test("pausing salt spray with no appearance visit preserves the regular inferred staging nodes", () => {
    const paused = snapshot("none", "resumed");
    Object.assign(paused.experimentRunPauses[0], { status: "实验暂停", resumed_at: "" });
    paused.experimentRuns[0].status = "实验暂停";
    paused.stagingEvents = [];
    const running = structuredClone(paused);
    running.experimentRunPauses = [];
    running.experimentRuns[0].status = "实验进行中";

    for (const consumer of ["detail", "visual"]) {
      const beforePause = views(running)[consumer];
      const duringPause = views(paused)[consumer];
      expect(duringPause.steps.find((step) => step.active).label).toBe("盐雾试验进行中（暂停）");
      expectInferredStaging(duringPause);
      expect(staging(duringPause).map(state)).toEqual(staging(beforePause).map(state));
    }
  });

  for (const source of ["history", "events", "untimed"]) {
    test.each(["paused", "returned", "compared", "installed", "fixture", "ready", "resumed"])(`${source}: %s keeps staging dispatch inferred after direct stock-in from a completed experiment`, (phase) => {
      const input = arrivalOnlySnapshot(source, phase);
      const before = structuredClone(input);
      const { detail, visual } = views(input);
      expect(detail.steps.map(state)).toEqual(visual.steps.map(state));
      expect(detail.steps.filter((step) => step.active)).toHaveLength(1);
      for (const flow of [detail, visual]) {
        const [sent, arrived] = staging(flow);
        expect(sent).toMatchObject({ active: false, reached: true, inferred: true, time: "" });
        expect(resolveVisualFlowStepTone(sent)).toBe("inferred");
        expect(arrived).toMatchObject({ active: false, reached: true, time: source === "untimed" ? "" : "2026-11-08 08:20:00" });
        expect(staging(flow).every((step) => !step.pauseResetRequired && !step.pauseResetState)).toBe(true);
        if (phase === "paused") {
          expect(flow.steps.find((step) => step.active).label).toBe("盐雾试验进行中（暂停）");
          expect(flow.steps.find((step) => step.label === "送至盐雾试验室").pauseResetState).toBe("historical");
        }
      }
      expect(input).toEqual(before);
    });
  }

  test.each(["history", "events"])("%s: real staging dispatch time takes precedence over stock-in inference", (source) => {
    const input = arrivalOnlySnapshot(source);
    input.samples[0].history.push({ status: "送至暂存间", location: "恒温恒湿间（暂存间）", tray_code: "TP", time: "2026-11-08 08:10:00" });
    const { detail, visual } = views(input);
    for (const flow of [detail, visual]) {
      expect(staging(flow)[0]).toMatchObject({ reached: true, inferred: false, time: "2026-11-08 08:10:00" });
      expect(resolveVisualFlowStepTone(staging(flow)[0])).toBe("done");
    }
  });

  test.each(["history", "events"])("%s: pausing does not change completed staging nodes after direct stock-in", (source) => {
    const paused = arrivalOnlySnapshot(source);
    const running = structuredClone(paused);
    running.experimentRunPauses = [];
    running.experimentRuns.find((run) => run.run_no === "R").status = "实验进行中";
    for (const consumer of ["detail", "visual"]) {
      const before = staging(views(running)[consumer]), after = staging(views(paused)[consumer]);
      expect(state(after[0])).toEqual(state(before[0]));
      expect(after.map((step) => ({ label: step.label, active: step.active, reached: step.reached })))
        .toEqual(before.map((step) => ({ label: step.label, active: step.active, reached: step.reached })));
    }
  });

  test.each(["history", "events"])("%s: arrival outside the original salt route cannot infer its staging dispatch", (source) => {
    for (const phase of ["paused", "returned", "resumed"]) {
      for (const time of ["2026-11-08 07:30:00", "2026-11-08 08:00:00", "2026-11-08 08:45:00", "2026-11-08 09:30:00", "2026-11-08 12:00:00"]) {
        const input = arrivalOnlySnapshot(source, phase);
        const arrival = source === "events" ? input.stagingEvents.at(-1) : input.samples[0].history.at(-1);
        arrival.time = time;
        const { detail, visual } = views(input);
        for (const flow of [detail, visual]) expectInferredStaging(flow);
      }
    }
  });

  test.each(["history", "events"])("%s: original salt stock-out event bounds staging history after an appearance return", (source) => {
    for (const time of ["2026-11-08 08:20:00", "2026-11-08 08:45:00"]) {
      const input = arrivalOnlySnapshot(source, "returned");
      input.samples[0].history = input.samples[0].history.filter((entry) => entry.action !== "暂存间扫码出库");
      const arrival = source === "events" ? input.stagingEvents.at(-1) : input.samples[0].history.at(-1);
      arrival.time = time;
      input.stagingEvents.push({ task_code: "T", tray_code: "TP", room: "staging", action: "stock_out", target_lab_code: "LAB_SALT", time: "2026-11-08 08:30:00" });
      const { detail, visual } = views(input);
      for (const flow of [detail, visual]) {
        if (time.endsWith("08:20:00")) {
          expect(staging(flow)[1]).toMatchObject({ reached: true, inferred: false, time });
        } else {
          expectInferredStaging(flow);
        }
        expect(staging(flow)[0].time).toBe("");
      }
    }
  });

  test("does not borrow staging facts from another task, tray or after the current pause", () => {
    const input = snapshot("none");
    input.samples[0].history.push({ status: "已到达暂存间", time: originalStored, tray_code: "OTHER" });
    input.samples.push({ code: "FOREIGN", task_code: "OTHER-TASK", location: "恒温恒湿间（暂存间）", trays: [{ tray_code: "TP", quantity: 1 }], history: [{ status: "已到达暂存间", time: originalStored }] });
    input.stagingEvents.push(
      { task_code: "OTHER-TASK", tray_code: "TP", room: "staging", action: "stock_in", time: originalStored },
      { task_code: "T", tray_code: "TP", room: "staging", action: "stock_in", time: "2026-11-08 12:00:00" },
      { task_code: "T", tray_code: "OTHER", room: "staging", action: "stock_in", time: originalStored },
    );
    for (const flow of [views(input).detail, views(input).visual]) expectInferredStaging(flow);
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
    expectInferredStaging(result.detail);
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
    for (const flow of [views(input).detail, views(input).visual]) expectInferredStaging(flow);
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
      if (trayCode === "TP") {
        expect(staging(detail).map((step) => step.time)).toEqual([originalSent, originalStored]);
      } else {
        expectInferredStaging(detail);
      }
    }
  });

  test("real detail and visualization components render matching prior node tones", () => {
    const input = snapshot("none");
    const { detail: flow, panel } = views(input);
    const detail = mount(TrayFlowDialog, { props: { open: true, trayCode: "TP", flow } });
    const visual = mount(LabProcessScreen, { props: { labs: [panel] } });
    for (const label of ["送至暂存间", "已到达暂存间"]) {
      const detailNode = detail.findAll('.sample-flow-unified--timed li').find((li) => li.text().includes(label));
      const visualNode = visual.findAll(".visual-flow-step").find((li) => li.text().includes(label));
      expect(detailNode.classes()).toContain("reached");
      expect(detailNode.get(".sample-flow-time").text()).toBe("-");
      expect(visualNode.classes()).toContain("is-inferred");
    }
    detail.unmount();
    visual.unmount();
  });

  test("real components keep direct stock-in staging dispatch green without inventing its time", () => {
    const input = arrivalOnlySnapshot("events");
    const { detail: flow, panel } = views(input);
    const detail = mount(TrayFlowDialog, { props: { open: true, trayCode: "TP", flow } });
    const visual = mount(LabProcessScreen, { props: { labs: [panel] } });
    const sentDetail = detail.findAll('.sample-flow-unified--timed li').find((li) => li.text().includes("送至暂存间"));
    expect(sentDetail.classes()).toContain("reached");
    expect(sentDetail.text()).toContain("-");
    expect(sentDetail.text()).not.toContain("08:20:00");
    const sentVisual = visual.findAll(".visual-flow-step").find((li) => li.text().includes("送至暂存间"));
    expect(sentVisual.classes()).toContain("is-inferred");
    expect(sentVisual.classes()).not.toContain("is-waiting");
    detail.unmount();
    visual.unmount();
  });
});
