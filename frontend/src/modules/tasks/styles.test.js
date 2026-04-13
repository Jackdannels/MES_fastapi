import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

const stylesPath = resolve(process.cwd(), "src/modules/tasks/styles.css");

describe("tasks styles", () => {
  test("explicitly centers task table headers instead of inheriting the shared left-aligned table header rule", () => {
    const source = readFileSync(stylesPath, "utf8");

    expect(source).toContain(".tasks-page .tasks-table thead th");
    expect(source).toContain("text-align: center;");
  });
});
