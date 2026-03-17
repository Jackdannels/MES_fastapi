import { describe, expect, test } from "vitest";

import { buildTaskMetrics, buildTaskRows } from "./model";

describe("tasks model", () => {
  test("treats retention-only schedules as unscheduled and includes them in the retention count", () => {
    const rows = buildTaskRows(
      [
        {
          id: "task-1",
          code: "GDW-2024-005",
          name: "高低温湿热试验",
          source: "外部委托",
          status: "待排程",
          test_type: "高低温湿热试验",
        },
      ],
      [
        {
          id: "schedule-retention-1",
          task_code: "GDW-2024-005",
          device: "恒温恒湿间（暂存间）",
          start_at: "2026-03-11T09:31:00.000Z",
          end_at: "2026-03-17T09:31:00.000Z",
          status: "暂存间存放",
        },
      ],
      Date.parse("2026-03-17T10:00:00.000Z"),
    );

    expect(rows[0]).toEqual(
      expect.objectContaining({
        code: "GDW-2024-005",
        displayStatus: "暂存间存放",
      }),
    );

    expect(buildTaskMetrics(rows)).toEqual(
      expect.objectContaining({
        retentionCount: 1,
        unscheduledCount: 1,
        unscheduledLabel: "1（暂存间存放1）",
      }),
    );
  });

  test("treats retention devices as retention even when the stored schedule status is stale", () => {
    const rows = buildTaskRows(
      [
        {
          id: "task-1",
          code: "WDC-2026-001",
          name: "温度冲击试验",
          source: "外部委托",
          status: "暂存间存放",
          test_type: "温度冲击试验",
        },
      ],
      [
        {
          id: "schedule-retention-1",
          task_code: "WDC-2026-001",
          device: "恒温恒湿间（暂存间）",
          start_at: "2026-03-11T06:45:13.827Z",
          end_at: "2026-03-11T06:45:13.827Z",
          status: "已排程",
        },
      ],
      Date.parse("2026-03-17T10:00:00.000Z"),
    );

    expect(rows[0]).toEqual(
      expect.objectContaining({
        code: "WDC-2026-001",
        displayStatus: "暂存间存放",
      }),
    );

    expect(buildTaskMetrics(rows)).toEqual(
      expect.objectContaining({
        retentionCount: 1,
        unscheduledCount: 1,
        unscheduledLabel: "1（暂存间存放1）",
      }),
    );
  });
});
