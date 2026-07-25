import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

const stylesPath = resolve(process.cwd(), "src/shared/styles/components.css");

describe("shared table styles", () => {
  test("centers table headers and cells by default", () => {
    const source = readFileSync(stylesPath, "utf8");

    expect(source).toMatch(/\.table th\s*\{[^}]*text-align:\s*center/i);
    expect(source).toMatch(/\.table td\s*\{[^}]*text-align:\s*center/i);
    expect(source).not.toMatch(/text-align:\s*middle/i);
  });

  test("keeps the custom calendar compact enough for modal forms", () => {
    const source = readFileSync(stylesPath, "utf8");

    expect(source).toMatch(/\.picker-only-calendar\s*\{[^}]*position:\s*fixed/i);
    expect(source).toMatch(/\.picker-only-calendar\s*\{[^}]*width:\s*min\(292px,\s*calc\(100vw - 24px\)\)/i);
    expect(source).toMatch(/\.picker-only-calendar__day\s*\{[^}]*height:\s*30px/i);
    expect(source).toMatch(/\.picker-only-calendar--datetime\s*\{[^}]*width:\s*min\(360px,\s*calc\(100vw - 24px\)\)/i);
    expect(source).toMatch(/\.picker-only-time__wheel\s*\{[^}]*grid-template-rows:\s*repeat\(5,\s*28px\)/i);
    expect(source).toMatch(/\.picker-only-time__wheel::before\s*\{[^}]*transform:\s*translateY\(-50%\)/i);
  });

  test("renders the error-sample workflow in a large scannable dialog", () => {
    const source = readFileSync(stylesPath, "utf8");

    expect(source).toMatch(/\.modal-content\.tray-error-sample-modal-content\s*\{[^}]*width:\s*min\(960px,\s*94vw\)[^}]*min-height:\s*min\(520px,/i);
    expect(source).toMatch(/\.tray-error-sample-input\s*\{[^}]*min-height:\s*56px[^}]*font-size:\s*16px/i);
    expect(source).toMatch(/\.tray-error-sample-query\s*\{[^}]*min-width:\s*180px[^}]*min-height:\s*56px/i);
  });
});
