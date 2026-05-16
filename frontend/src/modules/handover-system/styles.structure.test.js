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
    expect(source).toMatch(/\.transfer-area-screen\.is-embedded\s+\.transfer-overview-shell\s*\{[^}]*height:\s*calc\(100vh\s*-\s*172px\)/i);
    expect(source).toMatch(/\.transfer-overview-pagination\s*\{[^}]*margin-top:\s*auto/i);
  });

  test("overview table rows and sample code lists are height bounded so pagination stays fixed", () => {
    const stylesPath = resolve(process.cwd(), "src/modules/handover-system/styles.css");
    const source = readFileSync(stylesPath, "utf8");

    expect(source).toMatch(/\.transfer-table__row\s*\{[^}]*height:\s*214px/i);
    expect(source).toMatch(/\.transfer-table__row\s*\{[^}]*max-height:\s*214px/i);
    expect(source).toMatch(/\.transfer-table__codes\s*\{[^}]*max-height:\s*190px/i);
    expect(source).toMatch(/\.transfer-table__codes\s*\{[^}]*overflow:\s*auto/i);
  });

  test("overview table compresses task columns and centers headers and cells", () => {
    const stylesPath = resolve(process.cwd(), "src/modules/handover-system/styles.css");
    const source = readFileSync(stylesPath, "utf8");

    expect(source).toMatch(/\.transfer-area-shell\s*\{[^}]*width:\s*min\(1760px,\s*100%\)/i);
    expect(source).toMatch(
      /\.transfer-table__head,\s*\.transfer-table__row\s*\{[^}]*grid-template-columns:\s*72px\s+minmax\(150px,\s*0\.65fr\)\s+minmax\(180px,\s*0\.75fr\)\s+minmax\(620px,\s*2\.6fr\)\s+96px/i,
    );
    expect(source).toMatch(/\.transfer-table__head,\s*\.transfer-table__row\s*\{[^}]*text-align:\s*center/i);
    expect(source).toMatch(/\.transfer-table__name\s*\{[^}]*justify-items:\s*center/i);
  });

  test("overview sample codes are a three-column grid with at most four visible rows", () => {
    const stylesPath = resolve(process.cwd(), "src/modules/handover-system/styles.css");
    const source = readFileSync(stylesPath, "utf8");

    expect(source).toMatch(/\.transfer-table__codes\s*\{[^}]*display:\s*grid/i);
    expect(source).toMatch(/\.transfer-table__codes\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/i);
    expect(source).toMatch(/\.transfer-table__codes\s*\{[^}]*grid-auto-rows:\s*40px/i);
  });
});
