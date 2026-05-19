import { describe, expect, test } from "vitest";

import { buildDeviceMetrics, buildDeviceRows } from "./model";

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

  test("normalizes hot-humid lab maintenance and disabled states to idle unless it is running", () => {
    const rows = buildDeviceRows(
      [
        { code: "高低温湿热一室", name: "高低温湿热一室", status: "维护/校准" },
        { code: "高低温湿热一室", name: "高低温湿热一室", status: "停用" },
      ],
      [],
    );

    expect(rows.map((row) => row.status)).toEqual(["可用", "可用"]);
    expect(buildDeviceMetrics(rows)).toEqual(expect.objectContaining({ idleCount: 2, maintenanceCount: 0 }));
  });
});
