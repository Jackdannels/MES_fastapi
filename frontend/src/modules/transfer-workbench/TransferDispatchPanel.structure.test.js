import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

describe("TransferDispatchPanel structure", () => {
  test("floats dispatch feedback below the scan toolbar without taking panel height", () => {
    const source = readFileSync(resolve(process.cwd(), "src/modules/transfer-workbench/TransferDispatchPanel.vue"), "utf8");

    expect(source).toContain('class="transfer-overview-toolbar transfer-dispatch-toolbar"');
    expect(source).toContain('class="transfer-dispatch-feedback"');
    expect(source).toMatch(/\.transfer-dispatch-toolbar\s*\{[^}]*position:\s*relative;/i);
    expect(source).toMatch(/\.transfer-dispatch-toolbar\s*>\s*\.transfer-dispatch-feedback\s*\{[^}]*position:\s*absolute;/i);
    expect(source).toMatch(/\.transfer-dispatch-toolbar\s*>\s*\.transfer-dispatch-feedback\s*\{[^}]*top:\s*calc\(100%\s*\+\s*8px\);/i);
    expect(source).toMatch(/\.transfer-dispatch-toolbar\s*>\s*\.transfer-dispatch-feedback\s*\{[^}]*margin-top:\s*0;/i);
  });
});
