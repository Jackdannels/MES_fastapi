import { describe, expect, test, vi } from "vitest";

import { useProcessLabs } from "./useProcessLabs";

describe("useProcessLabs", () => {
  test("loads lab cards and exposes summary counts", async () => {
    const loadSnapshot = vi.fn(async () => ({
      "mes.schedules": [
        {
          device: "冲击一室",
          end_at: "2026-03-10T10:30:00Z",
          start_at: "2026-03-10T09:30:00Z",
          task_code: "TASK-001",
        },
        {
          device: "振动一室",
          end_at: "2026-03-10T13:00:00Z",
          start_at: "2026-03-10T12:00:00Z",
          task_code: "TASK-002",
        },
      ],
      "mes.tasks": [
        { code: "TASK-001", test_type: "冲击试验" },
        { code: "TASK-002", test_type: "振动试验" },
      ],
    }));
    const navigate = vi.fn();
    const { idleCount, labCards, loadLabStatus, loading, openTaskOverview, runningCount, scheduledCount } = useProcessLabs({
      autoLoad: false,
      labs: [
        { name: "冲击一室", testType: "冲击试验" },
        { name: "振动一室", testType: "振动试验" },
        { name: "盐雾试验室", testType: "盐雾试验" },
      ],
      loadSnapshot,
      navigate,
      now: Date.parse("2026-03-10T10:00:00Z"),
    });

    await loadLabStatus();

    expect(loadSnapshot).toHaveBeenCalledTimes(1);
    expect(loading.value).toBe(false);
    expect(labCards.value).toHaveLength(3);
    expect(runningCount.value).toBe(1);
    expect(scheduledCount.value).toBe(1);
    expect(idleCount.value).toBe(1);

    openTaskOverview({ taskCode: " TASK-001 ", testType: " 冲击试验 " });

    expect(navigate).toHaveBeenCalledWith("/task-overview?testType=%E5%86%B2%E5%87%BB%E8%AF%95%E9%AA%8C&task=TASK-001");
  });
});
