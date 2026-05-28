import { describe, expect, test } from "vitest";

import { SYSTEM_TRAY_TOTAL, getRemainingSystemTrayCount } from "./trayCapacity";

describe("trayCapacity", () => {
  test("uses ten trays as the project-wide system tray total", () => {
    expect(SYSTEM_TRAY_TOTAL).toBe(10);
    expect(getRemainingSystemTrayCount(2)).toBe(8);
    expect(getRemainingSystemTrayCount(12)).toBe(0);
  });
});
