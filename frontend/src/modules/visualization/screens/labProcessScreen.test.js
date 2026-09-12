import { mount } from "@vue/test-utils";
import { describe, expect, test } from "vitest";
import { LabProcessScreen } from "./labProcessScreen";

const buildLab = (name, taskCode) => ({
  name,
  task: taskCode,
  sampleCount: 1,
  trayCount: 1,
  trays: [{ taskCode, trayCode: `TRAY-${taskCode}`, sampleCodes: ["SAMPLE-1"], steps: [] }],
});

describe("LabProcessScreen headers", () => {
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
