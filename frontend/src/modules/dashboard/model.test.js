import { describe, expect, test } from "vitest";

import { buildDashboardViewModel } from "./model";

describe("dashboard model", () => {
  test("treats retention-only schedules as unscheduled and counts them in the staging note", () => {
    const viewModel = buildDashboardViewModel({
      tasks: [
        {
          code: "SYLU-2026-04-105",
          source: "外部委托",
          status: "待排程",
        },
      ],
      schedules: [
        {
          id: "schedule-retention-1",
          task_code: "SYLU-2026-04-105",
          device: "恒温恒湿间（暂存间）",
          start_at: "2026-03-11T09:31:00.000Z",
          end_at: "2026-03-17T09:31:00.000Z",
          status: "厂家收回",
        },
      ],
      devices: [],
      streams: [],
      now: Date.parse("2026-03-17T10:00:00.000Z"),
    });

    expect(viewModel.summaryCards.scheduledCount).toBe(0);
    expect(viewModel.summaryCards.unscheduledCount).toBe("1（暂存间存放1）");
    expect(viewModel.taskRows[0]).toEqual(
      expect.objectContaining({
        code: "SYLU-2026-04-105",
        status: "待排程",
      }),
    );
  });

  test("keeps retention-device tasks unscheduled even when the stored task status is stale", () => {
    const viewModel = buildDashboardViewModel({
      tasks: [
        {
          code: "SYLU-2026-04-107",
          source: "外部委托",
          status: "厂家收回",
        },
      ],
      schedules: [
        {
          id: "schedule-retention-1",
          task_code: "SYLU-2026-04-107",
          device: "恒温恒湿间（暂存间）",
          start_at: "2026-03-11T06:45:13.827Z",
          end_at: "2026-03-11T06:45:13.827Z",
          status: "已排程",
        },
      ],
      devices: [],
      streams: [],
      now: Date.parse("2026-03-17T10:00:00.000Z"),
    });

    expect(viewModel.summaryCards.scheduledCount).toBe(0);
    expect(viewModel.summaryCards.unscheduledCount).toBe("1（暂存间存放1）");
    expect(viewModel.taskRows[0]).toEqual(
      expect.objectContaining({
        code: "SYLU-2026-04-107",
        status: "待排程",
      }),
    );
  });

  test("keeps manufacturer-returned tasks out of the unscheduled waiting count when no staging schedule exists", () => {
    const viewModel = buildDashboardViewModel({
      tasks: [
        {
          code: "ICP-2026-001",
          source: "外部委托",
          status: "厂家收回",
        },
      ],
      schedules: [],
      devices: [],
      streams: [],
      now: Date.parse("2026-03-17T10:00:00.000Z"),
    });

    expect(viewModel.summaryCards.unscheduledCount).toBe("0（暂存间存放0）");
    expect(viewModel.taskRows[0]).toEqual(
      expect.objectContaining({
        code: "ICP-2026-001",
        status: "厂家收回",
      }),
    );
  });
});


