import { describe, expect, test } from "vitest";

import { formatBusinessDateKey, formatBusinessDateTime, formatBusinessTime, formatLocalDateTime, parseBusinessDateTimeToMs } from "./dateTime";

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

  test("business display helpers always format in Beijing time", () => {
    expect(formatBusinessDateKey("2026-07-03T01:00:00.000Z")).toBe("2026-07-03");
    expect(formatBusinessTime("2026-07-03T01:00:00.000Z")).toBe("09:00");
    expect(formatBusinessDateTime("2026-07-03T01:00:00.000Z")).toBe("2026-07-03 09:00");
    expect(formatBusinessDateTime("2026-07-03T01:00:00.000Z", { includeSeconds: true })).toBe("2026-07-03 09:00:00");
  });

  test("business display helpers keep empty values empty", () => {
    expect(formatBusinessDateKey()).toBe("");
    expect(formatBusinessTime()).toBe("");
    expect(formatBusinessDateTime()).toBe("");
  });
});
