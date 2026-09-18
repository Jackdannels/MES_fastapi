import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, test, vi } from "vitest";
import { nextTick } from "vue";
import { LabProcessScreen } from "./labProcessScreen";

const buildLab = (name, taskCode) => ({
  name,
  task: taskCode,
  sampleCount: 1,
  trayCount: 1,
  trays: [{ taskCode, trayCode: `TRAY-${taskCode}`, sampleCodes: ["SAMPLE-1"], steps: [] }],
});

describe("LabProcessScreen headers", () => {
  afterEach(() => vi.useRealTimers());

  test.each([false, true])("places health beside the room name, not the switch action (compact=%s)", (compact) => {
    const labs = [
      { ...buildLab("盐雾试验室", "TASK-001"), healthLabel: "正常", healthState: "ok" },
      { ...buildLab("振动二室", "TASK-002"), healthLabel: "维修", healthState: "upkeep", alert: "维修" },
    ];
    const wrapper = mount(LabProcessScreen, { props: { labs, compact, interactive: true } });
    const headings = wrapper.findAll(".visual-lab-heading");
    expect(headings.map((heading) => heading.text())).toEqual(["盐雾试验室正常", "振动二室维修"]);
    expect(headings[0].get(".visual-lab-name + .visual-lab-state").classes()).toContain("is-ok");
    expect(headings[1].get(".visual-lab-state").classes()).toContain("is-upkeep");
    expect(wrapper.find(".visual-lab-head-actions .visual-lab-state").exists()).toBe(false);
    wrapper.unmount();
  });

  test("ticks LIVE without recomputing the tray board", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-18T06:00:00Z"));
    const readTrays = vi.fn(() => []);
    const lab = { ...buildLab("盐雾试验室", "TASK-001"), get trays() { return readTrays(); } };
    const wrapper = mount(LabProcessScreen, { props: { labs: [lab] } });
    const initialTime = wrapper.get(".visual-board-time").text();
    readTrays.mockClear();
    await vi.advanceTimersByTimeAsync(1000);
    await nextTick();
    expect(wrapper.get(".visual-board-time").text()).not.toBe(initialTime);
    expect(readTrays).not.toHaveBeenCalled();
    wrapper.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  test("renders a specific arrival label and ordinary green cancellation history", () => {
    const lab = buildLab("盐雾试验室", "TASK-001");
    lab.trays[0].steps = [
      { key: "cancel", kind: "device-fault-cancel", label: "四综合试验｜设备故障试验取消", reached: true, time: "2099-09-15 09:00:00" },
      { key: "arrived_lab", label: "已到达实验室", displayLabel: "已到达盐雾试验室", active: true, time: "2099-09-15 10:00:00" },
    ];
    const wrapper = mount(LabProcessScreen, { props: { labs: [lab] } });
    expect(wrapper.text()).toContain("已到达盐雾试验室");
    expect(wrapper.text()).not.toContain("已到达实验室");
    expect(wrapper.findAll(".visual-flow-step")[0].classes()).toContain("is-done");
    expect(wrapper.find(".is-canceled").exists()).toBe(false);
    wrapper.unmount();
  });
  test.each(["primary", "secondary"])("%s screen removes only the header task code and preserves lab switching", async (group) => {
    const labs = [buildLab("高低温湿热二室", "TASK-001"), buildLab("盐雾试验室", "TASK-002")];
    const wrapper = mount(LabProcessScreen, {
      props: { screen: { group, name: "实验室流程监控屏B组" }, labs, interactive: true },
    });

    expect(wrapper.findAll(".visual-lab-name").map((name) => name.text())).toEqual(labs.map((lab) => lab.name));
    expect(wrapper.get(".visual-lab-name").attributes("title")).toBe(labs[0].name);
    expect(wrapper.find(".visual-task-code").exists()).toBe(false);
    wrapper.findAll(".visual-lab-panel-head").forEach((head) => {
      expect(head.text()).not.toContain("TASK-");
    });
    expect(wrapper.findAll('[data-testid="visual-lab-task-option"]').map((option) => option.text())).toEqual([
      "TASK-0011 托盘", "TASK-0021 托盘",
    ]);
    expect(wrapper.get(".visual-tray-flow-head").text()).toContain("任务编号：TASK-001");

    await wrapper.get('[data-testid="visual-lab-cycle-primary"]').trigger("click");
    await wrapper.get('[data-testid="visual-lab-cycle-secondary"]').trigger("click");
    expect(wrapper.emitted("open-lab-picker")).toEqual([["primary"], ["secondary"]]);
    wrapper.unmount();
  });

  test("empty compact preview keeps room names without placeholder task codes", () => {
    const wrapper = mount(LabProcessScreen, {
      props: { labs: [{ name: "盐雾试验室", task: "-", sampleCount: 0, trayCount: 0, trays: [] }], compact: true },
    });
    expect(wrapper.get(".visual-lab-panel-head").text()).toBe("盐雾试验室正常");
    expect(wrapper.find(".visual-task-code").exists()).toBe(false);
    expect(wrapper.get(".visual-empty-tray-flow").text()).toBe("暂无托盘流程");
    wrapper.unmount();
  });
});
