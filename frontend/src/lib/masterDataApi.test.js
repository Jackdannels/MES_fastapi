import { beforeEach, describe, expect, test, vi } from "vitest";

import { buildApiUrl, getFrontendApiBaseUrl } from "./apiBase.js";
import { readMasterLabs, readMasterTestTypes } from "./masterDataApi";

const MASTER_TEST_TYPES_ENDPOINT = buildApiUrl("/api/master/test-types", getFrontendApiBaseUrl());
const MASTER_LABS_ENDPOINT = buildApiUrl("/api/master/labs", getFrontendApiBaseUrl());

describe("masterDataApi", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  test("reads enabled test type master data", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ code: "YW", name: "盐雾试验" }],
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(readMasterTestTypes()).resolves.toEqual([{ code: "YW", name: "盐雾试验" }]);
    expect(fetchMock).toHaveBeenCalledWith(
      MASTER_TEST_TYPES_ENDPOINT,
      expect.objectContaining({
        credentials: "include",
      }),
    );
  });

  test("reads lab master data with linked test type", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ code: "LAB_SALT", name: "盐雾试验室", testTypeName: "盐雾试验" }],
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(readMasterLabs()).resolves.toEqual([
      { code: "LAB_SALT", name: "盐雾试验室", testTypeName: "盐雾试验" },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      MASTER_LABS_ENDPOINT,
      expect.objectContaining({
        credentials: "include",
      }),
    );
  });

  test("rejects when master data endpoint fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Server Error",
      }),
    );

    await expect(readMasterTestTypes()).rejects.toThrow("Failed to read master test types: 500 Server Error");
  });

  test("rejects when master labs endpoint fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Server Error",
      }),
    );

    await expect(readMasterLabs()).rejects.toThrow("Failed to read master labs: 500 Server Error");
  });

  test("normalizes non-array endpoint payloads to an empty list", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ rows: [{ name: "盐雾试验" }] }),
      }),
    );

    await expect(readMasterTestTypes()).resolves.toEqual([]);
  });

  test("normalizes non-array lab endpoint payloads to an empty list", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ rows: [{ name: "盐雾试验室" }] }),
      }),
    );

    await expect(readMasterLabs()).resolves.toEqual([]);
  });
});
