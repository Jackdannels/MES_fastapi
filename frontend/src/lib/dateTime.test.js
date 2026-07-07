import { describe, expect, test } from "vitest";

import { formatLocalDateTime, parseBusinessDateTimeToMs } from "./dateTime";

describe("dateTime", () => {
  test("formatLocalDateTime emits Beijing local strings without timezone markers", () => {
    expect(formatLocalDateTime("2026-06-04T20:45:00+08:00")).toBe("2026-06-04 20:45:00");
    expect(formatLocalDateTime("2026-06-04T20:45:00+08:00", { includeSeconds: false })).toBe("2026-06-04 20:45");
  });

  test("parseBusinessDateTimeToMs treats timezone-less business strings as Beijing time", () => {
    expect(parseBusinessDateTimeToMs("2026-07-03 09:00:00")).toBe(Date.parse("2026-07-03T09:00:00+08:00"));
    expect(parseBusinessDateTimeToMs("2026-07-03T09:00:00")).toBe(Date.parse("2026-07-03T09:00:00+08:00"));
    expect(parseBusinessDateTimeToMs("2026-07-03T09:00:00Z")).toBe(Date.parse("2026-07-03T09:00:00Z"));
  });
});
