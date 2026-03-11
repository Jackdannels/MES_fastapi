import { describe, expect, test } from "vitest";

import { buildApiUrl, normalizeApiBaseUrl, resolveBackendTarget } from "./apiBase.js";

describe("apiBase", () => {
  test("normalizes configured API base URLs", () => {
    expect(normalizeApiBaseUrl(" http://127.0.0.1:8000/ ")).toBe("http://127.0.0.1:8000");
    expect(normalizeApiBaseUrl("")).toBe("");
  });

  test("builds relative paths when no explicit API base is configured", () => {
    expect(buildApiUrl("/auth/session", "")).toBe("/auth/session");
  });

  test("builds absolute API URLs when an explicit API base is configured", () => {
    expect(buildApiUrl("/auth/session", "http://127.0.0.1:8000/")).toBe("http://127.0.0.1:8000/auth/session");
  });

  test("falls back to the local backend target for the dev proxy", () => {
    expect(resolveBackendTarget("")).toBe("http://127.0.0.1:8000");
    expect(resolveBackendTarget("http://192.168.1.20:9000/")).toBe("http://192.168.1.20:9000");
  });
});
