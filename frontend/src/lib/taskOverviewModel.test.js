import { describe, expect, test } from "vitest";

import { buildTaskRows, buildTrayOverviewRows } from "./taskOverviewModel";

describe("taskOverviewModel", () => {
  test("buildTaskRows aggregates tasks, samples, trays, and schedules", () => {
    const rows = buildTaskRows({
      tasks: [
        {
          code: "TASK-2",
          test_type: "Shock",
          status: "Queued",
          sample_count: 2,
          created_at: "2026-03-10T08:00:00Z",
        },
      ],
      samples: [
        {
          task_code: "TASK-2",
          code: "S-002",
          trays: [
            { tray_code: "TRAY-02", quantity: 2 },
            { tray_code: "TRAY-02", quantity: 1 },
          ],
        },
        {
          task_code: "TASK-2",
          code: "S-001",
          trays: [{ tray_code: "TRAY-01", quantity: 1 }],
        },
      ],
      schedules: [
        { task_code: "TASK-2", status: "Running", start_at: "2026-03-10T09:00:00Z" },
        { task_code: "TASK-2", status: "Running", start_at: "2026-03-10T10:00:00Z" },
      ],
      scheduledLabel: "Scheduled",
      unscheduledLabel: "Unscheduled",
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      taskCode: "TASK-2",
      taskType: "Shock",
      currentStatus: "Queued",
      scheduleLabel: "Scheduled",
      sampleCount: 2,
      scheduleCount: 2,
    });
    expect(rows[0].sampleCodes).toEqual(["S-001", "S-002"]);
    expect(rows[0].trays).toEqual([
      { trayCode: "TRAY-01", sampleCodes: ["S-001"], totalQuantity: 1 },
      { trayCode: "TRAY-02", sampleCodes: ["S-002"], totalQuantity: 3 },
    ]);
  });

  test("buildTrayOverviewRows fills empty tray slots and uses latest schedule device", () => {
    const rows = buildTrayOverviewRows({
      tasks: [{ code: "TASK-1", test_type: "Thermal" }],
      samples: [
        {
          task_code: "TASK-1",
          trays: [{ tray_code: "TRAY-A" }],
        },
      ],
      schedules: [
        { task_code: "TASK-1", device: "Lab-1", start_at: "2026-03-10T08:00:00Z" },
        { task_code: "TASK-1", device: "Lab-2", start_at: "2026-03-10T09:00:00Z" },
      ],
      totalSlots: 3,
      scheduledLabel: "Scheduled",
      unscheduledLabel: "Unscheduled",
      unassignedExperimentLabel: "Unassigned",
    });

    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      slotCode: "TP-001",
      trayCode: "TRAY-A",
      taskCode: "TASK-1",
      targetExperiment: "Thermal",
      scheduleStatus: "Scheduled",
      lab: "Lab-2",
    });
    expect(rows[1]).toMatchObject({
      slotCode: "TP-002",
      trayCode: "TP-002",
      taskCode: "-",
      targetExperiment: "Unassigned",
      scheduleStatus: "Unscheduled",
    });
  });
});
