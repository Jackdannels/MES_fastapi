import { mount } from "@vue/test-utils";
import { describe, expect, test } from "vitest";

import TaskOverviewEditorPanel from "./TaskOverviewEditorPanel.vue";

const baseProps = {
  deleteConfirm: {},
  deleting: false,
  editError: "",
  editForm: {
    experiments: [
      {
        experimentCode: "TASK-001-A",
        experimentName: "A实验",
        plannedHours: 2,
        priority: "高",
        requiredDevice: "冲击试验",
      },
    ],
    sampleCodesText: "TASK-001-SP-001",
    sampleCount: 1,
    taskType: "冲击试验",
  },
  editMessage: "",
  row: {
    taskCode: "TASK-001",
  },
  saving: false,
  taskTypeEditOptions: ["冲击试验", "振动试验"],
};

describe("TaskOverviewEditorPanel", () => {
  test("uses the current SYLU sample-code placeholder format", () => {
    const wrapper = mount(TaskOverviewEditorPanel, {
      props: baseProps,
    });

    expect(wrapper.get("textarea").attributes("placeholder")).toBe("例如：SYLU-2026-03-007-SP-001");
  });

  test("emits save, generate, delete, and cancel actions", async () => {
    const wrapper = mount(TaskOverviewEditorPanel, {
      props: baseProps,
    });

    await wrapper.find('button[title="generate-codes"]').trigger("click");
    await wrapper.find('button[title="save-edit"]').trigger("click");
    await wrapper.find('button[title="request-delete"]').trigger("click");
    await wrapper.find('button[title="cancel-edit"]').trigger("click");

    expect(wrapper.emitted("generate-codes")).toEqual([[]]);
    expect(wrapper.emitted("save-edit")).toEqual([["TASK-001"]]);
    expect(wrapper.emitted("request-delete")).toEqual([["TASK-001"]]);
    expect(wrapper.emitted("cancel-edit")).toEqual([[]]);
  });

  test("hides the edit cancel button when rendering readonly details", () => {
    const wrapper = mount(TaskOverviewEditorPanel, {
      props: {
        ...baseProps,
        readonly: true,
      },
    });

    const cancelButtons = wrapper.findAll('button[title="cancel-edit"]');

    expect(cancelButtons).toHaveLength(1);
    expect(cancelButtons[0].text()).toBe("收起详情");
    expect(wrapper.text()).not.toContain("取消");
  });

  test("renders delete confirmation and emits confirmation actions", async () => {
    const wrapper = mount(TaskOverviewEditorPanel, {
      props: {
        ...baseProps,
        deleteConfirm: {
          sampleCount: 2,
          scheduleCount: 1,
          streamCount: 3,
          taskCode: "TASK-001",
        },
        editError: "字段错误",
        editMessage: "已保存",
      },
    });

    await wrapper.find('button[title="confirm-delete"]').trigger("click");
    await wrapper.find('button[title="reset-delete-confirm"]').trigger("click");

    expect(wrapper.text()).toContain("字段错误");
    expect(wrapper.text()).toContain("已保存");
    expect(wrapper.emitted("confirm-delete")).toEqual([["TASK-001"]]);
    expect(wrapper.emitted("reset-delete-confirm")).toEqual([[]]);
  });

  test("emits form field patches instead of mutating props directly", async () => {
    const wrapper = mount(TaskOverviewEditorPanel, {
      props: baseProps,
    });

    await wrapper.find("select.search-input").setValue("振动试验");
    await wrapper.find('input[type="number"]').setValue("3");
    await wrapper.find("textarea").setValue("TASK-001-SP-010");

    expect(wrapper.emitted("update-edit-form")).toEqual([
      [{ taskType: "振动试验" }],
      [{ sampleCount: 3 }],
      [{ sampleCodesText: "TASK-001-SP-010" }],
    ]);
  });

  test("limits edited sample count to 99", async () => {
    const wrapper = mount(TaskOverviewEditorPanel, {
      props: baseProps,
    });

    await wrapper.find('input[type="number"]').setValue("100");

    expect(wrapper.find('input[type="number"]').attributes("max")).toBe("99");
    expect(wrapper.emitted("update-edit-form")).toEqual([[{ sampleCount: 99 }]]);
  });

  test("renders experiments and emits patches for editing experiment drafts", async () => {
    const wrapper = mount(TaskOverviewEditorPanel, {
      props: baseProps,
    });

    expect(wrapper.text()).toContain("实验列表");
    expect(wrapper.text()).toContain("TASK-001-A");
    expect(wrapper.text()).toContain("实验类型");

    await wrapper.find('input[title="experiment-name-0"]').setValue("预处理实验");
    await wrapper.find('select[title="experiment-type-0"]').setValue("振动试验");
    await wrapper.find('button[title="add-experiment"]').trigger("click");
    await wrapper.find('button[title="remove-experiment-0"]').trigger("click");

    expect(wrapper.emitted("update-edit-form")).toEqual([
      [{ experiments: [{ experimentCode: "TASK-001-A", experimentName: "预处理实验", plannedHours: 2, priority: "高", requiredDevice: "冲击试验" }] }],
      [{ experiments: [{ experimentCode: "TASK-001-A", experimentName: "A实验", plannedHours: 2, priority: "高", requiredDevice: "振动试验" }] }],
      [{
        experiments: [
          { experimentCode: "TASK-001-A", experimentName: "A实验", plannedHours: 2, priority: "高", requiredDevice: "冲击试验" },
          { experimentCode: "TASK-001-B", experimentName: "B实验", plannedHours: 0, priority: "", requiredDevice: "振动试验" },
        ],
      }],
      [{ experiments: [] }],
    ]);
  });
});
