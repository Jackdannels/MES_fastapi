import { mount } from "@vue/test-utils";
import { describe, expect, test } from "vitest";

import TaskOverviewTrayTable from "./TaskOverviewTrayTable.vue";

describe("TaskOverviewTrayTable", () => {
  test("renders tray totals and rows", () => {
    const wrapper = mount(TaskOverviewTrayTable, {
      props: {
        trayOverviewRows: [
          {
            isScheduled: true,
            lab: "冲击一室",
            scheduleStatus: "已排期",
            slotCode: "TP-001",
            targetExperiment: "冲击试验",
            taskCode: "TASK-001",
            trayCode: "TRAY-001",
          },
        ],
        trayOverviewTotal: 10,
      },
    });

    expect(wrapper.text()).toContain("10");
    expect(wrapper.text()).toContain("TRAY-001");
    expect(wrapper.find(".is-scheduled").exists()).toBe(true);
  });
});
