import { describe, expect, test } from "vitest";

import { findFirstOverdueWaitingTaskCode, hasOverdueWaitingExperiment } from "./taskOverviewAlerts";

describe("taskOverviewAlerts", () => {
  test("returns the lowest overdue waiting task code when multiple tasks are overdue", () => {
    const taskCode = findFirstOverdueWaitingTaskCode(
      [
        { code: "SYLU-2026-03-003", transfer_status: "到货" },
        { code: "SYLU-2026-03-002", transfer_status: "到货" },
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
      [
        { task_code: "SYLU-2026-03-003", history: [{ action: "任务已确认入库", time: "2026-03-10T08:00:00.000Z" }] },
        { task_code: "SYLU-2026-03-002", history: [{ action: "任务已确认入库", time: "2026-03-10T08:00:00.000Z" }] },
      ],
    );

    expect(taskCode).toBe("SYLU-2026-03-002");
  });

  test("ignores experiments that already have a formal schedule when computing alert visibility", () => {
    const hasAlert = hasOverdueWaitingExperiment(
      [{ code: "SYLU-2026-03-002", transfer_status: "到货" }],
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

  test("ignores legacy stored status when checking overdue waiting experiments", () => {
    const now = Date.parse("2026-03-20T10:00:00.000Z");
    const tasks = [{ code: "TASK-LEGACY-STORED", status: "待排程", transfer_status: "已入库" }];
    const experiments = [
      {
        task_code: "TASK-LEGACY-STORED",
        experiment_code: "TASK-LEGACY-STORED-A",
        unscheduled_since: "2026-03-18T08:00:00.000Z",
      },
    ];

    expect(hasOverdueWaitingExperiment(tasks, experiments, [], now)).toBe(false);
    expect(findFirstOverdueWaitingTaskCode(tasks, experiments, [], now)).toBe("");
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

  test("ignores completed returned tasks that retain transfer confirmation history", () => {
    const now = Date.parse("2026-08-15T10:00:00.000Z");
    const tasks = [
      {
        code: "SYLU-2026-08-001",
        status: "任务已完成",
        transfer_status: "厂家收回",
      },
    ];
    const experiments = [
      {
        task_code: "SYLU-2026-08-001",
        experiment_code: "SYLU-2026-08-001-A",
        status: "实验已完成",
      },
    ];
    const samples = [
      {
        task_code: "SYLU-2026-08-001",
        history: [{ action: "任务已确认入库", time: "2026-08-13T00:32:23.000Z" }],
        status: "厂家收回",
        trays: [{ tray_code: "SYLU-2026-08-001-TP-001", status: "厂家收回" }],
      },
    ];

    expect(hasOverdueWaitingExperiment(tasks, experiments, [], now, samples)).toBe(false);
    expect(findFirstOverdueWaitingTaskCode(tasks, experiments, [], now, samples)).toBe("");
  });

  test("uses arrived sample state as fallback when task transfer status is missing", () => {
    const now = Date.parse("2026-03-20T10:00:00.000Z");
    const tasks = [{ code: "TASK-ARRIVED", status: "待排程" }];
    const experiments = [
      {
        task_code: "TASK-ARRIVED",
        experiment_code: "TASK-ARRIVED-A",
        unscheduled_since: "2026-03-18T08:00:00.000Z",
      },
    ];
    const samples = [
      {
        task_code: "TASK-ARRIVED",
        history: [{ action: "任务已确认入库", time: "2026-03-18T08:00:00.000Z" }],
        status: "到货",
        trays: [{ tray_code: "TASK-ARRIVED-TP-001", status: "到货" }],
      },
    ];

    expect(hasOverdueWaitingExperiment(tasks, experiments, [], now, samples)).toBe(true);
    expect(findFirstOverdueWaitingTaskCode(tasks, experiments, [], now, samples)).toBe("TASK-ARRIVED");
  });

  test("computes overdue waiting experiments from transfer confirmation history", () => {
    const now = Date.parse("2026-03-20T10:00:00.000Z");
    const tasks = [{ code: "TASK-CONFIRMED", status: "待排程", transfer_status: "到货" }];
    const experiments = [
      {
        task_code: "TASK-CONFIRMED",
        experiment_code: "TASK-CONFIRMED-A",
        unscheduled_since: "2026-03-20T09:30:00.000Z",
      },
    ];
    const samples = [
      {
        task_code: "TASK-CONFIRMED",
        history: [{ action: "任务已确认入库", time: "2026-03-18T08:00:00.000Z" }],
        status: "到货",
        trays: [{ tray_code: "TASK-CONFIRMED-TP-001", status: "到货" }],
      },
    ];

    expect(hasOverdueWaitingExperiment(tasks, experiments, [], now, samples)).toBe(true);
    expect(findFirstOverdueWaitingTaskCode(tasks, experiments, [], now, samples)).toBe("TASK-CONFIRMED");
  });

  test("treats transfer confirmation history as arrived evidence when status fields are stale", () => {
    const now = Date.parse("2026-03-20T10:00:00.000Z");
    const tasks = [{ code: "TASK-STALE", status: "待排程", transfer_status: "未入库" }];
    const experiments = [
      {
        task_code: "TASK-STALE",
        experiment_code: "TASK-STALE-A",
      },
    ];
    const samples = [
      {
        task_code: "TASK-STALE",
        history: [{ action: "任务已确认入库", time: "2026-03-18T08:00:00.000Z" }],
        status: "运输中",
        trays: [{ tray_code: "TASK-STALE-TP-001", status: "运输中" }],
      },
    ];

    expect(hasOverdueWaitingExperiment(tasks, experiments, [], now, samples)).toBe(true);
    expect(findFirstOverdueWaitingTaskCode(tasks, experiments, [], now, samples)).toBe("TASK-STALE");
  });
});
