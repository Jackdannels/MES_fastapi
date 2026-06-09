import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

describe("TrayManagementPanel structure", () => {
  test("makes the selected tray row visually distinct from the rest of the tray table", () => {
    const source = readFileSync(resolve(process.cwd(), "src/modules/samples/styles.css"), "utf8");

    expect(source).toMatch(/\.tray-row-active\s*{[^}]*background:\s*rgba\(var\(--industrial-accent-rgb\),\s*0\.16\);/s);
    expect(source).toMatch(/\.tray-row-active\s*td\s*{[^}]*box-shadow:/s);
    expect(source).toMatch(/\.tray-row-active\s*td:first-child\s*{[^}]*border-left:\s*3px solid rgba\(var\(--industrial-accent-rgb\),\s*0\.64\);/s);
  });
});
