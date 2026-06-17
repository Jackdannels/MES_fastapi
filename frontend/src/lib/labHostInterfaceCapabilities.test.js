import { describe, expect, test } from "vitest";

import { HOST_INTERFACE_MODES } from "./hostInterfaceMode.js";
import { getLabHostInterfaceCapabilities } from "./labHostInterfaceCapabilities.js";

describe("labHostInterfaceCapabilities", () => {
  test("marks only hot humid laboratory two as hostless in MQTT mode", () => {
    expect(getLabHostInterfaceCapabilities({
      hostInterfaceMode: HOST_INTERFACE_MODES.mqtt,
      labCode: "LAB_HOT_HUMID_2",
    })).toEqual({
      fixtureReadyDelayMs: 3000,
      hostless: true,
      startDelayMs: 3000,
    });

    expect(getLabHostInterfaceCapabilities({
      hostInterfaceMode: HOST_INTERFACE_MODES.mqtt,
      labCode: "LAB_HOT_HUMID",
    })).toEqual({
      fixtureReadyDelayMs: 0,
      hostless: false,
      startDelayMs: 0,
    });

    expect(getLabHostInterfaceCapabilities({
      hostInterfaceMode: HOST_INTERFACE_MODES.mock,
      labCode: "LAB_HOT_HUMID_2",
    })).toEqual({
      fixtureReadyDelayMs: 0,
      hostless: false,
      startDelayMs: 0,
    });
  });

  test("recognizes hot humid laboratory two by name when master data code is unavailable", () => {
    expect(getLabHostInterfaceCapabilities({
      hostInterfaceMode: HOST_INTERFACE_MODES.mqtt,
      labName: "高低温湿热二室",
    })).toEqual({
      fixtureReadyDelayMs: 3000,
      hostless: true,
      startDelayMs: 3000,
    });

    expect(getLabHostInterfaceCapabilities({
      hostInterfaceMode: HOST_INTERFACE_MODES.mock,
      labName: "高低温湿热二室",
    })).toEqual({
      fixtureReadyDelayMs: 0,
      hostless: false,
      startDelayMs: 0,
    });
  });
});
