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

    expect(rows[0]).toEqual(expect.objectContaining({ status: "空闲", statusClass: "status" }));
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

    expect(rows[0]).toEqual(expect.objectContaining({ status: "工作中", statusClass: "status running" }));
    expect(buildDeviceMetrics(rows)).toEqual(expect.objectContaining({ activeCount: 1, idleCount: 0 }));
  });

  test("marks a device active from an active experiment run before tray status refreshes", () => {
    const rows = buildDeviceRows(
      [{ code: "盐雾试验室", name: "盐雾试验室", status: "可用" }],
      [],
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
      [],
      [
        {
          device: "盐雾试验室",
          run_no: "RUN-001",
          status: "实验进行中",
          task_code: "SYLU-2026-03-002",
          experiment_code: "SYLU-2026-03-002-A",
          tray_codes: ["SYLU-2026-03-002-TP-001"],
        },
      ],
    );

    expect(rows[0]).toEqual(expect.objectContaining({ status: "工作中", statusClass: "status running" }));
  });

  test("matches active experiment runs by device name when the device code is different", () => {
    const rows = buildDeviceRows(
      [{ code: "LAB_TEMP_2", name: "温度冲击二室", status: "可用" }],
      [],
      new Date("2026-04-24T10:00:00"),
      [],
      [],
      [
        {
          device: "温度冲击二室",
          run_no: "RUN-TEMP-002",
          status: "实验进行中",
          task_code: "TASK-TEMP",
          experiment_code: "TASK-TEMP-B",
          tray_codes: ["TP-TEMP-002"],
        },
      ],
    );

    expect(rows[0]).toEqual(expect.objectContaining({ status: "工作中", statusClass: "status running" }));
  });

  test("matches active experiment runs by lab code before stale display names", () => {
    const rows = buildDeviceRows(
      [
        { code: "LAB_IMPACT_1", name: "冲击一室", status: "可用" },
        { code: "LAB_OLD", name: "旧冲击间", status: "可用" },
      ],
      [],
      new Date("2026-04-24T10:00:00"),
      [],
      [],
      [
        {
          device: "旧冲击间",
          lab_code: "LAB_IMPACT_1",
          run_no: "RUN-IMPACT-001",
          status: "实验进行中",
          task_code: "TASK-IMPACT",
          experiment_code: "TASK-IMPACT-A",
        },
      ],
    );

    expect(rows).toEqual([
      expect.objectContaining({ code: "LAB_IMPACT_1", status: "工作中" }),
      expect.objectContaining({ code: "LAB_OLD", status: "空闲" }),
    ]);
  });

  test("ignores stale running tray statuses once experiment runs are available", () => {
    const rows = buildDeviceRows(
      [{ code: "盐雾试验室", name: "盐雾试验室", status: "可用" }],
      [
        {
          device: "盐雾试验室",
          experiment_code: "SYLU-2026-03-002-A",
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
      [
        {
          device: "盐雾试验室",
          run_no: "RUN-001",
          status: "实验已完成",
          task_code: "SYLU-2026-03-002",
          experiment_code: "SYLU-2026-03-002-A",
          tray_codes: ["SYLU-2026-03-002-TP-001"],
        },
      ],
    );

    expect(rows[0]).toEqual(expect.objectContaining({ status: "空闲", statusClass: "status" }));
  });

  test("keeps hot-humid lab manual maintenance visible in the device list", () => {
    const rows = buildDeviceRows(
      [
        { code: "高低温湿热一室", name: "高低温湿热一室", status: "维修" },
        { code: "高低温湿热二室", name: "高低温湿热二室", status: "维修" },
      ],
      [],
    );

    expect(rows.map((row) => row.status)).toEqual(["维修", "维修"]);
    expect(rows.map((row) => row.name)).toEqual(["高低温湿热一室", "高低温湿热二室"]);
    expect(buildDeviceMetrics(rows)).toEqual(expect.objectContaining({ idleCount: 0, maintenanceCount: 2 }));
  });

  test("backfills the second hot-humid room when legacy device ledgers only contain the first room", () => {
    const rows = buildDeviceRows(
      [
        { code: "高低温湿热一室", name: "高低温湿热系统", status: "可用", location: "高低温湿热一室" },
      ],
      [],
    );

    expect(rows.map((row) => row.code)).toEqual(["高低温湿热一室", "高低温湿热二室"]);
    expect(rows.find((row) => row.code === "高低温湿热二室")).toEqual(
      expect.objectContaining({
        location: "高低温湿热二室",
        name: "高低温湿热系统-2",
        status: "空闲",
        type: "高低温湿热试验",
      }),
    );
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
        status: "维修",
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

    expect(rows[0]).toEqual(expect.objectContaining({ status: "空闲", statusClass: "status" }));
  });

  test("exposes planned maintenance start and end dates instead of legacy calibration dates", () => {
    const rows = buildDeviceRows(
      [
        {
          code: "盐雾试验室",
          maintenance_end_at: "2099-03-20T12:00",
          maintenance_start_at: "2099-03-20T08:00",
          maintenance_type: "计划保养",
          name: "盐雾试验箱",
          next_cal: "2099-01-01",
        },
        {
          code: "霉菌试验室",
          maintenance_start_at: "2099-03-21T08:00",
          maintenance_type: "维修",
          name: "霉菌培养箱",
        },
      ],
      [],
    );

    expect(rows.find((row) => row.code === "盐雾试验室")).toEqual(expect.objectContaining({
      maintenancePlanEndAt: "2099-03-20T12:00",
      nextMaintenanceAt: "2099-03-20T08:00",
    }));
    expect(rows.find((row) => row.code === "霉菌试验室")).toEqual(expect.objectContaining({
      maintenancePlanEndAt: "/",
      nextMaintenanceAt: "/",
    }));
    expect(rows.find((row) => row.code === "盐雾试验室")).not.toHaveProperty("nextCal");
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

  test("treats maintenance without an end time as overlapping future schedules", () => {
    const impact = resolveMaintenanceScheduleImpact({
      deviceCode: "冲击一室",
      endAt: "",
      schedules: [
        {
          id: "schedule-future",
          device: "冲击一室",
          end_at: "2099-03-21T10:00",
          start_at: "2099-03-21T08:00",
          task_code: "TASK-001",
        },
      ],
      startAt: "2099-03-20T09:00",
    });

    expect(impact.conflictingSchedules).toEqual([expect.objectContaining({ id: "schedule-future" })]);
  });

  test("finds maintenance schedule conflicts by lab code before display names", () => {
    const impact = resolveMaintenanceScheduleImpact({
      deviceCode: "LAB_IMPACT_1",
      endAt: "2099-03-20T11:00",
      schedules: [
        {
          id: "schedule-lab-code",
          device: "旧冲击间",
          lab_code: "LAB_IMPACT_1",
          end_at: "2099-03-20T10:00",
          start_at: "2099-03-20T08:00",
          task_code: "TASK-001",
        },
        {
          id: "schedule-stale-name",
          device: "LAB_IMPACT_1",
          lab_code: "LAB_IMPACT_2",
          end_at: "2099-03-20T10:00",
          start_at: "2099-03-20T08:00",
          task_code: "TASK-002",
        },
      ],
      startAt: "2099-03-20T09:00",
    });

    expect(impact.conflictingSchedules).toEqual([expect.objectContaining({ id: "schedule-lab-code" })]);
  });

  test("builds maintenance plan form from stored device fields", () => {
    expect(
      buildMaintenancePlanForm({
        maintenance_end_at: "2099-03-20T12:00",
        maintenance_note: "年度校准",
        maintenance_start_at: "2099-03-20T08:00",
        maintenance_type: "计划维修",
      }),
    ).toEqual({
      endAt: "2099-03-20T12:00",
      note: "年度校准",
      startAt: "2099-03-20T08:00",
      type: "计划维修",
    });
  });

  test("derives work status from safety status before running state", () => {
    const rows = buildDeviceRows(
      [
        { code: "LAB-1", name: "维修设备", status: "维修" },
        { code: "LAB-2", name: "保养设备", status: "保养" },
        { code: "LAB-3", name: "可用设备", status: "可用" },
      ],
      [],
    );

    expect(rows.map((row) => row.status)).toEqual(["维修", "保养", "空闲"]);
    expect(buildDeviceMetrics(rows)).toEqual(expect.objectContaining({ idleCount: 1, maintenanceCount: 2 }));
  });
});
