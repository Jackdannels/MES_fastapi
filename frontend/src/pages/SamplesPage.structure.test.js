import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

const pagePath = resolve(process.cwd(), "src/pages/SamplesPage.vue");

describe("SamplesPage structure", () => {
  test("does not keep legacy sample intake and trace hooks in the page file", () => {
    const source = readFileSync(pagePath, "utf8");

    expect(source).not.toContain('data-form="sample-intake"');
    expect(source).not.toContain('data-form="sample-trace"');
    expect(source).not.toContain('data-action="sample-submit"');
    expect(source).not.toContain('data-action="sample-draft"');
    expect(source).not.toContain('data-action="sample-trace-run"');
    expect(source).not.toContain('data-action="sample-trace-reset"');
    expect(source).not.toContain('data-sample-task-select="intake"');
    expect(source).not.toContain('id="sample-trace-summary"');
    expect(source).not.toContain('id="sample-trace-timeline"');
    expect(source).not.toContain('data-tab-group="samples"');
    expect(source).not.toContain('data-tab-panel="sample-flow"');
    expect(source).not.toContain('data-tab-panel="sample-staging"');
    expect(source).not.toContain('data-tab-btn="sample-flow"');
    expect(source).not.toContain('data-tab-btn="sample-staging"');
  });
});
