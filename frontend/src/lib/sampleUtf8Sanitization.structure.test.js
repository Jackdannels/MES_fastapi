import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

const dataPath = resolve(process.cwd(), "../app/data/mes_store.json");
const storageApiPath = resolve(process.cwd(), "src/lib/storageApi.js");
const traceModelPath = resolve(process.cwd(), "src/lib/sampleTraceModel.js");

const blockedTokens = [
  "鏍峰搧缂栧彿閲嶆帓",
  "鏍峰搧缁戝畾浠诲姟",
  "鏍峰搧鐧昏",
  "浠诲姟 ",
  "閫佽揪鏆傚瓨闂",
  "閫佽嚦鏆傚瓨闂",
  "鎺ラ┏鍖",
];

describe("sample utf8 sanitization", () => {
  test("sanitizes persisted sample history text in mes_store", () => {
    const source = readFileSync(dataPath, "utf8");

    blockedTokens.forEach((token) => {
      expect(source).not.toContain(token);
    });
  });

  test("keeps sample sanitization logic in lib sources instead of legacy runtime", () => {
    const storageApiSource = readFileSync(storageApiPath, "utf8");
    const traceModelSource = readFileSync(traceModelPath, "utf8");

    expect(storageApiSource).toContain("SAMPLE_TEXT_REPLACEMENTS");
    expect(storageApiSource).toContain("sanitizeSampleText");
    expect(storageApiSource).toContain("sanitizeSampleCollection");
    expect(traceModelSource).toContain("LEGACY_TEXT_REPLACEMENTS");
    expect(traceModelSource).toContain("sanitizeLegacyText");

    expect(storageApiSource).not.toContain("src/legacy/runtime/actions.js");
    expect(traceModelSource).not.toContain("src/legacy/runtime/actions.js");
  });
});
