import { mount } from "@vue/test-utils";
import { describe, expect, test } from "vitest";

import TaskOverviewEditorPanel from "./TaskOverviewEditorPanel.vue";

const baseProps = {
  deleteConfirm: {},
  deleting: false,
  editError: "",
  editForm: {
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
});
