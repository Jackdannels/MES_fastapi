import { mount } from "@vue/test-utils";
import { describe, expect, test } from "vitest";

import AppPagination from "./AppPagination.vue";

describe("AppPagination", () => {
  test("renders compact page status without individual page buttons", () => {
    const wrapper = mount(AppPagination, {
      props: {
        currentPage: 4,
        pageCount: 12,
      },
    });

    expect(wrapper.text()).toContain("第 4 / 12 页");
    expect(wrapper.get('button[data-page="prev"]').text()).toBe("‹");
    expect(wrapper.get('button[data-page="next"]').text()).toBe("›");
    expect(wrapper.get('button[data-page="prev"]').attributes("aria-label")).toBe("上一页");
    expect(wrapper.get('button[data-page="next"]').attributes("aria-label")).toBe("下一页");
    expect(wrapper.find('button[data-page="4"]').exists()).toBe(false);
    expect(wrapper.find('[data-page="ellipsis"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="pagination-jump-input"]').exists()).toBe(true);
  });

  test("emits previous and next page changes", async () => {
    const wrapper = mount(AppPagination, {
      props: {
        currentPage: 2,
        pageCount: 4,
      },
    });

    await wrapper.get('button[data-page="prev"]').trigger("click");
    await wrapper.get('button[data-page="next"]').trigger("click");

    expect(wrapper.emitted("change")).toEqual([[1], [3]]);
  });

  test("disables step buttons at the edges", () => {
    const firstPage = mount(AppPagination, {
      props: {
        currentPage: 1,
        pageCount: 3,
      },
    });
    const lastPage = mount(AppPagination, {
      props: {
        currentPage: 3,
        pageCount: 3,
      },
    });

    expect(firstPage.get('button[data-page="prev"]').attributes("disabled")).toBeDefined();
    expect(lastPage.get('button[data-page="next"]').attributes("disabled")).toBeDefined();
  });

  test("jumps to a typed page and clamps out-of-range values", async () => {
    const wrapper = mount(AppPagination, {
      props: {
        currentPage: 4,
        pageCount: 12,
      },
    });

    await wrapper.get('[data-testid="pagination-jump-input"]').setValue("8");
    await wrapper.get('[data-testid="pagination-jump-submit"]').trigger("click");
    await wrapper.get('[data-testid="pagination-jump-input"]').setValue("99");
    await wrapper.get('[data-testid="pagination-jump-submit"]').trigger("click");

    expect(wrapper.emitted("change")).toEqual([[8], [12]]);
  });

  test("widens the jump input when the page range has three digits", () => {
    const wrapper = mount(AppPagination, {
      props: {
        currentPage: 100,
        pageCount: 214,
      },
    });

    expect(wrapper.find(".task-list-pagination__page-input--wide").exists()).toBe(true);
    expect(wrapper.get('[data-testid="pagination-jump-input"]').element.value).toBe("100");
  });

  test("submits jump input with Enter and syncs when current page changes", async () => {
    const wrapper = mount(AppPagination, {
      props: {
        currentPage: 4,
        pageCount: 12,
      },
    });

    await wrapper.get('[data-testid="pagination-jump-input"]').setValue("6");
    await wrapper.get('[data-testid="pagination-jump-input"]').trigger("keydown.enter");
    await wrapper.setProps({ currentPage: 7 });

    expect(wrapper.emitted("change")).toEqual([[6]]);
    expect(wrapper.get('[data-testid="pagination-jump-input"]').element.value).toBe("7");
  });

  test("can hide step controls while keeping status and jump controls", () => {
    const wrapper = mount(AppPagination, {
      props: {
        currentPage: 5,
        pageCount: 10,
        showStepControls: false,
      },
    });

    expect(wrapper.find('[data-page="prev"]').exists()).toBe(false);
    expect(wrapper.find('[data-page="next"]').exists()).toBe(false);
    expect(wrapper.text()).toContain("第 5 / 10 页");
    expect(wrapper.find('[data-testid="pagination-jump-input"]').exists()).toBe(true);
  });

  test("can hide jump controls while keeping enlarged terminal step controls available", () => {
    const wrapper = mount(AppPagination, {
      props: {
        currentPage: 2,
        pageCount: 8,
        showJumpControls: false,
      },
    });

    expect(wrapper.find('[data-testid="pagination-jump-input"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="pagination-jump-submit"]').exists()).toBe(false);
    expect(wrapper.get('[data-page="prev"]').attributes("aria-label")).toBe("上一页");
    expect(wrapper.get('[data-page="next"]').attributes("aria-label")).toBe("下一页");
  });
});
