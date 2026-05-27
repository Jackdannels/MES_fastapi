import { describe, expect, test } from "vitest";

import {
  buildDeviceMetrics,
  buildDeviceRows,
  buildMaintenancePlanForm,
  resolveMaintenanceScheduleImpact,
} from "./model";

describe("devices model", () => {
  test("keeps a scheduled device available until its experiment has actually started", () => {
    const rows = buildDeviceRows(
      [{ code: "盐雾试验室", name: "盐雾试验室", status: "可用" }],
      [
        {
          device: "盐雾试验室",
          end_at: "2026-04-24T12:00:00",
          experiment_code: "SYLU-2026-03-002-A",
          start_at: "2026-04-24T09:00:00",
          task_code: "SYLU-2026-03-002",
        },
      ],
      new Date("2026-04-24T10:00:00"),
      [
        {
          code: "SYLU-2026-03-002-SP-001",
          location: "盐雾试验室",
          status: "实验准备就绪",
          task_code: "SYLU-2026-03-002",
          trays: [{ tray_code: "SYLU-2026-03-002-TP-001", status: "实验准备就绪", quantity: 1 }],
        },
      ],
      [
        {
          experiment_code: "SYLU-2026-03-002-A",
          task_code: "SYLU-2026-03-002",
          tray_code: "SYLU-2026-03-002-TP-001",
        },
      ],
    );

    expect(rows[0]).toEqual(expect.objectContaining({ status: "可用", statusClass: "status" }));
    expect(buildDeviceMetrics(rows)).toEqual(expect.objectContaining({ activeCount: 0, idleCount: 1 }));
  });

  test("marks a device active only when a scheduled tray is running in that device lab", () => {
    const rows = buildDeviceRows(
      [{ code: "盐雾试验室", name: "盐雾试验室", status: "可用" }],
      [
        {
          device: "盐雾试验室",
          end_at: "2026-04-24T12:00:00",
          experiment_code: "SYLU-2026-03-002-A",
          start_at: "2026-04-24T09:00:00",
          task_code: "SYLU-2026-03-002",
        },
      ],
      new Date("2026-04-24T10:00:00"),
      [
        {
          code: "SYLU-2026-03-002-SP-001",
          location: "盐雾试验室",
          status: "实验进行中",
          task_code: "SYLU-2026-03-002",
          trays: [{ tray_code: "SYLU-2026-03-002-TP-001", status: "实验进行中", quantity: 1 }],
        },
      ],
      [
        {
          experiment_code: "SYLU-2026-03-002-A",
          task_code: "SYLU-2026-03-002",
          tray_code: "SYLU-2026-03-002-TP-001",
        },
      ],
    );

    expect(rows[0]).toEqual(expect.objectContaining({ status: "使用中", statusClass: "status running" }));
    expect(buildDeviceMetrics(rows)).toEqual(expect.objectContaining({ activeCount: 1, idleCount: 0 }));
  });

  test("keeps hot-humid lab manual maintenance visible in the device list", () => {
    const rows = buildDeviceRows(
      [
        { code: "高低温湿热一室", name: "高低温湿热一室", status: "维护/校准" },
      ],
      [],
    );

    expect(rows.map((row) => row.status)).toEqual(["维护/校准"]);
    expect(buildDeviceMetrics(rows)).toEqual(expect.objectContaining({ idleCount: 0, maintenanceCount: 1 }));
  });

  test("marks a device as maintenance during its planned maintenance window", () => {
    const rows = buildDeviceRows(
      [
        {
          code: "冲击一室",
          name: "冲击试验系统-1",
          maintenance_end_at: "2099-03-20T12:00",
          maintenance_start_at: "2099-03-20T08:00",
          status: "可用",
        },
      ],
      [],
      new Date("2099-03-20T09:00:00"),
    );

    expect(rows[0]).toEqual(
      expect.objectContaining({
        maintenanceEndAt: "2099-03-20T12:00",
        maintenanceStartAt: "2099-03-20T08:00",
        status: "维护/校准",
      }),
    );
  });

  test("returns a planned maintenance device to available after its maintenance window", () => {
    const rows = buildDeviceRows(
      [
        {
          code: "冲击一室",
          name: "冲击试验系统-1",
          maintenance_end_at: "2099-03-20T12:00",
          maintenance_start_at: "2099-03-20T08:00",
          status: "维护/校准",
        },
      ],
      [],
      new Date("2099-03-20T12:30:00"),
    );

    expect(rows[0]).toEqual(expect.objectContaining({ status: "可用", statusClass: "status" }));
  });

  test("finds schedules overlapped by a planned maintenance window", () => {
    const impact = resolveMaintenanceScheduleImpact({
      deviceCode: "冲击一室",
      endAt: "2099-03-20T11:00",
      schedules: [
        {
          id: "schedule-1",
          device: "冲击一室",
          end_at: "2099-03-20T10:00",
          start_at: "2099-03-20T08:00",
          task_code: "TASK-001",
        },
        {
          id: "schedule-2",
          device: "振动一室",
          end_at: "2099-03-20T10:00:00.000Z",
          start_at: "2099-03-20T08:00:00.000Z",
          task_code: "TASK-002",
        },
      ],
      startAt: "2099-03-20T09:00",
    });

    expect(impact.conflictingSchedules).toEqual([expect.objectContaining({ id: "schedule-1" })]);
  });

  test("builds maintenance plan form from stored device fields", () => {
    expect(
      buildMaintenancePlanForm({
        maintenance_end_at: "2099-03-20T12:00",
        maintenance_note: "年度校准",
        maintenance_start_at: "2099-03-20T08:00",
        maintenance_type: "计划维护",
      }),
    ).toEqual({
      endAt: "2099-03-20T12:00",
      note: "年度校准",
      startAt: "2099-03-20T08:00",
      type: "计划维护",
    });
  });
});
