import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

describe("handover system styles", () => {
  test("transfer area screen does not use a full-screen fixed overlay that hides the app shell", () => {
    const stylesPath = resolve(process.cwd(), "src/modules/handover-system/styles.css");
    const source = readFileSync(stylesPath, "utf8");

    expect(source).toContain(".transfer-area-screen");
    expect(source).not.toMatch(/\.transfer-area-screen\s*\{[^}]*position:\s*fixed/i);
    expect(source).not.toMatch(/\.transfer-area-screen\s*\{[^}]*inset:\s*0/i);
    expect(source).not.toMatch(/\.transfer-area-screen\s*\{[^}]*z-index:\s*200/i);
  });

  test("overview shell reserves a stable footer row for pagination", () => {
    const stylesPath = resolve(process.cwd(), "src/modules/handover-system/styles.css");
    const source = readFileSync(stylesPath, "utf8");

    expect(source).toMatch(/\.transfer-overview-shell\s*\{[^}]*grid-template-rows:\s*auto\s+auto\s+minmax\(0,\s*1fr\)\s+auto/i);
    expect(source).toMatch(/\.transfer-area-screen\.is-embedded\s+\.transfer-overview-shell\s*\{[^}]*height:\s*calc\(100vh\s*-\s*172px\)/i);
    expect(source).toMatch(/\.transfer-overview-pagination\s*\{[^}]*margin-top:\s*auto/i);
  });

  test("handover headings share their rows with touch-friendly actions", () => {
    const componentPath = resolve(process.cwd(), "src/modules/transfer-workbench/TransferWorkbench.vue");
    const stylesPath = resolve(process.cwd(), "src/modules/handover-system/styles.css");
    const componentSource = readFileSync(componentPath, "utf8");
    const styleSource = readFileSync(stylesPath, "utf8");

    expect(componentSource).toMatch(/class="transfer-overview-shell__head"[\s\S]*v-if="showOverviewIntro"[\s\S]*class="transfer-overview-page-title"[\s\S]*class="transfer-overview-kpis/);
    expect(componentSource).toContain('<h1 class="transfer-system-title">{{ modeConfig.headerTitle }}</h1>');
    expect(styleSource).toMatch(/\.transfer-system-header\s*\{[^}]*justify-content:\s*space-between/i);
    expect(styleSource).toMatch(/\.transfer-overview-shell__head\s*\{[^}]*min-height:\s*68px/i);
    expect(styleSource).toMatch(/\.transfer-overview-page-title\s*\{[^}]*font-size:\s*clamp\(28px,\s*2vw,\s*32px\)/i);
    expect(styleSource).toMatch(/\.transfer-system-actions\s+\.action-btn\s*\{[^}]*min-height:\s*64px/i);
  });

  test("handover terminal uses the viewport as its layout boundary", () => {
    const componentPath = resolve(process.cwd(), "src/modules/transfer-workbench/TransferWorkbench.vue");
    const pagePath = resolve(process.cwd(), "src/modules/handover-system/page.vue");
    const stylesPath = resolve(process.cwd(), "src/modules/handover-system/styles.css");
    const componentSource = readFileSync(componentPath, "utf8");
    const pageSource = readFileSync(pagePath, "utf8");
    const styleSource = readFileSync(stylesPath, "utf8");

    expect(pageSource).toContain('<TransferWorkbench mode="handover" terminal />');
    expect(componentSource).toContain("'is-terminal': terminal");
    expect(styleSource).toMatch(/\.transfer-area-screen\.is-terminal\s*\{[^}]*height:\s*100dvh/i);
    expect(styleSource).toMatch(/\.transfer-area-screen\.is-terminal\s*\{[^}]*min-height:\s*0/i);
    expect(styleSource).toMatch(/\.transfer-area-screen\.is-terminal\s*\{[^}]*overflow:\s*hidden/i);
    expect(styleSource).toMatch(/\.transfer-area-screen\.is-terminal\s+\.transfer-overview-shell\s*\{[^}]*height:\s*100%/i);
    expect(styleSource).toMatch(/\.transfer-area-screen\.is-terminal\s+\.transfer-overview-shell\s*\{[^}]*min-height:\s*0/i);
    expect(styleSource).toMatch(/\.transfer-area-screen\.is-terminal\s+\.transfer-detail-shell\s*\{[^}]*overflow:\s*auto/i);
  });

  test("handover terminal compresses the three-row overview without scrolling the page", () => {
    const componentPath = resolve(process.cwd(), "src/modules/transfer-workbench/TransferWorkbench.vue");
    const stylesPath = resolve(process.cwd(), "src/modules/handover-system/styles.css");
    const componentSource = readFileSync(componentPath, "utf8");
    const source = readFileSync(stylesPath, "utf8");

    expect(source).toMatch(/\.transfer-area-screen\.is-terminal\s+\.transfer-table__codes\s*\{[^}]*grid-template-rows:\s*repeat\(4,\s*34px\)/i);
    expect(source).toMatch(/\.transfer-area-screen\.is-terminal\s+\.transfer-table__codes\s*\{[^}]*max-height:\s*154px/i);
    expect(source).toMatch(/\.transfer-area-screen\.is-terminal\s+\.transfer-sample-code-chip\s*\{[^}]*min-height:\s*34px/i);
    expect(componentSource).toContain(':show-jump-controls="mode !== \'handover\'"');
    expect(source).toMatch(/\.transfer-area-screen\.is-terminal\s+\.task-list-pagination\s*>\s*\.task-list-pagination__step\s*\{[^}]*min-width:\s*64px/i);
    expect(source).toMatch(/\.transfer-area-screen\.is-terminal\s+\.task-list-pagination\s*>\s*\.task-list-pagination__step\s*\{[^}]*min-height:\s*48px/i);
  });

  test("overview feedback is a floating toast and does not reserve a grid row", () => {
    const componentPath = resolve(process.cwd(), "src/modules/transfer-workbench/TransferWorkbench.vue");
    const stylesPath = resolve(process.cwd(), "src/modules/handover-system/styles.css");
    const componentSource = readFileSync(componentPath, "utf8");
    const styleSource = readFileSync(stylesPath, "utf8");

    expect(componentSource).toContain('class="transfer-overview-toolbar-frame"');
    expect(componentSource).toContain('class="transfer-overview-feedback"');
    expect(styleSource).toMatch(/\.transfer-overview-toolbar-frame\s*\{[^}]*position:\s*relative/i);
    expect(styleSource).toMatch(/\.transfer-overview-toolbar-frame\s*>\s*\.transfer-overview-feedback\s*\{[^}]*position:\s*absolute/i);
    expect(styleSource).toMatch(/\.transfer-overview-toolbar-frame\s*>\s*\.transfer-overview-feedback\s*\{[^}]*top:\s*calc\(100%\s*\+\s*8px\)/i);
    expect(styleSource).toMatch(/\.transfer-overview-toolbar-frame\s*>\s*\.transfer-overview-feedback\s*\{[^}]*margin-top:\s*0/i);
  });

  test("overview table body divides available height into three adaptive task rows", () => {
    const stylesPath = resolve(process.cwd(), "src/modules/handover-system/styles.css");
    const source = readFileSync(stylesPath, "utf8");

    expect(source).toMatch(/\.transfer-table__body\s*\{[^}]*display:\s*grid/i);
    expect(source).toMatch(/\.transfer-table__body\s*\{[^}]*grid-template-rows:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/i);
    expect(source).toMatch(/\.transfer-table__row\s*\{[^}]*height:\s*auto/i);
    expect(source).toMatch(/\.transfer-table__row\s*\{[^}]*min-height:\s*0/i);
    expect(source).toMatch(/\.transfer-table__row\s*\{[^}]*max-height:\s*none/i);
    expect(source).not.toMatch(/\.transfer-table__row\s*\{[^}]*height:\s*214px/i);
    expect(source).toMatch(/\.transfer-table__codes\s*\{[^}]*max-height:\s*190px/i);
    expect(source).toMatch(/\.transfer-table__body\s*\{[^}]*overflow:\s*hidden/i);
    expect(source).not.toMatch(/\.transfer-table__body\s*\{[^}]*overflow:\s*auto/i);
    expect(source).not.toMatch(/\.transfer-table__codes\s*\{[^}]*overflow:\s*auto/i);
  });

  test("overview table compresses task columns and centers headers and cells", () => {
    const stylesPath = resolve(process.cwd(), "src/modules/handover-system/styles.css");
    const source = readFileSync(stylesPath, "utf8");

    expect(source).toMatch(/\.transfer-area-shell\s*\{[^}]*width:\s*min\(1760px,\s*100%\)/i);
    expect(source).toMatch(
      /\.transfer-table__head,\s*\.transfer-table__row\s*\{[^}]*grid-template-columns:\s*72px\s+minmax\(150px,\s*0\.65fr\)\s+minmax\(180px,\s*0\.75fr\)\s+minmax\(620px,\s*2\.6fr\)\s+96px/i,
    );
    expect(source).toMatch(/\.transfer-table__head,\s*\.transfer-table__row\s*\{[^}]*text-align:\s*center/i);
    expect(source).toMatch(/\.transfer-table__name\s*\{[^}]*justify-items:\s*center/i);
  });

  test("overview sample codes are a three-column grid with at most four visible rows", () => {
    const stylesPath = resolve(process.cwd(), "src/modules/handover-system/styles.css");
    const source = readFileSync(stylesPath, "utf8");

    expect(source).toMatch(/\.transfer-table__codes\s*\{[^}]*display:\s*grid/i);
    expect(source).toMatch(/\.transfer-table__codes\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/i);
    expect(source).toMatch(/\.transfer-table__codes\s*\{[^}]*grid-template-rows:\s*repeat\(4,\s*40px\)/i);
    expect(source).toMatch(/\.transfer-table__codes\s*\{[^}]*grid-auto-rows:\s*40px/i);
  });

  test("overview sample code rows compress on short viewports instead of clipping the third task", () => {
    const stylesPath = resolve(process.cwd(), "src/modules/handover-system/styles.css");
    const source = readFileSync(stylesPath, "utf8");

    expect(source).toMatch(/@media\s*\(\s*max-height:\s*900px\s*\)\s*\{[\s\S]*\.transfer-table__codes\s*\{[\s\S]*grid-template-rows:\s*repeat\(4,\s*34px\)/i);
    expect(source).toMatch(/@media\s*\(\s*max-height:\s*900px\s*\)\s*\{[\s\S]*\.transfer-sample-code-chip\s*\{[\s\S]*min-height:\s*34px/i);
  });

  test("tray experiment tags use the same compact pill style as dispatch badges", () => {
    const componentPath = resolve(process.cwd(), "src/modules/transfer-workbench/TransferWorkbench.vue");
    const stylesPath = resolve(process.cwd(), "src/modules/handover-system/styles.css");
    const componentSource = readFileSync(componentPath, "utf8");
    const styleSource = readFileSync(stylesPath, "utf8");

    expect(styleSource).toMatch(/\.transfer-tray-experiment-tag\s*\{[^}]*min-height:\s*28px/i);
    expect(styleSource).toMatch(/\.transfer-tray-experiment-tag\s*\{[^}]*padding:\s*4px\s+10px/i);
    expect(styleSource).toMatch(/\.transfer-tray-experiment-tag\s*\{[^}]*border-radius:\s*999px/i);
    expect(styleSource).toMatch(/\.transfer-tray-experiment-tag\s*\{[^}]*font-size:\s*12px/i);
    expect(componentSource).toMatch(/\.transfer-tray-experiment-tag\s*\{[^}]*min-height:\s*28px/i);
    expect(componentSource).toMatch(/\.transfer-tray-experiment-tag\s*\{[^}]*padding:\s*4px\s+10px/i);
    expect(componentSource).toMatch(/\.transfer-tray-experiment-tag\s*\{[^}]*border-radius:\s*999px/i);
    expect(componentSource).toMatch(/\.transfer-tray-experiment-tag\s*\{[^}]*font-size:\s*12px/i);
  });

  test("dispatch result cards use globally loaded dark handover surfaces", () => {
    const componentPath = resolve(process.cwd(), "src/modules/transfer-workbench/TransferDispatchPanel.vue");
    const stylesPath = resolve(process.cwd(), "src/modules/handover-system/styles.css");
    const componentSource = readFileSync(componentPath, "utf8");
    const styleSource = readFileSync(stylesPath, "utf8");

    expect(componentSource).toMatch(/class="[^"]*\btransfer-dispatch-result\b[^"]*"/);
    expect(styleSource).toMatch(/\.transfer-dispatch-result\s*\{[^}]*background:\s*var\(--bg-card\)/i);
    expect(styleSource).toMatch(/\.transfer-dispatch-result\s*\{[^}]*color:\s*var\(--text\)/i);
    expect(styleSource).toMatch(
      /\.transfer-dispatch-summary-card,\s*\.transfer-dispatch-destination-card\s*\{[^}]*background:\s*var\(--bg-card-raised\)/i,
    );
    // Barcode previews intentionally use a white SVG surface; scope this assertion to dispatch cards.
    expect(styleSource).not.toMatch(/\.transfer-dispatch-(?:result|summary-card|destination-card)[^{]*\{[^}]*background:\s*(?:#fff|#ffffff|white)\b/i);
  });
});
