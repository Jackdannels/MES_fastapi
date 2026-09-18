import { describe, expect, test } from "vitest";
import { buildTelemetryRow } from "./labTelemetryModel";
import { mount } from "@vue/test-utils";
import { LabStatusScreen } from "./screens/statusScreens";

const snapshot = () => ({ lab_code: "LAB_IMPACT_1", connection_status: "online", observed_at: "2026-09-16T14:32:08+08:00", age_seconds: 1,
  environment: { temperature_c: 23.2, humidity_rh: 48.6, connection_status: "online" },
  test_device: { online: true, temperature_c: 35.4, voltage_v: 220.1, connection_status: "online" },
  carrier_device: { configured: true, online: true, temperature_c: 29.3, voltage_v: 222, connection_status: "online" }, alarms: [],
});

describe("telemetry loss display", () => {
  test.each([
    ["2026-09-16T20:47:02+08:00", "2026-09-16 20:47:02"],
    ["2026-09-16T12:47:02Z", "2026-09-16 20:47:02"],
    ["2026-09-16T20:47:02-04:00", "2026-09-17 08:47:02"],
    ["2026-09-16 20:47:02", "2026-09-16 20:47:02"],
    ["invalid", "—"],
  ])("formats sampling time %s in Beijing time", (observed_at, expected) => {
    expect(buildTelemetryRow("冲击一室", { ...snapshot(), observed_at }).footer).toBe(`最近采集 ${expected}（北京时间）`);
  });
  test.each(["test_device", "carrier_device"])("%s loss masks only affected metrics", (key) => {
    const data = snapshot();
    data[key] = { ...data[key], connection_status: "offline", online: false, lost_seconds: 12, last_values: data[key] };
    const row = buildTelemetryRow("冲击一室", data);
    expect(row.deviceOffline).toBe(1);
    expect(row.metrics.filter((m) => m.value === "—")).toHaveLength(2);
    expect(row.metrics[0].value).toBe("23.2 °C");
    expect(row.notice).toContain("失联 12 秒");
    expect(row.metrics.some((m) => m.hint.includes("最后值"))).toBe(true);
  });
  test("host failure masks all values without asserting downstream failure", () => {
    const data = { ...snapshot(), connection_status: "offline", age_seconds: 35 };
    const row = buildTelemetryRow("冲击一室", data);
    expect(row.status).toBe("上位机失联");
    expect(row.notice).toContain("下游状态未知");
    expect(row.metrics.every((m) => m.value === "—")).toBe(true);
    expect(row.deviceOffline).toBe(0);
  });
  test("monitor outage takes precedence over host timeouts and old numeric alarms", () => {
    const data = { ...snapshot(), connection_status: "offline", alarms: [{ message: "温度过高" }] };
    const row = buildTelemetryRow("冲击一室", data, "offline");
    expect(row.hostOffline).toBe(false);
    expect(row.alarm).toBe(false);
    expect(row.status).toBe("状态未知");
    expect(row.metrics.every((m) => !m.alarm)).toBe(true);
  });
  test("configured absence is never a lost carrier", () => {
    const row = buildTelemetryRow("高低温湿热二室", { ...snapshot(), connection_status: "offline" });
    expect(row.metrics.filter((m) => m.unavailable)).toHaveLength(2);
    expect(row.metrics[5].value).toBe("无搬运设备");
  });
  test("invalid first reading is not presented as a last valid value", () => {
    const data = snapshot();
    data.test_device = { online: false, connection_status: "offline", last_values: {}, temperature_c: 99, voltage_v: 0 };
    const row = buildTelemetryRow("冲击一室", data);
    expect(row.metrics[2].hint).toContain("最后值 —");
    expect(row.metrics[3].hint).not.toContain("0.0 V");
  });
  test("normal, local loss and whole-host loss retain the same DOM slots", async () => {
    const data = snapshot();
    const wrapper = mount(LabStatusScreen, { props: { labNames: ["冲击一室"], telemetry: [data] } });
    expect(wrapper.findAll(".visual-telemetry-group")).toHaveLength(3);
    expect(wrapper.findAll(".visual-telemetry-group-name b").map((node) => node.text())).toEqual(["环境", "试验设备", "搬运设备"]);
    expect(wrapper.find(".visual-lab-status-metric strong em").text()).toBe("°C");
    expect(wrapper.find(".visual-telemetry-footer").text()).toContain("2026-09-16 14:32:08（北京时间）");
    const countSlots = () => [wrapper.findAll(".visual-lab-status-alarm").length, wrapper.findAll(".visual-lab-status-metric").length, wrapper.findAll(".visual-telemetry-last-value").length, wrapper.findAll(".visual-telemetry-footer").length];
    const initial = countSlots();
    await wrapper.setProps({ telemetry: [{ ...data, connection_status: "offline", age_seconds: 35 }] });
    expect(countSlots()).toEqual(initial);
    await wrapper.setProps({ monitorStatus: "offline" });
    expect(wrapper.text()).toContain("监控链路中断，设备状态暂不可确认");
    expect(countSlots()).toEqual(initial);
  });
});
