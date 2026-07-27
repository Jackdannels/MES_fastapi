import { afterEach, describe, expect, test, vi } from "vitest";

import {
  listFailedTestDataExports,
  readTestDataSettings,
  retryFailedTestDataExports,
  updateTestDataSettings,
} from "./testDataApi";

describe("testDataApi", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("reads and updates the PDF save directory", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ savePath: "C:\\MES试验数据", writable: true }),
    }));

    await readTestDataSettings();
    await updateTestDataSettings(" C:\\MES试验数据 ");

    expect(fetch).toHaveBeenNthCalledWith(1, "/api/test-data/settings", {
      headers: { Accept: "application/json" },
      credentials: "include",
    });
    expect(fetch).toHaveBeenNthCalledWith(2, "/api/test-data/settings", {
      method: "PUT",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      credentials: "include",
      body: JSON.stringify({ savePath: "C:\\MES试验数据" }),
    });
  });

  test("lists failures and retries selected or all exports", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [], failedCount: 0 }),
    }));

    await listFailedTestDataExports();
    await retryFailedTestDataExports(["export:1"]);
    await retryFailedTestDataExports();

    expect(fetch).toHaveBeenNthCalledWith(1, "/api/test-data/exports?status=failed", {
      headers: { Accept: "application/json" },
      credentials: "include",
    });
    expect(fetch).toHaveBeenNthCalledWith(2, "/api/test-data/retry-failed", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ exportKeys: ["export:1"] }),
    }));
    expect(fetch).toHaveBeenNthCalledWith(3, "/api/test-data/retry-failed", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({}),
    }));
  });

  test("surfaces backend validation details", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ detail: "保存目录不可写" }),
    }));

    await expect(updateTestDataSettings("Z:\\invalid")).rejects.toThrow("保存地址检测失败：保存目录不可写");
  });
});
