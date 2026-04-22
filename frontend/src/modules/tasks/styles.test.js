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
});
