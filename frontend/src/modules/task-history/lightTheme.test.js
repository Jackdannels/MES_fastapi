import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { compileStyle, parse } from "@vue/compiler-sfc";
import { expect, test } from "vitest";

test("the scoped SFC keeps the light empty-state selector targeted at history content", () => {
  const filename = resolve(process.cwd(), "src/modules/task-history/page.vue");
  const { descriptor } = parse(readFileSync(filename, "utf8"));
  const style = descriptor.styles.find((block) => block.content.includes(".history-empty"));
  const compiled = compileStyle({ source: style.content, filename, id: "data-v-history", scoped: style.scoped });
  expect(compiled.errors).toEqual([]);
  expect(compiled.code).toMatch(/:root\[data-theme="light"\] \.history-task-page \.history-empty\s*\{/);
  expect(compiled.code).not.toMatch(/:root\[data-theme="light"\]\s*\{/);
});
