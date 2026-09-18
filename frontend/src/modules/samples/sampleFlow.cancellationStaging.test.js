import { describe, expect, test } from "vitest";
import { buildTrayFlowView } from "./samplesFlowModel";
import { presentCancellationStaging } from "./sampleFlow.cancellationStaging";
import { buildLabProcessPanels } from "../visualization/model";

function snapshot(mold = false, status = "工装夹具安装") {
  const terminal = mold ? "实验已取消" : "设备故障试验取消";
  const name = mold ? "霉菌试验" : "高低温湿热试验";
  return {
    taskCode: "T", trayCode: "TP", status, location: "温度冲击一室", currentExperimentCode: "N",
    tasks: [{ code: "T" }],
    experiments: [{ task_code: "T", experiment_code: "E", experiment_name: name, required_device: mold ? "霉菌试验室" : "高低温湿热一室", status: "待排程" }, { task_code: "T", experiment_code: "N", experiment_name: "温度冲击试验", required_device: "温度冲击一室", status: "已排程" }],
    experimentTrays: ["E", "N"].map((experiment_code) => ({ task_code: "T", tray_code: "TP", experiment_code })),
    experimentRuns: [{ run_no: "R", task_code: "T", experiment_code: "E", status: terminal, ended_at: "2099-09-18 09:00:00" }],
    experimentRunTrays: [{ run_no: "R", task_code: "T", tray_code: "TP", experiment_code: "E", run_tray_status: terminal, ended_at: "2099-09-18 09:00:00" }],
    schedules: [{ id: "SN", task_code: "T", experiment_code: "N", device: "温度冲击一室", status: "已排程", start_at: "2099-09-18 10:00:00" }],
    samples: [{ code: "SP", task_code: "T", status, location: "温度冲击一室", trays: [{ tray_code: "TP", quantity: 1, status, target_experiment_code: "N", target_lab: "温度冲击一室" }], history: [
      { status: "工装夹具安装", time: "2099-09-18 10:01:00", location: "温度冲击一室", detail: "T / 温度冲击试验 / 工装夹具安装" },
      { status: "已到达实验室", time: "2099-09-18 10:00:00", location: "温度冲击一室", detail: "T / 温度冲击试验 / 已到达实验室" },
    ] }], stagingEvents: [],
  };
}
const pair = (flow) => flow.steps.filter((step) => step.key.startsWith("cancel-staging-"));

describe("fresh optional staging after cancellation", () => {
  test.each([false, true])("direct next comparison infers passed staging without inventing time, mold=%s", (mold) => {
    const input = snapshot(mold);
    const before = JSON.stringify(input);
    const flow = buildTrayFlowView(input);
    expect(pair(flow).map((step) => step.label)).toEqual(["送至暂存间", "已到达暂存间"]);
    expect(pair(flow).every((step) => !step.active && step.reached && step.inferred && !step.time)).toBe(true);
    expect(flow.steps.indexOf(pair(flow)[1])).toBeLessThan(flow.steps.findIndex((step) => step.active));
    const visual = buildLabProcessPanels({ ...input, labNames: ["温度冲击一室"] })[0].trays[0];
    expect(pair(visual)).toEqual(pair(flow));
    expect(JSON.stringify(input)).toBe(before);
  });

  test("mold cancellation keeps recovery before the new staging route without post-test storage", () => {
    const input = snapshot(true, "实验已取消");
    input.experiments = input.experiments.slice(0, 1);
    input.experimentTrays = input.experimentTrays.slice(0, 1);
    input.schedules = [];
    input.samples[0].history = [];
    const flow = buildTrayFlowView(input);
    const recovery = flow.steps.findIndex((step) => step.label === "霉菌取消后恢复处理");
    expect(recovery).toBeGreaterThan(-1);
    expect(flow.steps.indexOf(pair(flow)[0])).toBe(recovery + 1);
    expect(flow.steps.some((step) => step.label === "实验后暂存间存放")).toBe(false);
    expect(flow.steps.some((step) => step.label === "霉菌试验未完成")).toBe(true);
    expect(pair(flow).every((step) => !step.reached && !step.active && !step.time && !step.inferred)).toBe(true);
  });

  test("actual stock-in dates arrival only and remains visible after stock-out", () => {
    const input = snapshot();
    input.stagingEvents = [{ task_code: "T", tray_code: "TP", room: "staging", action: "stock_in", time: "2099-09-18 09:30:00", status: "已到达暂存间" }];
    let flow = buildTrayFlowView(input);
    expect(pair(flow)[0]).toMatchObject({ time: "", reached: true, active: false, inferred: true });
    expect(pair(flow)[1]).toMatchObject({ time: "2099-09-18 09:30:00", reached: true, active: false });
    expect(flow.steps.filter((step) => step.label === "已到达暂存间")).toHaveLength(1);
    input.status = input.samples[0].status = input.samples[0].trays[0].status = "已到达暂存间";
    input.location = input.samples[0].location = "恒温恒湿间（暂存间）";
    flow = buildTrayFlowView(input);
    expect(pair(flow)[1].active).toBe(true);
    expect(flow.steps.filter((step) => step.active)).toHaveLength(1);
  });

  test("older and unrelated stock-ins cannot activate the new placeholders", () => {
    const input = snapshot(false, "设备故障试验取消");
    input.samples[0].history = [];
    input.stagingEvents = [
      { task_code: "T", tray_code: "TP", room: "staging", action: "stock_in", time: "2099-09-18 08:00:00" },
      { task_code: "T", tray_code: "OTHER", room: "staging", action: "stock_in", time: "2099-09-18 09:30:00" },
    ];
    expect(pair(buildTrayFlowView(input)).every((step) => !step.reached && !step.active && !step.time)).toBe(true);
  });

  test("no cancellation leaves the normal flow untouched", () => {
    const flow = { steps: [{ key: "arrived_staging", label: "已到达暂存间", active: true }] };
    expect(presentCancellationStaging(flow, {})).toBe(flow);
  });

  test.each([false, true])("a future schedule alone cannot infer staging after cancellation, mold=%s", (mold) => {
    const input = snapshot(mold, mold ? "实验已取消" : "设备故障试验取消");
    input.samples[0].history = [];
    const flow = buildTrayFlowView(input);
    expect(pair(flow).every((step) => !step.reached && !step.inferred && !step.active && !step.time)).toBe(true);
  });

  test("old laboratory history cannot infer a new staging cycle", () => {
    const input = snapshot();
    input.samples[0].history = input.samples[0].history.map((entry) => ({ ...entry, time: "2099-09-18 08:00:00" }));
    expect(pair(buildTrayFlowView(input)).every((step) => !step.reached && !step.inferred && !step.time)).toBe(true);
  });

  test("fresh run evidence supports inference when comparison history is unavailable", () => {
    const input = snapshot(false, "实验进行中");
    input.samples[0].history = [];
    input.experimentRuns.push({ run_no: "NEXT", task_code: "T", experiment_code: "N", device: "温度冲击一室", status: "实验进行中", started_at: "2099-09-18 10:00:00" });
    input.experimentRunTrays.push({ run_no: "NEXT", task_code: "T", experiment_code: "N", tray_code: "TP", run_tray_status: "实验进行中", started_at: "2099-09-18 10:00:00" });
    expect(pair(buildTrayFlowView(input)).every((step) => step.reached && step.inferred && !step.active && !step.time)).toBe(true);
  });

  test("a repeated cancellation keeps old storage history but starts an empty new pair", () => {
    const input = snapshot();
    const oldArrival = { key: "old-stock", label: "已到达暂存间", time: "2099-09-18 09:30:00", reached: true, active: false };
    const flow = { steps: [
      { key: "cancel-R", kind: "device-fault-cancel", time: "2099-09-18 09:00:00" }, oldArrival,
      { key: "cancel-R2", kind: "device-fault-cancel", time: "2099-09-18 11:00:00", active: true },
    ] };
    input.stagingEvents = [{ task_code: "T", tray_code: "TP", room: "staging", action: "stock_in", time: oldArrival.time }];
    const projected = presentCancellationStaging(flow, input);
    expect(projected.steps.find((step) => step.key === "old-stock")).toEqual(oldArrival);
    expect(pair(projected).every((step) => !step.time && !step.reached && !step.active)).toBe(true);
    expect(projected.steps.slice(-2).map((step) => step.label)).toEqual(["送至暂存间", "已到达暂存间"]);
  });

  test("dispatch and arrival use separate real times and never duplicate nodes", () => {
    const input = snapshot();
    input.stagingEvents = [
      { task_code: "T", tray_code: "TP", room: "appearance", action: "stock_out", target_type: "staging", target_lab: "恒温恒湿间（暂存间）", time: "2099-09-18 09:20:00" },
      { task_code: "T", tray_code: "TP", room: "staging", action: "stock_in", time: "2099-09-18 09:30:00" },
      { task_code: "T", tray_code: "TP", room: "staging", action: "stock_out", target_type: "lab", target_lab: "温度冲击一室", target_experiment_code: "N", time: "2099-09-18 09:40:00" },
    ];
    const flow = buildTrayFlowView(input);
    expect(pair(flow).map((step) => step.time)).toEqual(["2099-09-18 09:20:00", "2099-09-18 09:30:00"]);
    expect(pair(flow).every((step) => step.reached && !step.active)).toBe(true);
    expect(flow.steps.filter((step) => step.label === "送至暂存间")).toHaveLength(1);
    expect(flow.steps.filter((step) => step.label === "已到达暂存间")).toHaveLength(1);
    expect(presentCancellationStaging(flow, input)).toEqual(flow);
  });
});
