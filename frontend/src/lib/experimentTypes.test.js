import { describe, expect, test } from "vitest";

import { matchesExperimentTypeFilter } from "./experimentTypes";

describe("experimentTypes", () => {
  test("matches atomic experiment types exactly instead of by substring", () => {
    expect(matchesExperimentTypeFilter("冲击试验", "盐雾试验 / 冲击试验")).toBe(true);
    expect(matchesExperimentTypeFilter("冲击试验", "温度冲击试验")).toBe(false);
  });

  test("treats 实验 and 试验 spellings as the same complete type", () => {
    expect(matchesExperimentTypeFilter("冲击实验", "冲击试验")).toBe(true);
    expect(matchesExperimentTypeFilter("冲击实验", "温度冲击试验")).toBe(false);
  });
});
