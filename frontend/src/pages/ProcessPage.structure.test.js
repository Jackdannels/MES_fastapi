import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

const pagePath = resolve(process.cwd(), "src/pages/ProcessPage.vue");

describe("ProcessPage structure", () => {
  test("delegates page state to useProcessLabs", () => {
    const source = readFileSync(pagePath, "utf8");

    expect(source).toContain("useProcessLabs");
    expect(source).not.toContain("useStorageSnapshot");
    expect(source).not.toContain("buildProcessLabCards");
    expect(source).not.toContain("onMounted(loadLabStatus)");
  });
});
