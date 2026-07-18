import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

describe("staging management styles", () => {
  test("syncs corresponding inventory row heights across the two columns", () => {
    const source = readFileSync(resolve(process.cwd(), "src/modules/staging-management/styles.css"), "utf8");

    expect(source).toMatch(/\.zancun-inventory-columns\s*\{[^}]*grid-template-rows:\s*auto\s+repeat\(4,\s*minmax\(var\(--zancun-console-slot-height\),\s*auto\)\)/i);
    expect(source).toMatch(/\.zancun-inventory-column\s*\{[^}]*grid-template-rows:\s*subgrid/i);
    expect(source).toMatch(/\.zancun-console-list\s*\{[^}]*display:\s*contents/i);
    expect(source).toMatch(/\.zancun-console-slot\s*\{[^}]*height:\s*100%/i);
    expect(source).toMatch(/\.zancun-console-slot--placeholder,\s*[^}]*\.zancun-console-placeholder\s*\{[^}]*height:\s*100%/i);
  });

  test("uses a unified two-column touch action deck with full-card buttons", () => {
    const source = readFileSync(resolve(process.cwd(), "src/modules/staging-management/styles.css"), "utf8");

    expect(source).toMatch(/\.zancun-actions-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)[^}]*padding:\s*14px/i);
    expect(source).toMatch(/\.zancun-touch-action\s*\{[^}]*min-height:\s*144px[^}]*touch-action:\s*manipulation/i);
    expect(source).toMatch(/\.zancun-touch-action:active\s*\{[^}]*transform:\s*scale\(0\.985\)/i);
    expect(source).toMatch(/\.zancun-touch-action:focus-visible\s*\{[^}]*outline:\s*3px\s+solid/i);
  });
});
