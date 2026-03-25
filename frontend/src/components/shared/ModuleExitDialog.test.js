import { mount } from "@vue/test-utils";
import { describe, expect, test } from "vitest";

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

  test("emits the selected target module when switching", async () => {
    const wrapper = mount(ModuleExitDialog, {
      props: {
        currentModule: "central",
        open: true,
      },
    });

    await wrapper.get('[data-testid="module-exit-select"]').setValue("visual");
    await wrapper.get('[data-testid="module-exit-switch"]').trigger("click");

    expect(wrapper.emitted("switch-module")).toEqual([["visual"]]);
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
