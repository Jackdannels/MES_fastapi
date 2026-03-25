import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const storageState = {};

vi.mock("@/auth", () => ({
  fetchAuthSession: vi.fn(async () => ({
    logged_at: "2026-03-13T00:00:00.000Z",
    module: "central",
    username: "tester",
  })),
  logoutSession: vi.fn(async () => {}),
  readAuthSession: vi.fn(() => ({
    logged_at: "2026-03-13T00:00:00.000Z",
    module: "central",
    username: "tester",
  })),
  resolveModuleHome: (moduleKey) => ({
    central: "/",
    handover: "/handover-system",
    visual: "/visualization",
    staging: "/staging-management",
  })[moduleKey] || "/",
  switchSessionModule: vi.fn(async (moduleKey) => ({ ok: true, module: moduleKey })),
}));

const createStorageStub = () => ({
  getItem: (key) => (Object.prototype.hasOwnProperty.call(storageState, key) ? storageState[key] : null),
  setItem: (key, value) => {
    storageState[key] = String(value);
  },
});

const resetStorage = () => {
  Object.keys(storageState).forEach((key) => {
    delete storageState[key];
  });
};

describe("App task intake entry", () => {
  beforeEach(() => {
    resetStorage();
    vi.stubGlobal("localStorage", createStorageStub());
    vi.stubGlobal("scrollTo", vi.fn());
    window.scrollTo = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          json: async () => ({}),
          ok: false,
        }),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetStorage();
  });

  test("opens the task intake modal after clicking the header new-task entry on /tasks", async () => {
    const [{ default: App }, { default: router }] = await Promise.all([import("./App.vue"), import("@/router")]);

    await router.push("/tasks");
    await router.isReady();

    const wrapper = mount(App, {
      global: {
        plugins: [router],
      },
    });

    await nextTick();
    await nextTick();

    const newTaskButton = wrapper.get('[data-testid="open-task-intake"]');
    await newTaskButton.trigger("click");
    await nextTick();
    await nextTick();

    expect(wrapper.find(".modal.is-open").exists()).toBe(true);
    expect(router.currentRoute.value.path).toBe("/tasks");
  });
});
