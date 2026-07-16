import { afterEach, describe, expect, test, vi } from "vitest";

describe("serverClock", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  test("uses synchronized server time instead of the client wall clock", async () => {
    let monotonicTime = 100;
    vi.stubGlobal("performance", { now: vi.fn(() => monotonicTime) });
    vi.stubGlobal("fetch", vi.fn(async () => {
      monotonicTime = 120;
      return {
        json: async () => ({ epochMs: 1_800_000_000_000, timeZone: "Asia/Shanghai" }),
        ok: true,
      };
    }));
    vi.spyOn(Date, "now").mockReturnValue(1000);

    const { serverNowMs, syncServerClock } = await import("./serverClock");
    await syncServerClock();
    monotonicTime = 170;

    expect(serverNowMs()).toBe(1_800_000_000_060);
  });

  test("falls back to the client clock before the first successful synchronization", async () => {
    vi.spyOn(Date, "now").mockReturnValue(123456);
    const { serverNowMs } = await import("./serverClock");
    expect(serverNowMs()).toBe(123456);
  });
});
