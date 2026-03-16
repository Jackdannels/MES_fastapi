import { mount } from "@vue/test-utils";
import { describe, expect, test } from "vitest";

import AppDrawer from "./AppDrawer.vue";

describe("AppDrawer", () => {
  test("renders slot content only when open", () => {
    const closedWrapper = mount(AppDrawer, {
      props: {
        open: false,
        title: "抽屉",
      },
      slots: {
        default: '<div class="drawer-body-slot">内容</div>',
      },
    });

    expect(closedWrapper.classes()).toContain("drawer");
    expect(closedWrapper.classes()).not.toContain("is-open");
    expect(closedWrapper.find(".drawer-body-slot").exists()).toBe(false);

    const openWrapper = mount(AppDrawer, {
      props: {
        open: true,
        title: "抽屉",
      },
      slots: {
        default: '<div class="drawer-body-slot">内容</div>',
      },
    });

    expect(openWrapper.classes()).toContain("is-open");
    expect(openWrapper.find(".drawer-body-slot").exists()).toBe(true);
  });

  test("emits close when drawer backdrop or close button is clicked", async () => {
    const wrapper = mount(AppDrawer, {
      props: {
        open: true,
        title: "抽屉",
      },
    });

    await wrapper.find(".modal-backdrop").trigger("click");
    await wrapper.find(".drawer-close").trigger("click");

    expect(wrapper.emitted("close")).toHaveLength(2);
  });
});
