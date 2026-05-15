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
            { experimentCode: "TASK-001-B", experimentName: "振动", displayStatus: "实验已完成" },
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
    expect(wrapper.text()).toContain("实验已完成");
    expect(wrapper.text()).toContain("2 / 3");
    expect(wrapper.text()).toContain("TP-001");
    expect(wrapper.text()).toContain("TP-002");
    expect(wrapper.text()).toContain("2");
    expect(wrapper.findAll(".task-overview-summary-lines span")).toHaveLength(6);
    expect(wrapper.findAll(".task-overview-summary-lines").every((node) => node.classes().includes("is-centered"))).toBe(true);
  });

  test("renders overdue waiting experiments with a red warning class", () => {
    const wrapper = mount(TaskOverviewSummaryTable, {
      props: {
        formatTrayCount: () => "未分配",
        formatTraySummary: () => "未分配托盘",
        row: {
          currentStatus: "待排程",
          experimentCount: 1,
          experimentSummary: "振动试验",
          experiments: [
            { experimentCode: "TASK-002-A", experimentName: "振动试验", displayStatus: "待排程", isOverdueWaiting: true },
          ],
          plannedCount: 1,
          sampleCount: 0,
          scheduleCount: 0,
          scheduleLabel: "待排程",
          trays: [],
        },
      },
    });

    const statusChip = wrapper.find(".task-overview-summary-line-chip");

    expect(statusChip.text()).toBe("待排程");
    expect(statusChip.classes()).toContain("is-overdue");
    expect(statusChip.classes()).toContain("is-overdue-highlight");
  });

  test("keeps non-overdue waiting experiments on the standard pending style", () => {
    const wrapper = mount(TaskOverviewSummaryTable, {
      props: {
        formatTrayCount: () => "未分配",
        formatTraySummary: () => "未分配托盘",
        row: {
          currentStatus: "待排程",
          experimentCount: 1,
          experimentSummary: "霉菌试验",
          experiments: [
            { experimentCode: "TASK-003-A", experimentName: "霉菌试验", displayStatus: "待排程", isOverdueWaiting: false },
          ],
          plannedCount: 1,
          sampleCount: 0,
          scheduleCount: 0,
          scheduleLabel: "待排程",
          trays: [],
        },
      },
    });

    const statusChip = wrapper.find(".task-overview-summary-line-chip");

    expect(statusChip.text()).toBe("待排程");
    expect(statusChip.classes()).toContain("is-unscheduled");
    expect(statusChip.classes()).not.toContain("is-overdue");
    expect(statusChip.classes()).not.toContain("is-overdue-highlight");
  });

  test("renders the task status label when the row carries a partial-completion suffix", () => {
    const wrapper = mount(TaskOverviewSummaryTable, {
      props: {
        formatTrayCount: () => "1",
        formatTraySummary: () => "TP-009",
        row: {
          currentStatus: "任务进行中",
          currentStatusLabel: "任务进行中（已完成1个实验）",
          experimentCount: 2,
          experimentSummary: "振动试验A / 振动试验B",
          experiments: [
            { experimentCode: "TASK-009-A", experimentName: "振动试验A", displayStatus: "实验已完成" },
            { experimentCode: "TASK-009-B", experimentName: "振动试验B", displayStatus: "待排程" },
          ],
          plannedCount: 2,
          sampleCount: 2,
          scheduleCount: 1,
          scheduleLabel: "已排程",
          trays: [{ trayCode: "TP-009" }],
        },
      },
    });

    expect(wrapper.text()).toContain("任务进行中（已完成1个实验）");
  });

  test("renders experiment types as content without treating experiment names as types", () => {
    const wrapper = mount(TaskOverviewSummaryTable, {
      props: {
        formatTrayCount: () => "未分配",
        formatTraySummary: () => "未分配托盘",
        row: {
          currentStatus: "待排程",
          experimentCount: 2,
          experimentSummary: "盐雾试验 / 振动试验",
          experiments: [
            { experimentCode: "TASK-010-A", experimentName: "A实验", requiredDevice: "盐雾试验", displayStatus: "待排程" },
            { experimentCode: "TASK-010-B", experimentName: "新增实验名称", requiredDevice: "振动试验", displayStatus: "待排程" },
          ],
          plannedCount: 1,
          sampleCount: 1,
          scheduleCount: 0,
          scheduleLabel: "待排程",
          trays: [],
        },
      },
    });

    expect(wrapper.text()).toContain("盐雾试验");
    expect(wrapper.text()).toContain("振动试验");
    expect(wrapper.text()).not.toContain("A实验");
    expect(wrapper.text()).not.toContain("新增实验名称");
  });
});
