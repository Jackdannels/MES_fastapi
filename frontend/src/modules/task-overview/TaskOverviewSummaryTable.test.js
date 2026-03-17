import { mount } from "@vue/test-utils";
import { describe, expect, test } from "vitest";

import TaskOverviewSummaryTable from "./TaskOverviewSummaryTable.vue";

describe("TaskOverviewSummaryTable", () => {
  test("renders task summary details", () => {
    const wrapper = mount(TaskOverviewSummaryTable, {
      props: {
        formatTrayCount: (row) => String(row.trays.length),
        formatTraySummary: (row) => row.trays.map((tray) => tray.trayCode).join(" / "),
        row: {
          currentStatus: "进行中",
          plannedCount: 3,
          sampleCount: 2,
          scheduleCount: 1,
          scheduleLabel: "已排程",
          taskType: "冲击试验",
          trays: [{ trayCode: "TP-001" }, { trayCode: "TP-002" }],
        },
      },
    });

    expect(wrapper.text()).toContain("冲击试验");
    expect(wrapper.text()).toContain("进行中");
    expect(wrapper.text()).toContain("已排程");
    expect(wrapper.text()).toContain("2 / 3");
    expect(wrapper.text()).toContain("TP-001 / TP-002");
    expect(wrapper.text()).toContain("2");
    expect(wrapper.find(".task-overview-schedule-chip").classes()).toContain("is-scheduled");
  });
});
