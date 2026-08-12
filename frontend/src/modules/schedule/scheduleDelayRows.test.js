import { describe, expect, test } from "vitest";

import { buildScheduleRows } from "./model";

describe("buildScheduleRows automatic delay presentation", () => {
  test("uses effective times as primary values and retains the original window for audit display", () => {
    const [row] = buildScheduleRows({
      experiments: [],
      schedules: [{
        id: "schedule-delayed",
        task_code: "TASK-001",
        experiment_code: "EXP-001",
        device: "盐雾试验室",
        start_at: "2026-08-10T03:30:00",
        end_at: "2026-08-10T04:30:00",
        original_start_at: "2026-08-10T02:40:00",
        original_end_at: "2026-08-10T03:40:00",
        delay_minutes: 50,
        delay_reason: "前序实验超时",
      }],
      tasks: [],
      now: new Date("2026-08-10T00:00:00"),
    });

    expect(row).toEqual(expect.objectContaining({
      delayBadgeLabel: "自动顺延 50 分钟",
      delayMinutes: 50,
      delayReason: "前序实验超时",
      endAt: "2026-08-10 04:30",
      scheduleHasDelayConflict: false,
      scheduleIsDelayed: true,
      startAt: "2026-08-10 03:30",
    }));
    expect(row.delay).toEqual(expect.objectContaining({
      originalEndAt: "2026-08-10 03:40",
      originalStartAt: "2026-08-10 02:40",
    }));
  });
});
