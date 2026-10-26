import { mount } from "@vue/test-utils";
import { defineComponent, nextTick } from "vue";
import { afterEach, describe, expect, test } from "vitest";

import AppModal from "./AppModal.vue";

const attachedWrappers = [];
const mountAttached = (component, options = {}) => {
  const wrapper = mount(component, { ...options, attachTo: document.body });
  attachedWrappers.push(wrapper);
  return wrapper;
};
afterEach(() => {
  attachedWrappers.splice(0).reverse().forEach((wrapper) => wrapper.unmount());
  document.body.innerHTML = "";
});

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

  test("can hide the close button and ignore backdrop close", async () => {
    const wrapper = mount(AppModal, {
      props: {
        closeOnBackdrop: false,
        open: true,
        showClose: false,
        title: "不可关闭弹窗",
      },
    });

    expect(wrapper.find(".modal-close").exists()).toBe(false);

    await wrapper.find(".modal-backdrop").trigger("click");

    expect(wrapper.emitted("close")).toBeUndefined();
  });

  test("moves focus inside, wraps Tab, skips disabled and hidden controls, then restores the trigger", async () => {
    const trigger = document.createElement("button");
    document.body.append(trigger);
    trigger.focus();
    const wrapper = mountAttached(AppModal, {
      props: { open: false, title: "范围" },
      slots: { default: '<button disabled>不可选</button><button style="display:none">隐藏</button><input aria-label="搜索" /><button class="last">确认</button>' },
    });
    await wrapper.setProps({ open: true });
    await nextTick();
    const close = wrapper.get(".modal-close").element;
    const last = wrapper.get(".last").element;
    expect(document.activeElement).toBe(close);
    close.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(last);
    last.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(close);
    trigger.focus();
    expect(document.activeElement).toBe(close);
    await wrapper.setProps({ open: false });
    expect(document.activeElement).toBe(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);
  });

  test("only the upper modal traps focus and handles Escape, then returns to its parent control", async () => {
    const Host = defineComponent({
      components: { AppModal },
      data: () => ({ parentOpen: false, childOpen: false }),
      template: `<button class="trigger" @click="parentOpen=true">打开</button>
        <AppModal :open="parentOpen" title="父层" @close="parentOpen=false">
          <button class="open-child" @click="childOpen=true">选择范围</button>
          <AppModal :open="childOpen" title="上层" @close="childOpen=false"><input class="child-input" /></AppModal>
        </AppModal>`,
    });
    const wrapper = mountAttached(Host);
    const trigger = wrapper.get(".trigger");
    trigger.element.focus();
    await trigger.trigger("click");
    await nextTick();
    const childTrigger = wrapper.get(".open-child");
    childTrigger.element.focus();
    await childTrigger.trigger("click");
    await nextTick();
    const dialogs = wrapper.findAll("[role='dialog']");
    expect(document.activeElement).toBe(dialogs[1].get(".modal-close").element);
    wrapper.get(".child-input").element.focus();
    await wrapper.get(".child-input").trigger("keydown", { key: "Escape" });
    await nextTick();
    expect(wrapper.vm.childOpen).toBe(false);
    expect(wrapper.vm.parentOpen).toBe(true);
    expect(document.activeElement).toBe(childTrigger.element);
    await childTrigger.trigger("keydown", { key: "Escape" });
    await nextTick();
    expect(document.activeElement).toBe(trigger.element);
  });

  test("focuses the dialog itself when it has no enabled controls and releases on unmount", async () => {
    const wrapper = mountAttached(AppModal, { props: { open: true, showClose: false }, slots: { default: "只读内容" } });
    await nextTick();
    expect(document.activeElement).toBe(wrapper.get("[role='dialog']").element);
    await wrapper.get("[role='dialog']").trigger("keydown", { key: "Tab" });
    expect(document.activeElement).toBe(wrapper.get("[role='dialog']").element);
    wrapper.unmount();
    attachedWrappers.splice(attachedWrappers.indexOf(wrapper), 1);
    const outside = document.createElement("button");
    document.body.append(outside);
    outside.focus();
    expect(document.activeElement).toBe(outside);
  });
});
