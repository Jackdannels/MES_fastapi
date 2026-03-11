import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

const pagePath = resolve(process.cwd(), "src/pages/LoginPage.vue");

describe("LoginPage structure", () => {
  test("uses useLoginForm and no longer hardcodes demo credentials in the page", () => {
    const source = readFileSync(pagePath, "utf8");

    expect(source).toContain("useLoginForm");
    expect(source).not.toContain('ref("admin")');
    expect(source).not.toContain('ref("123")');
    expect(source).not.toContain("默认账号");
  });
});
