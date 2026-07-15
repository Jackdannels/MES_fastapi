import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

const processStylesPath = resolve(process.cwd(), "src/modules/process/styles.css");

describe("process control styles", () => {
  test("uses red maintenance tones and an orange blinking urgent state", () => {
    const source = readFileSync(processStylesPath, "utf8");

    expect(source).toMatch(/\.process-lab-card\.is-maintenance\s*{[^}]*border-color:\s*rgba\(239,\s*68,\s*68,/s);
    expect(source).toMatch(/\.process-lab-card\.is-maintenance \.process-lab-status\s*{[^}]*color:\s*#fecaca;/s);
    expect(source).toMatch(/\.process-lab-card\.is-urgent\s*{[^}]*border-color:\s*rgba\(245,\s*158,\s*11,/s);
    expect(source).toMatch(/\.process-lab-card\.is-urgent\s*{[^}]*animation:\s*process-lab-urgent-pulse/s);
    expect(source).toContain("@keyframes process-lab-urgent-pulse");
  });
});
