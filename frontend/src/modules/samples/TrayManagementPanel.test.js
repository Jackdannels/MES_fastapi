import { mount } from "@vue/test-utils";
import { describe, expect, test, vi } from "vitest";

import TrayManagementPanel from "./TrayManagementPanel.vue";

describe("TrayManagementPanel", () => {
  test("shows partial experiment completion as running with a completed-count suffix in the task flow", async () => {
    const wrapper = mount(TrayManagementPanel, {
      props: {
        samplesFlow: {
          rawExperimentTrays: [],
          rawExperiments: [
            { task_code: "SYLU-2026-03-021", experiment_code: "SYLU-2026-03-021-A", experiment_name: "冲击试验", status: "实验已经完成" },
            { task_code: "SYLU-2026-03-021", experiment_code: "SYLU-2026-03-021-B", experiment_name: "振动试验", status: "待排程" },
          ],
          rawSamples: [],
          rawSchedules: [],
          rawTasks: [{ code: "SYLU-2026-03-021", status: "已排程" }],
          trayRows: [
            {
              sampleCount: 1,
              sampleSummary: "SYLU-2026-03-021-SP-001",
              status: "实验进行中",
              taskCode: "SYLU-2026-03-021",
              taskName: "部分完成任务",
              testType: "冲击试验 / 振动试验",
              trayCode: "SYLU-2026-03-021-TP-001",
            },
          ],
          trayStatusOptions: ["实验进行中", "实验已完成"],
          updateTrayStatusInline: vi.fn(async () => {}),
          warning: "",
        },
      },
    });

    expect(wrapper.get('[data-testid="samples-task-flow-status"]').text()).toBe("任务进行中（已完成1个实验）");
  });
});
