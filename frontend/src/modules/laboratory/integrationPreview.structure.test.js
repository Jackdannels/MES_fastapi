import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

describe("laboratory workbench integration preview", () => {
  const previewPath = resolve(process.cwd(), "public/laboratory-workbench-integration-options.html");
  const source = readFileSync(previewPath, "utf8");

  test("offers three switchable integrated workbench schemes", () => {
    expect(source.match(/role="tab"/g)).toHaveLength(3);
    expect(source.match(/class="scheme-panel"/g)).toHaveLength(3);
    expect(source).toContain("冲击一室试验室操作台");
    expect(source).toMatch(/id="panel-a"[\s\S]*?<div class="terminal-identity">\s*<h2>冲击一室试验室操作台<\/h2>/);
    expect(source).toContain("方案 B · 主副标题");
    expect(source).toContain("方案 C · 标识条与标签");
  });

  test("places reset before login with a deliberate safety gap and matching button style", () => {
    expect(source.match(/class="terminal-button reset-control"[^>]*>重置试验室任务/g)).toHaveLength(3);
    expect(source.match(/class="terminal-button"[^>]*>试验间登录/g)).toHaveLength(3);
    expect(source).toMatch(/\.reset-control\s*\{[^}]*margin-right:\s*28px/i);
    expect(source).toMatch(/\.reset-control\s*\{[^}]*background:\s*rgba\(255,\s*107,\s*90,\s*0\.14\)/i);
  });

  test("fits the comparison interface in a 1920x1080 viewport without page scrolling", () => {
    expect(source).toContain("1920 × 1080 · 100%");
    expect(source).toMatch(/\.page\s*\{[^}]*min-height:\s*calc\(100dvh\s*-\s*36px\)/i);
    expect(source).toMatch(/@media\s*\(min-width:\s*1501px\)\s*and\s*\(min-height:\s*821px\)[\s\S]*html,[\s\S]*body\s*\{[^}]*overflow:\s*hidden/i);
  });
});
