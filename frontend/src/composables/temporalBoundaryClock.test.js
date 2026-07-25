import { describe, expect, test } from "vitest";

import { buildTemporalBoundaryState, temporalBoundaryHasElapsed } from "./temporalBoundaryClock";

describe("temporal boundary clock", () => {
  test("stays stable between boundaries and changes exactly when a schedule boundary is crossed", () => {
    const schedules = [{
      start_at: "2026-07-24T10:00:05.000+08:00",
      end_at: "2026-07-24T10:00:10.000+08:00",
    }];

    const state = buildTemporalBoundaryState({
      now: new Date("2026-07-24T10:00:00.000+08:00"),
      schedules,
    });

    expect(temporalBoundaryHasElapsed(state, new Date("2026-07-24T10:00:04.000+08:00"))).toBe(false);
    expect(temporalBoundaryHasElapsed(state, new Date("2026-07-24T10:00:05.000+08:00"))).toBe(true);

    const afterStart = buildTemporalBoundaryState({
      now: new Date("2026-07-24T10:00:05.000+08:00"),
      schedules,
    });
    expect(afterStart.nextBoundaryTime).toBe(new Date("2026-07-24T10:00:10.000+08:00").getTime());
    expect(temporalBoundaryHasElapsed(afterStart, new Date("2026-07-24T10:00:10.000+08:00"))).toBe(true);
  });

  test("changes at maintenance and calendar-day boundaries", () => {
    const devices = [{
      maintenance_start_at: "2026-07-24T23:59:58.000+08:00",
      maintenance_end_at: "2026-07-25T00:00:02.000+08:00",
    }];
    const beforeMaintenance = buildTemporalBoundaryState({
      devices,
      now: new Date("2026-07-24T23:59:57.000+08:00"),
    });
    expect(temporalBoundaryHasElapsed(beforeMaintenance, new Date("2026-07-24T23:59:58.000+08:00"))).toBe(true);

    const duringMaintenance = buildTemporalBoundaryState({
      devices,
      now: new Date("2026-07-24T23:59:58.000+08:00"),
    });
    expect(temporalBoundaryHasElapsed(duringMaintenance, new Date("2026-07-25T00:00:00.000+08:00"))).toBe(true);
  });
});
