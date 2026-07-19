import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

describe("TransferDispatchPanel structure", () => {
  test("keeps the scan toolbar and feedback in normal flow", () => {
    const source = readFileSync(resolve(process.cwd(), "src/modules/transfer-workbench/TransferDispatchPanel.vue"), "utf8");

    expect(source).toContain('class="transfer-overview-toolbar transfer-dispatch-toolbar"');
    expect(source).toContain('class="transfer-dispatch-feedback"');
    expect(source).toMatch(/\.transfer-dispatch-shell\s*\{[^}]*display:\s*grid;/i);
    expect(source).toMatch(/\.transfer-dispatch-shell\s*\{[^}]*grid-template-rows:\s*auto\s+auto\s+auto\s+minmax\(0,\s*1fr\)/i);
    expect(source).toMatch(/\.transfer-dispatch-toolbar\s*\{[^}]*position:\s*static;/i);
    expect(source).toMatch(/\.transfer-dispatch-toolbar\s*>\s*\.transfer-dispatch-feedback\s*\{[^}]*position:\s*static;/i);
    expect(source).toMatch(/\.transfer-dispatch-toolbar\s*>\s*\.transfer-dispatch-feedback\s*\{[^}]*grid-column:\s*1\s*\/\s*-1;/i);
    expect(source).toMatch(/\.transfer-dispatch-toolbar\s*>\s*\.transfer-dispatch-feedback\s*\{[^}]*margin-top:\s*0;/i);
  });

  test("scrolls long destination lists without moving or overlapping the scan toolbar", () => {
    const source = readFileSync(resolve(process.cwd(), "src/modules/transfer-workbench/TransferDispatchPanel.vue"), "utf8");
    const parentStyles = readFileSync(resolve(process.cwd(), "src/modules/handover-system/styles.css"), "utf8");

    expect(parentStyles).toMatch(/\.transfer-overview-shell\.transfer-dispatch-shell\s*\{[^}]*grid-template-rows:\s*auto\s+auto\s+auto\s+minmax\(0,\s*1fr\)/i);
    expect(source).toMatch(/\.transfer-dispatch-result\s*\{[^}]*min-height:\s*0;/i);
    expect(source).toMatch(/\.transfer-dispatch-result\s*\{[^}]*flex:\s*1\s+1\s+auto;/i);
    expect(source).toMatch(/\.transfer-dispatch-result\s*\{[^}]*margin-top:\s*0;/i);
    expect(source).toMatch(/\.transfer-dispatch-result\s*\{[^}]*overflow-y:\s*auto;/i);
    expect(source).toMatch(/\.transfer-dispatch-result\s*\{[^}]*overscroll-behavior:\s*contain;/i);
  });

  test("uses the dark industrial card surface for dispatch summaries and destinations", () => {
    const source = readFileSync(resolve(process.cwd(), "src/modules/transfer-workbench/TransferDispatchPanel.vue"), "utf8");

    expect(source).toMatch(/\.transfer-dispatch-summary-card,\s*\.transfer-dispatch-destination-card\s*{[^}]*background:\s*var\(--bg-card-raised\);/i);
    expect(source).toMatch(/\.transfer-dispatch-summary-card,\s*\.transfer-dispatch-destination-card\s*{[^}]*border:\s*1px solid var\(--border\);/i);
    expect(source).not.toMatch(/background:\s*(?:#fff|#ffffff|white)\b/i);
  });

  test("renders the dispatch summary as a fixed ticket without pending-copy", () => {
    const source = readFileSync(resolve(process.cwd(), "src/modules/transfer-workbench/TransferDispatchPanel.vue"), "utf8");

    expect(source).toMatch(/\.transfer-dispatch-result\s*\{[^}]*gap:\s*14px;/i);
    expect(source).toMatch(/\.transfer-dispatch-result\s*\{[^}]*align-content:\s*start;/i);
    expect(source).toContain('class="transfer-dispatch-summary-card__ticket-main"');
    expect(source).toContain('class="transfer-dispatch-summary-card__ticket-stats"');
    expect(source).toContain('class="transfer-dispatch-summary-card__stat"');
    expect(source).toContain('class="transfer-dispatch-summary-card__experiment-tags"');
    expect(source).toContain("transfer-dispatch-summary-card__experiment-tag");
    expect(source).toContain("resolveDispatchExperimentTagTone");
    expect(source).not.toContain("托盘摘要");
    expect(source).not.toContain("待出库");
    expect(source).toMatch(/\.transfer-dispatch-summary-card\s*\{[^}]*height:\s*190px;/i);
    expect(source).toMatch(/\.transfer-dispatch-summary-card\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+240px;/i);
    expect(source).toMatch(/\.transfer-dispatch-summary-card__experiment-tags\s*\{[^}]*max-height:\s*58px;/i);
    expect(source).toMatch(/\.transfer-dispatch-summary-card__experiment-tags\s*\{[^}]*overflow:\s*auto;/i);
    expect(source).toMatch(/\.transfer-dispatch-summary-card__field\s+span\s*\{[^}]*font-size:\s*13px;/i);
    expect(source).toMatch(/\.transfer-dispatch-summary-card__field\s+strong\s*\{[^}]*font-size:\s*15px;/i);
    expect(source).toMatch(/\.transfer-dispatch-summary-card__experiment-tag\s*{[^}]*height:\s*auto;/i);
    expect(source).toMatch(/\.transfer-dispatch-summary-card__experiment-tag\s*{[^}]*min-height:\s*28px;/i);
    expect(source).toMatch(/\.transfer-dispatch-summary-card__experiment-tag\s*{[^}]*padding:\s*4px\s+10px;/i);
    expect(source).toMatch(/\.transfer-dispatch-summary-card__experiment-tag\s*{[^}]*aspect-ratio:\s*auto;/i);
    expect(source).toMatch(/\.transfer-dispatch-summary-card__experiment-tag\s*{[^}]*white-space:\s*nowrap;/i);
    expect(source).toMatch(/\.transfer-dispatch-summary-card__experiment-tag--tone-1\s*\{/i);
    expect(source).toMatch(/\.transfer-dispatch-summary-card__experiment-tag--tone-6\s*\{/i);
  });
});
