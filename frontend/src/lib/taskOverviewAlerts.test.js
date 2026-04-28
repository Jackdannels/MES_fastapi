import { describe, expect, test } from "vitest";

import { findFirstOverdueWaitingTaskCode, hasOverdueWaitingExperiment } from "./taskOverviewAlerts";

describe("taskOverviewAlerts", () => {
  test("returns the lowest overdue waiting task code when multiple tasks are overdue", () => {
    const taskCode = findFirstOverdueWaitingTaskCode(
      [
        { code: "SYLU-2026-03-003", transfer_status: "已入库" },
        { code: "SYLU-2026-03-002", transfer_status: "已入库" },
      ],
      [
        {
          task_code: "SYLU-2026-03-003",
          experiment_code: "SYLU-2026-03-003-B",
          unscheduled_since: "2026-03-10T08:00:00.000Z",
        },
        {
          task_code: "SYLU-2026-03-002",
          experiment_code: "SYLU-2026-03-002-A",
          unscheduled_since: "2026-03-10T08:00:00.000Z",
        },
      ],
      [],
      Date.parse("2026-03-18T12:00:00.000Z"),
    );

    expect(taskCode).toBe("SYLU-2026-03-002");
  });

  test("ignores experiments that already have a formal schedule when computing alert visibility", () => {
    const hasAlert = hasOverdueWaitingExperiment(
      [{ code: "SYLU-2026-03-002", transfer_status: "已入库" }],
      [
        {
          task_code: "SYLU-2026-03-002",
          experiment_code: "SYLU-2026-03-002-A",
          unscheduled_since: "2026-03-10T08:00:00.000Z",
        },
      ],
      [
        {
          task_code: "SYLU-2026-03-002",
          experiment_code: "SYLU-2026-03-002-A",
          device: "冲击一室",
        },
      ],
      Date.parse("2026-03-18T12:00:00.000Z"),
    );

    expect(hasAlert).toBe(false);
  });

  test("ignores returned tasks when checking overdue waiting experiments", () => {
    const now = Date.parse("2026-03-20T10:00:00.000Z");
    const tasks = [{ code: "TASK-RETURNED", transfer_status: "厂家收回", status: "厂家收回" }];
    const experiments = [
      {
        task_code: "TASK-RETURNED",
        experiment_code: "TASK-RETURNED-A",
        unscheduled_since: "2026-03-18T08:00:00.000Z",
      },
    ];

    expect(hasOverdueWaitingExperiment(tasks, experiments, [], now)).toBe(false);
    expect(findFirstOverdueWaitingTaskCode(tasks, experiments, [], now)).toBe("");
  });
});
