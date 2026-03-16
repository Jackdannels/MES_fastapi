import { mount } from "@vue/test-utils";
import { computed, ref } from "vue";
import { describe, expect, test, vi } from "vitest";

import DashboardPage from "./DashboardPage.vue";

const useDashboardPageMock = vi.fn();

vi.mock("@/composables/useDashboardPage", () => ({
  useDashboardPage: () => useDashboardPageMock(),
}));

describe("DashboardPage runtime", () => {
  test("renders dashboard KPI summaries and task rows from Vue state", () => {
    useDashboardPageMock.mockReturnValue({
      currentPage: ref(1),
      dataGap: computed(() => "暂无缺口"),
      dataHealth: computed(() => "98.5%"),
      deviceItems: computed(() => [
        { code: "LAB-01", status: "可用" },
        { code: "LAB-02", status: "使用中" },
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
        deviceNote: "实验中任务",
        intakeCount: 3,
        intakeNote: "外部 2 / 内部 1",
        scheduledCount: 2,
        unscheduledCount: "1（暂存间存放0）",
      })),
    });

    const wrapper = mount(DashboardPage);

    expect(wrapper.text()).toContain("外部 2 / 内部 1");
    expect(wrapper.text()).toContain("98.5%");
    expect(wrapper.text()).toContain("T-001");
    expect(wrapper.text()).toContain("LAB-01");
  });

  test("emits pagination changes through the shared pagination component", async () => {
    const setCurrentPage = vi.fn();

    useDashboardPageMock.mockReturnValue({
      currentPage: ref(1),
      dataGap: computed(() => "已记录缺口"),
      dataHealth: computed(() => "92%"),
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
        deviceNote: "实验中任务",
        intakeCount: 9,
        intakeNote: "外部 6 / 内部 3",
        scheduledCount: 4,
        unscheduledCount: "5（暂存间存放2）",
      })),
    });

    const wrapper = mount(DashboardPage);

    await wrapper.get('.dashboard-task-pagination button[data-page="2"]').trigger("click");

    expect(setCurrentPage).toHaveBeenCalledWith(2);
  });
});
