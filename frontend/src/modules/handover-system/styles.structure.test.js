import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

describe("handover system styles", () => {
  test("transfer area screen does not use a full-screen fixed overlay that hides the app shell", () => {
    const stylesPath = resolve(process.cwd(), "src/modules/handover-system/styles.css");
    const source = readFileSync(stylesPath, "utf8");

    expect(source).toContain(".transfer-area-screen");
    expect(source).not.toMatch(/\.transfer-area-screen\s*\{[^}]*position:\s*fixed/i);
    expect(source).not.toMatch(/\.transfer-area-screen\s*\{[^}]*inset:\s*0/i);
    expect(source).not.toMatch(/\.transfer-area-screen\s*\{[^}]*z-index:\s*200/i);
  });

  test("overview shell reserves a stable footer row for pagination", () => {
    const stylesPath = resolve(process.cwd(), "src/modules/handover-system/styles.css");
    const source = readFileSync(stylesPath, "utf8");

    expect(source).toMatch(/\.transfer-overview-shell\s*\{[^}]*grid-template-rows:\s*auto\s+auto\s+auto\s+minmax\(0,\s*1fr\)\s+auto/i);
    expect(source).toMatch(/\.transfer-overview-pagination\s*\{[^}]*margin-top:\s*auto/i);
  });
});
