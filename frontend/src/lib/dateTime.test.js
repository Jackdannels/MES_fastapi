import { describe, expect, test } from "vitest";

import { formatLocalDateTime } from "./dateTime";

describe("dateTime", () => {
  test("formatLocalDateTime emits Beijing local strings without timezone markers", () => {
    expect(formatLocalDateTime("2026-06-04T20:45:00+08:00")).toBe("2026-06-04 20:45:00");
    expect(formatLocalDateTime("2026-06-04T20:45:00+08:00", { includeSeconds: false })).toBe("2026-06-04 20:45");
  });
});
