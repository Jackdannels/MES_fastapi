import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

const pagePath = resolve(process.cwd(), "src/modules/process/page.vue");
const componentPaths = [
  "src/modules/process/ProcessTaskDetailModal.vue",
  "src/modules/process/ProcessTaskTrayPanel.vue",
  "src/modules/process/ProcessTaskFullListModal.vue",
  "src/modules/process/ProcessTaskSelectionModal.vue",
].map((path) => resolve(process.cwd(), path));

const readProcessPage = () => [pagePath, ...componentPaths]
  .map((path) => readFileSync(path, "utf8"))
  .join("\n");

const cssBlock = (source, selector) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(`${escaped}\\s*\\{(?<body>[^}]+)\\}`));
  return match?.groups?.body || "";
};

const cssBlocksContaining = (source, selector) => {
  const blocks = source.match(/[^{}]+\{[^{}]+\}/g) || [];
  return blocks
    .filter((block) => block.slice(0, block.indexOf("{")).includes(selector))
    .join("\n");
};

describe("ProcessPage structure", () => {
  test("delegates page state to useProcessLabs", () => {
    const source = readProcessPage();

    expect(source).toContain("useProcessLabs");
    expect(source).not.toContain("useStorageSnapshot");
    expect(source).not.toContain("buildProcessLabCards");
    expect(source).not.toContain("onMounted(loadLabStatus)");
  });

  test("lays out task detail as overview, active trays, and flow timeline columns", () => {
    const source = readProcessPage();
    const detailModal = cssBlock(source, ".process-task-detail-modal-content");
    const detailGrid = cssBlock(source, ".process-task-detail-grid");
    const overviewPanel = cssBlock(source, ".process-task-overview-panel");
    const trayPanel = cssBlocksContaining(source, ".process-task-tray-panel");
    const sampleCodeCard = cssBlock(source, ".process-task-selected-samples");
    const flowCard = cssBlock(source, ".process-task-flow-card");
    const flowList = cssBlock(source, ".process-task-flow-list");

    expect(source).toContain("process-task-modal-content process-task-detail-modal-content");
    expect(source).toContain("process-task-detail-grid");
    expect(source).toContain("process-task-overview-panel");
    expect(source).toContain("process-task-tray-panel");
    expect(source).toContain("process-task-flow-card");
    expect(detailModal).toContain("height: min(980px, calc(100dvh - 16px))");
    expect(detailModal).toContain("overflow: hidden");
    expect(detailModal).not.toContain("overflow: auto");
    expect(detailModal).not.toContain("overflow: scroll");

    expect(detailGrid).toContain("grid-template-columns: minmax(280px, 0.82fr) minmax(360px, 1.05fr) minmax(320px, 0.88fr)");
    expect(detailGrid).toContain("grid-template-rows: minmax(320px, 1.15fr) minmax(300px, 0.85fr)");
    expect(detailGrid).toContain("overflow: hidden");
    expect(overviewPanel).toContain("display: grid");
    expect(overviewPanel).toContain("grid-column: 1");
    expect(overviewPanel).toContain("grid-row: 1");
    expect(overviewPanel).toContain("grid-template-rows: auto auto auto");
    expect(trayPanel).toContain("display: grid");
    expect(trayPanel).toContain("grid-template-rows: auto minmax(0, 1fr)");
    expect(sampleCodeCard).toContain("grid-column: 1 / span 2");
    expect(sampleCodeCard).toContain("grid-row: 2");
    expect(flowCard).toContain("display: flex");
    expect(flowCard).toContain("grid-column: 3");
    expect(flowCard).toContain("grid-row: 1 / span 2");
    expect(flowCard).toContain("overflow: hidden");
    expect(flowList).toContain("flex: 1 1 auto");
    expect(flowList).toContain("overflow: auto");
    expect(flowList).toContain("padding: 0 4px 12px 0");
  });

  test("keeps tray batch lists locally scrollable inside the fitted task detail modal", () => {
    const source = readProcessPage();
    const trayPanel = cssBlocksContaining(source, ".process-task-tray-panel");
    const trayCard = cssBlock(source, ".process-task-tray-panel > .process-task-summary-card");
    const trayList = cssBlock(source, ".process-task-tray-list--scrollable");

    expect(source).toContain("process-task-tray-list process-task-tray-list--scrollable");
    expect(trayPanel).toContain("min-height: 0");
    expect(trayPanel).toContain("overflow: hidden");
    expect(trayCard).toContain("display: flex");
    expect(trayCard).toContain("flex-direction: column");
    expect(trayCard).toContain("min-height: 0");
    expect(trayList).toContain("flex: 1 1 auto");
    expect(trayList).toContain("min-height: 0");
    expect(trayList).toContain("max-height: none");
    expect(trayList).toContain("overflow: auto");
    expect(trayList).toContain("scrollbar-gutter: stable");
  });

  test("spans the sample number card across the removed waiting-tray space", () => {
    const source = readProcessPage();
    const sampleCodeCard = cssBlock(source, ".process-task-selected-samples");
    const sampleCodeList = cssBlock(source, ".process-task-sample-code-list");

    expect(source).toContain("data-testid=\"process-sample-code-card\"");
    expect(source).not.toContain("待下一轮托盘");
    expect(source).not.toContain("process-remaining-tray-grid");
    expect(source).not.toContain("process-remaining-tray-count");
    expect(sampleCodeCard).toContain("grid-column: 1 / span 2");
    expect(sampleCodeCard).toContain("grid-row: 2");
    expect(source).toContain("TASK_SAMPLE_PREVIEW_LIMIT = 9");
    expect(sampleCodeCard).toContain("overflow: hidden");
    expect(sampleCodeList).toContain("grid-template-columns: repeat(2, minmax(0, 1fr))");
    expect(sampleCodeList).toContain("overflow: visible");
    expect(sampleCodeList).not.toMatch(/overflow:\s*(auto|scroll)/);
    expect(sampleCodeList).not.toContain("scrollbar-gutter");
  });

  test("keeps process task selector controls on industrial dark tokens", () => {
    const source = readProcessPage();
    const button = cssBlocksContaining(source, ".process-task-select-button");
    const option = cssBlocksContaining(source, ".process-task-selection-option");
    const activeOption = cssBlock(source, ".process-task-selection-option.is-active");

    expect(source).toContain("data-testid=\"process-open-task-selector\"");
    expect(source).toContain("data-testid=\"process-task-selection-modal\"");
    expect(source).not.toContain("process-switch-task-");
    expect(button).toContain("background: var(--bg-panel-strong)");
    expect(button).toContain("color: var(--text)");
    expect(option).toContain("background: var(--bg-panel-strong)");
    expect(activeOption).toContain("background: rgba(var(--industrial-accent-rgb), 0.16)");
    expect(activeOption).toContain("color: var(--accent)");
    expect(`${button}\n${option}\n${activeOption}`).not.toMatch(/background:\s*(#fff|#ffffff|white)\b/i);
    expect(`${button}\n${option}\n${activeOption}`).not.toMatch(/color:\s*(#000|#000000|black)\b/i);
  });
});
