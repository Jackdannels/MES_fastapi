import { mount } from "@vue/test-utils";
import { describe, expect, test, vi } from "vitest";

import ProcessPage from "./ProcessPage.vue";

const mocks = vi.hoisted(() => ({
  closeTaskDrawer: vi.fn(),
  openTaskOverview: vi.fn(),
}));

vi.mock("@/composables/useProcessLabs", async () => {
  const { ref } = await import("vue");

  return {
    useProcessLabs: () => ({
      closeTaskDrawer: mocks.closeTaskDrawer,
      idleCount: ref(0),
      labCards: ref([
        {
          name: "冲击一室",
          scheduleTime: "03/10 09:30 - 03/10 10:30",
          status: "实验中",
          statusClass: "is-running",
          targetExperiment: "冲击试验",
          taskCode: "CJ-2026-001",
          testType: "冲击试验",
        },
      ]),
      loading: ref(false),
      openTaskOverview: mocks.openTaskOverview,
      runningCount: ref(1),
      scheduledCount: ref(0),
      selectedTaskDetail: ref({
        code: "CJ-2026-001",
        displayName: "冲击试验任务",
        labName: "冲击一室",
        name: "冲击试验任务 批次A",
        trayCodes: ["TRAY-001", "TRAY-002", "TRAY-003", "TRAY-004"],
        trayCount: 4,
        traySummary: "TRAY-001, TRAY-002, TRAY-003 +1",
        scheduleTime: "03/10 09:30 - 03/10 10:30",
        status: "实验中",
        testType: "冲击试验",
      }),
      taskDrawerOpen: ref(true),
    }),
  };
});

describe("ProcessPage runtime", () => {
  test("renders utf-8 chinese labels and task details inside a centered modal summary", async () => {
    const wrapper = mount(ProcessPage);

    await wrapper.get("button.action-btn.secondary").trigger("click");

    expect(mocks.openTaskOverview).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "冲击一室",
        taskCode: "CJ-2026-001",
      })
    );
    expect(wrapper.find(".modal.is-open").exists()).toBe(true);
    expect(wrapper.find(".process-task-modal-content").exists()).toBe(true);
    expect(wrapper.text()).toContain("试验过程管控");
    expect(wrapper.text()).toContain("展示各实验室当前状态，暂存间不纳入本页。");
    expect(wrapper.text()).toContain("实验中");
    expect(wrapper.text()).toContain("已排期");
    expect(wrapper.text()).toContain("空闲");
    expect(wrapper.text()).toContain("查看任务");
    expect(wrapper.text()).toContain("任务摘要");
    expect(wrapper.text()).toContain("试验任务详情");
    expect(wrapper.text()).toContain("CJ-2026-001");
    expect(wrapper.text()).toContain("冲击试验任务");
    expect(wrapper.text()).not.toContain("批次A");
    expect(wrapper.get(".process-task-code-headline").text()).toBe("CJ-2026-001");
    expect(wrapper.get(".process-task-name-subtitle").text()).toBe("冲击试验任务");
    expect(wrapper.text()).toContain("4");
    expect(wrapper.text()).toContain("TRAY-001, TRAY-002, TRAY-003 +1");
    expect(wrapper.findAll(".process-task-tray-chip")).toHaveLength(4);
  });
});
