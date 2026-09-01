import { describe, expect, test } from "vitest";

import { computeAttendanceElapsedSeconds } from "./useLaboratoryAttendance";

describe("laboratory attendance pause timing", () => {
  test("freezes employee work duration at the confirmed salt-spray pause time", () => {
    expect(computeAttendanceElapsedSeconds({
      now: new Date("2026-08-12T11:00:00+08:00"),
      pauseStartedAt: "2026-08-12T10:20:00+08:00",
      workStartedAt: "2026-08-12T10:00:00+08:00",
    })).toBe(20 * 60);
  });

  test("continues increasing normally when no experiment pause is active", () => {
    expect(computeAttendanceElapsedSeconds({
      now: new Date("2026-08-12T10:30:00+08:00"),
      workStartedAt: "2026-08-12T10:00:00+08:00",
    })).toBe(30 * 60);
  });
});
