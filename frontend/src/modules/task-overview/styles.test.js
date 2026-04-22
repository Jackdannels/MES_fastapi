import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

const stylesPath = resolve(process.cwd(), "src/modules/task-overview/styles.css");

describe("task overview styles", () => {
  test("keeps tray overview table headers and cells centered in the fixed table layout", () => {
    const source = readFileSync(stylesPath, "utf8");

    expect(source).toContain(".task-overview-tray-table.table th");
    expect(source).toContain(".task-overview-tray-table.table td");
    expect(source).toMatch(/\.task-overview-tray-table\.table\s+(?:th|td)[^{]*\{[^}]*text-align:\s*center/i);
    expect(source).toMatch(/\.task-overview-tray-table\.table\s+(?:th|td)[^{]*\{[^}]*vertical-align:\s*middle/i);
  });
});
