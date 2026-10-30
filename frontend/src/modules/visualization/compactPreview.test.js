import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import postcss from "postcss";

const stylesheet = postcss.parse(readFileSync(resolve(process.cwd(), "src/modules/visualization/compactPreview.css"), "utf8"));

describe("overview compact-preview boundaries", () => {
  test("cannot change expanded screens, the outer grid, the card aspect ratio or dark paint", () => {
    const allowedPaint = /^(?:--(?:gap|pad|title|body|small|telemetry-name-size|telemetry-small-size)|display|position|min-height|min-width|height|width|padding(?:-top|-bottom)?|margin-top|gap|grid-template-(?:rows|columns)|font-size|line-height|flex-wrap|align-content|justify-items|text-align|max-width)$/;
    stylesheet.walkRules((rule) => {
      expect(rule.selector).toMatch(/^\.visualization-page \.visual-screen-grid[ >]/);
      expect(rule.selector).not.toBe(".visualization-page .visual-screen-grid");
      rule.walkDecls((declaration) => {
        expect(declaration.prop, rule.selector).toMatch(allowedPaint);
        expect(declaration.prop).not.toBe("aspect-ratio");
      });
    });
  });

  test("only hides dense details or duplicated headings; real summaries, room states and active alarms remain", () => {
    const forbiddenHidden = /(?:visual-lab-status-summary|visual-lab-status-card-head|visual-lab-matrix-screen\.is-compact \.stats|visual-lab-matrix-screen\.is-compact \.badge|visual-analysis-pie-total|visual-analysis-total|visual-staging-overview)/;
    stylesheet.walkRules((rule) => {
      if (rule.nodes.some((node) => node.prop === "display" && node.value === "none")) {
        expect(rule.selector).not.toMatch(forbiddenHidden);
        if (rule.selector.includes("visual-lab-status-alarm")) expect(rule.selector).toContain(".is-empty");
      }
    });
  });
});
