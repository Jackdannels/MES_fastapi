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
        sampleCodesText: "TASK-001-SP-001",
        sampleCount: 1,
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
  test("emits card-level actions", async () => {
    const wrapper = mountCard({ selected: true });

    await wrapper.trigger("click");
    await wrapper.trigger("dblclick");
    await wrapper.find(".task-overview-edit-btn").trigger("click");

    expect(wrapper.emitted("select")).toEqual([[baseRow]]);
    expect(wrapper.emitted("dblclick-card")).toEqual([[baseRow]]);
    expect(wrapper.emitted("open-edit")).toEqual([[baseRow]]);
  });

  test("renders editor state and emits editor actions", async () => {
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

    await wrapper.find('button[title="generate-codes"]').trigger("click");
    await wrapper.find('button[title="save-edit"]').trigger("click");
    await wrapper.find('button[title="request-delete"]').trigger("click");
    await wrapper.find('button[title="confirm-delete"]').trigger("click");
    await wrapper.find('button[title="reset-delete-confirm"]').trigger("click");
    await wrapper.find('button[title="cancel-edit"]').trigger("click");
    await wrapper.find("select.search-input").setValue("振动试验");

    expect(wrapper.find(".task-overview-editor").exists()).toBe(true);
    expect(wrapper.text()).toContain("字段错误");
    expect(wrapper.text()).toContain("已保存");
    expect(wrapper.emitted("generate-codes")).toEqual([[]]);
    expect(wrapper.emitted("save-edit")).toEqual([["TASK-001"]]);
    expect(wrapper.emitted("request-delete")).toEqual([["TASK-001"]]);
    expect(wrapper.emitted("confirm-delete")).toEqual([["TASK-001"]]);
    expect(wrapper.emitted("reset-delete-confirm")).toEqual([[]]);
    expect(wrapper.emitted("cancel-edit")).toEqual([[]]);
    expect(wrapper.emitted("update-edit-form")).toEqual([[{ taskType: "振动试验" }]]);
  });
});
