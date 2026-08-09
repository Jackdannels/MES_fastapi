import { describe, expect, test } from "vitest";

import {
  applyStrictScheduleSequence,
  rowCanBeCurrentLaboratoryTask,
} from "./laboratoryWorkbenchSelection";

const buildRow = ({ id, startAt, trayCodes }) => ({
  allTrayCodes: trayCodes,
  allTrayRows: trayCodes.map((trayCode) => ({ trayCode })),
  id,
  startAt,
  trayCodes,
  trayRows: trayCodes.map((trayCode) => ({ trayCode })),
});

describe("laboratoryWorkbenchSelection strict schedule order", () => {
  test("allows only each tray's first unfinished schedule while independent trays can continue", () => {
    const rows = applyStrictScheduleSequence([
      buildRow({ id: "schedule-a", startAt: "2026-08-10T08:00:00", trayCodes: ["TP-SHARED"] }),
      buildRow({ id: "schedule-b", startAt: "2026-08-10T10:00:00", trayCodes: ["TP-SHARED"] }),
      buildRow({ id: "schedule-c", startAt: "2026-08-10T12:00:00", trayCodes: ["TP-INDEPENDENT"] }),
    ]);

    expect(rows[0]).toEqual(expect.objectContaining({
      sequenceEligible: true,
      sequenceEligibleTrayCodes: ["TP-SHARED"],
    }));
    expect(rows[1]).toEqual(expect.objectContaining({
      sequenceBlockedTrayCodes: ["TP-SHARED"],
      sequenceEligible: false,
      trayCodes: ["TP-SHARED"],
    }));
    expect(rows[2]).toEqual(expect.objectContaining({
      sequenceEligible: true,
      sequenceEligibleTrayCodes: ["TP-INDEPENDENT"],
    }));
    expect(rowCanBeCurrentLaboratoryTask(rows[1])).toBe(false);
  });

  test("does not gate the next schedule by its future start time", () => {
    const [nextRow] = applyStrictScheduleSequence([
      buildRow({ id: "schedule-future", startAt: "2099-01-01T08:00:00", trayCodes: ["TP-FUTURE"] }),
    ]);

    expect(nextRow.sequenceEligible).toBe(true);
    expect(rowCanBeCurrentLaboratoryTask(nextRow)).toBe(true);
  });
});
