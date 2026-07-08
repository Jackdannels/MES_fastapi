import { describe, expect, test } from "vitest";

import { addDays, formatDateTime, parseDate, toLocalDateValue, toLocalTimeValue } from "./sharedModel";

describe("schedule sharedModel", () => {
  test("formats schedule values in Beijing business time", () => {
    const value = "2026-07-03T01:00:00.000Z";

    expect(toLocalDateValue(value)).toBe("2026-07-03");
    expect(toLocalTimeValue(value)).toBe("09:00");
    expect(formatDateTime(value)).toBe("2026-07-03 09:00");
  });

  test("adds calendar days in Beijing business time", () => {
    const value = "2026-07-03T17:00:00.000Z";

    expect(toLocalDateValue(value)).toBe("2026-07-04");
    expect(toLocalDateValue(addDays(value, 1))).toBe("2026-07-05");
  });

  test("rejects values that cannot be parsed as business dates", () => {
    expect(parseDate("not a date")).toBeNull();
  });
});
