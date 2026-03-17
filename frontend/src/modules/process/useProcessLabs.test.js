import { describe, expect, test, vi } from "vitest";

import { useProcessLabs } from "./useProcessLabs";

describe("useProcessLabs", () => {
  test("loads lab cards and opens task detail drawer in place", async () => {
    const loadSnapshot = vi.fn(async () => ({
      "mes.schedules": [
        {
          device: "Lab-A",
          end_at: "2026-03-10T10:30:00Z",
          start_at: "2026-03-10T09:30:00Z",
          task_code: "TASK-001",
        },
        {
          device: "Lab-B",
          end_at: "2026-03-10T13:00:00Z",
          start_at: "2026-03-10T12:00:00Z",
          task_code: "TASK-002",
        },
      ],
      "mes.tasks": [
        {
          code: "TASK-001",
          name: "Impact Campaign Batch A",
          priority: "High",
          required_device: "Rig-A",
          sample_count: 12,
          source: "External",
          status: "Running",
          test_type: "Impact Test",
        },
        {
          code: "TASK-002",
          test_type: "Vibration Test",
        },
      ],
      "mes.samples": [
        {
          code: "S-001",
          task_code: "TASK-001",
          trays: [{ tray_code: "TRAY-001", quantity: 1 }],
        },
        {
          code: "S-002",
          task_code: "TASK-001",
          trays: [
            { tray_code: "TRAY-002", quantity: 1 },
            { tray_code: "TRAY-003", quantity: 1 },
            { tray_code: "TRAY-004", quantity: 1 },
          ],
        },
      ],
    }));
    const navigate = vi.fn();
    const {
      idleCount,
      labCards,
      loadLabStatus,
      loading,
      openTaskOverview,
      runningCount,
      scheduledCount,
      selectedTaskDetail,
      taskDrawerOpen,
      closeTaskDrawer,
    } = useProcessLabs({
      autoLoad: false,
      labs: [
        { name: "Lab-A", testType: "Impact Test" },
        { name: "Lab-B", testType: "Vibration Test" },
        { name: "Lab-C", testType: "Salt Spray Test" },
      ],
      loadSnapshot,
      navigate,
      now: Date.parse("2026-03-10T10:00:00Z"),
    });

    await loadLabStatus();

    expect(loadSnapshot).toHaveBeenCalledTimes(1);
    expect(loading.value).toBe(false);
    expect(labCards.value).toHaveLength(2);
    expect(runningCount.value).toBe(1);
    expect(scheduledCount.value).toBe(1);
    expect(idleCount.value).toBe(0);

    openTaskOverview(labCards.value[0]);

    expect(navigate).not.toHaveBeenCalled();
    expect(taskDrawerOpen.value).toBe(true);
    expect(selectedTaskDetail.value).toMatchObject({
      code: "TASK-001",
      name: "Impact Campaign Batch A",
      displayName: "Impact Campaign",
      priority: "High",
      requiredDevice: "Rig-A",
      sampleCount: 12,
      source: "External",
      status: "Running",
      testType: "Impact Test",
      trayCount: 4,
      traySummary: "TRAY-001, TRAY-002, TRAY-003 +1",
    });
    expect(selectedTaskDetail.value.trayCodes).toEqual(["TRAY-001", "TRAY-002", "TRAY-003", "TRAY-004"]);

    closeTaskDrawer();

    expect(taskDrawerOpen.value).toBe(false);
    expect(selectedTaskDetail.value).toBe(null);
  });
});
