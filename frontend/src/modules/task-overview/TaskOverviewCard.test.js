import { mount } from "@vue/test-utils";
import { describe, expect, test } from "vitest";

import TaskOverviewCard from "./TaskOverviewCard.vue";

const baseRow = {
  currentStatus: "进行中",
  plannedCount: 2,
  sampleCodes: ["TASK-001-SP-001", "TASK-001-SP-002"],
  sampleCount: 2,
  scheduleCount: 1,
  scheduleLabel: "已排程",
  taskCode: "TASK-001",
  taskType: "冲击试验",
  trays: [{ trayCode: "TP-001" }],
};

const mountCard = (props = {}) =>
  mount(TaskOverviewCard, {
    props: {
      deleteConfirm: {},
      deleting: false,
      editError: "",
      editForm: {
        experiments: [
          {
            experimentCode: "TASK-001-A",
            experimentName: "A实验",
            requiredDevice: "冲击试验",
          },
        ],
        sampleCodesText: "TASK-001-SP-001",
        sampleCount: 1,
        taskCode: "TASK-001",
        taskType: "冲击试验",
      },
      editMessage: "",
      editing: false,
      formatTrayCount: (row) => String(row.trays.length),
      formatTraySummary: (row) => row.trays.map((tray) => tray.trayCode).join("、"),
      index: 0,
      row: baseRow,
      saving: false,
      selected: false,
      taskTypeEditOptions: ["冲击试验", "振动试验"],
      ...props,
    },
  });

describe("TaskOverviewCard", () => {
  test("keeps single-click selection and uses double-click readonly detail guidance", async () => {
    const wrapper = mountCard({ selected: true });

    await wrapper.trigger("click");
    await wrapper.trigger("dblclick");

    expect(wrapper.emitted("select")).toEqual([[baseRow]]);
    expect(wrapper.emitted("dblclick-card")).toEqual([[baseRow]]);
    expect(wrapper.find(".task-overview-edit-btn").exists()).toBe(true);
    expect(wrapper.find(".task-overview-editor").exists()).toBe(false);
    expect(wrapper.text()).toContain("双击进入详情模式，所有信息只读");
  });

  test("renders the old detail panel style as readonly when expanded", async () => {
    const wrapper = mountCard({
      deleteConfirm: {
        sampleCount: 2,
        scheduleCount: 1,
        streamCount: 3,
        taskCode: "TASK-001",
      },
      deleting: false,
      editError: "字段错误",
      editMessage: "已保存",
      editing: true,
      saving: false,
    });

    expect(wrapper.find(".task-overview-editor").exists()).toBe(true);
    expect(wrapper.find(".task-overview-edit-btn").text()).toBe("收起详情");
    expect(wrapper.find("select.search-input").exists()).toBe(false);
    expect(wrapper.find('button[title="save-edit"]').exists()).toBe(false);
    expect(wrapper.find('button[title="generate-codes"]').exists()).toBe(false);
    expect(wrapper.find('button[title="request-delete"]').exists()).toBe(false);
    expect(wrapper.find('input[readonly]').exists()).toBe(true);
    expect(wrapper.find("textarea").element.readOnly).toBe(true);
    expect(wrapper.text()).toContain("任务编号");
    expect(wrapper.text()).not.toContain("字段错误");
    expect(wrapper.text()).not.toContain("已保存");
  });
});
