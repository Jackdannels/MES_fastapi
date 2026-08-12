import { describe, expect, test } from "vitest";

import { STORAGE_KEYS } from "./storageKeys";
import {
  reconcileScheduleExceptions,
  SCHEDULE_DELAY_EXCEPTION_REASON,
  SCHEDULE_DELAY_EXCEPTION_TYPE,
  SCHEDULE_EXCEPTION_TYPE,
} from "./scheduleExceptions";

const buildSnapshot = (experimentRuns) => ({
  [STORAGE_KEYS.conflicts]: [],
  [STORAGE_KEYS.experiment_runs]: experimentRuns,
  [STORAGE_KEYS.experiments]: [{
    task_code: "TASK-NEXT",
    experiment_code: "TASK-NEXT-A",
    experiment_name: "盐雾试验",
    status: "已排程",
  }],
  [STORAGE_KEYS.experiment_trays]: [],
  [STORAGE_KEYS.samples]: [],
  [STORAGE_KEYS.schedules]: [{
    id: "schedule-next",
    task_code: "TASK-NEXT",
    experiment_code: "TASK-NEXT-A",
    device: "盐雾试验室",
    start_at: "2099-03-20T08:00:00.000Z",
    end_at: "2099-03-20T10:00:00.000Z",
    status: "已排程",
  }],
  [STORAGE_KEYS.tasks]: [{ code: "TASK-NEXT", status: "已排程", test_type: "盐雾试验" }],
});

describe("schedule exception reconciliation with an active laboratory run", () => {
  test("keeps an expired next schedule and emits one stable waiting exception", () => {
    const first = reconcileScheduleExceptions(buildSnapshot([{
      run_no: "run-blocking-001",
      task_code: "TASK-CURRENT",
      experiment_code: "TASK-CURRENT-A",
      device: "盐雾试验室",
      run_status: "实验中",
      started_at: "2099-03-20T07:00:00.000Z",
      planned_end_at: "",
    }]), { now: new Date("2099-03-20T12:00:00.000Z") });

    expect(first.changed).toBe(true);
    expect(first.snapshot[STORAGE_KEYS.schedules]).toEqual([
      expect.objectContaining({
        id: "schedule-next",
        start_at: "2099-03-20T08:00:00.000Z",
        end_at: "2099-03-20T10:00:00.000Z",
        delay_reason: SCHEDULE_DELAY_EXCEPTION_REASON,
        original_end_at: "2099-03-20T10:00:00.000Z",
        original_start_at: "2099-03-20T08:00:00.000Z",
        source_run_no: "run-blocking-001",
        delay_status: "waiting_active_run_end",
        delay_waiting_for_estimated_end: true,
      }),
    ]);
    expect(first.snapshot[STORAGE_KEYS.conflicts]).toEqual([
      expect.objectContaining({
        reason: SCHEDULE_DELAY_EXCEPTION_REASON,
        schedule_id: "schedule-next",
        source_run_no: "run-blocking-001",
        status: "pending",
        type: SCHEDULE_DELAY_EXCEPTION_TYPE,
      }),
    ]);
    expect(first.snapshot[STORAGE_KEYS.conflicts][0].detail).toContain("预计结束：等待设备或操作员确认");

    const persistedSnapshot = {
      ...first.snapshot,
      [STORAGE_KEYS.schedules]: first.snapshot[STORAGE_KEYS.schedules].map((schedule) => {
        const persisted = { ...schedule };
        delete persisted.delay_status;
        delete persisted.delay_waiting_for_estimated_end;
        return persisted;
      }),
    };
    const second = reconcileScheduleExceptions(persistedSnapshot, {
      now: new Date("2099-03-20T12:37:00.000Z"),
    });

    expect(second.changed).toBe(false);
    expect(second.snapshot[STORAGE_KEYS.schedules][0]).toEqual(persistedSnapshot[STORAGE_KEYS.schedules][0]);
    expect(second.snapshot[STORAGE_KEYS.conflicts]).toHaveLength(1);
  });

  test("keeps the original missed-start removal when no run is active in that laboratory", () => {
    const result = reconcileScheduleExceptions(buildSnapshot([{
      run_no: "run-completed",
      device: "盐雾试验室",
      status: "实验已完成",
    }, {
      run_no: "run-other-lab",
      device: "振动一室",
      status: "实验进行中",
    }]), { now: new Date("2099-03-20T12:00:00.000Z") });

    expect(result.changed).toBe(true);
    expect(result.snapshot[STORAGE_KEYS.schedules]).toEqual([]);
    expect(result.snapshot[STORAGE_KEYS.conflicts]).toEqual([
      expect.objectContaining({
        schedule_id: "schedule-next",
        type: SCHEDULE_EXCEPTION_TYPE,
      }),
    ]);
  });

  test("does not blame an older missed schedule on a later active run in the same laboratory", () => {
    const result = reconcileScheduleExceptions(buildSnapshot([{
      run_no: "run-later",
      device: "盐雾试验室",
      status: "实验进行中",
      started_at: "2099-03-20T11:00:00.000Z",
    }]), { now: new Date("2099-03-20T12:00:00.000Z") });

    expect(result.snapshot[STORAGE_KEYS.schedules]).toEqual([]);
    expect(result.snapshot[STORAGE_KEYS.conflicts][0]).toEqual(expect.objectContaining({
      type: SCHEDULE_EXCEPTION_TYPE,
    }));
  });

  test("marks a not-yet-expired next schedule once the preceding run becomes overdue", () => {
    const result = reconcileScheduleExceptions(buildSnapshot([{
      run_no: "run-overdue",
      device: "盐雾试验室",
      status: "实验进行中",
      started_at: "2099-03-20T06:00:00.000Z",
      planned_end_at: "2099-03-20T07:30:00.000Z",
    }]), { now: new Date("2099-03-20T09:00:00.000Z") });

    expect(result.snapshot[STORAGE_KEYS.schedules]).toHaveLength(1);
    expect(result.snapshot[STORAGE_KEYS.schedules][0]).toEqual(expect.objectContaining({
      delay_reason: SCHEDULE_DELAY_EXCEPTION_REASON,
      source_run_no: "run-overdue",
    }));
    expect(result.snapshot[STORAGE_KEYS.conflicts][0]).toEqual(expect.objectContaining({
      type: SCHEDULE_DELAY_EXCEPTION_TYPE,
    }));
  });
});
