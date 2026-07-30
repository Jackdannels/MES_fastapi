import { describe, expect, test } from "vitest";
import { resolveLaboratoryDisplayName, resolveLaboratoryRouteKey } from "./labs";

describe("resolveLaboratoryDisplayName", () => {
  test.each([
    ["LAB_IMPACT_2", "冲击二室"],
    ["LAB_COMPREHENSIVE", "四综合实验室"],
    ["冲击一室", "冲击一室"],
    ["接驳区", "接驳区"],
    ["LAB_UNKNOWN", "LAB_UNKNOWN"],
  ])("resolves %s to %s", (value, expected) => {
    expect(resolveLaboratoryDisplayName(value)).toBe(expected);
  });
});

describe("resolveLaboratoryRouteKey", () => {
  test.each([
    ["冲击二室", "LAB_IMPACT_2"],
    ["高低温湿热二室", "LAB_HOT_HUMID_2"],
    ["LAB_SALT", "LAB_SALT"],
    ["LAB_UNKNOWN", "LAB_UNKNOWN"],
  ])("uses a stable English URL key for %s", (value, expected) => {
    expect(resolveLaboratoryRouteKey(value)).toBe(expected);
  });
});
