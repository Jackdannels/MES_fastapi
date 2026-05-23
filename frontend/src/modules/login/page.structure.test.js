import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

const pagePath = resolve(process.cwd(), "src/modules/login/page.vue");

describe("LoginPage structure", () => {
  test("uses useLoginForm and no longer hardcodes demo credentials in the page", () => {
    const source = readFileSync(pagePath, "utf8");

    expect(source).toContain("useLoginForm");
    expect(source).toContain("接驳区系统");
    expect(source).toContain("暂存间系统");
    expect(source).toContain("试验室操作台");
    expect(source).toContain("LABORATORY_OPTIONS");
    expect(source).toContain("selectedLabName");
    expect(source).not.toContain("盐雾试验室操作台");
    expect(source).not.toContain('ref("admin")');
    expect(source).not.toContain('ref("123")');
    expect(source).not.toContain("默认账号");
  });
});
