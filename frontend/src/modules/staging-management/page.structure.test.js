import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

describe("staging management page structure", () => {
  test("stock-in scan input supports inline submit and Enter-key submit", () => {
    const source = readFileSync(resolve(process.cwd(), "src/modules/staging-management/page.vue"), "utf8");

    expect(source).toContain('data-testid="zancun-scan-submit"');
    expect(source).toContain('@keyup="handleScanKeyup"');
    expect(source).toContain('event?.key !== "Enter"');
    expect(source).toContain('await handleScanEnter();');
    expect(source).toContain('{{ activeScanMode === "stockIn" ? "入库完成" : "扫码完成" }}');
  });
});
