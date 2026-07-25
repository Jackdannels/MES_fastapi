import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

describe("laboratory workbench layout", () => {
  const pageSource = readFileSync(resolve(process.cwd(), "src/modules/laboratory/page.vue"), "utf8");
  const stylesSource = readFileSync(resolve(process.cwd(), "src/modules/laboratory/styles.css"), "utf8");

  test("keeps reset red and gives it a dedicated safety column beside login", () => {
    expect(pageSource).toContain('data-testid="laboratory-reset-task"');
    expect(stylesSource).toContain("grid-template-columns: 224px 52px 156px 290px;");
    expect(stylesSource).toContain("background: rgba(255, 107, 90, 0.14);");
    expect(stylesSource).toContain("background: rgba(255, 107, 90, 0.14) !important;");
    expect(stylesSource).toContain("color: var(--danger) !important;");
    expect(stylesSource).toMatch(/\.page-header--laboratory \.action-btn\.laboratory-reset-button:not\(:disabled\)\s*\{[^}]*background:\s*rgba\(127,\s*29,\s*29,\s*0\.78\)\s*!important/i);
    expect(stylesSource).toContain("opacity: 1;");
  });

  test("enlarges labels without changing the action-card minimum height", () => {
    expect(stylesSource).toContain("min-height: 132px;");
    expect(stylesSource).toContain("font-size: 24px;");
  });

  test("removes the tray-flow title and enlarges each flow step", () => {
    expect(pageSource).not.toContain("托盘流程图");
    expect(stylesSource).toContain("minmax(220px, 1fr)");
    expect(stylesSource).toContain("min-height: 112px;");
    expect(stylesSource).toContain("font-size: 20px;");
  });

  test("enlarges task-list modal controls for touch use", () => {
    expect(stylesSource).toMatch(/\.laboratory-task-list-modal \.modal-close\s*\{[^}]*min-width:\s*104px[^}]*min-height:\s*64px/i);
    expect(stylesSource).toMatch(/\.laboratory-task-select-button\s*\{[^}]*min-width:\s*140px[^}]*min-height:\s*64px/i);
    expect(stylesSource).toMatch(/\.laboratory-task-confirm-button\s*\{[^}]*min-height:\s*72px[^}]*min-width:\s*240px/i);
  });

  test("renders reset confirmation as a large warning dialog", () => {
    expect(pageSource).toContain('class="laboratory-reset-modal"');
    expect(pageSource).toContain('class="laboratory-reset-warning-panel" role="alert"');
    expect(pageSource).toMatch(/class="action-btn danger laboratory-reset-modal-button"[^>]*data-testid="laboratory-reset-confirm"/i);
    expect(stylesSource).toMatch(/\.laboratory-reset-modal \.modal-content\s*\{[^}]*width:\s*min\(840px,\s*92vw\)/i);
    expect(stylesSource).toMatch(/\.laboratory-reset-modal-button\s*\{[^}]*min-width:\s*176px[^}]*min-height:\s*64px/i);
    expect(stylesSource).toMatch(/\.laboratory-reset-modal \.action-btn\.danger\s*\{[^}]*background:\s*rgba\(153,\s*27,\s*27,\s*0\.88\)/i);
  });

  test("enlarges compare, install, and ready operation dialogs", () => {
    expect(pageSource).toContain('class="laboratory-operation-modal laboratory-operation-modal--compare"');
    expect(pageSource.match(/class="laboratory-operation-modal"/g)).toHaveLength(2);
    expect(pageSource).toContain("laboratory-operation-modal-button");
    expect(stylesSource).toMatch(/\.laboratory-operation-modal \.modal-content\s*\{[^}]*width:\s*min\(860px,\s*92vw\)[^}]*min-height:\s*360px/i);
    expect(stylesSource).toMatch(/\.laboratory-operation-modal--compare \.modal-content\s*\{[^}]*width:\s*min\(1320px,\s*96vw\)[^}]*max-width:\s*calc\(100vw\s*-\s*24px\)/i);
    expect(stylesSource).toMatch(/\.laboratory-operation-modal-button\s*\{[^}]*min-width:\s*176px[^}]*min-height:\s*64px/i);
    expect(stylesSource).toMatch(/\.laboratory-compare-scan\s*\{[^}]*width:\s*100%[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+var\(--laboratory-compare-side-action-width\)/i);
    expect(stylesSource).toMatch(/\[data-testid="laboratory-compare-modal"\] \.laboratory-compare-scan input\s*\{[^}]*height:\s*72px[^}]*min-height:\s*72px[^}]*font-size:\s*18px/i);
    expect(stylesSource).toMatch(/\.laboratory-compare-scan-button\s*\{[^}]*min-width:\s*220px[^}]*min-height:\s*72px/i);
    expect(pageSource).toContain("laboratory-compare-complete-button");
    expect(stylesSource).toMatch(/\[data-testid="laboratory-compare-modal"\] \.form-actions\s*\{[^}]*width:\s*100%[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/i);
    expect(stylesSource).toMatch(/\.laboratory-compare-complete-button\s*\{[^}]*width:\s*100%[^}]*height:\s*72px[^}]*min-height:\s*72px[^}]*font-size:\s*20px/i);
  });

  test("renders employee login as a large touch-friendly dialog", () => {
    expect(stylesSource).toMatch(/\[data-testid="laboratory-attendance-login-modal"\] \.modal-content\s*\{[^}]*width:\s*min\(920px,\s*94vw\)[^}]*min-height:\s*min\(560px,/i);
    expect(stylesSource).toMatch(/\[data-testid="laboratory-attendance-login-modal"\] \.laboratory-attendance-login-tab\s*\{[^}]*min-height:\s*52px[^}]*font-size:\s*16px/i);
    expect(stylesSource).toMatch(/\[data-testid="laboratory-attendance-login-modal"\] \.form-field input\s*\{[^}]*min-height:\s*56px/i);
  });
});
