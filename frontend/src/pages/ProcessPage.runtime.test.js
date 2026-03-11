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
          name: "Lab-A",
          scheduleTime: "03/10 09:30 - 03/10 10:30",
          status: "Running",
          statusClass: "is-running",
          targetExperiment: "Impact Test",
          taskCode: "TASK-001",
          testType: "Impact Test",
        },
      ]),
      loading: ref(false),
      openTaskOverview: mocks.openTaskOverview,
      runningCount: ref(1),
      scheduledCount: ref(0),
      selectedTaskDetail: ref({
        code: "TASK-001",
        displayName: "Impact Campaign",
        labName: "Lab-A",
        name: "Impact Campaign Batch A",
        trayCodes: ["TRAY-001", "TRAY-002", "TRAY-003", "TRAY-004"],
        trayCount: 4,
        traySummary: "TRAY-001, TRAY-002, TRAY-003 +1",
        scheduleTime: "03/10 09:30 - 03/10 10:30",
        status: "Running",
        testType: "Impact Test",
      }),
      taskDrawerOpen: ref(true),
    }),
  };
});

describe("ProcessPage runtime", () => {
  test("renders task details inside a centered modal summary", async () => {
    const wrapper = mount(ProcessPage);

    await wrapper.get("button.action-btn.secondary").trigger("click");

    expect(mocks.openTaskOverview).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Lab-A",
        taskCode: "TASK-001",
      })
    );
    expect(wrapper.find(".modal.is-open").exists()).toBe(true);
    expect(wrapper.find(".process-task-modal-content").exists()).toBe(true);
    expect(wrapper.text()).toContain("TASK-001");
    expect(wrapper.text()).toContain("Impact Campaign");
    expect(wrapper.text()).not.toContain("Batch A");
    expect(wrapper.get(".process-task-code-headline").text()).toBe("TASK-001");
    expect(wrapper.get(".process-task-name-subtitle").text()).toBe("Impact Campaign");
    expect(wrapper.text()).toContain("4");
    expect(wrapper.text()).toContain("TRAY-001, TRAY-002, TRAY-003 +1");
    expect(wrapper.findAll(".process-task-tray-chip")).toHaveLength(4);
  });
});
