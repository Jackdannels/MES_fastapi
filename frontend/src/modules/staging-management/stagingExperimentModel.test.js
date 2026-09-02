import { describe, expect, test } from "vitest";

import { resolveStorageRoomConfig } from "./stagingStorageModel";
import { hasAppearanceStockInBeforeLatestLabDispatch } from "./stagingExperimentModel";

describe("stagingExperimentModel pre-experiment appearance completion", () => {
  test("keeps the completion marker after withdrawal and staging redispatch to the same experiment", () => {
    const targetExperimentCode = "EXP-SALT";
    const trayStorageEvents = [
      {
        room: "appearance",
        action: "stock_in",
        appearance_phase: "pre_experiment",
        target_experiment_code: targetExperimentCode,
        time: "2026-06-06T21:40:00",
      },
      {
        room: "appearance",
        action: "stock_out",
        appearance_phase: "pre_experiment",
        target_experiment_code: targetExperimentCode,
        target_lab: "盐雾试验室",
        target_type: "lab",
        time: "2026-06-06T21:50:00",
      },
      {
        room: "appearance",
        action: "stock_out_withdraw",
        target_experiment_code: targetExperimentCode,
        target_lab: "盐雾试验室",
        time: "2026-06-06T21:55:00",
      },
      {
        room: "staging",
        action: "stock_in",
        time: "2026-06-06T22:00:00",
      },
      {
        room: "staging",
        action: "stock_out",
        target_experiment_code: targetExperimentCode,
        target_lab: "盐雾试验室",
        target_type: "lab",
        time: "2026-06-06T22:05:00",
      },
    ];

    expect(hasAppearanceStockInBeforeLatestLabDispatch({
      config: resolveStorageRoomConfig("appearance"),
      latestStorageEvent: trayStorageEvents.at(-1),
      trayStorageEvents,
    })).toBe(true);
  });

  test("does not reuse the completion marker for another target experiment", () => {
    const trayStorageEvents = [
      {
        room: "appearance",
        action: "stock_out",
        appearance_phase: "pre_experiment",
        target_experiment_code: "EXP-SALT",
        target_lab: "盐雾试验室",
        target_type: "lab",
        time: "2026-06-06T21:50:00",
      },
      {
        room: "appearance",
        action: "stock_out_withdraw",
        target_experiment_code: "EXP-SALT",
        target_lab: "盐雾试验室",
        time: "2026-06-06T21:55:00",
      },
      {
        room: "staging",
        action: "stock_out",
        target_experiment_code: "EXP-HOT-HUMID",
        target_lab: "高低温湿热一室",
        target_type: "lab",
        time: "2026-06-06T22:05:00",
      },
    ];

    expect(hasAppearanceStockInBeforeLatestLabDispatch({
      config: resolveStorageRoomConfig("appearance"),
      latestStorageEvent: trayStorageEvents.at(-1),
      trayStorageEvents,
    })).toBe(false);
  });
});
