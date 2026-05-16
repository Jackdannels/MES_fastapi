import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

const storageApiPath = resolve(process.cwd(), "src/lib/storageApi.js");
const traceModelPath = resolve(process.cwd(), "src/modules/samples/sampleTraceModel.js");
const storageBackendPath = resolve(process.cwd(), "../app/core/storage_backend.py");

describe("sample utf8 sanitization", () => {
  test("moves sample sanitization logic to backend storage instead of frontend render helpers", () => {
    const storageApiSource = readFileSync(storageApiPath, "utf8");
    const traceModelSource = readFileSync(traceModelPath, "utf8");
    const storageBackendSource = readFileSync(storageBackendPath, "utf8");

    expect(storageBackendSource).toContain("SAMPLE_TEXT_REPLACEMENTS");
    expect(storageBackendSource).toContain("_sanitize_sample_text");
    expect(storageBackendSource).toContain("_sanitize_sample_collection");

    expect(storageApiSource).not.toContain("SAMPLE_TEXT_REPLACEMENTS");
    expect(storageApiSource).not.toContain("sanitizeSampleText");
    expect(storageApiSource).not.toContain("sanitizeSampleCollection");
    expect(traceModelSource).not.toContain("LEGACY_TEXT_REPLACEMENTS");
    expect(traceModelSource).not.toContain("sanitizeLegacyText");

    expect(storageApiSource).not.toContain("src/legacy/runtime/actions.js");
    expect(traceModelSource).not.toContain("src/legacy/runtime/actions.js");
  });
});
