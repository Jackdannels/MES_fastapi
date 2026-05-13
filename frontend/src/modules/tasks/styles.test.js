import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

const stylesPath = resolve(process.cwd(), "src/modules/tasks/styles.css");

describe("tasks styles", () => {
  test("keeps task table headers centered with module-specific table styles", () => {
    const source = readFileSync(stylesPath, "utf8");

    expect(source).toContain(".tasks-page .tasks-table thead th");
    expect(source).toContain("text-align: center;");
  });

  test("keeps total task list filters grouped from the left", () => {
    const source = readFileSync(stylesPath, "utf8");

    expect(source).toContain(".tasks-list-card .toolbar");
    expect(source).toContain("justify-content: flex-start;");
    expect(source).not.toContain(".tasks-page .toolbar {\n  justify-content: space-between;");
  });

  test("allows task due time cells to wrap instead of overflowing when zoomed", () => {
    const source = readFileSync(stylesPath, "utf8");

    const dueAtRule = source.slice(source.indexOf(".tasks-table__cell--due-at"));

    expect(dueAtRule).toContain("white-space: normal;");
    expect(dueAtRule).toContain("overflow-wrap: anywhere;");
    expect(dueAtRule).toContain("word-break: break-word;");
  });
});
