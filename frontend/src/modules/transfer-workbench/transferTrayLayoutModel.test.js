import { describe, expect, test } from "vitest";

import { buildAllocationPayload } from "./transferTrayLayoutModel";

describe("transfer tray allocation payload", () => {
  test("builds the complete 10-tray experiment matrix without duplicates or unknown trays", () => {
    const assignedTrays = Array.from({ length: 10 }, (_, index) => ({
      trayId: index + 1,
      trayNo: `TRAY-${String(index + 1).padStart(2, "0")}`,
      samples: [{ sampleId: `SAMPLE-${index + 1}` }],
    }));
    const experiments = Array.from({ length: 8 }, (_, index) => ({
      experimentCode: `EXP-${index + 1}`,
    }));
    const allTrayNos = assignedTrays.map((tray) => tray.trayNo);
    const experimentTraySelections = Object.fromEntries(experiments.map((experiment) => [
      experiment.experimentCode,
      [...allTrayNos].reverse().concat(allTrayNos[0], "UNKNOWN-TRAY"),
    ]));

    const payload = buildAllocationPayload({
      assignedTrays,
      experiments,
      experimentTraySelections,
      trayLimit: 16,
    });

    expect(payload.experimentTrays).toHaveLength(8);
    expect(payload.experimentTrays).toEqual(experiments.map((experiment) => ({
      experimentCode: experiment.experimentCode,
      trayIds: assignedTrays.map((tray) => tray.trayId),
    })));
    expect(payload.experimentTrays.flatMap((item) => item.trayIds)).toHaveLength(80);
  });
});
