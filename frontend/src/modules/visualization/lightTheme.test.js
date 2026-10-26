import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

const source = readFileSync(resolve(process.cwd(), "src/modules/visualization/lightTheme.css"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "");
const rules = Array.from(source.matchAll(/([^{}]+)\{([^{}]*)\}/g), ([, selector, body]) => ({ selector: selector.trim(), body }));
const splitSelectors = (selector) => {
  let depth = 0;
  return selector.replace(/[(),]/g, (char) => {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    return char === "," && depth === 0 ? "\0" : char;
  }).split("\0").map((item) => item.trim());
};

describe("visualization light-theme contract", () => {
  test("every override is scoped to the light visualization module", () => {
    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) {
      for (const selector of splitSelectors(rule.selector)) {
        expect(selector).toMatch(/^:root\[data-theme="light"\] \.visualization-page(?:\s|$)/);
      }
    }
  });

  test("overrides cannot change layout, typography, motion, or category variables", () => {
    const paintProperty = /^(?:color|background(?:-color|-image)?|border(?:-color)?|box-shadow|text-shadow|outline-color|fill|stroke|--(?:cyan|status-cyan|status-green|status-amber|status-line))$/;
    for (const rule of rules) {
      for (const declaration of rule.body.split(";").map((item) => item.trim()).filter(Boolean)) {
        const property = declaration.slice(0, declaration.indexOf(":")).trim();
        expect(property, `${rule.selector}: ${property}`).toMatch(paintProperty);
      }
    }
    expect(source).not.toMatch(/--(?:schedule-task-color|visual-rank-color|visual-status-color)\s*:/);
  });
});
