import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

const pagePath = resolve(process.cwd(), "src/modules/task-history/page.vue");

describe("TaskHistoryPage structure", () => {
  test("uses a tray-info-like wide layout with horizontal task flow on the upper right", () => {
    const source = readFileSync(pagePath, "utf8");

    expect(source).toContain("history-task-side");
    expect(source).toContain("history-task-flow-card--horizontal");
    expect(source).toContain("history-task-detail-card");
    expect(source).toContain("history-flow-strip");
    expect(source).toContain("history-flow-strip-item");
    expect(source).toContain("buildTrayFlowView");
    expect(source).toContain("selectedTrayFlow");
    expect(source).toContain("history-tray-unified-flow");
    expect(source).toContain("formatHistoryTime");
    expect(source).toContain("history-tray-picker");
    expect(source).toContain("history-tray-samples-summary");
    expect(source).toContain("selectedTraySampleRows");
    expect(source).toContain("history-tray-sample-row");
    expect(source).toContain("history-tray-sample-code");
    expect(source).toContain("justify-content: end;");
    expect(source).toContain("text-align: left;");
    expect(source).toContain("grid-template-columns: minmax(360px, 0.95fr) minmax(0, 1.45fr)");
    expect(source).not.toContain("实验完成情况");
    expect(source).not.toContain("history-experiment-section");
    expect(source).not.toContain("实验 {{ task.experimentCompletedCount }}/{{ task.experimentCount }} 已完成");
    expect(source).not.toContain("history-detail-head");
    expect(source).not.toContain("history-status-pill");
    expect(source).not.toContain("<span>{{ selectedTray.status || \"-\" }}</span>");
    expect(source).not.toContain("selectedTray.sampleCodes.join(\" / \")");
  });
});
