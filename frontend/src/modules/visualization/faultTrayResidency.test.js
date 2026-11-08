import { describe, expect, test } from "vitest";
import { createFaultTrayResidencyResolver } from "./faultTrayResidency";

const canceled = "设备故障试验取消";
const time = "2026-11-08 09:20:00";
const input = () => ({
  experimentRuns: [{ run_no: "R", task_code: "T", experiment_code: "E", device: "冲击一室", lab_code: "LAB_IMPACT_1", status: canceled, ended_at: time }],
  experimentRunTrays: [{ run_no: "R", task_code: "T", experiment_code: "E", tray_code: "TP", run_tray_status: canceled, ended_at: time }],
  samples: [{ code: "SP", task_code: "T", location: "冲击一室", status: canceled, trays: [{ tray_code: "TP", status: canceled, quantity: 1 }], history: [] }],
  stagingEvents: [],
});
const resident = (data) => createFaultTrayResidencyResolver(data)(data.samples[0], data.samples[0].trays[0]);

describe("fault residency uses confirmed scope and real departure facts", () => {
  test("keeps a confirmed original-room tray with no schedules", () => {
    const data = input(), before = structuredClone(data);
    expect(resident(data)).toMatchObject({ isResident: true, actualLocation: "冲击一室", runNo: "R" });
    expect(data).toEqual(before);
  });
  test("a status string alone cannot establish a confirmed resident run", () => {
    const data = input();
    data.experimentRunTrays = [];
    expect(resident(data)).toBeNull();
  });
  test("a real stock-out in the same timestamp second retires stale sample data", () => {
    const data = input();
    data.stagingEvents = [{ task_code: "T", tray_code: "TP", room: "appearance", action: "stock_out", target_lab: "恒温恒湿间（暂存间）", time }];
    expect(resident(data)).toMatchObject({ isResident: false, hasExited: true });
  });
  test("a stock-out before cancellation cannot remove the current resident", () => {
    const data = input();
    data.stagingEvents = [{ task_code: "T", tray_code: "TP", action: "stock_out", time: "2026-11-08 09:00:00" }];
    expect(resident(data).isResident).toBe(true);
  });
  test("missing cancellation time does not turn every earlier event into a later move", () => {
    const data = input();
    delete data.experimentRuns[0].ended_at;
    delete data.experimentRunTrays[0].ended_at;
    data.stagingEvents = [{ task_code: "T", tray_code: "TP", action: "stock_out", time: "2026-11-08 09:00:00" }];
    expect(resident(data).isResident).toBe(true);
  });
  test("another task's same tray cannot supply a departure", () => {
    const data = input();
    data.stagingEvents = [{ task_code: "OTHER", tray_code: "TP", action: "stock_out", time: "2026-11-08 10:00:00" }];
    expect(resident(data).isResident).toBe(true);
  });
});
