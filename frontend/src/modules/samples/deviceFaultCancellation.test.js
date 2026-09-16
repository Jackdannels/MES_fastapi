import { describe, expect, test } from "vitest";
import { buildTrayFlowView } from "./samplesFlowModel";
import { buildLaboratoryWorkbenchView } from "../laboratory/model";
import { buildZancunRowsFromSnapshot } from "../staging-management/model";
import { DEVICE_FAULT_CANCELED } from "@/lib/deviceFaultCancellation";

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
      "样品运输中", "到货", DEVICE_FAULT_CANCELED,
    ]);
    expect(occurred.map((step) => step.time)).toEqual(["07:00:00", "07:10:00", "09:00:00"].map((time) => `2099-09-15 ${time}`));
    const canceled = occurred.at(-1);
    expect(canceled.collapsedSteps.map((step) => step.time)).toEqual(["07:20:00", "07:30:00", "07:40:00", "07:50:00", "08:00:00"].map((time) => `2099-09-15 ${time}`));
    expect(flow.steps.slice(3, 10).map((step) => step.label)).toEqual(["送至暂存间", "已到达暂存间", "送至实验室", "已到达实验室", "工装夹具安装", "实验准备就绪", "四综合试验未完成"]);
    expect(flow.steps.slice(3).every((step) => !step.reached && !step.active && !step.time)).toBe(true);
    expect(flow.steps.slice(-2).map((step) => step.label)).toEqual(["四综合试验未完成", "厂家收回"]);
    expect(flow.steps.some((step) => step.label === "实验后暂存间存放")).toBe(false);
    expect(flow.steps.some((step) => step.label === "四综合试验已完成")).toBe(false);
    expect(flow.steps.filter((step) => step.active).map((step) => step.label)).toEqual([DEVICE_FAULT_CANCELED]);
    expect(JSON.stringify(data)).toBe(before);
  });
  test("preserves canceled attempt in the original flow without marking success", () => {
    const flow = buildTrayFlowView(snapshot());
    expect(flow.status).toBe(DEVICE_FAULT_CANCELED);
    expect(flow.steps.filter((step) => step.active).map((step) => step.label)).toEqual([DEVICE_FAULT_CANCELED]);
    expect(flow.steps.find((step) => step.label === DEVICE_FAULT_CANCELED)).toMatchObject({ runNo: "R", time: "2099-09-15 09:00:00", reached: true });
    expect(flow.steps.some((step) => step.reached && step.label === "冲击试验已完成")).toBe(false);
    const canceledIndex = flow.steps.findIndex((step) => step.label === DEVICE_FAULT_CANCELED);
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
    expect(labels.indexOf(DEVICE_FAULT_CANCELED)).toBeGreaterThan(labels.indexOf("到货"));
    expect(flow.steps.find((step) => step.label === "到货").time).toBe("");
    expect(flow.steps.find((step) => step.label === DEVICE_FAULT_CANCELED).collapsedSteps.at(-1).time).toBe("2099-09-15 08:00:00");
    expect(flow.steps.find((step) => step.label === "冲击试验未完成")).toMatchObject({ reached: false, active: false, time: "" });
  });

  test("keeps a rescheduled attempt pending after the historical cancellation", () => {
    const data = snapshot();
    data.experiments = data.experiments.slice(0, 1);
    data.experimentTrays = data.experimentTrays.slice(0, 1);
    data.schedules = [{ id: "NEW-SCHEDULE", task_code: data.taskCode, experiment_code: "E", device: "冲击二室", start_at: "2099-09-16 08:00:00", status: "已排程" }];
    const flow = buildTrayFlowView(data);
    const cancelIndex = flow.steps.findIndex((step) => step.label === DEVICE_FAULT_CANCELED);
    const newCompletedIndex = flow.steps.findIndex((step) => step.key === "completed");
    expect(newCompletedIndex).toBeGreaterThan(cancelIndex);
    expect(flow.steps[newCompletedIndex]).toMatchObject({ reached: false, active: false, time: "" });
    expect(flow.steps[newCompletedIndex].label).toBe("冲击试验未完成");
    expect(flow.steps.some((step) => step.label === "实验后暂存间存放")).toBe(false);
    expect(flow.steps.find((step) => step.key === "sent_to_lab").label).toBe("送至冲击二室");
    expect(flow.steps.filter((step) => step.active).map((step) => step.label)).toEqual([DEVICE_FAULT_CANCELED]);
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
    expect(flow.steps.find((step) => step.label === DEVICE_FAULT_CANCELED)).toMatchObject({ reached: true, active: false });
    expect(flow.status).not.toBe(DEVICE_FAULT_CANCELED);
  });

  test.each([["冲击试验", "冲击一室", false], ["盐雾试验", "盐雾试验室", true], ["霉菌试验", "霉菌试验室", true], ["高低温湿热试验", "高低温湿热二室", true]])("%s storage candidates", (name, lab, appearance) => {
    const data = snapshot(name, lab);
    const storage = Object.fromEntries(Object.entries({ tasks: data.tasks, devices: data.devices, experiments: data.experiments, samples: data.samples, schedules: data.schedules,
      experiment_trays: data.experimentTrays, experiment_runs: data.experimentRuns, experiment_run_trays: data.experimentRunTrays }).map(([key, value]) => [`mes.${key}`, value]));
    expect(buildZancunRowsFromSnapshot(storage, { room: "staging" })[0]?.status).toBe("待入库");
    expect(buildZancunRowsFromSnapshot(storage, { room: "appearance" }).length > 0).toBe(appearance);
  });
});
