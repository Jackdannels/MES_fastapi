import { mount } from "@vue/test-utils";
import { computed, defineComponent, reactive } from "vue";
import { afterEach, describe, expect, test, vi } from "vitest";

import { useTerminalPresence } from "./useTerminalPresence";

const { readAuthSession, reportTerminalPage } = vi.hoisted(() => ({
  readAuthSession: vi.fn(),
  reportTerminalPage: vi.fn(),
}));

vi.mock("@/auth", () => ({ readAuthSession }));
vi.mock("@/lib/terminalControlApi", () => ({ reportTerminalPage }));

const flushPromises = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe("useTerminalPresence", () => {
  let wrapper;

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  test("reports the exact route and title for a fixed terminal and follows navigation", async () => {
    readAuthSession.mockReturnValue({ terminal_auth: true });
    reportTerminalPage.mockResolvedValue({ ok: true });
    const route = reactive({ fullPath: "/laboratory?lab=冲击二室", path: "/laboratory" });
    const Host = defineComponent({
      setup() {
        useTerminalPresence({ pageTitle: computed(() => "冲击二室操作台"), route });
        return () => null;
      },
    });

    wrapper = mount(Host);
    await flushPromises();
    expect(reportTerminalPage).toHaveBeenCalledWith("/laboratory?lab=冲击二室", "冲击二室操作台");

    route.fullPath = "/laboratory?lab=冲击二室&tab=history";
    await flushPromises();
    expect(reportTerminalPage).toHaveBeenLastCalledWith(
      "/laboratory?lab=冲击二室&tab=history",
      "冲击二室操作台",
    );
  });

  test("does not report ordinary central-management sessions", async () => {
    readAuthSession.mockReturnValue({ module: "central" });
    const route = reactive({ fullPath: "/system", path: "/system" });
    const Host = defineComponent({
      setup() {
        useTerminalPresence({ pageTitle: computed(() => "人员信息"), route });
        return () => null;
      },
    });

    wrapper = mount(Host);
    await flushPromises();
    expect(reportTerminalPage).not.toHaveBeenCalled();
  });
});
