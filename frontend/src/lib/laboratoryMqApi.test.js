import { afterEach, describe, expect, test, vi } from "vitest";

import {
  publishLaboratoryEndRequest,
  publishLaboratoryFixtureInstall,
  publishLaboratoryPauseRequest,
  publishLaboratoryResumeRequest,
  publishLaboratoryStopRequest,
} from "./laboratoryMqApi.js";

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

  test("publishes an immediate experiment end request through the MES backend", async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({ ok: true, published: true }),
    });
    vi.stubGlobal("fetch", fetch);

    await publishLaboratoryEndRequest({
      experiment_code: "EXP-1",
      lab_code: "LAB_SALT",
      run_no: "RUN-1",
      task_code: "TASK-1",
    });

    expect(fetch).toHaveBeenCalledWith("/api/mq/laboratory/end-request", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({
        experiment_code: "EXP-1",
        lab_code: "LAB_SALT",
        run_no: "RUN-1",
        task_code: "TASK-1",
      }),
    }));
  });

  test.each([
    [
      publishLaboratoryPauseRequest,
      "/api/mq/laboratory/pause-request",
      {
        experiment_code: "EXP-SALT",
        inspection_tray_codes: ["TRAY-1"],
        lab_code: "LAB_SALT",
        pause_reason: "中途外观检查",
        run_no: "RUN-SALT",
        task_code: "TASK-SALT",
      },
    ],
    [
      publishLaboratoryResumeRequest,
      "/api/mq/laboratory/resume-request",
      {
        experiment_code: "EXP-SALT",
        lab_code: "LAB_SALT",
        pause_no: "PAUSE-1",
        run_no: "RUN-SALT",
        task_code: "TASK-SALT",
      },
    ],
    [
      publishLaboratoryStopRequest,
      "/api/mq/laboratory/stop-request",
      {
        experiment_code: "EXP-SALT",
        lab_code: "LAB_SALT",
        pause_no: "PAUSE-1",
        run_no: "RUN-SALT",
        task_code: "TASK-SALT",
        termination_reason: "达到腐蚀终止条件",
        termination_type: "completion_criteria",
      },
    ],
  ])("publishes salt spray lifecycle command through %s", async (publisher, path, payload) => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({ ok: true, published: true }),
    });
    vi.stubGlobal("fetch", fetch);

    await publisher(payload);

    expect(fetch).toHaveBeenCalledWith(path, expect.objectContaining({
      method: "POST",
      body: JSON.stringify(payload),
    }));
  });
});
