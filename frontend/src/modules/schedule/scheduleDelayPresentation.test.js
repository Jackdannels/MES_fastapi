import { describe, expect, test } from "vitest";

import { resolveScheduleDelayPresentation } from "./scheduleDelayPresentation";

describe("resolveScheduleDelayPresentation", () => {
  test("keeps legacy schedules free from automatic-delay decoration", () => {
    expect(resolveScheduleDelayPresentation({
      start_at: "2026-08-10T01:30:00",
      end_at: "2026-08-10T02:30:00",
    })).toEqual(expect.objectContaining({
      badgeLabel: "",
      delayMinutes: 0,
      hasConflict: false,
      isDelayed: false,
      originalWindowLabel: "",
    }));
  });

  test("calculates delay from the original and effective schedule windows", () => {
    const result = resolveScheduleDelayPresentation({
      start_at: "2026-08-10T03:30:00",
      end_at: "2026-08-10T04:30:00",
      original_start_at: "2026-08-10T02:40:00",
      original_end_at: "2026-08-10T03:40:00",
      delay_reason: "前序实验超时",
      delay_source_run_no: "run-001",
    });

    expect(result).toEqual(expect.objectContaining({
      badgeLabel: "自动顺延 50 分钟",
      delayMinutes: 50,
      hasConflict: false,
      isDelayed: true,
      reason: "前序实验超时",
      sourceRunNo: "run-001",
    }));
    expect(result.originalWindowLabel).toContain("2026-08-10 02:40");
    expect(result.title).toContain("原因：前序实验超时");
    expect(result.title).toContain("来源运行：run-001");
  });

  test("accepts nested metadata and exposes manual-conflict state", () => {
    expect(resolveScheduleDelayPresentation({
      start_at: "2026-08-10T03:30:00",
      end_at: "2026-08-10T04:30:00",
      delay_metadata: {
        adjustment_status: "pending_manual",
        delay_minutes: 50,
        original_start_at: "2026-08-10T02:40:00",
        original_end_at: "2026-08-10T03:40:00",
      },
    })).toEqual(expect.objectContaining({
      adjustmentStatus: "pending_manual",
      badgeLabel: "顺延冲突",
      delayMinutes: 50,
      hasConflict: true,
      isDelayed: true,
    }));
  });

  test("does not treat serialized false flags as delayed", () => {
    expect(resolveScheduleDelayPresentation({
      start_at: "2026-08-10T01:30:00",
      end_at: "2026-08-10T02:30:00",
      auto_delayed: "false",
      delay_conflict: "false",
    }).isDelayed).toBe(false);
  });

  test("presents an expired schedule waiting on an active run without inventing a new time", () => {
    expect(resolveScheduleDelayPresentation({
      start_at: "2026-08-10T01:30:00",
      end_at: "2026-08-10T02:30:00",
      delay_reason: "受前序实验超时影响，等待预计结束",
      original_start_at: "2026-08-10T01:30:00",
      original_end_at: "2026-08-10T02:30:00",
      source_run_no: "run-blocking-001",
    })).toEqual(expect.objectContaining({
      badgeLabel: "等待前序结束",
      delayMinutes: 0,
      isDelayed: true,
      isWaitingForActiveRun: true,
      originalWindowLabel: "",
    }));
  });
});
