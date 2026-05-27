import { describe, expect, test } from "vitest";

import { resolveTransferConfirmedAt } from "./transferArrivalTime";

describe("transferArrivalTime", () => {
  test("resolves transfer confirmation time from matching sample history", () => {
    const confirmedAt = resolveTransferConfirmedAt({
      task: { code: "TASK-001" },
      samples: [
        {
          task_code: "TASK-001",
          history: [
            { action: "样品分装托盘", time: "2099-03-18T08:00:00.000Z" },
            { action: "任务已确认入库", detail: "TASK-001", time: "2099-03-18T09:15:00.000Z" },
          ],
        },
        {
          task_code: "TASK-002",
          history: [{ action: "任务已确认入库", detail: "TASK-002", time: "2099-03-17T07:00:00.000Z" }],
        },
      ],
    });

    expect(confirmedAt?.toISOString()).toBe("2099-03-18T09:15:00.000Z");
  });

  test("returns null when samples have no transfer confirmation history", () => {
    const confirmedAt = resolveTransferConfirmedAt({
      task: { code: "TASK-001" },
      samples: [{ task_code: "TASK-001", history: [{ action: "样品分装托盘", time: "2099-03-18T08:00:00.000Z" }] }],
    });

    expect(confirmedAt).toBeNull();
  });
});
