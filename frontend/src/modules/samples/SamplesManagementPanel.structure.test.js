import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

const panelPath = resolve(process.cwd(), "src/modules/samples/SamplesManagementPanel.vue");

describe("SamplesManagementPanel structure", () => {
  test("renders the sample process area via the shared SampleProcessPanel component", () => {
    const source = readFileSync(panelPath, "utf8");

    expect(source).toContain("SampleProcessPanel");
    expect(source).not.toContain("<h3>样品流程管理</h3>");
    expect(source).not.toContain('data-testid="samples-process-task-select"');
  });
});
