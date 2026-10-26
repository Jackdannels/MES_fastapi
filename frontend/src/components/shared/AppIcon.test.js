import { mount } from "@vue/test-utils";
import { describe, expect, test } from "vitest";
import AppIcon from "./AppIcon.vue";

describe("AppIcon", () => {
  test("renders a decorative current-color icon with explicit size", () => {
    const wrapper = mount(AppIcon, { props: { name: "save", size: 20 } });
    expect(wrapper.attributes("width")).toBe("20");
    expect(wrapper.attributes("height")).toBe("20");
    expect(wrapper.attributes("aria-hidden")).toBe("true");
    expect(wrapper.attributes("focusable")).toBe("false");
    expect(wrapper.attributes("stroke")).toBe("currentColor");
    expect(wrapper.find("path").exists()).toBe(true);
    expect(wrapper.text()).toBe("");
  });
});
