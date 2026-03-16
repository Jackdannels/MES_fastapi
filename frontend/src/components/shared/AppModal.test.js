import { mount } from "@vue/test-utils";
import { describe, expect, test } from "vitest";

import AppModal from "./AppModal.vue";

describe("AppModal", () => {
  test("renders title, body slot, and footer slot when open", () => {
    const wrapper = mount(AppModal, {
      props: {
        open: true,
        title: "测试弹窗",
      },
      slots: {
        default: '<div class="modal-body-slot">内容</div>',
        footer: '<div class="modal-footer-slot">底部</div>',
      },
    });

    expect(wrapper.classes()).toContain("modal");
    expect(wrapper.classes()).toContain("is-open");
    expect(wrapper.text()).toContain("测试弹窗");
    expect(wrapper.find(".modal-body-slot").exists()).toBe(true);
    expect(wrapper.find(".modal-footer-slot").exists()).toBe(true);
  });

  test("emits close when backdrop or close button is clicked", async () => {
    const wrapper = mount(AppModal, {
      props: {
        open: true,
        title: "测试弹窗",
      },
    });

    await wrapper.find(".modal-backdrop").trigger("click");
    await wrapper.find(".modal-close").trigger("click");

    expect(wrapper.emitted("close")).toHaveLength(2);
  });
});
