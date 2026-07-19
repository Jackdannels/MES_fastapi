import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

describe("staging and appearance layout options preview", () => {
  const source = readFileSync(resolve(process.cwd(), "public/staging-appearance-layout-options.html"), "utf8");

  test("offers three schemes and both storage-room previews", () => {
    expect(source).toContain('data-room="staging"');
    expect(source).toContain('data-room="appearance"');
    expect(source).toContain('data-option="a"');
    expect(source).toContain('data-option="b"');
    expect(source).toContain('data-option="c"');
  });

  test("keeps only the three requested fields on each tray card", () => {
    expect(source).toContain("tray-card__task");
    expect(source).toContain("tray-card__qty");
    expect(source).not.toMatch(/<span>托盘编号<\/span>/);
    expect(source).not.toMatch(/<span>任务编号<\/span>/);
    expect(source).not.toMatch(/<span>样品数量<\/span>/);
    expect(source).not.toContain("暂存间控制台");
    expect(source).not.toContain("标准流程");
    expect(source).not.toContain("实验类型");
    expect(source).not.toContain("当前位置");
    expect(source).not.toContain("允许暂存");
  });

  test("caps the preview at five trays and locks the viewport", () => {
    expect(source).toContain("trays.slice(0, 5)");
    expect(source).toMatch(/html, body\s*\{[^}]*overflow:\s*hidden/i);
    expect(source).toContain("1920 × 1080 · 100%");
  });

  test("uses two columns and keeps the tray identifier visually dominant", () => {
    expect(source).toMatch(/\.option-a \.tray-grid,[\s\S]*grid-template-columns:\s*repeat\(2,/i);
    expect(source).toMatch(/\.tray-card__field strong[^}]*font:\s*800 clamp\(29px/i);
    expect(source).toMatch(/\.tray-card__task strong[^}]*font-size:\s*clamp\(17px/i);
    expect(source).toMatch(/\.tray-card__qty strong[^}]*font-size:\s*clamp\(22px/i);
  });
});
