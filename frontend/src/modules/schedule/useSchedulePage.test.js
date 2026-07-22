import { mount } from "@vue/test-utils";
import { defineComponent } from "vue";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadSnapshot: vi.fn(),
  persistSnapshot: vi.fn(),
  readMasterLabs: vi.fn(),
  writeStorageSchedulePatch: vi.fn(),
}));

vi.mock("@/composables/useStorageSnapshot", () => ({
  useStorageSnapshot: () => ({
    loadSnapshot: mocks.loadSnapshot,
    persistSnapshot: mocks.persistSnapshot,
  }),
}));

vi.mock("@/lib/masterDataApi", () => ({
  readMasterLabs: mocks.readMasterLabs,
}));

vi.mock("@/lib/storageApi", () => ({
  SNAPSHOT_UPDATED_EVENT: "mes:snapshot-updated",
  SNAPSHOT_UPDATED_STORAGE_KEY: "mes:snapshot-updated-at",
  subscribeStorageSnapshotUpdates: () => () => {},
  writeStorageSchedulePatch: mocks.writeStorageSchedulePatch,
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
    { task_code: "SYLU-2026-03-006", experiment_code: "SYLU-2026-03-006-A", experiment_name: "冲击试验", required_device: "冲击一室", unscheduled_since: "" },
    { task_code: "SYLU-2026-03-006", experiment_code: "SYLU-2026-03-006-B", experiment_name: "振动试验", required_device: "振动一室", axis_codes: ["y+"], unscheduled_since: "2099-03-18T09:00:00.000Z" },
    { task_code: "SYLU-2026-03-006", experiment_code: "SYLU-2026-03-006-C", experiment_name: "温度冲击试验", required_device: "振动一室", unscheduled_since: "2099-03-18T10:00:00.000Z" },
  ],
  "mes.experiment_trays": [
    { task_code: "SYLU-2026-03-006", experiment_code: "SYLU-2026-03-006-A", tray_code: "SYLU-2026-03-006-TP-001" },
    { task_code: "SYLU-2026-03-006", experiment_code: "SYLU-2026-03-006-A", tray_code: "SYLU-2026-03-006-TP-002" },
    { task_code: "SYLU-2026-03-006", experiment_code: "SYLU-2026-03-006-B", tray_code: "SYLU-2026-03-006-TP-002" },
    { task_code: "SYLU-2026-03-006", experiment_code: "SYLU-2026-03-006-B", tray_code: "SYLU-2026-03-006-TP-003" },
    { task_code: "SYLU-2026-03-006", experiment_code: "SYLU-2026-03-006-C", tray_code: "SYLU-2026-03-006-TP-001" },
    { task_code: "SYLU-2026-03-006", experiment_code: "SYLU-2026-03-006-C", tray_code: "SYLU-2026-03-006-TP-002" },
  ],
  "mes.experiment_runs": [],
  "mes.experiment_run_trays": [],
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
    mocks.readMasterLabs.mockResolvedValue([]);
    mocks.writeStorageSchedulePatch.mockResolvedValue({ ok: true, updatedKeys: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
    mocks.loadSnapshot.mockReset();
    mocks.persistSnapshot.mockReset();
    mocks.readMasterLabs.mockReset();
    mocks.writeStorageSchedulePatch.mockReset();
  });

  test("opens a partial conflict confirmation before persisting a new schedule", async () => {
    const wrapper = mount(TestHarness);
    await settle(wrapper);

    wrapper.vm.scheduleForm.task_code = "SYLU-2026-03-006";
    await settle(wrapper);
    wrapper.vm.scheduleForm.experiment_code = "SYLU-2026-03-006-B";
    wrapper.vm.scheduleForm.axis_codes = ["y+"];
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
    expect(mocks.persistSnapshot).not.toHaveBeenCalled();
    expect(mocks.writeStorageSchedulePatch).toHaveBeenCalledTimes(1);
    expect(mocks.writeStorageSchedulePatch.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        upserts: expect.objectContaining({
          "mes.schedules": expect.arrayContaining([
            expect.objectContaining({
              experiment_code: "SYLU-2026-03-006-C",
              task_code: "SYLU-2026-03-006",
            }),
          ]),
        }),
      }),
    );
  });

  test("directly persists a local schedule patch when the candidate schedule does not conflict with task trays", async () => {
    const wrapper = mount(TestHarness);
    await settle(wrapper);

    wrapper.vm.scheduleForm.task_code = "SYLU-2026-03-006";
    await settle(wrapper);
    wrapper.vm.scheduleForm.experiment_code = "SYLU-2026-03-006-B";
    wrapper.vm.scheduleForm.axis_codes = ["y+"];
    wrapper.vm.scheduleForm.device = "振动一室";
    wrapper.vm.scheduleForm.schedule_date = "2099-03-21";
    wrapper.vm.scheduleForm.time_slot = "afternoon";

    await wrapper.vm.submitSchedule();
    await settle(wrapper);

    expect(wrapper.vm.scheduleConflictOpen).toBe(false);
    expect(mocks.persistSnapshot).not.toHaveBeenCalled();
    expect(mocks.writeStorageSchedulePatch).toHaveBeenCalledTimes(1);
    expect(mocks.writeStorageSchedulePatch.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        upserts: expect.objectContaining({
          "mes.schedules": expect.arrayContaining([
            expect.objectContaining({
              experiment_code: "SYLU-2026-03-006-B",
              task_code: "SYLU-2026-03-006",
            }),
          ]),
        }),
      }),
    );
  });

  test("does not keep an optimistic schedule when persistence fails", async () => {
    mocks.writeStorageSchedulePatch.mockRejectedValueOnce(new Error("Failed to write storage schedule patch: 400 Bad Request，完成任务比对后排程不可删除或重新排程。"));
    const wrapper = mount(TestHarness);
    await settle(wrapper);

    wrapper.vm.scheduleForm.task_code = "SYLU-2026-03-006";
    await settle(wrapper);
    wrapper.vm.scheduleForm.experiment_code = "SYLU-2026-03-006-B";
    wrapper.vm.scheduleForm.axis_codes = ["y+"];
    wrapper.vm.scheduleForm.device = "振动一室";
    wrapper.vm.scheduleForm.schedule_date = "2099-03-21";
    wrapper.vm.scheduleForm.time_slot = "afternoon";

    await wrapper.vm.submitSchedule();
    await settle(wrapper);

    expect(mocks.persistSnapshot).not.toHaveBeenCalled();
    expect(mocks.writeStorageSchedulePatch).toHaveBeenCalledTimes(1);
    expect(wrapper.vm.scheduleWarning).toContain("排程保存失败");
    expect(wrapper.vm.scheduleWarning).toContain("完成任务比对后排程不可删除或重新排程");
    expect(wrapper.vm.scheduleRows.map((row) => row.id)).toEqual(
      expect.arrayContaining(["schedule-1", "schedule-retention-1"]),
    );
    expect(wrapper.vm.scheduleRows).toHaveLength(2);
  });

  test("shows maintenance labs as disabled manual choices with a maintenance hint", async () => {
    const snapshot = buildSnapshot();
    snapshot["mes.devices"] = [
      { code: "冲击一室", status: "维修" },
      { code: "冲击二室", status: "停用" },
      { code: "振动一室", status: "可用" },
    ];
    mocks.loadSnapshot.mockResolvedValue(snapshot);
    const wrapper = mount(TestHarness);
    await settle(wrapper);

    wrapper.vm.scheduleForm.task_code = "SYLU-2026-03-006";
    await settle(wrapper);
    wrapper.vm.scheduleForm.experiment_code = "SYLU-2026-03-006-A";
    await settle(wrapper);

    expect(wrapper.vm.manualLabOptionItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          disabled: true,
          title: expect.stringContaining("冲击一室维修中，暂不可排程"),
          value: "冲击一室",
        }),
        expect.objectContaining({
          disabled: true,
          title: expect.stringContaining("冲击二室已停用，暂不可排程"),
          value: "冲击二室",
        }),
      ]),
    );
    expect(wrapper.vm.maintenanceLabNotice).toBe("冲击一室维修中，暂不可排程；冲击二室已停用，暂不可排程");
  });

  test("keeps the current task code and resets the rest of the top form after scheduling one experiment", async () => {
    const wrapper = mount(TestHarness);
    await settle(wrapper);

    wrapper.vm.scheduleForm.task_code = "SYLU-2026-03-006";
    await settle(wrapper);
    wrapper.vm.scheduleForm.experiment_code = "SYLU-2026-03-006-B";
    wrapper.vm.scheduleForm.axis_codes = ["y+"];
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
    expect(mocks.persistSnapshot).not.toHaveBeenCalled();
    expect(mocks.writeStorageSchedulePatch).toHaveBeenCalledWith(
      expect.objectContaining({
        deletes: expect.objectContaining({
          "mes.schedules": expect.arrayContaining(["schedule-1"]),
        }),
      }),
      expect.any(Object),
    );
  });

  test("blocks deleting or rescheduling a task detail schedule after the experiment has started", async () => {
    mocks.loadSnapshot.mockResolvedValue({
      ...buildSnapshot(),
      "mes.schedules": [
        ...buildSnapshot()["mes.schedules"],
        {
          id: "schedule-2",
          task_code: "SYLU-2026-03-006",
          experiment_code: "SYLU-2026-03-006-A",
          device: "冲击二室",
          start_at: "2099-03-21T00:00:00.000Z",
          end_at: "2099-03-21T04:00:00.000Z",
          status: STATUS_SCHEDULED,
        },
      ],
      "mes.experiment_run_steps": [
        {
          task_code: "SYLU-2026-03-006",
          experiment_code: "SYLU-2026-03-006-A",
          axis_code: "z+",
          status: "实验已完成",
        },
      ],
      "mes.experiment_runs": [
        {
          task_code: "SYLU-2026-03-006",
          experiment_code: "SYLU-2026-03-006-A",
          status: "实验进行中",
        },
      ],
    });
    const wrapper = mount(TestHarness);
    await settle(wrapper);

    wrapper.vm.openTaskDetailModal("schedule-1");
    await settle(wrapper);

    await wrapper.vm.removeTaskDetailSchedule();
    await settle(wrapper);
    expect(wrapper.vm.taskDetailModalOpen).toBe(true);
    expect(wrapper.vm.editWarning).toBe("排程已完成任务比对，不能删除");
    expect(mocks.persistSnapshot).not.toHaveBeenCalled();

    wrapper.vm.editWarning = "";
    await wrapper.vm.rescheduleFromTaskDetail();
    await settle(wrapper);

    expect(wrapper.vm.taskDetailModalOpen).toBe(true);
    expect(wrapper.vm.editWarning).toBe("排程已完成任务比对，不能删除后重新排程");
    expect(mocks.persistSnapshot).not.toHaveBeenCalled();

    await wrapper.vm.openTaskDetailModal("schedule-2");
    await settle(wrapper);

    expect(wrapper.vm.taskDetailModalOpen).toBe(true);
    expect(wrapper.vm.editWarning).toBe("");

    wrapper.unmount();
  });

  test("persists experiment timers when creating and deleting formal schedules", async () => {
    const wrapper = mount(TestHarness);
    await settle(wrapper);

    wrapper.vm.scheduleForm.task_code = "SYLU-2026-03-006";
    await settle(wrapper);
    wrapper.vm.scheduleForm.experiment_code = "SYLU-2026-03-006-B";
    wrapper.vm.scheduleForm.axis_codes = ["y+"];
    wrapper.vm.scheduleForm.device = "振动一室";
    wrapper.vm.scheduleForm.schedule_date = "2099-03-21";
    wrapper.vm.scheduleForm.time_slot = "afternoon";

    await wrapper.vm.submitSchedule();
    await settle(wrapper);

    expect(mocks.writeStorageSchedulePatch).toHaveBeenCalledWith(
      expect.objectContaining({
        upserts: expect.objectContaining({
          "mes.experiments": expect.arrayContaining([
            expect.objectContaining({
              experiment_code: "SYLU-2026-03-006-B",
              unscheduled_since: "",
            }),
          ]),
        }),
      }),
      expect.any(Object),
    );

    mocks.writeStorageSchedulePatch.mockClear();
    wrapper.vm.openTaskDetailModal("schedule-1");
    await settle(wrapper);

    await wrapper.vm.removeTaskDetailSchedule();
    await settle(wrapper);

    expect(mocks.writeStorageSchedulePatch).toHaveBeenCalledWith(
      expect.objectContaining({
        upserts: expect.objectContaining({
          "mes.experiments": expect.arrayContaining([
            expect.objectContaining({
              experiment_code: "SYLU-2026-03-006-A",
              unscheduled_since: expect.any(String),
            }),
          ]),
        }),
      }),
      expect.any(Object),
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

  test("exposes a single scheduling flow without tab state or retention device options", async () => {
    const wrapper = mount(TestHarness);
    await settle(wrapper);

    wrapper.vm.scheduleForm.task_code = "SYLU-2026-03-006";
    await settle(wrapper);
    wrapper.vm.scheduleForm.experiment_code = "SYLU-2026-03-006-B";
    await settle(wrapper);

    expect(wrapper.vm.activeTab).toBeUndefined();
    expect(wrapper.vm.showRetentionPanel).toBeUndefined();
    expect(wrapper.vm.manualLabOptions).not.toContain(RETENTION_DEVICE);
  });

  test("loads master labs into manual lab options", async () => {
    const snapshot = buildSnapshot();
    snapshot["mes.tasks"][0].test_type = "盐雾试验";
    snapshot["mes.experiments"][1].required_device = "盐雾试验";
    mocks.loadSnapshot.mockResolvedValueOnce(snapshot);
    mocks.readMasterLabs.mockResolvedValueOnce([
      { id: 9, lab_id: 9, code: "LAB_SALT", name: "盐雾试验室", type: "实验室", testTypeName: "盐雾试验" },
      { code: "AREA_STAGING", name: RETENTION_DEVICE, type: "暂存间", testTypeName: "盐雾试验" },
    ]);

    const wrapper = mount(TestHarness);
    await settle(wrapper);

    wrapper.vm.scheduleForm.task_code = "SYLU-2026-03-006";
    await settle(wrapper);

    expect(wrapper.vm.manualLabOptions).toEqual(["盐雾试验室"]);
  });

  test("auto-selects the laboratory when an experiment type has exactly one available lab", async () => {
    const snapshot = buildSnapshot();
    snapshot["mes.experiments"][1].required_device = "盐雾试验";
    mocks.loadSnapshot.mockResolvedValueOnce(snapshot);
    mocks.readMasterLabs.mockResolvedValueOnce([
      { id: 9, lab_id: 9, code: "LAB_SALT", name: "盐雾试验室", type: "实验室", testTypeName: "盐雾试验" },
      { code: "AREA_STAGING", name: RETENTION_DEVICE, type: "暂存间", testTypeName: "盐雾试验" },
    ]);

    const wrapper = mount(TestHarness);
    await settle(wrapper);

    wrapper.vm.scheduleForm.task_code = "SYLU-2026-03-006";
    await settle(wrapper);
    wrapper.vm.scheduleForm.experiment_code = "SYLU-2026-03-006-B";
    await settle(wrapper);

    expect(wrapper.vm.manualLabOptions).toEqual(["盐雾试验室"]);
    expect(wrapper.vm.manualLabOptionItems[0]).toEqual(expect.objectContaining({ lab_code: "LAB_SALT", lab_id: 9 }));
    expect(wrapper.vm.scheduleForm.device).toBe("盐雾试验室");
    expect(wrapper.vm.scheduleForm.lab_code).toBe("LAB_SALT");
    expect(wrapper.vm.scheduleForm.lab_id).toBe(9);
  });

  test("keeps laboratory blank when an experiment type has multiple available labs", async () => {
    const snapshot = buildSnapshot();
    snapshot["mes.experiments"][1].required_device = "振动试验";
    mocks.loadSnapshot.mockResolvedValueOnce(snapshot);
    mocks.readMasterLabs.mockResolvedValueOnce([
      { code: "LAB_VIB_1", name: "振动一室", type: "实验室", testTypeName: "振动试验" },
      { code: "LAB_VIB_2", name: "振动二室", type: "实验室", testTypeName: "振动试验" },
    ]);

    const wrapper = mount(TestHarness);
    await settle(wrapper);

    wrapper.vm.scheduleForm.task_code = "SYLU-2026-03-006";
    await settle(wrapper);
    wrapper.vm.scheduleForm.experiment_code = "SYLU-2026-03-006-B";
    await settle(wrapper);

    expect(wrapper.vm.manualLabOptions).toEqual(["振动一室", "振动二室"]);
    expect(wrapper.vm.scheduleForm.device).toBe("");
  });

  test("locks later vibration axis scheduling to the first scheduled vibration lab", async () => {
    const snapshot = buildSnapshot();
    snapshot["mes.devices"] = [{ code: "振动一室" }, { code: "振动二室" }];
    snapshot["mes.experiments"][1] = {
      ...snapshot["mes.experiments"][1],
      axis_codes: ["y+", "x-"],
      required_device: "振动试验",
    };
    snapshot["mes.schedules"] = [
      ...snapshot["mes.schedules"],
      {
        id: "schedule-vibration-axis",
        task_code: "SYLU-2026-03-006",
        experiment_code: "SYLU-2026-03-006-B",
        device: "振动一室",
        start_at: "2099-03-20T08:00:00.000Z",
        end_at: "2099-03-20T09:00:00.000Z",
        status: STATUS_SCHEDULED,
        axis_codes: ["y+"],
      },
    ];
    mocks.loadSnapshot.mockResolvedValueOnce(snapshot);
    mocks.readMasterLabs.mockResolvedValueOnce([
      { code: "LAB_VIB_1", name: "振动一室", type: "实验室", testTypeName: "振动试验" },
      { code: "LAB_VIB_2", name: "振动二室", type: "实验室", testTypeName: "振动试验" },
    ]);

    const wrapper = mount(TestHarness);
    await settle(wrapper);

    wrapper.vm.scheduleForm.task_code = "SYLU-2026-03-006";
    await settle(wrapper);
    wrapper.vm.scheduleForm.experiment_code = "SYLU-2026-03-006-B";
    await settle(wrapper);

    expect(wrapper.vm.manualLabOptions).toEqual(["振动一室"]);
    expect(wrapper.vm.scheduleForm.device).toBe("振动一室");
  });

  test("locks later impact axis scheduling to the first scheduled impact lab", async () => {
    const snapshot = buildSnapshot();
    snapshot["mes.devices"] = [{ code: "冲击一室" }, { code: "冲击二室" }];
    snapshot["mes.experiments"][0] = {
      ...snapshot["mes.experiments"][0],
      axis_codes: ["y+", "x-"],
      required_device: "冲击试验",
    };
    snapshot["mes.schedules"] = [
      ...snapshot["mes.schedules"],
      {
        id: "schedule-impact-axis",
        task_code: "SYLU-2026-03-006",
        experiment_code: "SYLU-2026-03-006-A",
        device: "冲击一室",
        start_at: "2099-03-21T08:00:00.000Z",
        end_at: "2099-03-21T09:00:00.000Z",
        status: STATUS_SCHEDULED,
        axis_codes: ["y+"],
      },
    ];
    mocks.loadSnapshot.mockResolvedValueOnce(snapshot);
    mocks.readMasterLabs.mockResolvedValueOnce([
      { code: "LAB_IMPACT_1", name: "冲击一室", type: "实验室", testTypeName: "冲击试验" },
      { code: "LAB_IMPACT_2", name: "冲击二室", type: "实验室", testTypeName: "冲击试验" },
    ]);

    const wrapper = mount(TestHarness);
    await settle(wrapper);

    wrapper.vm.scheduleForm.task_code = "SYLU-2026-03-006";
    await settle(wrapper);
    wrapper.vm.scheduleForm.experiment_code = "SYLU-2026-03-006-A";
    await settle(wrapper);

    expect(wrapper.vm.manualLabOptions).toEqual(["冲击一室"]);
    expect(wrapper.vm.scheduleForm.device).toBe("冲击一室");
  });

  test("does not auto-select the only matching lab when it is unavailable", async () => {
    const snapshot = buildSnapshot();
    snapshot["mes.devices"] = [{ code: "盐雾试验室", status: "维修" }];
    snapshot["mes.experiments"][1].required_device = "盐雾试验";
    mocks.loadSnapshot.mockResolvedValueOnce(snapshot);
    mocks.readMasterLabs.mockResolvedValueOnce([
      { code: "LAB_SALT", name: "盐雾试验室", type: "实验室", testTypeName: "盐雾试验" },
    ]);

    const wrapper = mount(TestHarness);
    await settle(wrapper);

    wrapper.vm.scheduleForm.task_code = "SYLU-2026-03-006";
    await settle(wrapper);
    wrapper.vm.scheduleForm.experiment_code = "SYLU-2026-03-006-B";
    await settle(wrapper);

    expect(wrapper.vm.manualLabOptions).toEqual([]);
    expect(wrapper.vm.scheduleForm.device).toBe("");
    expect(wrapper.vm.maintenanceLabNotice).toContain("盐雾试验室维修中，暂不可排程");
  });

  test("falls back to static lab options when master labs fail to load", async () => {
    const snapshot = buildSnapshot();
    snapshot["mes.experiments"][1].required_device = "冲击试验";
    mocks.loadSnapshot.mockResolvedValueOnce(snapshot);
    mocks.readMasterLabs.mockRejectedValueOnce(new Error("offline"));

    const wrapper = mount(TestHarness);
    await settle(wrapper);

    wrapper.vm.scheduleForm.task_code = "SYLU-2026-03-006";
    await settle(wrapper);

    expect(wrapper.vm.scheduleWarning).toBe("");
    expect(wrapper.vm.manualLabOptions).toContain("冲击一室");
  });

  test.each([
    [
      "samples-updated",
      async () => {
        window.dispatchEvent(new CustomEvent("mes:samples-updated"));
      },
    ],
    [
      "storage snapshot update",
      async () => {
        window.dispatchEvent(new CustomEvent("mes:snapshot-updated", { detail: { keys: ["mes.schedules"] } }));
        vi.advanceTimersByTime(100);
      },
    ],
  ])("keeps existing schedule data when a %s refresh returns missing or malformed snapshot collections", async (_label, triggerRefresh) => {
    mocks.loadSnapshot.mockResolvedValueOnce(buildSnapshot());
    const wrapper = mount(TestHarness);
    await settle(wrapper);

    try {
      expect(wrapper.vm.scheduleRows.map((row) => row.id)).toContain("schedule-1");

      mocks.loadSnapshot.mockClear();
      mocks.loadSnapshot.mockResolvedValue({
        "mes.schedules": { stale: true },
      });

      await triggerRefresh();
      await settle(wrapper);

      expect(mocks.loadSnapshot).toHaveBeenCalled();
      expect(wrapper.vm.scheduleRows.map((row) => row.id)).toContain("schedule-1");
    } finally {
      wrapper.unmount();
    }
  });

  test("surfaces snapshot load failures on the scheduling form instead of rejecting", async () => {
    mocks.loadSnapshot.mockRejectedValueOnce(new Error("offline"));

    const wrapper = mount(TestHarness);
    await settle(wrapper);

    expect(wrapper.vm.scheduleWarning).toContain("排程数据加载失败");
    expect(wrapper.vm.scheduleRows).toEqual([]);
    expect(wrapper.vm.taskOptions).toEqual([]);
  });
});
