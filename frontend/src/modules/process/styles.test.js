import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

const processStylesPath = resolve(process.cwd(), "src/modules/process/styles.css");

describe("process control styles", () => {
  test("uses scheme A high-contrast perimeter borders for every lab state", () => {
    const source = readFileSync(processStylesPath, "utf8");

    expect(source).toMatch(/\.process-lab-card\.is-running\s*{[^}]*border-color:\s*rgba\(34,\s*197,\s*94,\s*0\.82\);[^}]*box-shadow:\s*0 0 0 1px rgba\(34,\s*197,\s*94,\s*0\.18\),\s*inset 0 0 0 1px rgba\(34,\s*197,\s*94,\s*0\.22\);/s);
    expect(source).toMatch(/\.process-lab-card\.is-scheduled\s*{[^}]*border-color:\s*rgba\(34,\s*211,\s*238,\s*0\.78\);[^}]*box-shadow:\s*0 0 0 1px rgba\(34,\s*211,\s*238,\s*0\.16\),\s*inset 0 0 0 1px rgba\(34,\s*211,\s*238,\s*0\.2\);/s);
    expect(source).toMatch(/\.process-lab-card\.is-idle\s*{[^}]*border-color:\s*rgba\(148,\s*163,\s*184,\s*0\.42\);[^}]*box-shadow:\s*inset 0 0 0 1px rgba\(148,\s*163,\s*184,\s*0\.08\);/s);
    expect(source).toMatch(/\.process-lab-card\.is-maintenance\s*{[^}]*border-color:\s*rgba\(239,\s*68,\s*68,\s*0\.84\);[^}]*box-shadow:\s*0 0 0 1px rgba\(239,\s*68,\s*68,\s*0\.18\),\s*inset 0 0 0 1px rgba\(239,\s*68,\s*68,\s*0\.22\);/s);
    expect(source).toMatch(/\.process-lab-card\.is-urgent\s*{[^}]*border-color:\s*rgba\(245,\s*158,\s*11,\s*0\.9\);[^}]*box-shadow:\s*0 0 0 1px rgba\(245,\s*158,\s*11,\s*0\.2\),\s*inset 0 0 0 1px rgba\(245,\s*158,\s*11,\s*0\.24\);/s);
  });

  test("uses red maintenance tones and an orange blinking urgent state", () => {
    const source = readFileSync(processStylesPath, "utf8");

    expect(source).toMatch(/\.process-lab-card\.is-maintenance\s*{[^}]*border-color:\s*rgba\(239,\s*68,\s*68,/s);
    expect(source).toMatch(/\.process-lab-card\.is-maintenance \.process-lab-status\s*{[^}]*color:\s*#fecaca;/s);
    expect(source).toMatch(/\.process-lab-card\.is-urgent\s*{[^}]*border-color:\s*rgba\(245,\s*158,\s*11,/s);
    expect(source).toMatch(/\.process-lab-card\.is-urgent\s*{[^}]*animation:\s*process-lab-urgent-pulse/s);
    expect(source).toContain("@keyframes process-lab-urgent-pulse");
  });
});
