import { mount } from "@vue/test-utils";
import { describe, expect, test } from "vitest";
import { buildLaboratoryWorkbenchView } from "@/modules/laboratory/model";
import { buildLabCurrentTaskMatrixView } from "./labCurrentTasksModel";
import { CurrentLabTasksScreen } from "./screens/currentLabTasksScreen";

const buildSharedTrayPlan = () => {
  const taskCode = "SYLU-2026-09-022";
  const labs = ["冲击二室", "四综合实验室", "霉菌试验室"];
  const names = ["冲击试验", "四综合试验", "霉菌试验"];
  const starts = ["09:52", "09:57", "12:02"];
  const ends = ["10:52", "10:57", "13:02"];
  const trayCodes = Array.from({ length: 4 }, (_, index) => `${taskCode}-TP-00${index + 1}`);
  return {
    now: new Date("2026-09-12T09:50:00+08:00"),
    labNames: [...labs, "冲击一室"],
    devices: [...labs, "冲击一室"].map((name) => ({ code: name, name, status: "可用" })),
    tasks: [{ code: taskCode }],
    experiments: labs.map((lab, index) => ({
      task_code: taskCode, experiment_code: `EXP-${index}`, experiment_name: names[index],
      required_device: lab, status: "已排程",
    })),
    schedules: labs.map((device, index) => ({
      id: `SCH-${index}`, task_code: taskCode, experiment_code: `EXP-${index}`, device,
      start_at: `2026-09-12T${starts[index]}:00+08:00`,
      end_at: `2026-09-12T${ends[index]}:00+08:00`, status: "已排程",
    })),
    experimentTrays: labs.flatMap((_lab, index) => trayCodes.map((tray_code) => ({
      task_code: taskCode, experiment_code: `EXP-${index}`, tray_code,
    }))),
    samples: trayCodes.flatMap((tray_code, trayIndex) => Array.from({ length: 4 }, (_, index) => ({
      code: `${taskCode}-SP-${trayIndex * 4 + index + 1}`, task_code: taskCode,
      location: "恒温恒湿间（暂存间）", status: "已到达暂存间",
      trays: [{ tray_code, quantity: 1, status: "已到达暂存间" }],
    }))),
  };
};

describe("fourth screen scheduled tasks waiting for predecessors", () => {
  test("shows all three laboratory plans without making blocked plans executable", () => {
    const input = buildSharedTrayPlan();
    const before = structuredClone(input);
    const view = buildLabCurrentTaskMatrixView(input);

    expect(view.counts).toMatchObject({ scheduled: 3, unplanned: 1, running: 0 });
    expect(view.labs.slice(0, 3).map((lab) => lab.stageLabel)).toEqual([
      "已排程", "等待前序实验", "等待前序实验",
    ]);
    view.labs.slice(0, 3).forEach((lab, index) => {
      expect(lab).toMatchObject({
        taskCode: "SYLU-2026-09-022", statusTone: "scheduled", statusLabel: "已排程",
        sampleCount: 16, trayCount: 4, countdown: { active: false }, shouldBlink: false,
      });
      expect(lab.trayItems.map((tray) => tray.sampleCount)).toEqual([4, 4, 4, 4]);
      expect(lab.planTimeLabel).toContain(["09:52", "09:57", "12:02"][index]);
    });
    expect(view.labs[3]).toMatchObject({ taskCode: "-", statusLabel: "未排程", trayCount: 0 });
    for (const labName of input.labNames.slice(1, 3)) {
      const workbench = buildLaboratoryWorkbenchView({ ...input, labName });
      expect(workbench.currentTask).toBeNull();
      expect(workbench.scheduleRows[0].sequenceEligible).toBe(false);
    }
    expect(input).toEqual(before);
  });

  test("advances the waiting label when the predecessor completes and does not resurrect it", () => {
    const input = buildSharedTrayPlan();
    input.experiments[0].status = "实验已完成";
    input.schedules[0].status = "实验已完成";
    input.experimentRunTrays = input.experimentTrays
      .filter((relation) => relation.experiment_code === "EXP-0")
      .map((relation) => ({ ...relation, run_no: "RUN-DONE", run_tray_status: "实验已完成" }));
    const view = buildLabCurrentTaskMatrixView(input);

    expect(view.labs[0]).toMatchObject({ statusLabel: "未排程", taskCode: "-" });
    expect(view.labs[1]).toMatchObject({ statusLabel: "已排程", stageLabel: "已排程" });
    expect(view.labs[2].stageLabel).toBe("等待前序实验");
    expect(view.counts.scheduled).toBe(2);
  });

  test.each(["维修", "保养"])("preserves %s priority while retaining the waiting plan", (status) => {
    const input = buildSharedTrayPlan();
    input.devices[1].status = status;
    const lab = buildLabCurrentTaskMatrixView(input).labs[1];
    expect(lab).toMatchObject({ statusLabel: status, stageLabel: status, taskCode: "SYLU-2026-09-022", trayCount: 4 });
  });

  test("keeps the active run and its countdown while displaying downstream waiting plans", () => {
    const input = buildSharedTrayPlan();
    input.now = new Date("2026-09-12T10:00:00+08:00");
    input.experimentRuns = [{
      run_no: "RUN-ACTIVE", task_code: input.tasks[0].code, experiment_code: "EXP-0",
      schedule_id: "SCH-0", device: "冲击二室", status: "实验进行中",
      started_at: "2026-09-12T09:52:00+08:00", planned_hours: 1,
    }];
    input.experimentRunTrays = input.experimentTrays
      .filter((relation) => relation.experiment_code === "EXP-0")
      .map((relation) => ({ ...relation, run_no: "RUN-ACTIVE", run_tray_status: "实验进行中", started_at: "2026-09-12T09:52:00+08:00" }));

    const view = buildLabCurrentTaskMatrixView(input);
    expect(view.labs[0]).toMatchObject({ statusLabel: "实验进行中", countdown: { active: true }, trayCount: 4 });
    expect(view.labs[1]).toMatchObject({ stageLabel: "等待前序实验", countdown: { active: false } });
    expect(view.labs[2]).toMatchObject({ stageLabel: "等待前序实验", countdown: { active: false } });
    expect(view.counts).toMatchObject({ running: 1, scheduled: 2, unplanned: 1 });
  });

  test("renders the waiting plan and correct scheduled count in the actual screen component", () => {
    const wrapper = mount(CurrentLabTasksScreen, {
      props: { currentLabTaskView: buildLabCurrentTaskMatrixView(buildSharedTrayPlan()) },
    });
    try {
      expect(wrapper.get(".metric-scheduled strong").text()).toBe("3");
      for (const lab of ["四综合实验室", "霉菌试验室"]) {
        const card = wrapper.get(`[data-lab-name="${lab}"][data-testid="lab-matrix-card"]`);
        expect(card.text()).toContain("等待前序实验");
        expect(card.text()).toContain("SYLU-2026-09-022");
        expect(card.findAll(".tray-row")).toHaveLength(4);
        expect(card.find('[data-testid="lab-matrix-countdown"]').exists()).toBe(false);
      }
    } finally {
      wrapper.unmount();
    }
  });
});
