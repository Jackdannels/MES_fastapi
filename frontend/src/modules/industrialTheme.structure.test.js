import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

const readModuleStyle = (path) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("industrial blackbox module theme coverage", () => {
  test("darkens sample pre-allocation and handover workbench cards", () => {
    const source = readModuleStyle("src/modules/handover-system/styles.css");

    expect(source).toContain("Industrial blackbox skin: handover and pre-allocation cards");
    expect(source).toContain(".transfer-table");
    expect(source).toContain(".transfer-table__row");
    expect(source).toContain(".transfer-sample-code-chip");
    expect(source).toContain("var(--bg-card-raised)");
    expect(source).toContain("var(--text)");
  });

  test("darkens samples, login, process, and task overview business cards", () => {
    const samples = readModuleStyle("src/modules/samples/styles.css");
    const login = readModuleStyle("src/modules/login/styles.css");
    const process = readModuleStyle("src/modules/process/styles.css");
    const overview = readModuleStyle("src/modules/task-overview/styles.css");

    expect(samples).toContain(".samples-wide-head");
    expect(samples).toContain(".samples-module-card");
    expect(samples).toContain(".sample-flow-card");
    expect(login).toContain(".login-card");
    expect(login).toContain(".login-interface-mode__option.is-active");
    expect(process).toContain(".process-control-summary-item");
    expect(process).toContain(".process-lab-card");
    expect(overview).toContain(".task-overview-module-card");
    expect(overview).toContain(".task-overview-schedule-card");
    expect(`${samples}\n${login}\n${process}\n${overview}`).toContain("var(--bg-card-raised)");
  });

  test("keeps laboratory, schedule, visualization, and staging cards on industrial tokens", () => {
    const laboratory = readModuleStyle("src/modules/laboratory/styles.css");
    const schedule = readModuleStyle("src/modules/schedule/styles.css");
    const visualization = readModuleStyle("src/modules/visualization/styles.css");
    const staging = readModuleStyle("src/modules/staging-management/styles.css");

    expect(laboratory).toContain(".laboratory-flow-card");
    expect(laboratory).toContain(".laboratory-fixture-status-card__head");
    expect(schedule).toContain(".gantt-wrap");
    expect(schedule).toContain(".gantt-slot.idle");
    expect(visualization).toContain(".visual-summary-item");
    expect(visualization).toContain("--visual-panel: var(--bg-card-raised)");
    expect(staging).toContain(".zancun-destination-card--return.is-danger");
    expect(`${laboratory}\n${schedule}\n${visualization}\n${staging}`).toContain("var(--bg-card-raised)");
  });

  test("darkens process task drawers, history flow cards, and staging metrics", () => {
    const processPage = readModuleStyle("src/modules/process/page.vue");
    const historyPage = readModuleStyle("src/modules/task-history/page.vue");
    const staging = readModuleStyle("src/modules/staging-management/styles.css");

    expect(processPage).toContain(".process-task-modal-content");
    expect(processPage).toContain(".process-task-summary-card");
    expect(processPage).toContain(".process-task-flow-list li");
    expect(historyPage).toContain(".history-task-row");
    expect(historyPage).toContain(".history-tray-unified-flow");
    expect(historyPage).toContain(".history-tray-flow-step");
    expect(staging).toContain(".zancun-metric-card .kpi");
    expect(`${processPage}\n${historyPage}\n${staging}`).toContain("var(--bg-panel-strong)");
  });
});
