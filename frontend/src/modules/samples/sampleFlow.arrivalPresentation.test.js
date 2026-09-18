import { describe, expect, test } from "vitest";
import { presentLaboratoryArrivals, formatLaboratoryFlowStatus } from "./sampleFlow.arrivalPresentation";

const input = (history) => ({ taskCode: "T", trayCode: "TP", samples: [{ code: "SP", task_code: "T", location: "高低温湿热一室", trays: [{ tray_code: "TP", quantity: 1 }], history }] });
const arrival = (location, time) => ({ status: "已到达实验室", location, time });

describe("laboratory arrival display names", () => {
  test("returned trays resolve historical dispatch and arrival without a surviving schedule", () => {
    const data = input([
      { status: "送至实验室", location: "盐雾试验室", time: "2099-09-15 08:00:00" },
      arrival("盐雾试验室", "2099-09-15 09:00:00"),
    ]);
    data.samples[0].location = data.samples[0].status = "厂家收回";
    const flow = { currentStatus: "当前托盘：TP | 当前状态：厂家收回", steps: [
      { key: "sent_to_lab", label: "送至实验室", time: "2099-09-15 08:00:00", reached: true },
      { key: "arrived_lab", label: "已到达实验室", time: "2099-09-15 09:00:00", reached: true },
    ] };
    const result = presentLaboratoryArrivals(flow, data);
    expect(result.steps.map((step) => step.displayLabel)).toEqual(["送至盐雾试验室", "已到达盐雾试验室"]);
    expect(formatLaboratoryFlowStatus(result)).toBe(flow.currentStatus);
  });

  test("formats current arrival text without changing the canonical status", () => {
    const flow = { currentStatus: "当前托盘：TP | 当前状态：已到达实验室", steps: [
      { label: "已到达实验室", displayLabel: "已到达盐雾试验室", active: true },
    ] };
    expect(formatLaboratoryFlowStatus(flow)).toBe("当前托盘：TP | 当前状态：已到达盐雾试验室");
    expect(flow.currentStatus).toBe("当前托盘：TP | 当前状态：已到达实验室");
  });

  test("salt resume dispatch resolves the original room from its appearance stock-out log", () => {
    const flow = { steps: [{ key: "sent_to_lab", label: "送至实验室", time: "2099-09-15 09:30:00", reached: true }] };
    const data = input([{ action: "外观检测间扫码出库", status: "等待恢复实验", location: "盐雾试验室", time: "2099-09-15 09:30:00" }]);
    data.samples[0].location = "厂家收回";
    expect(presentLaboratoryArrivals(flow, data).steps[0].displayLabel).toBe("送至盐雾试验室");
  });
  test.each(["盐雾试验室", "高低温湿热一室", "四综合实验室", "冲击二室"])("uses the actual arrival room: %s", (lab) => {
    const data = input([arrival(lab, "2099-09-15 10:00:00")]);
    const flow = { steps: [{ key: "arrived_lab", label: "已到达实验室", time: "2099-09-15 10:00:00", reached: true }] };
    const before = JSON.stringify({ flow, data });
    const step = presentLaboratoryArrivals(flow, data).steps[0];
    expect(step.displayLabel).toBe(`已到达${lab}`);
    expect(step.label).toBe("已到达实验室");
    expect(JSON.stringify({ flow, data })).toBe(before);
  });

  test("does not borrow the current room for an older arrival", () => {
    const flow = { steps: [
      { key: "old-arrival", label: "已到达实验室", time: "2099-09-15 08:00:00", reached: true },
      { key: "new-arrival", label: "已到达实验室", time: "2099-09-15 10:00:00", active: true },
    ] };
    const view = presentLaboratoryArrivals(flow, input([arrival("盐雾试验室", "2099-09-15 08:00:00"), arrival("高低温湿热一室", "2099-09-15 10:00:00")]));
    expect(view.steps.map((step) => step.displayLabel)).toEqual(["已到达盐雾试验室", "已到达高低温湿热一室"]);
  });

  test("pending arrival follows its own route and never changes its business status", () => {
    const flow = { steps: [
      { key: "route-0-2", label: "送至盐雾试验室" }, { key: "route-0-3", label: "已到达实验室" },
      { key: "route-1-2", label: "送至高低温湿热二室" }, { key: "route-1-3", label: "已到达实验室" },
    ] };
    const steps = presentLaboratoryArrivals(flow, input([])).steps;
    expect(steps[1].displayLabel).toBe("已到达盐雾试验室");
    expect(steps[3].displayLabel).toBe("已到达高低温湿热二室");
  });

  test("unknown or ambiguous historical room remains generic", () => {
    const flow = { steps: [{ key: "arrived_lab", label: "已到达实验室", time: "2099-09-15 10:00:00", reached: true }] };
    expect(presentLaboratoryArrivals(flow, input([])).steps[0]).not.toHaveProperty("displayLabel");
    const ambiguous = input([arrival("盐雾试验室", "2099-09-15 10:00:00"), arrival("霉菌试验室", "2099-09-15 10:00:00")]);
    expect(presentLaboratoryArrivals(flow, ambiguous).steps[0]).not.toHaveProperty("displayLabel");
  });

  test("resolves lab codes and excludes another tray's history", () => {
    const flow = { steps: [{ key: "arrived_lab", label: "已到达实验室", time: "2099-09-15 10:00:00", reached: true }] };
    const data = input([arrival("LAB_SALT", "2099-09-15 10:00:00"), { ...arrival("四综合实验室", "2099-09-15 10:00:00"), tray_code: "OTHER" }]);
    expect(presentLaboratoryArrivals(flow, data).steps[0].displayLabel).toBe("已到达盐雾试验室");
  });
});
