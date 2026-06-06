import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

const visualizationStylesPath = resolve(process.cwd(), "src/modules/visualization/styles.css");

describe("visualization styles", () => {
  test("lab-process single preview fits viewport height and avoids a duplicate outer frame", () => {
    const source = readFileSync(visualizationStylesPath, "utf8");

    expect(source).toMatch(/\.visual-preview-shell\.is-screen-only\s*{[^}]*width:\s*100vw;[^}]*height:\s*100dvh;/s);
    expect(source).toMatch(/\.visual-expanded-screen\.is-screen-only\s*{[^}]*aspect-ratio:\s*auto;[^}]*border:\s*0;/s);
    expect(source).toMatch(/\.visual-expanded-screen\.is-lab-process\s*{[^}]*border-color:\s*transparent;/s);
    expect(source).toMatch(/\.visual-expanded-screen\.is-lab-process\s*{[^}]*box-shadow:\s*none;/s);
  });

  test("schedule screen grid compresses laboratory rows inside the 1080p screen frame", () => {
    const source = readFileSync(visualizationStylesPath, "utf8");

    expect(source).toContain("grid-template-rows: 28px repeat(var(--visual-schedule-row-count), minmax(0, 1fr))");
    expect(source).toMatch(/\.visual-schedule-lab-name,\s*\.visual-schedule-cell\s*{[^}]*min-height:\s*0;/s);
    expect(source).toMatch(/\.visual-schedule-slot\s*{[^}]*align-content:\s*stretch;[^}]*justify-items:\s*stretch;[^}]*grid-auto-rows:\s*minmax\(0,\s*1fr\);[^}]*padding:\s*0;[^}]*border-left:\s*0;/s);
    expect(source).toMatch(/\.visual-schedule-task\s*{[^}]*width:\s*100%;[^}]*height:\s*100%;[^}]*align-content:\s*center;[^}]*justify-items:\s*center;[^}]*text-align:\s*center;[^}]*border-left:\s*0;/s);
    expect(source).toMatch(/\.visual-schedule-task strong\s*{[^}]*max-width:\s*100%;[^}]*font-size:\s*14px;/s);
    expect(source).toMatch(/\.visual-schedule-task span\s*{[^}]*max-width:\s*100%;[^}]*font-size:\s*13px;[^}]*font-weight:\s*900;/s);
    expect(source).toMatch(/\.visual-schedule-task small\s*{[^}]*max-width:\s*100%;[^}]*font-size:\s*12px;[^}]*font-weight:\s*900;/s);
    expect(source).toMatch(/\.visual-schedule-slot\.state-running\s*{[^}]*background:\s*rgba\(20,\s*83,\s*45,\s*0\.62\);/s);
    expect(source).toMatch(/\.visual-schedule-slot\.is-idle \.visual-schedule-idle\s*{[^}]*place-items:\s*center;[^}]*width:\s*100%;[^}]*height:\s*100%;[^}]*font-size:\s*13px;/s);
    expect(source).toMatch(/\.visual-schedule-day\s*{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);[^}]*justify-items:\s*center;/s);
    expect(source).toMatch(/\.visual-schedule-day small\s*{[^}]*position:\s*absolute;[^}]*right:\s*10px;/s);
  });

  test("visualization cells constrain long text inside their panels", () => {
    const source = readFileSync(visualizationStylesPath, "utf8");

    expect(source).toMatch(/\.visual-lab-switch-option strong,\s*\.visual-lab-switch-option small\s*{[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap;/s);
    expect(source).toMatch(/\.visual-schedule-grid-head\s*{[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap;/s);
    expect(source).toMatch(/\.visual-schedule-task strong\s*{[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap;/s);
  });

  test("lab process layout reserves space for complete tray flow diagrams", () => {
    const source = readFileSync(visualizationStylesPath, "utf8");

    expect(source).toContain(".visual-board.is-layout-a");
    expect(source).toMatch(/\.visual-board\.is-layout-a \.visual-flow-line,[^{]+\.visual-board\.is-layout-c \.visual-flow-line\s*{[^}]*grid-template-columns:\s*repeat\(6,\s*minmax\(0,\s*1fr\)\);/s);
  });

  test("layout A keeps fixed vertical budget so content does not collapse", () => {
    const source = readFileSync(visualizationStylesPath, "utf8");

    expect(source).toMatch(/\.visual-board\.is-layout-a \.visual-board-metrics\s*{[^}]*display:\s*none;/s);
    expect(source).toMatch(/\.visual-board\.is-layout-a \.visual-lab-panels\s*{[^}]*grid-template-rows:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/s);
    expect(source).toMatch(/\.visual-board\.is-layout-a \.visual-lab-panel\s*{[^}]*grid-template-columns:\s*minmax\(230px,\s*0\.22fr\) minmax\(0,\s*1fr\) minmax\(260px,\s*0\.24fr\);[^}]*grid-template-rows:\s*minmax\(32px,\s*auto\) minmax\(0,\s*1fr\) minmax\(42px,\s*auto\);/s);
    expect(source).toMatch(/\.visual-board\.is-layout-a \.visual-lab-switchboard\s*{[^}]*grid-column:\s*1;[^}]*grid-row:\s*2 \/ span 2;/s);
    expect(source).toMatch(/\.visual-board\.is-layout-a \.visual-tray-flow-list\s*{[^}]*grid-column:\s*2;[^}]*grid-row:\s*2 \/ span 2;/s);
    expect(source).toMatch(/\.visual-board\.is-layout-a \.visual-lab-status-row\s*{[^}]*grid-column:\s*3;[^}]*grid-row:\s*2;/s);
    expect(source).toMatch(/\.visual-board\.is-layout-a \.visual-ok-strip,\s*\.visual-board\.is-layout-a \.visual-alert-strip\s*{[^}]*grid-column:\s*3;/s);
    expect(source).toMatch(/\.visual-board\.is-layout-a \.visual-flow-line\s*{[^}]*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\);[^}]*grid-template-rows:\s*repeat\(4,\s*minmax\(60px,\s*1fr\)\);/s);
    expect(source).toMatch(/\.visual-board\.is-layout-a \.visual-flow-step:nth-child\(5\)\s*{[^}]*grid-column:\s*4;[^}]*grid-row:\s*2;/s);
    expect(source).toMatch(/\.visual-board\.is-layout-a \.visual-flow-step:nth-child\(8\)\s*{[^}]*grid-column:\s*1;[^}]*grid-row:\s*2;/s);
    expect(source).toMatch(/\.visual-board\.is-layout-a \.visual-flow-step:nth-child\(2\)::before,[^{]+\.visual-board\.is-layout-a \.visual-flow-step:nth-child\(12\)::before\s*{[^}]*left:\s*calc\(-50% - 6px\);[^}]*height:\s*2px;/s);
    expect(source).toMatch(/\.visual-board\.is-layout-a \.visual-flow-step:nth-child\(6\)::before,[^{]+\.visual-board\.is-layout-a \.visual-flow-step:nth-child\(8\)::before\s*{[^}]*right:\s*calc\(-50% - 6px\);[^}]*height:\s*2px;/s);
    expect(source).toMatch(/\.visual-board\.is-layout-a \.visual-flow-step:nth-child\(5\)::before,\s*\.visual-board\.is-layout-a \.visual-flow-step:nth-child\(9\)::before,\s*\.visual-board\.is-layout-a \.visual-flow-step:nth-child\(13\)::before\s*{[^}]*left:\s*50%;[^}]*width:\s*2px;[^}]*height:\s*calc\(100% \+ 10px\);/s);
    expect(source).toMatch(/\.visual-board\.is-layout-a \.visual-flow-step\s*{[^}]*min-height:\s*60px;[^}]*padding:\s*4px 8px;[^}]*border:\s*0;[^}]*background:\s*transparent;/s);
    expect(source).toMatch(/\.visual-board\.is-layout-a \.visual-lab-switchboard\s*{[^}]*grid-auto-rows:\s*minmax\(0,\s*1fr\);/s);
    expect(source).toMatch(/\.visual-board\.is-layout-a \.visual-lab-switch-group\s*{[^}]*grid-template-rows:\s*auto minmax\(0,\s*1fr\);[^}]*min-height:\s*0;/s);
    expect(source).toMatch(/\.visual-board\.is-layout-a \.visual-lab-switch-options\s*{[^}]*overflow-x:\s*hidden;[^}]*overflow-y:\s*auto;[^}]*touch-action:\s*pan-y;/s);
  });

  test("layout A connects vertical flow turns across stretched rows and enlarges step labels", () => {
    const source = readFileSync(visualizationStylesPath, "utf8");

    expect(source).toMatch(/\.visual-board\.is-layout-a \.visual-flow-step\s*{[^}]*height:\s*100%;/s);
    expect(source).toMatch(/\.visual-board\.is-layout-a \.visual-flow-step:nth-child\(5\)::before,\s*\.visual-board\.is-layout-a \.visual-flow-step:nth-child\(9\)::before,\s*\.visual-board\.is-layout-a \.visual-flow-step:nth-child\(13\)::before\s*{[^}]*top:\s*calc\(-100% - 10px \+ 18px\);[^}]*height:\s*calc\(100% \+ 10px\);/s);
    expect(source).toMatch(/\.visual-board\.is-layout-a \.visual-flow-step strong\s*{[^}]*font-size:\s*15px;/s);
    expect(source).toMatch(/\.visual-board\.is-layout-a \.visual-flow-step small\s*{[^}]*font-size:\s*13px;/s);
  });

  test("layout A connects manufacturer return below post-experiment staging for long flows", () => {
    const source = readFileSync(visualizationStylesPath, "utf8");

    expect(source).toMatch(/\.visual-board\.is-layout-a \.visual-flow-step:nth-child\(13\)\s*{[^}]*grid-column:\s*4;[^}]*grid-row:\s*4;/s);
    expect(source).toMatch(/\.visual-board\.is-layout-a \.visual-flow-step:nth-child\(14\)\s*{[^}]*grid-column:\s*3;[^}]*grid-row:\s*4;/s);
    expect(source).toMatch(/\.visual-board\.is-layout-a \.visual-flow-step:nth-child\(15\)\s*{[^}]*grid-column:\s*2;[^}]*grid-row:\s*4;/s);
    expect(source).toMatch(/\.visual-board\.is-layout-a \.visual-flow-step:nth-child\(16\)\s*{[^}]*grid-column:\s*1;[^}]*grid-row:\s*4;/s);
    expect(source).toMatch(/\.visual-board\.is-layout-a \.visual-flow-step:nth-child\(14\)::before,\s*\.visual-board\.is-layout-a \.visual-flow-step:nth-child\(15\)::before,\s*\.visual-board\.is-layout-a \.visual-flow-step:nth-child\(16\)::before\s*{[^}]*right:\s*calc\(-50% - 6px\);[^}]*height:\s*2px;/s);
  });

  test("layout A makes task and tray switch text easier to read", () => {
    const source = readFileSync(visualizationStylesPath, "utf8");

    expect(source).toMatch(/\.visual-board\.is-layout-a \.visual-lab-switch-group > span\s*{[^}]*font-size:\s*14px;/s);
    expect(source).toMatch(/\.visual-board\.is-layout-a \.visual-lab-switch-option strong\s*{[^}]*font-size:\s*15px;/s);
    expect(source).toMatch(/\.visual-board\.is-layout-a \.visual-lab-switch-option small\s*{[^}]*font-size:\s*13px;/s);
  });

  test("layout A enlarges the lab switch action button", () => {
    const source = readFileSync(visualizationStylesPath, "utf8");

    expect(source).toMatch(/\.visual-board\.is-layout-a \.visual-lab-cycle\s*{[^}]*min-height:\s*34px;[^}]*padding:\s*0 12px;[^}]*font-size:\s*14px;/s);
  });

  test("staging sample screen defines full and compact industrial board layouts", () => {
    const source = readFileSync(visualizationStylesPath, "utf8");

    expect(source).toContain(".visual-staging-board");
    expect(source).toContain(".visual-staging-overview");
    expect(source).toMatch(/\.visual-staging-layout\s*{[^}]*grid-template-columns:\s*minmax\(220px,\s*0\.23fr\) minmax\(0,\s*1fr\) minmax\(260px,\s*0\.26fr\);/s);
    expect(source).toMatch(/\.visual-staging-main\s*{[^}]*grid-template-columns:\s*minmax\(240px,\s*0\.34fr\) minmax\(0,\s*1fr\);[^}]*grid-template-rows:\s*auto minmax\(0,\s*1fr\);/s);
    expect(source).toMatch(/\.visual-staging-tray-switch\s*{[^}]*grid-column:\s*1;[^}]*grid-row:\s*2;[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);[^}]*max-height:\s*none;/s);
    expect(source).toMatch(/\.visual-staging-tray-detail\s*{[^}]*grid-column:\s*2;[^}]*grid-row:\s*2;/s);
    expect(source).toMatch(/\.visual-staging-sample-grid\s*{[^}]*grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(150px,\s*1fr\)\);/s);
    expect(source).toMatch(/\.visual-staging-task-option,\s*\.visual-staging-tray-option\s*{[^}]*min-height:\s*58px;/s);
    expect(source).toContain(".visual-staging-capacity");
    expect(source).toContain(".visual-staging-capacity-ticks");
    expect(source).toContain(".visual-staging-capacity-tick");
    expect(source).toContain(".visual-staging-low-stock");
    expect(source).toContain(".visual-staging-modal");
    expect(source).toMatch(/\.visual-board\.is-compact \.visual-staging-layout\s*{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\) minmax\(120px,\s*0\.38fr\);/s);
  });

  test("analysis screen keeps custom time filtering in one row and reserves full-screen chart space", () => {
    const source = readFileSync(visualizationStylesPath, "utf8");

    expect(source).toContain(".visual-analysis-board");
    expect(source).toMatch(/\.visual-analysis-filter-row\s*{[^}]*display:\s*flex;[^}]*flex-wrap:\s*nowrap;/s);
    expect(source).toMatch(/\.visual-analysis-layout\s*{[^}]*grid-template-columns:\s*minmax\(430px,\s*0\.4fr\) minmax\(0,\s*0\.6fr\);[^}]*grid-template-rows:\s*minmax\(0,\s*1fr\) minmax\(128px,\s*0\.16fr\);/s);
    expect(source).toMatch(/\.visual-analysis-product-panel\s*{[^}]*grid-template-columns:\s*minmax\(640px,\s*0\.58fr\) minmax\(360px,\s*0\.42fr\);/s);
    expect(source).toMatch(/\.visual-analysis-custom-menu\s*{[^}]*position:\s*absolute;[^}]*right:\s*0;/s);
    expect(source).toMatch(/\.visual-analysis-top\s*{[^}]*z-index:\s*20;/s);
    expect(source).toMatch(/\.visual-analysis-custom-menu\s*{[^}]*z-index:\s*40;/s);
    expect(source).toMatch(/\.visual-analysis-picker-panel\.is-calendar,\s*\.visual-analysis-picker-panel\.is-range\s*{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/s);
    expect(source).toContain(".visual-analysis-calendar-wheel-panel");
    expect(source).toMatch(/\.visual-analysis-calendar-wheel-panel\s*{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\);/s);
    expect(source).toMatch(/\.visual-analysis-calendar-wheel-options\s*{[^}]*height:\s*120px;[^}]*overflow:\s*hidden;/s);
    expect(source).toMatch(/\.visual-analysis-calendar-wheel-track\s*{[^}]*transform:\s*translateY\(calc\(var\(--visual-wheel-index,\s*0\) \* -32px\)\);/s);
    expect(source).toContain(".visual-analysis-calendar-arrow");
    const closeZIndex = Number(source.match(/\.visual-screen-close\s*{[^}]*z-index:\s*(\d+);/s)?.[1] || 0);
    const customMenuZIndex = Number(source.match(/\.visual-analysis-custom-menu\s*{[^}]*z-index:\s*(\d+);/s)?.[1] || 0);
    expect(closeZIndex).toBeGreaterThan(customMenuZIndex);
  });
});
