import { describe, expect, test } from "vitest";

import { getLabHostInterfaceCapabilities } from "./labHostInterfaceCapabilities.js";

describe("labHostInterfaceCapabilities", () => {
  test("marks only hot humid laboratory two as hostless", () => {
    expect(getLabHostInterfaceCapabilities({
      labCode: "LAB_HOT_HUMID_2",
    })).toEqual({
      fixtureReadyDelayMs: 3000,
      hostless: true,
      startDelayMs: 3000,
    });

    expect(getLabHostInterfaceCapabilities({
      labCode: "LAB_HOT_HUMID",
    })).toEqual({
      fixtureReadyDelayMs: 0,
      hostless: false,
      startDelayMs: 0,
    });
  });

  test("recognizes hot humid laboratory two by name when master data code is unavailable", () => {
    expect(getLabHostInterfaceCapabilities({
      labName: "高低温湿热二室",
    })).toEqual({
      fixtureReadyDelayMs: 3000,
      hostless: true,
      startDelayMs: 3000,
    });
  });
});
