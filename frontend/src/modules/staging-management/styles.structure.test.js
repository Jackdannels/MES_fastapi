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
});
