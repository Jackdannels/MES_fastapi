import { describe, expect, test } from "vitest";
import { buildScheduleDragPreview, canDragSchedule, getGanttDropSlots } from "./scheduleDragModel";
import { buildGanttRows } from "./scheduleViewModel";
import { parseDate } from "./sharedModel";

const source = {
  id: "move", task_code: "TASK-1", experiment_code: "TASK-1-A", device: "冲击一室", status: "已排程",
  start_at: "2099-03-20T14:00:00", end_at: "2099-03-20T15:00:00", planned_hours: 1,
  axis_codes: ["x+"], axis_batch_no: "BATCH-1", sub_experiment_code: "TASK-1-A-X",
};
const context = (extra = {}) => ({
  schedules: [{ ...source }], tasks: [], devices: [], experiments: [], experimentTrays: [],
  experimentRuns: [], experimentRunSteps: [], experimentRunTrays: [], samples: [], streams: [],
  now: parseDate("2099-03-19T09:00:00"), ...extra,
});
const target = { scheduleId: "move", date: "2099-03-21", slot: "morning", lab: { name: "冲击一室" } };
const other = (id, start, end, fields = {}) => ({ ...source, id, task_code: id, experiment_code: `${id}-A`, start_at: start, end_at: end, ...fields });

describe("schedule drag preview", () => {
  test("moves an afternoon experiment to 08:00 next morning without changing duration or identity", () => {
    const input = context();
    const preview = buildScheduleDragPreview(input, target);
    expect(preview.error).toBeUndefined();
    expect(preview.startAt).toBe("2099-03-21 08:00:00");
    expect(preview.endAt).toBe("2099-03-21 09:00:00");
    expect(preview.result.schedules[0]).toMatchObject({ id: "move", planned_hours: 1, axis_codes: ["x+"], axis_batch_no: "BATCH-1", sub_experiment_code: "TASK-1-A-X" });
    expect(input.schedules[0]).toEqual(source);
  });

  test("appends after the last morning schedule plus ten minutes, including when an earlier gap exists", () => {
    const preview = buildScheduleDragPreview(context({ schedules: [source,
      other("early", "2099-03-21T08:00:00", "2099-03-21T08:30:00"),
      other("later", "2099-03-21T10:00:00", "2099-03-21T10:30:00"),
    ] }), target);
    expect(preview.startAt).toBe("2099-03-21 10:40:00");
    expect(preview.endAt).toBe("2099-03-21 11:40:00");
  });

  test("accounts for an overnight predecessor and ignores other laboratories", () => {
    const preview = buildScheduleDragPreview(context({ schedules: [source,
      other("overnight", "2099-03-20T18:00:00", "2099-03-21T08:30:00"),
      other("other-lab", "2099-03-21T08:00:00", "2099-03-21T12:00:00", { device: "冲击二室" }),
    ] }), target);
    expect(preview.startAt).toBe("2099-03-21 08:40:00");
  });

  test("rounds up fractional predecessor minutes so the full ten-minute interval is preserved", () => {
    const preview = buildScheduleDragPreview(context({ schedules: [source,
      other("seconds", "2099-03-21T08:00:00", "2099-03-21T10:00:30"),
    ] }), target);
    expect(preview.startAt).toBe("2099-03-21 10:11:00");
  });

  test("allows a long experiment to extend beyond noon if the following period is free", () => {
    const preview = buildScheduleDragPreview(context({ schedules: [{ ...source, planned_hours: 6, end_at: "2099-03-20T20:00:00" }] }), target);
    expect(preview.endAt).toBe("2099-03-21 14:00:00");
  });

  test("rejects a full morning and a conflict with the following afternoon", () => {
    expect(buildScheduleDragPreview(context({ schedules: [source, other("full", "2099-03-21T08:00:00", "2099-03-21T12:00:00")] }), target).error).toContain("已排满");
    expect(buildScheduleDragPreview(context({ schedules: [
      { ...source, planned_hours: 6, end_at: "2099-03-20T20:00:00" },
      other("afternoon", "2099-03-21T12:00:00", "2099-03-21T15:00:00"),
    ] }), target).error).toContain("后续排程冲突");
  });

  test("uses noon for an empty afternoon and rejects past slots and changing laboratories", () => {
    expect(buildScheduleDragPreview(context(), { ...target, slot: "afternoon" }).startAt).toBe("2099-03-21 12:00:00");
    expect(buildScheduleDragPreview(context(), { ...target, date: "2099-03-18" }).error).toContain("已过期");
    expect(buildScheduleDragPreview(context(), { ...target, lab: { name: "冲击二室" } }).error).toContain("同一实验室");
  });

  test("rejects compared and running schedules, removed schedules, and ambiguous merged cards", () => {
    const input = context({ experimentRuns: [{ task_code: source.task_code, experiment_code: source.experiment_code, schedule_id: source.id, status: "已到达实验室" }] });
    expect(canDragSchedule(input, "move")).toBe(false);
    expect(buildScheduleDragPreview(input, target).error).toContain("任务比对");
    expect(canDragSchedule(context({ schedules: [{ ...source, status: "实验进行中" }] }), "move")).toBe(false);
    expect(canDragSchedule(context({ schedules: [] }), "move")).toBe(false);
    expect(canDragSchedule(context(), "move", ["move", "second"])).toBe(false);
  });

  test("rejects device maintenance and overlapping use of a shared tray", () => {
    const maintenance = context({ devices: [{ code: "冲击一室", maintenance_type: "维修", maintenance_start_at: "2099-03-21T08:00:00", maintenance_end_at: "2099-03-21T12:00:00", status: "维修中" }] });
    expect(buildScheduleDragPreview(maintenance, target).error).toBeTruthy();
    const shared = context({
      schedules: [source, other("shared", "2099-03-21T08:00:00", "2099-03-21T10:00:00", { device: "冲击二室", task_code: "TASK-1", experiment_code: "TASK-1-B" })],
      experimentTrays: [{ task_code: "TASK-1", experiment_code: "TASK-1-A", tray_code: "TRAY-1" }, { task_code: "TASK-1", experiment_code: "TASK-1-B", tray_code: "TRAY-1" }],
    });
    expect(buildScheduleDragPreview(shared, target).error).toContain("共用托盘");
  });

  test("resets old delay metadata so automatic delay calculations use the moved time", () => {
    const preview = buildScheduleDragPreview(context({ schedules: [{ ...source, original_start_at: "2099-03-20T13:00:00", original_end_at: "2099-03-20T14:00:00", delay_minutes: 60, delay_status: "waiting_active_run_end", source_run_no: "old-run" }] }), target);
    const moved = preview.result.schedules[0];
    expect(moved).not.toHaveProperty("original_start_at");
    expect(moved).not.toHaveProperty("delay_status");
    expect(moved).not.toHaveProperty("source_run_no");
  });

  test("resolves all six half-days in merged gantt cells without changing the normal layout", () => {
    const gantt = buildGanttRows({ schedules: [], devices: [{ code: "冲击一室" }], startDate: parseDate("2099-03-19T09:00:00") });
    const row = gantt.rows.find(item => item.device === "冲击一室");
    const slots = row.segments.flatMap((segment, i) => getGanttDropSlots(row, i));
    expect(slots.map(item => `${item.date}-${item.segment}`)).toEqual([
      "2099-03-19-am", "2099-03-19-pm", "2099-03-20-am", "2099-03-20-pm", "2099-03-21-am", "2099-03-21-pm",
    ]);
  });
});
