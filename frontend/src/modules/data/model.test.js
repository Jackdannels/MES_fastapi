import { describe, expect, test } from "vitest";

import {
  formatAxisLabel,
  formatExportRange,
  normalizeFailedExportList,
  normalizeTestDataSettings,
} from "./model";

describe("trial data model", () => {
  test("normalizes save settings and failed exports", () => {
    expect(normalizeTestDataSettings({
      defaultPath: "C:\\Desktop\\MES试验数据",
      detail: "目录可写",
      savePath: "D:\\Reports",
      writable: true,
    })).toEqual({
      defaultPath: "C:\\Desktop\\MES试验数据",
      detail: "目录可写",
      savePath: "D:\\Reports",
      writable: true,
    });

    expect(normalizeFailedExportList({
      failedCount: 1,
      items: [{ exportKey: "one", sampleCode: "SP-001", axisCode: "X+" }],
    })).toEqual({
      failedCount: 1,
      items: [expect.objectContaining({ exportKey: "one", sampleCode: "SP-001", axisCode: "X+" })],
    });
  });

  test("formats axis and actual batch time for display", () => {
    expect(formatAxisLabel("X+")).toBe("X+轴向");
    expect(formatAxisLabel("")).toBe("-");
    expect(formatExportRange({
      startedAt: "2026-07-27T09:40:00",
      endedAt: "2026-07-27T10:00:00",
    })).toBe("2026-07-27 09:40 — 2026-07-27 10:00");
  });
});
