import { describe, expect, test } from "vitest";

import { buildCode128Svg } from "./barcode.js";

describe("buildCode128Svg", () => {
  test("renders a Code128 svg with varying bar widths", () => {
    const svg = buildCode128Svg("SYLU-2026-03-001-TP-001");

    expect(svg).toContain("<svg");
    expect(svg).toMatch(/<rect[^>]+width="4"/);
    expect(svg).toMatch(/aria-label="SYLU-2026-03-001-TP-001"/);
  });

  test("replaces non-printable characters before encoding", () => {
    const svg = buildCode128Svg("TP-001\u0001");

    expect(svg).toContain('aria-label="TP-001-"');
    expect(svg).not.toContain("\u0001");
  });
});
