import { mount } from "@vue/test-utils";
import { computed, reactive, ref } from "vue";
import { describe, expect, test, vi } from "vitest";

import DataPage from "./page.vue";

const validateReportMock = vi.fn();
const generateReportMock = vi.fn();
const openDataDrawerMock = vi.fn();
const closeDataDrawerMock = vi.fn();
const closeReportModalMock = vi.fn();
const openReportModalMock = vi.fn();

const dataState = reactive({
  dataDrawerOpen: false,
  reportModalOpen: false,
});

vi.mock("./useDataPage", () => ({
  useDataPage: () => ({
    closeDataDrawer: closeDataDrawerMock,
    closeReportModal: closeReportModalMock,
    dataDrawerOpen: computed(() => dataState.dataDrawerOpen),
    dataRows: computed(() => [
      {
        device: "HPLC-01",
        id: "stream-1",
        lastPacket: "2026-03-12 10:00",
        quality: "98.8",
        status: "采集中",
        statusClass: "status running",
        taskCode: "TASK-001",
      },
    ]),
    generateReport: generateReportMock,
    metrics: computed(() => ({
      reportCount: 1,
      streamCount: 2,
      validationCount: 1,
    })),
    openDataDrawer: openDataDrawerMock,
    openReportModal: openReportModalMock,
    reportForm: ref({
      rangeEnd: "",
      rangeStart: "",
      remark: "",
      rule: "完整性校验",
      taskCode: "",
      template: "重金属检测固定模板",
    }),
    reportModalOpen: computed(() => dataState.reportModalOpen),
    selectedRow: computed(() => ({
      quality: "98.8%",
      status: "采集中",
      taskCode: "TASK-001",
    })),
    validateReport: validateReportMock,
  }),
}));

describe("DataPage runtime", () => {
  test("renders stream rows and opens the report modal from Vue state", async () => {
    const wrapper = mount(DataPage);

    expect(wrapper.text()).toContain("TASK-001");
    expect(wrapper.text()).toContain("HPLC-01");

    dataState.reportModalOpen = true;
    await wrapper.vm.$nextTick();

    expect(wrapper.find(".modal.is-open").exists()).toBe(true);
    expect(wrapper.text()).toContain("报告预览");
  });

  test("delegates report validation and opens the detail drawer from Vue state", async () => {
    const wrapper = mount(DataPage);

    await wrapper.get('[data-testid="data-validate"]').trigger("click");
    await wrapper.get('[data-testid="open-data-drawer-0"]').trigger("click");

    expect(validateReportMock).toHaveBeenCalledTimes(1);
    expect(openDataDrawerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        taskCode: "TASK-001",
      })
    );

    dataState.dataDrawerOpen = true;
    await wrapper.vm.$nextTick();

    expect(wrapper.find(".drawer.is-open").exists()).toBe(true);
    expect(wrapper.text()).toContain("数据明细");
  });
});
