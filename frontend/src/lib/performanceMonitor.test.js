import { beforeEach, describe, expect, test, vi } from "vitest";

import {
  getPerformanceEntries,
  recordPerformanceMetric,
  resetPerformanceEntries,
  startFrontendPerformanceMonitoring,
} from "./performanceMonitor.js";


describe("performanceMonitor", () => {
  beforeEach(() => {
    globalThis.__MES_PERFORMANCE_ENABLED__ = true;
    resetPerformanceEntries();
    vi.unstubAllGlobals();
  });

  test("stores sanitized performance entries for browser inspection", () => {
    recordPerformanceMetric("storage.snapshot-json-parse", 12.3456, {
      category: "json",
      nested: { secret: "not-recorded" },
      requestId: "request-1",
    });

    expect(getPerformanceEntries()).toEqual([
      expect.objectContaining({
        name: "storage.snapshot-json-parse",
        durationMs: 12.3456,
        category: "json",
        requestId: "request-1",
      }),
    ]);
    expect(getPerformanceEntries()[0]).not.toHaveProperty("nested");
  });

  test("records long tasks and API resource timings when supported", () => {
    const observers = [];
    class MockPerformanceObserver {
      constructor(callback) {
        this.callback = callback;
        this.disconnect = vi.fn();
        observers.push(this);
      }

      observe(options) {
        this.type = options.type;
      }
    }
    vi.stubGlobal("PerformanceObserver", MockPerformanceObserver);

    const stop = startFrontendPerformanceMonitoring();
    observers.find((observer) => observer.type === "longtask").callback({
      getEntries: () => [{ duration: 75, startTime: 10 }],
    });
    observers.find((observer) => observer.type === "resource").callback({
      getEntries: () => [{
        name: "http://localhost/api/storage?keys=mes.samples",
        initiatorType: "fetch",
        duration: 120,
        transferSize: 500,
        encodedBodySize: 400,
        decodedBodySize: 1000,
      }],
    });

    expect(getPerformanceEntries()).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "browser.longtask", durationMs: 75 }),
      expect.objectContaining({ name: "browser.api-resource", path: "/api/storage", durationMs: 120 }),
    ]));
    stop();
    expect(observers.every((observer) => observer.disconnect.mock.calls.length === 1)).toBe(true);
  });
});
