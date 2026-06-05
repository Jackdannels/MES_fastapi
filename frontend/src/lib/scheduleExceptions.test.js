import { describe, expect, test } from "vitest";

import { STORAGE_KEYS } from "./storageKeys";
import { reconcileScheduleExceptions, SCHEDULE_EXCEPTION_REASON, SCHEDULE_EXCEPTION_TYPE } from "./scheduleExceptions";

describe("scheduleExceptions", () => {
  test("removes an expired unstarted formal schedule and appends a pending exception", () => {
    const now = new Date("2099-03-20T12:00:00.000Z");
    const result = reconcileScheduleExceptions(
      {
        [STORAGE_KEYS.conflicts]: [],
        [STORAGE_KEYS.experiments]: [
          {
            task_code: "TASK-001",
            experiment_code: "TASK-001-A",
            experiment_name: "冲击试验",
            status: "已排程",
            unscheduled_since: "",
          },
        ],
        [STORAGE_KEYS.experiment_trays]: [
          { task_code: "TASK-001", experiment_code: "TASK-001-A", tray_code: "TASK-001-TP-001" },
        ],
        [STORAGE_KEYS.samples]: [
          {
            code: "TASK-001-SP-001",
            task_code: "TASK-001",
            history: [{ action: "任务已确认入库", time: "2099-03-19T07:15:00.000Z" }],
            location: "冲击一室",
            status: "实验准备就绪",
            trays: [{ tray_code: "TASK-001-TP-001", status: "实验准备就绪", quantity: 1 }],
          },
        ],
        [STORAGE_KEYS.schedules]: [
          {
            id: "schedule-1",
            task_code: "TASK-001",
            experiment_code: "TASK-001-A",
            device: "冲击一室",
            start_at: "2099-03-20T08:00:00.000Z",
            end_at: "2099-03-20T10:00:00.000Z",
            status: "已排程",
          },
        ],
        [STORAGE_KEYS.tasks]: [
          { code: "TASK-001", status: "已排程", test_type: "冲击试验" },
        ],
      },
      { now },
    );

    expect(result.changed).toBe(true);
    expect(result.snapshot[STORAGE_KEYS.schedules]).toEqual([]);
    expect(result.snapshot[STORAGE_KEYS.tasks]).toEqual([
      expect.objectContaining({ code: "TASK-001", status: "待排程" }),
    ]);
    expect(result.snapshot[STORAGE_KEYS.experiments]).toEqual([
      expect.objectContaining({
        task_code: "TASK-001",
        experiment_code: "TASK-001-A",
        status: "待排程",
        unscheduled_since: "2099-03-19 15:15:00",
      }),
    ]);
    expect(result.snapshot[STORAGE_KEYS.conflicts]).toEqual([
      expect.objectContaining({
        type: SCHEDULE_EXCEPTION_TYPE,
        status: "pending",
        schedule_id: "schedule-1",
        task_code: "TASK-001",
        reason: SCHEDULE_EXCEPTION_REASON,
      }),
    ]);
  });

  test("keeps an expired schedule when the experiment has actually started and avoids duplicate exceptions", () => {
    const now = new Date("2099-03-20T12:00:00.000Z");
    const result = reconcileScheduleExceptions(
      {
        [STORAGE_KEYS.conflicts]: [
          {
            id: "schedule-exception-schedule-2",
            type: SCHEDULE_EXCEPTION_TYPE,
            status: "pending",
            schedule_id: "schedule-2",
            task_code: "TASK-002",
            reason: SCHEDULE_EXCEPTION_REASON,
          },
        ],
        [STORAGE_KEYS.experiments]: [
          {
            task_code: "TASK-002",
            experiment_code: "TASK-002-A",
            experiment_name: "振动试验",
            status: "实验进行中",
          },
        ],
        [STORAGE_KEYS.experiment_trays]: [
          { task_code: "TASK-002", experiment_code: "TASK-002-A", tray_code: "TASK-002-TP-001" },
        ],
        [STORAGE_KEYS.samples]: [
          {
            code: "TASK-002-SP-001",
            task_code: "TASK-002",
            location: "振动一室",
            status: "实验进行中",
            trays: [{ tray_code: "TASK-002-TP-001", status: "实验进行中", quantity: 1 }],
            history: [{ action: "开始实验", detail: "TASK-002 / 振动试验 / 实验进行中" }],
          },
        ],
        [STORAGE_KEYS.schedules]: [
          {
            id: "schedule-2",
            task_code: "TASK-002",
            experiment_code: "TASK-002-A",
            device: "振动一室",
            start_at: "2099-03-20T08:00:00.000Z",
            end_at: "2099-03-20T10:00:00.000Z",
            status: "已排程",
          },
        ],
        [STORAGE_KEYS.tasks]: [
          { code: "TASK-002", status: "任务进行中", test_type: "振动试验" },
        ],
      },
      { now },
    );

    expect(result.changed).toBe(false);
    expect(result.snapshot[STORAGE_KEYS.schedules]).toHaveLength(1);
    expect(result.snapshot[STORAGE_KEYS.conflicts]).toHaveLength(1);
  });

  test("removes an expired shared-tray schedule when only a sibling experiment has history", () => {
    const now = new Date("2099-03-20T12:00:00.000Z");
    const result = reconcileScheduleExceptions(
      {
        [STORAGE_KEYS.conflicts]: [],
        [STORAGE_KEYS.experiments]: [
          {
            task_code: "TASK-003",
            experiment_code: "TASK-003-A",
            experiment_name: "冲击试验",
            status: "已排程",
            unscheduled_since: "",
          },
          {
            task_code: "TASK-003",
            experiment_code: "TASK-003-B",
            experiment_name: "盐雾试验",
            status: "实验已完成",
            unscheduled_since: "",
          },
        ],
        [STORAGE_KEYS.experiment_trays]: [
          { task_code: "TASK-003", experiment_code: "TASK-003-A", tray_code: "TASK-003-TP-001" },
          { task_code: "TASK-003", experiment_code: "TASK-003-B", tray_code: "TASK-003-TP-001" },
        ],
        [STORAGE_KEYS.samples]: [
          {
            code: "TASK-003-SP-001",
            task_code: "TASK-003",
            location: "盐雾试验室",
            status: "实验已完成",
            trays: [{ tray_code: "TASK-003-TP-001", status: "实验已完成", quantity: 1 }],
            history: [
              { action: "实验完成", detail: "TASK-003 / 盐雾试验 / 实验已完成", time: "2099-03-20T09:00:00.000Z" },
              { action: "开始实验", detail: "TASK-003 / 盐雾试验 / 实验进行中", time: "2099-03-20T08:10:00.000Z" },
            ],
          },
        ],
        [STORAGE_KEYS.schedules]: [
          {
            id: "schedule-3-a",
            task_code: "TASK-003",
            experiment_code: "TASK-003-A",
            device: "冲击一室",
            start_at: "2099-03-20T08:00:00.000Z",
            end_at: "2099-03-20T10:00:00.000Z",
            status: "已排程",
          },
        ],
        [STORAGE_KEYS.tasks]: [
          { code: "TASK-003", status: "已排程", test_type: "冲击试验 / 盐雾试验" },
        ],
      },
      { now },
    );

    expect(result.changed).toBe(true);
    expect(result.snapshot[STORAGE_KEYS.schedules]).toEqual([]);
    expect(result.snapshot[STORAGE_KEYS.experiments]).toEqual([
      expect.objectContaining({ experiment_code: "TASK-003-A", status: "待排程" }),
      expect.objectContaining({ experiment_code: "TASK-003-B", status: "实验已完成" }),
    ]);
  });
});
