import { describe, expect, test } from "vitest";

import { getLabHostInterfaceCapabilities } from "./labHostInterfaceCapabilities.js";

describe("labHostInterfaceCapabilities", () => {
  test("keeps only fixture confirmation hostless for hot humid laboratory two", () => {
    expect(getLabHostInterfaceCapabilities({
      labCode: "LAB_HOT_HUMID_2",
    })).toEqual({
      experimentEndInterface: "mqtt",
      experimentStartInterface: "mqtt",
      fixtureReadyDelayMs: 3000,
      fixtureReadyInterface: "hostless",
    });

    expect(getLabHostInterfaceCapabilities({
      labCode: "LAB_HOT_HUMID",
    })).toEqual({
      experimentEndInterface: "mqtt",
      experimentStartInterface: "mqtt",
      fixtureReadyDelayMs: 0,
      fixtureReadyInterface: "mqtt",
    });
  });

  test("recognizes hot humid laboratory two by name when master data code is unavailable", () => {
    expect(getLabHostInterfaceCapabilities({
      labName: "高低温湿热二室",
    })).toEqual({
      experimentEndInterface: "mqtt",
      experimentStartInterface: "mqtt",
      fixtureReadyDelayMs: 3000,
      fixtureReadyInterface: "hostless",
    });
  });
});
