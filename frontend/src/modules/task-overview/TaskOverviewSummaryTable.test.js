import { mount } from "@vue/test-utils";
import { describe, expect, test } from "vitest";

import TaskOverviewSummaryTable from "./TaskOverviewSummaryTable.vue";

describe("TaskOverviewSummaryTable", () => {
  test("renders per-experiment and per-tray summary lines", () => {
    const wrapper = mount(TaskOverviewSummaryTable, {
      props: {
        formatTrayCount: (row) => String(row.trays.length),
        formatTraySummary: (row) => row.trays.map((tray) => tray.trayCode).join(" / "),
        row: {
          currentStatus: "进行中",
          experimentCount: 2,
          experimentSummary: "温度冲击 / 振动",
          experiments: [
            { experimentCode: "TASK-001-A", experimentName: "温度冲击", displayStatus: "已排程" },
            { experimentCode: "TASK-001-B", experimentName: "振动", displayStatus: "实验完成" },
          ],
          plannedCount: 3,
          sampleCount: 2,
          scheduleCount: 1,
          scheduleLabel: "已排程",
          trays: [{ trayCode: "TP-001" }, { trayCode: "TP-002" }],
        },
      },
    });

    const headers = wrapper.findAll("th").map((node) => node.text());

    expect(headers).toEqual(["任务状态", "实验数", "试验内容", "实验状态", "样品数量", "托盘分配摘要", "托盘数量"]);
    expect(wrapper.text()).not.toContain("任务类型");
    expect(wrapper.text()).toContain("任务状态");
    expect(wrapper.text()).toContain("试验内容");
    expect(wrapper.text()).toContain("实验状态");
    expect(wrapper.text()).toContain("托盘分配摘要");
    expect(wrapper.text()).not.toContain("是否排程");
    expect(wrapper.text()).not.toContain("托盘分配情况");
    expect(wrapper.text()).not.toContain("当前状态");
    expect(wrapper.text()).not.toContain("实验当前信息");
    expect(wrapper.text()).not.toContain("实验摘要");
    expect(wrapper.text()).toContain("温度冲击");
    expect(wrapper.text()).toContain("振动");
    expect(wrapper.text()).toContain("2");
    expect(wrapper.text()).toContain("已排程");
    expect(wrapper.text()).toContain("实验完成");
    expect(wrapper.text()).toContain("2 / 3");
    expect(wrapper.text()).toContain("TP-001");
    expect(wrapper.text()).toContain("TP-002");
    expect(wrapper.text()).toContain("2");
    expect(wrapper.findAll(".task-overview-summary-lines span")).toHaveLength(6);
    expect(wrapper.findAll(".task-overview-summary-lines").every((node) => node.classes().includes("is-centered"))).toBe(true);
  });
});
