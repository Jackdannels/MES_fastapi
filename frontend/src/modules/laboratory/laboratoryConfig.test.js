import { describe, expect, test } from "vitest";

import {
  countTrayRowSamples,
  createDefaultLaboratoryConfig,
  resolveLaboratoryConfig,
} from "./laboratoryConfig";

describe("laboratory config helpers", () => {
  test("keeps the hostless second hot-humid room code stable", () => {
    expect(createDefaultLaboratoryConfig("高低温湿热二室")).toMatchObject({
      labCode: "LAB_HOT_HUMID_2",
      labId: "LAB_HOT_HUMID_2",
      labName: "高低温湿热二室",
    });
  });

  test("prefers an enabled requested laboratory and preserves its physical identifiers", () => {
    expect(resolveLaboratoryConfig([
      { code: "LAB_SALT", name: "盐雾试验室", status: 1 },
      { code: "LAB_IMPACT_1", name: "冲击一室", status: 1, test_type_name: "冲击" },
    ], "冲击一室")).toMatchObject({
      labCode: "LAB_IMPACT_1",
      labId: "LAB_IMPACT_1",
      labName: "冲击一室",
      testTypeName: "冲击",
    });
  });

  test("counts sample codes before falling back to a positive quantity", () => {
    expect(countTrayRowSamples([
      { sampleCodes: ["S-1", "S-2"], quantity: 8 },
      { quantity: 3 },
      {},
    ])).toBe(6);
  });
});
