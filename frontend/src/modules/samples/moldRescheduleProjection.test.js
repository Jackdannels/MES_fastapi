import { describe, expect, test } from "vitest";
import { buildTrayFlowView } from "./samplesFlowModel";
import { buildLaboratoryWorkbenchView } from "../laboratory/model";
import { buildLabProcessPanels } from "../visualization/model";
import { mount } from "@vue/test-utils";
import { LabProcessScreen } from "../visualization/screens/labProcessScreen";

const taskCode = "SYLU-2026-09-021";
const trayCode = `${taskCode}-TP-002`;
const moldCode = `${taskCode}-A`;
const vibrationCode = `${taskCode}-B`;
const snapshot = () => ({
  taskCode,
  trayCode,
  tasks: [{ code: taskCode, test_type: "霉菌试验 / 振动试验" }],
  experiments: [
    { task_code: taskCode, experiment_code: moldCode, experiment_name: "霉菌试验", required_device: "霉菌试验室", status: "实验进行中" },
    { task_code: taskCode, experiment_code: vibrationCode, experiment_name: "振动试验", required_device: "振动一室" },
  ],
  experimentTrays: [moldCode, vibrationCode].map((code) => ({ task_code: taskCode, tray_code: trayCode, experiment_code: code })),
  schedules: [
    { id: "new-mold", task_code: taskCode, experiment_code: moldCode, device: "霉菌试验室", start_at: "2026-09-11 08:00:00", status: "实验进行中" },
    { id: "vibration", task_code: taskCode, experiment_code: vibrationCode, device: "振动一室", start_at: "2026-09-10 20:30:00", status: "实验已完成" },
  ],
  experimentRuns: [
    { run_no: "old-mold", schedule_id: "deleted-mold", task_code: taskCode, experiment_code: moldCode, device: "霉菌试验室", status: "实验已取消", started_at: "2026-09-10 20:38:07", ended_at: "2026-09-10 20:38:11" },
    { run_no: "vibration", schedule_id: "vibration", task_code: taskCode, experiment_code: vibrationCode, device: "振动一室", status: "实验已完成", started_at: "2026-09-10 20:38:33", ended_at: "2026-09-10 20:38:48" },
  ],
  experimentRunTrays: [
    { run_no: "old-mold", task_code: taskCode, tray_code: trayCode, experiment_code: moldCode, run_tray_status: "实验已取消", started_at: "2026-09-10 20:38:07", ended_at: "2026-09-10 20:38:11" },
    { run_no: "vibration", task_code: taskCode, tray_code: trayCode, experiment_code: vibrationCode, run_tray_status: "实验已完成", started_at: "2026-09-10 20:38:33", ended_at: "2026-09-10 20:38:48" },
  ],
  samples: [{
    code: `${taskCode}-SP-017`, task_code: taskCode, status: "实验已完成", location: "振动一室",
    trays: [{ tray_code: trayCode, status: "实验已完成", quantity: 1, updated_at: "2026-09-10 20:38:48" }],
    history: [
      { action: "实验完成", detail: `${taskCode} / 振动试验 / 实验已完成`, status: "实验已完成", location: "振动一室", time: "2026-09-10 20:38:48" },
      { action: "取消本次霉菌实验", detail: `${taskCode} / 霉菌试验 / 实验已取消 / 原因：繁殖异常`, status: "实验已取消", location: "霉菌试验室", time: "2026-09-10 20:38:11" },
      { action: "开始实验", detail: `${taskCode} / 霉菌试验 / 实验进行中 / 托盘：${trayCode}`, status: "实验进行中", location: "霉菌试验室", time: "2026-09-10 20:38:07" },
    ],
  }],
  status: "实验已完成",
  location: "振动一室",
});

const expectCompletedVibration = (flow) => {
  expect(flow.status).toBe("振动试验已完成");
  expect(flow.steps.filter((step) => step.active).map((step) => step.label)).toEqual(["振动试验已完成"]);
  expect(flow.steps.find((step) => step.label === "振动试验已完成").time).toBe("2026-09-10 20:38:48");
  expect(flow.steps.some((step) => step.label === "霉菌试验进行中")).toBe(false);
  expect(flow.steps.find((step) => step.label === "霉菌试验未完成")).toMatchObject({ active: false, reached: false });
  for (const step of flow.steps.filter((step) => ["送至霉菌试验室", "已到达实验室", "工装夹具安装", "实验准备就绪"].includes(step.label))) {
    expect(step.active || step.reached).toBe(false);
  }
  for (const label of ["送至暂存间", "已到达暂存间"]) {
    expect(flow.steps.find((step) => step.label === label)).toMatchObject({ reached: true, active: false, inferred: true, time: "" });
  }
};

const expectMoldPreview = (flow) => {
  expect(flow).toMatchObject({ isSchedulePreview: true, actualStatus: "振动试验已完成", actualLocation: "振动一室", canonicalStatus: "已排程" });
  expect(flow.steps.filter((step) => step.active).map((step) => step.label)).toEqual(["霉菌试验已排程（待到达）"]);
  expect(flow.steps.find((step) => step.label === "振动试验已完成")).toMatchObject({ active: false, reached: true, time: "2026-09-10 20:38:48" });
  expect(flow.steps.filter((step) => step.key.startsWith("route-final-"))).toHaveLength(0);
  expect(flow.steps.filter((step) => step.planned && step.scheduleId).map((step) => step.label)).toEqual(["送至霉菌试验室", "已到达实验室", "工装夹具安装", "实验准备就绪"]);
  for (const step of flow.steps.filter((step) => step.planned && step.scheduleId)) {
    expect(step).toMatchObject({ reached: false, active: false, time: "", experimentCode: moldCode, scheduleId: "new-mold", labName: "霉菌试验室" });
  }
  expect(flow.steps.find((step) => step.label === "霉菌试验未完成")).toMatchObject({ reached: false, active: false, time: "" });
  expect(flow.steps.some((step) => step.label === "霉菌试验进行中")).toBe(false);
};

describe("mold reschedule does not move a completed tray", () => {
  test("sample flow keeps the latest real completion despite old scoped start history", () => {
    expectCompletedVibration(buildTrayFlowView(snapshot()));
  });
  test("mold workbench shows next plan without reviving the canceled run", () => {
    const view = buildLaboratoryWorkbenchView({ ...snapshot(), labName: "霉菌试验室", selectedTrayCode: trayCode });
    expect(view.runningExperiment.active).toBe(false);
    expectMoldPreview(view.selectedTrayFlow);
  });
  test("a genuinely started new mold run can become current using its own start time", () => {
    const input = snapshot();
    input.experimentRuns.push({ run_no: "new-run", schedule_id: "new-mold", task_code: taskCode, experiment_code: moldCode, device: "霉菌试验室", status: "实验进行中", started_at: "2026-09-11 08:00:00" });
    input.experimentRunTrays.push({ run_no: "new-run", task_code: taskCode, experiment_code: moldCode, tray_code: trayCode, run_tray_status: "实验进行中", started_at: "2026-09-11 08:00:00" });
    input.samples[0].status = "实验进行中";
    input.samples[0].location = "霉菌试验室";
    Object.assign(input.samples[0].trays[0], { status: "实验进行中", target_experiment_code: moldCode, target_lab: "霉菌试验室", updated_at: "2026-09-11 08:00:00" });
    const flow = buildTrayFlowView({ ...input, status: "实验进行中", location: "霉菌试验室", currentExperimentCode: moldCode });
    expect(flow.steps.find((step) => step.active)).toMatchObject({ label: "霉菌试验进行中", time: "2026-09-11 08:00:00" });
  });
  test("visualization previews the rescheduled mold plan and retains the physical location without mutating input", () => {
    const input = snapshot();
    const before = JSON.stringify(input);
    const panels = buildLabProcessPanels({ ...input, labNames: ["霉菌试验室", "振动一室"] });
    const tray = panels.find((panel) => panel.name === "霉菌试验室")?.trays.find((row) => row.trayCode === trayCode);
    expect(tray).toBeDefined();
    expectMoldPreview(tray);
    expect(panels.find((panel) => panel.name === "振动一室").trays).toEqual([]);
    const view = buildLaboratoryWorkbenchView({ ...input, labName: "霉菌试验室", selectedTrayCode: trayCode });
    expect(tray.steps).toEqual(view.selectedTrayFlow.steps);
    expect(JSON.stringify(input)).toBe(before);
  });

  test("renders the new mold route, the completed vibration summary and the real location on the screen", () => {
    const labs = buildLabProcessPanels({ ...snapshot(), labNames: ["霉菌试验室", "振动一室"] });
    const wrapper = mount(LabProcessScreen, { props: { labs, interactive: true } });
    const moldPanel = wrapper.findAll(".visual-lab-panel")[0];
    expect(moldPanel.text()).toContain("霉菌试验已排程（待到达）");
    expect(moldPanel.text()).toContain("实际位置：振动一室");
    expect(moldPanel.findAll(".visual-flow-step.is-active").map((step) => step.text())).toEqual(["霉菌试验已排程（待到达）"]);
    expect(moldPanel.text()).toContain("振动试验已完成");
    expect(moldPanel.text()).toContain("送至霉菌试验室");
    expect(moldPanel.text()).not.toContain("霉菌试验进行中");
    wrapper.unmount();
  });

  test.each(["missing", "canceled", "other-tray", "old-attempt"])("does not preview a %s mold schedule", (kind) => {
    const input = snapshot();
    if (kind === "missing") input.schedules.shift();
    if (kind === "canceled") input.schedules[0].status = "实验已取消";
    if (kind === "other-tray") input.schedules[0].tray_codes = ["OTHER-TRAY"];
    if (kind === "old-attempt") input.schedules[0].id = "deleted-mold";
    const panels = buildLabProcessPanels({ ...input, labNames: ["霉菌试验室", "振动一室"] });
    expect(panels.find((panel) => panel.name === "霉菌试验室").trays).toEqual([]);
    expectCompletedVibration(panels.find((panel) => panel.name === "振动一室").trays[0]);
  });

  test("previews only after a real completion after cancellation, and follows the next valid schedule", () => {
    const input = snapshot();
    input.experimentRunTrays[1].ended_at = "2026-09-10 20:37:00";
    let flow = buildTrayFlowView({ ...input, previewExperimentCode: moldCode });
    expect(flow.isSchedulePreview).not.toBe(true);
    input.experimentRunTrays[1].ended_at = "2026-09-10 20:38:48";
    const otherCode = `${taskCode}-C`;
    input.experiments.push({ task_code: taskCode, experiment_code: otherCode, experiment_name: "四综合试验", required_device: "四综合实验室" });
    input.experimentTrays.push({ task_code: taskCode, experiment_code: otherCode, tray_code: trayCode });
    input.schedules.push({ id: "earlier-other", task_code: taskCode, experiment_code: otherCode, device: "四综合实验室", status: "已排程", start_at: "2026-09-11 07:00:00" });
    flow = buildTrayFlowView({ ...input, previewExperimentCode: moldCode });
    expect(flow.isSchedulePreview).not.toBe(true);
  });

  test("an actual mold comparison replaces the preview with its real preparation time", () => {
    const input = snapshot();
    input.status = input.samples[0].status = input.samples[0].trays[0].status = "已到达实验室";
    input.location = input.samples[0].location = "霉菌试验室";
    Object.assign(input.samples[0].trays[0], { target_experiment_code: moldCode, target_lab: "霉菌试验室", target_schedule_id: "new-mold" });
    input.samples[0].history.unshift({ action: "任务比对", detail: `${taskCode} / 霉菌试验 / 已到达实验室`, status: "已到达实验室", location: "霉菌试验室", time: "2026-09-11 07:55:00", tray_code: trayCode });
    const flow = buildLaboratoryWorkbenchView({ ...input, labName: "霉菌试验室", selectedTrayCode: trayCode }).selectedTrayFlow;
    expect(flow.isSchedulePreview).not.toBe(true);
    expect(flow.steps.find((step) => step.active)).toMatchObject({ label: "已到达实验室", time: "2026-09-11 07:55:00" });
  });

  test("uses the latest run state when an intermediate vibration attempt was canceled", () => {
    const input = snapshot();
    input.experimentRunTrays.unshift({ run_no: "vibration-fault", task_code: taskCode, experiment_code: vibrationCode, tray_code: trayCode, run_tray_status: "设备故障试验取消", ended_at: "2026-09-10 20:38:20" });
    expect(buildTrayFlowView({ ...input, previewExperimentCode: moldCode }).isSchedulePreview).toBe(true);
    input.experimentRunTrays.push({ run_no: "another-vibration", task_code: taskCode, experiment_code: vibrationCode, tray_code: trayCode, run_tray_status: "实验进行中", started_at: "2026-09-11 08:00:00" });
    expect(buildTrayFlowView({ ...input, previewExperimentCode: moldCode }).isSchedulePreview).not.toBe(true);
  });

  test.each([false, true])("11-011 keeps a real appearance stock-in current after canceled mold and completed vibration (completed template=%s)", (completedTemplate) => {
    const input = snapshot();
    if (completedTemplate) input.experimentFlow = [{ code: vibrationCode, displayName: "振动试验", state: "completed", destinationLab: "振动一室" }];
    input.status = input.samples[0].status = input.samples[0].trays[0].status = "实验后外观检测间存放";
    input.location = input.samples[0].location = "外观检测间";
    input.samples[0].history.unshift({ action: "外观检测间扫码入库", status: input.status, location: input.location, time: "2026-09-10 20:39:00", tray_code: trayCode });
    input.stagingEvents = [{ task_code: taskCode, tray_code: trayCode, action: "stock_in", room: "appearance", appearance_phase: "post_experiment", status: input.status, time: "2026-09-10 20:39:00" }];
    const flow = buildTrayFlowView(input);
    expect(flow.status).toBe(input.status);
    expect(flow.steps.filter((step) => step.active)).toEqual([expect.objectContaining({ label: input.status, time: "2026-09-10 20:39:00" })]);
    const actualAppearanceIndex = flow.steps.findIndex((step) => step.active);
    expect(actualAppearanceIndex).toBeGreaterThan(flow.steps.findIndex((step) => step.label === "振动试验已完成"));
    expect(actualAppearanceIndex).toBeLessThan(flow.steps.findIndex((step) => step.label === "霉菌试验未完成"));
    for (const step of flow.steps.filter((step) => ["送至实验室", "送至霉菌试验室", "已到达实验室", "工装夹具安装", "实验准备就绪"].includes(step.label) && !step.reached)) {
      expect(flow.steps.indexOf(step)).toBeGreaterThan(actualAppearanceIndex);
    }
    expect(flow.steps.find((step) => step.label === "振动试验已完成")).toMatchObject({ active: false, reached: true });
    expect(flow.steps.filter((step) => step.key.startsWith("cancel-staging-")).every((step) => step.reached && step.inferred && !step.active && !step.time)).toBe(true);
    const preview = buildLaboratoryWorkbenchView({ ...input, labName: "霉菌试验室", selectedTrayCode: trayCode }).selectedTrayFlow;
    expect(preview).toMatchObject({ isSchedulePreview: true, actualStatus: input.status, actualLocation: input.location });
    const appearance = preview.steps.find((step) => step.label === input.status);
    expect(appearance).toMatchObject({ reached: true, active: false, time: "2026-09-10 20:39:00" });
    expect(preview.steps.indexOf(appearance)).toBeLessThan(preview.steps.findIndex((step) => step.planned));
  });

  test("keeps an older appearance visit historical and a new visit after vibration current", () => {
    const input = snapshot();
    input.status = input.samples[0].status = input.samples[0].trays[0].status = "实验后外观检测间存放";
    input.location = input.samples[0].location = "外观检测间";
    input.experimentFlow = [
      { code: "SALT", displayName: "盐雾试验", state: "completed", required_device: "盐雾试验室" },
      { code: vibrationCode, displayName: "振动试验", state: "completed" },
      { code: moldCode, displayName: "霉菌试验", state: "current", unstarted: true, routeStatus: input.status },
    ];
    input.samples[0].history.push(
      { action: "实验完成", detail: `${taskCode} / 盐雾试验 / 实验已完成`, status: "实验已完成", time: "2026-09-10 20:36:00", tray_code: trayCode },
      { action: "外观检测间扫码入库", status: input.status, location: input.location, time: "2026-09-10 20:37:00", tray_code: trayCode },
      { action: "外观检测间扫码入库", status: input.status, location: input.location, time: "2026-09-10 20:39:00", tray_code: trayCode },
    );
    const flow = buildTrayFlowView(input);
    const appearances = flow.steps.filter((step) => step.label === input.status);
    expect(appearances).toHaveLength(2);
    expect(appearances[0]).toMatchObject({ active: false, reached: true, time: "2026-09-10 20:37:00" });
    expect(appearances[1]).toMatchObject({ active: true, time: "2026-09-10 20:39:00" });
  });
});

describe("mold cancellation route folding", () => {
  test("09-021 places inferred staging milestones between cancel recovery and the new mold dispatch", () => {
    const currentTrayCode = `${taskCode}-TP-001`;
    const canceledRunNo = "run-20260911085530180776";
    const input = {
      taskCode,
      trayCode: currentTrayCode,
      currentExperimentCode: moldCode,
      preferCurrentExperimentCode: true,
      tasks: [{ code: taskCode, test_type: "霉菌试验 / 四综合试验" }],
      experiments: [
        { task_code: taskCode, experiment_code: moldCode, experiment_name: "霉菌试验", required_device: "霉菌试验室", status: "已排程" },
        { task_code: taskCode, experiment_code: `${taskCode}-B`, experiment_name: "四综合试验", required_device: "四综合实验室", status: "已排程" },
      ],
      experimentTrays: [moldCode, `${taskCode}-B`].map((code) => ({
        task_code: taskCode,
        tray_code: currentTrayCode,
        experiment_code: code,
      })),
      schedules: [
        { id: "schedule-comprehensive", task_code: taskCode, experiment_code: `${taskCode}-B`, device: "四综合实验室", start_at: "2026-09-12 08:00:00", status: "已排程" },
        { id: "schedule-new-mold", task_code: taskCode, experiment_code: moldCode, device: "霉菌试验室", start_at: "2026-09-11 08:56:00", status: "已排程" },
      ],
      experimentRuns: [{
        run_no: canceledRunNo,
        schedule_id: "schedule-old-mold",
        task_code: taskCode,
        experiment_code: moldCode,
        device: "霉菌试验室",
        status: "实验已取消",
        started_at: "2026-09-11 08:55:30",
        ended_at: "2026-09-11 08:55:33",
      }],
      experimentRunTrays: [{
        run_no: canceledRunNo,
        task_code: taskCode,
        tray_code: currentTrayCode,
        experiment_code: moldCode,
        run_tray_status: "实验已取消",
        started_at: "2026-09-11 08:55:30",
        ended_at: "2026-09-11 08:55:33",
      }],
      samples: [{
        code: `${taskCode}-SP-001`,
        task_code: taskCode,
        location: "霉菌试验室",
        status: "送至实验室",
        trays: [{
          tray_code: currentTrayCode,
          status: "送至实验室",
          target_experiment_code: moldCode,
          target_lab: "霉菌试验室",
        }],
        history: [
          { action: "外观检测间扫码出库", detail: `${currentTrayCode} 恢复处理完成，送至 霉菌试验室`, location: "霉菌试验室", status: "送至实验室", time: "2026-09-11 08:56:48" },
          { action: "撤回出库", detail: `${currentTrayCode} 撤回出库至霉菌取消后恢复处理中`, location: "外观检测间", status: "霉菌取消后恢复处理中", time: "2026-09-11 08:56:17" },
          { action: "外观检测间扫码出库", detail: `${currentTrayCode} 恢复处理完成，送至 四综合实验室`, location: "四综合实验室", status: "送至实验室", time: "2026-09-11 08:56:13" },
          { action: "外观检测间扫码入库", detail: `${currentTrayCode} 霉菌取消后恢复处理中`, location: "外观检测间", status: "霉菌取消后恢复处理中", time: "2026-09-11 08:55:43" },
          { action: "取消本次霉菌实验", detail: `${taskCode} / 霉菌试验 / 实验已取消`, location: "霉菌试验室", status: "实验已取消", time: "2026-09-11 08:55:33" },
          { action: "任务已确认入库", status: "到货", time: "2026-09-11 08:55:12" },
          { action: "样品分装托盘", status: "运输中", time: "2026-09-11 08:54:38" },
        ],
      }],
      stagingEvents: [
        { action: "stock_in", appearance_phase: "mold_cancel_recovery", recovery_cycle_id: canceledRunNo, room: "appearance", source_experiment_code: moldCode, source_run_no: canceledRunNo, status: "霉菌取消后恢复处理中", task_code: taskCode, time: "2026-09-11 08:55:43", tray_code: currentTrayCode },
        { action: "stock_out", appearance_phase: "mold_cancel_recovery", recovery_cycle_id: canceledRunNo, room: "appearance", source_experiment_code: moldCode, source_run_no: canceledRunNo, target_experiment_code: `${taskCode}-B`, target_lab: "四综合实验室", target_type: "lab", task_code: taskCode, time: "2026-09-11 08:56:13", tray_code: currentTrayCode },
        { action: "stock_out_withdraw", appearance_phase: "mold_cancel_recovery", recovery_cycle_id: canceledRunNo, room: "appearance", source_experiment_code: moldCode, source_run_no: canceledRunNo, status: "霉菌取消后恢复处理中", task_code: taskCode, time: "2026-09-11 08:56:17", tray_code: currentTrayCode },
        { action: "stock_out", appearance_phase: "mold_cancel_recovery", recovery_cycle_id: canceledRunNo, room: "appearance", source_experiment_code: moldCode, source_run_no: canceledRunNo, target_experiment_code: moldCode, target_lab: "霉菌试验室", target_type: "lab", task_code: taskCode, time: "2026-09-11 08:56:48", tray_code: currentTrayCode },
      ],
      location: "霉菌试验室",
      status: "送至实验室",
    };

    const flow = buildTrayFlowView(input);
    const labels = flow.steps.map((step) => step.label);
    const expectedInOrder = [
      "样品运输中",
      "到货",
      "霉菌试验已取消",
      "霉菌取消后恢复处理",
      "送至暂存间",
      "已到达暂存间",
      "送至霉菌试验室",
      "已到达实验室",
      "工装夹具安装",
      "实验准备就绪",
      "霉菌试验进行中",
      "四综合试验未完成",
      "厂家收回",
    ];
    expect(labels).toEqual(expectedInOrder);
    expect(flow.steps.find((step) => step.label === "霉菌取消后恢复处理")).toMatchObject({
      active: false,
      reached: true,
      time: "2026-09-11 08:56:17",
    });
    for (const label of ["送至暂存间", "已到达暂存间"]) {
      expect(flow.steps.find((step) => step.label === label)).toMatchObject({
        active: false,
        reached: true,
        inferred: true,
        time: "",
      });
    }
    expect(flow.steps.find((step) => step.label === "送至霉菌试验室")).toMatchObject({
      active: true,
      time: "2026-09-11 08:56:48",
    });
  });

  test("TP-003 retains a fresh optional staging route after cancellation recovery", () => {
    const currentTrayCode = `${taskCode}-TP-003`;
    const canceledRunNo = "old-mold-tp003";
    const flow = buildTrayFlowView({
      currentExperimentCode: moldCode,
      experimentFlow: [
        {
          code: vibrationCode,
          destinationLab: "振动一室",
          displayName: "振动试验",
          state: "completed",
        },
        {
          code: moldCode,
          destinationLab: "霉菌试验室",
          displayName: "霉菌试验",
          routeStatus: "霉菌取消后恢复处理中",
          state: "current",
        },
      ],
      experiments: [
        { task_code: taskCode, experiment_code: moldCode, experiment_name: "霉菌试验", required_device: "霉菌试验室" },
        { task_code: taskCode, experiment_code: vibrationCode, experiment_name: "振动试验", required_device: "振动一室" },
      ],
      experimentTrays: [moldCode, vibrationCode].map((code) => ({
        task_code: taskCode,
        tray_code: currentTrayCode,
        experiment_code: code,
      })),
      experimentRunTrays: [
        {
          run_no: "vibration-tp003",
          task_code: taskCode,
          tray_code: currentTrayCode,
          experiment_code: vibrationCode,
          run_tray_status: "实验已完成",
          ended_at: "2026-09-10 20:58:33",
        },
        {
          run_no: canceledRunNo,
          task_code: taskCode,
          tray_code: currentTrayCode,
          experiment_code: moldCode,
          run_tray_status: "实验已取消",
          ended_at: "2026-09-10 20:58:59",
        },
      ],
      samples: [{
        code: `${taskCode}-SP-TP003`,
        task_code: taskCode,
        location: "外观检测间",
        status: "霉菌取消后恢复处理中",
        trays: [{ tray_code: currentTrayCode, status: "霉菌取消后恢复处理中" }],
        history: [
          { action: "样品分装托盘", status: "样品运输中", time: "2026-09-10 20:00:00", tray_code: currentTrayCode },
          { action: "任务已确认入库", status: "到货", time: "2026-09-10 20:10:00", tray_code: currentTrayCode },
          { action: "实验完成", detail: `${taskCode} / 振动试验 / 实验已完成`, status: "实验已完成", time: "2026-09-10 20:58:33", tray_code: currentTrayCode },
          { action: "取消本次霉菌实验", detail: `${taskCode} / 霉菌试验 / 实验已取消`, status: "实验已取消", time: "2026-09-10 20:58:59", tray_code: currentTrayCode },
        ],
      }],
      stagingEvents: [{
        action: "stock_in",
        appearance_phase: "mold_cancel_recovery",
        recovery_cycle_id: canceledRunNo,
        room: "appearance",
        source_experiment_code: moldCode,
        source_run_no: canceledRunNo,
        status: "霉菌取消后恢复处理中",
        task_code: taskCode,
        time: "2026-09-10 20:59:23",
        tray_code: currentTrayCode,
      }],
      location: "外观检测间",
      status: "霉菌取消后恢复处理中",
      taskCode,
      trayCode: currentTrayCode,
    });

    const labels = flow.steps.map((step) => step.label);
    expect(labels).toContain("送至暂存间");
    expect(labels).toContain("已到达暂存间");
    for (const label of ["送至暂存间", "已到达暂存间"]) {
      expect(flow.steps.find((step) => step.label === label)).toMatchObject({ active: false, reached: false, time: "" });
      expect(labels.indexOf(label)).toBeGreaterThan(labels.indexOf("霉菌取消后恢复处理"));
    }
    expect(labels.indexOf("振动试验已完成")).toBeLessThan(labels.indexOf("霉菌试验已取消"));
    expect(labels.indexOf("霉菌试验已取消")).toBeLessThan(labels.indexOf("霉菌取消后恢复处理"));
    expect(labels.indexOf("霉菌取消后恢复处理")).toBeLessThan(labels.indexOf("霉菌试验未完成"));
    expect(flow.steps.find((step) => step.label === "霉菌取消后恢复处理")).toMatchObject({
      active: true,
      reached: true,
      time: "2026-09-10 20:59:23",
    });
  });

  test("TP-004 keeps real later staging milestones after another experiment completes", () => {
    const currentTrayCode = `${taskCode}-TP-004`;
    const comprehensiveCode = `${taskCode}-C`;
    const canceledRunNo = "old-mold-tp004";
    const flow = buildTrayFlowView({
      currentExperimentCode: moldCode,
      experimentFlow: [
        {
          code: vibrationCode,
          destinationLab: "振动一室",
          displayName: "振动试验",
          state: "completed",
        },
        {
          code: comprehensiveCode,
          destinationLab: "四综合实验室",
          displayName: "四综合试验",
          state: "completed",
        },
        {
          code: moldCode,
          destinationLab: "霉菌试验室",
          displayName: "霉菌试验",
          routeStatus: "工装夹具安装",
          state: "current",
        },
      ],
      experiments: [
        { task_code: taskCode, experiment_code: moldCode, experiment_name: "霉菌试验", required_device: "霉菌试验室" },
        { task_code: taskCode, experiment_code: vibrationCode, experiment_name: "振动试验", required_device: "振动一室" },
        { task_code: taskCode, experiment_code: comprehensiveCode, experiment_name: "四综合试验", required_device: "四综合实验室" },
      ],
      experimentTrays: [moldCode, vibrationCode, comprehensiveCode].map((code) => ({
        task_code: taskCode,
        tray_code: currentTrayCode,
        experiment_code: code,
      })),
      experimentRunTrays: [
        {
          run_no: "vibration-tp004",
          task_code: taskCode,
          tray_code: currentTrayCode,
          experiment_code: vibrationCode,
          run_tray_status: "实验已完成",
          ended_at: "2026-09-10 21:05:48",
        },
        {
          run_no: canceledRunNo,
          task_code: taskCode,
          tray_code: currentTrayCode,
          experiment_code: moldCode,
          run_tray_status: "实验已取消",
          ended_at: "2026-09-10 21:06:17",
        },
        {
          run_no: "comprehensive-tp004",
          task_code: taskCode,
          tray_code: currentTrayCode,
          experiment_code: comprehensiveCode,
          run_tray_status: "实验已完成",
          ended_at: "2026-09-10 21:06:48",
        },
      ],
      samples: [{
        code: `${taskCode}-SP-TP004`,
        task_code: taskCode,
        location: "霉菌试验室",
        status: "工装夹具安装",
        trays: [{
          tray_code: currentTrayCode,
          status: "工装夹具安装",
          target_experiment_code: moldCode,
          target_lab: "霉菌试验室",
        }],
        history: [
          { action: "实验完成", detail: `${taskCode} / 振动试验 / 实验已完成`, status: "实验已完成", time: "2026-09-10 21:05:48", tray_code: currentTrayCode },
          { action: "取消本次霉菌实验", detail: `${taskCode} / 霉菌试验 / 实验已取消`, status: "实验已取消", time: "2026-09-10 21:06:17", tray_code: currentTrayCode },
          { action: "实验完成", detail: `${taskCode} / 四综合试验 / 实验已完成`, status: "实验已完成", time: "2026-09-10 21:06:48", tray_code: currentTrayCode },
          { action: "暂存间扫码入库", detail: `${currentTrayCode} 已到达暂存间`, status: "已到达暂存间", time: "2026-09-10 21:07:54", tray_code: currentTrayCode },
          { action: "暂存间扫码出库", detail: `${currentTrayCode} 送至 霉菌试验室`, status: "送至实验室", time: "2026-09-10 21:08:15", tray_code: currentTrayCode },
          { action: "任务比对", detail: `${taskCode} / 霉菌试验 / 已到达实验室`, status: "已到达实验室", time: "2026-09-10 21:08:43", tray_code: currentTrayCode },
          { action: "样品安装", detail: `${taskCode} / 霉菌试验 / 工装夹具安装`, status: "工装夹具安装", time: "2026-09-10 21:08:44", tray_code: currentTrayCode },
        ],
      }],
      stagingEvents: [
        { action: "stock_in", room: "staging", task_code: taskCode, tray_code: currentTrayCode, time: "2026-09-10 21:07:54" },
        { action: "stock_out", room: "staging", target_experiment_code: moldCode, target_lab: "霉菌试验室", target_type: "lab", task_code: taskCode, tray_code: currentTrayCode, time: "2026-09-10 21:08:15" },
      ],
      location: "霉菌试验室",
      status: "工装夹具安装",
      taskCode,
      trayCode: currentTrayCode,
    });

    const labels = flow.steps.map((step) => step.label);
    const expectedInOrder = [
      "振动试验已完成",
      "霉菌试验已取消",
      "四综合试验已完成",
      "送至暂存间",
      "已到达暂存间",
      "送至霉菌试验室",
      "已到达实验室",
      "工装夹具安装",
    ];
    const indexes = expectedInOrder.map((label) => labels.indexOf(label));
    expect(indexes.every((index) => index >= 0)).toBe(true);
    expect(indexes).toEqual([...indexes].sort((left, right) => left - right));
    expect(flow.steps.find((step) => step.label === "已到达暂存间")).toMatchObject({
      reached: true,
      time: "2026-09-10 21:07:54",
    });
    expect(flow.steps.find((step) => step.label === "工装夹具安装")).toMatchObject({
      active: true,
      time: "2026-09-10 21:08:44",
    });
  });
});
