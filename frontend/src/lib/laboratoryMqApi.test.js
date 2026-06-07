import { afterEach, describe, expect, test, vi } from "vitest";

import { publishLaboratoryFixtureInstall } from "./laboratoryMqApi.js";

describe("laboratoryMqApi", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("rejects when backend reports the MQTT command was not published", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({ ok: true, published: false, reason: "disabled" }),
    }));

    await expect(publishLaboratoryFixtureInstall({
      experiment_code: "EXP-1",
      lab_code: "LAB_SALT",
      sample_count: 1,
      sample_type: "",
      task_code: "TASK-1",
    })).rejects.toThrow("disabled");
  });
});
