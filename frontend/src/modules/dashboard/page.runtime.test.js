import { mount } from "@vue/test-utils";
import { computed, ref } from "vue";
import { describe, expect, test, vi } from "vitest";

import DashboardPage from "./page.vue";

const useDashboardPageMock = vi.fn();

vi.mock("./useDashboardPage", () => ({
  useDashboardPage: () => useDashboardPageMock(),
}));

describe("DashboardPage runtime", () => {
  test("renders dashboard KPI summaries and task rows from Vue state", () => {
    useDashboardPageMock.mockReturnValue({
      currentPage: ref(1),
      deviceItems: computed(() => [
        { code: "LAB-01", status: "可用", dotClass: "timeline-dot--available" },
        { code: "LAB-02", status: "使用中", dotClass: "timeline-dot--running" },
      ]),
      pageCount: computed(() => 1),
      pagedTaskRows: computed(() => [
        { code: "T-001", source: "外部委托", status: "待排程", statusClass: "status" },
      ]),
      setCurrentPage: vi.fn(),
      summaryCards: computed(() => ({
        alertCount: 0,
        alertNote: "无预警",
        deviceCount: 1,
        intakeCount: 3,
        intakeNote: "外部 2 / 内部 1",
        scheduledCount: 2,
        unscheduledCount: 1,
      })),
      unscheduledExperimentItems: computed(() => [
        {
          elapsedLabel: "25:30:00",
          experimentCode: "T-001-A",
          experimentLabel: "振动试验",
          isOverdue: true,
          taskCode: "T-001",
        },
      ]),
    });

    const wrapper = mount(DashboardPage);

    expect(wrapper.text()).toContain("已受理任务");
    expect(wrapper.text()).not.toContain("未来 48 小时");
    expect(wrapper.text()).not.toContain("今日受理");
    expect(wrapper.text()).toContain("外部 2 / 内部 1");
    expect(wrapper.text()).toContain("正在运行（实验）");
    expect(wrapper.text()).toContain("未排程实验计时");
    expect(wrapper.text()).toContain("设备状态");
    expect(wrapper.text()).not.toContain("设备空闲");
    expect(wrapper.text()).not.toContain("数据通道");
    expect(wrapper.text()).not.toContain("实验中任务");
    expect(wrapper.text()).toContain("25:30:00");
    expect(wrapper.text()).toContain("T-001 / 振动试验");
    expect(wrapper.text()).not.toContain("T-001-A");
    expect(wrapper.text()).toContain("LAB-01");
    expect(wrapper.find("#dashboard-device-list .timeline-dot--available").exists()).toBe(true);
    expect(wrapper.find("#dashboard-device-list .timeline-dot--running").exists()).toBe(true);
    expect(wrapper.get("#dashboard-unscheduled-count").text()).toBe("1");
    expect(wrapper.find(".dashboard-unscheduled-title.is-overdue").exists()).toBe(true);
    expect(wrapper.find(".dashboard-unscheduled-timer.is-overdue").exists()).toBe(true);
  });

  test("emits pagination changes through the shared pagination component", async () => {
    const setCurrentPage = vi.fn();

    useDashboardPageMock.mockReturnValue({
      currentPage: ref(1),
      deviceItems: computed(() => [{ code: "LAB-01", status: "可用" }]),
      pageCount: computed(() => 3),
      pagedTaskRows: computed(() => [
        { code: "T-001", source: "外部委托", status: "待排程", statusClass: "status" },
      ]),
      setCurrentPage,
      summaryCards: computed(() => ({
        alertCount: 1,
        alertNote: "存在数据缺口",
        deviceCount: 1,
        intakeCount: 9,
        intakeNote: "外部 6 / 内部 3",
        scheduledCount: 4,
        unscheduledCount: 5,
      })),
      unscheduledExperimentItems: computed(() => []),
    });

    const wrapper = mount(DashboardPage);

    expect(wrapper.find('.dashboard-task-pagination [data-page="prev"]').exists()).toBe(true);
    expect(wrapper.find('.dashboard-task-pagination [data-page="next"]').exists()).toBe(true);
    expect(wrapper.get('.dashboard-task-pagination [data-testid="pagination-status"]').text()).toBe("第 1 / 3 页");

    await wrapper.get('.dashboard-task-pagination [data-testid="pagination-jump-input"]').setValue("2");
    await wrapper.get('.dashboard-task-pagination [data-testid="pagination-jump-submit"]').trigger("click");

    expect(setCurrentPage).toHaveBeenCalledWith(2);
  });
});
