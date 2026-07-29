import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

const pagePath = resolve(process.cwd(), "src/modules/task-history/page.vue");

describe("TaskHistoryPage structure", () => {
  test("preserves the horizontal tray flow and adds audit-log export controls", () => {
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
    expect(source).toContain("buildTrayAuditLog");
    expect(source).toContain("selectedTrayAuditLog");
    expect(source).toContain("buildTrayFlowView");
    expect(source).toContain("selectedTrayFlow");
    expect(source).toContain("history-tray-unified-flow");
    expect(source).toContain("history-tray-flow-grid");
    expect(source).toContain("history-tray-flow-step");
    expect(source).toContain('data-testid="history-tray-export-bar"');
    expect(source).toContain('data-testid="history-export-scope-options"');
    expect(source).toContain("buildTrayAuditCsv");
    expect(source).toContain("buildTrayAuditJson");
    expect(source).toContain("buildTrayAuditSvg");
    expect(source).toContain(">\n                      CSV\n");
    expect(source).toContain(">\n                      JSON\n");
    expect(source).toContain("导出日志图");
    expect(source).toContain("本任务全部托盘");
    expect(source).toContain("自动打包为 ZIP 压缩文件");
    expect(source).not.toContain('type="button" @click="closeExportChoice">\n          取消');
    expect(source).toContain("buildZipArchive");
    expect(source).not.toContain("个关键事件 · 日志图采用方案 A 审计时间轴");
    expect(source).not.toContain("条日志未保存操作人");
    expect(source).not.toContain("history-export-note");
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
    expect(source).not.toContain("history-audit-timeline");
  });

  test("subscribes to task history storage updates", () => {
    const source = readFileSync(pagePath, "utf8");

    expect(source).toContain("useStorageSnapshotRefresh");
    expect(source).toContain("refreshHistoryData");
    expect(source).toContain("STORAGE_KEYS.tasks");
    expect(source).toContain("STORAGE_KEYS.samples");
    expect(source).toContain("STORAGE_KEYS.staging_events");
  });

  test("uses completed-state color for the returned task and tray flow", () => {
    const source = readFileSync(pagePath, "utf8");

    expect(source).toContain(".history-flow-strip-item.current .history-flow-label,");
    expect(source).toContain(".history-flow-strip-item.current .history-flow-time");
    expect(source).toContain(".history-tray-flow-step.current .history-flow-label,");
    expect(source).toContain(".history-tray-flow-step.current .history-flow-time");
    expect(source).toContain("color: var(--success);");
    expect(source).not.toContain("color: #fff;");
  });

  test("uses a fixed three-column tray selector grid", () => {
    const source = readFileSync(pagePath, "utf8");
    const trayTabs = source.match(/\.history-tray-tabs\s*\{(?<body>[^}]+)\}/)?.groups?.body || "";
    const trayTab = source.match(/\.history-tray-tab\s*\{(?<body>[^}]+)\}/)?.groups?.body || "";

    expect(trayTabs).toContain("display: grid;");
    expect(trayTabs).toContain("grid-template-columns: repeat(3, minmax(0, 1fr));");
    expect(trayTabs).not.toContain("flex-wrap");
    expect(trayTab).toContain("width: 100%;");
    expect(trayTab).toContain("min-width: 0;");
  });
});
