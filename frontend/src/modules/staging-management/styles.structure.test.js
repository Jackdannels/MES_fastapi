import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

describe("staging management styles", () => {
  test("matches the laboratory header action size for error handling and logout", () => {
    const source = readFileSync(resolve(process.cwd(), "src/modules/staging-management/styles.css"), "utf8");

    expect(source).toMatch(/body:has\(\.staging-management-page\) \.page-header \.header-actions \.action-btn\s*\{[^}]*min-height:\s*64px[^}]*padding-inline:\s*24px[^}]*font-size:\s*24px/i);
  });

  test("removes the duplicate metric and enlarges the two inventory column headers", () => {
    const source = readFileSync(resolve(process.cwd(), "src/modules/staging-management/styles.css"), "utf8");

    expect(source).not.toContain(".zancun-current-view");
    expect(source).not.toContain(".zancun-actions-header");
    expect(source).toMatch(/\.zancun-inventory-column__head\s+h4\s*\{[^}]*font-size:\s*clamp\(20px/i);
    expect(source).toMatch(/\.zancun-inventory-column__title--current\s*\{[^}]*color:\s*var\(--accent\)/i);
    expect(source).toMatch(/\.zancun-inventory-column__title--planned\s*\{[^}]*color:\s*var\(--text\)/i);
  });

  test("keeps both inventory columns equally aligned and strengthens tray hierarchy", () => {
    const source = readFileSync(resolve(process.cwd(), "src/modules/staging-management/styles.css"), "utf8");

    expect(source).toMatch(/\.zancun-inventory-columns\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/i);
    expect(source).toMatch(/\.zancun-console-slot__tray-code\s*\{[^}]*font-size:\s*22px/i);
    expect(source).toMatch(/\.zancun-console-slot__task-code\.muted\s*\{[^}]*color:\s*var\(--accent-2\)[^}]*font-size:\s*16px/i);
    expect(source).toMatch(/\.zancun-current-staging-pagination\s*>\s*\.task-list-pagination__step,[\s\S]*?\.zancun-planned-inbound-pagination\s*>\s*\.task-list-pagination__step\s*\{[^}]*width:\s*52px[^}]*min-height:\s*48px/i);
  });

  test("syncs corresponding inventory row heights across the two columns", () => {
    const source = readFileSync(resolve(process.cwd(), "src/modules/staging-management/styles.css"), "utf8");

    expect(source).toMatch(/\.zancun-inventory-columns\s*\{[^}]*grid-template-rows:\s*auto\s+repeat\(5,\s*minmax\(var\(--zancun-console-slot-height\),\s*auto\)\)/i);
    expect(source).toMatch(/\.zancun-inventory-column\s*\{[^}]*grid-row:\s*1\s+\/\s+span\s+6[^}]*grid-template-rows:\s*subgrid/i);
    expect(source).toMatch(/\.zancun-console-list\s*\{[^}]*display:\s*contents/i);
    expect(source).toMatch(/\.zancun-console-slot\s*\{[^}]*height:\s*100%/i);
    expect(source).toMatch(/\.zancun-console-slot--placeholder,\s*[^}]*\.zancun-console-placeholder\s*\{[^}]*height:\s*100%/i);
  });

  test("uses a unified two-column touch action deck with full-card buttons", () => {
    const source = readFileSync(resolve(process.cwd(), "src/modules/staging-management/styles.css"), "utf8");

    expect(source).toMatch(/\.zancun-actions-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)[^}]*padding:\s*14px/i);
    expect(source).toMatch(/\.zancun-touch-action\s*\{[^}]*min-height:\s*144px[^}]*touch-action:\s*manipulation/i);
    expect(source).toMatch(/\.zancun-touch-action:active\s*\{[^}]*transform:\s*scale\(0\.985\)/i);
    expect(source).toMatch(/\.zancun-touch-action:focus-visible\s*\{[^}]*outline:\s*3px\s+solid/i);
  });

  test("enlarges the shared staging and appearance scan modal and its buttons", () => {
    const source = readFileSync(resolve(process.cwd(), "src/modules/staging-management/styles.css"), "utf8");

    expect(source).toMatch(/\.modal-content\.zancun-scan-modal-content\s*\{[^}]*width:\s*min\(900px,\s*92vw\)[^}]*padding:\s*32px/i);
    expect(source).toMatch(/\.zancun-scan-modal-content \.modal-close\s*\{[^}]*min-width:\s*108px[^}]*min-height:\s*54px/i);
    expect(source).toMatch(/\.action-btn\.zancun-scan-submit-btn\s*\{[^}]*min-width:\s*156px[^}]*min-height:\s*60px/i);
    expect(source).toMatch(/\.action-btn\.zancun-scan-complete-btn\s*\{[^}]*min-width:\s*240px[^}]*min-height:\s*60px/i);
  });

  test("enlarges destination cards without the removed original-plan state", () => {
    const source = readFileSync(resolve(process.cwd(), "src/modules/staging-management/styles.css"), "utf8");

    expect(source).toMatch(/\.modal-content\.zancun-destination-modal-content\s*\{[^}]*width:\s*min\(1080px,\s*94vw\)/i);
    expect(source).toMatch(/\.zancun-destination-card\s*\{[^}]*min-height:\s*120px/i);
    expect(source).toMatch(/\.zancun-destination-card__action\s*\{[^}]*min-width:\s*240px[^}]*min-height:\s*64px/i);
    expect(source).not.toContain("is-original-planned");
    expect(source).not.toContain("zancun-original-plan-badge");
    expect(source).not.toContain("zancun-destination-deviation-modal");
  });
});
