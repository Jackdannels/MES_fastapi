import { mount } from "@vue/test-utils";
import { describe, expect, test } from "vitest";
import AppSidebar from "./AppSidebar.vue";

function mountSidebar() {
  return mount(AppSidebar, {
    attachTo: document.body,
    props: { panelId: "test-navigation", routeKey: "/tasks" },
    slots: { brand: '<div class="brand">MES</div>', default: '<nav><a href="#samples">样品信息</a></nav>' },
  });
}

describe("AppSidebar", () => {
  test("starts collapsed, opens navigation, and restores toggle focus on Escape", async () => {
    const wrapper = mountSidebar();
    try {
      const toggle = wrapper.get('[data-testid="sidebar-toggle"]');
      expect(toggle.attributes("aria-controls")).toBe("test-navigation");
      expect(toggle.attributes("aria-expanded")).toBe("false");
      await toggle.trigger("click");
      expect(wrapper.classes()).toContain("is-open");
      expect(toggle.attributes("aria-expanded")).toBe("true");
      wrapper.get("a").element.focus();
      await wrapper.get("a").trigger("keydown", { key: "Escape" });
      expect(toggle.attributes("aria-expanded")).toBe("false");
      expect(document.activeElement).toBe(toggle.element);
    } finally {
      wrapper.unmount();
    }
  });

  test("closes after ordinary navigation and route changes without swallowing the link click", async () => {
    const wrapper = mountSidebar();
    try {
      const toggle = wrapper.get('[data-testid="sidebar-toggle"]');
      await toggle.trigger("click");
      await wrapper.get("a").trigger("click", { ctrlKey: true });
      expect(toggle.attributes("aria-expanded")).toBe("true");
      const event = new MouseEvent("click", { bubbles: true, cancelable: true });
      wrapper.get("a").element.addEventListener("click", (e) => e.preventDefault(), { once: true });
      wrapper.get("a").element.dispatchEvent(event);
      await wrapper.vm.$nextTick();
      expect(toggle.attributes("aria-expanded")).toBe("false");
      await toggle.trigger("click");
      await wrapper.setProps({ routeKey: "/samples" });
      expect(toggle.attributes("aria-expanded")).toBe("false");
    } finally {
      wrapper.unmount();
    }
  });
});
