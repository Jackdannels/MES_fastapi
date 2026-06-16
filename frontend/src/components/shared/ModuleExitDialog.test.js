import { mount } from "@vue/test-utils";
import { describe, expect, test } from "vitest";

import { LABORATORY_OPTIONS, MODULE_LABELS } from "@/lib/moduleCatalog";
import ModuleExitDialog from "./ModuleExitDialog.vue";

describe("ModuleExitDialog", () => {
  test("renders the current module selection and all actions when open", () => {
    const wrapper = mount(ModuleExitDialog, {
      props: {
        currentModule: "central",
        open: true,
      },
    });

    expect(wrapper.text()).toContain("退出登录");
    expect(wrapper.get('[data-testid="module-exit-select"]').element.value).toBe("central");
    expect(MODULE_LABELS.laboratory).toBe("试验室操作台");
    expect(
      wrapper
        .findAll('[data-testid="module-exit-select"] option')
        .map((option) => ({ key: option.element.value, label: option.text() })),
    ).toEqual([
      { key: "central", label: "中控管理" },
      { key: "handover", label: "接驳区系统" },
      { key: "visual", label: "可视化管理" },
      { key: "staging", label: "暂存间系统" },
      { key: "appearance", label: "外观检测间系统" },
      { key: "laboratory", label: "试验室操作台" },
    ]);
    expect(wrapper.get('[data-testid="module-exit-cancel"]').text()).toContain("取消");
    expect(wrapper.get('[data-testid="module-exit-logout"]').text()).toContain("彻底退出");
    expect(wrapper.get('[data-testid="module-exit-switch"]').text()).toContain("切换其他界面");
  });

  test("emits close when cancel is clicked", async () => {
    const wrapper = mount(ModuleExitDialog, {
      props: {
        currentModule: "central",
        open: true,
      },
    });

    await wrapper.get('[data-testid="module-exit-cancel"]').trigger("click");

    expect(wrapper.emitted("close")).toHaveLength(1);
  });

  test("shows a validation message when switching to the current module", async () => {
    const wrapper = mount(ModuleExitDialog, {
      props: {
        currentModule: "staging",
        open: true,
      },
    });

    await wrapper.get('[data-testid="module-exit-switch"]').trigger("click");

    expect(wrapper.text()).toContain("请选择其他界面");
    expect(wrapper.emitted("switch-module")).toBeUndefined();
  });

  test("renders laboratory room options when the laboratory module is selected", async () => {
    const wrapper = mount(ModuleExitDialog, {
      props: {
        currentModule: "central",
        open: true,
      },
    });

    expect(wrapper.find('[data-testid="module-exit-lab-select"]').exists()).toBe(false);

    await wrapper.get('[data-testid="module-exit-select"]').setValue("laboratory");

    expect(
      wrapper
        .findAll('[data-testid="module-exit-lab-select"] option')
        .map((option) => option.text()),
    ).toEqual([
      "冲击二室",
      "冲击一室",
      "高低温湿热一室",
      "高低温湿热二室",
      "霉菌试验室",
      "四综合实验室",
      "温度冲击二室",
      "温度冲击一室",
      "盐雾试验室",
      "振动二室",
      "振动一室",
    ]);
    expect(LABORATORY_OPTIONS.map((option) => option.label)).toEqual([
      "冲击二室",
      "冲击一室",
      "高低温湿热一室",
      "高低温湿热二室",
      "霉菌试验室",
      "四综合实验室",
      "温度冲击二室",
      "温度冲击一室",
      "盐雾试验室",
      "振动二室",
      "振动一室",
    ]);
  });

  test("emits the selected target module when switching", async () => {
    const wrapper = mount(ModuleExitDialog, {
      props: {
        currentModule: "central",
        open: true,
      },
    });

    await wrapper.get('[data-testid="module-exit-select"]').setValue("visual");
    await wrapper.get('[data-testid="module-exit-switch"]').trigger("click");

    expect(wrapper.emitted("switch-module")).toEqual([[{ module: "visual" }]]);
  });

  test("emits the selected laboratory room when switching to laboratory", async () => {
    const wrapper = mount(ModuleExitDialog, {
      props: {
        currentModule: "central",
        open: true,
      },
    });

    await wrapper.get('[data-testid="module-exit-select"]').setValue("laboratory");
    await wrapper.get('[data-testid="module-exit-lab-select"]').setValue("冲击一室");
    await wrapper.get('[data-testid="module-exit-switch"]').trigger("click");

    expect(wrapper.emitted("switch-module")).toEqual([[{ module: "laboratory", labName: "冲击一室" }]]);
  });

  test("shows a validation message when switching to the current laboratory room", async () => {
    const wrapper = mount(ModuleExitDialog, {
      props: {
        currentModule: "laboratory",
        currentLabName: "冲击一室",
        open: true,
      },
    });

    await wrapper.get('[data-testid="module-exit-lab-select"]').setValue("冲击一室");
    await wrapper.get('[data-testid="module-exit-switch"]').trigger("click");

    expect(wrapper.text()).toContain("请选择其他界面");
    expect(wrapper.emitted("switch-module")).toBeUndefined();
  });

  test("allows switching laboratories when the current laboratory name is unknown", async () => {
    const wrapper = mount(ModuleExitDialog, {
      props: {
        currentModule: "laboratory",
        currentLabName: "",
        open: true,
      },
    });

    await wrapper.get('[data-testid="module-exit-lab-select"]').setValue("冲击一室");
    await wrapper.get('[data-testid="module-exit-switch"]').trigger("click");

    expect(wrapper.emitted("switch-module")).toEqual([[{ module: "laboratory", labName: "冲击一室" }]]);
    expect(wrapper.text()).not.toContain("请选择其他界面");
  });

  test("emits logout when the full logout action is clicked", async () => {
    const wrapper = mount(ModuleExitDialog, {
      props: {
        currentModule: "central",
        open: true,
      },
    });

    await wrapper.get('[data-testid="module-exit-logout"]').trigger("click");

    expect(wrapper.emitted("logout")).toHaveLength(1);
  });
});
