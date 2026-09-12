import { describe, expect, test } from "vitest";
import { buildSamplesFlowView } from "./sampleFlow.samplesListView";
import { buildSamplesStagingView } from "./sampleFlow.stagingView";

describe.each([
  ["flow", buildSamplesFlowView],
  ["staging", buildSamplesStagingView],
])("%s table tray codes", (_name, buildView) => {
  const sample = {
    code: "SAMPLE-001",
    task_code: "TASK-001",
    location: "恒温恒湿间（暂存间）",
    status: "已到达暂存间",
  };

  test("displays all summary codes without requiring tray detail or inventing quantities", () => {
    const input = { ...sample, trayCodes: [" TRAY-002 ", "", "TRAY-001", "TRAY-002"] };
    const row = buildView({ samples: [input] }).rows[0];

    expect(row.trayCodes).toEqual(["TRAY-002", "TRAY-001"]);
    expect(row.trayCodesText).toBe("TRAY-002、TRAY-001");
    expect(row.trays).toEqual([]);
    expect(input.trayCodes).toEqual([" TRAY-002 ", "", "TRAY-001", "TRAY-002"]);
  });

  test("keeps samples without tray bindings empty", () => {
    const rows = buildView({ samples: [sample, { ...sample, code: "SAMPLE-002", trayCodes: [] }] }).rows;
    expect(rows.map((row) => row.trayCodesText)).toEqual(["", ""]);
  });

  test("still validates quantities and sample ownership for full tray records", () => {
    const row = buildView({ samples: [{ ...sample, trays: [
      { tray_code: "TRAY-ZERO", quantity: 0 },
      { tray_code: "TRAY-MISSING" },
      { tray_code: "TRAY-OTHER", quantity: 1, sample_code: "OTHER" },
      { tray_code: "TRAY-VALID", quantity: 1, sample_code: sample.code },
    ] }] }).rows[0];
    expect(row.trayCodesText).toBe("TRAY-VALID");
  });

  test("searches by summary tray code", () => {
    const view = buildView({
      samples: [{ ...sample, trayCodes: ["TRAY-001"] }],
      filters: { query: "tray-001" },
    });
    expect(view.rows.map((row) => row.code)).toEqual([sample.code]);
  });
});

test("flow sorts by the displayed summary tray codes", () => {
  const view = buildSamplesFlowView({
    samples: [
      { code: "SAMPLE-001", trayCodes: ["TRAY-002"] },
      { code: "SAMPLE-002", trayCodes: ["TRAY-001"] },
    ],
    sort: { key: "trayCodesText", direction: "asc" },
  });
  expect(view.rows.map((row) => row.code)).toEqual(["SAMPLE-002", "SAMPLE-001"]);
});
