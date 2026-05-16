import { mount } from "@vue/test-utils";
import { describe, expect, test } from "vitest";

import AppPagination from "./AppPagination.vue";

describe("AppPagination", () => {
  test("renders active and disabled pagination states", () => {
    const wrapper = mount(AppPagination, {
      props: {
        currentPage: 1,
        pageCount: 3,
      },
    });

    const previousButton = wrapper.get('button[data-page="prev"]');
    const currentButton = wrapper.get('button[data-page="1"]');

    expect(previousButton.attributes("disabled")).toBeDefined();
    expect(currentButton.classes()).toContain("active");
  });

  test("emits page change when a target page is clicked", async () => {
    const wrapper = mount(AppPagination, {
      props: {
        currentPage: 2,
        pageCount: 4,
      },
    });

    await wrapper.get('button[data-page="3"]').trigger("click");

    expect(wrapper.emitted("change")).toEqual([[3]]);
  });

  test("uses ellipsis when page count reaches ten", () => {
    const wrapper = mount(AppPagination, {
      props: {
        currentPage: 5,
        pageCount: 10,
      },
    });

    expect(wrapper.findAll("button[data-page]").map((node) => node.attributes("data-page"))).toEqual([
      "prev",
      "1",
      "4",
      "5",
      "6",
      "10",
      "next",
    ]);
    expect(wrapper.findAll('[data-page="ellipsis"]')).toHaveLength(2);
  });

  test("uses ellipsis when page count reaches seven and keeps page slots stable near the end", async () => {
    const wrapper = mount(AppPagination, {
      props: {
        currentPage: 7,
        pageCount: 7,
      },
    });

    expect(wrapper.findAll("[data-page]").map((node) => node.attributes("data-page"))).toEqual([
      "prev",
      "1",
      "ellipsis",
      "4",
      "5",
      "6",
      "7",
      "next",
    ]);

    await wrapper.setProps({ currentPage: 6 });

    expect(wrapper.findAll("[data-page]").map((node) => node.attributes("data-page"))).toEqual([
      "prev",
      "1",
      "ellipsis",
      "4",
      "5",
      "6",
      "7",
      "next",
    ]);
  });

  test("uses ellipsis around a compact current window for long pagination", () => {
    const wrapper = mount(AppPagination, {
      props: {
        currentPage: 15,
        pageCount: 23,
      },
    });

    expect(wrapper.findAll("[data-page]").map((node) => node.attributes("data-page"))).toEqual([
      "prev",
      "1",
      "ellipsis",
      "14",
      "15",
      "16",
      "ellipsis",
      "23",
      "next",
    ]);
  });

  test("collapses the trailing ellipsis near the final page", () => {
    const wrapper = mount(AppPagination, {
      props: {
        currentPage: 21,
        pageCount: 23,
      },
    });

    expect(wrapper.findAll("[data-page]").map((node) => node.attributes("data-page"))).toEqual([
      "prev",
      "1",
      "ellipsis",
      "20",
      "21",
      "22",
      "23",
      "next",
    ]);
  });

  test("can render numbers only while keeping ellipsis behavior", () => {
    const wrapper = mount(AppPagination, {
      props: {
        currentPage: 5,
        pageCount: 10,
        showStepControls: false,
      },
    });

    expect(wrapper.find('[data-page="prev"]').exists()).toBe(false);
    expect(wrapper.find('[data-page="next"]').exists()).toBe(false);
    expect(wrapper.findAll("button[data-page]").map((node) => node.attributes("data-page"))).toEqual([
      "1",
      "4",
      "5",
      "6",
      "10",
    ]);
    expect(wrapper.findAll('[data-page="ellipsis"]')).toHaveLength(2);
  });
});
