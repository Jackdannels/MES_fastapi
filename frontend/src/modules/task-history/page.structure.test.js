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
    const taskFlowSection = source.slice(
      source.indexOf('data-testid="history-task-flow-card"'),
      source.indexOf('<section class="card history-task-detail'),
    );
    expect(taskFlowSection).toContain(":title=\"formatHistoryTime(step.time)\"");
    expect(taskFlowSection).toContain("formatHistoryDatePart");
    expect(taskFlowSection).toContain("history-flow-time__date");
    expect(taskFlowSection).toContain("history-flow-time__clock");
    expect(source).toContain("container-type: inline-size;");
    expect(source).toContain("@container history-task-flow (max-width: 520px)");
    expect(source).toContain("grid-template-columns: repeat(auto-fit, minmax(min(100%, 142px), 1fr));");
    expect(source).toContain("overflow: hidden;");
    expect(source).toContain("text-overflow: ellipsis;");
    expect(source).toContain("buildTrayFlowView");
    expect(source).toContain("selectedTrayFlow");
    expect(source).toContain("history-tray-unified-flow");
    expect(source).toContain("formatHistoryTime");
    expect(source).toContain("history-tray-picker");
    expect(source).toContain("history-tray-samples-summary");
    expect(source).toContain("selectedTraySampleRows");
    expect(source).toContain("history-tray-sample-row");
    expect(source).toContain("history-tray-sample-code");
    expect(source).toContain("history-task-search");
    expect(source).toContain("history-task-range");
    expect(source).toContain("task.trayCountText");
    expect(source).toContain("task.sampleCountText");
    expect(source).not.toContain("{{ task.trayCount }} 个托盘 · {{ task.sampleCount }} 个样品");
    expect(source).toContain(".history-flow-strip-item.reached,");
    expect(source).toContain(".history-flow-strip-item.current");
    expect(source).toContain(".history-flow-strip-item .history-flow-dot");
    expect(source).toContain(".history-flow-strip-item.reached .history-flow-dot,");
    expect(source).toContain("AppPagination");
    expect(source).toContain("pagedHistoryTasks");
    expect(source).toContain("historyPage");
    expect(source).toContain("historyPageCount");
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
    expect(source).not.toContain("step.time || resolveTrayStepTime(step.label)");
  });
});
