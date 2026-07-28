import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

describe("visualization refresh performance", () => {
  test("does not rebuild sample-heavy board models on a one-second page clock", () => {
    const pageSource = readFileSync(resolve(process.cwd(), "src/modules/visualization/page.vue"), "utf8");
    const currentLabScreenSource = readFileSync(resolve(process.cwd(), "src/modules/visualization/screens/currentLabTasksScreen.js"), "utf8");

    expect(pageSource).not.toContain("currentNow");
    expect(pageSource).not.toContain("refreshVisualizationClock");
    expect(pageSource).not.toContain("setInterval(refreshVisualizationClock");
    expect(currentLabScreenSource).toContain("liveNowMs");
    expect(currentLabScreenSource).toContain("buildLiveCountdown");
  });
});
