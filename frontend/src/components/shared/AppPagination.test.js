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
});
