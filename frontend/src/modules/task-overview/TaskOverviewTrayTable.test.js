import { mount } from "@vue/test-utils";
import { describe, expect, test } from "vitest";

import TaskOverviewTrayTable from "./TaskOverviewTrayTable.vue";

describe("TaskOverviewTrayTable", () => {
  test("renders tray totals and rows", () => {
    const wrapper = mount(TaskOverviewTrayTable, {
      props: {
        trayOverviewRows: [
          {
            currentLocation: "恒温恒湿间（暂存间）",
            currentStatus: "已到达暂存间",
            hasTray: true,
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
    expect(wrapper.text()).toContain("当前状态");
    expect(wrapper.text()).toContain("当前位置");
    expect(wrapper.text()).not.toContain("排程状态");
    expect(wrapper.text()).not.toContain("实验室");
    expect(wrapper.text()).toContain("已到达暂存间");
    expect(wrapper.text()).toContain("恒温恒湿间（暂存间）");
    expect(wrapper.find(".is-scheduled").exists()).toBe(true);
  });
});
