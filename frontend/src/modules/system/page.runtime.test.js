import { mount } from "@vue/test-utils";
import { describe, expect, test } from "vitest";

import SystemPage from "./page.vue";

describe("SystemPage runtime", () => {
  test("opens and closes the role modal from Vue state", async () => {
    const wrapper = mount(SystemPage);

    expect(wrapper.find(".modal.is-open").exists()).toBe(false);

    await wrapper.get('[data-testid="open-role-modal"]').trigger("click");

    expect(wrapper.find(".modal.is-open").exists()).toBe(true);
    expect(wrapper.text()).toContain("新增角色");

    await wrapper.get(".modal-close").trigger("click");

    expect(wrapper.find(".modal.is-open").exists()).toBe(false);
  });

  test("opens the role drawer from Vue state and filters visible roles", async () => {
    const wrapper = mount(SystemPage);

    expect(wrapper.find(".drawer.is-open").exists()).toBe(false);
    expect(wrapper.findAll("#role-table tbody tr")).toHaveLength(3);

    await wrapper.get('input[placeholder="筛选角色/权限"]').setValue("设备");

    expect(wrapper.findAll("#role-table tbody tr")).toHaveLength(1);
    expect(wrapper.text()).toContain("设备工程师");

    await wrapper.get('[data-testid="open-role-drawer-0"]').trigger("click");

    expect(wrapper.find(".drawer.is-open").exists()).toBe(true);
    expect(wrapper.text()).toContain("角色详情");
  });
});
