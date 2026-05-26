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
    expect(source).toMatch(/\.visual-schedule-slot\.is-planned,\s*\.visual-schedule-slot\.is-idle\s*{[^}]*align-content:\s*stretch;[^}]*grid-auto-rows:\s*minmax\(0,\s*1fr\);[^}]*padding:\s*0;/s);
    expect(source).toMatch(/\.visual-schedule-slot\.is-planned \.visual-schedule-task\s*{[^}]*width:\s*100%;[^}]*height:\s*100%;[^}]*justify-items:\s*center;[^}]*text-align:\s*center;[^}]*border-left:\s*0;/s);
    expect(source).toMatch(/\.visual-schedule-slot\.is-planned \.visual-schedule-task strong\s*{[^}]*max-width:\s*100%;[^}]*font-size:\s*13px;/s);
    expect(source).toMatch(/\.visual-schedule-slot\.is-idle \.visual-schedule-idle\s*{[^}]*place-items:\s*center;[^}]*width:\s*100%;[^}]*height:\s*100%;[^}]*font-size:\s*13px;/s);
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
    expect(source).toMatch(/\.visual-board\.is-layout-a \.visual-lab-panel\s*{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\) minmax\(0,\s*1fr\) minmax\(220px,\s*0\.42fr\);[^}]*grid-template-rows:\s*minmax\(32px,\s*auto\) minmax\(34px,\s*auto\) minmax\(160px,\s*1fr\) minmax\(42px,\s*auto\);/s);
    expect(source).toMatch(/\.visual-board\.is-layout-a \.visual-tray-flow-list\s*{[^}]*grid-auto-rows:\s*minmax\(160px,\s*1fr\);/s);
    expect(source).toMatch(/\.visual-board\.is-layout-a \.visual-lab-status-row\s*{[^}]*grid-column:\s*1 \/ span 2;/s);
    expect(source).toMatch(/\.visual-board\.is-layout-a \.visual-ok-strip,\s*\.visual-board\.is-layout-a \.visual-alert-strip\s*{[^}]*grid-column:\s*3;/s);
    expect(source).toMatch(/\.visual-board\.is-layout-a \.visual-flow-line\s*{[^}]*grid-template-rows:\s*repeat\(2,\s*minmax\(54px,\s*auto\)\);/s);
    expect(source).toMatch(/\.visual-board\.is-layout-a \.visual-lab-switch-options\s*{[^}]*overflow-x:\s*auto;/s);
  });
});
