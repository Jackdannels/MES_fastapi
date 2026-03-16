import { describe, expect, test } from "vitest";

import { appConfig } from "./appConfig";

describe("appConfig", () => {
  test("keeps only active application config fields", () => {
    expect(appConfig.demoAuthMode).toBe(false);
    expect(Object.keys(appConfig)).toEqual(["demoAuthMode"]);
  });
});
