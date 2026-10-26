import { mount } from "@vue/test-utils";
import { defineComponent, nextTick, ref } from "vue";
import { afterEach, describe, expect, test, vi } from "vitest";
import { vAppIcon } from "./appIcon";

const box = (x, y, width, height) => ({ x, y, left: x, top: y, right: x + width, bottom: y + height, width, height });
let controlBox;
let wordsBox;
let boundaryBox;
let observer;

function mockGeometry() {
  controlBox = box(100, 60, 100, 46);
  wordsBox = box(120, 73, 60, 20);
  boundaryBox = box(20, 20, 500, 400);
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function () {
    return this.classList.contains("card") ? boundaryBox : controlBox;
  });
  vi.spyOn(document, "createRange").mockImplementation(() => ({
    selectNodeContents() {},
    getClientRects: () => [wordsBox],
  }));
  vi.spyOn(document.documentElement, "scrollWidth", "get").mockReturnValue(1920);
  vi.spyOn(HTMLElement.prototype, "clientLeft", "get").mockReturnValue(1);
  vi.spyOn(HTMLElement.prototype, "clientTop", "get").mockReturnValue(1);
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback) { observer = this; this.callback = callback; this.disconnect = vi.fn(); }
    observe() {}
  });
}

const harness = () => defineComponent({
  directives: { appIcon: vAppIcon },
  setup() {
    return { name: ref("save"), disabled: ref(false), label: ref("保存设置") };
  },
  template: '<div class="card"><button v-app-icon="{ name, placement: \'button\' }" :disabled="disabled" style="position:static;padding:10px 18px;font-size:14px;width:100px;height:46px;border:1px solid">{{ label }}</button></div>',
});

describe("vAppIcon", () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  test("centers the icon and text together with safe insets while preserving button dimensions", async () => {
    mockGeometry();
    const wrapper = mount(harness());
    await nextTick();
    const button = wrapper.get("button");
    const svg = button.get("[data-app-icon]");
    expect(button.text()).toBe("保存设置");
    expect(button.attributes("style")).toContain("padding: 10px 18px");
    expect(button.element.style.width).toBe("100px");
    expect(button.element.style.height).toBe("46px");
    expect(button.element.style.fontSize).toBe("14px");
    expect(svg.attributes("aria-hidden")).toBe("true");
    expect(svg.attributes("focusable")).toBe("false");
    expect(svg.element.style.position).toBe("absolute");
    expect(svg.element.style.pointerEvents).toBe("none");
    expect(svg.element.style.display).toBe("block");
    expect(svg.element.style.left).toBe("8px");
    expect(svg.element.style.width).toBe("16px");
    const label = button.get("[data-app-icon-label]");
    expect(label.element.style.transform).toBe("translateX(11px)");
    const left = controlBox.left + 1 + Number.parseFloat(svg.element.style.left);
    const right = wordsBox.right + 11;
    expect((left + right) / 2).toBe(controlBox.left + controlBox.width / 2);
    expect(left - controlBox.left).toBeGreaterThanOrEqual(8);
    expect(controlBox.right - right).toBeGreaterThanOrEqual(8);
    wrapper.unmount();
    expect(observer.disconnect).toHaveBeenCalledOnce();
  });

  test("hides icons and restores original text alignment when resized too small", async () => {
    mockGeometry();
    const wrapper = mount(harness());
    await nextTick();
    wordsBox = box(110, 73, 80, 20);
    observer.callback();
    await nextTick();
    expect(wrapper.get("svg").element.style.display).toBe("none");
    expect(wrapper.find("[data-app-icon-label]").exists()).toBe(false);
    wordsBox = box(125, 73, 50, 20);
    observer.callback();
    await nextTick();
    expect(wrapper.get("svg").element.style.display).toBe("block");
    expect(wrapper.get("svg").element.style.width).toBe("16px");
    expect(wrapper.findAll("[data-app-icon-label]")).toHaveLength(1);
    wrapper.unmount();
  });

  test("fits a 13px icon and 6px gap into a 66px refresh button without touching the edge", async () => {
    mockGeometry();
    controlBox = box(100, 60, 66, 46);
    wordsBox = box(119, 73, 28, 20);
    const wrapper = mount(harness());
    await nextTick();
    const svg = wrapper.get("svg");
    const offset = Number.parseFloat(wrapper.get("[data-app-icon-label]").element.style.transform.slice(11));
    expect(svg.element.style.width).toBe("13px");
    const left = controlBox.left + 1 + Number.parseFloat(svg.element.style.left);
    const right = wordsBox.right + offset;
    expect(left - controlBox.left).toBe(9.5);
    expect(controlBox.right - right).toBe(9.5);
    expect((left + right) / 2).toBe(133);
    wrapper.unmount();
  });

  test("updates dynamic text and disabled state without adding duplicate icons or changing accessible names", async () => {
    mockGeometry();
    const wrapper = mount(harness());
    await nextTick();
    wrapper.vm.label = "保存中…";
    wrapper.vm.disabled = true;
    await nextTick();
    await nextTick();
    expect(wrapper.get("button").text()).toBe("保存中…");
    expect(wrapper.findAll("[data-app-icon]")).toHaveLength(1);
    expect(wrapper.get("svg").element.style.display).toBe("none");
    expect(wrapper.find("[data-app-icon-label]").exists()).toBe(false);
    wrapper.vm.disabled = false;
    wrapper.vm.name = "refresh";
    await nextTick();
    await nextTick();
    expect(wrapper.get("svg").attributes("data-app-icon")).toBe("refresh");
    expect(wrapper.get("svg").element.style.display).toBe("block");
    expect(wrapper.findAll("[data-app-icon]")).toHaveLength(1);
    expect(wrapper.findAll("[data-app-icon-label]")).toHaveLength(1);
    wrapper.unmount();
  });

  test("restores Vue-owned nested nodes before patching conditional button text", async () => {
    mockGeometry();
    const Page = defineComponent({
      directives: { appIcon: vAppIcon },
      setup: () => ({ working: ref(false), count: ref(1) }),
      template: '<div class="card"><button v-app-icon="{ name: \'save\', placement: \'button\' }" style="border:1px solid"><strong v-if="!working">保存 {{ count }}</strong><span v-else>保存中…</span></button></div>',
    });
    const wrapper = mount(Page);
    await nextTick();
    wrapper.vm.count = 2;
    await nextTick();
    await nextTick();
    expect(wrapper.get("button").text()).toBe("保存 2");
    wrapper.vm.working = true;
    await nextTick();
    await nextTick();
    expect(wrapper.get("button").text()).toBe("保存中…");
    expect(wrapper.find("strong").exists()).toBe(false);
    expect(wrapper.findAll("[data-app-icon-label]")).toHaveLength(1);
    expect(wrapper.findAll("[data-app-icon]")).toHaveLength(1);
    wrapper.unmount();
  });

  test("does not show a button icon when wrapping would alter its outer dimensions", async () => {
    mockGeometry();
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function () {
      if (this.classList.contains("card")) return boundaryBox;
      return this.querySelector("[data-app-icon-label]") ? box(100, 60, 120, 46) : controlBox;
    });
    const wrapper = mount(harness());
    await nextTick();
    expect(wrapper.get("svg").element.style.display).toBe("none");
    expect(wrapper.find("[data-app-icon-label]").exists()).toBe(false);
    expect(wrapper.get("button").element.getBoundingClientRect().width).toBe(100);
    expect(wrapper.get("button").text()).toBe("保存设置");
    wrapper.unmount();
  });

  test("keeps navigation icons at the original right-side placement without wrapping text", async () => {
    mockGeometry();
    wordsBox = box(110, 73, 40, 20);
    const Page = defineComponent({
      directives: { appIcon: vAppIcon },
      template: '<div class="card"><a v-app-icon="{ name: \'cpu\', placement: \'nav\' }" style="position:static"><span class="nav-link-label">设备资源</span></a></div>',
    });
    const wrapper = mount(Page);
    await nextTick();
    expect(wrapper.get("svg").element.style.left).toBe("71px");
    expect(wrapper.get("svg").element.style.width).toBe("16px");
    expect(wrapper.find("[data-app-icon-label]").exists()).toBe(false);
    expect(wrapper.get(".nav-link-label").text()).toBe("设备资源");
    wrapper.unmount();
  });

  test("keeps a heading icon out of the text flow and hides it near a neighbouring control", async () => {
    mockGeometry();
    controlBox = box(100, 60, 160, 30);
    wordsBox = box(100, 65, 90, 20);
    const Page = defineComponent({
      directives: { appIcon: vAppIcon },
      template: '<div class="card"><h3 v-app-icon="{ name: \'cpu\' }">设备列表</h3><button>操作</button></div>',
    });
    const wrapper = mount(Page);
    await nextTick();
    expect(wrapper.get("h3 svg").element.style.display).toBe("none");
    wrapper.get("button").element.remove();
    observer.callback();
    await nextTick();
    expect(wrapper.get("h3").text()).toBe("设备列表");
    expect(wrapper.get("h3 svg").element.style.display).toBe("block");
    expect(wrapper.get("h3 svg").element.style.left).toBe("99px");
    wrapper.unmount();
  });

  test("uses a visual heading boundary and avoids its neighbouring status badge", async () => {
    mockGeometry();
    wordsBox = box(100, 55, 90, 20);
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function () {
      if (this.classList.contains("visual-board-top")) return box(80, 30, 400, 90);
      if (this.classList.contains("status")) return box(198, 50, 65, 30);
      return box(100, 50, 90, 30);
    });
    const Page = defineComponent({
      directives: { appIcon: vAppIcon },
      setup: () => ({ boundary: ref(".visual-board-top") }),
      template: '<div class="visual-board-top"><div class="visual-title-only"><h3 v-app-icon="{ name: \'calendar\', boundary }">三日排程</h3></div><span class="status">正常</span></div>',
    });
    const wrapper = mount(Page);
    await nextTick();
    expect(wrapper.get("h3 svg").element.style.display).toBe("none");
    wrapper.get(".status").element.remove();
    observer.callback();
    await nextTick();
    expect(wrapper.get("h3 svg").element.style.display).toBe("block");
    expect(wrapper.get("h3").text()).toBe("三日排程");
    wrapper.vm.boundary = ".visual-title-only";
    await nextTick();
    await nextTick();
    expect(wrapper.get("h3 svg").element.style.display).toBe("none");
    expect(observer.disconnect).toHaveBeenCalledOnce();
    wrapper.unmount();
    expect(observer.disconnect).toHaveBeenCalledTimes(2);
  });

  test("draws a title icon on an unclipped parent while measuring only its ellipsis heading", async () => {
    mockGeometry();
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function () {
      return this.classList.contains("visual-board-top") ? box(80, 30, 400, 90) : box(100, 50, 90, 30);
    });
    vi.spyOn(document, "createRange").mockImplementation(() => {
      let selected;
      return {
        selectNodeContents(node) { selected = node; },
        getClientRects: () => [selected.parentElement.matches("h3") ? box(100, 55, 90, 20) : box(100, 35, 220, 15)],
      };
    });
    const Page = defineComponent({
      directives: { appIcon: vAppIcon },
      template: '<div class="visual-board-top"><div class="visual-board-title-group" v-app-icon="{ name: \'calendar\', boundary: \'.visual-board-top\', textTarget: \'h3\' }"><small>SCHEDULE MATRIX</small><h3 style="overflow:hidden;text-overflow:ellipsis">三日排程</h3></div></div>',
    });
    const wrapper = mount(Page);
    await nextTick();
    const icon = wrapper.get(".visual-board-title-group > svg");
    expect(icon.element.style.display).toBe("block");
    expect(icon.element.style.left).toBe("99px");
    expect(wrapper.find("h3 svg").exists()).toBe(false);
    expect(wrapper.get("h3").element.style.overflow).toBe("hidden");
    expect(wrapper.get("h3").text()).toBe("三日排程");
    wrapper.unmount();
  });
});
