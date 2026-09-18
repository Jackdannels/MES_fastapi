import { describe, expect, test } from "vitest";
import { buildTrayFlowView } from "./sampleFlow.trayFlowView";
import { mount } from "@vue/test-utils";
import TrayManagementPanel from "./TrayManagementPanel.vue";

const taskCode = "SYLUN-2026-09-012", trayCode = `${taskCode}-TP-001`, moldCode = `${taskCode}-A`, otherCode = `${taskCode}-B`;
const canceledAt = "2026-09-18 16:24:16";
const preparation = ["送至实验室", "已到达实验室", "工装夹具安装", "实验准备就绪"];
const inputFor = () => ({
  taskCode, trayCode, currentExperimentCode: moldCode, status: "实验已取消", location: "霉菌试验室",
  experiments: [{ task_code: taskCode, experiment_code: moldCode, experiment_name: "霉菌试验", status: "待排程" }],
  experimentTrays: [{ task_code: taskCode, experiment_code: moldCode, tray_code: trayCode }],
  experimentRuns: [{ task_code: taskCode, experiment_code: moldCode, run_no: "old-run", schedule_id: "old-schedule", status: "实验已取消", started_at: "2026-09-18 16:24:12", ended_at: canceledAt }],
  experimentRunTrays: [{ task_code: taskCode, experiment_code: moldCode, tray_code: trayCode, run_no: "old-run", run_tray_status: "实验已取消", ended_at: canceledAt }],
  schedules: [], stagingEvents: [],
  samples: [{ task_code: taskCode, code: `${taskCode}-SP-001`, status: "实验已取消", location: "霉菌试验室",
    trays: [{ tray_code: trayCode, status: "实验已取消" }],
    history: [
      { status: "到货", time: "2026-09-18 16:23:29", tray_code: trayCode },
      ...preparation.map((status, index) => ({ status, action: ["派送", "任务比对", "样品安装", "实验确认"][index], detail: `${taskCode} / 霉菌试验 / ${status}`, time: `2026-09-18 16:24:0${index}`, experiment_code: moldCode, schedule_id: "old-schedule", location: "霉菌试验室", tray_code: trayCode })),
      { status: "实验已取消", time: canceledAt, tray_code: trayCode },
    ],
  }],
});
const schedule = (code = moldCode, id = "new-schedule", start = "2026-09-19 08:00:00") => ({
  task_code: taskCode, experiment_code: code, id, start_at: start, device: code === moldCode ? "霉菌试验室" : "四综合实验室", status: "已排程", tray_codes: [trayCode],
});
const setStatus = (input, status, location = "霉菌试验室") => {
  input.status = status; input.location = location;
  input.samples[0].status = status; input.samples[0].location = location;
  input.samples[0].trays[0].status = status;
};

describe("mold cancellation next-attempt route", () => {
  test("screenshot regression: unscheduled single mold cancellation retains a clean preparation route", () => {
    const input = inputFor(), before = JSON.stringify(input);
    const flow = buildTrayFlowView(input);
    expect(flow.steps.map((step) => step.label)).toEqual([
      "样品运输中", "到货", "霉菌试验已取消", "霉菌取消后恢复处理", "送至暂存间", "已到达暂存间",
      "待重新排程", ...preparation, "霉菌试验未完成", "厂家收回",
    ]);
    const canceledIndex = flow.steps.findIndex((step) => step.label === "霉菌试验已取消");
    expect(flow.steps[canceledIndex]).toMatchObject({ active: true, time: canceledAt });
    flow.steps.slice(canceledIndex + 1).forEach((step) => expect(step).toMatchObject({ active: false, reached: false, time: "" }));
    expect(JSON.stringify(input)).toBe(before);
  });

  test("new schedule names the destination without completing any new preparation", () => {
    const input = inputFor();
    input.schedules = [schedule(moldCode, "old-schedule", "2026-09-18 08:00:00"), schedule()];
    const flow = buildTrayFlowView(input);
    expect(flow.steps.some((step) => step.label === "待重新排程")).toBe(false);
    expect(flow.steps.find((step) => step.label === "送至霉菌试验室")).toMatchObject({ scheduleId: "new-schedule", experimentCode: moldCode, reached: false, active: false, time: "" });
    expect(flow.steps.filter((step) => step.label === "工装夹具安装")).toHaveLength(1);
  });

  test("next other experiment is ordered before the unfinished mold obligation and ignores other trays", () => {
    const input = inputFor();
    input.experiments.push({ task_code: taskCode, experiment_code: otherCode, experiment_name: "四综合试验", status: "已排程" });
    input.experimentTrays.push({ task_code: taskCode, experiment_code: otherCode, tray_code: trayCode });
    input.schedules = [schedule(moldCode, "later", "2026-09-20 08:00:00"), schedule(otherCode), { ...schedule(moldCode, "wrong-tray", "2026-09-18 08:00:00"), tray_codes: ["OTHER-TRAY"] }];
    const flow = buildTrayFlowView(input), labels = flow.steps.map((step) => step.label);
    expect(flow.steps.find((step) => step.label === "送至四综合实验室")).toMatchObject({ experimentCode: otherCode, active: false, reached: false, time: "" });
    expect(labels.indexOf("实验准备就绪")).toBeLessThan(labels.indexOf("四综合试验未完成"));
    expect(labels.indexOf("四综合试验未完成")).toBeLessThan(labels.indexOf("霉菌试验未完成"));
  });

  test("recovery keeps its actual highlight while the next route stays pending", () => {
    const input = inputFor();
    setStatus(input, "霉菌取消后恢复处理中", "外观检测间");
    input.schedules = [schedule()];
    input.stagingEvents = [{ task_code: taskCode, tray_code: trayCode, room: "appearance", action: "stock_in", appearance_phase: "mold_cancel_recovery", source_run_no: "old-run", source_experiment_code: moldCode, time: "2026-09-18 17:00:00" }];
    const flow = buildTrayFlowView(input);
    expect(flow.steps.filter((step) => step.active).map((step) => step.label)).toEqual(["霉菌取消后恢复处理"]);
    for (const label of ["送至霉菌试验室", ...preparation.slice(1)]) expect(flow.steps.find((step) => step.label === label)).toMatchObject({ active: false, reached: false, time: "" });
  });

  test.each(["已到达实验室", "工装夹具安装", "实验准备就绪"])("in-place rerun uses new %s evidence, never old dispatch or ready time", (status) => {
    const input = inputFor();
    input.schedules = [schedule()];
    setStatus(input, status);
    Object.assign(input.samples[0].trays[0], { target_experiment_code: moldCode, target_schedule_id: "new-schedule", target_lab: "霉菌试验室" });
    input.samples[0].history.push({ status, action: "新轮操作", detail: `${taskCode} / 霉菌试验 / ${status}`, experiment_code: moldCode, schedule_id: "new-schedule", tray_code: trayCode, location: "霉菌试验室", time: "2026-09-19 08:01:00" });
    const flow = buildTrayFlowView(input);
    expect(flow.steps.find((step) => step.label === status)).toMatchObject({ active: true, time: "2026-09-19 08:01:00" });
    for (const step of flow.steps.filter((step) => ["送至霉菌试验室", ...preparation.slice(1)].includes(step.label))) {
      expect(step.time.startsWith("2026-09-18 16:24:0")).toBe(false);
    }
    expect(flow.steps.find((step) => step.label === "霉菌试验已取消")).toMatchObject({ active: false, reached: true, time: canceledAt });
    expect(flow.steps.some((step) => step.label === "送至霉菌试验室")).toBe(false);
  });

  test("foreign tray/schedule and withdrawn preparation cannot supply the new route time", () => {
    const input = inputFor();
    input.schedules = [schedule()];
    setStatus(input, "已到达实验室");
    Object.assign(input.samples[0].trays[0], { target_experiment_code: moldCode, target_schedule_id: "new-schedule", target_lab: "霉菌试验室" });
    input.samples[0].history.push(
      { status: "工装夹具安装", time: "2026-09-19 08:00:00", tray_code: trayCode, experiment_code: moldCode, schedule_id: "new-schedule" },
      { action: "实验任务撤回", status: "撤回至霉菌取消后恢复处理中", time: "2026-09-19 08:01:00", tray_code: trayCode },
      { status: "实验准备就绪", time: "2026-09-19 08:02:00", tray_code: "OTHER-TRAY", experiment_code: moldCode },
      { status: "工装夹具安装", time: "2026-09-19 08:03:00", tray_code: trayCode, experiment_code: moldCode, schedule_id: "old-schedule" },
      { status: "已到达实验室", action: "任务比对", detail: `${taskCode} / 霉菌试验 / 已到达实验室`, time: "2026-09-19 08:04:00", tray_code: trayCode, experiment_code: moldCode, schedule_id: "new-schedule" },
    );
    const flow = buildTrayFlowView(input);
    expect(flow.steps.find((step) => step.label === "已到达实验室")).toMatchObject({ active: true, time: "2026-09-19 08:04:00" });
    for (const label of ["工装夹具安装", "实验准备就绪"]) expect(flow.steps.find((step) => step.label === label)).toMatchObject({ active: false, reached: false, time: "" });
  });

  test("second cancellation clears the completed preparation and recovery of the first rerun", () => {
    const input = inputFor();
    input.experimentRuns.push({ ...input.experimentRuns[0], run_no: "second-run", schedule_id: "second-schedule", ended_at: "2026-09-19 09:00:00" });
    input.experimentRunTrays.push({ ...input.experimentRunTrays[0], run_no: "second-run", ended_at: "2026-09-19 09:00:00" });
    input.schedules = [schedule(moldCode, "second-schedule")];
    input.stagingEvents = [{ task_code: taskCode, tray_code: trayCode, room: "appearance", action: "stock_out", appearance_phase: "mold_cancel_recovery", source_run_no: "old-run", source_experiment_code: moldCode, target_experiment_code: moldCode, time: "2026-09-19 07:00:00" }];
    const flow = buildTrayFlowView(input);
    expect(flow.steps.find((step) => step.label === "待重新排程")).toBeDefined();
    for (const label of ["霉菌取消后恢复处理", ...preparation]) expect(flow.steps.find((step) => step.label === label)).toMatchObject({ active: false, reached: false, time: "" });
  });

  test("tray panel displays the fresh route without exposing old times", () => {
    const input = inputFor();
    const wrapper = mount(TrayManagementPanel, { props: { samplesFlow: {
      rawTasks: [{ code: taskCode, status: "待排程" }], rawSamples: input.samples,
      rawExperiments: input.experiments, rawExperimentTrays: input.experimentTrays,
      rawExperimentRuns: input.experimentRuns, rawExperimentRunTrays: input.experimentRunTrays,
      rawSchedules: [], rawStagingEvents: [], trayStatusOptions: [], warning: "",
      trayRows: [{ taskCode, trayCode, status: "实验已取消", sampleCount: 1, sampleCodes: [`${taskCode}-SP-001`] }],
    } } });
    for (const label of ["待重新排程", ...preparation]) {
      const node = wrapper.findAll(".sample-flow-unified--timed li").find((entry) => entry.get(".sample-flow-label").text() === label);
      expect(node).toBeDefined();
      expect(node.classes()).not.toContain("reached");
      expect(node.classes()).not.toContain("current");
      expect(node.get(".sample-flow-time").text()).toBe("-");
    }
    wrapper.unmount();
  });
});
