import { describe, expect, test } from "vitest";
import { buildTrayFlowView } from "./samplesFlowModel";
import { buildLaboratoryWorkbenchView } from "../laboratory/model";
import { buildZancunRowsFromSnapshot } from "../staging-management/model";
import { DEVICE_FAULT_CANCELED } from "@/lib/deviceFaultCancellation";
import { buildLabProcessPanels } from "../visualization/model";

function snapshot(name = "冲击试验", lab = "冲击一室") {
  const taskCode = "TASK-FAULT", trayCode = "TASK-FAULT-TP-001";
  return {
    taskCode, trayCode, status: DEVICE_FAULT_CANCELED, location: lab,
    tasks: [{ code: taskCode, status: "任务进行中" }],
    devices: [{ code: lab, status: "维修" }, { code: "振动一室", status: "可用" }],
    experiments: [{ task_code: taskCode, experiment_code: "E", experiment_name: name, required_device: lab, status: "待排程" },
      { task_code: taskCode, experiment_code: "NEXT", experiment_name: "振动试验", required_device: "振动一室", status: "已排程" }],
    experimentTrays: ["E", "NEXT"].map((experiment_code) => ({ task_code: taskCode, tray_code: trayCode, experiment_code })),
    schedules: [{ id: "S2", task_code: taskCode, experiment_code: "NEXT", device: "振动一室", start_at: "2099-09-15 10:00:00", end_at: "2099-09-15 12:00:00", status: "已排程" }],
    experimentRuns: [{ run_no: "R", task_code: taskCode, experiment_code: "E", schedule_id: "S1", device: lab, status: DEVICE_FAULT_CANCELED, started_at: "2099-09-15 08:00:00", ended_at: "2099-09-15 09:00:00" }],
    experimentRunTrays: [{ run_no: "R", task_code: taskCode, experiment_code: "E", tray_code: trayCode, run_tray_status: DEVICE_FAULT_CANCELED, ended_at: "2099-09-15 09:00:00" }],
    samples: [{ code: "SP", task_code: taskCode, location: lab, status: DEVICE_FAULT_CANCELED, flow_status: DEVICE_FAULT_CANCELED,
      trays: [{ tray_code: trayCode, status: DEVICE_FAULT_CANCELED, quantity: 1 }],
      history: [{ action: DEVICE_FAULT_CANCELED, detail: `${taskCode} / ${name} / ${DEVICE_FAULT_CANCELED}`, time: "2099-09-15 09:00:00", status: DEVICE_FAULT_CANCELED },
        { action: "开始实验", detail: `${taskCode} / ${name} / 实验进行中`, time: "2099-09-15 08:00:00", status: "实验进行中" }] }],
  };
}

describe("device fault cancellation projections", () => {
  test.each(["已到达实验室", "工装夹具安装", "实验准备就绪", "实验进行中", "实验已完成"])("old cancellation stays folded during next experiment: %s", (status) => {
    const data = snapshot();
    const stages = ["已到达实验室", "工装夹具安装", "实验准备就绪", "实验进行中", "实验已完成"];
    const rank = stages.indexOf(status);
    data.status = status;
    data.location = "振动一室";
    data.currentExperimentCode = "NEXT";
    data.samples[0].status = data.samples[0].flow_status = data.samples[0].trays[0].status = status;
    data.samples[0].location = "振动一室";
    data.samples[0].trays[0].target_experiment_code = "NEXT";
    data.samples[0].history.unshift(...stages.slice(0, rank + 1).map((stage, index) => ({
      status: stage, time: `2099-09-15 10:0${index}:00`, location: "振动一室",
      detail: `${data.taskCode} / 振动试验 / ${stage} / 托盘：${data.trayCode}`,
    })));
    if (rank >= 3) {
      data.experiments[1].status = data.schedules[0].status = status;
      data.experimentRuns.push({ run_no: "NEW", task_code: data.taskCode, experiment_code: "NEXT", schedule_id: "S2", device: "振动一室", status, started_at: "2099-09-15 10:03:00", ended_at: rank === 4 ? "2099-09-15 10:04:00" : "" });
      data.experimentRunTrays.push({ run_no: "NEW", task_code: data.taskCode, experiment_code: "NEXT", tray_code: data.trayCode, run_tray_status: status, started_at: "2099-09-15 10:03:00", ended_at: rank === 4 ? "2099-09-15 10:04:00" : "" });
    }
    const before = JSON.stringify(data);
    const flow = buildTrayFlowView(data);
    const cancellation = flow.steps.find((step) => step.label.includes(DEVICE_FAULT_CANCELED));
    expect(cancellation).toBeDefined();
    expect(cancellation).not.toHaveProperty("collapsedSteps");
    expect(flow.steps.some((step) => step.label === "冲击试验进行中")).toBe(false);
    for (const label of ["送至暂存间", "已到达暂存间"]) {
      expect(flow.steps.find((step) => step.label === label)).toMatchObject({ reached: true, inferred: true, active: false, time: "" });
    }
    expect(flow.steps.filter((step) => step.reached || step.active).some((step) => step.label === "送至振动一室")).toBe(false);
    const newArrival = flow.steps.find((step) => step.label === "已到达实验室");
    if (newArrival) {
      expect(flow.steps.indexOf(cancellation)).toBeLessThan(flow.steps.indexOf(newArrival));
      expect(newArrival.time).toBe("2099-09-15 10:00:00");
    }
    expect(flow.steps.filter((step) => step.active)).toHaveLength(1);
    const panels = buildLabProcessPanels({ ...data, labNames: ["振动一室"] });
    expect(JSON.stringify(panels)).toContain("device-fault-canceled-R");
    expect(panels[0].trays[0].steps.map((step) => ({ label: step.label, time: step.time, active: step.active, reached: step.reached })))
      .toEqual(flow.steps.map((step) => ({ label: step.label, time: step.time, active: step.active, reached: step.reached })));
    expect(JSON.stringify(data)).toBe(before);
  });

  test.each([["staging", "已到达暂存间", "恒温恒湿间（暂存间）"], ["appearance", "实验后外观检测间存放", "外观检测间"]])("keeps real %s stock-in after the fixed summary", (room, status, location) => {
    const data = snapshot("盐雾试验", "盐雾试验室");
    data.status = status;
    data.location = location;
    data.samples[0].status = data.samples[0].flow_status = data.samples[0].trays[0].status = status;
    data.samples[0].location = location;
    data.samples[0].history.unshift({ status, location, time: "2099-09-15 09:30:00", action: "扫码入库", detail: `${data.trayCode} ${status}` });
    data.stagingEvents = [{ room, action: "stock_in", task_code: data.taskCode, tray_code: data.trayCode, time: "2099-09-15 09:30:00", status, source_run_no: "R", source_experiment_code: "E", appearance_phase: "device_fault_recovery" }];
    const before = JSON.stringify(data);
    const flow = buildTrayFlowView(data);
    const active = flow.steps.filter((step) => step.active);
    expect(active).toHaveLength(1);
    expect(active[0].time).toBe("2099-09-15 09:30:00");
    expect(flow.steps.indexOf(active[0])).toBeGreaterThan(flow.steps.findIndex((step) => step.kind === "device-fault-cancel"));
    expect(flow.steps.some((step) => step.label === "盐雾试验进行中")).toBe(false);
    expect(JSON.stringify(data)).toBe(before);
  });
  test("multi-experiment cancellation folds the old route before the next scheduled route", () => {
    const data = snapshot("四综合试验", "四综合实验室");
    data.experiments[1].experiment_name = "高低温湿热试验";
    data.schedules[0].device = "高低温湿热一室";
    data.samples[0].history.unshift(...[
      ["送至实验室", "07:30:00"], ["已到达实验室", "07:40:00"],
      ["工装夹具安装", "07:45:00"], ["实验准备就绪", "07:50:00"],
    ].map(([status, time]) => ({ status, time: `2099-09-15 ${time}`, location: "四综合实验室",
      detail: `${data.taskCode} / 四综合试验 / ${status} / 托盘：${data.trayCode}` })));
    const before = JSON.stringify(data);
    const flow = buildTrayFlowView(data);
    expect(flow.steps.map((step) => step.label)).toEqual([
      "样品运输中", "到货", expect.stringContaining(DEVICE_FAULT_CANCELED),
      "送至暂存间", "已到达暂存间", "送至高低温湿热一室", "已到达实验室", "工装夹具安装", "实验准备就绪",
      "高低温湿热试验未完成", "四综合试验未完成", "厂家收回",
    ]);
    expect(flow.steps.slice(3).every((step) => !step.active && !step.reached && !step.time)).toBe(true);
    expect(flow.steps[2]).not.toHaveProperty("collapsedSteps");
    expect(JSON.stringify(data)).toBe(before);
  });
  test("single canceled experiment folds the old attempt and retains a fresh unfinished route", () => {
    const data = snapshot("四综合试验", "四综合实验室");
    data.experiments = data.experiments.slice(0, 1);
    data.experimentTrays = data.experimentTrays.slice(0, 1);
    data.schedules = [];
    data.samples[0].history.push(...[
      ["样品分装托盘", "运输中", "07:00:00", ""],
      ["任务已确认入库", "到货", "07:10:00", "接驳区"],
      ["送至实验室", "送至实验室", "07:20:00", "四综合实验室"],
      ["任务比对", "已到达实验室", "07:30:00", "四综合实验室"],
      ["样品安装", "工装夹具安装", "07:40:00", "四综合实验室"],
      ["实验确认", "实验准备就绪", "07:50:00", "四综合实验室"],
    ].map(([action, status, time, location]) => ({ action, status, time: `2099-09-15 ${time}`, location,
      detail: `${data.taskCode} / 四综合试验 / ${status} / 托盘：${data.trayCode}` })));
    const before = JSON.stringify(data);
    const flow = buildTrayFlowView(data);
    const occurred = flow.steps.filter((step) => step.reached || step.active);
    expect(occurred.map((step) => step.label)).toEqual([
      "样品运输中", "到货", expect.stringContaining(DEVICE_FAULT_CANCELED),
    ]);
    expect(occurred.map((step) => step.time)).toEqual(["07:00:00", "07:10:00", "09:00:00"].map((time) => `2099-09-15 ${time}`));
    const canceled = occurred.at(-1);
    expect(canceled).not.toHaveProperty("collapsedSteps");
    expect(flow.steps.slice(3, 10).map((step) => step.label)).toEqual(["送至暂存间", "已到达暂存间", "送至实验室", "已到达实验室", "工装夹具安装", "实验准备就绪", "四综合试验未完成"]);
    expect(flow.steps.slice(3).every((step) => !step.reached && !step.active && !step.time)).toBe(true);
    expect(flow.steps.slice(-2).map((step) => step.label)).toEqual(["四综合试验未完成", "厂家收回"]);
    expect(flow.steps.some((step) => step.label === "实验后暂存间存放")).toBe(false);
    expect(flow.steps.some((step) => step.label === "四综合试验已完成")).toBe(false);
    expect(flow.steps.filter((step) => step.active).map((step) => step.label)).toEqual([expect.stringContaining(DEVICE_FAULT_CANCELED)]);
    expect(JSON.stringify(data)).toBe(before);
  });

  test("multi-experiment rerun follows its new schedule and never reuses old milestone times", () => {
    const data = snapshot();
    data.schedules.push({ id: "RERUN", task_code: data.taskCode, experiment_code: "E", device: "冲击二室", status: "已排程", start_at: "2099-09-15 09:30:00" });
    const flow = buildTrayFlowView(data);
    const cancelIndex = flow.steps.findIndex((step) => step.kind === "device-fault-cancel");
    expect(flow.steps.findIndex((step) => step.label === "送至冲击二室")).toBeGreaterThan(cancelIndex);
    expect(flow.steps.filter((step) => step.label.endsWith("未完成")).map((step) => step.label)).toEqual(["冲击试验未完成", "振动试验未完成"]);
    expect(flow.steps.slice(cancelIndex + 1).every((step) => !step.active && !step.reached && !step.time)).toBe(true);
  });

  test("retains an earlier completed experiment ahead of the cancellation", () => {
    const data = snapshot();
    data.experiments[1].status = "实验已完成";
    data.schedules[0].status = "实验已完成";
    data.experimentRuns.push({ run_no: "COMPLETED", task_code: data.taskCode, experiment_code: "NEXT", device: "振动一室", status: "实验已完成", started_at: "2099-09-15 06:00:00", ended_at: "2099-09-15 07:00:00" });
    data.experimentRunTrays.push({ run_no: "COMPLETED", task_code: data.taskCode, experiment_code: "NEXT", tray_code: data.trayCode, run_tray_status: "实验已完成", ended_at: "2099-09-15 07:00:00" });
    const flow = buildTrayFlowView(data);
    const completedIndex = flow.steps.findIndex((step) => step.label === "振动试验已完成");
    const cancelIndex = flow.steps.findIndex((step) => step.kind === "device-fault-cancel");
    expect(completedIndex).toBeGreaterThan(-1);
    expect(completedIndex).toBeLessThan(cancelIndex);
    expect(flow.steps[completedIndex]).toMatchObject({ reached: true, active: false, time: "2099-09-15 07:00:00" });
    expect(flow.steps.filter((step) => /^route-\d+-\d+$/.test(step.key)).every((step) => flow.steps.indexOf(step) > cancelIndex)).toBe(true);
  });

  test("repeated cancellations stay chronological before a single pending route", () => {
    const data = snapshot();
    data.experimentRuns.push({ ...data.experimentRuns[0], run_no: "R2", schedule_id: "RERUN", started_at: "2099-09-15 09:10:00", ended_at: "2099-09-15 09:20:00" });
    data.experimentRunTrays.push({ ...data.experimentRunTrays[0], run_no: "R2", ended_at: "2099-09-15 09:20:00" });
    const flow = buildTrayFlowView(data);
    const cancellations = flow.steps.filter((step) => step.kind === "device-fault-cancel");
    expect(cancellations.map((step) => step.runNo)).toEqual(["R", "R2"]);
    expect(flow.steps.filter((step) => step.active)).toEqual([cancellations[1]]);
    expect(flow.steps.filter((step) => step.label === "送至暂存间")).toHaveLength(1);
    expect(flow.steps.findIndex((step) => step.label === "送至暂存间")).toBeGreaterThan(flow.steps.indexOf(cancellations[1]));
  });
  test("preserves canceled attempt in the original flow without marking success", () => {
    const flow = buildTrayFlowView(snapshot());
    expect(flow.status).toBe(DEVICE_FAULT_CANCELED);
    expect(flow.steps.filter((step) => step.active).map((step) => step.label)).toEqual([expect.stringContaining(DEVICE_FAULT_CANCELED)]);
    expect(flow.steps.find((step) => step.kind === "device-fault-cancel")).toMatchObject({ runNo: "R", time: "2099-09-15 09:00:00", reached: true });
    expect(flow.steps.some((step) => step.reached && step.label === "冲击试验已完成")).toBe(false);
    const canceledIndex = flow.steps.findIndex((step) => step.kind === "device-fault-cancel");
    const unfinishedIndex = flow.steps.findIndex((step) => step.label === "冲击试验未完成");
    expect(unfinishedIndex).toBeGreaterThan(canceledIndex);
    expect(flow.steps[unfinishedIndex]).toMatchObject({ active: false, reached: false, time: "" });
  });

  test("allows the next scheduled experiment comparison", () => {
    const view = buildLaboratoryWorkbenchView({ ...snapshot(), labName: "振动一室", selectedTaskCode: "TASK-FAULT", selectedTrayCode: "TASK-FAULT-TP-001" });
    expect(view.currentTask.experimentCode).toBe("NEXT");
    expect(view.currentTask.trayRows[0].deviceFaultCanceledEligible).toBe(true);
  });

  test("does not place cancellation before foundational steps when milestone times are absent", () => {
    const data = snapshot();
    data.experiments = data.experiments.slice(0, 1);
    data.experimentTrays = data.experimentTrays.slice(0, 1);
    data.schedules = [];
    data.samples[0].history = [];
    const flow = buildTrayFlowView(data);
    const labels = flow.steps.map((step) => step.label);
    expect(labels.findIndex((label) => label.includes(DEVICE_FAULT_CANCELED))).toBeGreaterThan(labels.indexOf("到货"));
    expect(flow.steps.find((step) => step.label === "到货").time).toBe("");
    expect(flow.steps.find((step) => step.kind === "device-fault-cancel")).not.toHaveProperty("collapsedSteps");
    expect(flow.steps.find((step) => step.label === "冲击试验未完成")).toMatchObject({ reached: false, active: false, time: "" });
  });

  test("keeps a rescheduled attempt pending after the historical cancellation", () => {
    const data = snapshot();
    data.experiments = data.experiments.slice(0, 1);
    data.experimentTrays = data.experimentTrays.slice(0, 1);
    data.schedules = [{ id: "NEW-SCHEDULE", task_code: data.taskCode, experiment_code: "E", device: "冲击二室", start_at: "2099-09-16 08:00:00", status: "已排程" }];
    const flow = buildTrayFlowView(data);
    const cancelIndex = flow.steps.findIndex((step) => step.kind === "device-fault-cancel");
    const newCompletedIndex = flow.steps.findIndex((step) => step.key === "completed");
    expect(newCompletedIndex).toBeGreaterThan(cancelIndex);
    expect(flow.steps[newCompletedIndex]).toMatchObject({ reached: false, active: false, time: "" });
    expect(flow.steps[newCompletedIndex].label).toBe("冲击试验未完成");
    expect(flow.steps.some((step) => step.label === "实验后暂存间存放")).toBe(false);
    expect(flow.steps.find((step) => step.key === "sent_to_lab").label).toBe("送至冲击二室");
    expect(flow.steps.filter((step) => step.active).map((step) => step.label)).toEqual([expect.stringContaining(DEVICE_FAULT_CANCELED)]);
  });

  test("keeps the old cancellation node after a newer experiment starts", () => {
    const data = snapshot();
    data.status = "实验进行中";
    data.location = "振动一室";
    data.currentExperimentCode = "NEXT";
    data.samples[0].status = "实验进行中";
    data.samples[0].flow_status = "实验进行中";
    data.samples[0].location = "振动一室";
    data.samples[0].trays[0].status = "实验进行中";
    data.experiments[1].status = "实验进行中";
    data.schedules[0].status = "实验进行中";
    data.experimentRuns.push({ run_no: "NEW", task_code: data.taskCode, experiment_code: "NEXT", schedule_id: "S2", device: "振动一室", status: "实验进行中", started_at: "2099-09-15 10:00:00" });
    data.experimentRunTrays.push({ run_no: "NEW", task_code: data.taskCode, experiment_code: "NEXT", tray_code: data.trayCode, run_tray_status: "实验进行中", started_at: "2099-09-15 10:00:00" });
    const flow = buildTrayFlowView(data);
    expect(flow.steps.find((step) => step.kind === "device-fault-cancel")).toMatchObject({ reached: true, active: false });
    expect(flow.status).not.toBe(DEVICE_FAULT_CANCELED);
  });

  test.each(["工装夹具安装", "实验进行中", "实验已完成"])("same experiment rerun does not reuse its canceled attempt: %s", (status) => {
    const data = snapshot();
    data.experiments = data.experiments.slice(0, 1);
    data.experimentTrays = data.experimentTrays.slice(0, 1);
    data.schedules = [{ id: "RERUN", task_code: data.taskCode, experiment_code: "E", device: "冲击一室", start_at: "2099-09-15 10:00:00", status }];
    data.status = status;
    data.currentExperimentCode = "E";
    data.samples[0].status = data.samples[0].flow_status = data.samples[0].trays[0].status = status;
    data.samples[0].history.unshift({ status: "已到达实验室", time: "2099-09-15 10:00:00", location: "冲击一室", detail: `${data.taskCode} / 冲击试验 / 已到达实验室` },
      { status, time: "2099-09-15 10:01:00", location: "冲击一室", detail: `${data.taskCode} / 冲击试验 / ${status}` });
    if (status !== "工装夹具安装") {
      data.experimentRuns.push({ ...data.experimentRuns[0], run_no: "R2", schedule_id: "RERUN", status, started_at: "2099-09-15 10:01:00", ended_at: status === "实验已完成" ? "2099-09-15 10:02:00" : "" });
      data.experimentRunTrays.push({ ...data.experimentRunTrays[0], run_no: "R2", run_tray_status: status, started_at: "2099-09-15 10:01:00", ended_at: status === "实验已完成" ? "2099-09-15 10:02:00" : "" });
      data.experiments[0].status = status;
    }
    const before = JSON.stringify(data);
    const flow = buildTrayFlowView(data);
    expect(flow.steps.filter((step) => step.kind === "device-fault-cancel")).toHaveLength(1);
    expect(flow.steps.some((step) => step.time === "2099-09-15 08:00:00")).toBe(false);
    const active = flow.steps.filter((step) => step.active);
    expect(active).toHaveLength(1);
    expect(active[0].time.startsWith("2099-09-15 10:")).toBe(true);
    expect(flow.steps.indexOf(active[0])).toBeGreaterThan(flow.steps.findIndex((step) => step.kind === "device-fault-cancel"));
    expect(flow.steps.some((step) => "collapsedSteps" in step)).toBe(false);
    expect(JSON.stringify(data)).toBe(before);
  });

  test.each([["冲击试验", "冲击一室", false], ["盐雾试验", "盐雾试验室", true], ["霉菌试验", "霉菌试验室", true], ["高低温湿热试验", "高低温湿热二室", true]])("%s storage candidates", (name, lab, appearance) => {
    const data = snapshot(name, lab);
    const storage = Object.fromEntries(Object.entries({ tasks: data.tasks, devices: data.devices, experiments: data.experiments, samples: data.samples, schedules: data.schedules,
      experiment_trays: data.experimentTrays, experiment_runs: data.experimentRuns, experiment_run_trays: data.experimentRunTrays }).map(([key, value]) => [`mes.${key}`, value]));
    expect(buildZancunRowsFromSnapshot(storage, { room: "staging" })[0]?.status).toBe("待入库");
    expect(buildZancunRowsFromSnapshot(storage, { room: "appearance" }).length > 0).toBe(appearance);
  });
});
