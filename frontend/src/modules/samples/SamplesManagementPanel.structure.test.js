import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

const panelPath = resolve(process.cwd(), "src/modules/samples/SamplesManagementPanel.vue");

describe("SamplesManagementPanel structure", () => {
  test("renders the shared pre-allocation workbench and removes lifecycle trace", () => {
    const source = readFileSync(panelPath, "utf8");

    expect(source).toContain("TransferWorkbench");
    expect(source).toContain('mode="pre-allocation"');
    expect(source).not.toContain("SampleProcessPanel");
    expect(source).not.toContain("样品全生命周期追踪");
    expect(source).toContain("样品流转与状态");
    expect(source).toContain("暂存间派发");
  });
});
