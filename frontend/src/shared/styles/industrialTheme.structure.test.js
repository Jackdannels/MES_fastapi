import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

const baseStylesPath = resolve(process.cwd(), "src/shared/styles/base.css");
const shellStylesPath = resolve(process.cwd(), "src/shared/styles/shell.css");
const componentStylesPath = resolve(process.cwd(), "src/shared/styles/components.css");

describe("industrial blackbox theme", () => {
  test("defines the selected blackbox industrial design tokens globally", () => {
    const source = readFileSync(baseStylesPath, "utf8");

    expect(source).toContain("--industrial-accent-rgb");
    expect(source).toContain("#63e6be");
    expect(source).toContain("--radius-panel: 8px");
    expect(source).toContain("--radius-control: 4px");
    expect(source).toMatch(/linear-gradient\(var\(--grid-line\)\s+1px,\s+transparent\s+1px\)/);
    expect(source).toContain("font-variant-numeric: tabular-nums");
  });

  test("applies the industrial tokens to shell chrome without changing layout ownership", () => {
    const source = readFileSync(shellStylesPath, "utf8");

    expect(source).toMatch(/\.sidebar\s*\{[^}]*var\(--bg-panel\)/s);
    expect(source).toMatch(/\.nav a\.active\s*\{[^}]*var\(--industrial-accent-rgb\)/s);
    expect(source).toMatch(/\.action-btn\s*\{[^}]*border-radius:\s*var\(--radius-control\)/s);
    expect(source).toMatch(/\.page-header\s*\{[^}]*var\(--bg-card\)/s);
  });

  test("keeps shared cards tables and form controls on the same industrial surface system", () => {
    const source = readFileSync(componentStylesPath, "utf8");

    expect(source).toMatch(/\.card\s*\{[^}]*border-radius:\s*var\(--radius-panel\)/s);
    expect(source).toMatch(/\.table th\s*\{[^}]*var\(--bg-panel-strong\)/s);
    expect(source).toMatch(/\.form-field input,[\s\S]*?\.form-field textarea\s*\{[^}]*var\(--bg-panel-strong\)/s);
    expect(source).toContain("font-family: var(--font-code)");
  });

  test("applies the light palette to every visualization preview surface", () => {
    const source = readFileSync(baseStylesPath, "utf8");

    expect(source).toMatch(/:root\[data-theme="light"\] \.visual-board\s*{[^}]*var\(--screen-bg\)/s);
    expect(source).toContain(':root[data-theme="light"] .visual-board .visual-schedule-lab-name');
    expect(source).toContain(':root[data-theme="light"] .visual-board .visual-task-plan-variant');
    expect(source).toContain(':root[data-theme="light"] .visualization-page .visual-lab-matrix-screen');
    expect(source).toContain(':root[data-theme="light"] .visualization-page .visual-lab-matrix-screen .card');
    expect(source).not.toContain(':root[data-theme="light"] .visual-board .visual-lab-matrix-screen');
    expect(source).toContain(':root[data-theme="light"] .visual-board .visual-staging-task-rail');
    expect(source).toContain(':root[data-theme="light"] .visual-board .visual-analysis-panel');
    expect(source).toContain(':root[data-theme="light"] .visual-board .visual-board-metrics div');
    expect(source).toContain(':root[data-theme="light"] .visual-board .visual-staging-overview-item');
    expect(source).toMatch(/:root\[data-theme="light"\] \.visual-board \.visual-task-plan-empty\s*\{[^}]*linear-gradient/s);
    expect(source).toMatch(/:root\[data-theme="light"\] \.visualization-page\s*\{[^}]*--screen-teal:\s*var\(--accent\)/s);
    expect(source).toContain(':root[data-theme="light"] .visual-board .visual-staging-kind-summary .kind-current');
  });

  test("replaces the dark system pagination footer wash in light mode", () => {
    const source = readFileSync(baseStylesPath, "utf8");

    expect(source).toMatch(/:root\[data-theme="light"\] \.system-pagination-footer\s*\{[^}]*linear-gradient/s);
    expect(source).toMatch(/:root\[data-theme="light"\] \.system-pagination-footer\s*\{[^}]*var\(--border-strong\)/s);
  });
});
