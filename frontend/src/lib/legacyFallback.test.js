import { afterEach, beforeEach, describe, expect, test } from "vitest";

import {
  getLegacyFallbackHits,
  legacyFallbackHitCount,
  recordLegacyFallbackHit,
  resetLegacyFallbackHits,
} from "./legacyFallback";

describe("legacyFallback", () => {
  beforeEach(() => {
    resetLegacyFallbackHits();
  });

  afterEach(() => {
    resetLegacyFallbackHits();
  });

  test("records fallback hits without changing caller behavior", () => {
    const first = recordLegacyFallbackHit("samples.flow.sample_status_fallback", { reason: "missing_tray_status", taskCode: "TASK-001" });
    const second = recordLegacyFallbackHit("samples.flow.sample_status_fallback", { reason: "missing_tray_status", taskCode: "TASK-002" });

    expect(first).toEqual(expect.objectContaining({ count: 1, id: "samples.flow.sample_status_fallback" }));
    expect(second).toEqual(expect.objectContaining({ count: 2, id: "samples.flow.sample_status_fallback" }));
    expect(legacyFallbackHitCount("samples.flow.sample_status_fallback")).toBe(2);
    expect(getLegacyFallbackHits()).toEqual([
      expect.objectContaining({
        count: 2,
        id: "samples.flow.sample_status_fallback",
        lastDetail: { reason: "missing_tray_status" },
      }),
    ]);
  });

  test("ignores empty fallback ids", () => {
    expect(recordLegacyFallbackHit("")).toBeNull();
    expect(getLegacyFallbackHits()).toEqual([]);
  });
});
