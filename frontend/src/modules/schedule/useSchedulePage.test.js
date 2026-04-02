import { mount } from "@vue/test-utils";
import { defineComponent } from "vue";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadSnapshot: vi.fn(),
  persistSnapshot: vi.fn(),
}));

vi.mock("@/composables/useStorageSnapshot", () => ({
  useStorageSnapshot: () => ({
    loadSnapshot: mocks.loadSnapshot,
    persistSnapshot: mocks.persistSnapshot,
  }),
}));

import { RETENTION_DEVICE, STATUS_SCHEDULED, STATUS_WAITING } from "./model";
import { useSchedulePage } from "./useSchedulePage";

const TestHarness = defineComponent({
  setup() {
    return useSchedulePage();
  },
  render() {
    return null;
  },
});

const settle = async (wrapper) => {
  await Promise.resolve();
  await Promise.resolve();
  await wrapper.vm.$nextTick();
  await wrapper.vm.$nextTick();
};

const buildSnapshot = () => ({
  "mes.devices": [{ code: "冲击一室" }, { code: "振动一室" }],
  "mes.experiments": [
    { task_code: "SYLU-2026-03-006", experiment_code: "SYLU-2026-03-006-A", experiment_name: "冲击试验", required_device: "冲击一室" },
    { task_code: "SYLU-2026-03-006", experiment_code: "SYLU-2026-03-006-B", experiment_name: "振动试验", required_device: "振动一室" },
    { task_code: "SYLU-2026-03-006", experiment_code: "SYLU-2026-03-006-C", experiment_name: "温度冲击试验", required_device: "振动一室" },
  ],
  "mes.experiment_trays": [
    { task_code: "SYLU-2026-03-006", experiment_code: "SYLU-2026-03-006-A", tray_code: "SYLU-2026-03-006-TP-001" },
    { task_code: "SYLU-2026-03-006", experiment_code: "SYLU-2026-03-006-A", tray_code: "SYLU-2026-03-006-TP-002" },
    { task_code: "SYLU-2026-03-006", experiment_code: "SYLU-2026-03-006-B", tray_code: "SYLU-2026-03-006-TP-002" },
    { task_code: "SYLU-2026-03-006", experiment_code: "SYLU-2026-03-006-B", tray_code: "SYLU-2026-03-006-TP-003" },
    { task_code: "SYLU-2026-03-006", experiment_code: "SYLU-2026-03-006-C", tray_code: "SYLU-2026-03-006-TP-001" },
    { task_code: "SYLU-2026-03-006", experiment_code: "SYLU-2026-03-006-C", tray_code: "SYLU-2026-03-006-TP-002" },
  ],
  "mes.samples": [],
  "mes.schedules": [
    {
      id: "schedule-1",
      task_code: "SYLU-2026-03-006",
      experiment_code: "SYLU-2026-03-006-A",
      device: "冲击一室",
      start_at: "2099-03-20T00:00:00.000Z",
      end_at: "2099-03-20T04:00:00.000Z",
      status: STATUS_SCHEDULED,
    },
    {
      id: "schedule-retention-1",
      task_code: "SYLU-2026-03-008",
      experiment_code: "SYLU-2026-03-008-A",
      device: RETENTION_DEVICE,
      start_at: "2099-03-19T08:00:00.000Z",
      end_at: "2099-03-19T08:00:00.000Z",
      status: "暂存间存放",
    },
  ],
  "mes.streams": [],
  "mes.tasks": [
    { code: "SYLU-2026-03-006", name: "多实验任务", test_type: "冲击试验", status: STATUS_WAITING },
    { code: "SYLU-2026-03-008", name: "留样任务", test_type: "冲击试验", status: "暂存间存放" },
  ],
});

describe("useSchedulePage", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2099-03-19T09:00:00"));
    mocks.loadSnapshot.mockResolvedValue(buildSnapshot());
    mocks.persistSnapshot.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    mocks.loadSnapshot.mockReset();
    mocks.persistSnapshot.mockReset();
  });

  test("opens a partial conflict confirmation before persisting a new schedule", async () => {
    const wrapper = mount(TestHarness);
    await settle(wrapper);

    wrapper.vm.scheduleForm.task_code = "SYLU-2026-03-006";
    await settle(wrapper);
    wrapper.vm.scheduleForm.experiment_code = "SYLU-2026-03-006-B";
    wrapper.vm.scheduleForm.device = "振动一室";
    wrapper.vm.scheduleForm.schedule_date = "2099-03-20";
    wrapper.vm.scheduleForm.time_slot = "morning";

    await wrapper.vm.submitSchedule();
    await settle(wrapper);

    expect(wrapper.vm.scheduleConflictOpen).toBe(true);
    expect(wrapper.vm.scheduleConflictDetail).toEqual(
      expect.objectContaining({
        level: "partial",
        conflictTrayNos: ["SYLU-2026-03-006-TP-002"],
      }),
    );
    expect(mocks.persistSnapshot).not.toHaveBeenCalled();

    wrapper.vm.cancelScheduleConflict();
    await settle(wrapper);

    expect(wrapper.vm.scheduleConflictOpen).toBe(false);
    expect(mocks.persistSnapshot).not.toHaveBeenCalled();
  });

  test("confirms a full conflict and then persists the original schedule payload", async () => {
    const wrapper = mount(TestHarness);
    await settle(wrapper);

    wrapper.vm.scheduleForm.task_code = "SYLU-2026-03-006";
    await settle(wrapper);
    wrapper.vm.scheduleForm.experiment_code = "SYLU-2026-03-006-C";
    wrapper.vm.scheduleForm.device = "振动一室";
    wrapper.vm.scheduleForm.schedule_date = "2099-03-20";
    wrapper.vm.scheduleForm.time_slot = "morning";

    await wrapper.vm.submitSchedule();
    await settle(wrapper);

    expect(wrapper.vm.scheduleConflictOpen).toBe(true);
    expect(wrapper.vm.scheduleConflictDetail).toEqual(
      expect.objectContaining({
        level: "full",
        conflictTrayNos: ["SYLU-2026-03-006-TP-001", "SYLU-2026-03-006-TP-002"],
      }),
    );

    await wrapper.vm.confirmScheduleConflict();
    await settle(wrapper);

    expect(wrapper.vm.scheduleConflictOpen).toBe(false);
    expect(mocks.persistSnapshot).toHaveBeenCalledTimes(1);
    expect(mocks.persistSnapshot.mock.calls[0][0]["mes.schedules"]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          experiment_code: "SYLU-2026-03-006-C",
          task_code: "SYLU-2026-03-006",
        }),
      ]),
    );
  });

  test("directly persists when the candidate schedule does not conflict with task trays", async () => {
    const wrapper = mount(TestHarness);
    await settle(wrapper);

    wrapper.vm.scheduleForm.task_code = "SYLU-2026-03-006";
    await settle(wrapper);
    wrapper.vm.scheduleForm.experiment_code = "SYLU-2026-03-006-B";
    wrapper.vm.scheduleForm.device = "振动一室";
    wrapper.vm.scheduleForm.schedule_date = "2099-03-21";
    wrapper.vm.scheduleForm.time_slot = "afternoon";

    await wrapper.vm.submitSchedule();
    await settle(wrapper);

    expect(wrapper.vm.scheduleConflictOpen).toBe(false);
    expect(mocks.persistSnapshot).toHaveBeenCalledTimes(1);
  });

  test("keeps the current task code and resets the rest of the top form after scheduling one experiment", async () => {
    const wrapper = mount(TestHarness);
    await settle(wrapper);

    wrapper.vm.scheduleForm.task_code = "SYLU-2026-03-006";
    await settle(wrapper);
    wrapper.vm.scheduleForm.experiment_code = "SYLU-2026-03-006-B";
    wrapper.vm.scheduleForm.device = "振动一室";
    wrapper.vm.scheduleForm.schedule_date = "2099-03-21";
    wrapper.vm.scheduleForm.time_slot = "afternoon";
    wrapper.vm.scheduleForm.planned_hours = 5;

    await wrapper.vm.submitSchedule();
    await settle(wrapper);

    expect(wrapper.vm.scheduleForm).toEqual(
      expect.objectContaining({
        custom_end: "",
        custom_start: "",
        device: "",
        experiment_code: "SYLU-2026-03-006-C",
        planned_hours: 3.5,
        schedule_date: "2099-03-19",
        task_code: "SYLU-2026-03-006",
        time_slot: "morning",
      }),
    );
  });

  test("deletes a schedule from task detail", async () => {
    const wrapper = mount(TestHarness);
    await settle(wrapper);

    wrapper.vm.openTaskDetailModal("schedule-1");
    await settle(wrapper);
    expect(wrapper.vm.taskDetailModalOpen).toBe(true);

    await wrapper.vm.removeTaskDetailSchedule();
    await settle(wrapper);

    expect(wrapper.vm.taskDetailModalOpen).toBe(false);
    expect(mocks.persistSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        "mes.schedules": expect.not.arrayContaining([expect.objectContaining({ id: "schedule-1" })]),
      }),
    );
  });

  test("deletes a schedule from task detail and backfills the top form for re-scheduling", async () => {
    const wrapper = mount(TestHarness);
    await settle(wrapper);

    wrapper.vm.openTaskDetailModal("schedule-1");
    await settle(wrapper);

    await wrapper.vm.rescheduleFromTaskDetail();
    await settle(wrapper);

    expect(wrapper.vm.taskDetailModalOpen).toBe(false);
    expect(wrapper.vm.scheduleForm).toEqual(
      expect.objectContaining({
        custom_start: "08:00",
        device: "冲击一室",
        experiment_code: "SYLU-2026-03-006-A",
        planned_hours: 4,
        schedule_date: "2099-03-20",
        task_code: "SYLU-2026-03-006",
        time_slot: "morning",
      }),
    );
    expect(wrapper.vm.experimentOptions.map((option) => option.code)).toContain("SYLU-2026-03-006-A");
  });

  test("uses the selected task code to scope the gantt view instead of the currently selected device", async () => {
    const wrapper = mount(TestHarness);
    await settle(wrapper);

    wrapper.vm.scheduleForm.task_code = "SYLU-2026-03-006";
    await settle(wrapper);

    expect(wrapper.vm.ganttView.rows.map((row) => row.device)).toEqual(["冲击一室", "振动一室"]);

    wrapper.vm.scheduleForm.device = "冲击一室";
    await settle(wrapper);

    expect(wrapper.vm.ganttView.rows.map((row) => row.device)).toEqual(["冲击一室", "振动一室"]);
  });
});
