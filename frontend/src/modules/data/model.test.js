import { describe, expect, test } from "vitest";

import {
  formatAxisLabel,
  formatExperimentStatus,
  formatExportRange,
  normalizeFailedExportList,
  normalizeTaskOutputList,
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

  test("normalizes experiment completion progress separately from PDF health", () => {
    expect(normalizeTaskOutputList({
      page: 1,
      pageSize: 20,
      total: 1,
      items: [{
        taskCode: "TASK-001",
        totalExperimentCount: 4,
        completedExperimentCount: 2,
        successfulPdfCount: 8,
        missingPdfCount: 1,
        failedPdfCount: 1,
        folderAvailable: true,
        experiments: [{
          experimentCode: "VIBRATION",
          experimentName: "振动试验",
          status: "completed",
          successfulPdfCount: 8,
          folderAvailable: true,
        }],
      }],
    })).toEqual(expect.objectContaining({
      total: 1,
      items: [expect.objectContaining({
        taskCode: "TASK-001",
        completedExperimentCount: 2,
        totalExperimentCount: 4,
        progressPercent: 50,
        successfulPdfCount: 8,
        missingPdfCount: 1,
        failedPdfCount: 1,
        canOpen: true,
        canShare: true,
        experiments: [expect.objectContaining({ canOpen: true, canShare: true, pdfCount: 8 })],
      })],
    }));
    expect(formatExperimentStatus("in_progress")).toBe("进行中");

    const withoutDownload = normalizeTaskOutputList({
      items: [{
        taskCode: "TASK-002",
        experiments: [{
          experimentCode: "SALT",
          status: "实验进行中",
          folderAvailable: true,
          successfulPdfCount: 0,
        }],
      }],
    }).items[0].experiments[0];
    expect(withoutDownload).toEqual(expect.objectContaining({
      canOpen: true,
      canShare: false,
      status: "in_progress",
    }));
  });
});
