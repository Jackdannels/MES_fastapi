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
            status: "已到达实验室",
            trays: [{ tray_code: "TASK-001-TP-001", status: "已到达实验室", quantity: 1 }],
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

  test("keeps an expired schedule after fixture installation", () => {
    const now = new Date("2099-03-20T12:00:00.000Z");
    const result = reconcileScheduleExceptions(
      {
        [STORAGE_KEYS.conflicts]: [],
        [STORAGE_KEYS.experiments]: [
          {
            task_code: "TASK-INSTALLED",
            experiment_code: "TASK-INSTALLED-A",
            experiment_name: "冲击试验",
            status: "已排程",
            unscheduled_since: "",
          },
        ],
        [STORAGE_KEYS.experiment_trays]: [
          { task_code: "TASK-INSTALLED", experiment_code: "TASK-INSTALLED-A", tray_code: "TASK-INSTALLED-TP-001" },
        ],
        [STORAGE_KEYS.samples]: [
          {
            code: "TASK-INSTALLED-SP-001",
            task_code: "TASK-INSTALLED",
            location: "冲击一室",
            status: "工装夹具安装",
            trays: [{ tray_code: "TASK-INSTALLED-TP-001", status: "工装夹具安装", quantity: 1 }],
          },
        ],
        [STORAGE_KEYS.schedules]: [
          {
            id: "schedule-installed",
            task_code: "TASK-INSTALLED",
            experiment_code: "TASK-INSTALLED-A",
            device: "冲击一室",
            start_at: "2099-03-20T08:00:00.000Z",
            end_at: "2099-03-20T10:00:00.000Z",
            status: "已排程",
          },
        ],
        [STORAGE_KEYS.tasks]: [
          { code: "TASK-INSTALLED", status: "已排程", test_type: "冲击试验" },
        ],
      },
      { now },
    );

    expect(result.changed).toBe(false);
    expect(result.snapshot[STORAGE_KEYS.schedules]).toEqual([
      expect.objectContaining({ id: "schedule-installed" }),
    ]);
    expect(result.snapshot[STORAGE_KEYS.conflicts]).toEqual([]);
  });

  test("keeps an expired shared-tray schedule when the current experiment installed the fixture", () => {
    const now = new Date("2099-03-20T12:00:00.000Z");
    const result = reconcileScheduleExceptions(
      {
        [STORAGE_KEYS.conflicts]: [],
        [STORAGE_KEYS.experiments]: [
          {
            task_code: "TASK-SHARED-INSTALLED",
            experiment_code: "TASK-SHARED-INSTALLED-A",
            experiment_name: "冲击试验",
            status: "已排程",
            unscheduled_since: "",
          },
          {
            task_code: "TASK-SHARED-INSTALLED",
            experiment_code: "TASK-SHARED-INSTALLED-B",
            experiment_name: "盐雾试验",
            status: "已排程",
            unscheduled_since: "",
          },
        ],
        [STORAGE_KEYS.experiment_trays]: [
          { task_code: "TASK-SHARED-INSTALLED", experiment_code: "TASK-SHARED-INSTALLED-A", tray_code: "TASK-SHARED-INSTALLED-TP-001" },
          { task_code: "TASK-SHARED-INSTALLED", experiment_code: "TASK-SHARED-INSTALLED-B", tray_code: "TASK-SHARED-INSTALLED-TP-001" },
        ],
        [STORAGE_KEYS.samples]: [
          {
            code: "TASK-SHARED-INSTALLED-SP-001",
            task_code: "TASK-SHARED-INSTALLED",
            location: "冲击一室",
            status: "工装夹具安装",
            trays: [
              {
                quantity: 1,
                status: "工装夹具安装",
                target_experiment_code: "TASK-SHARED-INSTALLED-A",
                target_lab: "冲击一室",
                tray_code: "TASK-SHARED-INSTALLED-TP-001",
              },
            ],
          },
        ],
        [STORAGE_KEYS.schedules]: [
          {
            id: "schedule-shared-installed",
            task_code: "TASK-SHARED-INSTALLED",
            experiment_code: "TASK-SHARED-INSTALLED-A",
            device: "冲击一室",
            start_at: "2099-03-20T08:00:00.000Z",
            end_at: "2099-03-20T10:00:00.000Z",
            status: "已排程",
          },
        ],
        [STORAGE_KEYS.tasks]: [
          { code: "TASK-SHARED-INSTALLED", status: "已排程", test_type: "冲击试验 / 盐雾试验" },
        ],
      },
      { now },
    );

    expect(result.changed).toBe(false);
    expect(result.snapshot[STORAGE_KEYS.schedules]).toEqual([
      expect.objectContaining({ id: "schedule-shared-installed" }),
    ]);
    expect(result.snapshot[STORAGE_KEYS.conflicts]).toEqual([]);
  });

  test("keeps an expired shared-tray schedule after fixture installation when legacy trays lack target fields", () => {
    const now = new Date("2099-03-20T12:00:00.000Z");
    const result = reconcileScheduleExceptions(
      {
        [STORAGE_KEYS.conflicts]: [],
        [STORAGE_KEYS.experiments]: [
          {
            task_code: "TASK-SHARED-LEGACY",
            experiment_code: "TASK-SHARED-LEGACY-A",
            experiment_name: "冲击试验",
            status: "已排程",
            unscheduled_since: "",
          },
          {
            task_code: "TASK-SHARED-LEGACY",
            experiment_code: "TASK-SHARED-LEGACY-B",
            experiment_name: "盐雾试验",
            status: "已排程",
            unscheduled_since: "",
          },
        ],
        [STORAGE_KEYS.experiment_trays]: [
          { task_code: "TASK-SHARED-LEGACY", experiment_code: "TASK-SHARED-LEGACY-A", tray_code: "TASK-SHARED-LEGACY-TP-001" },
          { task_code: "TASK-SHARED-LEGACY", experiment_code: "TASK-SHARED-LEGACY-B", tray_code: "TASK-SHARED-LEGACY-TP-001" },
        ],
        [STORAGE_KEYS.samples]: [
          {
            code: "TASK-SHARED-LEGACY-SP-001",
            task_code: "TASK-SHARED-LEGACY",
            location: "冲击一室",
            status: "工装夹具安装",
            trays: [
              {
                quantity: 1,
                status: "工装夹具安装",
                tray_code: "TASK-SHARED-LEGACY-TP-001",
              },
            ],
          },
        ],
        [STORAGE_KEYS.schedules]: [
          {
            id: "schedule-shared-legacy-installed",
            task_code: "TASK-SHARED-LEGACY",
            experiment_code: "TASK-SHARED-LEGACY-A",
            device: "冲击一室",
            start_at: "2099-03-20T08:00:00.000Z",
            end_at: "2099-03-20T10:00:00.000Z",
            status: "已排程",
          },
        ],
        [STORAGE_KEYS.tasks]: [
          { code: "TASK-SHARED-LEGACY", status: "已排程", test_type: "冲击试验 / 盐雾试验" },
        ],
      },
      { now },
    );

    expect(result.changed).toBe(false);
    expect(result.snapshot[STORAGE_KEYS.schedules]).toEqual([
      expect.objectContaining({ id: "schedule-shared-legacy-installed" }),
    ]);
    expect(result.snapshot[STORAGE_KEYS.conflicts]).toEqual([]);
  });

  test("keeps expired staging schedules when their lab code is a storage area", () => {
    const now = new Date("2099-03-20T12:00:00.000Z");
    const result = reconcileScheduleExceptions(
      {
        [STORAGE_KEYS.conflicts]: [],
        [STORAGE_KEYS.experiments]: [],
        [STORAGE_KEYS.experiment_trays]: [],
        [STORAGE_KEYS.samples]: [],
        [STORAGE_KEYS.schedules]: [
          {
            id: "schedule-staging",
            task_code: "TASK-STAGING",
            device: "冲击一室",
            lab_code: "AREA_STAGING_PRE",
            start_at: "2099-03-20T08:00:00.000Z",
            end_at: "2099-03-20T10:00:00.000Z",
            status: "暂存间存放",
          },
        ],
        [STORAGE_KEYS.tasks]: [{ code: "TASK-STAGING", status: "待排程" }],
      },
      { now },
    );

    expect(result.changed).toBe(false);
    expect(result.snapshot[STORAGE_KEYS.schedules]).toEqual([
      expect.objectContaining({ id: "schedule-staging" }),
    ]);
    expect(result.snapshot[STORAGE_KEYS.conflicts]).toEqual([]);
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

  test("removes an expired unstarted axis schedule when sibling axes have started", () => {
    const now = new Date("2099-03-20T12:00:00.000Z");
    const taskCode = "TASK-AXIS-EXPIRED";
    const experimentCode = "TASK-AXIS-EXPIRED-V";
    const result = reconcileScheduleExceptions(
      {
        [STORAGE_KEYS.conflicts]: [],
        [STORAGE_KEYS.experiments]: [
          {
            task_code: taskCode,
            experiment_code: experimentCode,
            experiment_name: "振动试验",
            status: "已排程",
            unscheduled_since: "",
            axis_codes: ["x+", "x-", "y+"],
          },
        ],
        [STORAGE_KEYS.experiment_trays]: [
          { task_code: taskCode, experiment_code: experimentCode, tray_code: "TASK-AXIS-EXPIRED-TP-001" },
        ],
        [STORAGE_KEYS.samples]: [
          {
            code: "TASK-AXIS-EXPIRED-SP-001",
            task_code: taskCode,
            location: "振动一室",
            status: "实验已完成",
            schedule_id: "schedule-axis-x-plus",
            sub_experiment_code: `${experimentCode}-AXIS-001`,
            axis_codes: ["x+"],
            trays: [
              {
                tray_code: "TASK-AXIS-EXPIRED-TP-001",
                status: "实验已完成",
                target_experiment_code: experimentCode,
                target_lab: "振动一室",
                schedule_id: "schedule-axis-x-plus",
                sub_experiment_code: `${experimentCode}-AXIS-001`,
                axis_codes: ["x+"],
              },
            ],
            history: [
              {
                action: "实验完成",
                detail: `${taskCode} / 振动试验 / 实验已完成`,
                schedule_id: "schedule-axis-x-plus",
                sub_experiment_code: `${experimentCode}-AXIS-001`,
                axis_codes: ["x+"],
                time: "2099-03-20T09:00:00.000Z",
              },
            ],
          },
          {
            code: "TASK-AXIS-EXPIRED-SP-002",
            task_code: taskCode,
            location: "振动一室",
            status: "实验进行中",
            schedule_id: "schedule-axis-x-minus",
            sub_experiment_code: `${experimentCode}-AXIS-002`,
            axis_codes: ["x-"],
            trays: [
              {
                tray_code: "TASK-AXIS-EXPIRED-TP-001",
                status: "实验进行中",
                target_experiment_code: experimentCode,
                target_lab: "振动一室",
                schedule_id: "schedule-axis-x-minus",
                sub_experiment_code: `${experimentCode}-AXIS-002`,
                axis_codes: ["x-"],
              },
            ],
            history: [
              {
                action: "开始实验",
                detail: `${taskCode} / 振动试验 / 实验进行中`,
                schedule_id: "schedule-axis-x-minus",
                sub_experiment_code: `${experimentCode}-AXIS-002`,
                axis_codes: ["x-"],
                time: "2099-03-20T09:30:00.000Z",
              },
            ],
          },
        ],
        [STORAGE_KEYS.schedules]: [
          {
            id: "schedule-axis-y-plus",
            task_code: taskCode,
            experiment_code: experimentCode,
            device: "振动一室",
            start_at: "2099-03-20T08:00:00.000Z",
            end_at: "2099-03-20T10:00:00.000Z",
            status: "已排程",
            sub_experiment_code: `${experimentCode}-AXIS-003`,
            axis_batch_no: "003",
            axis_codes: ["y+"],
          },
        ],
        [STORAGE_KEYS.tasks]: [
          { code: taskCode, status: "已排程", test_type: "振动试验" },
        ],
      },
      { now },
    );

    expect(result.changed).toBe(true);
    expect(result.snapshot[STORAGE_KEYS.schedules]).toEqual([]);
    expect(result.snapshot[STORAGE_KEYS.conflicts]).toEqual([
      expect.objectContaining({
        type: SCHEDULE_EXCEPTION_TYPE,
        status: "pending",
        schedule_id: "schedule-axis-y-plus",
        task_code: taskCode,
        experiment_code: experimentCode,
        reason: SCHEDULE_EXCEPTION_REASON,
      }),
    ]);
    expect(result.snapshot[STORAGE_KEYS.experiments]).toEqual([
      expect.objectContaining({
        experiment_code: experimentCode,
        status: "待排程",
      }),
    ]);
  });
});
