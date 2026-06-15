import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

const cardPath = resolve(process.cwd(), "src/modules/task-overview/TaskOverviewCard.vue");

describe("TaskOverviewCard structure", () => {
  test("delegates readonly detail markup to TaskOverviewEditorPanel", () => {
    const source = readFileSync(cardPath, "utf8");

    expect(source).toContain("TaskOverviewEditorPanel");
    expect(source).toContain("readonly");
    expect(source).not.toContain('class="task-overview-editor"');
    expect(source).not.toContain('class="task-overview-delete-confirm"');
    expect(source).toContain("任务编号");
    expect(source).toContain("双击进入详情模式，所有信息只读");
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
