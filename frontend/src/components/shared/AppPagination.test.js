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

  test("renders every page when page count is ten or less", () => {
    const wrapper = mount(AppPagination, {
      props: {
        currentPage: 5,
        pageCount: 10,
      },
    });

    expect(wrapper.findAll("button[data-page]").map((node) => node.attributes("data-page"))).toEqual([
      "prev",
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
      "9",
      "10",
      "next",
    ]);
    expect(wrapper.text()).not.toContain("...");
  });

  test("uses ellipsis around the current five-page window for long pagination", () => {
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
      "13",
      "14",
      "15",
      "16",
      "17",
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
      "19",
      "20",
      "21",
      "22",
      "23",
      "next",
    ]);
  });
});
