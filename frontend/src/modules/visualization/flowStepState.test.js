import { describe, expect, test } from "vitest";

import {
  resolveVisualFlowStepTitle,
  visualFlowStepClass,
} from "./flowStepState";

describe("visualization flow step state", () => {
  test("marks actual reached steps with time as done and exposes time only in title", () => {
    const step = { label: "实验后暂存间存放", reached: true, time: "2026-06-07T16:31:49+08:00" };

    expect(visualFlowStepClass(step)).toMatchObject({
      "is-active": false,
      "is-done": true,
      "is-inferred": false,
      "is-waiting": false,
    });
    expect(resolveVisualFlowStepTitle(step, () => "06-07 16:31:49")).toBe("06-07 16:31:49");
  });

  test("marks reached non-completion steps without time as inferred", () => {
    const step = { label: "实验后暂存间存放", reached: true, time: "" };

    expect(visualFlowStepClass(step)).toMatchObject({
      "is-active": false,
      "is-done": false,
      "is-inferred": true,
      "is-waiting": false,
    });
    expect(resolveVisualFlowStepTitle(step)).toBe("推导节点，暂无实际时间记录");
  });

  test("keeps completed experiment steps green even when legacy data has no time", () => {
    const step = { label: "冲击试验已完成", reached: true, time: "" };

    expect(visualFlowStepClass(step)).toMatchObject({
      "is-done": true,
      "is-inferred": false,
    });
    expect(resolveVisualFlowStepTitle(step)).toBe("实验已完成");
  });

  test("keeps confirmed arrival green even when legacy data has no time", () => {
    const step = { label: "到货", reached: true, time: "" };

    expect(visualFlowStepClass(step)).toMatchObject({
      "is-done": true,
      "is-inferred": false,
    });
    expect(resolveVisualFlowStepTitle(step)).toBe("到货已确认，暂无时间记录");
  });

  test("keeps active and waiting states distinct from inferred steps", () => {
    expect(visualFlowStepClass({ label: "冲击试验进行中", active: true })).toMatchObject({
      "is-active": true,
      "is-done": false,
      "is-inferred": false,
      "is-waiting": false,
    });
    expect(visualFlowStepClass({ label: "振动试验未完成" })).toMatchObject({
      "is-active": false,
      "is-done": false,
      "is-inferred": false,
      "is-waiting": true,
    });
  });
});
