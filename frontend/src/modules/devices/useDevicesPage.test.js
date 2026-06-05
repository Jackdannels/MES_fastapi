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

import { useDevicesPage } from "./useDevicesPage";

const TestHarness = defineComponent({
  setup() {
    return useDevicesPage();
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

const buildRunningExperimentSnapshot = () => ({
  "mes.devices": [
    { code: "冲击一室", name: "冲击试验系统-1", status: "可用" },
  ],
  "mes.experiment_trays": [
    { experiment_code: "TASK-001-A", task_code: "TASK-001", tray_code: "TASK-001-TP-001" },
  ],
  "mes.experiment_runs": [
    {
      device: "冲击一室",
      experiment_code: "TASK-001-A",
      planned_end_at: "2099-03-20T10:00",
      run_no: "RUN-001",
      status: "实验进行中",
      task_code: "TASK-001",
      tray_codes: ["TASK-001-TP-001"],
    },
  ],
  "mes.samples": [
    {
      code: "TASK-001-SP-001",
      flow_status: "实验进行中",
      history: [
        {
          action: "实验完成",
          detail: "TASK-001 / 高低温试验 / 实验已完成",
          location: "高低温试验室",
          status: "实验已完成",
          time: "2099-03-19T07:15:00.000Z",
        },
      ],
      location: "冲击一室",
      status: "实验进行中",
      task_code: "TASK-001",
      trays: [{ tray_code: "TASK-001-TP-001", status: "实验进行中" }],
    },
  ],
  "mes.schedules": [
    {
      device: "冲击一室",
      end_at: "2099-03-20T10:00",
      experiment_code: "TASK-001-A",
      experiment_name: "冲击试验",
      id: "schedule-1",
      start_at: "2099-03-20T07:00",
      status: "实验进行中",
      task_code: "TASK-001",
    },
  ],
  "mes.conflicts": [],
  "mes.experiments": [
    { experiment_code: "TASK-001-A", experiment_name: "冲击试验", status: "实验进行中", task_code: "TASK-001" },
  ],
  "mes.tasks": [{ code: "TASK-001", status: "实验进行中" }],
});

describe("useDevicesPage", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2099-03-20T07:30:00"));
    mocks.persistSnapshot.mockResolvedValue(undefined);
    mocks.loadSnapshot.mockResolvedValue({
      "mes.devices": [
        { code: "冲击一室", name: "冲击试验系统-1", status: "可用" },
      ],
      "mes.experiment_trays": [],
      "mes.experiment_runs": [],
      "mes.samples": [
        {
          task_code: "TASK-001",
          history: [{ action: "任务已确认入库", time: "2099-03-19T07:15:00.000Z" }],
          status: "到货",
          trays: [{ tray_code: "TASK-001-TP-001", status: "到货" }],
        },
      ],
      "mes.schedules": [
        {
          device: "冲击一室",
          end_at: "2099-03-20T10:00",
          experiment_code: "TASK-001-A",
          id: "schedule-1",
          start_at: "2099-03-20T08:00",
          status: "已排程",
          task_code: "TASK-001",
        },
      ],
      "mes.conflicts": [],
      "mes.experiments": [
        { experiment_code: "TASK-001-A", status: "已排程", task_code: "TASK-001" },
      ],
      "mes.tasks": [{ code: "TASK-001", status: "已排程" }],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    mocks.loadSnapshot.mockReset();
    mocks.persistSnapshot.mockReset();
  });

  test("opens conflict confirmation before saving an overlapping maintenance plan", async () => {
    const wrapper = mount(TestHarness);
    await settle(wrapper);

    wrapper.vm.openMaintenancePlan(wrapper.vm.deviceRows[0]);
    wrapper.vm.maintenancePlanForm.startAt = "2099-03-20T09:00";
    wrapper.vm.maintenancePlanForm.endAt = "2099-03-20T11:00";

    await wrapper.vm.saveMaintenancePlan();
    await settle(wrapper);

    expect(wrapper.vm.maintenanceConflictOpen).toBe(true);
    expect(wrapper.vm.maintenanceConflictDetail.conflictingSchedules).toEqual([
      expect.objectContaining({ id: "schedule-1" }),
    ]);
    expect(mocks.persistSnapshot).not.toHaveBeenCalled();

    await wrapper.vm.confirmMaintenanceConflict();
    await settle(wrapper);

    expect(mocks.persistSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        "mes.schedules": [],
        "mes.conflicts": [
          expect.objectContaining({
            device: "冲击一室",
            detail: "冲击一室在排程期间维护，已自动删除",
            reason: "冲击一室在排程期间维护，已自动删除",
            schedule_id: "schedule-1",
            status: "pending",
            type: "device_maintenance_schedule_removed",
          }),
        ],
        "mes.devices": [
          expect.objectContaining({
            code: "冲击一室",
            maintenance_end_at: "2099-03-20T11:00",
            maintenance_start_at: "2099-03-20T09:00",
          }),
        ],
        "mes.experiments": [
          expect.objectContaining({
            experiment_code: "TASK-001-A",
            unscheduled_since: "2099-03-19 15:15:00",
          }),
        ],
      }),
    );
  });

  test("opens conflict confirmation before directly saving an unavailable device status", async () => {
    const wrapper = mount(TestHarness);
    await settle(wrapper);

    wrapper.vm.openEditDevice(wrapper.vm.deviceRows[0]);
    wrapper.vm.deviceForm.status = "停用";

    await wrapper.vm.saveEditedDevice();
    await settle(wrapper);

    expect(wrapper.vm.maintenanceConflictOpen).toBe(true);
    expect(wrapper.vm.maintenanceConflictDetail.conflictingSchedules).toEqual([
      expect.objectContaining({ id: "schedule-1" }),
    ]);
    expect(mocks.persistSnapshot).not.toHaveBeenCalled();
  });

  test("refreshes planned maintenance status while the device page stays open", async () => {
    mocks.loadSnapshot.mockResolvedValueOnce({
      "mes.devices": [
        {
          code: "冲击一室",
          maintenance_end_at: "2099-03-20T09:00",
          maintenance_start_at: "2099-03-20T08:00",
          maintenance_type: "计划维修",
          name: "冲击试验系统-1",
          status: "可用",
        },
      ],
      "mes.experiment_trays": [],
      "mes.samples": [],
      "mes.schedules": [],
      "mes.conflicts": [],
      "mes.experiments": [],
      "mes.tasks": [],
    });

    const wrapper = mount(TestHarness);
    await settle(wrapper);

    expect(wrapper.vm.deviceRows[0].status).toBe("空闲");

    vi.setSystemTime(new Date("2099-03-20T08:01:00"));
    await vi.advanceTimersByTimeAsync(1000);
    await settle(wrapper);

    expect(wrapper.vm.deviceRows[0].status).toBe("维修");
    expect(mocks.persistSnapshot).toHaveBeenCalledWith({
      "mes.devices": [
        expect.objectContaining({
          code: "冲击一室",
          status: "维修",
        }),
      ],
    });

    vi.setSystemTime(new Date("2099-03-20T09:01:00"));
    await vi.advanceTimersByTimeAsync(1000);
    await settle(wrapper);

    expect(wrapper.vm.deviceRows[0].status).toBe("空闲");
    expect(mocks.persistSnapshot).toHaveBeenLastCalledWith({
      "mes.devices": [
        expect.objectContaining({
          code: "冲击一室",
          status: "可用",
        }),
      ],
    });
  });

  test("starts planned maintenance without an end time when the start time arrives", async () => {
    mocks.loadSnapshot.mockResolvedValueOnce({
      "mes.devices": [
        {
          code: "冲击一室",
          maintenance_end_at: "",
          maintenance_start_at: "2099-03-20T08:00",
          maintenance_type: "计划保养",
          name: "冲击试验系统-1",
          status: "可用",
        },
      ],
      "mes.experiment_trays": [],
      "mes.samples": [],
      "mes.schedules": [],
      "mes.conflicts": [],
      "mes.experiments": [],
      "mes.tasks": [],
    });

    const wrapper = mount(TestHarness);
    await settle(wrapper);

    expect(wrapper.vm.deviceRows[0].status).toBe("空闲");

    vi.setSystemTime(new Date("2099-03-20T08:01:00"));
    await vi.advanceTimersByTimeAsync(1000);
    await settle(wrapper);

    expect(wrapper.vm.deviceRows[0].status).toBe("保养");
    expect(mocks.persistSnapshot).toHaveBeenCalledWith({
      "mes.devices": [
        expect.objectContaining({
          code: "冲击一室",
          status: "保养",
        }),
      ],
    });
  });

  test("saves immediate repair as active safety status without a user start time", async () => {
    const wrapper = mount(TestHarness);
    await settle(wrapper);

    wrapper.vm.openMaintenancePlan(wrapper.vm.deviceRows[0]);
    wrapper.vm.maintenancePlanForm.type = "维修";
    wrapper.vm.maintenancePlanForm.startAt = "2099-03-25T08:00";
    wrapper.vm.maintenancePlanForm.endAt = "";

    await wrapper.vm.saveMaintenancePlan();
    await settle(wrapper);

    expect(mocks.persistSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        "mes.devices": [
          expect.objectContaining({
            code: "冲击一室",
            maintenance_start_at: "2099-03-20 07:30:00",
            maintenance_type: "维修",
            status: "维修",
          }),
        ],
      }),
    );
  });

  test("saves planned maintenance without an end time", async () => {
    const wrapper = mount(TestHarness);
    await settle(wrapper);

    wrapper.vm.openMaintenancePlan(wrapper.vm.deviceRows[0]);
    wrapper.vm.maintenancePlanForm.type = "计划保养";
    wrapper.vm.maintenancePlanForm.startAt = "2099-03-20T09:00";
    wrapper.vm.maintenancePlanForm.endAt = "";

    await wrapper.vm.saveMaintenancePlan();
    await settle(wrapper);

    expect(wrapper.vm.maintenancePlanWarning).toBe("");
    expect(mocks.persistSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        "mes.devices": [
          expect.objectContaining({
            code: "冲击一室",
            maintenance_end_at: "",
            maintenance_start_at: "2099-03-20T09:00",
            maintenance_type: "计划保养",
            status: "可用",
          }),
        ],
      }),
    );
  });

  test("shows a warning when planned maintenance has no start time", async () => {
    const wrapper = mount(TestHarness);
    await settle(wrapper);

    wrapper.vm.openMaintenancePlan(wrapper.vm.deviceRows[0]);
    wrapper.vm.maintenancePlanForm.type = "计划维修";
    wrapper.vm.maintenancePlanForm.startAt = "";
    wrapper.vm.maintenancePlanForm.endAt = "2099-03-20T09:00";

    await wrapper.vm.saveMaintenancePlan();
    await settle(wrapper);

    expect(wrapper.vm.maintenancePlanWarning).toBe("请选择开始时间");
    expect(mocks.persistSnapshot).not.toHaveBeenCalled();
  });

  test("blocks planned maintenance while the device is running an experiment", async () => {
    mocks.loadSnapshot.mockResolvedValueOnce(buildRunningExperimentSnapshot());
    const wrapper = mount(TestHarness);
    await settle(wrapper);

    wrapper.vm.openMaintenancePlan(wrapper.vm.deviceRows[0]);
    wrapper.vm.maintenancePlanForm.type = "计划维修";
    wrapper.vm.maintenancePlanForm.startAt = "2099-03-20T08:00";
    wrapper.vm.maintenancePlanForm.endAt = "2099-03-20T09:00";

    await wrapper.vm.saveMaintenancePlan();
    await settle(wrapper);

    expect(wrapper.vm.runningRepairChoiceOpen).toBe(false);
    expect(wrapper.vm.maintenancePlanWarning).toBe("设备正在运行无法进行计划维修");
    expect(mocks.persistSnapshot).not.toHaveBeenCalled();
  });

  test("shows a running warning when selecting care while the device is running an experiment", async () => {
    mocks.loadSnapshot.mockResolvedValueOnce(buildRunningExperimentSnapshot());
    const wrapper = mount(TestHarness);
    await settle(wrapper);

    wrapper.vm.openMaintenancePlan(wrapper.vm.deviceRows[0]);
    wrapper.vm.maintenancePlanForm.type = "保养";

    await wrapper.vm.saveMaintenancePlan();
    await settle(wrapper);

    expect(wrapper.vm.runningRepairChoiceOpen).toBe(false);
    expect(wrapper.vm.maintenancePlanWarning).toBe("设备正在运行无法进行保养");
    expect(mocks.persistSnapshot).not.toHaveBeenCalled();
  });

  test("shows a running warning when selecting planned care while the device is running an experiment", async () => {
    mocks.loadSnapshot.mockResolvedValueOnce(buildRunningExperimentSnapshot());
    const wrapper = mount(TestHarness);
    await settle(wrapper);

    wrapper.vm.openMaintenancePlan(wrapper.vm.deviceRows[0]);
    wrapper.vm.maintenancePlanForm.type = "计划保养";

    await wrapper.vm.saveMaintenancePlan();
    await settle(wrapper);

    expect(wrapper.vm.runningRepairChoiceOpen).toBe(false);
    expect(wrapper.vm.maintenancePlanWarning).toBe("设备正在运行无法进行计划保养");
    expect(mocks.persistSnapshot).not.toHaveBeenCalled();
  });

  test("requires a repair choice while the device is running an experiment", async () => {
    mocks.loadSnapshot.mockResolvedValueOnce(buildRunningExperimentSnapshot());
    const wrapper = mount(TestHarness);
    await settle(wrapper);

    wrapper.vm.openMaintenancePlan(wrapper.vm.deviceRows[0]);
    wrapper.vm.maintenancePlanForm.type = "维修";

    await wrapper.vm.saveMaintenancePlan();
    await settle(wrapper);

    expect(wrapper.vm.runningRepairChoiceOpen).toBe(true);
    expect(wrapper.vm.maintenancePlanWarning).toBe("");
    expect(wrapper.vm.runningRepairChoiceDetail.runningSchedules).toEqual([
      expect.objectContaining({ id: "schedule-1" }),
    ]);
    expect(mocks.persistSnapshot).not.toHaveBeenCalled();
  });

  test("reschedules the running experiment and rolls trays back to the previous stable state", async () => {
    mocks.loadSnapshot.mockResolvedValueOnce(buildRunningExperimentSnapshot());
    const wrapper = mount(TestHarness);
    await settle(wrapper);

    wrapper.vm.openMaintenancePlan(wrapper.vm.deviceRows[0]);
    wrapper.vm.maintenancePlanForm.type = "维修";
    await wrapper.vm.saveMaintenancePlan();
    await wrapper.vm.confirmRunningRepairReschedule();
    await settle(wrapper);

    expect(mocks.persistSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        "mes.devices": [
          expect.objectContaining({
            code: "冲击一室",
            maintenance_start_at: "2099-03-20 07:30:00",
            maintenance_type: "维修",
            status: "维修",
          }),
        ],
        "mes.schedules": [],
        "mes.samples": [
          expect.objectContaining({
            flow_status: "实验已完成",
            location: "高低温试验室",
            status: "实验已完成",
            trays: [expect.objectContaining({ status: "实验已完成", tray_code: "TASK-001-TP-001" })],
          }),
        ],
        "mes.experiment_runs": [],
      }),
    );
  });

  test("completes the running experiment before saving the repair status", async () => {
    mocks.loadSnapshot.mockResolvedValueOnce(buildRunningExperimentSnapshot());
    const wrapper = mount(TestHarness);
    await settle(wrapper);

    wrapper.vm.openMaintenancePlan(wrapper.vm.deviceRows[0]);
    wrapper.vm.maintenancePlanForm.type = "维修";
    await wrapper.vm.saveMaintenancePlan();
    await wrapper.vm.confirmRunningRepairComplete();
    await settle(wrapper);

    expect(mocks.persistSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        "mes.devices": [
          expect.objectContaining({
            code: "冲击一室",
            maintenance_start_at: "2099-03-20 07:30:00",
            maintenance_type: "维修",
            status: "维修",
          }),
        ],
        "mes.experiments": [
          expect.objectContaining({
            actual_end_time: "2099-03-20 07:30:00",
            experiment_code: "TASK-001-A",
            status: "实验已完成",
          }),
        ],
        "mes.samples": [
          expect.objectContaining({
            flow_status: "实验已完成",
            location: "冲击一室",
            status: "实验已完成",
            trays: [expect.objectContaining({ status: "实验已完成", tray_code: "TASK-001-TP-001" })],
          }),
        ],
        "mes.experiment_runs": [
          expect.objectContaining({
            ended_at: "2099-03-20 07:30:00",
            run_no: "RUN-001",
            status: "实验已完成",
          }),
        ],
        "mes.schedules": [],
      }),
    );
  });

  test("detects a running repair conflict from experiment runs before sample refreshes", async () => {
    const snapshot = buildRunningExperimentSnapshot();
    snapshot["mes.samples"] = snapshot["mes.samples"].map((sample) => ({
      ...sample,
      flow_status: "实验准备就绪",
      status: "实验准备就绪",
      trays: [{ tray_code: "TASK-001-TP-001", status: "实验准备就绪" }],
    }));
    mocks.loadSnapshot.mockResolvedValueOnce(snapshot);
    const wrapper = mount(TestHarness);
    await settle(wrapper);

    wrapper.vm.openMaintenancePlan(wrapper.vm.deviceRows[0]);
    wrapper.vm.maintenancePlanForm.type = "维修";

    await wrapper.vm.saveMaintenancePlan();
    await settle(wrapper);

    expect(wrapper.vm.runningRepairChoiceOpen).toBe(true);
    expect(wrapper.vm.runningRepairChoiceDetail.runningSchedules).toEqual([
      expect.objectContaining({ experiment_code: "TASK-001-A", task_code: "TASK-001" }),
    ]);
  });

  test("sets a device back to available and clears maintenance fields", async () => {
    mocks.loadSnapshot.mockResolvedValueOnce({
      "mes.devices": [
        {
          code: "冲击一室",
          maintenance_end_at: "2099-03-20T12:00",
          maintenance_note: "提前结束",
          maintenance_start_at: "2099-03-20T08:00",
          maintenance_type: "维修",
          name: "冲击试验系统-1",
          status: "维修",
        },
      ],
      "mes.experiment_trays": [],
      "mes.samples": [],
      "mes.schedules": [],
      "mes.conflicts": [],
      "mes.experiments": [],
      "mes.tasks": [],
    });
    const wrapper = mount(TestHarness);
    await settle(wrapper);

    wrapper.vm.openEditDevice(wrapper.vm.deviceRows[0]);
    await wrapper.vm.setDeviceAvailable();
    await settle(wrapper);

    expect(mocks.persistSnapshot).toHaveBeenCalledWith({
      "mes.devices": [
        expect.objectContaining({
          code: "冲击一室",
          maintenance_end_at: "",
          maintenance_note: "",
          maintenance_start_at: "",
          maintenance_type: "",
          status: "可用",
        }),
      ],
    });
  });

  test("does not set a device available when the edit status is idle", async () => {
    const wrapper = mount(TestHarness);
    await settle(wrapper);

    wrapper.vm.openEditDevice(wrapper.vm.deviceRows[0]);
    await wrapper.vm.setDeviceAvailable();
    await settle(wrapper);

    expect(wrapper.vm.canSetDeviceAvailable).toBe(false);
    expect(mocks.persistSnapshot).not.toHaveBeenCalled();
  });
});
