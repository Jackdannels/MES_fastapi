import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

const cardPath = resolve(process.cwd(), "src/modules/task-overview/TaskOverviewCard.vue");

describe("TaskOverviewCard structure", () => {
  test("delegates editor markup to TaskOverviewEditorPanel", () => {
    const source = readFileSync(cardPath, "utf8");

    expect(source).toContain("TaskOverviewEditorPanel");
    expect(source).not.toContain('class="task-overview-editor"');
    expect(source).not.toContain('class="task-overview-delete-confirm"');
  });

  test("delegates summary table markup to TaskOverviewSummaryTable", () => {
    const source = readFileSync(cardPath, "utf8");

    expect(source).toContain("TaskOverviewSummaryTable");
    expect(source).not.toContain('class="table task-overview-summary-table"');
  });

  test("delegates sample code markup to TaskOverviewSampleCodes", () => {
    const source = readFileSync(cardPath, "utf8");

    expect(source).toContain("TaskOverviewSampleCodes");
    expect(source).not.toContain('class="task-overview-codes"');
    expect(source).not.toContain('class="task-overview-chip"');
  });
});
